import React, { useState } from 'react';
import { X, Plus, Pencil, Trash2, Wallet, CreditCard, Landmark, Coins, Banknote } from 'lucide-react';
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

// 2026-08-13：預期入帳延遲改成直接預設0-15天(現金/電子支付通常當下就算，銀行卡常見5-9天，
// 15天是保守上限)，不再讓帳戶預設「沒填」——Ivy反應過沒填的帳戶不能拿來餵食核對，
// 與其每個帳戶都要手動填一次，不如給一個能用的預設值，需要更精準再自己調整。
const emptyForm = (): Omit<Account, 'id'> & { id?: string } => ({
  name: '', institution: '', type: 'bank_debit', currency: 'TWD', isArchived: false,
  postingDelayMin: 0, postingDelayMax: 15,
});

interface AccountsPanelProps {
  accounts: Account[];
  onSave: (account: Omit<Account, 'id'> & { id?: string }) => Promise<void>;
  onArchive: (accountId: string) => Promise<void>;
}

// 帳戶管理的實際內容（列表＋編輯表單），不含外層彈窗框——這樣「碗盤總覽」既可以是
// 獨立彈窗(AccountsModal，餵食核對「去設定」按鈕還在用)，也可以直接嵌進系統設定的
// 手風琴區塊裡(2026-08-13 Ivy要求)，不用維護兩份重複的表單邏輯。
export const AccountsPanel: React.FC<AccountsPanelProps> = ({ accounts, onSave, onArchive }) => {
  const [editing, setEditing] = useState<(Omit<Account, 'id'> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = accounts
    .filter(a => !a.isArchived)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    // 2026-08-13新增：編輯既有帳戶（不是新增）要先二次確認才儲存，帳戶設定會影響
    // 全站餘額計算，改錯比改錯一筆交易的影響範圍大很多。新增帳戶不用額外確認
    // （還沒有任何資料依賴它，改錯了直接刪掉重建就好）。
    if (editing.id && !window.confirm(`確定要儲存對「${editing.name.trim()}」的修改嗎？`)) return;
    setSaving(true);
    try {
      // 機構名稱欄位目前沒有另外的用途（對帳模組是用accountId直接對應，不是靠這個文字欄位），
      // 跟顯示名稱合併成一欄，不用填兩次。
      await onSave({ ...editing, institution: editing.name.trim() });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = (acc: Account) => {
    if (!window.confirm(`確定要封存「${acc.name}」嗎？封存後這個帳戶不會再出現在選單裡，但底下的交易紀錄不會被刪除，之後有需要可以請 Claude Code 幫忙復原。`)) return;
    onArchive(acc.id);
  };

  return (
    <>
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
                          <button onClick={() => handleArchive(acc)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="封存（不會刪除底下的交易紀錄）"><Trash2 className="w-4 h-4" /></button>
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
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">
              餵食核對用：預期入帳延遲天數（預設0-15天，不確定可以先不改）
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">最短幾天</label>
                <input
                  type="number"
                  min={0}
                  value={editing.postingDelayMin ?? ''}
                  onChange={e => setEditing({ ...editing, postingDelayMin: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                  placeholder="例如：0"
                  className="w-full p-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl font-bold outline-none focus:border-amber-300"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">最長幾天</label>
                <input
                  type="number"
                  min={0}
                  value={editing.postingDelayMax ?? ''}
                  onChange={e => setEditing({ ...editing, postingDelayMax: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                  placeholder="例如：15"
                  className="w-full p-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl font-bold outline-none focus:border-amber-300"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              消費之後銀行通常要幾天才會在對帳單上顯示——現金/電子支付通常是0天（當下就算），
              銀行簽帳卡/信用卡常見要等5-9天。這兩個數字是「餵食核對」功能比對用的，不影響一般記帳。
            </p>
          </div>
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={() => setEditing(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold transition">取消</button>
            <button type="submit" disabled={saving} className="flex-1 py-3 bg-amber-400 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-lg shadow-amber-100 active:scale-95 transition disabled:opacity-60">
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </form>
      )}
    </>
  );
};

interface AccountsModalProps {
  accounts: Account[];
  onClose: () => void;
  onSave: (account: Omit<Account, 'id'> & { id?: string }) => Promise<void>;
  onArchive: (accountId: string) => Promise<void>;
}

const AccountsModal: React.FC<AccountsModalProps> = ({ accounts, onClose, onSave, onArchive }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-xl rounded-[40px] shadow-2xl border-4 border-white max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-8 pb-6 shrink-0">
          <h3 className="text-2xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-500 rounded-2xl"><Wallet className="w-6 h-6" /></div>
            碗盤總覽
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-full transition"><X className="w-6 h-6 text-slate-300" /></button>
        </div>

        <div className="px-8 pb-8 overflow-y-auto">
          <AccountsPanel accounts={accounts} onSave={onSave} onArchive={onArchive} />
        </div>
      </div>
    </div>
  );
};

export default AccountsModal;
