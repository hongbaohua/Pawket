import React, { useMemo, useState } from 'react';
import { ActivityLogEntry, ActivityActionType } from '../types';
import { History, RotateCcw, Cat, Check, Plus, Pencil, Trash2, Divide, Undo2, Repeat, Tag, Ban, Upload, AlertTriangle } from 'lucide-react';

interface ActivityLogPageProps {
  items: ActivityLogEntry[];
  loading: boolean;
  onRestore: (entry: ActivityLogEntry) => void;
}

// 每種actionType的中文標籤／圖示／顏色，畫面上用小標籤區分，2026-08-31從只有
// batch_correction擴大成記錄所有異動後才需要這張對照表。
const ACTION_META: Record<ActivityActionType, { label: string; icon: React.ElementType; className: string }> = {
  add: { label: '新增', icon: Plus, className: 'bg-emerald-50 text-emerald-500' },
  edit: { label: '編輯', icon: Pencil, className: 'bg-sky-50 text-sky-500' },
  delete: { label: '刪除', icon: Trash2, className: 'bg-rose-50 text-rose-500' },
  split: { label: '分裝拆帳', icon: Divide, className: 'bg-indigo-50 text-indigo-500' },
  cancel_split: { label: '取消拆帳', icon: Undo2, className: 'bg-indigo-50 text-indigo-500' },
  transfer: { label: '帳戶互轉', icon: Repeat, className: 'bg-cyan-50 text-cyan-500' },
  category_rename: { label: '分類改名', icon: Tag, className: 'bg-amber-50 text-amber-500' },
  category_delete: { label: '分類刪除', icon: Ban, className: 'bg-amber-50 text-amber-500' },
  batch_correction: { label: '批次修正', icon: Pencil, className: 'bg-violet-50 text-violet-500' },
  import: { label: '匯入', icon: Upload, className: 'bg-teal-50 text-teal-500' },
  clear_all: { label: '清除所有紀錄', icon: AlertTriangle, className: 'bg-rose-100 text-rose-600' },
};

const FILTERS: { key: 'all' | ActivityActionType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'add', label: '新增' },
  { key: 'edit', label: '編輯' },
  { key: 'delete', label: '刪除' },
  { key: 'split', label: '拆帳' },
  { key: 'cancel_split', label: '取消拆帳' },
  { key: 'transfer', label: '帳戶互轉' },
  { key: 'category_rename', label: '分類改名' },
  { key: 'category_delete', label: '分類刪除' },
  { key: 'batch_correction', label: '批次修正' },
  { key: 'import', label: '匯入' },
  { key: 'clear_all', label: '清除所有紀錄' },
];

// 「重新裝碗紀錄」：本來是彈窗，只記錄批次修正這種大動作編輯；2026-08-31改成獨立頁面，
// 記錄所有會動到交易資料的操作（新增/編輯/刪除/拆帳/互轉/分類改名/匯入/清除所有紀錄...），
// 變成完整的異動歷程，每一筆都可以查「什麼時候、被什麼操作、改成什麼樣子」，能復原的
// 都能直接在這裡按「復原」。
const ActivityLogPage: React.FC<ActivityLogPageProps> = ({ items, loading, onRestore }) => {
  const [filter, setFilter] = useState<'all' | ActivityActionType>('all');
  const filtered = useMemo(() => filter === 'all' ? items : items.filter(e => e.actionType === filter), [items, filter]);
  const availableFilters = useMemo(() => {
    const present = new Set(items.map(e => e.actionType));
    return FILTERS.filter(f => f.key === 'all' || present.has(f.key));
  }, [items]);

  return (
    <div className="bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 overflow-hidden">
      <div className="p-8 border-b border-orange-50 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white gap-4">
        <div className="shrink-0">
          <h2 className="text-2xl font-extrabold text-slate-700 flex items-center gap-2 whitespace-nowrap">
            <div className="p-2 rounded-2xl bg-slate-100 text-slate-500"><History className="w-5 h-5" /></div>
            重新裝碗紀錄
          </h2>
          <p className="text-slate-400 text-sm mt-1 ml-1 font-medium">記錄所有會動到交易資料的操作，共 {items.length} 筆</p>
        </div>
        {availableFilters.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {availableFilters.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${filter === f.key ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-8 space-y-3 bg-white/30">
        {loading ? (
          <p className="text-center text-slate-300 font-bold py-10">讀取中...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto"><Cat className="w-10 h-10 text-slate-200" /></div>
            <p className="text-slate-400 font-bold">{items.length === 0 ? '目前還沒有任何異動紀錄喵～' : '這個分類目前沒有紀錄'}</p>
          </div>
        ) : (
          filtered.map(entry => {
            const meta = ACTION_META[entry.actionType];
            const Icon = meta?.icon ?? History;
            return (
              <div key={entry.id} className="p-4 bg-white rounded-2xl border border-slate-100 flex items-start gap-4">
                <div className={`p-2 rounded-xl shrink-0 ${meta?.className ?? 'bg-slate-100 text-slate-500'}`}><Icon className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${meta?.className ?? 'bg-slate-100 text-slate-500'}`}>{meta?.label ?? entry.actionType}</span>
                    <p className="font-bold text-slate-700 text-sm break-words">{entry.description}</p>
                  </div>
                  <p className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString('zh-TW')}・影響 {entry.affectedTransactionIds.length} 筆</p>
                  {entry.restoredAt ? (
                    <p className="text-xs text-emerald-500 font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" />已於 {new Date(entry.restoredAt).toLocaleString('zh-TW')} 復原</p>
                  ) : (
                    <button onClick={() => onRestore(entry)} className="px-3 py-1.5 border rounded-xl hover:bg-emerald-50 text-emerald-500 text-xs font-bold flex items-center gap-1">
                      <RotateCcw className="w-3.5 h-3.5" /> 復原成套用前的版本
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ActivityLogPage;
