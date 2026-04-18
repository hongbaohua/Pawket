
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, ScanLine, List, PieChart as PieIcon, Pencil, ArrowUpRight, ArrowDownRight, TrendingUp, Download, Upload, Cat, PawPrint, Fish, ShoppingBag, Coffee, Home, Utensils, Car, PiggyBank, Wallet, Receipt, Plus, Trash2, RotateCcw, Target, Search, X, Filter, ChevronDown, ChevronUp, CornerDownRight, CreditCard, Coins, Divide, Undo2 } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Scanner from './components/Scanner';
import SplitModal from './components/SplitModal';
import EditTransactionModal from './components/EditTransactionModal';
import BatchCorrectionModal from './components/BatchCorrectionModal';
import GoalModal from './components/GoalModal';
import CategoryMappingModal from './components/CategoryMappingModal';
import { Transaction, Budget, Alert, L1Category, CATEGORY_LABELS, TimeScope, SavingsGoal, STANDARD_CATEGORIES, PenaltyConfig } from './types';
import { generateTimeWeightedAlerts, getDateRange, findSimilarTransactions, calculateGoalMetrics } from './services/logicService';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_BUDGETS: Budget[] = [
  { l1: L1Category.FIXED, amount: 2000 },
  { l1: L1Category.VARIABLE, amount: 1200 },
  { l1: L1Category.INVESTMENT, amount: 800 },
];

const HighlightText: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
    if (!highlight.trim() || !text) return <>{text}</>;
    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} className="bg-amber-200 text-amber-900 rounded-sm px-0.5 box-decoration-clone font-bold">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    );
};

const App: React.FC = () => {
  const [view, setView] = useState<'dashboard' | 'scanner' | 'transactions'>('dashboard');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>(INITIAL_BUDGETS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  
  const [timeScope, setTimeScope] = useState<TimeScope>('natural_month');
  const [cycleStartDay, setCycleStartDay] = useState<number>(1);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [customRange, setCustomRange] = useState<{start: Date, end: Date}>({
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      end: new Date()
  });

  const [penaltyConfig, setPenaltyConfig] = useState<PenaltyConfig>({
      enabled: false,
      ratio: 0.5,
      targetCategory: '休閒娛樂'
  });

  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);

  const primaryGoal = useMemo(() => {
      return goals.find(g => g.isPrimary) || goals[0] || null;
  }, [goals]);

  const sidebarGoalMetrics = useMemo(() => {
      if (!primaryGoal) return null;
      return calculateGoalMetrics(primaryGoal, transactions);
  }, [primaryGoal, transactions]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTagFilters, setSelectedTagFilters] = useState<Set<string>>(new Set());
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  const [splittingTransaction, setSplittingTransaction] = useState<Transaction | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [batchCandidates, setBatchCandidates] = useState<Transaction[]>([]);
  const [batchSource, setBatchSource] = useState<Transaction | null>(null);
  const [pendingImportTxs, setPendingImportTxs] = useState<Transaction[]>([]);
  const [conflictCategories, setConflictCategories] = useState<{key: string, originalL1: string, originalL2: string, count: number}[]>([]);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  
  // Undo States
  const [lastDeletedTransaction, setLastDeletedTransaction] = useState<Transaction | null>(null);
  const [lastCanceledSplit, setLastCanceledSplit] = useState<{ originalTxs: Transaction[], restoredTx: Transaction } | null>(null);
  
  const undoTimeoutRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { filteredTransactions, dateRange } = useMemo(() => {
    const range = getDateRange(timeScope, cycleStartDay, transactions, currentDate, customRange.start, customRange.end);
    const filtered = transactions.filter(t => {
       const d = new Date(t.date);
       return d >= range.startDate && d <= range.endDate;
    });
    return { filteredTransactions: filtered, dateRange: range };
  }, [timeScope, cycleStartDay, transactions, currentDate, customRange]);

  const availableTags = useMemo(() => {
    const l2Set = new Set<string>();
    const l3Set = new Set<string>();
    transactions.forEach(t => {
        if (t.category.l2) l2Set.add(t.category.l2);
        if (t.category.l3) l3Set.add(t.category.l3);
    });
    return { l2: Array.from(l2Set).sort(), l3: Array.from(l3Set).filter(tag => !l2Set.has(tag)).sort() };
  }, [transactions]);

  const processedTransactions = useMemo(() => {
      let result = [...transactions];
      if (searchTerm.trim()) {
          const lowerTerm = searchTerm.toLowerCase();
          result = result.filter(t => 
              t.merchant.toLowerCase().includes(lowerTerm) ||
              (t.originalText || '').toLowerCase().includes(lowerTerm) ||
              t.category.l1.toLowerCase().includes(lowerTerm) ||
              t.category.l2.toLowerCase().includes(lowerTerm) ||
              (t.category.l3 || '').toLowerCase().includes(lowerTerm)
          );
      }
      if (selectedTagFilters.size > 0) {
          result = result.filter(t => selectedTagFilters.has(t.category.l2) || selectedTagFilters.has(t.category.l3));
      }
      return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchTerm, selectedTagFilters]);

  const groupedDisplayItems = useMemo(() => {
      const groups: Record<string, Transaction[]> = {};
      const singles: Transaction[] = [];
      processedTransactions.forEach(t => {
          if (t.isSplit && t.parentId) {
              if (!groups[t.parentId]) groups[t.parentId] = [];
              groups[t.parentId].push(t);
          } else {
              singles.push(t);
          }
      });
      const result: { type: 'single' | 'group', data: Transaction | null, children?: Transaction[] }[] = [];
      const processedGroups = new Set<string>();
      processedTransactions.forEach(t => {
          const groupId = t.isSplit && t.parentId ? t.parentId : t.id;
          if (processedGroups.has(groupId)) return;
          if (groups[groupId]) {
              // Ensure children are sorted: Main Item (l3: '主項目') first
              const sortedChildren = [...groups[groupId]].sort((a, b) => {
                  if (a.category.l3 === '主項目') return -1;
                  if (b.category.l3 === '主項目') return 1;
                  return 0;
              });
              result.push({ type: 'group', data: null, children: sortedChildren });
              processedGroups.add(groupId);
          } else {
              result.push({ type: 'single', data: t });
              processedGroups.add(groupId);
          }
      });
      return result;
  }, [processedTransactions]);

  const customCategoryHistory = useMemo(() => {
      const history: Record<string, string[]> = {};
      transactions.forEach(t => {
          const { l1, l2 } = t.category;
          const standardList = STANDARD_CATEGORIES[l1] || [];
          if (!standardList.includes(l2)) {
              if (!history[l1]) history[l1] = [];
              if (!history[l1].includes(l2)) history[l1].push(l2);
          }
      });
      return history;
  }, [transactions]);

  useEffect(() => {
    if (timeScope !== 'all') {
        const newAlerts = generateTimeWeightedAlerts(filteredTransactions, budgets, dateRange.startDate, dateRange.endDate);
        setAlerts(newAlerts);
    } else {
        setAlerts([]);
    }
  }, [filteredTransactions, budgets, dateRange, timeScope]);

  const handleTransactionsAdded = (newTx: Transaction[]) => {
    setTransactions(prev => [...prev, ...newTx]);
    setView('transactions');
  };

  const handleSplitSave = (splitTxs: Transaction[]) => {
    if (!splittingTransaction) return;
    const parentId = splittingTransaction.parentId || splittingTransaction.id;
    setTransactions(prev => [
        // Remove all previous children of this split if re-editing
        ...prev.filter(t => t.id !== splittingTransaction.id && t.parentId !== parentId), 
        ...splitTxs
    ]);
    setSplittingTransaction(null);
  };

  const handleCancelSplit = (parentId: string) => {
    const splitTxs = transactions.filter(t => t.parentId === parentId);
    if (splitTxs.length === 0) return;

    // Find main item to use as template, or sum up children
    const mainItem = splitTxs.find(t => t.category.l3 === '主項目') || splitTxs[0];
    const totalAmount = splitTxs.reduce((sum, t) => sum + t.amount, 0);

    const restoredTx: Transaction = {
        ...mainItem,
        id: parentId, 
        parentId: undefined,
        isSplit: false,
        amount: totalAmount,
        merchant: mainItem.merchant, 
        category: {
            ...mainItem.category,
            l3: '' 
        }
    };

    setLastCanceledSplit({ originalTxs: splitTxs, restoredTx });
    setLastDeletedTransaction(null); 

    setTransactions(prev => [
        ...prev.filter(t => t.parentId !== parentId),
        restoredTx
    ]);

    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = window.setTimeout(() => setLastCanceledSplit(null), 5000);
  };

  const handleUndoCancelSplit = () => {
    if (!lastCanceledSplit) return;
    const { originalTxs, restoredTx } = lastCanceledSplit;
    
    setTransactions(prev => [
        ...prev.filter(t => t.id !== restoredTx.id),
        ...originalTxs
    ]);
    
    setLastCanceledSplit(null);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
  };

  const handleEditSave = (updatedTx: Transaction) => {
    setTransactions(prev => prev.some(t => t.id === updatedTx.id) ? prev.map(t => t.id === updatedTx.id ? updatedTx : t) : [updatedTx, ...prev]);
    setEditingTransaction(null);
    const candidates = findSimilarTransactions(updatedTx, transactions);
    if (candidates.length > 0) {
        setBatchSource(updatedTx);
        setBatchCandidates(candidates);
    }
  };

  const handleTagAction = (action: 'rename' | 'delete', l1: L1Category, oldName: string, newName?: string) => {
      setTransactions(prev => prev.map(t => {
          if (t.category.l1 === l1 && t.category.l2 === oldName) {
              if (action === 'rename' && newName) return { ...t, category: { ...t.category, l2: newName } };
              else if (action === 'delete') return { ...t, category: { ...t.category, l2: STANDARD_CATEGORIES[l1][0] } };
          }
          return t;
      }));
  };

  const handleBatchConfirm = (selectedIds: string[]) => {
      if (!batchSource) return;
      setTransactions(prev => prev.map(t => selectedIds.includes(t.id) ? { ...t, merchant: batchSource.merchant, type: batchSource.type, category: { ...batchSource.category }, isVerified: true, originalText: (t.originalText || '') + " (Batch Updated)" } : t));
      setBatchCandidates([]);
      setBatchSource(null);
  };

  const handleDeleteTransaction = (id: string) => {
    const txToDelete = transactions.find(t => t.id === id);
    if (!txToDelete) return;

    if (txToDelete.isSplit && txToDelete.parentId) {
        const group = transactions.filter(t => t.parentId === txToDelete.parentId);
        if (group.length > 1 && window.confirm('這筆帳目屬於分裝群組，是否要刪除整個分裝群組？')) {
            setTransactions(prev => prev.filter(t => t.parentId !== txToDelete.parentId));
            setLastDeletedTransaction(null);
            return;
        }
    }

    setLastDeletedTransaction(txToDelete);
    setLastCanceledSplit(null);
    setTransactions(prev => prev.filter(t => t.id !== id));
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = window.setTimeout(() => setLastDeletedTransaction(null), 3000);
  };

  const handleUndoDelete = () => {
    if (!lastDeletedTransaction) return;
    setTransactions(prev => [...prev, lastDeletedTransaction]);
    setLastDeletedTransaction(null);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
  };

  const handleAddTransaction = () => {
    const today = new Date().toISOString().split('T')[0];
    setEditingTransaction({ id: uuidv4(), date: today, merchant: '', amount: 0, originalText: 'Manual Add', type: 'expense', source_type: 'CASH_MANUAL', category: { l1: L1Category.VARIABLE, l2: STANDARD_CATEGORIES[L1Category.VARIABLE][0], l3: '' }, confidence: 1.0, isVerified: true, isSplit: false });
  };

  const handlePrint = () => window.print();

  const handleMappingConfirm = (mapping: Record<string, { l1: L1Category; l2: string }>) => {
    const updatedTxs = pendingImportTxs.map(t => {
      const key = `${t.category.l1}::${t.category.l2}`;
      if (mapping[key]) {
        return { ...t, category: { ...t.category, l1: mapping[key].l1, l2: mapping[key].l2 } };
      }
      return t;
    });
    const existingIds = new Set(transactions.map(t => t.id));
    const newUnique = updatedTxs.filter(t => t.id && !existingIds.has(t.id));
    if (newUnique.length > 0) {
      setTransactions(prev => [...prev, ...newUnique]);
      alert(`成功匯入 ${newUnique.length} 筆資料！`);
    } else alert("匯入的資料似乎已存在 😿");
    setIsMappingModalOpen(false); setPendingImportTxs([]); setConflictCategories([]);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target?.result as string);
            let importedTransactions = json.transactions || (Array.isArray(json) ? json : []);
            let importedGoals = json.goals || (json.primaryGoal ? [{ ...json.primaryGoal, isPrimary: true }] : []);
            if (importedGoals.length > 0) setGoals(prev => { const merged = [...prev]; importedGoals.forEach(g => { const idx = merged.findIndex(mg => mg.id === g.id); if (idx >= 0) merged[idx] = g; else merged.push(g); }); return merged; });
            if (importedTransactions.length > 0) {
                const conflictsMap: Record<string, any> = {};
                importedTransactions.forEach(t => { if (!Object.values(L1Category).includes(t.category.l1) || !STANDARD_CATEGORIES[t.category.l1]?.includes(t.category.l2)) { const key = `${t.category.l1}::${t.category.l2}`; if (!conflictsMap[key]) conflictsMap[key] = { key, originalL1: t.category.l1, originalL2: t.category.l2, count: 0 }; conflictsMap[key].count++; } });
                const conflictsList = Object.values(conflictsMap);
                if (conflictsList.length > 0) { setPendingImportTxs(importedTransactions); setConflictCategories(conflictsList); setIsMappingModalOpen(true); } 
                else { const existingIds = new Set(transactions.map(t => t.id)); const newUnique = importedTransactions.filter((t: any) => t.id && !existingIds.has(t.id)); if (newUnique.length > 0) { setTransactions(prev => [...prev, ...newUnique]); alert(`成功匯入 ${newUnique.length} 筆資料！`); } else alert("匯入的資料似乎已存在 😿"); }
            }
        } catch (err) { alert("檔案解析失敗。"); }
    };
    reader.readAsText(file);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleExport = () => {
    const data = {
      transactions,
      goals,
      exportDate: new Date().toISOString()
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Pawket_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#FFFBF5] text-slate-600 font-sans flex selection:bg-amber-100 selection:text-amber-800 relative">
      <aside className="w-20 lg:w-72 bg-white flex flex-col fixed h-full z-20 no-print transition-all shadow-[8px_0_30px_rgba(0,0,0,0.02)] rounded-r-[40px] my-0 lg:my-4 lg:ml-4 lg:h-[calc(100vh-32px)] border-r border-orange-50">
        <div className="p-8 flex items-center gap-3">
           <div className="w-12 h-12 bg-gradient-to-br from-amber-300 to-orange-400 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100 text-white transform rotate-[-5deg] hover:rotate-0 transition-all duration-300"><Cat className="w-7 h-7" /></div>
           <span className="font-extrabold text-2xl tracking-tight text-slate-700 hidden lg:block">Paw<span className="text-amber-500">ket</span></span>
        </div>
        <nav className="flex-1 py-6 space-y-4 px-4">
          <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-300 font-bold group border-2 ${view === 'dashboard' ? 'bg-amber-50 border-amber-100 text-amber-500 shadow-sm' : 'border-transparent text-slate-400 hover:bg-orange-50/50'}`}><LayoutDashboard className={`w-6 h-6 ${view === 'dashboard' ? 'text-amber-500' : 'text-slate-400'}`} /><span className="hidden lg:block">貓咪指揮中心</span></button>
          <button onClick={() => setView('scanner')} className={`w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-300 font-bold group border-2 ${view === 'scanner' ? 'bg-amber-50 border-amber-100 text-amber-500 shadow-sm' : 'border-transparent text-slate-400 hover:bg-orange-50/50'}`}><ScanLine className={`w-6 h-6 ${view === 'scanner' ? 'text-amber-500' : 'text-slate-400'}`} /><span className="hidden lg:block">餵食帳單 (Scan)</span></button>
          <button onClick={() => setView('transactions')} className={`w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-300 font-bold group border-2 ${view === 'transactions' ? 'bg-amber-50 border-amber-100 text-amber-500 shadow-sm' : 'border-transparent text-slate-400 hover:bg-orange-50/50'}`}><List className={`w-6 h-6 ${view === 'transactions' ? 'text-amber-500' : 'text-slate-400'}`} /><span className="hidden lg:block">罐罐明細本</span></button>
          <button onClick={() => setIsGoalModalOpen(true)} className="w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-300 font-bold group border-2 border-transparent text-slate-400 hover:bg-indigo-50 hover:text-indigo-500"><Target className="w-6 h-6" /><span className="hidden lg:block">設定夢想目標</span></button>
        </nav>
        <div className="p-6 mt-auto">
           {primaryGoal && <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-5 rounded-3xl border border-indigo-100 hidden lg:block relative overflow-hidden group hover:shadow-md cursor-pointer" onClick={() => setIsGoalModalOpen(true)}><div className="flex items-center gap-2 text-indigo-500 mb-3"><Target className="w-4 h-4" /><span className="text-xs font-bold uppercase tracking-wider">目標進行中</span></div><p className="font-bold text-slate-700 truncate">{primaryGoal.name}</p><div className="w-full bg-white h-2 rounded-full overflow-hidden border border-indigo-100 mt-2"><div className="bg-indigo-400 h-full rounded-full transition-all duration-1000" style={{ width: `${sidebarGoalMetrics?.weightedPercent || 0}%` }}></div></div><p className="text-[10px] text-indigo-400 mt-1 text-right font-bold">{sidebarGoalMetrics?.weightedPercent.toFixed(1)}%</p></div>}
        </div>
      </aside>
      <main className="flex-1 ml-20 lg:ml-80 p-6 lg:p-10 transition-all">
        {view === 'dashboard' && <Dashboard 
            alerts={alerts} budgets={budgets} transactions={filteredTransactions} allTransactions={transactions} goal={primaryGoal} onPrint={handlePrint}
            timeScope={timeScope} setTimeScope={setTimeScope} cycleStartDay={cycleStartDay} setCycleStartDay={setCycleStartDay} dateRangeLabel={dateRange.label}
            currentDate={currentDate} setCurrentDate={setCurrentDate} penaltyConfig={penaltyConfig} setPenaltyConfig={setPenaltyConfig}
            customRange={customRange} setCustomRange={setCustomRange}
          />}
        {view === 'scanner' && <Scanner onTransactionsAdded={handleTransactionsAdded} history={transactions} />}
        {view === 'transactions' && (
          <div className="bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 overflow-hidden">
            <div className="p-8 border-b border-orange-50 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white gap-4">
              <div><h2 className="text-2xl font-extrabold text-slate-700 flex items-center gap-2"><div className="w-2 h-8 bg-amber-400 rounded-full"></div>罐罐明細本</h2><p className="text-slate-400 text-sm mt-1 ml-4 font-medium">共 {processedTransactions.length} 筆紀錄</p></div>
              <div className="flex flex-wrap gap-2 no-print">
                 <button onClick={handleAddTransaction} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-emerald-400 hover:bg-emerald-500 rounded-2xl transition active:scale-95 shadow-md shadow-emerald-100"><Plus className="w-4 h-4" />新增交易</button>
                 <div className="h-full w-px bg-slate-200 mx-2 hidden sm:block"></div>
                 <button onClick={() => importInputRef.current?.click()} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition active:scale-95"><Upload className="w-4 h-4" />匯入</button>
                 <input type="file" ref={importInputRef} onChange={handleImport} className="hidden" accept="application/json" />
                 <button onClick={handleExport} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-amber-400 hover:bg-amber-500 rounded-2xl transition shadow-lg shadow-amber-100 active:scale-95"><Download className="w-4 h-4" />備份</button>
              </div>
            </div>
            <div className="px-8 py-6 border-b border-orange-50 bg-[#FFFBF5]/30 no-print">
                 <div className="flex flex-col gap-4">
                     <div className="flex gap-3"><div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input type="text" placeholder="快速查找..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-2xl shadow-sm text-slate-700 font-bold outline-none" />{searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-300"><X className="w-4 h-4" /></button>}</div><button onClick={() => setIsFilterExpanded(!isFilterExpanded)} className={`px-4 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all border ${isFilterExpanded ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-white text-slate-500 border-slate-100'}`}><Filter className="w-5 h-5" /><span className="hidden sm:inline">標籤篩選</span></button></div>
                 </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-[#FFFBF5] text-xs uppercase font-bold text-slate-400 tracking-wider"><tr><th className="p-6">日期</th><th className="p-6">商家</th><th className="p-6">分類</th><th className="p-6 text-right">金額</th><th className="p-6 text-center no-print">操作</th></tr></thead>
                <tbody className="divide-y divide-orange-50">
                  {processedTransactions.length === 0 ? (
                    <tr><td colSpan={5} className="p-10 text-center text-slate-400 italic font-medium">喵~ 這裡空空的，快去記帳吧！</td></tr>
                  ) : groupedDisplayItems.map(item => {
                    if (item.type === 'single') {
                      return (
                        <tr key={item.data!.id} className={`transition group ${item.data!.type === 'income' ? 'bg-emerald-50/20' : 'hover:bg-orange-50/30'}`}>
                          <td className="p-6">{item.data!.date}</td>
                          <td className="p-6 font-bold">{item.data!.merchant}</td>
                          <td className="p-6"><span className="px-2 py-1 bg-slate-100 rounded text-xs">{CATEGORY_LABELS[item.data!.category.l1]} &bull; {item.data!.category.l2}</span></td>
                          <td className={`p-6 text-right font-bold ${item.data!.type === 'income' ? 'text-emerald-500' : 'text-slate-700'}`}>{item.data!.type === 'income' ? '+' : '-'}${item.data!.amount}</td>
                          <td className="p-6 text-center no-print">
                            <div className="flex justify-center gap-2">
                              <button onClick={() => setSplittingTransaction(item.data!)} className="p-2 border rounded-xl hover:bg-purple-50 text-purple-400" title="拆帳分類"><Divide className="w-4 h-4" /></button>
                              <button onClick={() => setEditingTransaction(item.data!)} className="p-2 border rounded-xl hover:bg-amber-50" title="編輯項目"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteTransaction(item.data!.id)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="刪除項目"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    } else {
                      const children = item.children || [];
                      const parentId = children[0]?.parentId;
                      // Summing all items to get aggregate total for the main item row
                      const totalAmount = children.reduce((sum, c) => sum + (isNaN(c.amount) ? 0 : c.amount), 0);
                      const groupDate = children[0]?.date;
                      
                      // Identitfy the anchor record (主項目)
                      const mainItem = children.find(c => c.category.l3 === '主項目') || children[0];
                      // Sub items are everything else
                      const subItemsList = children.filter(c => c.category.l3 !== '主項目' && c.amount !== 0);

                      return (
                        <React.Fragment key={`group-${parentId}`}>
                          {/* ROOT Main Item Row */}
                          <tr className="bg-purple-50/30 border-t-2 border-purple-100">
                             <td className="p-6 text-xs font-bold text-purple-400">{groupDate}</td>
                             <td className="p-6 font-black text-slate-700 flex items-center gap-2">
                               {mainItem.merchant} <span className="text-[10px] bg-purple-200 text-purple-600 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">已分裝</span>
                             </td>
                             <td className="p-6">
                                <span className="px-2 py-1 bg-white/80 border border-purple-100 rounded text-xs font-bold text-purple-400">
                                  {CATEGORY_LABELS[mainItem.category.l1]} &bull; {mainItem.category.l2}
                                </span>
                             </td>
                             <td className={`p-6 text-right font-black ${mainItem.type === 'income' ? 'text-emerald-600' : 'text-slate-700'}`}>
                                {mainItem.type === 'income' ? '+' : '-'}${totalAmount.toFixed(2)}
                             </td>
                             <td className="p-6 text-center no-print">
                               <div className="flex justify-center gap-2">
                                  {/* Re-edit existing split */}
                                  <button 
                                    onClick={() => setSplittingTransaction(mainItem)} 
                                    className="p-2 border border-purple-200 bg-white rounded-xl hover:bg-purple-100 text-purple-500 transition-colors shadow-sm" 
                                    title="編輯分裝比例"
                                  >
                                    <Divide className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => handleCancelSplit(parentId!)} 
                                    className="p-2 border border-purple-200 bg-white rounded-xl hover:bg-purple-100 text-purple-500 transition-colors shadow-sm" 
                                    title="取消分裝並合併"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleDeleteTransaction(mainItem.id)} className="p-2 border border-purple-200 bg-white rounded-xl hover:bg-rose-50 text-rose-300 transition-colors shadow-sm" title="移除整個群組"><Trash2 className="w-4 h-4" /></button>
                               </div>
                             </td>
                          </tr>
                          {/* Sub-Items Indented */}
                          {subItemsList.map(child => (
                             <tr key={child.id} className="bg-white/50 border-l-4 border-purple-200 hover:bg-purple-50/10 transition group/child">
                                <td className="p-4 pl-10 text-xs text-slate-400">└─ {child.date}</td>
                                <td className="p-4 text-slate-600 font-bold">
                                  {child.merchant}
                                </td>
                                <td className="p-4">
                                  <span className="px-2 py-1 bg-slate-100 rounded text-xs">
                                    {CATEGORY_LABELS[child.category.l1]} &bull; {child.category.l2}
                                  </span>
                                </td>
                                <td className={`p-4 text-right font-bold ${child.type === 'income' ? 'text-emerald-500' : 'text-slate-500'}`}>
                                  {child.type === 'income' ? '+' : '-'}${child.amount}
                                </td>
                                <td className="p-4 text-center no-print">
                                   <div className="flex justify-center gap-1 opacity-0 group-hover/child:opacity-100 transition-opacity">
                                      <button onClick={() => setEditingTransaction(child)} className="p-1.5 hover:text-amber-500 transition" title="編輯此子項內容"><Pencil className="w-3.5 h-3.5" /></button>
                                      <button onClick={() => handleDeleteTransaction(child.id)} className="p-1.5 hover:text-rose-400 transition" title="刪除此子項"><Trash2 className="w-3.5 h-3.5" /></button>
                                   </div>
                                </td>
                             </tr>
                          ))}
                        </React.Fragment>
                      );
                    }
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      {splittingTransaction && <SplitModal transaction={splittingTransaction} allTransactions={transactions} onClose={() => setSplittingTransaction(null)} onSave={handleSplitSave} />}
      {editingTransaction && <EditTransactionModal transaction={editingTransaction} allTransactions={transactions} customCategoryHistory={customCategoryHistory} onTagAction={handleTagAction} onClose={() => setEditingTransaction(null)} onSave={handleEditSave} />}
      {batchSource && <BatchCorrectionModal matches={batchCandidates} source={batchSource} onConfirm={handleBatchConfirm} onClose={() => { setBatchSource(null); setBatchCandidates([]); }} />}
      {isGoalModalOpen && <GoalModal goals={goals} transactions={transactions} onClose={() => setIsGoalModalOpen(false)} onUpdateGoals={setGoals} />}
      {isMappingModalOpen && <CategoryMappingModal conflicts={conflictCategories} existingCustomOptions={customCategoryHistory} onConfirm={handleMappingConfirm} onCancel={() => { setIsMappingModalOpen(false); setPendingImportTxs([]); setConflictCategories([]); }} />}
      
      {(lastDeletedTransaction || lastCanceledSplit) && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5">
            <div className="bg-slate-800 text-white px-6 py-4 rounded-full shadow-2xl flex items-center gap-6">
                <span className="text-sm font-bold">
                    {lastDeletedTransaction ? `已移除「${lastDeletedTransaction.merchant}」紀錄` : "已取消分裝並合併項目"}
                </span>
                <button 
                    onClick={lastDeletedTransaction ? handleUndoDelete : handleUndoCancelSplit} 
                    className="text-amber-400 font-bold text-sm hover:text-amber-300 flex items-center gap-1 border-l border-slate-700 pl-4"
                >
                    <RotateCcw className="w-4 h-4" /> 復原 (Undo)
                </button>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;
