
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, ScanLine, List, PieChart as PieIcon, Pencil, ArrowUpRight, ArrowDownRight, TrendingUp, Download, Upload, Cat, PawPrint, Fish, ShoppingBag, Coffee, Home, Utensils, Car, PiggyBank, Wallet, Receipt, Plus, Trash2, RotateCcw, Target, Search, X, Filter, ChevronDown, ChevronUp, CornerDownRight, CreditCard, Coins, Divide, Undo2, LogOut, Repeat } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Scanner from './components/Scanner';
import SplitModal from './components/SplitModal';
import EditTransactionModal from './components/EditTransactionModal';
import BatchCorrectionModal from './components/BatchCorrectionModal';
import GoalModal from './components/GoalModal';
import CategoryMappingModal from './components/CategoryMappingModal';
import Auth from './components/Auth';
import AccountsModal from './components/AccountsModal';
import TransferModal from './components/TransferModal';
import { Transaction, Account, Budget, Alert, L1Category, CATEGORY_LABELS, TimeScope, SavingsGoal, STANDARD_CATEGORIES, PenaltyConfig } from './types';
import { generateTimeWeightedAlerts, getDateRange, findSimilarTransactions, calculateGoalMetrics } from './services/logicService';
import { INITIAL_BUDGETS, DEFAULT_PENALTY_CONFIG } from './config/financialRules';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';
import {
  seedDefaultAccountsIfEmpty, fetchTransactions, createAccount, updateAccount, archiveAccount,
  upsertTransaction, upsertTransactions, deleteTransaction as dbDeleteTransaction, deleteTransactionsByParentId
} from './lib/db';
import type { Session } from '@supabase/supabase-js';
// 一次性資料：中信對帳單匯入時保留下來的25筆待處理轉帳(提款/存款)，見 data-import/README.md
import pendingCtbcTransfers from './data-import/pending_transfers.json';
// 一次性資料：回頭修正已匯入775筆資料的商家/備註/折扣格式，見 data-import/parse_discounts.py
import discountCorrections from './data-import/discount_corrections.json';
import { v4 as uuidv4 } from 'uuid';

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
  // 登入狀態：先確認有沒有 Supabase session，沒有就顯示登入畫面，擋在主畫面前面。
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setAuthLoading(false); return; }
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setAuthLoading(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const [view, setView] = useState<'dashboard' | 'scanner' | 'transactions'>('dashboard');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isAccountsModalOpen, setIsAccountsModalOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [budgets, setBudgets] = useState<Budget[]>(INITIAL_BUDGETS);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // 登入後從 Supabase 載入這個使用者的帳戶跟交易紀錄；沒有帳戶的話先幫她建立預設帳戶清單。
  useEffect(() => {
    if (!userId) { setDataLoading(false); return; }
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      try {
        const [accs, txs] = await Promise.all([
          seedDefaultAccountsIfEmpty(userId),
          fetchTransactions(),
        ]);
        if (!cancelled) {
          setAccounts(accs);
          setTransactions(txs);
        }
      } catch (err) {
        console.error('載入資料失敗', err);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleSaveAccount = async (account: Omit<Account, 'id'> & { id?: string }) => {
    if (!userId) return;
    if (account.id) {
      await updateAccount(account as Account);
      setAccounts(prev => prev.map(a => a.id === account.id ? (account as Account) : a));
    } else {
      const created = await createAccount(userId, account);
      setAccounts(prev => [...prev, created]);
    }
  };

  const handleArchiveAccount = async (accountId: string) => {
    await archiveAccount(accountId);
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, isArchived: true } : a));
  };
  
  const [timeScope, setTimeScope] = useState<TimeScope>('natural_month');
  const [cycleStartDay, setCycleStartDay] = useState<number>(1);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [customRange, setCustomRange] = useState<{start: Date, end: Date}>({
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      end: new Date()
  });

  const [penaltyConfig, setPenaltyConfig] = useState<PenaltyConfig>(DEFAULT_PENALTY_CONFIG);

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
  const [transferModalState, setTransferModalState] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
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
    if (userId) upsertTransactions(userId, newTx).catch(err => console.error('儲存交易失敗', err));
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
    if (userId) {
      (async () => {
        try {
          await deleteTransactionsByParentId(parentId);
          if (splittingTransaction.id !== parentId) await dbDeleteTransaction(splittingTransaction.id);
          await upsertTransactions(userId, splitTxs);
        } catch (err) { console.error('儲存拆帳失敗', err); }
      })();
    }
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

    if (userId) {
      (async () => {
        try {
          await deleteTransactionsByParentId(parentId);
          await upsertTransaction(userId, restoredTx);
        } catch (err) { console.error('取消拆帳失敗', err); }
      })();
    }
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

    if (userId) {
      (async () => {
        try {
          await dbDeleteTransaction(restoredTx.id);
          await upsertTransactions(userId, originalTxs);
        } catch (err) { console.error('復原拆帳失敗', err); }
      })();
    }
  };

  const handleEditSave = (updatedTx: Transaction) => {
    setTransactions(prev => prev.some(t => t.id === updatedTx.id) ? prev.map(t => t.id === updatedTx.id ? updatedTx : t) : [updatedTx, ...prev]);
    setEditingTransaction(null);
    const candidates = findSimilarTransactions(updatedTx, transactions);
    if (candidates.length > 0) {
        setBatchSource(updatedTx);
        setBatchCandidates(candidates);
    }
    if (userId) upsertTransaction(userId, updatedTx).catch(err => console.error('儲存交易失敗', err));
  };

  const handleTransferSave = (tx: Transaction) => {
    setTransactions(prev => prev.some(t => t.id === tx.id) ? prev.map(t => t.id === tx.id ? tx : t) : [tx, ...prev]);
    setTransferModalState({ open: false });
    if (userId) upsertTransaction(userId, tx).catch(err => console.error('儲存轉帳失敗', err));
  };

  // 一次性：把中信對帳單匯入時保留下來的25筆轉帳(提款/存款)接上真實帳戶。
  // 用完這顆按鈕之後會移除，見 data-import/README.md。
  const handleImportPendingCtbcTransfers = async () => {
    if (!userId) return;
    const ctbc = accounts.find(a => a.name === '中國信託' && !a.isArchived);
    const cash = accounts.find(a => a.name === '現金' && !a.isArchived);
    if (!ctbc || !cash) {
      alert('找不到「中國信託」或「現金」帳戶，請先在帳戶管理建立好再匯入。');
      return;
    }
    const already = new Set(transactions.map(t => t.id));
    const newOnes = (pendingCtbcTransfers as any[]).filter(t => !already.has(t.id));
    if (newOnes.length === 0) { alert('這批轉帳已經匯入過了。'); return; }
    const toTransfer = (fromId: string, toId: string) => ({ fromAccountId: fromId, toAccountId: toId });
    const transfers: Transaction[] = newOnes.map(t => {
      const dir = t.transferDirection === 'CTBC->CASH' ? toTransfer(ctbc.id, cash.id) : toTransfer(cash.id, ctbc.id);
      const label = t.transferDirection === 'CTBC->CASH' ? `轉帳：${ctbc.name} → ${cash.name}` : `轉帳：${cash.name} → ${ctbc.name}`;
      return {
        id: t.id,
        date: t.date,
        merchant: label,
        originalText: t.originalText,
        amount: t.amount,
        type: 'transfer',
        ...dir,
        category: { l1: L1Category.VARIABLE, l2: '轉帳', l3: '' },
        confidence: 1,
        isVerified: true,
        isSplit: false,
      };
    });
    setTransactions(prev => [...prev, ...transfers]);
    try {
      await upsertTransactions(userId, transfers);
      alert(`已匯入 ${transfers.length} 筆轉帳！`);
    } catch (err) {
      console.error('匯入轉帳失敗', err);
      alert('匯入失敗，請檢查主控台錯誤訊息。');
    }
  };

  // 一次性：回頭修正已匯入775筆資料裡，商家欄位夾帶折扣/描述文字的部分，
  // 拆成乾淨的商家名稱＋備註＋原始金額／折扣明細。用完這顆按鈕之後會移除，見 data-import/parse_discounts.py。
  const handleApplyDiscountCorrections = async () => {
    if (!userId) return;
    const corrections = discountCorrections as {
      id: string; merchant: string; note: string | null; grossAmount: number | null; discounts: { label: string; amount: number }[] | null;
    }[];
    const byId = new Map<string, Transaction>(transactions.map(t => [t.id, t]));
    const updated: Transaction[] = [];
    for (const c of corrections) {
      const existing = byId.get(c.id);
      if (!existing) continue;
      const merged: Transaction = {
        ...existing,
        merchant: c.merchant,
        note: c.note || undefined,
        grossAmount: c.grossAmount ?? undefined,
        discounts: c.discounts && c.discounts.length > 0 ? c.discounts : undefined,
      };
      updated.push(merged);
    }
    if (updated.length === 0) { alert('找不到符合的交易，可能還沒匯入775筆資料，或已經套用過了。'); return; }
    const updatedIds = new Set(updated.map(u => u.id));
    setTransactions(prev => prev.map(t => updatedIds.has(t.id) ? updated.find(u => u.id === t.id)! : t));
    try {
      await upsertTransactions(userId, updated);
      alert(`已更新 ${updated.length} 筆交易的商家/備註/折扣格式！`);
    } catch (err) {
      console.error('套用折扣修正失敗', err);
      alert('更新失敗，請檢查主控台錯誤訊息。');
    }
  };

  const handleTagAction = (action: 'rename' | 'delete', l1: L1Category, oldName: string, newName?: string) => {
      const affectedIds = transactions.filter(t => t.category.l1 === l1 && t.category.l2 === oldName).map(t => t.id);
      let updated: Transaction[] = [];
      setTransactions(prev => {
          updated = prev.map(t => {
              if (t.category.l1 === l1 && t.category.l2 === oldName) {
                  if (action === 'rename' && newName) return { ...t, category: { ...t.category, l2: newName } };
                  else if (action === 'delete') return { ...t, category: { ...t.category, l2: STANDARD_CATEGORIES[l1][0] } };
              }
              return t;
          });
          return updated;
      });
      if (userId) {
          const changed = updated.filter(t => affectedIds.includes(t.id));
          upsertTransactions(userId, changed).catch(err => console.error('更新分類失敗', err));
      }
  };

  const handleBatchConfirm = (selectedIds: string[]) => {
      if (!batchSource) return;
      let updated: Transaction[] = [];
      setTransactions(prev => {
          updated = prev.map(t => selectedIds.includes(t.id) ? { ...t, merchant: batchSource.merchant, type: batchSource.type, category: { ...batchSource.category }, isVerified: true, originalText: (t.originalText || '') + " (Batch Updated)" } : t);
          return updated;
      });
      setBatchCandidates([]);
      setBatchSource(null);
      if (userId) {
          const changed = updated.filter(t => selectedIds.includes(t.id));
          upsertTransactions(userId, changed).catch(err => console.error('批次更新失敗', err));
      }
  };

  const handleDeleteTransaction = (id: string) => {
    const txToDelete = transactions.find(t => t.id === id);
    if (!txToDelete) return;

    if (txToDelete.isSplit && txToDelete.parentId) {
        const group = transactions.filter(t => t.parentId === txToDelete.parentId);
        if (group.length > 1 && window.confirm('這筆帳目屬於分裝群組，是否要刪除整個分裝群組？')) {
            setTransactions(prev => prev.filter(t => t.parentId !== txToDelete.parentId));
            setLastDeletedTransaction(null);
            deleteTransactionsByParentId(txToDelete.parentId).catch(err => console.error('刪除群組失敗', err));
            return;
        }
    }

    setLastDeletedTransaction(txToDelete);
    setLastCanceledSplit(null);
    setTransactions(prev => prev.filter(t => t.id !== id));
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = window.setTimeout(() => setLastDeletedTransaction(null), 3000);
    dbDeleteTransaction(id).catch(err => console.error('刪除交易失敗', err));
  };

  const handleUndoDelete = () => {
    if (!lastDeletedTransaction) return;
    setTransactions(prev => [...prev, lastDeletedTransaction]);
    setLastDeletedTransaction(null);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    if (userId) upsertTransaction(userId, lastDeletedTransaction).catch(err => console.error('復原刪除失敗', err));
  };

  const handleAddTransaction = () => {
    const today = new Date().toISOString().split('T')[0];
    setEditingTransaction({ id: uuidv4(), date: today, merchant: '', amount: 0, originalText: 'Manual Add', type: 'expense', category: { l1: L1Category.VARIABLE, l2: STANDARD_CATEGORIES[L1Category.VARIABLE][0], l3: '' }, confidence: 1.0, isVerified: true, isSplit: false });
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
      if (userId) upsertTransactions(userId, newUnique).catch(err => console.error('匯入儲存失敗', err));
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
                else { const existingIds = new Set(transactions.map(t => t.id)); const newUnique = importedTransactions.filter((t: any) => t.id && !existingIds.has(t.id)); if (newUnique.length > 0) { setTransactions(prev => [...prev, ...newUnique]); alert(`成功匯入 ${newUnique.length} 筆資料！`); if (userId) upsertTransactions(userId, newUnique).catch(err => console.error('匯入儲存失敗', err)); } else alert("匯入的資料似乎已存在 😿"); }
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

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-white rounded-[40px] shadow-xl border border-orange-50 p-10">
          <h1 className="text-xl font-extrabold text-slate-700 mb-3">尚未設定 Supabase</h1>
          <p className="text-slate-400 font-medium">請在 .env.local 填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY，然後重新啟動 (npm run dev)。</p>
        </div>
      </div>
    );
  }
  if (authLoading) {
    return <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center text-slate-300 font-bold">載入中...</div>;
  }
  if (!session) {
    return <Auth />;
  }
  if (dataLoading) {
    return <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center text-slate-300 font-bold">讀取你的帳戶跟交易紀錄中...</div>;
  }

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
          <button onClick={() => setIsAccountsModalOpen(true)} className="w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-300 font-bold group border-2 border-transparent text-slate-400 hover:bg-sky-50 hover:text-sky-500"><Wallet className="w-6 h-6" /><span className="hidden lg:block">帳戶管理</span></button>
        </nav>
        <div className="px-4">
          <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-300 font-bold text-slate-300 hover:bg-rose-50 hover:text-rose-400"><LogOut className="w-6 h-6" /><span className="hidden lg:block">登出</span></button>
        </div>
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
                 <button onClick={() => setTransferModalState({ open: true })} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-sky-400 hover:bg-sky-500 rounded-2xl transition active:scale-95 shadow-md shadow-sky-100"><Repeat className="w-4 h-4" />轉帳</button>
                 <button onClick={handleImportPendingCtbcTransfers} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-400 hover:bg-indigo-500 rounded-2xl transition active:scale-95 shadow-md shadow-indigo-100" title="一次性：補匯入中信對帳單分析出的25筆轉帳"><Repeat className="w-4 h-4" />補匯入轉帳(一次性)</button>
                 <button onClick={handleApplyDiscountCorrections} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-purple-400 hover:bg-purple-500 rounded-2xl transition active:scale-95 shadow-md shadow-purple-100" title="一次性：把已匯入775筆資料的商家欄位拆成商家/備註/折扣格式"><Receipt className="w-4 h-4" />修正折扣格式(一次性)</button>
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
                      const t = item.data!;
                      if (t.type === 'transfer') {
                        const fromName = accounts.find(a => a.id === t.fromAccountId)?.name || '?';
                        const toName = accounts.find(a => a.id === t.toAccountId)?.name || '?';
                        return (
                          <tr key={t.id} className="transition hover:bg-sky-50/30 bg-sky-50/10">
                            <td className="p-6">{t.date}</td>
                            <td className="p-6 font-bold">{t.merchant}</td>
                            <td className="p-6"><span className="px-2 py-1 bg-sky-100 text-sky-600 rounded text-xs font-bold">轉帳 &bull; {fromName} → {toName}</span></td>
                            <td className="p-6 text-right font-bold text-sky-600">${t.amount}</td>
                            <td className="p-6 text-center no-print">
                              <div className="flex justify-center gap-2">
                                <button onClick={() => setTransferModalState({ open: true, transaction: t })} className="p-2 border rounded-xl hover:bg-amber-50" title="編輯轉帳"><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => handleDeleteTransaction(t.id)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="刪除項目"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={t.id} className={`transition group ${t.type === 'income' ? 'bg-emerald-50/20' : 'hover:bg-orange-50/30'}`}>
                          <td className="p-6">{t.date}</td>
                          <td className="p-6 font-bold">
                            {t.merchant}
                            {t.note && <span className="block text-xs font-normal text-slate-400 mt-0.5">{t.note}</span>}
                            {t.discounts && t.discounts.length > 0 && (
                              <span className="block text-[11px] font-normal text-amber-500 mt-0.5">原始${t.grossAmount} － 折扣${t.discounts.reduce((s, d) => s + d.amount, 0)}</span>
                            )}
                          </td>
                          <td className="p-6"><span className="px-2 py-1 bg-slate-100 rounded text-xs">{CATEGORY_LABELS[t.category.l1]} &bull; {t.category.l2}</span></td>
                          <td className={`p-6 text-right font-bold ${t.type === 'income' ? 'text-emerald-500' : 'text-slate-700'}`}>{t.type === 'income' ? '+' : '-'}${t.amount}</td>
                          <td className="p-6 text-center no-print">
                            <div className="flex justify-center gap-2">
                              <button onClick={() => setSplittingTransaction(t)} className="p-2 border rounded-xl hover:bg-purple-50 text-purple-400" title="拆帳分類"><Divide className="w-4 h-4" /></button>
                              <button onClick={() => setEditingTransaction(t)} className="p-2 border rounded-xl hover:bg-amber-50" title="編輯項目"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteTransaction(t.id)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="刪除項目"><Trash2 className="w-4 h-4" /></button>
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
      {editingTransaction && <EditTransactionModal transaction={editingTransaction} allTransactions={transactions} accounts={accounts} customCategoryHistory={customCategoryHistory} onTagAction={handleTagAction} onClose={() => setEditingTransaction(null)} onSave={handleEditSave} />}
      {transferModalState.open && <TransferModal accounts={accounts} transaction={transferModalState.transaction} onClose={() => setTransferModalState({ open: false })} onSave={handleTransferSave} />}
      {isAccountsModalOpen && <AccountsModal accounts={accounts} onClose={() => setIsAccountsModalOpen(false)} onSave={handleSaveAccount} onArchive={handleArchiveAccount} />}
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
