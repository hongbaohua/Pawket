import React, { useState } from 'react';
import { X, ArrowRight, Repeat, AlertCircle } from 'lucide-react';
import { Account, Transaction, L1Category } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface TransferModalProps {
  accounts: Account[];
  transaction?: Transaction; // 有帶入代表是編輯既有的帳戶互轉
  onClose: () => void;
  onSave: (tx: Transaction) => void;
}

// 帳戶互轉：App裡自己追蹤的帳戶之間的資金移動（提款、儲值電子支付、悠遊卡加值...），
// 跟真正的銀行轉帳是不同概念，不算收入也不算支出，故意不叫「轉帳」避免混淆。
const TransferModal: React.FC<TransferModalProps> = ({ accounts, transaction, onClose, onSave }) => {
  const activeAccounts = accounts.filter(a => !a.isArchived);
  const [date, setDate] = useState(transaction?.date || new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState(transaction?.amount || 0);
  const [fromAccountId, setFromAccountId] = useState(transaction?.fromAccountId || activeAccounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState(transaction?.toAccountId || activeAccounts[1]?.id || activeAccounts[0]?.id || '');
  const [note, setNote] = useState(transaction?.merchant || '');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!amount || amount <= 0) { setError('請輸入金額'); return; }
    if (!fromAccountId || !toAccountId) { setError('請選擇來源跟去向帳戶'); return; }
    if (fromAccountId === toAccountId) { setError('來源跟去向帳戶不能一樣'); return; }

    const fromName = activeAccounts.find(a => a.id === fromAccountId)?.name || '';
    const toName = activeAccounts.find(a => a.id === toAccountId)?.name || '';

    onSave({
      id: transaction?.id || uuidv4(),
      date,
      merchant: note.trim() || `帳戶互轉：${fromName} → ${toName}`,
      originalText: transaction?.originalText || 'Manual Transfer',
      amount: Math.abs(amount),
      type: 'transfer',
      fromAccountId,
      toAccountId,
      category: { l1: L1Category.VARIABLE, l2: '轉帳', l3: '' },
      confidence: 1.0,
      isVerified: true,
      isSplit: false,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-md w-full border-4 border-white overflow-hidden">
        <div className="p-8 border-b border-amber-100 flex justify-between items-center bg-white/50">
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-sky-100 text-sky-500"><Repeat className="w-5 h-5" /></div>
            帳戶互轉
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">日期</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:border-amber-300" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">金額</label>
            <input type="number" value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value))} className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:border-amber-300" placeholder="0" />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">從</label>
              <select value={fromAccountId} onChange={e => setFromAccountId(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:border-amber-300">
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-300 mt-6 shrink-0" />
            <div className="flex-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">到</label>
              <select value={toAccountId} onChange={e => setToAccountId(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:border-amber-300">
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">備註（選填）</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="例如：LINE Pay Money 儲值" className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:border-amber-300" />
          </div>

          {error && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex gap-2 items-center text-rose-600 text-sm font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-amber-100 bg-white/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition">取消</button>
          <button onClick={handleSave} className="px-8 py-3 rounded-2xl font-bold text-white bg-sky-400 hover:bg-sky-500 shadow-lg shadow-sky-100 active:scale-95 transition">
            儲存
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferModal;
