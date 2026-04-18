
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Upload, Check, Loader2, X, Sparkles, FileText, ArrowUpCircle, ArrowDownCircle, Plus, PawPrint, ScanLine, Trash2, RotateCcw, Calendar, DollarSign, Store, Calculator, ChevronRight, Tag, History, Receipt, CornerDownRight, Coins, AlertTriangle, Divide } from 'lucide-react';
import { analyzeStatementImage } from '../services/geminiService';
import { Transaction, L1Category, TransactionType, STANDARD_CATEGORIES, CATEGORY_LABELS } from '../types';
import { applyHistoricalCategory, checkCashDuplicate } from '../services/logicService';
import { v4 as uuidv4 } from 'uuid';
import SplitModal from './SplitModal';

interface ScannerProps {
  onTransactionsAdded: (transactions: Transaction[]) => void;
  history: Transaction[]; 
}

const Scanner: React.FC<ScannerProps> = ({ onTransactionsAdded, history }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [draftTransactions, setDraftTransactions] = useState<Transaction[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [lastDeleted, setLastDeleted] = useState<{ item: Transaction, index: number } | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);
  
  const [activeSelectorId, setActiveSelectorId] = useState<string | null>(null);
  const [selectorTab, setSelectorTab] = useState<L1Category | null>(null);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagVal, setNewTagVal] = useState("");

  const [splittingDraft, setSplittingDraft] = useState<Transaction | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newTxData, setNewTxData] = useState<{
    date: string; merchant: string; amount: string; type: TransactionType;
  }>({ date: '', merchant: '', amount: '', type: 'expense' });
  const [cashDupeWarning, setCashDupeWarning] = useState(false);

  const summaries = useMemo(() => {
    const income = draftTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
    const expense = draftTransactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
    return { income, expense, net: income - expense };
  }, [draftTransactions]);

  const groupedDrafts = useMemo(() => {
      const groups: Record<string, Transaction[]> = {};
      const singles: Transaction[] = [];
      draftTransactions.forEach(t => {
          if (t.isSplit && t.parentId) {
              if (!groups[t.parentId]) groups[t.parentId] = [];
              groups[t.parentId].push(t);
          } else singles.push(t);
      });
      const result: { type: 'single' | 'group', data: Transaction | null, children?: Transaction[] }[] = [];
      const processedGroups = new Set<string>();
      draftTransactions.forEach(t => {
          const groupId = t.isSplit && t.parentId ? t.parentId : t.id;
          if (processedGroups.has(groupId)) return;
          if (groups[groupId]) {
              result.push({ type: 'group', data: null, children: groups[groupId] });
              processedGroups.add(groupId);
          } else {
              result.push({ type: 'single', data: t });
              processedGroups.add(groupId);
          }
      });
      return result;
  }, [draftTransactions]);

  const getSmartDate = () => {
    if (draftTransactions.length === 0) return new Date().toISOString().split('T')[0];
    const dateCounts: Record<string, number> = {};
    let maxCount = 0; let frequentDate = draftTransactions[0].date;
    draftTransactions.forEach(t => {
      dateCounts[t.date] = (dateCounts[t.date] || 0) + 1;
      if (dateCounts[t.date] > maxCount) { maxCount = dateCounts[t.date]; frequentDate = t.date; }
    });
    return frequentDate;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files || files.length === 0) return;
    const fileReaders: Promise<string>[] = [];
    Array.from(files).forEach(file => {
      const reader = new Promise<string>((resolve) => {
        const fr = new FileReader(); fr.onloadend = () => resolve(fr.result as string); fr.readAsDataURL(file as File);
      });
      fileReaders.push(reader);
    });
    const results = await Promise.all(fileReaders);
    setPreviews(prev => [...prev, ...results]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePreview = (index: number) => setPreviews(prev => prev.filter((_, i) => i !== index));

  const handleScan = async () => {
    if (previews.length === 0) return;
    setIsProcessing(true);
    try {
      const analysisPromises = previews.map(img => analyzeStatementImage(img));
      const resultsArray = await Promise.all(analysisPromises);
      const combinedResults = resultsArray.flat();
      const smartResults = combinedResults.map(tx => {
          const withSource = { ...tx, source_type: 'BANK_CARD' as const };
          return applyHistoricalCategory(withSource, history);
      });
      setDraftTransactions(prev => [...prev, ...smartResults]);
      setPreviews([]); 
    } catch (error) {
      console.error(error); alert("部分檔案掃描發生錯誤，請檢查圖片清晰度 😿");
    } finally { setIsProcessing(false); }
  };

  const handleUpdateDraft = (id: string, field: keyof Transaction, value: any) => {
    setDraftTransactions(prev => prev.map(t => {
       if (t.id !== id) return t;
       const updated = { ...t, [field]: value, isVerified: true };
       if (field === 'type') {
           if (value === 'income') updated.category = { ...t.category, l1: L1Category.INCOME, l2: STANDARD_CATEGORIES[L1Category.INCOME][0] };
           else if (t.category.l1 === L1Category.INCOME) updated.category = { ...t.category, l1: L1Category.VARIABLE, l2: STANDARD_CATEGORIES[L1Category.VARIABLE][0] };
       }
       return updated;
    }));
  };

  const handleCategorySelect = (id: string, l1: L1Category, l2: string) => {
      setDraftTransactions(prev => prev.map(t => {
          if (t.id !== id) return t;
          return { ...t, category: { l1, l2, l3: '' }, type: l1 === L1Category.INCOME ? 'income' : 'expense', isVerified: true };
      }));
      setActiveSelectorId(null); setIsAddingTag(false); setNewTagVal("");
  };

  const handleRemoveDraft = (id: string) => {
    const index = draftTransactions.findIndex(t => t.id === id);
    if (index === -1) return;
    const itemToDelete = draftTransactions[index];
    setLastDeleted({ item: itemToDelete, index });
    setDraftTransactions(prev => prev.filter(t => t.id !== id));
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = window.setTimeout(() => setLastDeleted(null), 3000);
  };

  const handleUndo = () => {
    if (!lastDeleted) return;
    setDraftTransactions(prev => { const newArr = [...prev]; newArr.splice(lastDeleted.index, 0, lastDeleted.item); return newArr; });
    setLastDeleted(null);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
  };

  const handleSplitSave = (splitTxs: Transaction[]) => {
    if (!splittingDraft) return;
    setDraftTransactions(prev => [...prev.filter(t => t.id !== splittingDraft.id), ...splitTxs]);
    setSplittingDraft(null);
  };

  const openAddModal = () => {
      setNewTxData({ date: getSmartDate(), merchant: '', amount: '', type: 'expense' });
      setCashDupeWarning(false); setIsAddModalOpen(true);
  };

  const checkDuplicateEffect = () => {
      if (!newTxData.date || !newTxData.amount) return;
      const dummyTx = { id: 'temp', date: newTxData.date, merchant: newTxData.merchant || 'Cash', amount: parseFloat(newTxData.amount), type: newTxData.type, category: { l1: L1Category.VARIABLE, l2: '', l3: '' }, source_type: 'CASH_MANUAL' as const, originalText: '', confidence: 1, isVerified: true, isSplit: false };
      const hasDupe = checkCashDuplicate(dummyTx, history); setCashDupeWarning(hasDupe);
  };

  const saveNewTransaction = () => {
      const amountVal = parseFloat(newTxData.amount);
      if (!newTxData.date || !newTxData.merchant || isNaN(amountVal)) { alert("請確認資料正確！"); return; }
      const l1 = newTxData.type === 'income' ? L1Category.INCOME : L1Category.VARIABLE;
      const newTx: Transaction = { id: uuidv4(), date: newTxData.date, merchant: newTxData.merchant, originalText: "Manual Entry (Cash)", amount: Math.abs(amountVal), type: newTxData.type, source_type: 'CASH_MANUAL', category: { l1: l1, l2: STANDARD_CATEGORIES[l1][0], l3: "" }, confidence: 1.0, isVerified: true, isSplit: false };
      const smartTx = applyHistoricalCategory(newTx, history);
      setDraftTransactions(prev => [...prev, smartTx]); setIsAddModalOpen(false);
  };

  const handleCommit = () => { onTransactionsAdded(draftTransactions); setDraftTransactions([]); setPreviews([]); setLastDeleted(null); };

  useEffect(() => { return () => { if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current); }; }, []);

  const renderCategorySelector = (t: Transaction) => (
    <div className="relative">
        <button
            onClick={() => {
                if (activeSelectorId === t.id) { setActiveSelectorId(null); setIsAddingTag(false); } 
                else { setActiveSelectorId(t.id); setSelectorTab(t.category.l1); }
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors border max-w-[200px] truncate ${
                t.category.l1 === L1Category.INCOME ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                t.category.l1 === L1Category.FIXED ? 'bg-indigo-100 text-indigo-700 border-indigo-200' :
                t.category.l1 === L1Category.INVESTMENT ? 'bg-purple-100 text-purple-700 border-purple-200' :
                'bg-amber-100 text-amber-700 border-amber-200'
            }`}
        >
            <Tag className="w-3 h-3 shrink-0" />
            <span className="truncate">{t.category.l2 || '未分類'}{t.category.l3 && <span className="opacity-70 ml-1 font-normal">/ {t.category.l3}</span>}</span>
            <ChevronRight className={`w-3 h-3 transition-transform shrink-0 ${activeSelectorId === t.id ? 'rotate-90' : ''}`} />
        </button>
        {activeSelectorId === t.id && (
            <>
            <div className="fixed inset-0 z-40" onClick={() => setActiveSelectorId(null)}></div>
            <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border-2 border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[300px]">
                <div className="flex bg-slate-50 border-b border-slate-100 p-1 gap-1 overflow-x-auto no-scrollbar">
                    {Object.values(L1Category).map(cat => (
                        <button key={cat} onClick={() => { setSelectorTab(cat); setIsAddingTag(false); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-colors ${selectorTab === cat ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{CATEGORY_LABELS[cat]}</button>
                    ))}
                </div>
                <div className="p-2 overflow-y-auto bg-[#FFFBF5]">
                    {selectorTab && STANDARD_CATEGORIES[selectorTab] && (
                        <div className="mb-2 last:mb-0">
                            <p className="text-[10px] font-bold text-slate-300 mb-1 ml-1 uppercase">{CATEGORY_LABELS[selectorTab]}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {STANDARD_CATEGORIES[selectorTab].map(option => (
                                    <button key={option} onClick={() => handleCategorySelect(t.id, selectorTab, option)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${t.category.l2 === option && t.category.l1 === selectorTab ? 'bg-amber-400 text-white border-amber-400 shadow-md transform scale-105' : 'bg-white text-slate-600 border-slate-100 hover:border-amber-200 hover:text-amber-600'}`}>{option}</button>
                                ))}
                                {isAddingTag ? (
                                    <div className="flex items-center gap-1"><input autoFocus value={newTagVal} onChange={(e) => setNewTagVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newTagVal.trim()) handleCategorySelect(t.id, selectorTab, newTagVal.trim()); }} placeholder="輸入..." className="px-2 py-1.5 rounded-lg text-xs font-bold border border-amber-300 outline-none w-20 shadow-inner bg-white text-slate-700" /><button onClick={() => { if (newTagVal.trim()) handleCategorySelect(t.id, selectorTab, newTagVal.trim()); setIsAddingTag(false); setNewTagVal(""); }} className="p-1.5 bg-amber-400 text-white rounded-lg hover:bg-amber-50 shadow-sm"><Check className="w-3 h-3" /></button></div>
                                ) : (
                                    <button onClick={() => setIsAddingTag(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-dashed border-slate-300 text-slate-400 hover:text-slate-600 hover:border-slate-400 flex items-center gap-1 hover:bg-white"><Plus className="w-3 h-3" /> 新增</button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            </>
        )}
    </div>
  );

  return (
    <div className="relative">
    <div className="p-4 md:p-8 bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 min-h-[600px] flex flex-col">
      <h2 className="text-2xl font-extrabold text-slate-700 mb-6 flex items-center gap-3">
        <div className="p-3 bg-amber-100 rounded-2xl text-amber-500"><ScanLine className="w-6 h-6" /></div>
        餵食帳單 (OCR)
      </h2>
      <div className="mb-4">
        {previews.length === 0 && draftTransactions.length === 0 ? (
            <div className="border-4 border-dashed border-amber-100 rounded-[40px] p-16 flex flex-col items-center justify-center cursor-pointer hover:bg-orange-50/30 hover:border-amber-200 transition duration-300 group bg-[#FFFBF5]" onClick={() => fileInputRef.current?.click()}>
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform group-hover:rotate-12"><Upload className="w-10 h-10 text-amber-400" /></div>
            <p className="text-xl text-slate-600 font-extrabold">點擊餵食對帳單或收據</p><p className="text-sm text-slate-400 mt-2 text-center font-medium">Meowney 會幫你把圖片變數字！<br/>(支援 PDF, PNG, JPG)</p>
            </div>
        ) : (
             previews.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {previews.map((src, idx) => (
                        <div key={idx} className="relative aspect-[3/4] bg-slate-100 rounded-3xl overflow-hidden border-4 border-white shadow-md group transform hover:rotate-1 transition">
                            {src.startsWith('data:application/pdf') ? <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-amber-50"><FileText className="w-8 h-8 mb-2 text-amber-400" /><span className="text-xs font-bold text-amber-600">PDF 文件</span></div> : <img src={src} className="w-full h-full object-cover" />}
                            <button onClick={() => removePreview(idx)} className="absolute top-2 right-2 p-2 bg-white rounded-full shadow hover:bg-rose-50 text-rose-400 transition"><X className="w-4 h-4" /></button>
                        </div>
                    ))}
                    <div onClick={() => fileInputRef.current?.click()} className="aspect-[3/4] border-4 border-dashed border-amber-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-amber-50 text-amber-400 transition bg-[#FFFBF5]"><Plus className="w-10 h-10" /><span className="text-xs font-bold mt-2">加菜</span></div>
                </div>
             )
        )}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" multiple />
      </div>
      {previews.length > 0 && (
        <button onClick={handleScan} disabled={isProcessing} className="w-full py-5 bg-gradient-to-r from-amber-400 to-orange-400 text-white rounded-2xl font-bold text-xl shadow-lg shadow-orange-100 hover:shadow-orange-200 transform hover:-translate-y-1 transition flex justify-center items-center gap-3 mb-8">{isProcessing ? <><Loader2 className="w-6 h-6 animate-spin" />正在努力咀嚼中...</> : <><Sparkles className="w-6 h-6" />開始 AI 消化 ({previews.length} 張)</>}</button>
      )}
      {draftTransactions.length > 0 && (
        <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
          <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100"><p className="text-xs font-bold text-emerald-400 uppercase">總收入</p><p className="text-lg font-bold text-emerald-600">+${summaries.income.toLocaleString()}</p></div>
              <div className="bg-rose-50 rounded-2xl p-4 border border-rose-100"><p className="text-xs font-bold text-rose-400 uppercase">總支出</p><p className="text-lg font-bold text-rose-600">-${summaries.expense.toLocaleString()}</p></div>
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100"><p className="text-xs font-bold text-amber-400 uppercase">本單結餘</p><p className={`text-lg font-bold ${summaries.net >= 0 ? 'text-amber-600' : 'text-rose-600'}`}>{summaries.net >= 0 ? '+' : ''}{summaries.net.toLocaleString()}</p></div>
          </div>
          <div className="flex items-center justify-between px-2 mb-4"><h3 className="font-bold text-lg text-slate-700 flex items-center gap-2"><PawPrint className="w-5 h-5 text-amber-400" />請協助檢查 ({draftTransactions.length} 筆)</h3><span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">點擊標籤可快速分類</span></div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-amber-200 pb-24 relative">
            {groupedDrafts.map(item => {
                if (item.type === 'single' && item.data) {
                    const t = item.data;
                    return (
                        <div key={t.id} className={`p-4 rounded-3xl border-2 transition-all relative group z-0 ${t.confidence < 0.85 ? 'border-rose-200 bg-rose-50/50' : t.type === 'income' ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-100 bg-white hover:border-amber-200 hover:shadow-md'}`} style={{ zIndex: activeSelectorId === t.id ? 50 : 0 }}>
                            {t.confidence < 0.85 && <div className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow border border-rose-100 z-10 animate-bounce"><PawPrint className="w-3 h-3 text-rose-400" /></div>}
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => handleUpdateDraft(t.id, 'type', t.type === 'income' ? 'expense' : 'income')} className={`p-2 rounded-xl transition-colors ${t.type === 'income' ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'bg-rose-100 text-rose-500 hover:bg-rose-200'}`}>{t.type === 'income' ? <ArrowUpCircle className="w-4 h-4"/> : <ArrowDownCircle className="w-4 h-4"/>}</button>
                                    {renderCategorySelector(t)}
                                    <input value={t.date} onChange={(e) => handleUpdateDraft(t.id, 'date', e.target.value)} className="w-28 text-xs font-bold text-slate-600 bg-transparent border-b border-transparent focus:border-amber-300 outline-none transition-colors" />
                                </div>
                                <div className="flex items-center gap-3 pl-12">
                                    <div className="flex-1"><input value={t.merchant} onChange={(e) => handleUpdateDraft(t.id, 'merchant', e.target.value)} className="w-full font-bold text-slate-700 bg-transparent border-b border-transparent focus:border-amber-300 outline-none transition-colors" /></div>
                                    <div className="w-24"><input type="number" value={t.amount} onChange={(e) => handleUpdateDraft(t.id, 'amount', parseFloat(e.target.value))} className={`w-full font-mono text-right font-bold bg-transparent border-b border-transparent focus:border-amber-300 outline-none transition-colors ${t.type === 'income' ? 'text-emerald-600' : 'text-slate-800'}`} /></div>
                                    <div className="flex gap-1">
                                      <button onClick={() => setSplittingDraft(t)} className="p-2 text-slate-300 hover:text-purple-500 hover:bg-purple-50 rounded-xl transition" title="拆帳分類"><Divide className="w-5 h-5" /></button>
                                      <button onClick={() => handleRemoveDraft(t.id)} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-100 rounded-xl transition"><Trash2 className="w-5 h-5" /></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                } 
                if (item.type === 'group' && item.children) {
                    const children = item.children; const parentDisplay = children[0]; const totalAmount = children.reduce((sum, c) => sum + c.amount, 0);
                    return (
                        <div key={`draft-group-${parentDisplay.parentId}`} className="bg-purple-50/20 border-2 border-purple-100 rounded-3xl overflow-hidden mb-2">
                             <div className="p-4 bg-purple-100/50 flex items-center justify-between"><div className="flex items-center gap-3"><div className="p-2 bg-purple-200 text-purple-600 rounded-xl"><Receipt className="w-4 h-4" /></div><span className="font-bold text-slate-700">{parentDisplay.merchant}</span><span className="text-[10px] font-bold bg-purple-200 text-purple-600 px-2 py-0.5 rounded-full">已分裝</span></div><span className="font-bold text-slate-700 text-lg">${totalAmount.toFixed(2)}</span></div>
                             <div className="divide-y divide-purple-100">
                                 {children.map(child => (
                                     <div key={child.id} className="p-3 pl-6 flex items-center gap-3 bg-white relative"><CornerDownRight className="w-4 h-4 text-purple-200 absolute left-2 top-1/2 -translate-y-1/2" />{renderCategorySelector(child)}<input value={child.merchant} onChange={(e) => handleUpdateDraft(child.id, 'merchant', e.target.value)} className="flex-1 text-sm font-bold text-slate-600 bg-transparent border-b border-transparent focus:border-purple-300 outline-none transition-colors" /><input type="number" value={child.amount} onChange={(e) => handleUpdateDraft(child.id, 'amount', parseFloat(e.target.value))} className="w-20 font-mono text-right font-bold bg-transparent border-b border-transparent focus:border-purple-300 outline-none transition-colors text-slate-600" /><button onClick={() => handleRemoveDraft(child.id)} className="p-1.5 text-slate-300 hover:text-rose-500 rounded-lg transition"><Trash2 className="w-4 h-4" /></button></div>
                                 ))}
                             </div>
                        </div>
                    );
                }
                return null;
            })}
          </div>
          <div className="absolute bottom-4 right-4 flex flex-row items-end gap-3"><button onClick={openAddModal} className="w-14 h-14 bg-amber-500 text-white rounded-full shadow-lg shadow-amber-200 hover:bg-amber-600 hover:scale-110 transition flex items-center justify-center z-10"><Coins className="w-8 h-8" /></button><button onClick={handleCommit} className="px-6 h-14 bg-emerald-400 text-white rounded-full font-bold text-lg shadow-lg hover:bg-emerald-500 hover:scale-105 transition flex items-center gap-2 z-10"><Check className="w-6 h-6" /><span className="hidden md:inline">確認入帳</span><span className="md:hidden">OK</span></button></div>
        </div>
      )}
    </div>
    {lastDeleted && (<div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-4"><div className="bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4"><span className="text-sm font-medium">已移除 1 筆交易</span><button onClick={handleUndo} className="text-amber-400 font-bold text-sm hover:text-amber-300 flex items-center gap-1"><RotateCcw className="w-4 h-4" /> 復原 (Undo)</button></div></div>)}
    {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"><div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={() => setIsAddModalOpen(false)}></div><div className="relative bg-[#FFFBF5] w-full max-w-lg sm:rounded-[40px] rounded-t-[40px] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 duration-300 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()} ><div className="p-6 border-b border-amber-100 bg-white/50 flex justify-between items-center shrink-0"><h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-2"><div className="p-2 bg-amber-100 text-amber-500 rounded-xl"><Coins className="w-5 h-5" /></div>現金記帳 (Cash Entry)</h3><button onClick={() => setIsAddModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button></div><div className="p-6 space-y-6 overflow-y-auto"><div className="flex p-1 bg-white rounded-2xl border border-slate-100"><button onClick={() => setNewTxData({...newTxData, type: 'expense'})} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${newTxData.type === 'expense' ? 'bg-rose-50 text-rose-500 shadow-sm' : 'text-slate-400'}`}><ArrowDownCircle className="w-4 h-4" /> 現金支出</button><button onClick={() => setNewTxData({...newTxData, type: 'income'})} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${newTxData.type === 'income' ? 'bg-emerald-50 text-emerald-500 shadow-sm' : 'text-slate-400'}`}><ArrowUpCircle className="w-4 h-4" /> 現金收入</button></div><div className="space-y-4"><div className="space-y-1"><label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1"><Calendar className="w-3 h-3"/> 日期</label><input type="date" value={newTxData.date} onChange={e => { setNewTxData({...newTxData, date: e.target.value}); }} onBlur={checkDuplicateEffect} className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-amber-200 outline-none shadow-sm" /></div><div className="space-y-1"><label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1"><Store className="w-3 h-3"/> 商家或項目名稱</label><input type="text" value={newTxData.merchant} onChange={e => setNewTxData({...newTxData, merchant: e.target.value})} className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-amber-200 outline-none shadow-sm" /></div><div className="space-y-1"><label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1"><DollarSign className="w-3 h-3"/> 金額</label><input type="number" value={newTxData.amount} onChange={e => { setNewTxData({...newTxData, amount: e.target.value}); }} onBlur={checkDuplicateEffect} className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-mono font-bold text-xl text-slate-700 focus:ring-2 focus:ring-amber-200 outline-none shadow-sm" /></div>{cashDupeWarning && (<div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex gap-2 items-start animate-in fade-in slide-in-from-top-2"><AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" /><p className="text-xs text-amber-700 leading-relaxed font-medium">Meow~ 發現您最近有提款紀錄！<br/>請確認這筆現金支出是否為「重複記帳」？</p></div>)}</div><button onClick={saveNewTransaction} className="w-full py-4 bg-amber-400 text-white rounded-2xl font-bold text-lg shadow-lg hover:bg-amber-500 transition transform active:scale-95 flex justify-center items-center gap-2"><Check className="w-5 h-5" /> 加入清單</button></div><div className="h-6 w-full bg-white shrink-0"></div></div></div>
    )}
    {splittingDraft && <SplitModal transaction={splittingDraft} onClose={() => setSplittingDraft(null)} onSave={handleSplitSave} />}
    </div>
  );
};

export default Scanner;
