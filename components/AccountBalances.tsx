import React from 'react';
import { Wallet, CreditCard, Landmark, Coins, Banknote, PiggyBank, ChevronDown, ChevronUp } from 'lucide-react';
import { Account, AccountType, Transaction } from '../types';
import { calculateAccountBalances } from '../services/logicService';

// 跟 AccountsModal.tsx 用同一套型別排序/圖示，維持畫面上帳戶的視覺語言一致。
const TYPE_LABELS: Record<AccountType, string> = {
  cash: '現金',
  bank_debit: '銀行帳戶/簽帳卡',
  bank_credit: '信用卡',
  e_wallet: '電子支付錢包',
  stored_value: '實體儲值卡/點數卡',
};

const TYPE_ICONS: Record<AccountType, React.ReactNode> = {
  cash: <Banknote className="w-4 h-4" />,
  bank_debit: <Landmark className="w-4 h-4" />,
  bank_credit: <CreditCard className="w-4 h-4" />,
  e_wallet: <Wallet className="w-4 h-4" />,
  stored_value: <Coins className="w-4 h-4" />,
};

const TYPE_ORDER: AccountType[] = ['cash', 'bank_debit', 'bank_credit', 'e_wallet', 'stored_value'];

// 收合狀態下顯示的小徽章，跟「至今累積/月度模式/週期模式」那個選單列同高、並排放置。
export const AccountBalancesCollapsedPill: React.FC<{
  accounts: Account[];
  allTransactions: Transaction[];
  onExpand: () => void;
}> = ({ accounts, allTransactions, onExpand }) => {
  const activeAccounts = accounts.filter(a => !a.isArchived);
  const balances = calculateAccountBalances(activeAccounts, allTransactions);
  const total = activeAccounts
    .filter(a => a.type !== 'bank_credit')
    .reduce((sum, a) => sum + (balances[a.id] || 0), 0);

  if (activeAccounts.length === 0) return null;

  return (
    <button
      onClick={onExpand}
      className="bg-white p-2 rounded-[24px] shadow-sm border border-orange-50 inline-flex items-center w-full md:w-fit"
    >
      <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-2xl">
        <PiggyBank className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-sm font-bold text-slate-500 whitespace-nowrap">帳戶餘額總覽</span>
        <span className={`text-sm font-black whitespace-nowrap ${total >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
          ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </div>
    </button>
  );
};

interface AccountBalancesProps {
  accounts: Account[];
  allTransactions: Transaction[];
  onCollapse: () => void;
}

const AccountBalances: React.FC<AccountBalancesProps> = ({ accounts, allTransactions, onCollapse }) => {
  const activeAccounts = accounts.filter(a => !a.isArchived);

  const balances = calculateAccountBalances(activeAccounts, allTransactions);
  // 信用卡的「餘額」概念是欠款，正負號跟其他帳戶相反(其他帳戶正=有錢，信用卡正=有溢繳)，
  // 這裡先跟其他帳戶一樣算淨流入/流出，之後如果要做真的「欠款」概念再另外處理。
  const total = activeAccounts
    .filter(a => a.type !== 'bank_credit')
    .reduce((sum, a) => sum + (balances[a.id] || 0), 0);

  if (activeAccounts.length === 0) return null;

  // 照帳戶類型分組顯示，跟帳戶管理畫面的分組邏輯一致，只顯示有帳戶的類型。
  const groups = TYPE_ORDER
    .map(type => ({ type, accounts: activeAccounts.filter(a => a.type === type) }))
    .filter(g => g.accounts.length > 0);

  return (
    <div className="bg-white rounded-[32px] p-5 shadow-sm border border-orange-50" data-pdf-section>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base font-extrabold text-slate-700 flex items-center gap-2">
          <div className="p-1.5 bg-amber-100 text-amber-500 rounded-xl"><PiggyBank className="w-4 h-4" /></div>
          帳戶餘額總覽
        </h3>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">總資產（不含信用卡）</p>
            <p className={`text-lg font-black ${total >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <button onClick={onCollapse} className="p-2 hover:bg-slate-50 rounded-full transition shrink-0" title="收合">
            <ChevronUp className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </div>
      <div className="space-y-3 mt-4">
        {groups.map(group => (
          <div key={group.type}>
            <div className="flex items-center gap-2 mb-1.5 text-slate-400">
              {TYPE_ICONS[group.type]}
              <span className="text-[10px] font-bold uppercase tracking-wide">{TYPE_LABELS[group.type]}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.accounts.map(acc => {
                const bal = balances[acc.id] || 0;
                const isCredit = acc.type === 'bank_credit';
                return (
                  <div key={acc.id} className="px-2.5 py-1.5 bg-[#FFFBF5] rounded-lg border border-orange-50 inline-flex items-center gap-1.5 w-fit">
                    <p className="text-xs font-bold text-slate-600 whitespace-nowrap">{acc.name}</p>
                    <p className={`text-xs font-black whitespace-nowrap ${isCredit ? 'text-slate-500' : bal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {isCredit && bal < 0 ? '欠款 ' : ''}${Math.abs(bal).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-300 mt-3 leading-relaxed">
        這裡是「用App記錄以來」的即時累加金額，不是手動輸入的期初餘額。如果跟實際帳戶金額對不上，
        代表有交易還沒記到App裡，之後可以用對帳功能抓落差。
      </p>
    </div>
  );
};

export default AccountBalances;
