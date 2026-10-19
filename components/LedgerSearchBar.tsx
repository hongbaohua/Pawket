// 罐罐明細本的查找列（2026-10-19重做，見 services/searchService.ts 的說明）：
// 搜尋框＋打字建議、日期篩選、常用分類快速標籤、目前生效的篩選標籤、結果統計。
import React, { useMemo, useRef, useState } from 'react';
import { Search, X, Filter, CalendarDays, Store, Tag, ShoppingBag, Wallet, Hash } from 'lucide-react';
import { Transaction, Account, CATEGORY_LABELS, L1Category } from '../types';
import TransactionFilterPanel, { buildFilterKey } from './TransactionFilterPanel';
import { FieldFilter, DateFilter, DatePreset, DATE_PRESET_LABELS, buildSuggestions, Suggestion, resolveDateRange } from '../services/searchService';
import { formatMoney } from '../services/logicService';

interface Props {
  transactions: Transaction[];          // 全部（建議、分類樹用）
  dateScopedTransactions: Transaction[]; // 套用日期後（常用分類標籤用）
  accounts: Account[];
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  selectedTagFilters: Set<string>;
  toggleTagFilter: (key: string) => void;
  clearTagFilters: () => void;
  fieldFilters: FieldFilter[];
  setFieldFilters: (f: FieldFilter[]) => void;
  dateFilter: DateFilter;
  setDateFilter: (f: DateFilter) => void;
  summary: { count: number; expense: number; income: number };
}

const PRESETS: DatePreset[] = ['all', 'today', 'week', 'month', 'last_month', 'last30', 'year', 'day', 'custom'];

// 指定日期的前一天／後一天
const shiftDay = (ymd: string, delta: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const SUGGESTION_ICON: Record<Suggestion['kind'], React.ReactNode> = {
  merchant: <Store className="w-3.5 h-3.5" />,
  category: <Tag className="w-3.5 h-3.5" />,
  tag: <Hash className="w-3.5 h-3.5" />,
  item: <ShoppingBag className="w-3.5 h-3.5" />,
  account: <Wallet className="w-3.5 h-3.5" />,
};

// 篩選鍵 "L1::L2::L3" 轉回人看得懂的文字
const describeCategoryKey = (key: string) => {
  const [l1, l2, l3] = key.split('::');
  const l1Label = CATEGORY_LABELS[l1 as L1Category] || l1;
  return l3 ? `${l2}・${l3}` : l2 ? l2 : l1Label;
};

const LedgerSearchBar: React.FC<Props> = ({
  transactions, dateScopedTransactions, accounts, searchTerm, setSearchTerm,
  selectedTagFilters, toggleTagFilter, clearTagFilters, fieldFilters, setFieldFilters,
  dateFilter, setDateFilter, summary,
}) => {
  const [focused, setFocused] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 目前正在打的字（最後一個空白之後）
  const currentWord = useMemo(() => {
    if (searchTerm.endsWith(' ')) return '';
    const parts = searchTerm.split(/\s+/);
    return parts[parts.length - 1] || '';
  }, [searchTerm]);

  const suggestions = useMemo(
    () => (focused ? buildSuggestions(currentWord, transactions, accounts, buildFilterKey) : []),
    [focused, currentWord, transactions, accounts]
  );

  const applySuggestion = (s: Suggestion) => {
    if (s.categoryKey) {
      if (!selectedTagFilters.has(s.categoryKey)) toggleTagFilter(s.categoryKey);
    } else if (s.field) {
      const exists = fieldFilters.some(f => f.kind === s.field!.kind && f.value === s.field!.value);
      if (!exists) setFieldFilters([...fieldFilters, s.field]);
    }
    // 把剛剛打的那個字從搜尋框拿掉（已經變成精確篩選標籤了）
    const parts = searchTerm.trimEnd().split(/\s+/);
    parts.pop();
    setSearchTerm(parts.length ? parts.join(' ') + ' ' : '');
    setHighlight(0);
    inputRef.current?.focus();
  };

  // 常用分類快速標籤：目前日期範圍內筆數最多的次分類，點一下就篩
  const quickCategories = useMemo(() => {
    const counts = new Map<string, { l1: L1Category; l2: string; n: number }>();
    dateScopedTransactions.forEach(t => {
      if (t.type === 'transfer' || !t.category.l2) return;
      const key = buildFilterKey(t.category.l1, t.category.l2);
      const e = counts.get(key) || { l1: t.category.l1, l2: t.category.l2, n: 0 };
      e.n++; counts.set(key, e);
    });
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  }, [dateScopedTransactions]);

  const range = resolveDateRange(dateFilter);
  const hasAnyFilter = !!searchTerm.trim() || selectedTagFilters.size > 0 || fieldFilters.length > 0 || dateFilter.preset !== 'all';

  const clearAll = () => {
    setSearchTerm('');
    clearTagFilters();
    setFieldFilters([]);
    setDateFilter({ preset: 'all' });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 搜尋框＋建議 */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="搜尋商家、品項、分類、帳戶… 也可以打 >500、10/19、-取件"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setHighlight(0); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={e => {
              if (!suggestions.length) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % suggestions.length); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + suggestions.length) % suggestions.length); }
              else if (e.key === 'Enter') { e.preventDefault(); applySuggestion(suggestions[highlight]); }
              else if (e.key === 'Escape') setFocused(false);
            }}
            className="w-full pl-12 pr-10 py-3 bg-white border border-slate-100 rounded-2xl shadow-sm text-slate-700 font-bold outline-none placeholder:font-normal placeholder:text-slate-300 placeholder:text-sm focus:border-amber-300"
          />
          {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-300"><X className="w-4 h-4" /></button>}
          {suggestions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 mt-2 bg-white border border-amber-100 rounded-2xl shadow-xl overflow-hidden">
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-300">點選變成篩選標籤（↑↓ 選、Enter 套用）</p>
              {suggestions.map((s, i) => (
                <button
                  key={`${s.kind}-${s.label}-${i}`}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); applySuggestion(s); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition ${i === highlight ? 'bg-amber-50' : ''}`}
                >
                  <span className="text-amber-400 shrink-0">{SUGGESTION_ICON[s.kind]}</span>
                  <span className="font-bold text-slate-700 truncate">{s.label}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">{s.sub}</span>
                  <span className="ml-auto text-[11px] text-slate-300 shrink-0">{s.count} 筆</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowAllCategories(v => !v)}
          className={`px-4 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all border ${showAllCategories ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-white text-slate-500 border-slate-100'}`}
        >
          {showAllCategories ? <X className="w-5 h-5" /> : <Filter className="w-5 h-5" />}
          <span className="hidden sm:inline">所有分類</span>
        </button>
      </div>

      {/* 日期 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <CalendarDays className="w-4 h-4 text-slate-400 mr-1" />
        {PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setDateFilter(
              p === 'custom' ? { preset: 'custom', start: dateFilter.start || range?.start, end: dateFilter.end || range?.end }
              : p === 'day' ? { preset: 'day', start: range?.end && dateFilter.preset !== 'all' ? range.end : resolveDateRange({ preset: 'today' })!.start }
              : { preset: p })}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${dateFilter.preset === p ? 'bg-amber-400 text-white shadow-sm' : 'bg-white border border-slate-100 text-slate-500 hover:border-amber-200'}`}
          >
            {DATE_PRESET_LABELS[p]}
          </button>
        ))}
        {dateFilter.preset === 'day' && range && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0 sm:ml-1">
            <button type="button" onClick={() => setDateFilter({ preset: 'day', start: shiftDay(range.start, -1) })} className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:border-amber-300" title="前一天">‹</button>
            <input type="date" value={range.start} onChange={e => e.target.value && setDateFilter({ preset: 'day', start: e.target.value })} className="flex-1 sm:flex-none px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-amber-300" />
            <button type="button" onClick={() => setDateFilter({ preset: 'day', start: shiftDay(range.start, 1) })} className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:border-amber-300" title="後一天">›</button>
          </div>
        )}
        {dateFilter.preset === 'custom' && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0 sm:ml-1">
            <input type="date" value={dateFilter.start || ''} onChange={e => setDateFilter({ ...dateFilter, start: e.target.value || undefined })} className="flex-1 sm:flex-none px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-amber-300" />
            <span className="text-slate-300 text-xs">～</span>
            <input type="date" value={dateFilter.end || ''} onChange={e => setDateFilter({ ...dateFilter, end: e.target.value || undefined })} className="flex-1 sm:flex-none px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-amber-300" />
          </div>
        )}
        {range && dateFilter.preset !== 'custom' && dateFilter.preset !== 'day' && (
          <span className="text-[11px] text-slate-400 ml-1">{range.start} ～ {range.end}</span>
        )}
      </div>

      {/* 常用分類：一點就篩，不用打開樹狀清單 */}
      {quickCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="w-4 h-4 text-slate-400 mr-1" />
          {quickCategories.map(([key, v]) => {
            const on = selectedTagFilters.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleTagFilter(key)}
                title={CATEGORY_LABELS[v.l1]}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${on ? 'bg-purple-500 text-white shadow-sm' : 'bg-white border border-slate-100 text-slate-500 hover:border-purple-200'}`}
              >
                {v.l2}<span className={`ml-1 text-[10px] ${on ? 'text-purple-100' : 'text-slate-300'}`}>{v.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {showAllCategories && (
        <div className="p-4 bg-white border border-amber-100 rounded-2xl animate-in slide-in-from-top-1 duration-150">
          <TransactionFilterPanel transactions={transactions} selected={selectedTagFilters} onToggle={toggleTagFilter} onClear={clearTagFilters} />
        </div>
      )}

      {/* 目前生效的篩選＋結果統計 */}
      {hasAnyFilter && (
        <div className="flex flex-wrap items-center gap-1.5 p-3 bg-amber-50/60 border border-amber-100 rounded-2xl">
          {[...selectedTagFilters].map(key => (
            <span key={key} className="flex items-center gap-1 pl-2.5 pr-1 py-1 bg-purple-100 text-purple-600 rounded-lg text-xs font-bold">
              <Tag className="w-3 h-3" />{describeCategoryKey(key)}
              <button type="button" onClick={() => toggleTagFilter(key)} className="p-0.5 hover:text-rose-500"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {fieldFilters.map((f, i) => (
            <span key={`${f.kind}-${f.value}`} className="flex items-center gap-1 pl-2.5 pr-1 py-1 bg-sky-100 text-sky-600 rounded-lg text-xs font-bold">
              {SUGGESTION_ICON[f.kind]}{f.kind === 'account' ? f.label : f.value}
              <button type="button" onClick={() => setFieldFilters(fieldFilters.filter((_, j) => j !== i))} className="p-0.5 hover:text-rose-500"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {range && (
            <span className="flex items-center gap-1 pl-2.5 pr-1 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">
              <CalendarDays className="w-3 h-3" />{range.start === range.end ? range.start : `${range.start.startsWith('0000') ? '…' : range.start} ～ ${range.end.startsWith('9999') ? '…' : range.end}`}
              <button type="button" onClick={() => setDateFilter({ preset: 'all' })} className="p-0.5 hover:text-rose-500"><X className="w-3 h-3" /></button>
            </span>
          )}
          <span className="text-xs text-slate-500 font-bold ml-1">
            找到 {summary.count} 筆
            {summary.expense > 0 && <>・支出 <span className="text-rose-500">${formatMoney(summary.expense)}</span></>}
            {summary.income > 0 && <>・收入 <span className="text-emerald-500">${formatMoney(summary.income)}</span></>}
          </span>
          <button type="button" onClick={clearAll} className="ml-auto text-xs font-bold text-slate-400 hover:text-rose-500">清除全部</button>
        </div>
      )}
    </div>
  );
};

export default LedgerSearchBar;
