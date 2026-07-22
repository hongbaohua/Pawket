import React, { useState } from 'react';
import { X, Plus, Pencil, Archive, Wallet, CreditCard, Landmark, Coins, Banknote } from 'lucide-react';
import { Account, AccountType } from '../types';

// 順序照「誰是真正的錢、誰是衍生出來的」排：現金/銀行/信用卡是原始金流，
// 電子支付錢包要先儲值進去才能用（能綁多家銀行/多張卡，不是固定一個來源），
// 實體儲值卡/點數卡又更下游（例如悠遊卡只能從悠遊付加值）。
const TYPE_LABELS: Record<AccountType, string> = {
  cash: '現金',
  bank_debit: '銀行帳戶/簽帳卡',
  bank_credit: '信用卡',
  e_wallet: '電子支付錢包',
  stored_value: '實體儲值卡/點數卡',
};

const TYPE_ICONS: Record<AccountType, React.ReactNode> = {
  cash: <Banknote className="w-5 h-5" />,
  bank_debit: <Landmark className="w-5 h-5" />,
  bank_credit: <CreditCard className="w-5 h-5" />,
  e_wallet: <Wallet className="w-5 h-5" />,
  stored_value: <Coins className="w-5 h-5" />,
};

const TYPE_ORDER: AccountType[] = ['cash', 'bank_debit', 'bank_credit', 'e_wallet', 'stored_value'];

interface AccountsModalProps {
  accounts: Account[];
  onClose: () => void;
  onSave: (account: Omit<Account, 'id'> & { id?: string }) => Promise<void>;
  onArchive: (accountId: string) => Promise<void>;
}

const emptyForm = (): Omit<Account, 'id'> & { id?: string } => ({
  name: '', institution: '', type: 'bank_debit', currency: 'TWD', isArchived: false
});

const AccountsModal: React.FC<AccountsModalProps> = ({ accounts, onClose, onSave, onArchive }) => {
  const [editing, setEditing] = useState<(Omit<Account, 'id'> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = accounts
    .filter(a => !a.isArchived)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    try {
      // 機構名稱欄位目前沒有實際用途（對帳模組還沒做），跟顯示名稱合併成一欄，不用填兩次。
      await onSave({ ...editing, institution: editing.name.trim() });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-xl rounded-[40px] shadow-2xl border-4 border-white max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-8 pb-6 shrink-0">
          <h3 className="text-2xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-500 rounded-2xl"><Wallet className="w-6 h-6" /></div>
            帳戶管理
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-full transition"><X className="w-6 h-6 text-slate-300" /></button>
        </div>

        <div className="px-8 pb-8 overflow-y-auto">
        {!editing && (
          <>
            <div className="space-y-5 mb-6">
              {TYPE_ORDER.map(type => {
                const group = activeAccounts.filter(a => a.type === type);
                if (group.length === 0) return null;
                return (
                  <div key={type}>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1 flex items-center gap-1.5">
                      {TYPE_ICONS[type]} {TYPE_LABELS[type]}
                    </p>
                    <div className="space-y-2">
                      {group.map(acc => (
                        <div key={acc.id} className="flex items-center justify-between p-4 bg-[#FFFBF5] rounded-2xl border border-orange-50">
                          <p className="font-bold text-slate-700">{acc.name}</p>
                          <div className="flex gap-2">
                            <button onClick={() => setEditing(acc)} className="p-2 border rounded-xl hover:bg-amber-50" title="編輯"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => onArchive(acc.id)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="封存（不會刪除底下的交易紀錄）"><Archive className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {activeAccounts.length === 0 && <p className="text-center text-slate-300 py-6">還沒有任何帳戶</p>}
            </div>
            <button
              onClick={() => setEditing(emptyForm())}
              className="w-full flex items-center justify-center gap-2 py-3 bg-amber-400 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-lg shadow-amber-100 active:scale-95 transition"
            >
              <Plus className="w-5 h-5" /> 新增帳戶
            </button>
          </>
        )}

        {editing && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">名稱</label>
              <input
                required
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="例如：中國信託簽帳金融卡"
                className="w-full p-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl font-bold outline-none focus:border-amber-300"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">類型</label>
              <select
                value={editing.type}
                onChange={e => setEditing({ ...editing, type: e.target.value as AccountType })}
                className="w-full p-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl font-bold outline-none focus:border-amber-300"
              >
                {TYPE_ORDER.map(value => (
                  <option key={value} value={value}>{TYPE_LABELS[value]}</option>
                ))}
              </select>
              {editing.type === 'e_wallet' && (
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  儲值可以來自任何一個銀行帳戶/信用卡，不用在這裡指定固定來源——儲值時到「罐罐明細本」記一筆「帳戶互轉」交易，選這次實際用的來源帳戶就可以。
                </p>
              )}
              {editing.type === 'stored_value' && (
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  例如悠遊卡、麥當勞點點卡這類實體儲值卡。有些只能從特定電子支付錢包加值（例如悠遊卡只能從悠遊付加值），加值時一樣記一筆「帳戶互轉」交易即可。
                </p>
              )}
            </div>
            <div className="flex gap-3 mt-2">
              <button type="button" onClick={() => setEditing(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold transition">取消</button>
              <button type="submit" disabled={saving} className="flex-1 py-3 bg-amber-400 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-lg shadow-amber-100 active:scale-95 transition disabled:opacity-60">
                {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </form>
        )}
        </div>
      </div>
    </div>
  );
};

export default AccountsModal;
