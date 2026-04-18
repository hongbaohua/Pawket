
import React, { useState, useEffect, useRef } from 'react';
import { SavingsGoal, Transaction } from '../types';
import { calculateGoalMetrics } from '../services/logicService';
import { X, Target, Calendar, DollarSign, Save, Flag, Plus, Trash2, Edit2, Star, ChevronLeft, RotateCcw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface GoalModalProps {
  goals: SavingsGoal[];
  transactions: Transaction[]; // needed for calculating progress in list view
  onClose: () => void;
  onUpdateGoals: (goals: SavingsGoal[]) => void;
}

const GoalModal: React.FC<GoalModalProps> = ({ goals, transactions, onClose, onUpdateGoals }) => {
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Undo State
  const [lastDeletedGoal, setLastDeletedGoal] = useState<SavingsGoal | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);

  // Form State
  const [formData, setFormData] = useState<{
      name: string;
      targetAmount: string;
      startDate: string; // New field
      targetDate: string;
      initialAmount: string;
  }>({ name: '', targetAmount: '', startDate: '', targetDate: '', initialAmount: '' });

  useEffect(() => {
    return () => {
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  const startEdit = (goal?: SavingsGoal) => {
      if (goal) {
          setEditingId(goal.id);
          setFormData({
              name: goal.name,
              targetAmount: goal.targetAmount.toString(),
              startDate: goal.startDate || new Date().toISOString().split('T')[0], // Backfill legacy data
              targetDate: goal.targetDate,
              initialAmount: goal.initialAmount.toString()
          });
      } else {
          setEditingId(null); // New mode
          const today = new Date().toISOString().split('T')[0];
          setFormData({ name: '', targetAmount: '', startDate: today, targetDate: '', initialAmount: '' });
      }
      setView('form');
  };

  const handleDelete = (id: string) => {
      const goalToDelete = goals.find(g => g.id === id);
      if (goalToDelete) {
          setLastDeletedGoal(goalToDelete);
          onUpdateGoals(goals.filter(g => g.id !== id));
          
          if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
          undoTimeoutRef.current = window.setTimeout(() => {
              setLastDeletedGoal(null);
          }, 3500);
      }
  };

  const handleUndo = () => {
      if (lastDeletedGoal) {
          onUpdateGoals([...goals, lastDeletedGoal]);
          setLastDeletedGoal(null);
          if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      }
  };

  const handleSetPrimary = (id: string) => {
      onUpdateGoals(goals.map(g => ({
          ...g,
          isPrimary: g.id === id
      })));
  };

  const handleSave = () => {
    if (!formData.name || !formData.targetAmount || !formData.targetDate || !formData.startDate) {
      alert("請填寫完整的目標資訊 (名稱、金額、開始日期、預計達成日期)");
      return;
    }

    const newGoal: SavingsGoal = {
      id: editingId || uuidv4(),
      name: formData.name,
      targetAmount: Number(formData.targetAmount),
      startDate: formData.startDate,
      targetDate: formData.targetDate,
      initialAmount: Number(formData.initialAmount) || 0,
      isPrimary: editingId ? (goals.find(g => g.id === editingId)?.isPrimary || false) : (goals.length === 0)
    };

    if (editingId) {
        onUpdateGoals(goals.map(g => g.id === editingId ? newGoal : g));
    } else {
        onUpdateGoals([...goals, newGoal]);
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
                  {view === 'list' ? '夢想目標清單' : (editingId ? '編輯目標' : '新增目標')}
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
                 {goals.length === 0 ? (
                     <div className="text-center py-10 space-y-4">
                         <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto">
                             <Target className="w-10 h-10 text-indigo-200" />
                         </div>
                         <p className="text-slate-400 font-bold">目前還沒有設定任何目標喔！</p>
                     </div>
                 ) : (
                     <div className="space-y-4 pb-12">
                         {goals.map(goal => {
                             const metrics = calculateGoalMetrics(goal, transactions);
                             const isPrimary = goal.isPrimary;
                             
                             return (
                                 <div 
                                    key={goal.id} 
                                    className={`relative p-5 rounded-[24px] border-2 transition-all group overflow-hidden ${
                                        isPrimary 
                                        ? 'bg-white border-indigo-200 shadow-lg shadow-indigo-100' 
                                        : 'bg-white border-slate-100 hover:border-indigo-100'
                                    }`}
                                 >
                                     {/* Pin Action (Star) */}
                                     <button 
                                        onClick={() => handleSetPrimary(goal.id)}
                                        className={`absolute top-4 right-4 p-2 rounded-full transition-all ${
                                            isPrimary 
                                            ? 'text-amber-400 bg-amber-50 hover:bg-amber-100' 
                                            : 'text-slate-200 hover:text-amber-400 hover:bg-amber-50'
                                        }`}
                                        title={isPrimary ? "目前的主目標" : "設為主目標"}
                                     >
                                         <Star className={`w-5 h-5 ${isPrimary ? 'fill-amber-400' : ''}`} />
                                     </button>

                                     {/* Confetti Deco for Primary */}
                                     {isPrimary && (
                                         <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-amber-100/50 to-transparent rounded-bl-full pointer-events-none -z-10"></div>
                                     )}

                                     <div className="flex flex-col gap-1 pr-10">
                                         <h4 className="font-extrabold text-slate-700 text-lg truncate">{goal.name}</h4>
                                         <p className="text-xs text-slate-400 font-bold flex items-center gap-1">
                                             <Calendar className="w-3 h-3" /> {goal.startDate || 'N/A'} ⮕ {goal.targetDate}
                                         </p>
                                     </div>

                                     <div className="mt-4">
                                         <div className="flex justify-between items-end mb-1">
                                             <span className="text-xs font-bold text-slate-400">目前資金進度 (估算)</span>
                                             <div className="text-right">
                                                 <span className="text-xl font-black text-indigo-600">${Math.round(metrics.smartProgress).toLocaleString()}</span>
                                                 <span className="text-xs text-slate-400 font-medium ml-1">/ ${goal.targetAmount.toLocaleString()}</span>
                                             </div>
                                         </div>
                                         <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                             <div 
                                                className={`h-full rounded-full transition-all duration-500 ${isPrimary ? 'bg-gradient-to-r from-indigo-400 to-purple-400' : 'bg-slate-300'}`} 
                                                style={{ width: `${metrics.weightedPercent}%` }}
                                             ></div>
                                         </div>
                                         <p className="text-[10px] text-right mt-1 font-bold text-indigo-300">
                                             綜合完成度: {metrics.weightedPercent.toFixed(1)}%
                                         </p>
                                     </div>

                                     <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                         <button 
                                            onClick={() => startEdit(goal)}
                                            className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition"
                                         >
                                             <Edit2 className="w-4 h-4" />
                                         </button>
                                         <button 
                                            onClick={() => handleDelete(goal.id)}
                                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition"
                                         >
                                             <Trash2 className="w-4 h-4" />
                                         </button>
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
                    新增夢想目標
                 </button>
               </>
           )}

           {/* FORM VIEW */}
           {view === 'form' && (
               <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                   <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 text-sm text-slate-600 leading-relaxed">
                      喵～設定目標後，Pawket 會自動計算每月的存款壓力 (RMS)，並綜合時間進度與存款進度，提供最精準的完成度評估！
                   </div>

                   <div className="space-y-4">
                      <div className="space-y-1">
                         <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                            <Flag className="w-3 h-3" /> 目標名稱
                         </label>
                         <input 
                            type="text"
                            placeholder="例如：買房頭期款、歐洲旅遊..."
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                         />
                      </div>

                      <div className="space-y-1">
                         <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> 目標總金額
                         </label>
                         <input 
                            type="number"
                            placeholder="1000000"
                            value={formData.targetAmount}
                            onChange={e => setFormData({...formData, targetAmount: e.target.value})}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-mono font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                         />
                      </div>

                      <div className="flex gap-4">
                          <div className="space-y-1 flex-1">
                             <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> 開始日期
                             </label>
                             <input 
                                type="date"
                                value={formData.startDate}
                                onChange={e => setFormData({...formData, startDate: e.target.value})}
                                className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                             />
                          </div>
                          <div className="space-y-1 flex-1">
                             <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> 預計達成
                             </label>
                             <input 
                                type="date"
                                value={formData.targetDate}
                                onChange={e => setFormData({...formData, targetDate: e.target.value})}
                                className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                             />
                          </div>
                      </div>

                      <div className="space-y-1">
                         <label className="text-xs font-bold text-slate-400 ml-1 flex items-center gap-1">
                            <Save className="w-3 h-3" /> 起始已存金額 (不含 App 內記帳)
                         </label>
                         <input 
                            type="number"
                            placeholder="0"
                            value={formData.initialAmount}
                            onChange={e => setFormData({...formData, initialAmount: e.target.value})}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-mono font-bold text-slate-700 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-300 outline-none shadow-sm transition"
                         />
                         <p className="text-[10px] text-slate-400 ml-1 leading-relaxed">
                            * App 內分類為「投資儲蓄」的交易會自動疊加至所有目標的進度中，此處僅需填寫使用 App 前的存款。
                         </p>
                      </div>
                   </div>

                   <div className="pt-4 flex justify-end">
                       <button 
                         onClick={handleSave} 
                         className="px-8 py-3 rounded-2xl font-bold text-white bg-indigo-500 shadow-lg shadow-indigo-200 hover:bg-indigo-600 transform transition active:scale-95 flex items-center gap-2"
                       >
                         <Save className="w-4 h-4" />
                         {editingId ? '更新目標' : '建立目標'}
                       </button>
                   </div>
               </div>
           )}
        </div>

        {/* Undo Toast */}
        {lastDeletedGoal && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 z-50 animate-in fade-in slide-in-from-bottom-2">
                <span className="text-sm font-medium">已刪除目標</span>
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

export default GoalModal;