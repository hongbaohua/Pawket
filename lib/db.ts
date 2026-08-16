// 資料庫讀寫層：App.tsx 只呼叫這裡的函式，不用自己組 Supabase 查詢語法。
// 負責把畫面用的 Transaction/Account（camelCase、巢狀 category）
// 轉成資料表用的欄位格式（snake_case、攤平），反之亦然。

import { supabase } from './supabaseClient';
import { Transaction, Account, AccountType, L1Category, Discount, TransactionItem, SpecialTag, WishlistItem, ReconcileStatus, MerchantAlias, MerchantAliasCandidate, SharedExpense, SharedExpenseParticipant, ActivityLogEntry } from '../types';

// ── 帳戶 ──

interface AccountRow {
  id: string;
  name: string;
  institution: string | null;
  type: AccountType;
  currency: string;
  is_archived: boolean;
  posting_delay_min: number | null;
  posting_delay_max: number | null;
}

const rowToAccount = (row: AccountRow): Account => ({
  id: row.id,
  name: row.name,
  institution: row.institution || '',
  type: row.type,
  currency: row.currency,
  isArchived: row.is_archived,
  postingDelayMin: row.posting_delay_min ?? undefined,
  postingDelayMax: row.posting_delay_max ?? undefined,
});

export const fetchAccounts = async (): Promise<Account[]> => {
  const { data, error } = await supabase.from('accounts').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data as AccountRow[]).map(rowToAccount);
};

export const createAccount = async (userId: string, account: Omit<Account, 'id'>): Promise<Account> => {
  const { data, error } = await supabase.from('accounts').insert({
    user_id: userId,
    name: account.name,
    institution: account.institution,
    type: account.type,
    currency: account.currency,
    is_archived: account.isArchived,
    posting_delay_min: account.postingDelayMin ?? null,
    posting_delay_max: account.postingDelayMax ?? null,
  }).select().single();
  if (error) throw error;
  return rowToAccount(data as AccountRow);
};

export const updateAccount = async (account: Account): Promise<void> => {
  const { error } = await supabase.from('accounts').update({
    name: account.name,
    institution: account.institution,
    type: account.type,
    currency: account.currency,
    is_archived: account.isArchived,
    posting_delay_min: account.postingDelayMin ?? null,
    posting_delay_max: account.postingDelayMax ?? null,
  }).eq('id', account.id);
  if (error) throw error;
};

// 這裡故意用「封存」(is_archived) 而不是真的刪除：帳戶被刪掉的話，底下引用它的交易紀錄
// 的 account_id 只是被清空 (schema 設定 on delete set null)，但那些交易還在，容易讓人誤會資料不見了。
export const archiveAccount = async (accountId: string): Promise<void> => {
  const { error } = await supabase.from('accounts').update({ is_archived: true }).eq('id', accountId);
  if (error) throw error;
};

// 2026-08-13新增：真的永久刪除一個帳戶（只能對已封存的帳戶做，UI層會擋）。
// 用來清掉像「誤觸封存後又建了一個同名新帳戶」這種確定沒有交易紀錄、留著只是雜訊
// 的空帳戶——如果帳戶底下還有交易，它們不會被刪除，只是account_id會被清空(schema
// on delete set null)，變成「未指定帳戶」，這點會在UI的確認訊息裡講清楚讓使用者自己判斷。
export const deleteAccount = async (accountId: string): Promise<void> => {
  const { error } = await supabase.from('accounts').delete().eq('id', accountId);
  if (error) throw error;
};

// 新帳號預設只給「現金」——銀行卡、電子支付都是使用者自己的東西，不該幫她亂猜、亂建。
export const seedDefaultAccountsIfEmpty = async (userId: string): Promise<Account[]> => {
  const existing = await fetchAccounts();
  if (existing.length > 0) return existing;

  await createAccount(userId, { name: '現金', institution: '現金', type: 'cash', currency: 'TWD', isArchived: false });

  return fetchAccounts();
};

// ── 交易 ──

interface TransactionRow {
  id: string;
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  payment_channel: string | null;
  date: string;
  merchant: string;
  note: string | null;
  original_text: string | null;
  gross_amount: number;
  discounts: Discount[] | null;
  items: TransactionItem[] | null;
  special_tag: SpecialTag | null;
  net_amount: number;
  type: 'income' | 'expense' | 'transfer';
  l1: L1Category | null;
  l2: string | null;
  l3: string | null;
  confidence: number | null;
  is_verified: boolean;
  is_split: boolean;
  parent_id: string | null;
  deleted_at: string | null;
  reconcile_status: ReconcileStatus | null;
  created_at: string;
}

const rowToTransaction = (row: TransactionRow): Transaction => ({
  id: row.id,
  date: row.date,
  merchant: row.merchant,
  note: row.note || undefined,
  originalText: row.original_text || '',
  amount: Number(row.net_amount),
  grossAmount: row.gross_amount != null ? Number(row.gross_amount) : undefined,
  discounts: row.discounts && row.discounts.length > 0 ? row.discounts : undefined,
  items: row.items && row.items.length > 0 ? row.items : undefined,
  specialTag: row.special_tag || undefined,
  type: row.type,
  accountId: row.account_id || undefined,
  fromAccountId: row.from_account_id || undefined,
  toAccountId: row.to_account_id || undefined,
  paymentChannel: row.payment_channel || undefined,
  category: {
    l1: row.l1 || L1Category.VARIABLE,
    l2: row.l2 || '',
    l3: row.l3 || '',
  },
  confidence: row.confidence ?? 1,
  isVerified: row.is_verified,
  isSplit: row.is_split,
  parentId: row.parent_id || undefined,
  deletedAt: row.deleted_at || undefined,
  reconcileStatus: row.reconcile_status || undefined,
  createdAt: row.created_at,
});

// 刻意不包含 reconcile_status：這個欄位只由對帳流程透過下面的 setReconcileStatus
// 更新，一般編輯/新增交易呼叫 upsertTransaction(s) 時完全不會提到這個欄位，
// PostgREST upsert 只會覆蓋 payload 裡有出現的欄位，這樣才不會每次存檔都
// 不小心把對帳狀態洗掉。
const transactionToRow = (userId: string, tx: Transaction) => ({
  id: tx.id,
  user_id: userId,
  account_id: tx.accountId || null,
  from_account_id: tx.fromAccountId || null,
  to_account_id: tx.toAccountId || null,
  payment_channel: tx.paymentChannel || null,
  date: tx.date,
  merchant: tx.merchant,
  note: tx.note || null,
  original_text: tx.originalText,
  gross_amount: tx.grossAmount ?? tx.amount,
  discounts: tx.discounts ?? [],
  items: tx.items ?? [],
  special_tag: tx.specialTag ?? null,
  net_amount: tx.amount,
  type: tx.type,
  l1: tx.category.l1,
  l2: tx.category.l2,
  l3: tx.category.l3,
  confidence: tx.confidence,
  is_verified: tx.isVerified,
  is_split: tx.isSplit,
  parent_id: tx.parentId || null,
});

// Supabase/PostgREST 預設一次查詢最多回傳1000筆，不會報錯、只是安靜地砍掉超過的部分，
// 資料一多（現在已經1700+筆）就會悄悄漏資料。用 range() 分頁抓到抓完為止，不依賴專案的
// Max Rows 設定值，之後資料再變多也不會再卡住。
const FETCH_PAGE_SIZE = 1000;

export const fetchTransactions = async (): Promise<Transaction[]> => {
  const allRows: TransactionRow[] = [];
  let from = 0;
  while (true) {
    // 同一天內也要新的在前面(跟外層date排序方向一致)，不然同一天多筆時順序看起來
    // 忽前忽後、不符合「最新在最上面」的邏輯(Ivy 2026-08-02發現的問題)。
    const { data, error } = await supabase.from('transactions').select('*').is('deleted_at', null).order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data as TransactionRow[];
    allRows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return allRows.map(rowToTransaction);
};

// 垃圾桶：撈出已經軟刪除、還沒被永久清除的交易，最近刪除的排前面。
export const fetchDeletedTransactions = async (): Promise<Transaction[]> => {
  const { data, error } = await supabase.from('transactions').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
  if (error) throw error;
  return (data as TransactionRow[]).map(rowToTransaction);
};

// upsert：新增跟編輯共用同一個函式，id 已存在就更新、不存在就新增
export const upsertTransaction = async (userId: string, tx: Transaction): Promise<void> => {
  const { error } = await supabase.from('transactions').upsert(transactionToRow(userId, tx));
  if (error) throw error;
};

// 分批寫入：一次塞幾千筆進同一個request，request本身太大容易被中間層(Supabase/Cloudflare)
// 擋掉回傳403，跟資料/權限本身無關。切成小批次依序送出，安全很多。
const UPSERT_BATCH_SIZE = 200;

export const upsertTransactions = async (userId: string, txs: Transaction[]): Promise<void> => {
  if (txs.length === 0) return;
  const rows = txs.map(t => transactionToRow(userId, t));
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from('transactions').upsert(batch);
    if (error) throw error;
  }
};

// 軟刪除：只標記 deleted_at，資料還在，垃圾桶可以救回。避免手滑誤刪就真的沒救了
// （Ivy實際發生過一次），不是真的從資料庫移除。
export const deleteTransaction = async (id: string): Promise<void> => {
  const { error } = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
};

export const deleteTransactionsByParentId = async (parentId: string): Promise<void> => {
  const { error } = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('parent_id', parentId);
  if (error) throw error;
};

export const restoreTransaction = async (id: string): Promise<void> => {
  const { error } = await supabase.from('transactions').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
};

// 垃圾桶「永久刪除」用：這個才是真的從資料庫移除，沒有回頭路。
export const permanentlyDeleteTransaction = async (id: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
};

// 「清除所有紀錄」用：只刪這個使用者的 transactions，不動 accounts 表。
export const deleteAllTransactions = async (userId: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('user_id', userId);
  if (error) throw error;
};

// 對帳用：只更新這一個欄位，不用整筆 upsertTransaction 重送（也避免順便把使用者
// 這段時間手動改過、還沒同步回本機state的其他欄位覆蓋掉）。
export const setReconcileStatus = async (id: string, status: ReconcileStatus | null): Promise<void> => {
  const { error } = await supabase.from('transactions').update({ reconcile_status: status }).eq('id', id);
  if (error) throw error;
};

// ── 願望清單 ──

interface WishlistItemRow {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  is_purchased: boolean;
  purchased_date: string | null;
  sort_order: number;
}

const rowToWishlistItem = (row: WishlistItemRow): WishlistItem => ({
  id: row.id,
  name: row.name,
  targetAmount: Number(row.target_amount),
  targetDate: row.target_date || undefined,
  isPurchased: row.is_purchased,
  purchasedDate: row.purchased_date || undefined,
});

// 優先順序＝清單排列順序，存進 sort_order 欄位，讀出來時依它排序還原順序。
const wishlistItemToRow = (userId: string, item: WishlistItem, sortOrder: number) => ({
  id: item.id,
  user_id: userId,
  name: item.name,
  target_amount: item.targetAmount,
  target_date: item.targetDate || null,
  is_purchased: item.isPurchased ?? false,
  purchased_date: item.purchasedDate || null,
  sort_order: sortOrder,
});

export const fetchWishlistItems = async (): Promise<WishlistItem[]> => {
  const { data, error } = await supabase.from('wishlist_items').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return (data as WishlistItemRow[]).map(rowToWishlistItem);
};

// 整份清單一起 upsert：排列順序本身就是要存的資料，一律連同 index 一起重新寫入 sort_order。
export const upsertWishlistItems = async (userId: string, items: WishlistItem[]): Promise<void> => {
  if (items.length === 0) return;
  const rows = items.map((item, index) => wishlistItemToRow(userId, item, index));
  const { error } = await supabase.from('wishlist_items').upsert(rows);
  if (error) throw error;
};

export const deleteWishlistItem = async (id: string): Promise<void> => {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id);
  if (error) throw error;
};

// ── 商家別名（對帳模組用） ──

interface MerchantAliasRow {
  id: string;
  official_pattern: string;
  candidates: MerchantAliasCandidate[] | null;
  account_id: string | null;
  default_l1: L1Category | null;
  default_l2: string | null;
}

const rowToMerchantAlias = (row: MerchantAliasRow): MerchantAlias => ({
  id: row.id,
  officialPattern: row.official_pattern,
  candidates: row.candidates || [],
  accountId: row.account_id || undefined,
  defaultL1: row.default_l1 || undefined,
  defaultL2: row.default_l2 || undefined,
});

const merchantAliasToRow = (userId: string, alias: MerchantAlias) => ({
  id: alias.id,
  user_id: userId,
  official_pattern: alias.officialPattern,
  candidates: alias.candidates,
  account_id: alias.accountId || null,
  default_l1: alias.defaultL1 || null,
  default_l2: alias.defaultL2 || null,
});

// 表目前很小（初期是空的，之後逐筆從對帳流程學習累積），不用像fetchTransactions
// 那樣分頁，之後如果真的成長超過1000筆再比照那個分頁寫法補上。
export const fetchMerchantAliases = async (): Promise<MerchantAlias[]> => {
  const { data, error } = await supabase.from('merchant_aliases').select('*');
  if (error) throw error;
  return (data as MerchantAliasRow[]).map(rowToMerchantAlias);
};

export const upsertMerchantAlias = async (userId: string, alias: MerchantAlias): Promise<void> => {
  const { error } = await supabase.from('merchant_aliases').upsert(merchantAliasToRow(userId, alias));
  if (error) throw error;
};

// ── 共同支出／代墊分帳 ──

interface SharedExpenseRow {
  id: string;
  transaction_id: string;
  total_amount: number;
  my_share: number;
}

interface SharedExpenseParticipantRow {
  id: string;
  shared_expense_id: string;
  name: string;
  owed_amount: number;
  direction: 'they_owe_me' | 'i_owe_them';
  settled: boolean;
  settle_method: string | null;
  settled_date: string | null;
  settled_transaction_id: string | null;
}

const rowToParticipant = (row: SharedExpenseParticipantRow): SharedExpenseParticipant => ({
  id: row.id,
  name: row.name,
  owedAmount: Number(row.owed_amount),
  direction: row.direction,
  settled: row.settled,
  settleMethod: (row.settle_method as SharedExpenseParticipant['settleMethod']) || undefined,
  settledDate: row.settled_date || undefined,
  settledTransactionId: row.settled_transaction_id || undefined,
});

// 兩張表各查一次(都很小，不用像fetchTransactions那樣分頁)，participants依
// shared_expense_id分組掛回對應的SharedExpense。
export const fetchSharedExpenses = async (): Promise<SharedExpense[]> => {
  const [expensesRes, participantsRes] = await Promise.all([
    supabase.from('shared_expenses').select('*'),
    supabase.from('shared_expense_participants').select('*'),
  ]);
  if (expensesRes.error) throw expensesRes.error;
  if (participantsRes.error) throw participantsRes.error;

  const participantsByExpenseId = new Map<string, SharedExpenseParticipant[]>();
  (participantsRes.data as SharedExpenseParticipantRow[]).forEach(row => {
    const list = participantsByExpenseId.get(row.shared_expense_id) || [];
    list.push(rowToParticipant(row));
    participantsByExpenseId.set(row.shared_expense_id, list);
  });

  return (expensesRes.data as SharedExpenseRow[]).map(row => ({
    id: row.id,
    transactionId: row.transaction_id,
    totalAmount: Number(row.total_amount),
    myShare: Number(row.my_share),
    participants: participantsByExpenseId.get(row.id) || [],
  }));
};

// 參與者整份replace：先比對舊清單找出這次不再出現的id單獨刪除，其餘upsert
// （做法跟WishlistModal的onUpdateItems整份陣列替換邏輯一樣）。
export const upsertSharedExpense = async (userId: string, expense: SharedExpense): Promise<void> => {
  const { error: expenseErr } = await supabase.from('shared_expenses').upsert({
    id: expense.id,
    user_id: userId,
    transaction_id: expense.transactionId,
    total_amount: expense.totalAmount,
    my_share: expense.myShare,
  });
  if (expenseErr) throw expenseErr;

  const { data: existing, error: fetchErr } = await supabase
    .from('shared_expense_participants')
    .select('id')
    .eq('shared_expense_id', expense.id);
  if (fetchErr) throw fetchErr;

  const existingIds = new Set((existing || []).map((r: { id: string }) => r.id));
  const nextIds = new Set(expense.participants.map(p => p.id));
  const toDelete = [...existingIds].filter(id => !nextIds.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase.from('shared_expense_participants').delete().in('id', toDelete);
    if (delErr) throw delErr;
  }

  if (expense.participants.length > 0) {
    const rows = expense.participants.map(p => ({
      id: p.id,
      shared_expense_id: expense.id,
      name: p.name,
      owed_amount: p.owedAmount,
      direction: p.direction,
      settled: p.settled,
      settle_method: p.settleMethod || null,
      settled_date: p.settledDate || null,
      settled_transaction_id: p.settledTransactionId || null,
    }));
    const { error: upErr } = await supabase.from('shared_expense_participants').upsert(rows);
    if (upErr) throw upErr;
  }
};

// shared_expense_participants的on delete cascade會自動一起刪，不用額外處理。
export const deleteSharedExpense = async (id: string): Promise<void> => {
  const { error } = await supabase.from('shared_expenses').delete().eq('id', id);
  if (error) throw error;
};

export const markParticipantSettled = async (
  participantId: string,
  settleMethod: NonNullable<SharedExpenseParticipant['settleMethod']>,
  settledDate: string
): Promise<void> => {
  const { error } = await supabase
    .from('shared_expense_participants')
    .update({ settled: true, settle_method: settleMethod, settled_date: settledDate })
    .eq('id', participantId);
  if (error) throw error;
};

// ── 編輯歷程紀錄（目前只記錄批次修正，見migration_007說明）──
// beforeSnapshot直接存Transaction(camelCase)格式的JSON，不特別轉成TransactionRow——
// 反正是不透明的jsonb欄位，復原時要直接餵給upsertTransactions，存camelCase省一次轉換。

interface ActivityLogRow {
  id: string;
  action_type: 'batch_correction';
  description: string;
  affected_transaction_ids: string[];
  before_snapshot: Transaction[];
  restored_at: string | null;
  created_at: string;
}

const rowToActivityLogEntry = (row: ActivityLogRow): ActivityLogEntry => ({
  id: row.id,
  actionType: row.action_type,
  description: row.description,
  affectedTransactionIds: row.affected_transaction_ids,
  beforeSnapshot: row.before_snapshot,
  restoredAt: row.restored_at || undefined,
  createdAt: row.created_at,
});

// 最近100筆就好，這種紀錄不需要無限往回查，避免表越養越肥還要分頁。
export const fetchActivityLog = async (): Promise<ActivityLogEntry[]> => {
  const { data, error } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data as ActivityLogRow[]).map(rowToActivityLogEntry);
};

export const insertActivityLog = async (
  userId: string,
  entry: { actionType: 'batch_correction'; description: string; affectedTransactionIds: string[]; beforeSnapshot: Transaction[] }
): Promise<void> => {
  const { error } = await supabase.from('activity_log').insert({
    user_id: userId,
    action_type: entry.actionType,
    description: entry.description,
    affected_transaction_ids: entry.affectedTransactionIds,
    before_snapshot: entry.beforeSnapshot,
  });
  if (error) throw error;
};

export const markActivityLogRestored = async (id: string): Promise<void> => {
  const { error } = await supabase.from('activity_log').update({ restored_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
};
