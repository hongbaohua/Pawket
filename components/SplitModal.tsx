
import React, { useState, useMemo } from 'react';
import { Transaction, L1Category, CATEGORY_LABELS, STANDARD_CATEGORIES } from '../types';
import { X, Plus, Trash2, Divide, Cat, ChevronRight, Info } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface SplitModalProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  onClose: () => void;
  onSave: (newTransactions: Transaction[]) => void;
}

const SplitModal: React.FC<SplitModalProps> = ({ transaction, allTransactions, onClose, onSave }) => {
  // Determine if we are re-editing an existing split
  const isEditingSplit = transaction.isSplit && !!transaction.parentId;
  
  // Calculate the total original amount before any splits
  const originalAmount = useMemo(() => {
    if (isEditingSplit) {
      return allTransactions
        .filter(t => t.parentId === transaction.parentId)
        .reduce((sum, t) => sum + t.amount, 0);
    }
    return transaction.amount;
  }, [transaction, allTransactions, isEditingSplit]);

  // Initializing state: either from siblings if editing, or from single transaction if starting fresh
  const initialSplits = useMemo(() => {
    if (isEditingSplit) {
      const siblings = allTransactions.filter(t => t.parentId === transaction.parentId);
      // Sort so '主項目' is at index 0
      const sorted = [...siblings].sort((a, b) => {
        if (a.category.l3 === '主項目') return -1;
        if (b.category.l3 === '主項目') return 1;
        return 0;
      });
      return sorted.map((s, idx) => ({
        id: s.id,
        amount: s.amount,
        description: s.category.l3 === '主項目' ? '' : s.merchant,
        l1: s.category.l1,
        l2: s.category.l2
      }));
    }
    // New split initialization：如果這筆交易已經填過品項清單，直接把每個品項變成一筆
    // 子項目分配，不用再手動打一次名稱/金額——2026-09-14 Ivy反應「填完項目、選擇要
    // 分裝時，應該直接顯示目前填好的子項目列表」。分類歸屬先預設跟主交易一樣，方便
    // 後面用下面的批次勾選一次改掉一批（例如水電瓦斯三筆用同一個分類），不用逐筆選。
    const itemSplits = (transaction.items || []).map(item => ({
      id: uuidv4(),
      amount: item.unitPrice != null ? item.unitPrice * (item.quantity || 1) : 0,
      description: item.name,
      l1: transaction.category.l1,
      l2: transaction.category.l2
    }));
    return [
      {
        id: uuidv4(),
        amount: transaction.amount,
        description: '',
        l1: transaction.category.l1,
        l2: transaction.category.l2
      },
      ...itemSplits
    ];
  }, [transaction, allTransactions, isEditingSplit]);

  const [splits, setSplits] = useState(initialSplits);
  // 多選批次設定分類：勾選多個子項目後一次套用同一個分類歸屬/子分類，不用逐筆點選單。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkL1, setBulkL1] = useState<L1Category>(transaction.category.l1);
  const [bulkL2, setBulkL2] = useState<string>(transaction.category.l2);

  const subItems = useMemo(() => splits.slice(1), [splits]);
  const totalSubAmount = useMemo(() => subItems.reduce((acc, curr) => acc + (isNaN(curr.amount) ? 0 : curr.amount), 0), [subItems]);

  const remainingForMain = originalAmount - totalSubAmount;
  const isOverAssigned = remainingForMain < -0.01;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === subItems.length ? new Set() : new Set(subItems.map(s => s.id)));
  };

  const applyBulkCategory = () => {
    setSplits(prev => prev.map(s => selectedIds.has(s.id) ? { ...s, l1: bulkL1, l2: bulkL2 } : s));
    setSelectedIds(new Set());
  };

  const addSplit = () => {
    const defaultL1 = transaction.type === 'income' ? L1Category.INCOME : L1Category.VARIABLE;
    setSplits([
      ...splits, 
      { 
        id: uuidv4(), 
        amount: 0, 
        description: '', 
        l1: defaultL1, 
        l2: STANDARD_CATEGORIES[defaultL1][0] 
      }
    ]);
  };

  const removeSplit = (id: string) => {
    if (splits.length > 1) {
      setSplits(splits.filter(s => s.id !== id));
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const updateSplit = (id: string, field: string, value: any) => {
    setSplits(prev => prev.map(s => {
      if (s.id !== id) return s;
      const updated = { ...s, [field]: value };
      if (field === 'l1') {
        updated.l2 = STANDARD_CATEGORIES[value as L1Category][0];
      }
      return updated;
    }));
  };

  const handleSave = () => {
    if (isOverAssigned) return;
    // 2026-08-13：分裝拆帳一定是在改動既有交易的結構（不是新增），存檔前要二次確認。
    if (!window.confirm('確定要套用這樣的分裝拆帳嗎？原本這筆會被拆成上面設定的幾筆子項目。')) return;

    // Maintain the same parentId if we are re-editing
    const commonParentId = transaction.parentId || transaction.id;

    const finalSplits = splits.map((s, index) => {
      const finalAmount = index === 0 ? remainingForMain : parseFloat(s.amount.toString());
      // For re-edit, we might want to keep the same IDs for matching rows, 
      // but regenerating unique IDs for the split cluster is safer in this app's logic
      return {
        ...transaction,
        id: uuidv4(),
        parentId: commonParentId,
        isSplit: true,
        amount: finalAmount,
        // The main item ALWAYS uses the original merchant name from the anchor transaction
        merchant: index === 0 ? (isEditingSplit ? (allTransactions.find(t => t.id === commonParentId)?.merchant || transaction.merchant) : transaction.merchant) : (s.description || `子項目 ${index}`),
        // 原始交易的備註/品項清單/折扣明細/特殊標記是算在「整筆」金額上的，拆開後對單一子項目已經沒有意義，不繼承
        note: undefined,
        items: undefined,
        grossAmount: undefined,
        discounts: undefined,
        specialTag: undefined,
        type: s.l1 === L1Category.INCOME ? 'income' : 'expense',
        category: {
          l1: s.l1,
          l2: s.l2 || '一般',
          l3: index === 0 ? '主項目' : '分裝項目'
        }
      };
    }); 

    onSave(finalSplits);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[48px] shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col border-4 border-white relative overflow-hidden">
        
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
             <Cat className="w-32 h-32 text-slate-900" />
        </div>

        <div className="p-8 border-b border-amber-100 flex justify-between items-center bg-white/50 backdrop-blur">
          <h3 className="text-2xl font-extrabold text-slate-700 flex items-center gap-3">
              <div className="p-2 bg-purple-100 text-purple-500 rounded-2xl">
                  <Divide className="w-6 h-6" />
              </div>
              貓咪零食分裝盤 {isEditingSplit && "(編輯中)"}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-amber-200">
          <div className="mb-8 bg-white border border-amber-100 p-6 rounded-[30px] flex justify-between items-center shadow-sm">
            <div>
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">原始交易商家與總量</p>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-extrabold text-slate-600">
                  {isEditingSplit ? (allTransactions.find(t => t.id === transaction.parentId)?.merchant || transaction.merchant) : transaction.merchant}
                </span>
                <span className="text-3xl font-black text-amber-500">${originalAmount.toFixed(2)}</span>
              </div>
            </div>
            <div className={`text-right ${isOverAssigned ? 'text-rose-500' : 'text-emerald-500'}`}>
              <p className="text-xs uppercase font-bold tracking-wider mb-1">剩餘可分配額 (主項目歸屬)</p>
              <p className="text-2xl font-mono font-bold">${remainingForMain.toFixed(2)}</p>
              {isOverAssigned && <p className="text-[10px] font-bold animate-pulse mt-1">⚠️ 分配金額超過總量！</p>}
            </div>
          </div>

          {subItems.length > 0 && (
            <div className="mb-6 p-5 bg-purple-50 border border-purple-100 rounded-[28px] space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-bold text-purple-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === subItems.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-purple-500"
                  />
                  全選子項目（共 {subItems.length} 項）
                </label>
                {selectedIds.size > 0 && <span className="text-[11px] font-bold text-purple-500">已勾選 {selectedIds.size} 項</span>}
              </div>
              {selectedIds.size > 0 && (
                <div className="flex flex-wrap gap-2 items-center animate-in slide-in-from-top-1">
                  <select
                    value={bulkL1}
                    onChange={(e) => { const v = e.target.value as L1Category; setBulkL1(v); setBulkL2(STANDARD_CATEGORIES[v][0]); }}
                    className="text-xs border border-purple-200 rounded-xl py-2 px-3 font-bold outline-none bg-white text-slate-600"
                  >
                    {Object.values(L1Category).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <select
                    value={bulkL2}
                    onChange={(e) => setBulkL2(e.target.value)}
                    className="text-xs border border-purple-200 rounded-xl py-2 px-3 font-bold outline-none bg-white text-slate-600"
                  >
                    {(STANDARD_CATEGORIES[bulkL1] || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <button type="button" onClick={applyBulkCategory} className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-xs font-bold transition">
                    套用到已勾選項目
                  </button>
                </div>
              )}
              <p className="text-[10px] text-purple-400">勾選多個子項目，一次套用同一個分類，不用逐筆選。</p>
            </div>
          )}

          <div className="space-y-4">
            {splits.map((split, idx) => {
              const isMain = idx === 0;
              const displayAmount = isMain ? remainingForMain : split.amount;

              return (
                <div key={split.id} className={`flex flex-col gap-4 p-6 border-2 rounded-[32px] transition group relative ${isMain ? 'bg-amber-50/50 border-amber-100 shadow-inner' : selectedIds.has(split.id) ? 'bg-purple-50/70 border-purple-200 shadow-sm' : 'bg-white border-white shadow-sm hover:border-purple-200'}`}>

                  <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        {!isMain && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(split.id)}
                            onChange={() => toggleSelect(split.id)}
                            className="w-4 h-4 accent-purple-500"
                          />
                        )}
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isMain ? 'bg-amber-200 text-amber-700' : 'bg-purple-100 text-purple-600'}`}>
                            {isMain ? "主項目 (自動計算餘額)" : `分裝項目 #${idx}`}
                        </span>
                        {isMain && <Info className="w-3 h-3 text-amber-400" title="主項目金額由總量減去子項目自動得出" />}
                      </div>
                      {!isMain && (
                          <button
                              onClick={() => removeSplit(split.id)}
                              className="p-1.5 text-slate-300 hover:text-rose-400 hover:bg-rose-50 rounded-lg transition"
                          >
                              <Trash2 className="w-4 h-4" />
                          </button>
                      )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                      <div className="md:col-span-4">
                          <label className="text-[10px] font-bold text-slate-400 mb-1.5 block uppercase ml-1">項目名稱</label>
                          <input 
                              type="text" 
                              disabled={isMain}
                              placeholder={isMain ? (isEditingSplit ? (allTransactions.find(t => t.id === transaction.parentId)?.merchant || transaction.merchant) : transaction.merchant) : "例如：午餐、拿鐵..."}
                              value={split.description}
                              onChange={(e) => updateSplit(split.id, 'description', e.target.value)}
                              className={`w-full text-sm rounded-xl px-4 py-3 border outline-none font-bold transition-colors ${isMain ? 'bg-amber-100/50 border-amber-200 text-amber-800 cursor-not-allowed' : 'bg-slate-50 border-slate-100 focus:border-purple-300 text-slate-700'}`}
                          />
                      </div>

                      <div className="md:col-span-3">
                         <label className="text-[10px] font-bold text-slate-400 mb-1.5 block uppercase ml-1">分類歸屬</label>
                         <select 
                           value={split.l1} 
                           onChange={(e) => updateSplit(split.id, 'l1', e.target.value)}
                           className={`w-full text-xs border rounded-xl py-3 px-3 font-bold outline-none cursor-pointer transition-colors ${isMain ? 'bg-amber-100/50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100'}`}
                         >
                             {Object.values(L1Category).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                         </select>
                      </div>

                      <div className="md:col-span-3">
                         <label className="text-[10px] font-bold text-slate-400 mb-1.5 block uppercase ml-1">子分類</label>
                         <div className="relative">
                             <select 
                               value={split.l2} 
                               onChange={(e) => updateSplit(split.id, 'l2', e.target.value)}
                               className={`w-full text-xs border rounded-xl py-3 px-3 font-bold outline-none cursor-pointer transition-colors appearance-none pr-8 ${isMain ? 'bg-amber-100/50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100'}`}
                             >
                                 {(STANDARD_CATEGORIES[split.l1] || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                             </select>
                             <ChevronRight className="w-3 h-3 text-slate-300 absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
                         </div>
                      </div>

                      <div className="md:col-span-2">
                          <label className="text-[10px] font-bold text-slate-400 mb-1.5 block uppercase ml-1">金額</label>
                          <input 
                              type="number" 
                              disabled={isMain}
                              value={displayAmount}
                              onChange={(e) => !isMain && updateSplit(split.id, 'amount', parseFloat(e.target.value))}
                              onFocus={e => e.target.select()}
                              className={`w-full text-right font-mono outline-none rounded-xl px-4 py-3 border font-bold transition-colors text-base ${isMain ? 'bg-amber-100 border-amber-200 text-amber-900 cursor-not-allowed shadow-inner' : 'bg-slate-50 border-slate-100 focus:border-purple-300 text-slate-800'}`}
                          />
                      </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={addSplit} className="mt-6 w-full py-5 border-2 border-dashed border-purple-200 rounded-[32px] text-purple-400 font-bold hover:bg-purple-50 transition flex justify-center items-center gap-2 group">
            <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" /> 
            新增子項目分配
          </button>
        </div>

        <div className="p-8 border-t border-amber-100 bg-white/50 rounded-b-[44px] flex justify-end">
           <button 
             onClick={handleSave} 
             disabled={isOverAssigned}
             className={`px-10 py-4 rounded-2xl font-bold text-white shadow-lg transform transition active:scale-95 text-lg flex items-center gap-2 ${!isOverAssigned ? 'bg-purple-500 hover:bg-purple-600 hover:shadow-purple-200' : 'bg-slate-300 cursor-not-allowed shadow-none'}`}
           >
             <Cat className="w-5 h-5" />
             {isEditingSplit ? "更新分裝數據" : "完成分裝入帳"}
           </button>
        </div>
      </div>
    </div>
  );
};

export default SplitModal;
