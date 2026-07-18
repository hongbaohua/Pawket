
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Transaction, L1Category, CATEGORY_LABELS, TransactionType, STANDARD_CATEGORIES, Account } from '../types';
import { X, Save, Tag, Store, ArrowUpCircle, ArrowDownCircle, Pencil, Plus, ChevronDown, Check, Trash2, AlertCircle, Wallet } from 'lucide-react';

interface EditTransactionModalProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  accounts?: Account[];
  customCategoryHistory?: Record<string, string[]>;
  onTagAction?: (action: 'rename' | 'delete', l1: L1Category, oldName: string, newName?: string) => void;
  onClose: () => void;
  onSave: (updatedTransaction: Transaction) => void;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
    transaction,
    allTransactions,
    accounts = [],
    customCategoryHistory = {},
    onTagAction,
    onClose,
    onSave
}) => {
  const [merchant, setMerchant] = useState(transaction.merchant);
  const [type, setType] = useState<TransactionType>(transaction.type);
  const [accountId, setAccountId] = useState<string>(transaction.accountId || accounts.find(a => !a.isArchived)?.id || '');
  const [amount, setAmount] = useState(transaction.amount);
  const [date, setDate] = useState(transaction.date);
  const [l1, setL1] = useState<L1Category>(transaction.category.l1);
  const [l2, setL2] = useState(transaction.category.l2);
  const [l3, setL3] = useState(transaction.category.l3);

  // Validation State
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [showErrorToast, setShowErrorToast] = useState(false);

  // New: Selector Expansion State
  const [isCategoryExpanded, setIsCategoryExpanded] = useState(true);
  const [isAddingL2, setIsAddingL2] = useState(false);
  const [newL2Val, setNewL2Val] = useState("");
  
  // Local session custom tags (added in this session but maybe not saved to transaction yet)
  const [sessionTags, setSessionTags] = useState<Record<string, string[]>>({});

  // Refs for scrolling to errors
  const merchantRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  // l3Ref removed from validation scrolling

  // Check if this is a "New" transaction (simple check: merchant is empty or amount is 0)
  const isNew = transaction.amount === 0 && transaction.merchant === '';

  // Generate unique merchant names for autocomplete
  const merchantSuggestions = useMemo(() => {
    const names = new Set(allTransactions.map(t => t.merchant));
    return Array.from(names).filter(name => name !== transaction.merchant).sort();
  }, [allTransactions, transaction.merchant]);

  // Generate L3 suggestions based on selected L2
  const l3Suggestions = useMemo(() => {
    const relevantTxs = allTransactions.filter(t => t.category.l2 === l2);
    const categories = new Set(relevantTxs.map(t => t.category.l3).filter(Boolean));
    return Array.from(categories).sort();
  }, [allTransactions, l2]);

  // Merge Standard, History, and Session tags
  const currentL2Options = useMemo(() => {
      const standards = STANDARD_CATEGORIES[l1] || [];
      const history = customCategoryHistory[l1] || [];
      const session = sessionTags[l1] || [];
      
      const combined = Array.from(new Set([...standards, ...history, ...session]));
      
      return combined.map(tag => ({
          name: tag,
          isCustom: !standards.includes(tag)
      }));
  }, [l1, customCategoryHistory, sessionTags]);

  // Logic to handle L2 selection with Income Auto-fill
  const handleL2Change = (newL2: string) => {
      setL2(newL2);
      if (l1 === L1Category.INCOME) {
          setMerchant(newL2);
      }
  };

  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    if (newType === 'income') {
        const incomeL1 = L1Category.INCOME;
        const defaultL2 = STANDARD_CATEGORIES[incomeL1][0];
        setL1(incomeL1);
        setL2(defaultL2);
        setMerchant(defaultL2); // Auto-fill
    } else if (l1 === L1Category.INCOME) {
        setL1(L1Category.VARIABLE); // Default back to variable if switching to expense
        setL2(STANDARD_CATEGORIES[L1Category.VARIABLE][0]);
    }
  };

  const handleAddTag = () => {
      if (!newL2Val.trim()) return;
      const tag = newL2Val.trim();
      
      setSessionTags(prev => ({
          ...prev,
          [l1]: [...(prev[l1] || []), tag]
      }));
      
      handleL2Change(tag); // Use wrapper logic
      
      setIsAddingL2(false);
      setNewL2Val("");
  };

  const handleDeleteTag = (tagName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      
      // Check if used
      const usedCount = allTransactions.filter(t => t.category.l1 === l1 && t.category.l2 === tagName).length;
      
      if (usedCount === 0) {
          // Just remove from session tags if present, UI update
          setSessionTags(prev => ({
              ...prev,
              [l1]: (prev[l1] || []).filter(t => t !== tagName)
          }));
          // If it was selected, reset selection
          if (l2 === tagName) setL2(STANDARD_CATEGORIES[l1][0]);
          return;
      }

      // Ask user
      if (window.confirm(`標籤「${tagName}」目前有 ${usedCount} 筆相關紀錄。\n\n按「確定」將刪除此標籤 (紀錄將歸類為預設分類)。\n按「取消」保留。`)) {
          if (onTagAction) {
              onTagAction('delete', l1, tagName);
              if (l2 === tagName) setL2(STANDARD_CATEGORIES[l1][0]);
          }
      }
  };

  const handleSave = () => {
    // Reset Errors
    setErrors({});
    setShowErrorToast(false);

    const newErrors: Record<string, boolean> = {};
    let hasError = false;

    // Strict Validation
    if (!merchant.trim()) { newErrors.merchant = true; hasError = true; }
    if (!date) { newErrors.date = true; hasError = true; }
    if (!amount && amount !== 0) { newErrors.amount = true; hasError = true; }
    if (amount === 0 && !isNew) {
        // If editing an existing transaction, 0 is likely an error unless intended.
        // For now, allow 0 if user insists, but check for empty/NaN
    }
    // L3 is NOW Optional (Requirement 2)
    // if (!l3 || !l3.trim()) { newErrors.l3 = true; hasError = true; }

    if (hasError) {
        setErrors(newErrors);
        setShowErrorToast(true);
        
        // Auto Scroll to first error
        if (newErrors.date && dateRef.current) dateRef.current.focus();
        else if (newErrors.amount && amountRef.current) amountRef.current.focus();
        else if (newErrors.merchant && merchantRef.current) merchantRef.current.focus();
        
        return;
    }

    onSave({
      ...transaction,
      date,
      amount: parseFloat(amount.toString()), // ensure number
      merchant,
      type,
      accountId: accountId || undefined,
      category: {
        l1,
        l2,
        l3: l3 || '' // Allow empty
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-lg w-full flex flex-col border-4 border-white max-h-[90vh] overflow-hidden relative">
        
        {/* Error Toast */}
        {showErrorToast && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-rose-500 text-white px-6 py-3 rounded-full shadow-lg z-50 flex items-center gap-2 animate-in slide-in-from-top-4 fade-in duration-300 w-max max-w-[90%]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm font-bold">請填寫：{Object.keys(errors).map(k => k === 'merchant' ? '商家名稱' : k === 'amount' ? '金額' : '日期').join('、')}</span>
            </div>
        )}

        {/* Header */}
        <div className="p-8 border-b border-amber-100 flex justify-between items-center bg-white/50 rounded-t-[36px]">
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
              <div className={`p-2.5 rounded-2xl ${isNew ? 'bg-emerald-100 text-emerald-500' : 'bg-amber-100 text-amber-500'}`}>
                  {isNew ? <Plus className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
              </div>
              {isNew ? '新增交易' : '編輯明細'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-8 space-y-6 overflow-y-auto scrollbar-thin scrollbar-thumb-amber-200">
          
          {/* Top Controls: Type & Source */}
          <div className="flex flex-col gap-2">
              {/* Type Selector */}
              <div className="flex p-1.5 bg-white rounded-2xl border border-slate-100">
                <button 
                  onClick={() => handleTypeChange('expense')}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${type === 'expense' ? 'bg-rose-50 text-rose-500 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                >
                    <ArrowDownCircle className="w-4 h-4" /> 支出
                </button>
                <button 
                  onClick={() => handleTypeChange('income')}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${type === 'income' ? 'bg-emerald-50 text-emerald-500 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                >
                    <ArrowUpCircle className="w-4 h-4" /> 收入
                </button>
              </div>

              {/* Account Selector：取代舊的「金融卡/帳戶 vs 現金」二選一 */}
              {accounts.length > 0 && (
                <div className="relative">
                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                  <select
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-100 text-slate-600 outline-none focus:border-amber-300"
                  >
                    {accounts.filter(a => !a.isArchived).map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
          </div>

          {/* Date & Amount Row */}
          <div className="flex gap-4">
             <div className="flex-1 space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
                   日期
                </label>
                <input 
                   ref={dateRef}
                   type="date"
                   value={date}
                   onChange={e => setDate(e.target.value)}
                   className={`w-full p-4 bg-white border rounded-2xl font-bold text-slate-700 transition outline-none shadow-sm ${errors.date ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200 focus:border-amber-300 focus:ring-4 focus:ring-amber-50'}`}
                />
             </div>
             <div className="flex-1 space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
                   金額
                </label>
                <input 
                   ref={amountRef}
                   type="number"
                   value={amount}
                   onChange={e => setAmount(parseFloat(e.target.value))}
                   className={`w-full p-4 bg-white border rounded-2xl font-bold text-slate-700 transition outline-none shadow-sm ${errors.amount ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200 focus:border-amber-300 focus:ring-4 focus:ring-amber-50'}`}
                />
             </div>
          </div>

          {/* Merchant Field with Autocomplete */}
          <div className="space-y-2 relative">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
              <Store className="w-3 h-3" /> 商家名稱
            </label>
            <input
              ref={merchantRef}
              type="text"
              list="merchant-suggestions"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className={`w-full p-4 bg-white border rounded-2xl font-bold text-slate-700 transition outline-none shadow-sm ${errors.merchant ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200 focus:border-amber-300 focus:ring-4 focus:ring-amber-50'}`}
              placeholder="輸入或選擇商家..."
            />
            <datalist id="merchant-suggestions">
               {merchantSuggestions.map((name, idx) => (
                   <option key={idx} value={name} />
               ))}
            </datalist>
          </div>

          {/* New Hierarchical Category Selector */}
          <div className="p-6 bg-white rounded-3xl border border-slate-100 space-y-4 shadow-sm">
            <div 
                className="flex justify-between items-center cursor-pointer"
                onClick={() => setIsCategoryExpanded(!isCategoryExpanded)}
            >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Tag className="w-3 h-3" /> 分類歸屬
                </p>
                <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isCategoryExpanded ? 'rotate-180' : ''}`} />
            </div>

            {isCategoryExpanded && (
                <div className="space-y-4 animate-in slide-in-from-top-2">
                    {/* L1 Tabs */}
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                        {Object.values(L1Category).map(cat => (
                            <button
                                key={cat}
                                onClick={() => {
                                    setL1(cat);
                                    // Reset L2 to default of new L1 to avoid invalid state
                                    const defaultL2 = STANDARD_CATEGORIES[cat]?.[0] || '';
                                    setL2(defaultL2);
                                    if (cat === L1Category.INCOME) {
                                        setMerchant(defaultL2);
                                    }
                                }}
                                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                                    l1 === cat 
                                    ? 'bg-amber-400 text-white shadow-md' 
                                    : 'bg-slate-50 text-slate-500 hover:bg-amber-50 hover:text-amber-500'
                                }`}
                            >
                                {CATEGORY_LABELS[cat]}
                            </button>
                        ))}
                    </div>

                    {/* L2 Options Grid */}
                    <div>
                        <p className="text-[10px] font-bold text-slate-300 mb-2 ml-1">選擇子分類</p>
                        <div className="flex flex-wrap gap-2">
                            {currentL2Options.map(option => (
                                <button
                                    key={option.name}
                                    onClick={() => handleL2Change(option.name)}
                                    className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all relative group/item pr-8 ${
                                        l2 === option.name 
                                        ? 'border-amber-400 bg-amber-50 text-amber-600' 
                                        : 'border-slate-50 bg-white text-slate-600 hover:border-amber-200'
                                    }`}
                                >
                                    {option.name}
                                    {option.isCustom && (
                                        <div 
                                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-rose-500 rounded-full hover:bg-rose-50 transition"
                                            onClick={(e) => handleDeleteTag(option.name, e)}
                                            title="刪除此自訂標籤"
                                        >
                                            <X className="w-3 h-3" />
                                        </div>
                                    )}
                                </button>
                            ))}
                            {/* Custom Logic */}
                            {isAddingL2 ? (
                                <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                                    <input
                                        autoFocus
                                        value={newL2Val}
                                        onChange={(e) => setNewL2Val(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddTag();
                                        }}
                                        className="px-3 py-2 rounded-xl text-sm font-bold border-2 border-amber-300 outline-none w-32 bg-white text-slate-700 shadow-inner"
                                        placeholder="輸入..."
                                    />
                                    <button 
                                        onClick={handleAddTag}
                                        className="p-2 bg-amber-400 text-white rounded-xl shadow-md hover:bg-amber-500 active:scale-95 transition"
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsAddingL2(true)}
                                    className="px-3 py-2 rounded-xl text-sm font-bold border-2 border-dashed border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 flex items-center gap-1 hover:bg-slate-50 transition"
                                >
                                    <Plus className="w-4 h-4" /> 自訂
                                </button>
                            )}
                        </div>
                    </div>

                    {/* L3 Input (Optional) */}
                    <div>
                        <p className="text-[10px] font-bold mb-2 ml-1 text-slate-300 flex items-center gap-1">
                            備註 / 細項 (選填)
                        </p>
                        <input
                            type="text"
                            list="l3-suggestions"
                            value={l3}
                            onChange={(e) => setL3(e.target.value)}
                            placeholder="例如：午餐、拿鐵..."
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-600 transition outline-none placeholder:font-normal placeholder:text-slate-300 focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
                        />
                        <datalist id="l3-suggestions">
                            {l3Suggestions.map((item, idx) => (
                                <option key={idx} value={item} />
                            ))}
                        </datalist>
                    </div>
                </div>
            )}
            
            {!isCategoryExpanded && (
                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-sm font-bold">{CATEGORY_LABELS[l1]}</span>
                    <span className="text-slate-300">/</span>
                    <span className="font-bold text-slate-700">{l2}</span>
                </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-amber-100 bg-white/50 rounded-b-[36px] flex justify-end gap-3">
           <button 
             onClick={onClose}
             className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition"
           >
             取消
           </button>
           <button 
             onClick={handleSave} 
             className={`px-8 py-3 rounded-2xl font-bold text-white shadow-lg transform transition active:scale-95 flex items-center gap-2 ${isNew ? 'bg-emerald-400 hover:bg-emerald-500 hover:shadow-emerald-200' : 'bg-amber-400 hover:bg-amber-500 hover:shadow-amber-200'}`}
           >
             {isNew ? <Plus className="w-5 h-5" /> : <Save className="w-4 h-4" />}
             {isNew ? '新增' : '保存'}
           </button>
        </div>
      </div>
    </div>
  );
};

export default EditTransactionModal;
