// 速風達代購計算面板（2026-09-17新增，Ivy反應每次代購都不知道品項/手續費要怎麼填）。
// 填人民幣金額＋匯率，按「套用」一次寫好品項（商品／代購手續費／街口支付手續費）；
// 用代購錢包餘額付的話再填銀行實扣金額，差額自動變成「代購錢包餘額折抵」折扣。
// 算法與驗證見 services/sufengdaCalc.ts。
import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { TransactionItem } from '../types';
import {
  calcSufengda, parseRmbNote,
  SUFENGDA_PROXY_FEE_NAME, SUFENGDA_PAYMENT_FEE_NAME,
} from '../services/sufengdaCalc';

interface Props {
  initialItems: TransactionItem[];
  onApply: (items: TransactionItem[], walletDiscount: number | null) => void;
  onClose: () => void;
}

interface Row { name: string; rmb: string; qty: string }

const FEE_NAMES = [SUFENGDA_PROXY_FEE_NAME, SUFENGDA_PAYMENT_FEE_NAME];

export const SufengdaCalculator: React.FC<Props> = ({ initialItems, onApply, onClose }) => {
  // 打開既有交易時，從品項備註帶入人民幣單價/匯率（手續費那兩行是計算結果，不當成商品帶入）
  const initial = useMemo(() => {
    const products = initialItems.filter(it => !FEE_NAMES.includes(it.name) && !it.subItems?.length);
    let rate = '';
    const rows: Row[] = products.map(it => {
      const parsed = parseRmbNote(it.note);
      if (parsed.rate && !rate) rate = String(parsed.rate);
      return { name: it.name, rmb: parsed.rmb != null ? String(parsed.rmb) : '', qty: it.quantity && it.quantity > 1 ? String(it.quantity) : '1' };
    });
    const names = initialItems.map(it => it.name);
    // 已經有街口手續費、卻沒有代購手續費 → 之前是集運運費這類不收代購費的
    const withProxyFee = !(names.includes(SUFENGDA_PAYMENT_FEE_NAME) && !names.includes(SUFENGDA_PROXY_FEE_NAME));
    return { rows: rows.length ? rows : [{ name: '', rmb: '', qty: '1' }], rate, withProxyFee };
  }, [initialItems]);

  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [rate, setRate] = useState(initial.rate);
  const [withProxyFee, setWithProxyFee] = useState(initial.withProxyFee);
  const [payMode, setPayMode] = useState<'direct' | 'wallet'>('direct');
  const [actualTwd, setActualTwd] = useState('');

  const droppedCombos = initialItems.some(it => it.subItems?.length);

  const result = useMemo(() => calcSufengda(
    rows.map(r => ({ name: r.name.trim() || '代購商品', rmb: parseFloat(r.rmb) || 0, quantity: parseFloat(r.qty) || 1 })),
    parseFloat(rate),
    withProxyFee,
  ), [rows, rate, withProxyFee]);

  const actualNum = parseFloat(actualTwd);
  const walletDiscount = result && payMode === 'wallet' && !isNaN(actualNum) ? result.total - actualNum : null;
  const walletInvalid = payMode === 'wallet' && (walletDiscount === null || walletDiscount < 0 || !Number.isInteger(actualNum));
  const canApply = !!result && !walletInvalid && rows.every(r => r.name.trim() !== '' || r.rmb.trim() === '');

  const updateRow = (idx: number, field: keyof Row, value: string) =>
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const handleApply = () => {
    if (!result || !canApply) return;
    const items: TransactionItem[] = result.lines.map(l => ({
      name: l.name,
      unitPrice: l.twd / l.quantity, // 跟外幣試算工具一樣：整行先算好整數，再回推單價，「單價×數量」剛好等於整行
      quantity: l.quantity > 1 ? l.quantity : undefined,
      note: l.note,
    }));
    onApply(items, payMode === 'wallet' && walletDiscount ? walletDiscount : null);
  };

  const inputCls = 'w-full p-2 bg-white border border-violet-200 rounded-lg text-sm font-bold outline-none focus:border-violet-300';

  return (
    <div className="p-3 bg-violet-50/50 border border-violet-100 rounded-xl space-y-3 animate-in slide-in-from-top-1">
      <p className="text-[10px] text-violet-600">
        速風達算法：商品人民幣（含中國境內運費）× 1.02 代購手續費 × 匯率 × 1.02 街口支付手續費，四捨五入到整數台幣。
        填好按「套用」，會取代目前的購物清單。
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <label className="text-[9px] font-bold text-violet-600 uppercase block mb-1">匯率</label>
          <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} onFocus={e => e.target.select()} placeholder="例如：4.71" className={inputCls} />
        </div>
        <label className="min-w-0 flex items-end gap-2 pb-2 text-xs font-bold text-violet-600">
          <input type="checkbox" checked={withProxyFee} onChange={e => setWithProxyFee(e.target.checked)} className="w-4 h-4 accent-violet-500" />
          收代購手續費 2%（集運運費不用勾）
        </label>
      </div>

      <div className="space-y-2">
        <div className="hidden sm:flex gap-2 text-[9px] font-bold text-violet-600 uppercase px-1">
          <span className="flex-1">商品／境內運費</span>
          <span className="w-20 shrink-0">人民幣單價</span>
          <span className="w-12 shrink-0">數量</span>
          <span className="w-6 shrink-0" />
        </div>
        {/* 手機寬度下商品名稱獨佔一行，人民幣/數量放下一行，避免名稱欄被擠到只剩幾個字寬 */}
        {rows.map((r, idx) => (
          <div key={idx} className="flex flex-wrap sm:flex-nowrap gap-2 items-center p-2 sm:p-0 bg-white/60 sm:bg-transparent rounded-lg">
            <input type="text" value={r.name} onChange={e => updateRow(idx, 'name', e.target.value)} placeholder="商品名稱，例如：雜誌 C版" className={`${inputCls} basis-full sm:basis-auto sm:flex-1 min-w-0`} />
            <input type="number" step="0.01" value={r.rmb} onChange={e => updateRow(idx, 'rmb', e.target.value)} onFocus={e => e.target.select()} placeholder="人民幣單價" className={`${inputCls} flex-1 sm:flex-none sm:w-20 min-w-0`} />
            <input type="number" value={r.qty} onChange={e => updateRow(idx, 'qty', e.target.value)} onFocus={e => e.target.select()} placeholder="數量" className={`${inputCls} w-16 sm:w-12 shrink-0`} />
            <button type="button" onClick={() => setRows(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)} className="w-6 shrink-0 p-1 text-slate-300 hover:text-rose-400 transition"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRows(prev => [...prev, { name: '', rmb: '', qty: '1' }])} className="text-xs font-bold text-violet-400 hover:text-violet-500 flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> 新增一行（例如境內運費）
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] font-bold text-violet-600 uppercase block">這次怎麼付</label>
        <div className="flex bg-white border border-violet-200 rounded-lg overflow-hidden">
          {([['direct', '當下直接付款'], ['wallet', '用代購錢包餘額']] as const).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => setPayMode(mode)} className={`flex-1 px-2 py-2 text-xs font-bold transition ${payMode === mode ? 'bg-violet-500 text-white' : 'text-slate-400 hover:bg-violet-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {payMode === 'wallet' && (
          <div className="min-w-0">
            <label className="text-[9px] font-bold text-violet-600 uppercase block mb-1">銀行實際扣款（台幣）</label>
            <input type="number" value={actualTwd} onChange={e => setActualTwd(e.target.value)} onFocus={e => e.target.select()} placeholder="例如：773" className={inputCls} />
            <p className="text-[10px] text-violet-400 mt-1">品項一樣照直接付款拆，跟實扣的差額記成折扣「代購錢包餘額折抵」，實付金額就會等於銀行扣款。</p>
          </div>
        )}
      </div>

      {result && (
        <div className="p-2 bg-white border border-violet-100 rounded-lg space-y-1">
          {result.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-slate-600 truncate">{l.name}</p>
                <p className="text-[10px] text-slate-400 break-all">{l.note}</p>
              </div>
              <span className="font-bold text-slate-700 shrink-0">${l.twd}</span>
            </div>
          ))}
          <div className="flex justify-between text-xs font-bold text-violet-600 pt-1 border-t border-violet-100">
            <span>{payMode === 'wallet' ? '直接付款應付（原始金額）' : '合計（應等於銀行扣款）'}</span>
            <span>${result.total}</span>
          </div>
          {payMode === 'wallet' && walletDiscount !== null && walletDiscount >= 0 && (
            <>
              <div className="flex justify-between text-xs font-bold text-emerald-600"><span>代購錢包餘額折抵</span><span>−${walletDiscount}</span></div>
              <div className="flex justify-between text-xs font-bold text-slate-700"><span>實付金額</span><span>${actualNum}</span></div>
            </>
          )}
          {payMode === 'wallet' && walletDiscount !== null && walletDiscount < 0 && (
            <p className="text-[10px] font-bold text-rose-500">實扣比直接付款算出來的還多，請再確認人民幣金額或匯率。</p>
          )}
        </div>
      )}

      {droppedCombos && <p className="text-[10px] text-amber-600">注意：目前清單裡有套餐（含子品項），套用後會被取代。</p>}

      <div className="flex gap-2">
        <button type="button" onClick={handleApply} disabled={!canApply} className="flex-1 py-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold transition">
          套用到購物清單
        </button>
        <button type="button" onClick={onClose} className="px-3 py-2 text-slate-400 hover:text-slate-500 text-xs font-bold transition">取消</button>
      </div>
    </div>
  );
};
