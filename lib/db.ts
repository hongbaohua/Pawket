// 資料庫讀寫層：App.tsx 只呼叫這裡的函式，不用自己組 Supabase 查詢語法。
// 負責把畫面用的 Transaction/Account（camelCase、巢狀 category）
// 轉成資料表用的欄位格式（snake_case、攤平），反之亦然。

import { supabase } from './supabaseClient';
import { Transaction, Account, AccountType, L1Category } from '../types';

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
  date: string;
  merchant: string;
  original_text: string | null;
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
  originalText: row.original_text || '',
  amount: Number(row.net_amount),
  type: row.type,
  accountId: row.account_id || undefined,
  fromAccountId: row.from_account_id || undefined,
  toAccountId: row.to_account_id || undefined,
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
  date: tx.date,
  merchant: tx.merchant,
  original_text: tx.originalText,
  gross_amount: tx.amount,
  discounts: [],
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

export const fetchTransactions = async (): Promise<Transaction[]> => {
  const { data, error } = await supabase.from('transactions').select('*').order('date', { ascending: false });
  if (error) throw error;
  return (data as TransactionRow[]).map(rowToTransaction);
};

// upsert：新增跟編輯共用同一個函式，id 已存在就更新、不存在就新增
export const upsertTransaction = async (userId: string, tx: Transaction): Promise<void> => {
  const { error } = await supabase.from('transactions').upsert(transactionToRow(userId, tx));
  if (error) throw error;
};

export const upsertTransactions = async (userId: string, txs: Transaction[]): Promise<void> => {
  if (txs.length === 0) return;
  const { error } = await supabase.from('transactions').upsert(txs.map(t => transactionToRow(userId, t)));
  if (error) throw error;
};

export const deleteTransaction = async (id: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
};

export const deleteTransactionsByParentId = async (parentId: string): Promise<void> => {
  const { error } = await supabase.from('transactions').delete().eq('parent_id', parentId);
  if (error) throw error;
};
