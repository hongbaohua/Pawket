// 罐罐明細本的搜尋（2026-10-19重做）
//
// Ivy 回報：舊的搜尋只是「整串文字 includes」，分類篩選又藏在按鈕後面的樹狀清單裡，
// 「標籤有跟沒有似的」。這裡把搜尋改成：
//   1. 空白分隔多個關鍵字，全部都要符合（例如「全家 吐司」）
//   2. 「-關鍵字」排除（例如「全家 -取件」）
//   3. 金額條件：>500、>=500、<100、100-300、=120 / $120
//   4. 日期關鍵字：2026-10、2026-10-19、10/19、10月
//   5. 分類用中文比對（舊版拿英文代碼 Variable/Fixed 比對，打「變動支出」根本找不到）
//   6. 帳戶名稱、付款通道、折扣名稱、套餐子品項也一起搜
// 另外提供「打字時的建議」：商家／分類／細項／品項／帳戶，點了變成精確篩選標籤。

import { Transaction, Account, CATEGORY_LABELS, L1Category, TransactionItem } from '../types';

export type FieldFilter =
  | { kind: 'merchant'; value: string }
  | { kind: 'item'; value: string }
  | { kind: 'account'; value: string; label: string };

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'last_month' | 'last30' | 'year' | 'day' | 'custom';

export interface DateFilter {
  preset: DatePreset;
  start?: string; // YYYY-MM-DD（custom 的起日；day 的那一天）
  end?: string;
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all: '全部',
  today: '今天',
  week: '本週',
  month: '本月',
  last_month: '上個月',
  last30: '近30天',
  year: '今年',
  day: '指定日期',
  custom: '自訂區間',
};

const pad = (n: number) => String(n).padStart(2, '0');
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 把日期篩選換算成 [start, end]（含頭含尾，YYYY-MM-DD 字串比較）。all 回傳 null。 */
export const resolveDateRange = (f: DateFilter, today: Date = new Date()): { start: string; end: string } | null => {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  switch (f.preset) {
    case 'all': return null;
    case 'today': return { start: toYmd(today), end: toYmd(today) };
    case 'week': {
      // 週一開始
      const dow = (today.getDay() + 6) % 7;
      return { start: toYmd(new Date(y, m, d - dow)), end: toYmd(new Date(y, m, d - dow + 6)) };
    }
    case 'month': return { start: toYmd(new Date(y, m, 1)), end: toYmd(new Date(y, m + 1, 0)) };
    case 'last_month': return { start: toYmd(new Date(y, m - 1, 1)), end: toYmd(new Date(y, m, 0)) };
    case 'last30': return { start: toYmd(new Date(y, m, d - 29)), end: toYmd(today) };
    case 'year': return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'day': {
      const d = f.start || toYmd(today);
      return { start: d, end: d };
    }
    case 'custom':
      if (!f.start && !f.end) return null;
      return { start: f.start || '0000-01-01', end: f.end || '9999-12-31' };
  }
};

type AmountCond = (n: number) => boolean;

interface ParsedQuery {
  include: string[];
  exclude: string[];
  amount: AmountCond[];
  datePrefixes: string[]; // 'YYYY-MM' / 'YYYY-MM-DD' / '-MM-DD'(不分年) / '-MM-'(不分年的月份)
}

const AMOUNT_RE = /^(>=|<=|>|<|=|\$)(\d+(?:\.\d+)?)$/;
const RANGE_RE = /^\$?(\d+(?:\.\d+)?)[-~](\d+(?:\.\d+)?)$/;

export const parseQuery = (raw: string): ParsedQuery => {
  const q: ParsedQuery = { include: [], exclude: [], amount: [], datePrefixes: [] };
  raw.trim().split(/\s+/).filter(Boolean).forEach(tok => {
    let m = tok.match(AMOUNT_RE);
    if (m) {
      const n = parseFloat(m[2]);
      const op = m[1];
      q.amount.push(op === '>' ? x => x > n : op === '>=' ? x => x >= n : op === '<' ? x => x < n : op === '<=' ? x => x <= n : x => Math.abs(x - n) < 0.005);
      return;
    }
    if (/^\d{4}-\d{1,2}(-\d{1,2})?$/.test(tok)) {
      const [yy, mm, dd] = tok.split('-');
      q.datePrefixes.push(dd ? `${yy}-${pad(+mm)}-${pad(+dd)}` : `${yy}-${pad(+mm)}`);
      return;
    }
    if (/^\d{4}\/\d{1,2}(\/\d{1,2})?$/.test(tok)) {
      const [yy, mm, dd] = tok.split('/');
      q.datePrefixes.push(dd ? `${yy}-${pad(+mm)}-${pad(+dd)}` : `${yy}-${pad(+mm)}`);
      return;
    }
    if (/^\d{1,2}\/\d{1,2}$/.test(tok)) {
      const [mm, dd] = tok.split('/');
      q.datePrefixes.push(`-${pad(+mm)}-${pad(+dd)}`);
      return;
    }
    // 金額區間放在日期判斷之後：「2026-10」是日期，不是 10～2026 元
    m = tok.match(RANGE_RE);
    if (m) {
      const a = parseFloat(m[1]), b = parseFloat(m[2]);
      q.amount.push(x => x >= Math.min(a, b) && x <= Math.max(a, b));
      return;
    }
    m = tok.match(/^(\d{1,2})月$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) {
      q.datePrefixes.push(`-${pad(+m[1])}-`);
      return;
    }
    if (tok.startsWith('-') && tok.length > 1) q.exclude.push(tok.slice(1).toLowerCase());
    else q.include.push(tok.toLowerCase());
  });
  return q;
};

const specialTagLabel = (t: Transaction) =>
  t.specialTag?.type === 'proxy_purchase' ? '代購' : t.specialTag?.type === 'work_advance' ? '工作代墊' : t.specialTag?.type === 'personal_loan' ? '借貸' : '';

const typeLabel = (t: Transaction) => (t.type === 'income' ? '收入' : t.type === 'transfer' ? '轉帳 互轉' : '支出');

const itemTexts = (items: TransactionItem[] | undefined): string[] =>
  (items || []).flatMap(it => [it.name, it.note || '', ...itemTexts(it.subItems)]);

/** 一筆交易所有可以被搜到的文字，全部轉小寫串起來 */
export const buildHaystack = (t: Transaction, accounts: Account[]): string => {
  const acc = accounts.find(a => a.id === t.accountId);
  const from = accounts.find(a => a.id === t.fromAccountId);
  const to = accounts.find(a => a.id === t.toAccountId);
  return [
    t.merchant,
    t.note || '',
    ...itemTexts(t.items),
    CATEGORY_LABELS[t.category.l1] || '',
    t.category.l2,
    t.category.l3 || '',
    acc?.name || '', acc?.institution || '',
    from?.name || '', to?.name || '',
    t.paymentChannel || '',
    specialTagLabel(t), t.specialTag?.counterparty || '', t.specialTag?.note || '',
    ...(t.discounts || []).map(d => d.label),
    typeLabel(t),
    t.isSplit ? '分裝' : '',
  ].join('\n').toLowerCase();
};

export const matchesQuery = (t: Transaction, q: ParsedQuery, haystack: string): boolean => {
  if (q.include.some(w => !haystack.includes(w))) return false;
  if (q.exclude.some(w => haystack.includes(w))) return false;
  if (q.amount.some(cond => !cond(t.amount))) return false;
  // '-MM-DD' / '-MM-' 是不分年份的月日，比對 date 去掉年份的部分（'2026-10-19' → '-10-19'）
  if (q.datePrefixes.length && !q.datePrefixes.some(p => (p.startsWith('-') ? t.date.slice(4).startsWith(p) : t.date.startsWith(p)))) return false;
  return true;
};

const itemHasName = (items: TransactionItem[] | undefined, name: string): boolean =>
  (items || []).some(it => it.name === name || itemHasName(it.subItems, name));

export const matchesFieldFilters = (t: Transaction, filters: FieldFilter[]): boolean =>
  filters.every(f => {
    if (f.kind === 'merchant') return t.merchant === f.value;
    if (f.kind === 'item') return itemHasName(t.items, f.value);
    return t.accountId === f.value || t.fromAccountId === f.value || t.toAccountId === f.value;
  });

export interface Suggestion {
  kind: 'merchant' | 'category' | 'tag' | 'item' | 'account';
  label: string;     // 顯示文字
  sub: string;       // 類型說明（商家／分類…）
  count: number;
  // 點了之後套用的篩選
  categoryKey?: string;
  field?: FieldFilter;
}

/** 打字時的建議：用目前正在打的最後一個關鍵字比對商家／分類／細項／品項／帳戶 */
export const buildSuggestions = (
  word: string,
  transactions: Transaction[],
  accounts: Account[],
  buildFilterKey: (l1: string, l2?: string, l3?: string) => string,
  limit = 8,
): Suggestion[] => {
  const w = word.trim().toLowerCase();
  if (!w || w.startsWith('-') || /^[<>=$\d]/.test(w)) return [];
  const merchants = new Map<string, number>();
  const cats = new Map<string, { l1: L1Category; l2: string; n: number }>();
  const tags = new Map<string, { l1: L1Category; l2: string; l3: string; n: number }>();
  const items = new Map<string, number>();
  const accCount = new Map<string, number>();
  transactions.forEach(t => {
    if (t.merchant.toLowerCase().includes(w)) merchants.set(t.merchant, (merchants.get(t.merchant) || 0) + 1);
    const { l1, l2, l3 } = t.category;
    if (l2 && (l2.toLowerCase().includes(w) || (CATEGORY_LABELS[l1] || '').includes(w))) {
      const k = `${l1}::${l2}`;
      const e = cats.get(k) || { l1, l2, n: 0 }; e.n++; cats.set(k, e);
    }
    if (l3 && l3.toLowerCase().includes(w)) {
      const k = `${l1}::${l2}::${l3}`;
      const e = tags.get(k) || { l1, l2, l3, n: 0 }; e.n++; tags.set(k, e);
    }
    const seen = new Set<string>();
    const walk = (list?: TransactionItem[]) => (list || []).forEach(it => {
      if (it.name && it.name.toLowerCase().includes(w) && !seen.has(it.name)) { seen.add(it.name); items.set(it.name, (items.get(it.name) || 0) + 1); }
      walk(it.subItems);
    });
    walk(t.items);
    if (t.accountId) accCount.set(t.accountId, (accCount.get(t.accountId) || 0) + 1);
  });

  const out: Suggestion[] = [];
  // 完全相等的排最前面，其次次數多的
  const rank = <T,>(entries: [string, T][], getN: (v: T) => number, getName: (k: string, v: T) => string) =>
    entries.sort((a, b) => {
      const ea = getName(a[0], a[1]).toLowerCase() === w ? 1 : 0;
      const eb = getName(b[0], b[1]).toLowerCase() === w ? 1 : 0;
      return eb - ea || getN(b[1]) - getN(a[1]);
    });

  rank([...cats.entries()], v => v.n, (_, v) => v.l2).slice(0, 3).forEach(([, v]) =>
    out.push({ kind: 'category', label: v.l2, sub: `分類・${CATEGORY_LABELS[v.l1]}`, count: v.n, categoryKey: buildFilterKey(v.l1, v.l2) }));
  rank([...tags.entries()], v => v.n, (_, v) => v.l3).slice(0, 2).forEach(([, v]) =>
    out.push({ kind: 'tag', label: v.l3, sub: `細項・${v.l2}`, count: v.n, categoryKey: buildFilterKey(v.l1, v.l2, v.l3) }));
  rank([...merchants.entries()], n => n, k => k).slice(0, 3).forEach(([name, n]) =>
    out.push({ kind: 'merchant', label: name, sub: '商家', count: n, field: { kind: 'merchant', value: name } }));
  accounts.filter(a => a.name.toLowerCase().includes(w) || (a.institution || '').toLowerCase().includes(w)).slice(0, 2).forEach(a =>
    out.push({ kind: 'account', label: a.name, sub: '帳戶', count: accCount.get(a.id) || 0, field: { kind: 'account', value: a.id, label: a.name } }));
  rank([...items.entries()], n => n, k => k).slice(0, 3).forEach(([name, n]) =>
    out.push({ kind: 'item', label: name, sub: '品項', count: n, field: { kind: 'item', value: name } }));
  return out.slice(0, limit);
};
