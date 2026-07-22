import React from 'react';
import { Transaction } from '../types';
import { X, Trash2, RotateCcw, Cat } from 'lucide-react';

interface TrashModalProps {
  items: Transaction[];
  loading: boolean;
  onClose: () => void;
  onRestore: (id: string) => void;
  onPermanentlyDelete: (id: string) => void;
}

// 垃圾桶：軟刪除的交易還在資料庫裡，這裡可以看到、救回，或選擇永久刪除。
// 不會自動清空，Ivy要自己決定哪些是真的不要了。
const TrashModal: React.FC<TrashModalProps> = ({ items, loading, onClose, onRestore, onPermanentlyDelete }) => {
  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border-4 border-white relative overflow-hidden">
        <div className="p-8 border-b border-orange-50 flex justify-between items-center bg-white/50">
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-slate-100 text-slate-500"><Trash2 className="w-5 h-5" /></div>
            垃圾桶
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        <div className="p-8 overflow-y-auto flex-1 bg-white/30 space-y-3">
          {loading ? (
            <p className="text-center text-slate-300 font-bold py-10">讀取中...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto"><Cat className="w-10 h-10 text-slate-200" /></div>
              <p className="text-slate-400 font-bold">垃圾桶是空的喵～</p>
            </div>
          ) : (
            items.map(t => (
              <div key={t.id} className="p-4 bg-white rounded-2xl border border-slate-100 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-700 text-sm truncate">{t.merchant || '（未命名）'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t.date}・${t.amount.toLocaleString()}</p>
                  {t.deletedAt && <p className="text-[10px] text-slate-300 mt-0.5">刪除於 {new Date(t.deletedAt).toLocaleString('zh-TW')}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => onRestore(t.id)} className="p-2 border rounded-xl hover:bg-emerald-50 text-emerald-500" title="救回"><RotateCcw className="w-4 h-4" /></button>
                  <button onClick={() => onPermanentlyDelete(t.id)} className="p-2 border rounded-xl hover:bg-rose-50 text-rose-400" title="永久刪除"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default TrashModal;
