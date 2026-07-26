// 對帳模組核心比對邏輯：拿一份銀行對帳單抽出來的原始資料列(BankStatementRow[])，
// 跟這個帳戶既有的手動記帳(Transaction[])做「日期區間+金額」模糊比對——刻意不比對
// 商家名稱，因為銀行代碼常常是截斷/無意義的（見規格書§4）。純計算，不做任何DB寫入，
// 呼叫端(components/ReconcileView.tsx)決定要不要把結果存回去。
import { Account, Transaction, BankStatementRow } from '../types';
import { RECONCILE_AMOUNT_TOLERANCE } from '../config/financialRules';

export interface BankRowMatch {
  bankRow: BankStatementRow;
  status: 'matched' | 'missing_manual';
  matchedTransactionId?: string;
}

export interface ManualStatusUpdate {
  transactionId: string;
  status: 'pending_settlement' | 'missing_official';
}

export interface ReconcileResult {
  bankRowMatches: BankRowMatch[];        // 每一列銀行資料的比對結果
  manualUpdates: ManualStatusUpdate[];   // 候選池裡沒被任何銀行資料認領的既有交易該轉成什麼狀態
}

const addDays = (dateStr: string, delta: number): string => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0];
};

// row.date - t.date 差幾天（正數代表銀行入帳日晚於手動記帳日，符合入帳延遲的預期方向）
const daysBetween = (fromDate: string, toDate: string): number => {
  const a = new Date(fromDate + 'T00:00:00').getTime();
  const b = new Date(toDate + 'T00:00:00').getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
};

const flowMatches = (t: Transaction, row: BankStatementRow, accountId: string): boolean => {
  if (row.flowType === 'debit') {
    return t.type === 'expense' || (t.type === 'transfer' && t.fromAccountId === accountId);
  }
  return t.type === 'income' || (t.type === 'transfer' && t.toAccountId === accountId);
};

export const reconcile = (
  account: Account,
  bankRows: BankStatementRow[],
  allTransactions: Transaction[]
): ReconcileResult => {
  if (account.postingDelayMin == null || account.postingDelayMax == null) {
    throw new Error('這個帳戶還沒設定入帳延遲天數，請先到帳戶管理設定再對帳');
  }
  if (bankRows.length === 0) return { bankRowMatches: [], manualUpdates: [] };

  const min = account.postingDelayMin;
  const max = account.postingDelayMax;
  const sortedDates = [...bankRows].map(r => r.date).sort();
  const statementStart = sortedDates[0];
  const statementEnd = sortedDates[sortedDates.length - 1];
  const poolStart = addDays(statementStart, -max);

  // 候選池：這個帳戶「有可能被這份對帳單涵蓋到」的既有交易，避免動到其他月份的資料
  const candidatePool = allTransactions.filter(t =>
    !t.deletedAt &&
    (t.accountId === account.id || t.fromAccountId === account.id || t.toAccountId === account.id) &&
    t.date >= poolStart && t.date <= statementEnd
  );

  const usedIds = new Set<string>();
  const bankRowMatches: BankRowMatch[] = [];

  const sortedRows = [...bankRows].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sortedRows) {
    const flowOk = candidatePool.filter(t => !usedIds.has(t.id) && flowMatches(t, row, account.id));
    const amountOk = flowOk.filter(t => Math.abs(t.amount - row.amount) <= RECONCILE_AMOUNT_TOLERANCE);
    const dateOk = amountOk.filter(t => {
      const delta = daysBetween(t.date, row.date);
      return delta >= min && delta <= max;
    });

    if (dateOk.length === 0) {
      bankRowMatches.push({ bankRow: row, status: 'missing_manual' });
    } else {
      // 日期差最小的優先認領，避免同一筆手動記帳被兩列銀行資料搶著配對
      dateOk.sort((a, b) => Math.abs(daysBetween(a.date, row.date)) - Math.abs(daysBetween(b.date, row.date)));
      const best = dateOk[0];
      usedIds.add(best.id);
      bankRowMatches.push({ bankRow: row, status: 'matched', matchedTransactionId: best.id });
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const manualUpdates: ManualStatusUpdate[] = candidatePool
    .filter(t => !usedIds.has(t.id))
    .map(t => ({
      transactionId: t.id,
      status: daysBetween(t.date, today) <= max ? 'pending_settlement' : 'missing_official'
    }));

  return { bankRowMatches, manualUpdates };
};
