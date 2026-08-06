import React from 'react';
import { ActivityLogEntry } from '../types';
import { X, History, RotateCcw, Cat, Check } from 'lucide-react';

interface ActivityLogModalProps {
  items: ActivityLogEntry[];
  loading: boolean;
  onClose: () => void;
  onRestore: (entry: ActivityLogEntry) => void;
}

// 編輯歷程：目前只記錄「批次修正」這種一次改很多筆的大動作編輯，記下改之前的完整版本，
// 之後真的查得出「這筆是什麼時候、被什麼操作改的、改之前是什麼」，不用再靠猜的
// （2026-08-02 Ivy誤觸批次套用後完全查不出改了什麼才新增，比照垃圾桶的救回邏輯）。
const ActivityLogModal: React.FC<ActivityLogModalProps> = ({ items, loading, onClose, onRestore }) => {
  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border-4 border-white relative overflow-hidden">
        <div className="p-8 border-b border-orange-50 flex justify-between items-center bg-white/50">
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-slate-100 text-slate-500"><History className="w-5 h-5" /></div>
            重新裝碗紀錄
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 overflow-y-auto flex-1 bg-white/30 space-y-3">
          {loading ? (
            <p className="text-center text-slate-300 font-bold py-10">讀取中...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto"><Cat className="w-10 h-10 text-slate-200" /></div>
              <p className="text-slate-400 font-bold">目前還沒有大動作編輯紀錄喵～</p>
              <p className="text-xs text-slate-300">（目前只有「批次修正」會被記錄在這裡）</p>
            </div>
          ) : (
            items.map(entry => (
              <div key={entry.id} className="p-4 bg-white rounded-2xl border border-slate-100 space-y-2">
                <p className="font-bold text-slate-700 text-sm">{entry.description}</p>
                <p className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString('zh-TW')}・影響 {entry.affectedTransactionIds.length} 筆</p>
                {entry.restoredAt ? (
                  <p className="text-xs text-emerald-500 font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" />已於 {new Date(entry.restoredAt).toLocaleString('zh-TW')} 復原</p>
                ) : (
                  <button onClick={() => onRestore(entry)} className="px-3 py-1.5 border rounded-xl hover:bg-emerald-50 text-emerald-500 text-xs font-bold flex items-center gap-1">
                    <RotateCcw className="w-3.5 h-3.5" /> 復原成套用前的版本
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityLogModal;
