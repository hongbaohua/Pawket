// 系統設定：偏好設定的統一入口（2026-08-06 Ivy要求，不用每加一個設定就重新設計入口）。
// 2026-08-11新增「分類預算設定」+「長期預留支出」——取代原本自動用歷史中位數外推的
// 配速警示：系統只給「近期／長期」兩組參考數字，不自動套用，由Ivy自己確認金額才存檔。
import React, { useState } from 'react';
import { X, Settings, Sparkles, Wallet, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import { Transaction, LongTermReserve } from '../types';
import { suggestCategoryBudgets } from '../services/logicService';
import { v4 as uuidv4 } from 'uuid';

interface SettingsModalProps {
  similarTransactionAlertsEnabled: boolean;
  onUpdateSimilarTransactionAlerts: (enabled: boolean) => void;
  allTransactions: Transaction[];
  categoryBudgets: Record<string, number>;
  onUpdateCategoryBudgets: (budgets: Record<string, number>) => void;
  longTermReserves: LongTermReserve[];
  onUpdateLongTermReserves: (reserves: LongTermReserve[]) => void;
  onClose: () => void;
}

// 長期預留支出候選項目：查證過Ivy的真實資料完全不夠自動偵測到期日(保險費用全部歷史
// 只出現過1筆)，這裡列出台灣常見的長期/週期性大額支出當候選，讓她自己勾選哪些適用、
// 填實際金額——不假設哪些一定適用(例如房屋稅/地價稅只有房屋所有權人才要繳，牌照稅/
// 燃料費只有車主才要繳，Ivy的紀錄看起來是租屋+沒有車輛相關支出，但還是列出來讓她自己
// 確認，不由系統直接假設拿掉)。frequencyMonths依台灣稅務行事曆/一般常見繳費週期填。
const RESERVE_CANDIDATES: { name: string; l2: string; frequencyMonths: number; note: string }[] = [
  { name: '電信網路', l2: '電信網路', frequencyMonths: 1, note: '通常月繳' },
  { name: '訂閱服務', l2: '訂閱服務', frequencyMonths: 1, note: '通常月繳' },
  { name: '水電瓦斯', l2: '水電瓦斯', frequencyMonths: 2, note: '台電/自來水通常雙月一期' },
  { name: '保險費用', l2: '保險費用', frequencyMonths: 12, note: '月繳/季繳/半年繳/年繳都有可能，請照實際保單填，可新增多筆' },
  { name: '綜合所得稅', l2: '稅務規費', frequencyMonths: 12, note: '每年5-6月申報，需要補稅才會是現金流出' },
  { name: '房屋稅', l2: '稅務規費', frequencyMonths: 12, note: '每年5月開徵，僅房屋所有權人需要繳，租屋通常不適用' },
  { name: '地價稅', l2: '稅務規費', frequencyMonths: 12, note: '每年11月開徵，僅地主需要繳' },
  { name: '使用牌照稅', l2: '稅務規費', frequencyMonths: 12, note: '每年4月開徵，僅車主需要繳' },
  { name: '燃料使用費', l2: '稅務規費', frequencyMonths: 12, note: '自用車每年7月徵收，僅車主需要繳' },
  { name: '孝親費用', l2: '孝親費用', frequencyMonths: 1, note: '固定給家人生活費通常月繳，節日紅包則另計' },
  { name: '教育學費', l2: '教育學費', frequencyMonths: 6, note: '進修課程常見學期繳' },
];

const FREQUENCY_OPTIONS = [
  { label: '月繳', value: 1 }, { label: '季繳', value: 3 },
  { label: '半年繳', value: 6 }, { label: '年繳', value: 12 },
];

const SettingsModal: React.FC<SettingsModalProps> = ({
  similarTransactionAlertsEnabled, onUpdateSimilarTransactionAlerts,
  allTransactions, categoryBudgets, onUpdateCategoryBudgets,
  longTermReserves, onUpdateLongTermReserves, onClose,
}) => {
  const suggestions = suggestCategoryBudgets(allTransactions);
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(categoryBudgets).map(([l2, v]) => [l2, String(v)]))
  );

  const saveBudget = (l2: string, raw: string) => {
    const trimmed = raw.trim();
    const next = { ...categoryBudgets };
    if (trimmed === '') {
      delete next[l2];
    } else {
      const num = Number(trimmed);
      if (!isFinite(num) || num < 0) return;
      next[l2] = num;
    }
    onUpdateCategoryBudgets(next);
  };

  const [reserves, setReserves] = useState<LongTermReserve[]>(longTermReserves);
  const addCandidate = (candidate: typeof RESERVE_CANDIDATES[number]) => {
    // 電信網路/訂閱服務有清楚的月繳紀錄，用最近的實際金額當預設值，其他候選項目金額留空給Ivy自己填。
    const recentTx = allTransactions
      .filter(t => t.type === 'expense' && t.category.l2 === candidate.l2)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const defaultAmount = candidate.frequencyMonths === 1 && recentTx ? recentTx.amount : 0;
    const next = [...reserves, { id: uuidv4(), name: candidate.name, l2: candidate.l2, amount: defaultAmount, frequencyMonths: candidate.frequencyMonths }];
    setReserves(next);
    onUpdateLongTermReserves(next);
  };
  const removeReserve = (id: string) => {
    const next = reserves.filter(r => r.id !== id);
    setReserves(next);
    onUpdateLongTermReserves(next);
  };
  // 直接算出新陣列、同時setState+存檔，不要拆成onChange先存local state、onBlur再讀
  // state存檔——onBlur讀到的reserves是「這次render時」關進closure的舊值，如果同一個
  // handler裡change完馬上存(例如下拉選單onChange)，會存到change之前的舊資料，
  // 使用者選了新的繳費週期卻沒真的存到。
  const updateReserveField = (id: string, field: 'amount' | 'frequencyMonths', value: number) => {
    const next = reserves.map(r => r.id === id ? { ...r, [field]: value } : r);
    setReserves(next);
    onUpdateLongTermReserves(next);
  };

  const monthlyReserveTotal = reserves.reduce((sum, r) => sum + (r.frequencyMonths > 0 ? r.amount / r.frequencyMonths : 0), 0);
  const availableCandidates = RESERVE_CANDIDATES.filter(c => !reserves.some(r => r.name === c.name));

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-2xl w-full border-4 border-white overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-8 border-b border-orange-50 flex justify-between items-center bg-white/50 shrink-0">
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-slate-100 text-slate-500"><Settings className="w-5 h-5" /></div>
            系統設定
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto flex-1">
          <div className="p-4 bg-white border border-slate-100 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
                <Sparkles className="w-4 h-4 text-indigo-400" /> 喵喵發現相似交易提醒
              </div>
              <button
                type="button"
                onClick={() => onUpdateSimilarTransactionAlerts(!similarTransactionAlertsEnabled)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${similarTransactionAlertsEnabled ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}
              >
                {similarTransactionAlertsEnabled ? '已開啟' : '已關閉'}
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              新增或修改一筆交易時，如果資料庫裡已經有商家名稱／金額很像的其他紀錄，App會跳出來問要不要一起套用同樣的分類/名稱寫法——適合用來抓「同一家店，這次打的字詞卻不一樣」這種情況，避免同一家店在紀錄裡有好幾種不同寫法。
              如果目前的紀錄已經整理得差不多、不太需要這個提醒，可以先關掉；之後新增帳戶或發現需要時，隨時可以回來打開。
            </p>
          </div>

          {/* 分類預算設定 */}
          <div className="p-4 bg-white border border-slate-100 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
              <Wallet className="w-4 h-4 text-amber-400" /> 分類預算設定
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              「近3個月」是最近的花費習慣，「全部歷史」是長期基準，兩個都只是參考——系統不會自己套用，月預算要妳自己看過決定再填。
              <span className="font-bold text-slate-500">這兩個數字只根據 Pawket 裡實際有記錄的交易算出來</span>，如果妳知道有些花費沒記到（例如現金支付），
              自己往上調整成更貼近真實情況的數字即可。設定過月預算的分類，「需立即關注的項目」才會用這個預算幫妳看有沒有超支；沒設定的分類不會出現配速提醒。
            </p>
            {suggestions.length === 0 ? (
              <p className="text-xs text-slate-300 text-center py-2">目前累積的紀錄還不夠列出建議值（至少要3個月歷史）</p>
            ) : (
              <div className="space-y-2">
                {suggestions.map(s => (
                  <div key={s.l2} className="flex items-center gap-3 p-2.5 bg-[#FFFBF5] rounded-xl border border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-700 text-sm truncate">{s.l2}</p>
                      <p className="text-[10px] text-slate-400">近3個月 ${Math.round(s.recentMedian).toLocaleString()}／全部歷史 ${Math.round(s.overallMedian).toLocaleString()}（{s.monthsOfHistory}個月資料）</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-slate-400 text-sm font-bold">$</span>
                      <input
                        type="number"
                        placeholder="不設定"
                        value={budgetInputs[s.l2] ?? ''}
                        onChange={e => setBudgetInputs(prev => ({ ...prev, [s.l2]: e.target.value }))}
                        onBlur={e => saveBudget(s.l2, e.target.value)}
                        className="w-24 p-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm text-slate-700 outline-none focus:border-amber-300"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 長期預留支出 */}
          <div className="p-4 bg-white border border-slate-100 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
              <ShieldAlert className="w-4 h-4 text-rose-400" /> 長期預留支出
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              保險費、房租、水電、稅務規費這類金額大、但不是每月繳一次的支出，平常容易被忽略，等到真的到期時可能拿不出錢。
              這裡列出來的項目，會平均攤進喵喵心願罐「日常開銷保留」的建議值裡——不追蹤精確到期日，只是先把每月該多存的錢預留起來。
            </p>

            {reserves.length > 0 && (
              <div className="space-y-2">
                {reserves.map(r => (
                  <div key={r.id} className="flex items-center gap-2 p-2.5 bg-[#FFFBF5] rounded-xl border border-slate-100">
                    <p className="flex-1 min-w-0 font-bold text-slate-700 text-sm truncate">{r.name}</p>
                    <span className="text-slate-400 text-sm font-bold shrink-0">$</span>
                    <input
                      type="number"
                      value={r.amount || ''}
                      onChange={e => updateReserveField(r.id, 'amount', Number(e.target.value) || 0)}
                      placeholder="每次金額"
                      className="w-20 p-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm text-slate-700 outline-none focus:border-rose-300 shrink-0"
                    />
                    <select
                      value={r.frequencyMonths}
                      onChange={e => updateReserveField(r.id, 'frequencyMonths', Number(e.target.value))}
                      className="p-2 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-700 outline-none focus:border-rose-300 shrink-0"
                    >
                      {FREQUENCY_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <button onClick={() => removeReserve(r.id)} className="p-2 hover:bg-rose-50 rounded-xl text-slate-300 hover:text-rose-400 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 text-right">平均每月預留：<span className="font-bold text-rose-500">${Math.round(monthlyReserveTotal).toLocaleString()}</span></p>
              </div>
            )}

            {availableCandidates.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">還沒加入的候選項目（不確定適不適用可以先不加）</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableCandidates.map(c => (
                    <button
                      key={c.name}
                      onClick={() => addCandidate(c)}
                      title={c.note}
                      className="flex items-center gap-1 px-3 py-1.5 bg-[#FFFBF5] border border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:border-rose-300 hover:text-rose-500 transition"
                    >
                      <Plus className="w-3 h-3" /> {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-white/50 flex justify-end shrink-0">
          <button onClick={onClose} className="px-8 py-3 bg-slate-700 hover:bg-slate-800 text-white rounded-2xl font-bold transition active:scale-95">完成</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
