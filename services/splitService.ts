// 分裝（2026-10-19 重做）
//
// 舊做法：先存一筆，再開「分裝盤」逐筆打子項目，剩下的錢自動留在一筆「主項目」上，
// 主項目還帶著原本的分類。問題（Ivy 回報）：
//   1. 分裝是為了「一筆消費裡有好幾種類別」，分完就不該還有一個主類別。
//   2. 折扣沒算進去：全家「吐司(有折扣)+預購積木」，吐司是餐飲、積木是娛樂，
//      品項價是折扣前的，舊分裝盤只能拿實付金額硬拆，根本拆不對。
//   3. 分裝要在填資料時就完成，不是存完再回頭逐筆改。
//
// 新做法：填資料時開「分裝」，每個品項直接選分類；折扣可以指定折在哪個品項上（沒指定
// 就按品項金額比例分攤）。存檔時同一個分類的品項併成一筆子交易，每筆子交易都帶著自己
// 的品項、原始金額、分到的折扣，加總剛好等於整筆實付金額。沒有主項目。

import { Transaction, TransactionItem, Discount, CategoryHierarchy, L1Category } from '../types';
import { getItemAmount } from './logicService';
import { v4 as uuidv4 } from 'uuid';

const LEGACY_L3 = new Set(['主項目', '分裝項目']);

export interface ItemAllocation {
  gross: number;      // 品項原價（折扣前）
  discount: number;   // 分到的折扣
  net: number;        // 實付
  discountParts: Discount[]; // 這個品項分到的每一筆折扣（label/金額/appliesTo）
}

const round = (n: number, decimals: number) => {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
};

const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

// 按權重分配一個金額，用最大餘數法讓分完加總剛好等於原金額（不會差 1 塊）。
const distribute = (total: number, weights: number[], decimals: number): number[] => {
  const unit = Math.pow(10, -decimals);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const units = Math.round(total / unit);
  const raw = weights.map(w => (w / weightSum) * units);
  const floored = raw.map(Math.floor);
  let remainder = units - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) floored[order[k].i] += 1;
  return floored.map(u => round(u * unit, decimals));
};

/**
 * 算出每個品項分到多少折扣、實付多少。
 * - 折扣有 appliesTo（品項名稱，可多個）→ 只在這些品項之間按金額比例分
 * - 沒有 appliesTo → 按所有品項的原價比例分攤
 */
export const allocateItems = (items: TransactionItem[], discounts: Discount[]): ItemAllocation[] => {
  const grosses = items.map(it => getItemAmount(it));
  const allWhole = grosses.every(isWhole) && discounts.every(d => isWhole(d.amount || 0));
  const decimals = allWhole ? 0 : 2;
  const result: ItemAllocation[] = grosses.map(g => ({ gross: g, discount: 0, net: g, discountParts: [] }));

  discounts.forEach(d => {
    const amt = d.amount || 0;
    if (!amt) return;
    const targets = (d.appliesTo || []).map(n => n.trim()).filter(Boolean);
    const targetIdx = targets.length ? items.map((it, i) => (targets.includes(it.name.trim()) ? i : -1)).filter(i => i >= 0) : [];
    const pool = targetIdx.length > 0 ? targetIdx : items.map((_, i) => i);
    const shares = distribute(amt, pool.map(i => grosses[i]), decimals);
    pool.forEach((itemIdx, k) => {
      if (!shares[k]) return;
      result[itemIdx].discount = round(result[itemIdx].discount + shares[k], 2);
      result[itemIdx].discountParts.push({ label: d.label, amount: shares[k], ...(targetIdx.length > 0 ? { appliesTo: targets } : {}) });
    });
  });
  result.forEach(r => { r.net = round(r.gross - r.discount, 2); });
  return result;
};

const sameTargets = (a?: string[], b?: string[]) => (a || []).slice().sort().join('|') === (b || []).slice().sort().join('|');

const categoryKey = (c: CategoryHierarchy) => `${c.l1}|${c.l2}|${c.l3 || ''}`;

const stripSplitCategory = (it: TransactionItem): TransactionItem => {
  const { splitCategory, ...rest } = it;
  return rest;
};

/**
 * 把一筆填好品項+每個品項分類的交易，拆成「每個分類一筆」的子交易。
 * - idPool：要沿用的既有 id（重新編輯分裝時沿用舊子交易 id，對帳/分帳連結不會斷）。第一筆一定用 base.id。
 * - groupId：分裝群組 id（parent_id）。
 * 只有一個分類時回傳一筆一般交易（isSplit=false），等於取消分裝。
 */
export const buildSplitChildren = (
  base: Transaction,
  items: TransactionItem[],
  discounts: Discount[],
  fallbackCategory: CategoryHierarchy,
  groupId: string,
  idPool: string[],
): Transaction[] => {
  const alloc = allocateItems(items, discounts);
  const groups: { category: CategoryHierarchy; idx: number[] }[] = [];
  items.forEach((it, i) => {
    const cat = it.splitCategory || fallbackCategory;
    const key = categoryKey(cat);
    const g = groups.find(x => categoryKey(x.category) === key);
    if (g) g.idx.push(i); else groups.push({ category: cat, idx: [i] });
  });

  const ids = [base.id, ...idPool.filter(id => id !== base.id)];

  if (groups.length <= 1) {
    const cat = groups[0]?.category || fallbackCategory;
    return [{
      ...base,
      isSplit: false,
      parentId: undefined,
      items: items.map(stripSplitCategory),
      category: { ...cat, l3: cat.l3 || '' },
    }];
  }

  return groups.map((g, gi) => {
    const gross = round(g.idx.reduce((s, i) => s + alloc[i].gross, 0), 2);
    const net = round(g.idx.reduce((s, i) => s + alloc[i].net, 0), 2);
    // 同一個折扣名稱（同一個 appliesTo）合併成一列
    const merged: Discount[] = [];
    g.idx.forEach(i => alloc[i].discountParts.forEach(p => {
      const ex = merged.find(m => m.label === p.label && sameTargets(m.appliesTo, p.appliesTo));
      if (ex) ex.amount = round(ex.amount + p.amount, 2); else merged.push({ ...p });
    }));
    const hasDiscount = merged.some(d => d.amount);
    return {
      ...base,
      id: ids[gi] || uuidv4(),
      parentId: groupId,
      isSplit: true,
      amount: net,
      grossAmount: hasDiscount ? gross : undefined,
      discounts: hasDiscount ? merged.filter(d => d.amount) : undefined,
      items: g.idx.map(i => stripSplitCategory(items[i])),
      // 備註是整筆的說明，只留在第一筆，不要每筆都重複
      note: gi === 0 ? base.note : undefined,
      type: g.category.l1 === L1Category.INCOME ? 'income' : (base.type === 'income' ? 'expense' : base.type),
      category: { l1: g.category.l1, l2: g.category.l2, l3: g.category.l3 || '' },
    };
  });
};

/**
 * 把一個分裝群組的子交易合併回「一筆＋每個品項帶分類」，給編輯畫面用。
 * 舊版分裝盤留下來的資料（主項目/分裝項目、子項目沒有品項清單）也能讀：
 * 沒有品項的子交易，用它的名稱跟金額當成一個品項。
 */
export const mergeSplitGroup = (children: Transaction[]): Transaction => {
  const sorted = [...children].sort((a, b) => {
    // 舊資料：主項目排最前面（商家名稱以它為準）
    if (a.category.l3 === '主項目') return -1;
    if (b.category.l3 === '主項目') return 1;
    return 0;
  });
  const parentId = sorted[0].parentId!;
  const anchor = sorted.find(c => c.id === parentId) || sorted.find(c => c.category.l3 === '主項目') || sorted[0];
  const merchant = anchor.merchant;

  const items: TransactionItem[] = [];
  const discounts: Discount[] = [];
  sorted.forEach(c => {
    const cat: CategoryHierarchy = { l1: c.category.l1, l2: c.category.l2, l3: LEGACY_L3.has(c.category.l3) ? '' : c.category.l3 };
    if (c.items?.length) {
      c.items.forEach(it => items.push({ ...it, splitCategory: cat }));
    } else if (c.amount) {
      // 舊版：子交易本身就是一個品項，名稱存在 merchant
      const name = c.category.l3 === '主項目' || c.merchant === merchant ? '其他' : c.merchant;
      items.push({ name, unitPrice: c.grossAmount ?? c.amount, splitCategory: cat });
    }
    (c.discounts || []).forEach(d => {
      const ex = discounts.find(m => m.label === d.label && sameTargets(m.appliesTo, d.appliesTo));
      if (ex) ex.amount = round(ex.amount + d.amount, 2); else discounts.push({ ...d });
    });
  });

  const amount = round(sorted.reduce((s, c) => s + c.amount, 0), 2);
  const gross = round(sorted.reduce((s, c) => s + (c.grossAmount ?? c.amount), 0), 2);
  return {
    ...anchor,
    merchant,
    amount,
    grossAmount: discounts.length ? gross : undefined,
    discounts: discounts.length ? discounts : undefined,
    items,
    note: sorted.map(c => c.note).find(n => n) || undefined,
    specialTag: sorted.map(c => c.specialTag).find(t => t) || undefined,
    category: { l1: anchor.category.l1, l2: anchor.category.l2, l3: LEGACY_L3.has(anchor.category.l3) ? '' : anchor.category.l3 },
  };
};
