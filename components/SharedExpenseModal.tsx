// 共同支出／代墊分帳（規格書階段7第一批可用切片）：跟SplitModal(把一筆錢拆進不同
// 預算分類)是完全不同的概念——這裡記錄「這筆錢部分是幫別人代墊，之後要跟對方收/付清」。
// 刻意不調整任何花費統計/預算邏輯（Ivy 2026-07-27確認），純粹當追蹤用的帳本。
import React, { useState } from 'react';
import { X, Plus, Trash2, Users, Check } from 'lucide-react';
import { Transaction, Account, SharedExpense, SharedExpenseParticipant, L1Category } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface SharedExpenseModalProps {
  transaction: Transaction;
  existing?: SharedExpense;
  accounts: Account[];
  onClose: () => void;
  onSave: (expense: SharedExpense, additionalSettlements: Transaction[]) => void;
}

interface ParticipantDraft extends SharedExpenseParticipant {
  wasSettledBefore: boolean; // 進來這個畫面之前就已經結清了，用來判斷這次存檔要不要順便產生結算交易
  recordSettlementNow: boolean;
  settlementAccountId: string;
}

const SETTLE_METHODS: NonNullable<SharedExpenseParticipant['settleMethod']>[] = ['現金', '轉帳', 'LINE Pay Money', '其他'];

const SharedExpenseModal: React.FC<SharedExpenseModalProps> = ({ transaction, existing, accounts, onClose, onSave }) => {
  const [totalAmount, setTotalAmount] = useState<number>(existing?.totalAmount ?? transaction.amount);
  const [myShare, setMyShare] = useState<number>(existing?.myShare ?? transaction.amount);
  const [participants, setParticipants] = useState<ParticipantDraft[]>(
    (existing?.participants ?? []).map(p => ({
      ...p,
      wasSettledBefore: p.settled,
      recordSettlementNow: false,
      settlementAccountId: accounts.find(a => !a.isArchived)?.id || '',
    }))
  );

  const participantsTotal = participants.reduce((sum, p) => sum + (isNaN(p.owedAmount) ? 0 : p.owedAmount), 0);

  const addParticipant = () => {
    setParticipants(prev => [...prev, {
      id: uuidv4(),
      name: '',
      owedAmount: 0,
      direction: 'they_owe_me',
      settled: false,
      wasSettledBefore: false,
      recordSettlementNow: false,
      settlementAccountId: accounts.find(a => !a.isArchived)?.id || '',
    }]);
  };

  const removeParticipant = (id: string) => setParticipants(prev => prev.filter(p => p.id !== id));

  const updateParticipant = (id: string, patch: Partial<ParticipantDraft>) => {
    setParticipants(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const handleSave = () => {
    const expense: SharedExpense = {
      id: existing?.id || uuidv4(),
      transactionId: transaction.id,
      totalAmount,
      myShare,
      participants: participants
        .filter(p => p.name.trim())
        .map(({ wasSettledBefore, recordSettlementNow, settlementAccountId, ...p }) => p),
    };

    // 只有「這次才剛標成已結清」且勾了「順便記交易」的參與者才產生結算交易，
    // 避免重新打開這個畫面再存一次時，已經結清過的舊資料又被重複記一筆。
    const additionalSettlements: Transaction[] = participants
      .filter(p => p.settled && !p.wasSettledBefore && p.recordSettlementNow && p.name.trim())
      .map(p => {
        const isIncome = p.direction === 'they_owe_me';
        const l1 = isIncome ? L1Category.INCOME : L1Category.VARIABLE;
        // 分帳結清這種現金流動跟一般收支性質不同，不套用「陣列第一項」的通用預設值
        // （那樣income會被誤標成「薪資收入」、expense會被誤標成「餐飲食品」），
        // 分別挑一個語意上比較貼近的分類：收到別人還錢算「其他」，還錢給別人算「社交人情」。
        const l2 = isIncome ? '其他' : '社交人情';
        return {
          id: uuidv4(),
          date: p.settledDate || new Date().toISOString().split('T')[0],
          merchant: `分帳結清：${p.name}`,
          originalText: 'Shared Expense Settlement',
          amount: p.owedAmount,
          type: isIncome ? 'income' : 'expense',
          accountId: p.settlementAccountId || undefined,
          paymentChannel: p.settleMethod,
          category: { l1, l2, l3: '分帳結清' },
          confidence: 1,
          isVerified: true,
          isSplit: false,
        } as Transaction;
      });

    onSave(expense, additionalSettlements);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[48px] shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border-4 border-white overflow-hidden">
        <div className="p-8 border-b border-purple-100 flex justify-between items-center bg-white/50 backdrop-blur">
          <h3 className="text-2xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2 bg-purple-100 text-purple-500 rounded-2xl"><Users className="w-6 h-6" /></div>
            分攤明細
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 overflow-y-auto flex-1 space-y-6">
          <div className="bg-white border border-purple-100 p-5 rounded-[28px] shadow-sm">
            <p className="text-sm font-bold text-slate-500 mb-3">{transaction.merchant || '（未命名交易）'}</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">總金額</label>
                <input type="number" value={totalAmount} onChange={e => setTotalAmount(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-[#FFFBF5] border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-purple-300" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">我的份額</label>
                <input type="number" value={myShare} onChange={e => setMyShare(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-[#FFFBF5] border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-purple-300" />
              </div>
            </div>
            {Math.abs((myShare + participantsTotal) - totalAmount) > 0.5 && (
              <p className="text-[11px] text-amber-500 font-bold mt-2">我的份額 + 大家欠的金額加總（${(myShare + participantsTotal).toFixed(0)}）跟總金額（${totalAmount.toFixed(0)}）對不起來，先確認一下數字沒填錯，這裡不會擋存檔。</p>
            )}
          </div>

          <div className="space-y-3">
            {participants.map(p => (
              <div key={p.id} className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={p.name}
                    onChange={e => updateParticipant(p.id, { name: e.target.value })}
                    placeholder="對方姓名"
                    className="flex-1 min-w-0 p-2.5 bg-[#FFFBF5] border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-purple-300"
                  />
                  <input
                    type="number"
                    value={p.owedAmount}
                    onChange={e => updateParticipant(p.id, { owedAmount: parseFloat(e.target.value) || 0 })}
                    placeholder="金額"
                    className="w-24 p-2.5 bg-[#FFFBF5] border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-purple-300 text-right"
                  />
                  <button type="button" onClick={() => removeParticipant(p.id)} className="p-2 text-slate-300 hover:text-rose-400 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="flex p-1 bg-slate-50 rounded-xl border border-slate-100">
                  {([
                    { key: 'they_owe_me', label: '對方欠我' },
                    { key: 'i_owe_them', label: '我欠對方' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => updateParticipant(p.id, { direction: opt.key })}
                      className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition-all ${p.direction === opt.key ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-400'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p.settled}
                    onChange={e => updateParticipant(p.id, {
                      settled: e.target.checked,
                      // 剛勾起來的話預設今天結清，已經結清過的(wasSettledBefore)維持原本的settledDate不動
                      settledDate: e.target.checked && !p.wasSettledBefore ? new Date().toISOString().split('T')[0] : p.settledDate,
                    })}
                    className="w-4 h-4 accent-purple-500"
                  />
                  已結清
                </label>

                {p.settled && !p.wasSettledBefore && (
                  <div className="pl-6 space-y-2 animate-in slide-in-from-top-1 border-l-2 border-purple-100">
                    <div className="flex flex-wrap gap-1.5">
                      {SETTLE_METHODS.map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateParticipant(p.id, { settleMethod: m })}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${p.settleMethod === m ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-slate-500 border-slate-200 hover:border-purple-200'}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500 cursor-pointer">
                      <input type="checkbox" checked={p.recordSettlementNow} onChange={e => updateParticipant(p.id, { recordSettlementNow: e.target.checked })} className="w-3.5 h-3.5 accent-purple-500" />
                      順便記一筆{p.direction === 'they_owe_me' ? '收到這筆錢' : '付出這筆錢'}的交易
                    </label>
                    {p.recordSettlementNow && (
                      <select
                        value={p.settlementAccountId}
                        onChange={e => updateParticipant(p.id, { settlementAccountId: e.target.value })}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none"
                      >
                        {accounts.filter(a => !a.isArchived).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
                {p.settled && p.wasSettledBefore && (
                  <p className="text-[11px] text-emerald-500 font-bold flex items-center gap-1"><Check className="w-3 h-3" />已結清{p.settledDate ? `（${p.settledDate}）` : ''}</p>
                )}
              </div>
            ))}
            <button onClick={addParticipant} type="button" className="w-full py-3 border-2 border-dashed border-purple-200 rounded-2xl text-purple-400 font-bold hover:bg-purple-50 transition flex justify-center items-center gap-2">
              <Plus className="w-4 h-4" /> 新增分攤對象
            </button>
          </div>
        </div>

        <div className="p-6 border-t border-purple-100 bg-white/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold transition">取消</button>
          <button onClick={handleSave} className="px-8 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-2xl font-bold shadow-lg shadow-purple-100 transition active:scale-95">儲存分攤明細</button>
        </div>
      </div>
    </div>
  );
};

export default SharedExpenseModal;
