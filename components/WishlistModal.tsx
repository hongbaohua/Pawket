
import React, { useState, useEffect, useRef } from 'react';
import { WishlistItem, WishlistSettings, Transaction, Account } from '../types';
import { calculateWishlistMetrics, calculateSuggestedReserves } from '../services/logicService';
import { X, Target, Calendar, DollarSign, Save, Flag, Plus, Trash2, Edit2, ChevronLeft, RotateCcw, ChevronUp, ChevronDown, CheckCircle2, ShieldCheck, Wallet } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface WishlistModalProps {
  items: WishlistItem[];
  accounts: Account[];
  allTransactions: Transaction[];
  settings: WishlistSettings;
  onClose: () => void;
  onUpdateItems: (items: WishlistItem[]) => void;
  onUpdateSettings: (settings: WishlistSettings) => void;
}

const WishlistModal: React.FC<WishlistModalProps> = ({ items, accounts, allTransactions, settings, onClose, onUpdateItems, onUpdateSettings }) => {
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [lastDeletedItem, setLastDeletedItem] = useState<{ item: WishlistItem; index: number } | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);

  const [formData, setFormData] = useState<{
      name: string;
      targetAmount: string;
      hasDate: boolean;
      targetDate: string;
  }>({ name: '', targetAmount: '', hasDate: false, targetDate: '' });

  const [tempDailyBuffer, setTempDailyBuffer] = useState(settings.dailyBuffer.toString());
  const [tempEmergencyFund, setTempEmergencyFund] = useState(settings.emergencyFund.toString());
  const suggested = calculateSuggestedReserves(allTransactions);

  useEffect(() => {
    return () => {
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  const metrics = calculateWishlistMetrics(items, accounts, allTransactions, settings.dailyBuffer, settings.emergencyFund);

  const startEdit = (item?: WishlistItem) => {
      if (item) {
          setEditingId(item.id);
          setFormData({
              name: item.name,
              targetAmount: item.targetAmount.toString(),
              hasDate: !!item.targetDate,
              targetDate: item.targetDate || '',
          });
      } else {
          setEditingId(null);
          setFormData({ name: '', targetAmount: '', hasDate: false, targetDate: '' });
      }
      setView('form');
  };

  const handleDelete = (id: string) => {
      const index = items.findIndex(i => i.id === id);
      if (index === -1) return;
      setLastDeletedItem({ item: items[index], index });
      onUpdateItems(items.filter(i => i.id !== id));
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = window.setTimeout(() => setLastDeletedItem(null), 3500);
  };

  const handleUndo = () => {
      if (!lastDeletedItem) return;
      const next = [...items];
      next.splice(lastDeletedItem.index, 0, lastDeletedItem.item);
      onUpdateItems(next);
      setLastDeletedItem(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
  };

  const handleMove = (id: string, direction: -1 | 1) => {
      const index = items.findIndex(i => i.id === id);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= items.length) return;
      const next = [...items];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      onUpdateItems(next);
  };

  const handleTogglePurchased = (id: string) => {
      onUpdateItems(items.map(i => i.id === id
          ? { ...i, isPurchased: !i.isPurchased, purchasedDate: !i.isPurchased ? new Date().toISOString().split('T')[0] : undefined }
          : i));
  };

  const handleSaveSettings = () => {
      const daily = Number(tempDailyBuffer) || 0;
      const emergency = Number(tempEmergencyFund) || 0;
      onUpdateSettings({ dailyBuffer: daily, emergencyFund: emergency });
  };

  const applySuggested = () => {
      setTempDailyBuffer(suggested.dailyBuffer.toString());
      setTempEmergencyFund(suggested.emergencyFund.toString());
      onUpdateSettings({ dailyBuffer: suggested.dailyBuffer, emergencyFund: suggested.emergencyFund });
  };

  const handleSave = () => {
    if (!formData.name || !formData.targetAmount || (formData.hasDate && !formData.targetDate)) {
      alert("請至少填寫名稱、金額，如果有時間限制也要填日期");
      return;
    }

    const newItem: WishlistItem = {
      id: editingId || uuidv4(),
      name: formData.name,
      targetAmount: Number(formData.targetAmount),
      targetDate: formData.hasDate ? formData.targetDate : undefined,
    };

    if (editingId) {
        onUpdateItems(items.map(i => i.id === editingId ? { ...i, ...newItem } : i));
    } else {
        onUpdateItems([...items, newItem]);
    }
    setView('list');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-lg w-full flex flex-col border-4 border-white max-h-[90vh] overflow-hidden relative">
        {/* Header */}
        <div className="p-8 border-b border-indigo-100 flex justify-between items-center bg-white/50 rounded-t-[36px]">
          <div className="flex items-center gap-3">
              {view === 'form' && (
                  <button onClick={() => setView('list')} className="p-2 hover:bg-slate-100 rounded-full transition -ml-2">
                      <ChevronLeft className="w-5 h-5 text-slate-400" />
                  </button>
              )}
              <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-indigo-100 text-indigo-500">
                      <Target className="w-5 h-5" />
                  </div>
                  {view === 'list' ? '願望清單' : (editingId ? '編輯項目' : '新增項目')}
              </h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6 overflow-y-auto flex-1 bg-white/30 scrollbar-thin scrollbar-thumb-indigo-100 relative">

           {/* LIST VIEW */}
           {view === 'list' && (
               <>
                 {/* 安全水位設定 */}
                 <div className="p-5 bg-white rounded-[24px] border border-slate-100 space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> 安全水位設定
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 mb-1 block">日常開銷保留</label>
                            <input type="number" value={tempDailyBuffer} onChange={e => setTempDailyBuffer(e.target.value)} onBlur={handleSaveSettings}
                                className="w-full p-2.5 bg-[#FFFBF5] border border-slate-200 rounded-xl font-mono font-bold text-sm text-slate-700 outline-none focus:border-indigo-300" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 mb-1 block">緊急預備金</label>
                            <input type="number" value={tempEmergencyFund} onChange={e => setTempEmergencyFund(e.target.value)} onBlur={handleSaveSettings}
                                className="w-full p-2.5 bg-[#FFFBF5] border border-slate-200 rounded-xl font-mono font-bold text-sm text-slate-700 outline-none focus:border-indigo-300" />
                        </div>
                    </div>
                    <button onClick={applySuggested} className="text-[11px] font-bold text-indigo-400 hover:text-indigo-500">
                        參考建議值：日常${suggested.dailyBuffer.toLocaleString()}／緊急${suggested.emergencyFund.toLocaleString()}（點此套用）
                    </button>
                    <p className="text-[10px] text-slate-300 leading-relaxed flex items-center gap-1">
                        <Wallet className="w-3 h-3 shrink-0" /> 現金+金融卡總餘額 ${metrics.totalLiquidBalance.toLocaleString()}（不含電子支付/儲值卡/信用卡）
                    </p>
                 </div>

                 {items.length === 0 ? (
                     <div className="text-center py-10 space-y-4">
                         <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto">
                             <Target className="w-10 h-10 text-indigo-200" />
                         </div>
                         <p className="text-slate-400 font-bold">目前還沒有想買的東西喔！</p>
                     </div>
                 ) : (
                     <div className="space-y-4 pb-2">
                         {items.map((item, idx) => {
                             const m = metrics.items[item.id];
                             const isTop = idx === 0;
                             return (
                                 <div
                                    key={item.id}
                                    className={`relative p-5 rounded-[24px] border-2 transition-all group overflow-hidden ${
                                        item.isPurchased ? 'bg-slate-50 border-slate-100 opacity-60'
                                        : isTop ? 'bg-white border-indigo-200 shadow-lg shadow-indigo-100'
                                        : 'bg-white border-slate-100 hover:border-indigo-100'
                                    }`}
                                 >
                                     <div className="absolute top-4 right-4 flex flex-col gap-1">
                                        <button onClick={() => handleMove(item.id, -1)} disabled={idx === 0} className="p-1 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 disabled:opacity-20 disabled:hover:bg-transparent transition"><ChevronUp className="w-4 h-4" /></button>
                                        <button onClick={() => handleMove(item.id, 1)} disabled={idx === items.length - 1} className="p-1 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 disabled:opacity-20 disabled:hover:bg-transparent transition"><ChevronDown className="w-4 h-4" /></button>
                                     </div>

                                     <div className="flex flex-col gap-1 pr-10">
                                         <h4 className="font-extrabold text-slate-700 text-lg truncate flex items-center gap-2">
                                            {isTop && !item.isPurchased && <span className="text-[10px] bg-indigo-100 text-indigo-500 px-2 py-0.5 rounded-full uppercase tracking-tighter">優先</span>}
                                            {item.name}
                                            {item.isPurchased && <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">已購買</span>}
                                         </h4>
                                         {item.targetDate && (
                                             <p className="text-xs text-slate-400 font-bold flex items-center gap-1">
                                                 <Calendar className="w-3 h-3" /> 目標日期 {item.targetDate}
                                                 {!item.isPurchased && m?.daysRemaining != null && (
                                                     m.isOverdue ? <span className="text-rose-500">（已過期）</span> : <span> ・ 還剩{m.daysRemaining}天</span>
                                                 )}
                                             </p>
                                         )}
                                     </div>

                                     {!item.isPurchased && (
                                         <div className="mt-4">
                                             <div className="flex justify-between items-end mb-1">
                                                 <span className="text-xs font-bold text-slate-400">目標金額</span>
                                                 <span className="text-xl font-black text-indigo-600">${item.targetAmount.toLocaleString()}</span>
                                             </div>
                                             {m && (
                                                 m.canAffordNow ? (
                                                     <p className="text-sm font-bold text-emerald-500 flex items-center gap-1.5 mt-2">
                                                         <CheckCircle2 className="w-4 h-4" /> 可動用餘額夠了，可以買了！
                                                     </p>
                                                 ) : (
                                                     <p className="text-sm font-bold text-rose-500 mt-2">
                                                         還差 ${m.shortfall.toLocaleString()}
                                                     </p>
                                                 )
                                             )}
                                         </div>
                                     )}

                                     <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-50">
                                         <button onClick={() => handleTogglePurchased(item.id)} className={`text-xs font-bold px-3 py-1.5 rounded-xl transition ${item.isPurchased ? 'text-slate-400 hover:bg-slate-100' : 'text-emerald-500 hover:bg-emerald-50'}`}>
                                             {item.isPurchased ? '標記為未購買' : '標記已購買'}
                                         </button>
                                         <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                             <button onClick={() => startEdit(item)} className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition"><Edit2 className="w-4 h-4" /></button>
                                             <button onClick={() => handleDelete(item.id)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition"><Trash2 className="w-4 h-4" /></button>
                                         </div>
                                     </div>
                                 </div>
                             );
                         })}
                     </div>
                 )}

                 <button
                    onClick={() => startEdit()}
                    className="w-full py-4 border-2 border-dashed border-indigo-200 rounded-[24px] text-indigo-400 font-bold hover:bg-indigo-50 transition flex justify-center items-center gap-2 group mt-2"
                 >
                    <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
                    新增想買的東西
                 </button>
               </>
           )}

           {/* FORM VIEW */}
           {view === 'form' && (
               <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                   <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 text-sm text-slate-600 leading-relaxed">
                      喵～排在清單愈前面愈優先，App會先幫優先項目保留錢，才輪到後面的項目。
                   </div>

                   <div className="space-y-4">
                      <div className="space-y-1">
                         <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                            <Flag className="w-3 h-3" /> 想買的東西
                         </label>
                         <input
                            type="text"
                            placeholder="例如：手機、平板..."
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                         />
                      </div>

                      <div className="space-y-1">
                         <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> 價錢
                         </label>
                         <input
                            type="number"
                            placeholder="15000"
                            value={formData.targetAmount}
                            onChange={e => setFormData({...formData, targetAmount: e.target.value})}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-mono font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                         />
                      </div>

                      <div className="space-y-2">
                         <label className="flex items-center gap-2 text-xs font-bold text-slate-500 ml-1 cursor-pointer">
                            <input type="checkbox" checked={formData.hasDate} onChange={e => setFormData({...formData, hasDate: e.target.checked})} className="w-4 h-4 rounded accent-indigo-500" />
                            有時間限制（例如生日、特定日期要用）
                         </label>
                         {formData.hasDate && (
                             <input
                                type="date"
                                value={formData.targetDate}
                                onChange={e => setFormData({...formData, targetDate: e.target.value})}
                                className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                             />
                         )}
                         {!formData.hasDate && (
                             <p className="text-[10px] text-slate-400 ml-1">沒有時間限制的話，就是「錢夠了才買」，不趕時間。</p>
                         )}
                      </div>
                   </div>

                   <div className="pt-4 flex justify-end">
                       <button
                         onClick={handleSave}
                         className="px-8 py-3 rounded-2xl font-bold text-white bg-indigo-500 shadow-lg shadow-indigo-200 hover:bg-indigo-600 transform transition active:scale-95 flex items-center gap-2"
                       >
                         <Save className="w-4 h-4" />
                         {editingId ? '更新項目' : '加入清單'}
                       </button>
                   </div>
               </div>
           )}
        </div>

        {/* Undo Toast */}
        {lastDeletedItem && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 z-50 animate-in fade-in slide-in-from-bottom-2">
                <span className="text-sm font-medium">已刪除項目</span>
                <button
                    onClick={handleUndo}
                    className="text-amber-400 font-bold text-sm hover:text-amber-300 flex items-center gap-1"
                >
                    <RotateCcw className="w-4 h-4" /> 復原
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

export default WishlistModal;
