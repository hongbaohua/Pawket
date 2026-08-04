// 共同支出／代墊分帳：應收應付總覽彈窗，列出所有還沒結清的參與者項目，
// 每項可以直接「標記已結清」，不用跳回原始交易一筆一筆找。
import React, { useState, useMemo } from 'react';
import { X, Users, Check, ArrowDownCircle, ArrowUpCircle, Link2 } from 'lucide-react';
import { Transaction, Account, SharedExpense, SharedExpenseParticipant, L1Category } from '../types';
import { v4 as uuidv4 } from 'uuid';

type SettleAction = 'none' | 'record_new' | 'link_existing';

interface SharedExpenseListModalProps {
  sharedExpenses: SharedExpense[];
  transactions: Transaction[];
  accounts: Account[];
  onClose: () => void;
  onSettle: (sharedExpenseId: string, participant: SharedExpenseParticipant, additionalSettlement?: Transaction) => void;
}

const SETTLE_METHODS: NonNullable<SharedExpenseParticipant['settleMethod']>[] = ['現金', '轉帳', 'LINE Pay Money', '其他'];

interface FlatItem {
  sharedExpenseId: string;
  participant: SharedExpenseParticipant;
  merchant: string;
  date: string;
}

const SharedExpenseListModal: React.FC<SharedExpenseListModalProps> = ({ sharedExpenses, transactions, accounts, onClose, onSettle }) => {
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [settleMethod, setSettleMethod] = useState<NonNullable<SharedExpenseParticipant['settleMethod']>>('現金');
  const [settleAction, setSettleAction] = useState<SettleAction>('record_new');
  const [settlementAccountId, setSettlementAccountId] = useState(accounts.find(a => !a.isArchived)?.id || '');
  const [linkedTransactionId, setLinkedTransactionId] = useState('');

  const items = useMemo<FlatItem[]>(() => {
    const result: FlatItem[] = [];
    sharedExpenses.forEach(se => {
      const tx = transactions.find(t => t.id === se.transactionId);
      se.participants.filter(p => !p.settled).forEach(p => {
        result.push({ sharedExpenseId: se.id, participant: p, merchant: tx?.merchant || '（找不到原始交易）', date: tx?.date || '' });
      });
    });
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }, [sharedExpenses, transactions]);

  const theyOweMe = items.filter(i => i.participant.direction === 'they_owe_me');
  const iOweThem = items.filter(i => i.participant.direction === 'i_owe_them');
  const totalTheyOweMe = theyOweMe.reduce((sum, i) => sum + i.participant.owedAmount, 0);
  const totalIOweThem = iOweThem.reduce((sum, i) => sum + i.participant.owedAmount, 0);

  const startSettle = (participantId: string) => {
    setSettlingId(participantId);
    setSettleMethod('現金');
    setSettleAction('record_new');
    setSettlementAccountId(accounts.find(a => !a.isArchived)?.id || '');
    setLinkedTransactionId('');
  };

  const confirmSettle = (item: FlatItem) => {
    const p = item.participant;
    let additionalSettlement: Transaction | undefined;
    if (settleAction === 'record_new') {
      const isIncome = p.direction === 'they_owe_me';
      const l1 = isIncome ? L1Category.INCOME : L1Category.VARIABLE;
      // 跟SharedExpenseModal.tsx同樣的理由：不用「陣列第一項」的通用預設分類
      const l2 = isIncome ? '其他' : '社交人情';
      additionalSettlement = {
        id: uuidv4(),
        date: new Date().toISOString().split('T')[0],
        merchant: `分帳結清：${p.name}`,
        originalText: 'Shared Expense Settlement',
        amount: p.owedAmount,
        type: isIncome ? 'income' : 'expense',
        accountId: settlementAccountId || undefined,
        paymentChannel: settleMethod,
        category: { l1, l2, l3: '分帳結清' },
        confidence: 1,
        isVerified: true,
        isSplit: false,
      };
    }
    onSettle(item.sharedExpenseId, {
      ...p,
      settled: true,
      settleMethod,
      settledDate: new Date().toISOString().split('T')[0],
      settledTransactionId: settleAction === 'link_existing' ? (linkedTransactionId || undefined) : undefined,
    }, additionalSettlement);
    setSettlingId(null);
  };

  const renderItem = (item: FlatItem) => {
    const p = item.participant;
    const isSettling = settlingId === p.id;
    return (
      <div key={p.id} className="p-4 bg-white border border-slate-200 rounded-2xl space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold text-slate-700">{p.name}</p>
            <p className="text-[11px] text-slate-400">{item.merchant}{item.date ? ` · ${item.date}` : ''}</p>
          </div>
          <p className={`font-mono font-bold ${p.direction === 'they_owe_me' ? 'text-emerald-600' : 'text-rose-500'}`}>${p.owedAmount}</p>
        </div>
        {!isSettling ? (
          <button type="button" onClick={() => startSettle(p.id)} className="w-full py-2 bg-slate-50 hover:bg-purple-50 hover:text-purple-500 text-slate-500 rounded-xl text-xs font-bold transition">標記已結清</button>
        ) : (
          <div className="pt-2 border-t border-slate-100 space-y-2 animate-in slide-in-from-top-1">
            <div className="flex flex-wrap gap-1.5">
              {SETTLE_METHODS.map(m => (
                <button key={m} type="button" onClick={() => setSettleMethod(m)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${settleMethod === m ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-slate-500 border-slate-200'}`}>{m}</button>
              ))}
            </div>
            <div className="space-y-1">
              {([
                { key: 'none', label: '不用，只標記已結清' },
                { key: 'record_new', label: `順便記一筆${p.direction === 'they_owe_me' ? '收到這筆錢' : '付出這筆錢'}的交易` },
                { key: 'link_existing', label: '已經記過帳了，連結到那筆交易' },
              ] as const).map(opt => (
                <label key={opt.key} className="flex items-center gap-2 text-[11px] font-bold text-slate-500 cursor-pointer">
                  <input
                    type="radio"
                    name={`list-settle-action-${p.id}`}
                    checked={settleAction === opt.key}
                    onChange={() => setSettleAction(opt.key)}
                    className="w-3.5 h-3.5 accent-purple-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {settleAction === 'record_new' && (
              <select value={settlementAccountId} onChange={e => setSettlementAccountId(e.target.value)} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none">
                {accounts.filter(a => !a.isArchived).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {settleAction === 'link_existing' && (
              <select value={linkedTransactionId} onChange={e => setLinkedTransactionId(e.target.value)} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none">
                <option value="">選擇交易...</option>
                {transactions
                  .filter(t => t.type === (p.direction === 'they_owe_me' ? 'income' : 'expense'))
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .slice(0, 50)
                  .map(t => (
                    <option key={t.id} value={t.id}>{t.date}・{t.merchant || '（未命名）'}・${t.amount}</option>
                  ))}
              </select>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setSettlingId(null)} className="flex-1 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-bold">取消</button>
              <button type="button" onClick={() => confirmSettle(item)} className="flex-1 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" />確認</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[48px] shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col border-4 border-white overflow-hidden">
        <div className="p-8 border-b border-purple-100 flex justify-between items-center bg-white/50 backdrop-blur">
          <h3 className="text-2xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2 bg-purple-100 text-purple-500 rounded-2xl"><Users className="w-6 h-6" /></div>
            應收應付
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>
        <div className="p-8 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <p className="text-xs font-bold text-emerald-500 flex items-center gap-1"><ArrowDownCircle className="w-3.5 h-3.5" />應收</p>
              <p className="text-2xl font-extrabold text-emerald-600">${totalTheyOweMe}</p>
            </div>
            <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100">
              <p className="text-xs font-bold text-rose-500 flex items-center gap-1"><ArrowUpCircle className="w-3.5 h-3.5" />應付</p>
              <p className="text-2xl font-extrabold text-rose-600">${totalIOweThem}</p>
            </div>
          </div>

          {items.length === 0 && <p className="text-center text-slate-300 py-6">目前沒有還沒結清的分帳項目喵～</p>}

          {theyOweMe.length > 0 && (
            <div>
              <h4 className="font-extrabold text-emerald-500 mb-2 text-sm">別人欠我（{theyOweMe.length}）</h4>
              <div className="space-y-2">{theyOweMe.map(renderItem)}</div>
            </div>
          )}
          {iOweThem.length > 0 && (
            <div>
              <h4 className="font-extrabold text-rose-500 mb-2 text-sm">我欠別人（{iOweThem.length}）</h4>
              <div className="space-y-2">{iOweThem.map(renderItem)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SharedExpenseListModal;
