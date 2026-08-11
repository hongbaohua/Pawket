
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { List, PieChart as PieIcon, Pencil, ArrowUpRight, ArrowDownRight, TrendingUp, Download, Upload, Cat, PawPrint, Fish, Coffee, Home, Utensils, Car, PiggyBank, Wallet, Plus, Trash2, RotateCcw, Target, Search, X, Filter, ChevronDown, ChevronUp, CornerDownRight, CreditCard, Coins, Divide, Undo2, LogOut, Repeat, FileSearch, History, Settings, Copy } from 'lucide-react';
import Dashboard from './components/Dashboard';
import ReconcileView from './components/ReconcileView';
import SplitModal from './components/SplitModal';
import EditTransactionModal from './components/EditTransactionModal';
import BatchCorrectionModal from './components/BatchCorrectionModal';
import WishlistModal from './components/WishlistModal';
import TrashModal from './components/TrashModal';
import CategoryMappingModal from './components/CategoryMappingModal';
import Auth from './components/Auth';
import AccountsModal from './components/AccountsModal';
import TransferModal from './components/TransferModal';
import SharedExpenseModal from './components/SharedExpenseModal';
import SharedExpenseListModal from './components/SharedExpenseListModal';
import ActivityLogModal from './components/ActivityLogModal';
import SettingsModal from './components/SettingsModal';
import { Transaction, Account, Budget, Alert, L1Category, CATEGORY_LABELS, TimeScope, WishlistItem, WishlistSettings, STANDARD_CATEGORIES, PenaltyConfig, SpecialTag, MerchantAlias, ReconcileStatus, SharedExpense, SharedExpenseParticipant, ActivityLogEntry, LongTermReserve } from './types';
import { generateMonthlyPacingAlerts, getDateRange, findSimilarTransactions, calculateWishlistMetrics } from './services/logicService';
import { INITIAL_BUDGETS, DEFAULT_PENALTY_CONFIG } from './config/financialRules';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';
import {
  seedDefaultAccountsIfEmpty, fetchTransactions, createAccount, updateAccount, archiveAccount,
  upsertTransaction, upsertTransactions, deleteTransaction as dbDeleteTransaction, deleteTransactionsByParentId,
  deleteAllTransactions, fetchWishlistItems, upsertWishlistItems, deleteWishlistItem as dbDeleteWishlistItem,
  fetchDeletedTransactions, restoreTransaction, permanentlyDeleteTransaction,
  fetchMerchantAliases, upsertMerchantAlias, setReconcileStatus as dbSetReconcileStatus,
  fetchSharedExpenses, upsertSharedExpense,
  fetchActivityLog, insertActivityLog, markActivityLogRestored
} from './lib/db';
import type { Session } from '@supabase/supabase-js';
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

// 罐罐明細本列表用：帳戶/分類標籤化顏色。帳戶照類型上色（跟AccountsModal/AccountBalances
// 「現金→衍生資產」分組概念一致），分類照L1大類上色，不要全部都同一種灰色格式。
const ACCOUNT_TYPE_TAG_STYLE: Record<string, string> = {
  cash: 'bg-slate-100 text-slate-600',
  bank_debit: 'bg-blue-100 text-blue-600',
  bank_credit: 'bg-rose-100 text-rose-600',
  e_wallet: 'bg-purple-100 text-purple-600',
  stored_value: 'bg-amber-100 text-amber-600',
};
const L1_TAG_STYLE: Record<L1Category, string> = {
  [L1Category.FIXED]: 'bg-slate-100 text-slate-600',
  [L1Category.VARIABLE]: 'bg-amber-100 text-amber-600',
  [L1Category.INVESTMENT]: 'bg-emerald-100 text-emerald-600',
  [L1Category.INCOME]: 'bg-teal-100 text-teal-600',
};

// 把 Supabase/PostgREST 錯誤物件整理成一段能直接讀、直接複製貼給人看的文字，
// 不用再叫使用者去挖主控台、展開物件——Ivy反應這步驟太麻煩，改成直接顯示在alert裡。
const formatSupabaseError = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string | null; hint?: string | null; code?: string };
    const lines: string[] = [];
    if (e.code) lines.push(`錯誤代碼：${e.code}`);
    if (e.message) lines.push(`訊息：${e.message}`);
    if (e.details) lines.push(`詳情：${e.details}`);
    if (e.hint) lines.push(`提示：${e.hint}`);
    if (lines.length > 0) return lines.join('\n');
  }
  return `未知錯誤：${String(err)}`;
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

  // 記住目前在哪一頁，重新整理不要跳回首頁（Ivy 2026-08-03反應：在明細本/對帳
  // 頁面重新整理，畫面卻整個跳回貓咪指揮中心，很容易搞丟正在看的內容）。
  const [view, setView] = useState<'dashboard' | 'transactions' | 'reconcile'>(() => {
    const saved = localStorage.getItem('pawket_view');
    return saved === 'transactions' || saved === 'reconcile' ? saved : 'dashboard';
  });
  useEffect(() => { localStorage.setItem('pawket_view', view); }, [view]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [merchantAliases, setMerchantAliases] = useState<MerchantAlias[]>([]);
  const [sharedExpenses, setSharedExpenses] = useState<SharedExpense[]>([]);
  // 共同支出／代墊分帳(階段7)：正在設定分攤明細的交易(開EditTransactionModal時的「設定
  // 分攤明細」按鈕觸發)，跟「應收應付總覽」清單彈窗，是兩個獨立的入口但共用同一份資料。
  const [managingSharedExpenseTx, setManagingSharedExpenseTx] = useState<Transaction | null>(null);
  const [isSharedExpenseListOpen, setIsSharedExpenseListOpen] = useState(false);
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
        const [accs, txs, wishlist, aliases, shared] = await Promise.all([
          seedDefaultAccountsIfEmpty(userId),
          fetchTransactions(),
          fetchWishlistItems(),
          fetchMerchantAliases(),
          fetchSharedExpenses(),
        ]);
        if (!cancelled) {
          setAccounts(accs);
          setTransactions(txs);
          setWishlistItems(wishlist);
          setMerchantAliases(aliases);
          setSharedExpenses(shared);
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

  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [isWishlistModalOpen, setIsWishlistModalOpen] = useState(false);

  // 安全水位設定：存在 Supabase Auth 的 user_metadata（跟暱稱同一套機制），沒設定過就是0/0，
  // WishlistModal 裡會提示一組「不會太緊迫」的建議值讓她套用。
  const wishlistSettings: WishlistSettings = {
      dailyBuffer: session?.user.user_metadata?.wishlistDailyBuffer ?? 0,
      emergencyFund: session?.user.user_metadata?.wishlistEmergencyFund ?? 0,
  };
  const handleUpdateWishlistSettings = async (settings: WishlistSettings) => {
      const { error } = await supabase.auth.updateUser({ data: { wishlistDailyBuffer: settings.dailyBuffer, wishlistEmergencyFund: settings.emergencyFund } });
      if (error) { console.error('更新願望清單安全水位失敗', error); alert('儲存失敗，請檢查主控台錯誤訊息。'); }
  };

  // 系統設定：一樣存在 user_metadata。目前只有這一個開關，2026-08-06 Ivy反應她的舊資料已經
  // 整理得差不多，不太需要「喵喵發現了N筆相似交易」這個提醒，但保留功能給以後的新帳戶/新用戶用，
  // 所以預設是開著的(undefined視同true)，只有明確存過false才是關閉。
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const similarTransactionAlertsEnabled = session?.user.user_metadata?.similarTransactionAlertsEnabled !== false;
  const handleUpdateSimilarTransactionAlerts = async (enabled: boolean) => {
      const { error } = await supabase.auth.updateUser({ data: { similarTransactionAlertsEnabled: enabled } });
      if (error) { console.error('更新相似交易提醒設定失敗', error); alert('儲存失敗，請檢查主控台錯誤訊息。'); }
  };

  // 分類月預算：跟安全水位/相似交易提醒同一套user_metadata持久化機制。2026-08-11新增，
  // 取代原本自動用歷史中位數外推的配速警示——只有Ivy自己在系統設定裡確認過預算的分類，
  // 「需立即關注的項目」才會拿它來比對，見services/logicService.ts的generateMonthlyPacingAlerts。
  // 用useMemo包住：沒設定過時的`?? {}`如果每次render都產生新的物件參考，會讓下面依賴
  // categoryBudgets的useEffect無限觸發(setState→re-render→新物件→再觸發useEffect)，
  // 用useMemo確保底層資料沒變時參考保持穩定。
  const categoryBudgets: Record<string, number> = useMemo(
    () => session?.user.user_metadata?.categoryBudgets ?? {},
    [session?.user.user_metadata?.categoryBudgets]
  );
  const handleUpdateCategoryBudgets = async (budgets: Record<string, number>) => {
      const { error } = await supabase.auth.updateUser({ data: { categoryBudgets: budgets } });
      if (error) { console.error('更新分類預算失敗', error); alert('儲存失敗，請檢查主控台錯誤訊息。'); }
  };

  // 長期預留支出：同上，存在user_metadata，同樣用useMemo避免無限render。用來把保險費/
  // 稅務規費這類年繳/半年繳的大額支出換算成月均攤金額，加進calculateSuggestedReserves
  // 的日常開銷保留建議值裡。
  const longTermReserves: LongTermReserve[] = useMemo(
    () => session?.user.user_metadata?.longTermReserves ?? [],
    [session?.user.user_metadata?.longTermReserves]
  );
  const handleUpdateLongTermReserves = async (reserves: LongTermReserve[]) => {
      const { error } = await supabase.auth.updateUser({ data: { longTermReserves: reserves } });
      if (error) { console.error('更新長期預留支出失敗', error); alert('儲存失敗，請檢查主控台錯誤訊息。'); }
  };

  // 願望清單的新增/編輯/刪除/排序全部都是透過整份陣列替換（見 WishlistModal），
  // 所以同步邏輯統一放在這裡：先比對舊清單找出被刪掉的id單獨刪除，剩下的整份用陣列順序
  // 重新 upsert sort_order。畫面先樂觀更新，資料庫失敗才跳出來，不要讓她以為存好了其實沒存到。
  const handleUpdateWishlistItems = async (newItems: WishlistItem[]) => {
      const removedIds = wishlistItems.filter(old => !newItems.some(n => n.id === old.id)).map(i => i.id);
      setWishlistItems(newItems);
      if (!userId) return;
      try {
          for (const id of removedIds) await dbDeleteWishlistItem(id);
          await upsertWishlistItems(userId, newItems);
      } catch (err) {
          console.error('願望清單儲存失敗', err);
          alert(`願望清單儲存失敗！畫面上的變更可能沒有存進資料庫。\n\n${formatSupabaseError(err)}`);
      }
  };

  const topWishlistItem = useMemo(() => {
      return wishlistItems.find(i => !i.isPurchased) || null;
  }, [wishlistItems]);

  const sidebarWishlistMetrics = useMemo(() => {
      if (!topWishlistItem) return null;
      return calculateWishlistMetrics(wishlistItems, accounts, transactions, wishlistSettings.dailyBuffer, wishlistSettings.emergencyFund).items[topWishlistItem.id];
  }, [wishlistItems, accounts, transactions, wishlistSettings.dailyBuffer, wishlistSettings.emergencyFund, topWishlistItem]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTagFilters, setSelectedTagFilters] = useState<Set<string>>(new Set());
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [splittingTransaction, setSplittingTransaction] = useState<Transaction | null>(null);
  // 罐罐明細本列表：品項/備註太長會把列高撐得很高，預設收合只顯示前幾個/第一行，點了才展開全部。
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const toggleRowExpanded = (id: string) => setExpandedRowIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  // 對帳模組「新增這筆」流程用：記著這次開EditTransactionModal是為了補一列銀行對帳單的
  // missing_manual資料，存檔成功後要順便把這次確認的商家名稱學起來，記進商家別名候選清單。
  const [pendingAliasLearn, setPendingAliasLearn] = useState<{ officialPattern: string; accountId?: string } | null>(null);
  const [transferModalState, setTransferModalState] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  const [batchCandidates, setBatchCandidates] = useState<Transaction[]>([]);
  const [batchSource, setBatchSource] = useState<Transaction | null>(null);
  const [pendingImportTxs, setPendingImportTxs] = useState<Transaction[]>([]);
  const [conflictCategories, setConflictCategories] = useState<{key: string, originalL1: string, originalL2: string, count: number}[]>([]);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  
  // Undo States
  const [lastDeletedTransaction, setLastDeletedTransaction] = useState<Transaction | null>(null);
  const [lastCanceledSplit, setLastCanceledSplit] = useState<{ originalTxs: Transaction[], restoredTx: Transaction } | null>(null);
  // 批次修正(BatchCorrectionModal)套用後的復原快照：Ivy 2026-08-02反應誤觸批次套用後
  // 完全不知道改了什麼，垃圾桶功能只救得回「刪除」，這種「大動作編輯」也該有類似的
  // 復原機制，記下套用前的版本，一段時間內可以一鍵復原。
  const [lastBatchUpdate, setLastBatchUpdate] = useState<{ before: Transaction[]; description: string } | null>(null);

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

  const toggleTagFilter = (tag: string) => {
      setSelectedTagFilters(prev => {
          const next = new Set(prev);
          if (next.has(tag)) next.delete(tag); else next.add(tag);
          return next;
      });
  };

  const processedTransactions = useMemo(() => {
      let result = [...transactions];
      if (searchTerm.trim()) {
          const lowerTerm = searchTerm.toLowerCase();
          // 原本沒有搜尋 note/品項/代購對象/代購性質標籤本身，Ivy把「代購」兩個字從商家/
          // 品項文字移除、改成直接選「代購」性質後，搜尋「代購」完全找不到——因為
          // specialTag.type本身(proxy_purchase/work_advance)從來沒有被搜尋比對過，
          // 只搜了counterparty/note這些附加文字。這裡把性質對應的中文標籤也加進搜尋範圍。
          const specialTagLabel = (tag?: SpecialTag) => tag?.type === 'proxy_purchase' ? '代購' : tag?.type === 'work_advance' ? '工作代墊' : tag?.type === 'personal_loan' ? '借貸' : '';
          result = result.filter(t =>
              t.merchant.toLowerCase().includes(lowerTerm) ||
              (t.originalText || '').toLowerCase().includes(lowerTerm) ||
              (t.note || '').toLowerCase().includes(lowerTerm) ||
              (t.items || []).some(it => it.name.toLowerCase().includes(lowerTerm) || (it.note || '').toLowerCase().includes(lowerTerm)) ||
              specialTagLabel(t.specialTag).includes(searchTerm.trim()) ||
              (t.specialTag?.counterparty || '').toLowerCase().includes(lowerTerm) ||
              (t.specialTag?.note || '').toLowerCase().includes(lowerTerm) ||
              t.category.l1.toLowerCase().includes(lowerTerm) ||
              t.category.l2.toLowerCase().includes(lowerTerm) ||
              (t.category.l3 || '').toLowerCase().includes(lowerTerm)
          );
      }
      if (selectedTagFilters.size > 0) {
          result = result.filter(t => selectedTagFilters.has(t.category.l2) || selectedTagFilters.has(t.category.l3));
      }
      return result.sort((a, b) => {
          const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (dateDiff !== 0) return dateDiff;
          // 同一天內也要新的在前面，不然「日期倒敘、但同一天內卻是正序」邏輯會不一致。
          // 這裡故意不用 localeCompare 比較 ISO 時間字串——localeCompare是locale-aware比對，
          // 對含冒號/句點的時間字串不保證是純字典順序，Ivy實測發現同一批建立時間完全相同的
          // 資料，排序還是忽前忽後，用Date數字比較才是真正可靠的做法。
          const createdDiff = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
          return createdDiff;
      });
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
        const newAlerts = generateMonthlyPacingAlerts(filteredTransactions, dateRange.startDate, dateRange.endDate, categoryBudgets);
        setAlerts(newAlerts);
    } else {
        setAlerts([]);
    }
  }, [filteredTransactions, dateRange, timeScope, categoryBudgets]);

  useEffect(() => {
    const click = (e: MouseEvent) => { if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setIsAddMenuOpen(false); };
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  useEffect(() => {
    const click = (e: MouseEvent) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setIsUserMenuOpen(false); };
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

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

  const handleEditSave = (updatedTx: Transaction, options?: { openSplitAfter?: boolean; additionalTransfer?: Transaction }) => {
    setTransactions(prev => {
      const next = prev.some(t => t.id === updatedTx.id) ? prev.map(t => t.id === updatedTx.id ? updatedTx : t) : [updatedTx, ...prev];
      return options?.additionalTransfer ? [options.additionalTransfer, ...next] : next;
    });
    setEditingTransaction(null);
    // 新增流程第3步問過「要不要分裝拆帳」，選是的話存檔後直接接著開分裝盤，不用存完再回去找按鈕點。
    if (options?.openSplitAfter) {
        setSplittingTransaction(updatedTx);
    } else if (similarTransactionAlertsEnabled) {
        const candidates = findSimilarTransactions(updatedTx, transactions);
        if (candidates.length > 0) {
            setBatchSource(updatedTx);
            setBatchCandidates(candidates);
        }
    }
    if (userId) {
      upsertTransaction(userId, updatedTx).catch(err => console.error('儲存交易失敗', err));
      // 當場儲值：連帶產生的那筆帳戶互轉也要一併存進資料庫，不然重整頁面就消失了。
      if (options?.additionalTransfer) {
        upsertTransaction(userId, options.additionalTransfer).catch(err => console.error('儲存儲值交易失敗', err));
      }
    }
    // 對帳模組「新增這筆」流程：這次存檔如果是為了補一列銀行對帳單資料，把這次確認的
    // 商家名稱學起來（既有候選+1次，或新增一筆候選），下次同樣的銀行代碼出現時就有
    // 建議可以選（商家別名的「問一次、記住」第三層邏輯）。
    if (pendingAliasLearn && updatedTx.merchant.trim() && userId) {
      const pattern = pendingAliasLearn.officialPattern;
      const scopeAccountId = pendingAliasLearn.accountId;
      const merchantName = updatedTx.merchant.trim();
      const existing = merchantAliases.find(a => a.officialPattern === pattern && (a.accountId || undefined) === scopeAccountId);
      const nextAlias: MerchantAlias = existing
        ? {
            ...existing,
            candidates: existing.candidates.some(c => c.userMerchant === merchantName)
              ? existing.candidates.map(c => c.userMerchant === merchantName ? { ...c, count: c.count + 1 } : c)
              : [...existing.candidates, { userMerchant: merchantName, count: 1 }],
          }
        : { id: uuidv4(), officialPattern: pattern, candidates: [{ userMerchant: merchantName, count: 1 }], accountId: scopeAccountId };
      setMerchantAliases(prev => [...prev.filter(a => a.id !== nextAlias.id), nextAlias]);
      upsertMerchantAlias(userId, nextAlias).catch(err => console.error('儲存商家別名失敗', err));
    }
    setPendingAliasLearn(null);
  };

  // 對帳模組用：從一列銀行對帳單資料開「新增交易」，日期/金額/帳戶先幫Ivy帶好。
  // officialPattern有值的話代表這次存檔要順便學商家別名（見上面handleEditSave）。
  const handleAddFromBankRow = (prefilled: Transaction, officialPattern?: string) => {
    setPendingAliasLearn(officialPattern ? { officialPattern, accountId: prefilled.accountId } : null);
    setEditingTransaction(prefilled);
  };

  // 共同支出／代墊分帳(階段7)用：EditTransactionModal的「設定分攤明細」存檔時呼叫，
  // 順便寫入的settlement交易(如果有勾「順便記交易」)一起存進transactions。
  const handleSaveSharedExpense = (expense: SharedExpense, additionalSettlements: Transaction[]) => {
    setSharedExpenses(prev => {
      const exists = prev.some(se => se.id === expense.id);
      return exists ? prev.map(se => se.id === expense.id ? expense : se) : [...prev, expense];
    });
    if (additionalSettlements.length > 0) {
      setTransactions(prev => [...additionalSettlements, ...prev]);
    }
    setManagingSharedExpenseTx(null);
    if (userId) {
      upsertSharedExpense(userId, expense).catch(err => console.error('儲存分攤明細失敗', err));
      additionalSettlements.forEach(tx => {
        upsertTransaction(userId, tx).catch(err => console.error('儲存結算交易失敗', err));
      });
    }
  };

  // 應收應付總覽清單「標記已結清」用：更新對應SharedExpense裡的那一個參與者，
  // 整份SharedExpense重送(upsertSharedExpense本來就是整份參與者陣列replace的設計)。
  const handleSettleSharedExpenseParticipant = (sharedExpenseId: string, participant: SharedExpenseParticipant, additionalSettlement?: Transaction) => {
    const target = sharedExpenses.find(se => se.id === sharedExpenseId);
    if (!target) return;
    const updatedExpense: SharedExpense = {
      ...target,
      participants: target.participants.map(p => p.id === participant.id ? participant : p),
    };
    setSharedExpenses(prev => prev.map(se => se.id === sharedExpenseId ? updatedExpense : se));
    if (additionalSettlement) {
      setTransactions(prev => [additionalSettlement, ...prev]);
    }
    if (userId) {
      upsertSharedExpense(userId, updatedExpense).catch(err => console.error('更新分攤結清狀態失敗', err));
      if (additionalSettlement) {
        upsertTransaction(userId, additionalSettlement).catch(err => console.error('儲存結算交易失敗', err));
      }
    }
  };

  // 對帳模組用：把比對結果(matched/pending_settlement/missing_official)寫回對應交易，
  // 畫面先樂觀更新，背景才真的寫進Supabase。
  const handleApplyReconcileStatuses = (updates: { transactionId: string; status: ReconcileStatus }[]) => {
    if (updates.length === 0) return;
    setTransactions(prev => prev.map(t => {
      const u = updates.find(x => x.transactionId === t.id);
      return u ? { ...t, reconcileStatus: u.status } : t;
    }));
    Promise.all(updates.map(u => dbSetReconcileStatus(u.transactionId, u.status)))
      .catch(err => console.error('更新對帳狀態失敗', err));
  };

  const handleTransferSave = (tx: Transaction) => {
    setTransactions(prev => prev.some(t => t.id === tx.id) ? prev.map(t => t.id === tx.id ? tx : t) : [tx, ...prev]);
    setTransferModalState({ open: false });
    if (userId) upsertTransaction(userId, tx).catch(err => console.error('儲存轉帳失敗', err));
  };

  // 清除所有紀錄：全面重整用，只刪 transactions、不動 accounts。要求輸入確認文字才會真的執行。
  const handleClearAllRecords = async () => {
    if (!userId) return;
    const input = window.prompt(
      '這個動作會刪除所有交易紀錄（帳戶本身不會被刪），且無法復原！\n' +
      '建議先點右邊的「備份」按鈕匯出目前資料存檔。\n\n' +
      '確定要繼續的話，請在下面輸入「清除所有紀錄」四個字：'
    );
    if (input === null) return;
    if (input !== '清除所有紀錄') { alert('輸入文字不符，已取消，沒有刪除任何資料。'); return; }
    try {
      await deleteAllTransactions(userId);
      setTransactions([]);
      alert('已清除所有交易紀錄。');
    } catch (err) {
      console.error('清除所有紀錄失敗', err);
      alert('清除失敗，請檢查主控台錯誤訊息。');
    }
  };

  // 配對帳戶：全面重整用，取代之前5個個別的一次性按鈕。只靠 originalText/merchant
  // 字串解析配對，不依賴任何匯入當下才存在的暫時欄位，任何時間點都能安全重跑。
  // 規則細節見 專案文件/PROJECT_STATUS.md 第5.8節。
  const handleMatchAllAccounts = async () => {
    if (!userId) return;
    const byName = (name: string) => accounts.find(a => a.name === name && !a.isArchived);
    const paymentTagToAccountName: Record<string, string | null> = {
      '不指定': null, // 文化幣、姊姊的卡付的錢，不歸Ivy自己的任何帳戶
      '中華郵政低信心': '中華郵政',
      '中華郵政': '中華郵政',
      '二技悠遊卡': '二技悠遊卡',
      '五專悠遊卡': '五專悠遊卡',
      '悠遊付錢包': '悠遊付錢包',
      'MyCard': 'MyCard',
      '麥當勞點點卡': '麥當勞點點卡',
    };

    const updated: Transaction[] = [];
    const missingAccountNames = new Set<string>();

    for (const t of transactions) {
      if (t.type === 'transfer') {
        if (t.fromAccountId && t.toAccountId) continue;
        const m = t.merchant.match(/^帳戶互轉：(.+?) → (.+)$/);
        if (!m) continue;
        const fromAcc = byName(m[1]);
        const toAcc = byName(m[2]);
        if (!fromAcc) missingAccountNames.add(m[1]);
        if (!toAcc) missingAccountNames.add(m[2]);
        if (!fromAcc || !toAcc) continue;
        updated.push({ ...t, fromAccountId: fromAcc.id, toAccountId: toAcc.id });
        continue;
      }
      if (t.accountId) continue;
      const tagMatch = t.originalText?.match(/\(支付:([^)]+)\)/);
      if (tagMatch) {
        const targetName = paymentTagToAccountName[tagMatch[1]];
        if (targetName === undefined) { missingAccountNames.add(`未知標籤:${tagMatch[1]}`); continue; }
        if (targetName === null) continue; // 不指定，故意跳過不配對帳戶
        const acc = byName(targetName);
        if (!acc) { missingAccountNames.add(targetName); continue; }
        updated.push({ ...t, accountId: acc.id });
        continue;
      }
      let targetName: string | null = null;
      if (t.originalText?.startsWith('中信對帳單匯入')) targetName = '中國信託';
      else if (t.originalText?.startsWith('中華郵政對帳單匯入') || t.originalText?.startsWith('VISA金融卡對帳單')) targetName = '中華郵政';
      else if (t.originalText?.startsWith('現金支出日記帳匯入')) targetName = '現金';
      else if (t.originalText?.startsWith('二技悠遊卡餘額分頁匯入')) targetName = '二技悠遊卡';
      if (!targetName) continue;
      const acc = byName(targetName);
      if (!acc) { missingAccountNames.add(targetName); continue; }
      updated.push({ ...t, accountId: acc.id });
    }

    if (updated.length > 0) {
      const updatedIds = new Set(updated.map(u => u.id));
      setTransactions(prev => prev.map(t => updatedIds.has(t.id) ? updated.find(u => u.id === t.id)! : t));
      try {
        await upsertTransactions(userId, updated);
      } catch (err) {
        console.error('配對帳戶失敗', err);
        alert(`配對失敗！\n\n${formatSupabaseError(err)}`);
        return;
      }
    }

    if (missingAccountNames.size > 0) {
      alert(
        `已配對 ${updated.length} 筆交易。\n\n` +
        `但找不到以下帳戶，這些交易先跳過沒配對，請先在碗盤總覽建立好同名帳戶再重新點一次這顆按鈕：\n` +
        [...missingAccountNames].join('、')
      );
    } else if (updated.length === 0) {
      alert('沒有需要配對的交易，可能都已經配對過了。');
    } else {
      alert(`已配對 ${updated.length} 筆交易的帳戶！`);
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
      const before = transactions.filter(t => selectedIds.includes(t.id));
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
      // 套用後要讓Ivy知道實際改了什麼＋可以復原，不然像垃圾桶只救得回刪除，這種
      // 「一次改很多筆」的大動作編輯沒有安全網（2026-08-02 Ivy誤觸後反應的問題）。
      // 兩層安全網：8秒內的浮動提示是「馬上發現手滑」用的快速復原；同時寫進
      // activity_log是「事後才想起來」用的，隨時可以在「編輯歷程」裡回頭復原。
      const { l1, l2, l3 } = batchSource.category;
      const description = `已把 ${selectedIds.length} 筆交易改成「${batchSource.merchant} → ${CATEGORY_LABELS[l1]}／${l2}${l3 ? `／${l3}` : ''}」`;
      setLastBatchUpdate({ before, description });
      setLastDeletedTransaction(null);
      setLastCanceledSplit(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = window.setTimeout(() => setLastBatchUpdate(null), 8000);
      if (userId) {
          insertActivityLog(userId, { actionType: 'batch_correction', description, affectedTransactionIds: selectedIds, beforeSnapshot: before })
              .catch(err => console.error('寫入編輯歷程失敗', err));
      }
  };

  const handleUndoBatchUpdate = () => {
      if (!lastBatchUpdate) return;
      const { before } = lastBatchUpdate;
      const beforeIds = new Set(before.map(t => t.id));
      setTransactions(prev => prev.map(t => beforeIds.has(t.id) ? before.find(b => b.id === t.id)! : t));
      setLastBatchUpdate(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      if (userId) {
          upsertTransactions(userId, before).catch(err => console.error('復原批次更新失敗', err));
      }
  };

  // 刪除一律先跳二次確認（Ivy手滑誤刪過一次），實際刪除是軟刪除(deleted_at)，
  // 資料還在資料庫裡，垃圾桶(見下方handleOpenTrash)可以救回，不是真的永久移除。
  const handleDeleteTransaction = (id: string) => {
    const txToDelete = transactions.find(t => t.id === id);
    if (!txToDelete) return;

    if (txToDelete.isSplit && txToDelete.parentId) {
        const group = transactions.filter(t => t.parentId === txToDelete.parentId);
        if (group.length > 1) {
            if (!window.confirm('這筆帳目屬於分裝群組，是否要刪除整個分裝群組？（可以之後去垃圾桶救回）')) return;
            setTransactions(prev => prev.filter(t => t.parentId !== txToDelete.parentId));
            setLastDeletedTransaction(null);
            deleteTransactionsByParentId(txToDelete.parentId).catch(err => console.error('刪除群組失敗', err));
            return;
        }
    }

    if (!window.confirm(`確定要刪除「${txToDelete.merchant || '這筆'}」紀錄嗎？（可以之後去垃圾桶救回）`)) return;

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
    restoreTransaction(lastDeletedTransaction.id).catch(err => console.error('復原刪除失敗', err));
  };

  // 垃圾桶：讀取所有軟刪除的交易，供 TrashModal 顯示/救回/永久刪除。
  const [isTrashModalOpen, setIsTrashModalOpen] = useState(false);
  const [deletedTransactions, setDeletedTransactions] = useState<Transaction[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const handleOpenTrash = async () => {
    setIsTrashModalOpen(true);
    setTrashLoading(true);
    try {
        setDeletedTransactions(await fetchDeletedTransactions());
    } catch (err) {
        console.error('讀取垃圾桶失敗', err);
        alert(`讀取垃圾桶失敗。\n\n${formatSupabaseError(err)}`);
    } finally {
        setTrashLoading(false);
    }
  };
  const handleRestoreFromTrash = async (id: string) => {
    try {
        await restoreTransaction(id);
        const restored = deletedTransactions.find(t => t.id === id);
        setDeletedTransactions(prev => prev.filter(t => t.id !== id));
        if (restored) setTransactions(prev => [...prev, restored]);
    } catch (err) {
        console.error('救回失敗', err);
        alert(`救回失敗。\n\n${formatSupabaseError(err)}`);
    }
  };
  const handlePermanentlyDelete = async (id: string) => {
    const tx = deletedTransactions.find(t => t.id === id);
    if (!window.confirm(`確定要永久刪除「${tx?.merchant || '這筆'}」嗎？這次真的沒辦法救回了。`)) return;
    try {
        await permanentlyDeleteTransaction(id);
        setDeletedTransactions(prev => prev.filter(t => t.id !== id));
    } catch (err) {
        console.error('永久刪除失敗', err);
        alert(`永久刪除失敗。\n\n${formatSupabaseError(err)}`);
    }
  };

  // 編輯歷程：目前只記錄批次修正這種大動作編輯，讀取邏輯比照垃圾桶（開啟時才抓，
  // 不用一直放在記憶體裡）。
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const handleOpenActivityLog = async () => {
    setIsActivityLogOpen(true);
    setActivityLogLoading(true);
    try {
        setActivityLog(await fetchActivityLog());
    } catch (err) {
        console.error('讀取編輯歷程失敗', err);
        alert(`讀取重新裝碗紀錄失敗。\n\n${formatSupabaseError(err)}`);
    } finally {
        setActivityLogLoading(false);
    }
  };
  const handleRestoreActivityLog = async (entry: ActivityLogEntry) => {
    if (!window.confirm(`確定要復原「${entry.description}」嗎？會把這 ${entry.affectedTransactionIds.length} 筆交易改回套用前的版本。`)) return;
    try {
        const beforeIds = new Set(entry.beforeSnapshot.map(t => t.id));
        setTransactions(prev => prev.map(t => beforeIds.has(t.id) ? entry.beforeSnapshot.find(b => b.id === t.id)! : t));
        await upsertTransactions(userId!, entry.beforeSnapshot);
        await markActivityLogRestored(entry.id);
        setActivityLog(prev => prev.map(e => e.id === entry.id ? { ...e, restoredAt: new Date().toISOString() } : e));
    } catch (err) {
        console.error('復原編輯歷程失敗', err);
        alert(`復原失敗。\n\n${formatSupabaseError(err)}`);
    }
  };

  const handleAddTransaction = () => {
    const today = new Date().toISOString().split('T')[0];
    // amount故意用NaN(不是0)當「還沒填」的哨兵值，CalcInput才會顯示空白而不是
    // 卡一個要手動刪掉的"0"（Ivy 2026-08-03反應的問題）。存檔前的驗證邏輯本來就會
    // 擋NaN(視同沒填)，不會真的存進資料庫。
    setEditingTransaction({ id: uuidv4(), date: today, merchant: '', amount: NaN, originalText: 'Manual Add', type: 'expense', category: { l1: L1Category.VARIABLE, l2: STANDARD_CATEGORIES[L1Category.VARIABLE][0], l3: '' }, confidence: 1.0, isVerified: true, isSplit: false });
  };

  // 複製這筆：帶著原本所有內容開新增交易的填寫介面，使用者確認/微調後另存成一筆全新交易，
  // 不影響原本那筆——適合常態性重複開銷快速複製一筆很像的，不用每個欄位重打
  // （2026-08-06 Ivy要求）。id用新的，跟拆分/對帳/分帳明細有關的關聯欄位都要重置，
  // 不然複製出來的新交易會誤指到原本那筆的split群組/對帳狀態/分帳紀錄。
  const handleDuplicateTransaction = (t: Transaction) => {
    setEditingTransaction({
      ...t,
      id: uuidv4(),
      originalText: 'Manual Add',
      confidence: 1.0,
      isVerified: true,
      isSplit: false,
      parentId: undefined,
      reconcileStatus: undefined,
      deletedAt: undefined,
      createdAt: undefined,
    });
  };

  const handleEditNickname = async () => {
    const current = session?.user.user_metadata?.nickname || '';
    const next = window.prompt('幫自己取個暱稱', current);
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed === current) return;
    const { error } = await supabase.auth.updateUser({ data: { nickname: trimmed } });
    if (error) { console.error('更新暱稱失敗', error); alert('更新暱稱失敗，請檢查主控台錯誤訊息。'); }
  };

  const handlePrint = () => window.print();

  // 匯入真的存進資料庫成功才顯示「成功」，失敗要誠實跳出來，不能只在主控台印一行沒人看到。
  const persistImportedTransactions = async (newUnique: Transaction[]) => {
    setTransactions(prev => [...prev, ...newUnique]);
    if (!userId) { alert(`已加到畫面上共 ${newUnique.length} 筆，但目前沒有登入，不會存進資料庫。`); return; }
    try {
      await upsertTransactions(userId, newUnique);
      alert(`已確認存進資料庫：${newUnique.length} 筆！`);
    } catch (err) {
      console.error('匯入儲存失敗', err);
      alert(`匯入儲存失敗！畫面上雖然看得到這 ${newUnique.length} 筆，但資料庫可能沒有全部存進去（可能中途就失敗了）。\n\n${formatSupabaseError(err)}`);
    }
  };

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
      persistImportedTransactions(newUnique);
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
            let importedWishlistItems = json.wishlistItems || [];
            if (importedWishlistItems.length > 0) { const merged = [...wishlistItems]; importedWishlistItems.forEach((g: WishlistItem) => { const idx = merged.findIndex(mg => mg.id === g.id); if (idx >= 0) merged[idx] = g; else merged.push(g); }); handleUpdateWishlistItems(merged); }
            if (importedTransactions.length > 0) {
                const conflictsMap: Record<string, any> = {};
                importedTransactions.forEach(t => { if (!Object.values(L1Category).includes(t.category.l1) || !STANDARD_CATEGORIES[t.category.l1]?.includes(t.category.l2)) { const key = `${t.category.l1}::${t.category.l2}`; if (!conflictsMap[key]) conflictsMap[key] = { key, originalL1: t.category.l1, originalL2: t.category.l2, count: 0 }; conflictsMap[key].count++; } });
                const conflictsList = Object.values(conflictsMap);
                if (conflictsList.length > 0) { setPendingImportTxs(importedTransactions); setConflictCategories(conflictsList); setIsMappingModalOpen(true); }
                else { const existingIds = new Set(transactions.map(t => t.id)); const newUnique = importedTransactions.filter((t: any) => t.id && !existingIds.has(t.id)); if (newUnique.length > 0) { persistImportedTransactions(newUnique); } else alert("匯入的資料似乎已存在 😿"); }
            }
        } catch (err) { alert("檔案解析失敗。"); }
    };
    reader.readAsText(file);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleExport = () => {
    const data = {
      transactions,
      wishlistItems,
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
      {/* 手機版(< lg)是頂欄：logo+icon導覽橫向排一列，固定在頂端、不佔滿全螢幕高度；
          桌機版(lg+)維持原本左側直向側欄，兩者共用同一個element，靠 flex-row/flex-col
          切換方向，不寫兩份重複的JSX。 */}
      <aside className="w-full h-16 lg:w-72 lg:h-auto bg-white flex flex-row lg:flex-col items-center lg:items-stretch fixed top-0 inset-x-0 lg:inset-x-auto lg:left-0 z-20 no-print transition-all shadow-[0_4px_20px_rgba(0,0,0,0.04)] lg:shadow-[8px_0_30px_rgba(0,0,0,0.02)] rounded-b-[24px] lg:rounded-b-none lg:rounded-r-[40px] lg:my-4 lg:ml-4 lg:h-[calc(100vh-32px)] border-b lg:border-b-0 lg:border-r border-orange-50 px-3 lg:px-0 gap-1 lg:gap-0">
        <div className="p-1 lg:p-8 flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => setView('dashboard')} title="回到貓咪指揮中心">
           <div className="w-9 h-9 lg:w-12 lg:h-12 bg-gradient-to-br from-amber-300 to-orange-400 rounded-xl lg:rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100 text-white transform rotate-[-5deg] hover:rotate-0 transition-all duration-300"><Cat className="w-5 h-5 lg:w-7 lg:h-7" /></div>
           <span className="font-extrabold text-2xl tracking-tight text-slate-700 hidden lg:block">Paw<span className="text-amber-500">ket</span></span>
        </div>
        <nav className="flex flex-row lg:flex-col flex-1 lg:py-6 gap-1 lg:gap-4 lg:space-y-0 px-1 lg:px-4 overflow-x-auto lg:overflow-visible relative">
          {/* 新增收支：故意放在側欄最上面、跟頁面導覽分開，不管現在在哪一頁(首頁/明細本/
              對帳)都能直接點，不用先切到明細本才找得到新增按鈕（Ivy 2026-08反應過）。
              EditTransactionModal是掛在畫面最外層渲染的，不受目前view影響，可以直接開。 */}
          <button onClick={handleAddTransaction} className="shrink-0 lg:w-full flex items-center gap-1.5 lg:gap-4 p-2 lg:p-4 rounded-2xl lg:rounded-3xl transition-all duration-300 font-bold bg-emerald-400 hover:bg-emerald-500 text-white shadow-md shadow-emerald-100 active:scale-95"><Plus className="w-5 h-5 lg:w-6 lg:h-6 shrink-0" /><span className="text-[10px] leading-tight lg:text-base whitespace-nowrap">新增收支</span></button>
          {/* 明細本是最常用的功能，排最前面；餵食帳單(舊的整批OCR新增功能)2026-07-27
              已移除，改用對帳(比對已有資料、只新增真正遺漏的部分，不會重複新增)。
              願望清單/帳戶管理比較像系統設定，移出主導覽、收進下面的「更多」選單，
              騰出空間讓手機版也能顯示文字標籤（純icon太難辨識，Ivy反應過）。 */}
          <button onClick={() => setView('transactions')} className={`shrink-0 lg:w-full flex items-center gap-1.5 lg:gap-4 p-2 lg:p-4 rounded-2xl lg:rounded-3xl transition-all duration-300 font-bold group border-2 ${view === 'transactions' ? 'bg-amber-50 border-amber-100 text-amber-500 shadow-sm' : 'border-transparent text-slate-400 hover:bg-orange-50/50'}`}><List className={`w-5 h-5 lg:w-6 lg:h-6 shrink-0 ${view === 'transactions' ? 'text-amber-500' : 'text-slate-400'}`} /><span className="text-[10px] leading-tight lg:text-base whitespace-nowrap">明細本</span></button>
          <button onClick={() => setView('reconcile')} className={`shrink-0 lg:w-full flex items-center gap-1.5 lg:gap-4 p-2 lg:p-4 rounded-2xl lg:rounded-3xl transition-all duration-300 font-bold group border-2 ${view === 'reconcile' ? 'bg-sky-50 border-sky-100 text-sky-500 shadow-sm' : 'border-transparent text-slate-400 hover:bg-orange-50/50'}`}><FileSearch className={`w-5 h-5 lg:w-6 lg:h-6 shrink-0 ${view === 'reconcile' ? 'text-sky-500' : 'text-slate-400'}`} /><span className="text-[10px] leading-tight lg:text-base whitespace-nowrap">餵食核對</span></button>
        </nav>
        {/* 用戶名稱/大頭貼是「總設定」入口：願望清單本身在側欄下方已經有常駐的卡片可以點
            （桌機版），不需要再開一個獨立按鈕；帳戶管理、登出這種比較像系統設定的動作
            收在這裡，手機版沒有側欄卡片空間，所以這裡也放願望清單當備援入口。 */}
        <div className="relative shrink-0" ref={userMenuRef}>
          <div className="flex items-center gap-4 p-2 lg:p-4 rounded-3xl group cursor-pointer" onClick={() => setIsUserMenuOpen(v => !v)} title="總設定">
            <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold shrink-0 text-sm lg:text-base">
              {(session?.user.user_metadata?.nickname || session?.user.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="hidden lg:block flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-700 truncate">{session?.user.user_metadata?.nickname || '設定暱稱'}</p>
              <p className="text-[11px] text-slate-300 truncate">{session?.user.email}</p>
            </div>
          </div>
          {isUserMenuOpen && (
            <div className="absolute top-full right-0 lg:right-auto lg:left-4 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-orange-50 p-2 z-30 animate-in fade-in zoom-in-95 duration-150">
              <button onClick={() => { handleEditNickname(); setIsUserMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-amber-50 hover:text-amber-600 rounded-xl transition"><Pencil className="w-4 h-4" />編輯暱稱</button>
              <button onClick={() => { setIsWishlistModalOpen(true); setIsUserMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-500 rounded-xl transition"><Target className="w-4 h-4" />喵喵心願罐</button>
              <button onClick={() => { setIsAccountsModalOpen(true); setIsUserMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-sky-50 hover:text-sky-500 rounded-xl transition"><Wallet className="w-4 h-4" />碗盤總覽</button>
              <button onClick={() => { setIsSettingsModalOpen(true); setIsUserMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-700 rounded-xl transition"><Settings className="w-4 h-4" />系統設定</button>
              <div className="h-px bg-slate-100 my-1"></div>
              <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-400 rounded-xl transition"><LogOut className="w-4 h-4" />登出</button>
            </div>
          )}
        </div>
        <div className="hidden lg:block p-6 mt-auto">
           <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-5 rounded-3xl border border-indigo-100 relative overflow-hidden group hover:shadow-md cursor-pointer" onClick={() => setIsWishlistModalOpen(true)}>
             <div className="flex items-center gap-2 text-indigo-500 mb-3"><Target className="w-4 h-4" /><span className="text-xs font-bold uppercase tracking-wider">最優先想買的</span></div>
             {topWishlistItem ? (
               <>
                 <p className="font-bold text-slate-700 truncate">{topWishlistItem.name}</p>
                 <p className={`text-xs font-bold mt-2 ${sidebarWishlistMetrics?.canAffordNow ? 'text-emerald-500' : 'text-rose-500'}`}>{sidebarWishlistMetrics?.canAffordNow ? '可動用餘額夠了！' : `還差 $${sidebarWishlistMetrics?.shortfall.toLocaleString()}`}</p>
               </>
             ) : (
               <p className="text-sm font-bold text-indigo-300">還沒有想買的東西，點這裡設定喵喵心願罐</p>
             )}
           </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 mt-16 lg:mt-0 lg:ml-80 p-4 lg:p-10 transition-all">
        {view === 'dashboard' && <Dashboard
            alerts={alerts} budgets={budgets} transactions={filteredTransactions} allTransactions={transactions} wishlistItems={wishlistItems} wishlistSettings={wishlistSettings} onOpenWishlist={() => setIsWishlistModalOpen(true)} onPrint={handlePrint}
            timeScope={timeScope} setTimeScope={setTimeScope} cycleStartDay={cycleStartDay} setCycleStartDay={setCycleStartDay} dateRangeLabel={dateRange.label}
            currentDate={currentDate} setCurrentDate={setCurrentDate} penaltyConfig={penaltyConfig} setPenaltyConfig={setPenaltyConfig}
            customRange={customRange} setCustomRange={setCustomRange} accounts={accounts}
            sharedExpenses={sharedExpenses} onOpenSharedExpenses={() => setIsSharedExpenseListOpen(true)}
          />}
        {view === 'reconcile' && (
          <ReconcileView
            accounts={accounts}
            transactions={transactions}
            merchantAliases={merchantAliases}
            onAddFromBankRow={handleAddFromBankRow}
            onEditTransaction={setEditingTransaction}
            onApplyReconcileStatuses={handleApplyReconcileStatuses}
            onOpenAccountsModal={() => setIsAccountsModalOpen(true)}
          />
        )}
        {view === 'transactions' && (
          <div className="bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 overflow-hidden">
            <div className="p-8 border-b border-orange-50 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white gap-4">
              <div><h2 className="text-2xl font-extrabold text-slate-700 flex items-center gap-2"><div className="w-2 h-8 bg-amber-400 rounded-full"></div>罐罐明細本</h2><p className="text-slate-400 text-sm mt-1 ml-4 font-medium">共 {processedTransactions.length} 筆紀錄</p></div>
              <div className="flex flex-wrap gap-2 no-print">
                 <div className="relative" ref={addMenuRef}>
                   <button onClick={() => setIsAddMenuOpen(prev => !prev)} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-emerald-400 hover:bg-emerald-500 rounded-2xl transition active:scale-95 shadow-md shadow-emerald-100"><Plus className="w-4 h-4" />新增</button>
                   {isAddMenuOpen && (
                     <div className="absolute left-0 top-full mt-2 z-30 w-48 bg-white rounded-2xl shadow-xl border border-orange-50 p-2 animate-in fade-in zoom-in-95 duration-150">
                       <button onClick={() => { setIsAddMenuOpen(false); handleAddTransaction(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition"><Plus className="w-4 h-4" />一般收支</button>
                       <button onClick={() => { setIsAddMenuOpen(false); setTransferModalState({ open: true }); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-sky-50 hover:text-sky-600 rounded-xl transition"><Repeat className="w-4 h-4" />帳戶互轉</button>
                     </div>
                   )}
                 </div>
                 <button onClick={handleMatchAllAccounts} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-400 hover:bg-indigo-500 rounded-2xl transition active:scale-95 shadow-md shadow-indigo-100" title="一次性：把匯入交易的accountId/fromAccountId/toAccountId補上，可安全重複執行"><Wallet className="w-4 h-4" />配對帳戶(一次性)</button>
                 <button onClick={handleClearAllRecords} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-2xl transition active:scale-95 shadow-md shadow-rose-100" title="危險：清除所有交易紀錄(不影響帳戶本身)，無法復原"><Trash2 className="w-4 h-4" />清除所有紀錄</button>
                 <button onClick={handleOpenTrash} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition active:scale-95" title="垃圾桶：救回不小心刪除的紀錄"><Trash2 className="w-4 h-4" />垃圾桶{deletedTransactions.length > 0 ? `(${deletedTransactions.length})` : ''}</button>
                 <button onClick={handleOpenActivityLog} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition active:scale-95" title="重新裝碗紀錄：查詢/復原批次修正這種大動作編輯"><History className="w-4 h-4" />重新裝碗紀錄</button>
                 <div className="h-full w-px bg-slate-200 mx-2 hidden sm:block"></div>
                 <button onClick={() => importInputRef.current?.click()} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition active:scale-95"><Upload className="w-4 h-4" />匯入</button>
                 <input type="file" ref={importInputRef} onChange={handleImport} className="hidden" accept="application/json" />
                 <button onClick={handleExport} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-amber-400 hover:bg-amber-500 rounded-2xl transition shadow-lg shadow-amber-100 active:scale-95"><Download className="w-4 h-4" />備份</button>
              </div>
            </div>
            <div className="px-8 py-6 border-b border-orange-50 bg-[#FFFBF5]/30 no-print">
                 <div className="flex flex-col gap-4">
                     <div className="flex gap-3"><div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input type="text" placeholder="快速查找..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-2xl shadow-sm text-slate-700 font-bold outline-none" />{searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-300"><X className="w-4 h-4" /></button>}</div><button onClick={() => setIsFilterExpanded(!isFilterExpanded)} className={`px-4 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all border ${isFilterExpanded ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-white text-slate-500 border-slate-100'}`}><Filter className="w-5 h-5" /><span className="hidden sm:inline">標籤篩選{selectedTagFilters.size > 0 ? `(${selectedTagFilters.size})` : ''}</span></button></div>
                     {isFilterExpanded && (
                       <div className="p-4 bg-white border border-amber-100 rounded-2xl space-y-3 animate-in slide-in-from-top-1 duration-150">
                         {availableTags.l2.length === 0 && availableTags.l3.length === 0 ? (
                           <p className="text-sm text-slate-400 text-center py-2">目前還沒有分類標籤可以篩選喵～</p>
                         ) : (
                           <>
                             <div className="flex flex-wrap gap-2">
                               {[...availableTags.l2, ...availableTags.l3].map(tag => (
                                 <button
                                   key={tag}
                                   type="button"
                                   onClick={() => toggleTagFilter(tag)}
                                   className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${selectedTagFilters.has(tag) ? 'bg-amber-400 text-white border-amber-400' : 'bg-[#FFFBF5] text-slate-500 border-slate-200 hover:border-amber-200'}`}
                                 >
                                   {tag}
                                 </button>
                               ))}
                             </div>
                             {selectedTagFilters.size > 0 && (
                               <button type="button" onClick={() => setSelectedTagFilters(new Set())} className="text-xs font-bold text-slate-400 hover:text-rose-500 transition">清除篩選</button>
                             )}
                           </>
                         )}
                       </div>
                     )}
                 </div>
            </div>
            {/* 手機版(<lg)把表格改成卡片式垂直排列（每個<tr>變成一張卡片，<td>各自
                從table-cell改成block疊起來），不用再橫向捲動才看得到完整一筆紀錄；
                桌機版(lg+)維持原本的表格排版，不受影響。 */}
            <div className="lg:overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 block lg:table">
                <thead className="hidden lg:table-header-group bg-[#FFFBF5] text-xs uppercase font-bold text-slate-400 tracking-wider"><tr><th className="p-6">日期</th><th className="p-6 w-32">帳戶</th><th className="p-6">商家</th><th className="p-6 min-w-[220px]">分類</th><th className="p-6 text-right">金額</th><th className="p-6 text-center no-print">操作</th></tr></thead>
                <tbody className="block lg:table-row-group divide-y-0 lg:divide-y lg:divide-orange-50 space-y-3 lg:space-y-0 p-3 lg:p-0">
                  {processedTransactions.length === 0 ? (
                    <tr className="block lg:table-row"><td colSpan={6} className="block lg:table-cell p-10 text-center text-slate-400 italic font-medium">喵~ 這裡空空的，快去記帳吧！</td></tr>
                  ) : groupedDisplayItems.map(item => {
                    if (item.type === 'single') {
                      const t = item.data!;
                      if (t.type === 'transfer') {
                        const fromName = accounts.find(a => a.id === t.fromAccountId)?.name || '?';
                        const toName = accounts.find(a => a.id === t.toAccountId)?.name || '?';
                        return (
                          <tr key={t.id} className="block lg:table-row transition hover:bg-sky-50/30 bg-sky-50/10 rounded-2xl lg:rounded-none border lg:border-0 border-sky-100 mb-3 lg:mb-0 last:mb-0">
                            <td className="block lg:table-cell px-4 pt-3 lg:p-6 text-xs lg:text-sm text-slate-400 lg:text-slate-600">{t.date}</td>
                            <td className="hidden lg:table-cell p-6 w-32 text-slate-300 text-xs">—</td>
                            <td className="block lg:table-cell px-4 pt-1 lg:p-6 font-bold">{t.merchant}</td>
                            <td className="block lg:table-cell px-4 pt-1 lg:p-6"><span className="px-2 py-1 bg-sky-100 text-sky-600 rounded text-xs font-bold">帳戶互轉 &bull; {fromName} → {toName}</span></td>
                            <td className="block lg:table-cell px-4 pt-1 lg:p-6 text-left lg:text-right font-bold text-sky-600">${t.amount}</td>
                            <td className="block lg:table-cell px-4 pb-3 pt-2 lg:p-6 text-left lg:text-center no-print">
                              <div className="flex justify-start lg:justify-center gap-2">
                                <button onClick={() => setTransferModalState({ open: true, transaction: t })} className="p-2 border rounded-xl hover:bg-amber-50" title="編輯帳戶互轉"><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => handleDeleteTransaction(t.id)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="刪除項目"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={t.id} className={`flex flex-wrap lg:table-row transition group rounded-2xl lg:rounded-none border lg:border-0 border-orange-100 mb-3 lg:mb-0 last:mb-0 ${t.type === 'income' ? 'bg-emerald-50/20' : 'hover:bg-orange-50/30'}`}>
                          <td className="w-1/2 lg:table-cell lg:w-auto px-4 pt-3 lg:p-6 text-xs lg:text-sm text-slate-400 lg:text-slate-600 order-1">{t.date}</td>
                          <td className="w-1/2 lg:table-cell lg:w-32 px-4 pt-3 lg:p-6 text-xs text-right lg:text-left order-2">
                            {(() => {
                              const acc = accounts.find(a => a.id === t.accountId);
                              return acc
                                ? <span className={`inline-block px-2 py-1 rounded-lg font-bold truncate max-w-[100px] align-bottom ${ACCOUNT_TYPE_TAG_STYLE[acc.type] || 'bg-slate-100 text-slate-600'}`} title={acc.name}>{acc.name}</span>
                                : <span className="text-slate-300 font-normal">未指定</span>;
                            })()}
                            {t.paymentChannel && <div className="w-24 truncate text-slate-300 font-normal mt-1 text-[10px] ml-auto lg:ml-0" title={t.paymentChannel}>{t.paymentChannel}</div>}
                          </td>
                          <td className="w-full lg:table-cell px-4 pt-2 lg:p-6 font-bold order-3">
                            <span className="flex items-center gap-1.5 flex-wrap">
                              {t.merchant}
                              {t.specialTag && (
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter ${t.specialTag.type === 'proxy_purchase' ? 'bg-purple-100 text-purple-600' : t.specialTag.type === 'work_advance' ? 'bg-amber-100 text-amber-600' : 'bg-sky-100 text-sky-600'}`}>
                                  {t.specialTag.type === 'proxy_purchase' ? '代購' : t.specialTag.type === 'work_advance' ? '工作代墊' : '借貸'}
                                  {t.specialTag.counterparty ? `・${t.specialTag.counterparty}` : ''}
                                </span>
                              )}
                              {(() => {
                                const se = sharedExpenses.find(se => se.transactionId === t.id);
                                if (!se) return null;
                                const unsettled = se.participants.filter(p => !p.settled);
                                if (unsettled.length === 0) return null;
                                const oweMe = unsettled.filter(p => p.direction === 'they_owe_me').reduce((s, p) => s + p.owedAmount, 0);
                                const oweThem = unsettled.filter(p => p.direction === 'i_owe_them').reduce((s, p) => s + p.owedAmount, 0);
                                return (
                                  <>
                                    {oweMe > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">應收${oweMe}</span>}
                                    {oweThem > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-600">應付${oweThem}</span>}
                                  </>
                                );
                              })()}
                            </span>
                            {t.items && t.items.length > 0 && (() => {
                              const isRowExpanded = expandedRowIds.has(t.id);
                              const visibleItems = isRowExpanded ? t.items : t.items.slice(0, 3);
                              const hiddenCount = t.items.length - visibleItems.length;
                              return (
                                <span className="flex flex-wrap items-center gap-1 mt-1">
                                  {visibleItems.map((item, idx) => (
                                    <span key={idx} className="text-[11px] font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                      {item.name}
                                      {item.unitPrice != null && (
                                        <span className="text-slate-400"> ${item.unitPrice}{(item.quantity && item.quantity !== 1) ? `×${item.quantity}` : ''}</span>
                                      )}
                                      {/* 涉及外幣/折扣的品項，備註(原幣金額/匯率/折扣)直接顯示在這裡，不用點開編輯才看得到 */}
                                      {item.note && <span className="text-sky-500"> ({item.note})</span>}
                                    </span>
                                  ))}
                                  {hiddenCount > 0 && (
                                    <button type="button" onClick={() => toggleRowExpanded(t.id)} className="text-[11px] font-bold text-amber-500 hover:text-amber-600">+{hiddenCount} 更多</button>
                                  )}
                                </span>
                              );
                            })()}
                            {t.note && (
                              <span
                                className={`text-xs font-normal text-slate-400 mt-0.5 ${expandedRowIds.has(t.id) ? 'block' : 'line-clamp-1 cursor-pointer'}`}
                                onClick={() => !expandedRowIds.has(t.id) && toggleRowExpanded(t.id)}
                                title={!expandedRowIds.has(t.id) ? '點擊展開完整備註' : undefined}
                              >
                                {t.note}
                              </span>
                            )}
                            {t.discounts && t.discounts.length > 0 && (
                              <span className="flex items-center flex-wrap gap-1.5 mt-1.5 p-2 bg-amber-50/60 border border-amber-100 rounded-xl w-fit">
                                <span className="text-[11px] font-bold text-slate-400 line-through decoration-slate-300">${t.grossAmount}</span>
                                {t.discounts.map((d, idx) => (
                                  <span key={idx} className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 whitespace-nowrap">
                                    {d.label || '折扣'}：-${d.amount}
                                  </span>
                                ))}
                                <span className="text-slate-300 text-xs">→</span>
                                <span className="text-sm font-black text-amber-600">${t.amount}</span>
                              </span>
                            )}
                          </td>
                          <td className="w-1/2 lg:table-cell px-4 pt-2 lg:p-6 order-4">
                            <span className={`px-2 py-1 rounded-lg text-xs font-bold ${L1_TAG_STYLE[t.category.l1]}`}>{CATEGORY_LABELS[t.category.l1]} &bull; {t.category.l2}</span>
                          </td>
                          <td className={`w-1/2 lg:table-cell px-4 pt-2 lg:p-6 text-right font-bold order-5 ${t.type === 'income' ? 'text-emerald-500' : 'text-slate-700'}`}>{t.type === 'income' ? '+' : '-'}${t.amount}</td>
                          <td className="w-full lg:table-cell px-4 pb-3 pt-2 lg:p-6 lg:text-center no-print order-6">
                            <div className="flex justify-end lg:justify-center gap-2">
                              <button onClick={() => setSplittingTransaction(t)} className="p-2 border rounded-xl hover:bg-purple-50 text-purple-400" title="拆帳分類"><Divide className="w-4 h-4" /></button>
                              <button onClick={() => setEditingTransaction(t)} className="p-2 border rounded-xl hover:bg-amber-50" title="編輯項目"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDuplicateTransaction(t)} className="p-2 border rounded-xl hover:bg-sky-50 text-sky-400" title="複製這筆"><Copy className="w-4 h-4" /></button>
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
                          <tr className="flex flex-wrap lg:table-row bg-purple-50/30 border-2 lg:border-2 lg:border-t-2 border-purple-100 rounded-2xl lg:rounded-none mb-1 lg:mb-0">
                             <td className="w-1/2 lg:table-cell lg:w-auto px-4 pt-3 lg:p-6 text-xs font-bold text-purple-400 order-1">{groupDate}</td>
                             <td className="w-1/2 lg:table-cell lg:w-32 px-4 pt-3 lg:p-6 text-xs text-right lg:text-left order-2">
                               {(() => {
                                 const acc = accounts.find(a => a.id === mainItem.accountId);
                                 return acc
                                   ? <span className={`inline-block px-2 py-1 rounded-lg font-bold truncate max-w-[100px] align-bottom ${ACCOUNT_TYPE_TAG_STYLE[acc.type] || 'bg-slate-100 text-slate-600'}`} title={acc.name}>{acc.name}</span>
                                   : <span className="text-slate-300 font-normal">未指定</span>;
                               })()}
                             </td>
                             <td className="w-full lg:table-cell px-4 pt-2 lg:p-6 font-black text-slate-700 flex items-center gap-2 order-3">
                               {mainItem.merchant} <span className="text-[10px] bg-purple-200 text-purple-600 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">已分裝</span>
                             </td>
                             <td className="w-1/2 lg:table-cell px-4 pt-2 lg:p-6 order-4">
                                <span className="px-2 py-1 bg-white/80 border border-purple-100 rounded text-xs font-bold text-purple-400">
                                  {CATEGORY_LABELS[mainItem.category.l1]} &bull; {mainItem.category.l2}
                                </span>
                             </td>
                             <td className={`w-1/2 lg:table-cell px-4 pt-2 lg:p-6 text-right font-black order-5 ${mainItem.type === 'income' ? 'text-emerald-600' : 'text-slate-700'}`}>
                                {mainItem.type === 'income' ? '+' : '-'}${totalAmount.toFixed(2)}
                             </td>
                             <td className="w-full lg:table-cell px-4 pb-3 pt-2 lg:p-6 lg:text-center no-print order-6">
                               <div className="flex justify-end lg:justify-center gap-2">
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
                             <tr key={child.id} className="flex flex-wrap lg:table-row bg-white/50 lg:border-l-4 border-purple-200 hover:bg-purple-50/10 transition group/child rounded-xl lg:rounded-none mb-1 lg:mb-0 ml-3 lg:ml-0 border lg:border-t-0">
                                <td className="w-1/2 lg:table-cell lg:w-auto px-3 pt-2 lg:p-4 lg:pl-10 text-xs text-slate-400 order-1"><span className="lg:hidden">↳ </span><span className="hidden lg:inline">└─ </span>{child.date}</td>
                                <td className="w-1/2 lg:table-cell lg:w-32 px-3 pt-2 lg:p-4 text-xs font-bold text-slate-500 text-right lg:text-left order-2">
                                  <div className="w-24 truncate ml-auto lg:ml-0" title={accounts.find(a => a.id === child.accountId)?.name || '未指定'}>
                                    {accounts.find(a => a.id === child.accountId)?.name || <span className="text-slate-300 font-normal">未指定</span>}
                                  </div>
                                </td>
                                <td className="w-full lg:table-cell px-3 pt-1 lg:p-4 text-slate-600 font-bold order-3">
                                  {child.merchant}
                                </td>
                                <td className="w-1/2 lg:table-cell px-3 pt-1 lg:p-4 order-4">
                                  <span className="px-2 py-1 bg-slate-100 rounded text-xs">
                                    {CATEGORY_LABELS[child.category.l1]} &bull; {child.category.l2}
                                  </span>
                                </td>
                                <td className={`w-1/2 lg:table-cell px-3 pt-1 lg:p-4 text-right font-bold order-5 ${child.type === 'income' ? 'text-emerald-500' : 'text-slate-500'}`}>
                                  {child.type === 'income' ? '+' : '-'}${child.amount}
                                </td>
                                <td className="w-full lg:table-cell px-3 pb-2 pt-1 lg:p-4 lg:text-center no-print order-6">
                                   <div className="flex justify-end lg:justify-center gap-1 opacity-100 lg:opacity-0 lg:group-hover/child:opacity-100 transition-opacity">
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
      {editingTransaction && <EditTransactionModal transaction={editingTransaction} allTransactions={transactions} accounts={accounts} customCategoryHistory={customCategoryHistory} sharedExpenses={sharedExpenses} onTagAction={handleTagAction} onManageSharedExpense={setManagingSharedExpenseTx} onClose={() => { setEditingTransaction(null); setPendingAliasLearn(null); }} onSave={handleEditSave} />}
      {managingSharedExpenseTx && (
        <SharedExpenseModal
          transaction={managingSharedExpenseTx}
          existing={sharedExpenses.find(se => se.transactionId === managingSharedExpenseTx.id)}
          accounts={accounts}
          allTransactions={transactions}
          onClose={() => setManagingSharedExpenseTx(null)}
          onSave={handleSaveSharedExpense}
        />
      )}
      {isSharedExpenseListOpen && (
        <SharedExpenseListModal
          sharedExpenses={sharedExpenses}
          transactions={transactions}
          accounts={accounts}
          onClose={() => setIsSharedExpenseListOpen(false)}
          onSettle={handleSettleSharedExpenseParticipant}
        />
      )}
      {transferModalState.open && <TransferModal accounts={accounts} transaction={transferModalState.transaction} onClose={() => setTransferModalState({ open: false })} onSave={handleTransferSave} />}
      {isAccountsModalOpen && <AccountsModal accounts={accounts} onClose={() => setIsAccountsModalOpen(false)} onSave={handleSaveAccount} onArchive={handleArchiveAccount} />}
      {batchSource && <BatchCorrectionModal matches={batchCandidates} source={batchSource} allTransactions={transactions} onConfirm={handleBatchConfirm} onClose={() => { setBatchSource(null); setBatchCandidates([]); }} />}
      {isWishlistModalOpen && <WishlistModal items={wishlistItems} accounts={accounts} allTransactions={transactions} longTermReserves={longTermReserves} settings={wishlistSettings} onClose={() => setIsWishlistModalOpen(false)} onUpdateItems={handleUpdateWishlistItems} onUpdateSettings={handleUpdateWishlistSettings} />}
      {isTrashModalOpen && <TrashModal items={deletedTransactions} loading={trashLoading} onClose={() => setIsTrashModalOpen(false)} onRestore={handleRestoreFromTrash} onPermanentlyDelete={handlePermanentlyDelete} />}
      {isActivityLogOpen && <ActivityLogModal items={activityLog} loading={activityLogLoading} onClose={() => setIsActivityLogOpen(false)} onRestore={handleRestoreActivityLog} />}
      {isSettingsModalOpen && <SettingsModal
        similarTransactionAlertsEnabled={similarTransactionAlertsEnabled} onUpdateSimilarTransactionAlerts={handleUpdateSimilarTransactionAlerts}
        allTransactions={transactions} categoryBudgets={categoryBudgets} onUpdateCategoryBudgets={handleUpdateCategoryBudgets}
        longTermReserves={longTermReserves} onUpdateLongTermReserves={handleUpdateLongTermReserves}
        onClose={() => setIsSettingsModalOpen(false)}
      />}
      {isMappingModalOpen && <CategoryMappingModal conflicts={conflictCategories} existingCustomOptions={customCategoryHistory} onConfirm={handleMappingConfirm} onCancel={() => { setIsMappingModalOpen(false); setPendingImportTxs([]); setConflictCategories([]); }} />}
      
      {(lastDeletedTransaction || lastCanceledSplit || lastBatchUpdate) && (
        <div className="fixed bottom-6 sm:bottom-10 left-1/2 -translate-x-1/2 z-[100] w-[calc(100vw-2rem)] max-w-md animate-in slide-in-from-bottom-5">
            {/* 2026-08-04修正：原本用rounded-full(藥丸形)+沒有寬度上限，文字一長
                （商家名稱、批次修正說明都可能很長）就會撐得比手機螢幕還寬、跑版，
                改成有寬度上限+可以換行的圓角卡片，文字/按鈕不管多長都不會爆版。 */}
            <div className="bg-slate-800 text-white px-5 py-4 rounded-3xl shadow-2xl flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <span className="text-sm font-bold leading-snug break-words flex-1 min-w-0">
                    {lastDeletedTransaction ? `已移除「${lastDeletedTransaction.merchant}」紀錄` : lastBatchUpdate ? lastBatchUpdate.description : "已取消分裝並合併項目"}
                </span>
                <button
                    onClick={lastDeletedTransaction ? handleUndoDelete : lastBatchUpdate ? handleUndoBatchUpdate : handleUndoCancelSplit}
                    className="text-amber-400 font-bold text-sm hover:text-amber-300 flex items-center justify-center gap-1 shrink-0 sm:border-l sm:border-slate-700 sm:pl-4"
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
