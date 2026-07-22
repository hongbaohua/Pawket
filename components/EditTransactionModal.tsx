
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Transaction, L1Category, CATEGORY_LABELS, TransactionType, STANDARD_CATEGORIES, Account, Discount, SpecialTag, TransactionItem } from '../types';
import { X, Save, Tag, Store, ArrowUpCircle, ArrowDownCircle, Pencil, Plus, ChevronDown, ChevronLeft, ChevronRight, Check, Trash2, AlertCircle, Wallet, Receipt, StickyNote, ShoppingBag, UserCheck, CreditCard, Calculator, Divide } from 'lucide-react';

// 2026-07-22 Ivy反應金額欄位太死板：原價/折扣/代購費/匯率/進位規則每家代購都不一樣，
// 原本用Excel試算表可以直接打公式，現在被拆成好幾個獨立欄位反而更亂。
// 讓金額欄位可以直接打算式(例如 280*0.93*0.85+50、ceil(280*0.93))，
// 失焦時自動算成數字，不用把每個計算因素都拆成單獨欄位——想怎麼算都可以，跟Excel一樣。
const evalMathExpression = (expr: string): number | null => {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  let jsExpr = trimmed;
  ['round', 'ceil', 'floor'].forEach(fn => {
    jsExpr = jsExpr.replace(new RegExp(`\\b${fn}\\s*\\(`, 'g'), `Math.${fn}(`);
  });
  // 白名單檢查：把允許的Math.xxx函式名拿掉之後，剩下的字元只能是數字/運算子/括號/逗號，
  // 防止使用者(或萬一被塞入的內容)夾帶任意程式碼。
  const stripped = jsExpr.replace(/Math\.(round|ceil|floor)/g, '');
  if (!/^[0-9+\-*/().,\s]+$/.test(stripped)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${jsExpr});`)();
    return typeof result === 'number' && isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

// 金額輸入框：平常顯示/儲存都是數字，但輸入中允許暫時打算式文字，失焦才計算成數字。
// 算式看不懂/算不出來就還原成上一個有效數字，不會讓表單卡在一個奇怪的字串狀態。
const CalcInput = React.forwardRef<HTMLInputElement, {
  value: number | undefined;
  onCommit: (n: number) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
}>(({ value, onCommit, className, placeholder, readOnly }, ref) => {
  const [draft, setDraft] = useState(value != null ? String(value) : '');
  useEffect(() => { setDraft(value != null ? String(value) : ''); }, [value]);
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      readOnly={readOnly}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const result = evalMathExpression(draft);
        if (result != null) {
          const rounded = Math.round(result * 100) / 100;
          onCommit(rounded);
          setDraft(String(rounded));
        } else {
          setDraft(value != null ? String(value) : '');
        }
      }}
      className={className}
      placeholder={placeholder}
    />
  );
});

interface EditTransactionModalProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  accounts?: Account[];
  customCategoryHistory?: Record<string, string[]>;
  onTagAction?: (action: 'rename' | 'delete', l1: L1Category, oldName: string, newName?: string) => void;
  onClose: () => void;
  onSave: (updatedTransaction: Transaction, options?: { openSplitAfter?: boolean }) => void;
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
  const [note, setNote] = useState(transaction.note || '');
  const [type, setType] = useState<TransactionType>(transaction.type);
  const [accountId, setAccountId] = useState<string>(transaction.accountId || accounts.find(a => !a.isArchived)?.id || '');
  const [paymentChannel, setPaymentChannel] = useState(transaction.paymentChannel || '');
  const [amount, setAmount] = useState(transaction.amount);
  const [date, setDate] = useState(transaction.date);
  const [l1, setL1] = useState<L1Category>(transaction.category.l1);
  const [l2, setL2] = useState(transaction.category.l2);
  const [l3, setL3] = useState(transaction.category.l3);

  // 金額拆分（原始金額／折扣明細／實付金額）：預設收合，展開後實付金額改成自動計算
  const [showBreakdown, setShowBreakdown] = useState(!!transaction.discounts && transaction.discounts.length > 0);
  const [grossAmount, setGrossAmount] = useState<number>(transaction.grossAmount ?? transaction.amount);
  const [discounts, setDiscounts] = useState<Discount[]>(transaction.discounts || []);

  // 展開折扣明細時，實付金額自動 = 原始金額 - Σ折扣，並同步回主要的 amount 欄位
  useEffect(() => {
    if (!showBreakdown) return;
    const discountSum = discounts.reduce((sum, d) => sum + (isNaN(d.amount) ? 0 : d.amount), 0);
    setAmount(parseFloat((grossAmount - discountSum).toFixed(2)));
  }, [showBreakdown, grossAmount, discounts]);

  const addDiscountRow = () => setDiscounts(prev => [...prev, { label: '', amount: 0 }]);
  const updateDiscountRow = (idx: number, field: 'label' | 'amount', value: string) => {
    setDiscounts(prev => prev.map((d, i) => i === idx ? { ...d, [field]: field === 'amount' ? parseFloat(value) || 0 : value } : d));
  };
  const removeDiscountRow = (idx: number) => setDiscounts(prev => prev.filter((_, i) => i !== idx));

  // 品項清單：一筆交易買了多樣商品時，結構化列出每一項（跟商家名稱、備註分開存）。
  // 單價/數量/備註預設收合，大部分品項只需要填名稱。
  const [items, setItems] = useState<TransactionItem[]>(transaction.items || []);
  const [expandedItemIdx, setExpandedItemIdx] = useState<Set<number>>(
    new Set((transaction.items || []).map((it, i) => (it.unitPrice != null ? i : -1)).filter(i => i >= 0))
  );
  const addItemRow = () => setItems(prev => [...prev, { name: '' }]);
  const updateItemField = (idx: number, field: keyof TransactionItem, value: string) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (field === 'unitPrice' || field === 'quantity') {
        return { ...it, [field]: value === '' ? undefined : parseFloat(value) || 0 };
      }
      return { ...it, [field]: value };
    }));
  };
  const removeItemRow = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const toggleItemExpanded = (idx: number) => setExpandedItemIdx(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  // 外幣試算小工具：跟折扣計算同樣的邏輯，使用者只要填「原幣金額」+「匯率」，
  // 自動算出單價(台幣)+寫進備註，不用自己按計算機算完再手動打字進來。
  // 這兩個欄位是暫時的計算輸入，不直接存進 TransactionItem，算出結果後才寫回 unitPrice/note。
  const [fxExpandedIdx, setFxExpandedIdx] = useState<Set<number>>(new Set());
  const [fxInputs, setFxInputs] = useState<Record<number, { amount: string; rate: string }>>({});
  const toggleFxExpanded = (idx: number) => setFxExpandedIdx(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const updateFxInput = (idx: number, field: 'amount' | 'rate', value: string) => {
    const current = fxInputs[idx] || { amount: '', rate: '' };
    const nextInput = { ...current, [field]: value };
    setFxInputs(prev => ({ ...prev, [idx]: nextInput }));
    const amountNum = parseFloat(nextInput.amount);
    const rateNum = parseFloat(nextInput.rate);
    if (!isNaN(amountNum) && !isNaN(rateNum)) {
      const converted = Math.round(amountNum * rateNum * 100) / 100;
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: converted, note: `原幣$${amountNum} × 匯率${rateNum}` } : it));
    }
  };

  // 特殊標記：代購／工作代墊。輕量標記＋顯示用，不做完整分帳計算。
  const [specialTagType, setSpecialTagType] = useState<'none' | SpecialTag['type']>(transaction.specialTag?.type || 'none');
  const [specialTagCounterparty, setSpecialTagCounterparty] = useState(transaction.specialTag?.counterparty || '');
  const [specialTagNote, setSpecialTagNote] = useState(transaction.specialTag?.note || '');

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

  // 2026-07-22 Ivy反應手機版一次列出所有欄位很容易漏填，改成分4步驟：
  // 1.日期/店家/收支/通道/帳戶 2.性質/品項/金額 3.分類(自動推薦)+分裝詢問 4.備註。
  // 只有「新增」才走分步驟(編輯已有資料不需要)，桌機版維持一次全部顯示(不受此狀態影響)。
  const [currentStep, setCurrentStep] = useState(1);
  const [wantsSplitAfterSave, setWantsSplitAfterSave] = useState(false);

  // Generate unique merchant names for autocomplete
  const merchantSuggestions = useMemo(() => {
    const names = new Set(allTransactions.map(t => t.merchant));
    return Array.from(names).filter(name => name !== transaction.merchant).sort();
  }, [allTransactions, transaction.merchant]);

  // 商家歷史推薦：同一個商家過去最常用的帳戶/付款通道/分類，選好商家後自動帶出，
  // 使用者接下來的步驟還是可以手動調整，不會被鎖死。
  const merchantDefaults = useMemo(() => {
    const counts: Record<string, { accountId: Record<string, number>; paymentChannel: Record<string, number>; l1: Record<string, number>; l2: Record<string, number> }> = {};
    allTransactions.forEach(t => {
      if (!t.merchant) return;
      if (!counts[t.merchant]) counts[t.merchant] = { accountId: {}, paymentChannel: {}, l1: {}, l2: {} };
      if (t.accountId) counts[t.merchant].accountId[t.accountId] = (counts[t.merchant].accountId[t.accountId] || 0) + 1;
      if (t.paymentChannel) counts[t.merchant].paymentChannel[t.paymentChannel] = (counts[t.merchant].paymentChannel[t.paymentChannel] || 0) + 1;
      counts[t.merchant].l1[t.category.l1] = (counts[t.merchant].l1[t.category.l1] || 0) + 1;
      if (t.category.l2) counts[t.merchant].l2[t.category.l2] = (counts[t.merchant].l2[t.category.l2] || 0) + 1;
    });
    const pickTop = (rec: Record<string, number>): string | undefined => {
      const entries = Object.entries(rec);
      return entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : undefined;
    };
    const result: Record<string, { accountId?: string; paymentChannel?: string; l1?: L1Category; l2?: string }> = {};
    Object.entries(counts).forEach(([merchantName, data]) => {
      result[merchantName] = {
        accountId: pickTop(data.accountId),
        paymentChannel: pickTop(data.paymentChannel),
        l1: pickTop(data.l1) as L1Category | undefined,
        l2: pickTop(data.l2),
      };
    });
    return result;
  }, [allTransactions]);

  const handleMerchantBlur = () => {
    if (!isNew) return; // 只在新增時自動推薦，編輯既有資料不要打亂使用者已經填好的東西
    const defaults = merchantDefaults[merchant];
    if (!defaults) return;
    if (defaults.accountId && accounts.some(a => a.id === defaults.accountId && !a.isArchived)) setAccountId(defaults.accountId);
    if (defaults.paymentChannel) setPaymentChannel(defaults.paymentChannel);
    if (defaults.l1) setL1(defaults.l1);
    if (defaults.l2) setL2(defaults.l2);
  };

  // 2026-07-22 Ivy要求把填寫順序倒過來：先選付款通道(VISA/LINE Pay/方便付這種)，
  // 帳戶自動帶出來，使用者要改銀行帳戶才手動改——因為通道比帳戶更好記/更直覺
  // （同一張卡的通道大多只會對到同一個帳戶）。建議清單改列「全部」通道
  // (不只同帳戶的)，因為這時候可能還沒選帳戶。
  const paymentChannelSuggestions = useMemo(() => {
    const channels = new Set(allTransactions.filter(t => t.paymentChannel).map(t => t.paymentChannel!));
    return Array.from(channels).sort();
  }, [allTransactions]);

  // 每個付款通道歷史上最常對應到哪個帳戶（多數決），選了通道就自動帶出對應帳戶。
  const channelToAccountId = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    allTransactions.forEach(t => {
      if (!t.paymentChannel || !t.accountId) return;
      if (!counts[t.paymentChannel]) counts[t.paymentChannel] = {};
      counts[t.paymentChannel][t.accountId] = (counts[t.paymentChannel][t.accountId] || 0) + 1;
    });
    const result: Record<string, string> = {};
    Object.entries(counts).forEach(([channel, accountCounts]) => {
      const [bestAccountId] = Object.entries(accountCounts).sort((a, b) => b[1] - a[1])[0];
      result[channel] = bestAccountId;
    });
    return result;
  }, [allTransactions]);

  const handlePaymentChannelChange = (value: string) => {
    setPaymentChannel(value);
    const knownAccountId = channelToAccountId[value];
    if (knownAccountId && accounts.some(a => a.id === knownAccountId && !a.isArchived)) {
      setAccountId(knownAccountId);
    }
  };

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
      items: items.filter(it => it.name.trim()).map(it => ({ ...it, name: it.name.trim() })).length > 0
        ? items.filter(it => it.name.trim()).map(it => ({ ...it, name: it.name.trim() }))
        : undefined,
      note: note.trim() || undefined,
      type,
      accountId: accountId || undefined,
      paymentChannel: paymentChannel.trim() || undefined,
      grossAmount: showBreakdown ? grossAmount : undefined,
      discounts: showBreakdown ? discounts.filter(d => d.label.trim() || d.amount) : undefined,
      specialTag: specialTagType !== 'none' && specialTagCounterparty.trim()
        ? { type: specialTagType, counterparty: specialTagCounterparty.trim(), note: specialTagNote.trim() || undefined }
        : undefined,
      category: {
        l1,
        l2,
        l3: l3 || '' // Allow empty
      }
    }, { openSplitAfter: isNew && wantsSplitAfterSave });
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

        {/* 手機版新增交易分4步驟的進度點：只在新增+手機版顯示，編輯/桌機版不受影響 */}
        {isNew && (
          <div className="flex items-center justify-center gap-2 pt-4 md:hidden">
            {[1, 2, 3, 4].map(step => (
              <div key={step} className={`h-1.5 rounded-full transition-all ${step === currentStep ? 'w-8 bg-amber-400' : 'w-4 bg-slate-200'}`} />
            ))}
          </div>
        )}

        {/* Body */}
        <div className="p-8 space-y-6 overflow-y-auto scrollbar-thin scrollbar-thumb-amber-200">

          {/* STEP 1：日期／店家／支出收入／付款通道／帳戶（如有過往相似紀錄，自動推薦） */}
          <div className={`${isNew && currentStep !== 1 ? 'hidden' : ''} md:block space-y-6`}>
            <div className="space-y-2">
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

            {/* Merchant Field with Autocomplete：選好商家後，失焦會自動推薦帳戶/付款通道/分類 */}
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
                onBlur={handleMerchantBlur}
                className={`w-full p-4 bg-white border rounded-2xl font-bold text-slate-700 transition outline-none shadow-sm ${errors.merchant ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200 focus:border-amber-300 focus:ring-4 focus:ring-amber-50'}`}
                placeholder="輸入或選擇商家..."
              />
              <datalist id="merchant-suggestions">
                 {merchantSuggestions.map((name, idx) => (
                     <option key={idx} value={name} />
                 ))}
              </datalist>
            </div>

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

            {/* 付款通道先填，帳戶自動帶出來（通道比帳戶更好記，同一張卡的通道大多只對應
                同一個帳戶），使用者要改銀行帳戶再手動改。 */}
            {accounts.length > 0 && (
              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                    <input
                      type="text"
                      value={paymentChannel}
                      onChange={e => handlePaymentChannelChange(e.target.value)}
                      placeholder="付款通道(選填，如VISA)"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-100 text-slate-600 outline-none focus:border-amber-300 placeholder:font-normal placeholder:text-slate-300"
                    />
                  </div>
                  {paymentChannelSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {paymentChannelSuggestions.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => handlePaymentChannelChange(paymentChannel === c ? '' : c)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${paymentChannel === c ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600'}`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative flex-1">
                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                  <select
                    value={accountId}
                    onChange={e => { setAccountId(e.target.value); setPaymentChannel(''); }}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-100 text-slate-600 outline-none focus:border-amber-300"
                  >
                    {accounts.filter(a => !a.isArchived).map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* STEP 2：性質／品項／金額（所有計算） */}
          <div className={`${isNew && currentStep !== 2 ? 'hidden' : ''} md:block space-y-6`}>
            {/* Special Tag：代購／工作代墊。輕量標記＋顯示用，不做完整分帳計算 */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
                <UserCheck className="w-3 h-3" /> 特殊性質（選填）
              </label>
              <div className="flex p-1.5 bg-white rounded-2xl border border-slate-100">
                {([
                  { key: 'none', label: '一般' },
                  { key: 'proxy_purchase', label: '代購' },
                  { key: 'work_advance', label: '工作代墊' },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSpecialTagType(opt.key)}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${specialTagType === opt.key ? 'bg-purple-50 text-purple-600 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {specialTagType !== 'none' && (
                <div className="p-4 bg-white rounded-2xl border border-slate-100 space-y-2 animate-in slide-in-from-top-2">
                  <input
                    type="text"
                    value={specialTagCounterparty}
                    onChange={(e) => setSpecialTagCounterparty(e.target.value)}
                    placeholder={specialTagType === 'proxy_purchase' ? '代購人是誰？' : '之後要跟誰報帳？'}
                    className="w-full p-3 bg-[#FFFBF5] border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-purple-300"
                  />
                  <input
                    type="text"
                    value={specialTagNote}
                    onChange={(e) => setSpecialTagNote(e.target.value)}
                    placeholder="額外說明（選填，例如：已打統編、0313批次）"
                    className="w-full p-3 bg-[#FFFBF5] border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-purple-300"
                  />
                </div>
              )}
            </div>

            {/* Items Field：這筆買了什麼，無論一項還是多項都填在這裡（跟「分裝盤」不是同一件事，
                分裝盤是把這筆錢拆到不同預算分類，這裡純粹是記錄買了什麼東西） */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
                <ShoppingBag className="w-3 h-3" /> 喵喵購物清單（選填，這筆買了什麼）
              </label>
              <p className="text-[10px] text-slate-300 ml-1 -mt-1">這裡只記錄買了什麼，不會拆分類；要把錢拆到不同預算類別請用「貓咪零食分裝盤」（明細列的分裝按鈕）</p>
              <div className="space-y-2">
                {items.map((it, idx) => {
                  const isExpanded = expandedItemIdx.has(idx);
                  const subtotal = it.unitPrice != null ? it.unitPrice * (it.quantity || 1) : null;
                  return (
                    <div key={idx} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={it.name}
                          onChange={(e) => updateItemField(idx, 'name', e.target.value)}
                          placeholder="例如：吉拿棒"
                          className="flex-1 p-2 bg-transparent text-sm font-bold text-slate-700 outline-none"
                        />
                        {subtotal != null && <span className="text-xs font-bold text-amber-500 whitespace-nowrap">${subtotal.toFixed(2)}</span>}
                        <button type="button" onClick={() => toggleItemExpanded(idx)} className={`text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${isExpanded ? 'bg-amber-100 text-amber-600' : 'text-slate-400 hover:bg-slate-100'}`}>
                          {isExpanded ? '收合單價' : '填單價'}
                        </button>
                        <button type="button" onClick={() => removeItemRow(idx)} className="p-1 text-slate-300 hover:text-rose-400 transition"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      {isExpanded && (
                        <div className="pt-2 border-t border-slate-100 animate-in slide-in-from-top-1 space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">單價(台幣，可打算式)</label>
                              <CalcInput value={it.unitPrice} onCommit={n => updateItemField(idx, 'unitPrice', String(n))} className="w-full p-2 bg-[#FFFBF5] border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-amber-300" />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">數量</label>
                              <CalcInput value={it.quantity} onCommit={n => updateItemField(idx, 'quantity', String(n))} placeholder="1" className="w-full p-2 bg-[#FFFBF5] border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-amber-300" />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">備註</label>
                              <input type="text" value={it.note ?? ''} onChange={(e) => updateItemField(idx, 'note', e.target.value)} placeholder="例如：日幣購入" className="w-full p-2 bg-[#FFFBF5] border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-amber-300" />
                            </div>
                          </div>
                          <button type="button" onClick={() => toggleFxExpanded(idx)} className={`text-[10px] font-bold px-2 py-1 rounded-lg ${fxExpandedIdx.has(idx) ? 'bg-sky-100 text-sky-600' : 'text-slate-400 hover:bg-slate-100'}`}>
                            {fxExpandedIdx.has(idx) ? '收合外幣試算' : '這項是外幣？點我試算台幣'}
                          </button>
                          {fxExpandedIdx.has(idx) && (
                            <div className="grid grid-cols-2 gap-2 p-2 bg-sky-50/50 border border-sky-100 rounded-lg animate-in slide-in-from-top-1">
                              <div>
                                <label className="text-[9px] font-bold text-sky-500 uppercase block mb-1">原幣金額</label>
                                <input type="number" value={fxInputs[idx]?.amount ?? ''} onChange={(e) => updateFxInput(idx, 'amount', e.target.value)} placeholder="例如：1000" className="w-full p-2 bg-white border border-sky-200 rounded-lg text-sm font-bold outline-none focus:border-sky-300" />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-sky-500 uppercase block mb-1">匯率</label>
                                <input type="number" step="0.01" value={fxInputs[idx]?.rate ?? ''} onChange={(e) => updateFxInput(idx, 'rate', e.target.value)} placeholder="例如：4.45" className="w-full p-2 bg-white border border-sky-200 rounded-lg text-sm font-bold outline-none focus:border-sky-300" />
                              </div>
                              <p className="col-span-2 text-[10px] text-sky-400">填好這兩格會自動算出單價(台幣)，並把換算依據寫進備註，不用自己按計算機。</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button type="button" onClick={addItemRow} className="text-xs font-bold text-slate-400 hover:text-amber-500 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> 新增品項</button>
              </div>
            </div>

            {/* Amount Field */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
                 實付金額 <Calculator className="w-3 h-3 text-slate-300" title="可以直接打算式，例如 280*0.93+50" />
              </label>
              <CalcInput
                 ref={amountRef}
                 readOnly={showBreakdown}
                 value={amount}
                 onCommit={n => setAmount(n)}
                 className={`w-full p-4 border rounded-2xl font-bold transition outline-none shadow-sm ${showBreakdown ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-700'} ${errors.amount ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200 focus:border-amber-300 focus:ring-4 focus:ring-amber-50'}`}
              />
            </div>

            {/* 金額拆分：原始金額／折扣明細 */}
            <div>
              <button
                type="button"
                onClick={() => {
                  if (!showBreakdown) setGrossAmount(amount);
                  setShowBreakdown(!showBreakdown);
                }}
                className="text-xs font-bold text-amber-500 hover:text-amber-600 flex items-center gap-1 ml-1"
              >
                <Receipt className="w-3.5 h-3.5" />
                {showBreakdown ? '收合金額拆分' : '有折扣？填寫原始金額／折扣明細'}
              </button>
              {showBreakdown && (
                <div className="mt-3 p-4 bg-white rounded-2xl border border-slate-100 space-y-3 animate-in slide-in-from-top-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">原始金額（折扣前，可以直接打算式）</label>
                    <CalcInput
                      value={grossAmount}
                      onCommit={n => setGrossAmount(n)}
                      className="w-full p-3 bg-[#FFFBF5] border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-amber-300"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block">折扣明細</label>
                    {discounts.map((d, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={d.label}
                          onChange={e => updateDiscountRow(idx, 'label', e.target.value)}
                          placeholder="例如：LINE POINT"
                          className="flex-1 p-2.5 bg-[#FFFBF5] border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-amber-300"
                        />
                        <CalcInput
                          value={d.amount}
                          onCommit={n => updateDiscountRow(idx, 'amount', String(n))}
                          placeholder="0"
                          className="w-24 p-2.5 bg-[#FFFBF5] border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-amber-300"
                        />
                        <button type="button" onClick={() => removeDiscountRow(idx)} className="p-2 text-slate-300 hover:text-rose-400 transition"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={addDiscountRow} className="text-xs font-bold text-slate-400 hover:text-amber-500 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> 新增折扣項目</button>
                  </div>
                  <p className="text-[11px] text-slate-400">實付金額 = 原始金額 − 折扣總和，自動算好，不用自己減。</p>
                </div>
              )}
            </div>
          </div>

          {/* STEP 3：分類歸屬（依照商家歷史自動推薦選好，使用者再手動調整）／詢問是否分裝拆帳 */}
          <div className={`${isNew && currentStep !== 3 ? 'hidden' : ''} md:block space-y-6`}>
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
                      {/* L1 Tabs：原本overflow-x-auto+no-scrollbar，手機版4個分類塞不下一行，
                          又把捲軸藏起來，導致「收入帳戶」完全看不到也不知道要滑——改成
                          自動換行，全部分類永遠都看得到。 */}
                      <div className="flex flex-wrap gap-2 pb-1">
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
                              細項標籤 (選填，例如：飲料、速食)
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

            {/* 詢問是否分裝拆帳：只有新增才問，儲存後如果選是，會直接接著打開分裝盤 */}
            {isNew && (
              <div className="p-4 bg-purple-50/50 border border-purple-100 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-purple-600">
                  <Divide className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-bold">這筆要不要分裝拆帳？</span>
                </div>
                <button
                  type="button"
                  onClick={() => setWantsSplitAfterSave(v => !v)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition ${wantsSplitAfterSave ? 'bg-purple-500 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}
                >
                  {wantsSplitAfterSave ? '存檔後要分裝' : '不用分裝'}
                </button>
              </div>
            )}
          </div>

          {/* STEP 4：備註 */}
          <div className={`${isNew && currentStep !== 4 ? 'hidden' : ''} md:block space-y-6`}>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 ml-1">
                <StickyNote className="w-3 h-3" /> 備註（選填）
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：名偵探柯南盲盒×2"
                className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 transition outline-none shadow-sm focus:border-amber-300 focus:ring-4 focus:ring-amber-50"
              />
            </div>
          </div>

        </div>

        {/* Footer：手機版新增交易時用「上一步/下一步」引導，最後一步跟桌機版/編輯一樣是儲存 */}
        <div className="p-6 border-t border-amber-100 bg-white/50 rounded-b-[36px] flex justify-between md:justify-end gap-3">
           <div className="flex gap-3">
             {isNew && currentStep > 1 && (
               <button
                 type="button"
                 onClick={() => setCurrentStep(s => Math.max(1, s - 1))}
                 className="md:hidden px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition flex items-center gap-1"
               >
                 <ChevronLeft className="w-4 h-4" /> 上一步
               </button>
             )}
             <button
               onClick={onClose}
               className={`${isNew && currentStep > 1 ? 'hidden md:block' : ''} px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition`}
             >
               取消
             </button>
           </div>
           {isNew && currentStep < 4 && (
             <button
               type="button"
               onClick={() => setCurrentStep(s => Math.min(4, s + 1))}
               className="md:hidden px-8 py-3 rounded-2xl font-bold text-white bg-emerald-400 hover:bg-emerald-500 shadow-lg shadow-emerald-100 transition active:scale-95 flex items-center gap-1"
             >
               下一步 <ChevronRight className="w-4 h-4" />
             </button>
           )}
           <button
             onClick={handleSave}
             className={`${isNew && currentStep < 4 ? 'hidden md:flex' : 'flex'} px-8 py-3 rounded-2xl font-bold text-white shadow-lg transform transition active:scale-95 items-center gap-2 ${isNew ? 'bg-emerald-400 hover:bg-emerald-500 hover:shadow-emerald-200' : 'bg-amber-400 hover:bg-amber-500 hover:shadow-amber-200'}`}
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
