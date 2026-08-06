// 系統設定：目前只有一個開關(相似交易提醒)，先給一個獨立小彈窗放，以後有其他偏好設定
// 可以陸續加進來，不用每加一個就重新設計入口（2026-08-06 Ivy要求）。
import React from 'react';
import { X, Settings, Sparkles } from 'lucide-react';

interface SettingsModalProps {
  similarTransactionAlertsEnabled: boolean;
  onClose: () => void;
  onUpdateSimilarTransactionAlerts: (enabled: boolean) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ similarTransactionAlertsEnabled, onClose, onUpdateSimilarTransactionAlerts }) => {
  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-md w-full border-4 border-white overflow-hidden">
        <div className="p-8 border-b border-orange-50 flex justify-between items-center bg-white/50">
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-slate-100 text-slate-500"><Settings className="w-5 h-5" /></div>
            系統設定
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 space-y-4">
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
        </div>

        <div className="p-6 border-t border-slate-100 bg-white/50 flex justify-end">
          <button onClick={onClose} className="px-8 py-3 bg-slate-700 hover:bg-slate-800 text-white rounded-2xl font-bold transition active:scale-95">完成</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
