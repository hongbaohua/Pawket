// 罐罐明細本的分類篩選面板：2026-08-13重新設計。原本把所有次分類(L2)+細項(L3)
// 攤平成一整排按鈕，Ivy反應「沒辦法快速分辨是什麼」——不知道哪個細項屬於哪個大分類，
// 也分不出收入跟支出。改成照大分類(L1)→次分類(L2)→細項(L3)的階層樹狀勾選，
// L1本身就是「固定支出／變動支出／投資儲蓄／收入帳戶」，天然把收入跟支出分開。
import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Transaction, L1Category, CATEGORY_LABELS } from '../types';

interface CategoryFilterPanelProps {
  transactions: Transaction[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}

// 篩選鍵的編碼方式：純L1是"L1"本身；L2是"L1::L2"；L3是"L1::L2::L3"——
// 一定要帶著L1當前綴，因為同一個L2文字（例如「轉帳」「活簿存款」）在不同大分類底下
// 意義完全不同（變動支出的「轉帳」是帳戶互轉，收入帳戶的「轉帳」是收到別人轉的錢），
// 舊版用不分大分類的flat字串比對，這兩種其實會被誤判成同一種篩選條件。
export const buildFilterKey = (l1: string, l2?: string, l3?: string): string =>
  l3 ? `${l1}::${l2}::${l3}` : l2 ? `${l1}::${l2}` : l1;

export const matchesCategoryFilter = (t: Transaction, selected: Set<string>): boolean => {
  if (selected.size === 0) return true;
  const { l1, l2, l3 } = t.category;
  if (selected.has(l1)) return true;
  if (l2 && selected.has(buildFilterKey(l1, l2))) return true;
  if (l3 && selected.has(buildFilterKey(l1, l2, l3))) return true;
  return false;
};

const L1_ORDER: L1Category[] = [L1Category.VARIABLE, L1Category.FIXED, L1Category.INVESTMENT, L1Category.INCOME];

interface L3Node { l3: string; count: number; key: string }
interface L2Node { l2: string; count: number; key: string; l3s: L3Node[] }
interface L1Node { l1: L1Category; count: number; l2s: L2Node[] }

const TransactionFilterPanel: React.FC<CategoryFilterPanelProps> = ({ transactions, selected, onToggle, onClear }) => {
  const [expandedL1, setExpandedL1] = useState<Set<string>>(new Set());
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set());

  const tree = useMemo<L1Node[]>(() => {
    const byL1: Partial<Record<L1Category, { count: number; l2s: Map<string, { count: number; l3s: Map<string, number> }> }>> = {};
    transactions.forEach(t => {
      const { l1, l2, l3 } = t.category;
      if (!byL1[l1]) byL1[l1] = { count: 0, l2s: new Map() };
      const l1Entry = byL1[l1]!;
      l1Entry.count += 1;
      if (!l2) return;
      if (!l1Entry.l2s.has(l2)) l1Entry.l2s.set(l2, { count: 0, l3s: new Map() });
      const l2Entry = l1Entry.l2s.get(l2)!;
      l2Entry.count += 1;
      if (l3) l2Entry.l3s.set(l3, (l2Entry.l3s.get(l3) || 0) + 1);
    });
    return L1_ORDER.filter(l1 => byL1[l1]).map(l1 => {
      const entry = byL1[l1]!;
      const l2s: L2Node[] = Array.from(entry.l2s.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([l2, l2Entry]) => ({
          l2, count: l2Entry.count, key: buildFilterKey(l1, l2),
          l3s: Array.from(l2Entry.l3s.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([l3, count]) => ({ l3, count, key: buildFilterKey(l1, l2, l3) })),
        }));
      return { l1, count: entry.count, l2s };
    });
  }, [transactions]);

  const toggleExpanded = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFn(next);
  };

  if (tree.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-2">目前還沒有分類資料可以篩選喵～</p>;
  }

  return (
    <div className="space-y-2">
      {tree.map(node => {
        const l1Open = expandedL1.has(node.l1);
        const l1Checked = selected.has(node.l1);
        return (
          <div key={node.l1} className="border border-slate-100 rounded-xl overflow-hidden bg-[#FFFBF5]">
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => toggleExpanded(expandedL1, setExpandedL1, node.l1)} className="p-0.5 text-slate-400 hover:text-amber-500 transition shrink-0">
                <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${l1Open ? 'rotate-90' : ''}`} />
              </button>
              <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                <input type="checkbox" checked={l1Checked} onChange={() => onToggle(node.l1)} className="w-4 h-4 rounded accent-amber-400 shrink-0" />
                <span className="font-bold text-sm text-slate-700 truncate">{CATEGORY_LABELS[node.l1]}</span>
                <span className="text-[10px] text-slate-400 shrink-0">({node.count})</span>
              </label>
            </div>
            {l1Open && (
              <div className="pl-8 pr-3 pb-2 space-y-1">
                {node.l2s.map(l2Node => {
                  const l2Open = expandedL2.has(l2Node.key);
                  const l2Checked = selected.has(l2Node.key);
                  return (
                    <div key={l2Node.key}>
                      <div className="flex items-center gap-2 py-1">
                        {l2Node.l3s.length > 0 ? (
                          <button type="button" onClick={() => toggleExpanded(expandedL2, setExpandedL2, l2Node.key)} className="p-0.5 text-slate-300 hover:text-amber-500 transition shrink-0">
                            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${l2Open ? 'rotate-90' : ''}`} />
                          </button>
                        ) : <span className="w-4 shrink-0" />}
                        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                          <input type="checkbox" checked={l2Checked} onChange={() => onToggle(l2Node.key)} className="w-3.5 h-3.5 rounded accent-amber-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-600 truncate">{l2Node.l2}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">({l2Node.count})</span>
                        </label>
                      </div>
                      {l2Open && l2Node.l3s.length > 0 && (
                        <div className="pl-6 space-y-1">
                          {l2Node.l3s.map(l3Node => (
                            <label key={l3Node.key} className="flex items-center gap-2 py-0.5 cursor-pointer">
                              <input type="checkbox" checked={selected.has(l3Node.key)} onChange={() => onToggle(l3Node.key)} className="w-3.5 h-3.5 rounded accent-amber-400 shrink-0" />
                              <span className="text-xs text-slate-500 truncate">{l3Node.l3}</span>
                              <span className="text-[10px] text-slate-400 shrink-0">({l3Node.count})</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {selected.size > 0 && (
        <button type="button" onClick={onClear} className="text-xs font-bold text-slate-400 hover:text-rose-500 transition">清除篩選（已選{selected.size}項）</button>
      )}
    </div>
  );
};

export default TransactionFilterPanel;
