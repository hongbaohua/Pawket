// 資料庫讀寫層：App.tsx 只呼叫這裡的函式，不用自己組 Supabase 查詢語法。
// 負責把畫面用的 Transaction/Account（camelCase、巢狀 category）
// 轉成資料表用的欄位格式（snake_case、攤平），反之亦然。

import { supabase } from './supabaseClient';
import { Transaction, Account, AccountType, L1Category, Discount, TransactionItem, SpecialTag, WishlistItem } from '../types';

// ── 帳戶 ──

interface AccountRow {
  id: string;
  name: string;
  institution: string | null;
  type: AccountType;
  currency: string;
  is_archived: boolean;
}

const rowToAccount = (row: AccountRow): Account => ({
  id: row.id,
  name: row.name,
  institution: row.institution || '',
  type: row.type,
  currency: row.currency,
  isArchived: row.is_archived,
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
  }).eq('id', account.id);
  if (error) throw error;
};

// 這裡故意用「封存」(is_archived) 而不是真的刪除：帳戶被刪掉的話，底下引用它的交易紀錄
// 的 account_id 只是被清空 (schema 設定 on delete set null)，但那些交易還在，容易讓人誤會資料不見了。
export const archiveAccount = async (accountId: string): Promise<void> => {
  const { error } = await supabase.from('accounts').update({ is_archived: true }).eq('id', accountId);
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
});

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
    const { data, error } = await supabase.from('transactions').select('*').order('date', { ascending: false }).range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data as TransactionRow[];
    allRows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return allRows.map(rowToTransaction);
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

export const deleteTransaction = async (id: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
};

export const deleteTransactionsByParentId = async (parentId: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('parent_id', parentId);
  if (error) throw error;
};

// 「清除所有紀錄」用：只刪這個使用者的 transactions，不動 accounts 表。
export const deleteAllTransactions = async (userId: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('user_id', userId);
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
