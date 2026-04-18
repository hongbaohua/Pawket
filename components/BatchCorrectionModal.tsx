
import React, { useState } from 'react';
import { Transaction } from '../types';
import { Sparkles, X, Check, ArrowRight, CheckSquare, Square } from 'lucide-react';

interface BatchCorrectionModalProps {
  matches: Transaction[];
  source: Transaction;
  onConfirm: (selectedIds: string[]) => void;
  onClose: () => void;
}

const BatchCorrectionModal: React.FC<BatchCorrectionModalProps> = ({ matches, source, onConfirm, onClose }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(matches.map(m => m.id)));

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleAll = () => {
    if (selectedIds.size === matches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(matches.map(m => m.id)));
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
       <div className="bg-[#FFFBF5] w-full max-w-2xl rounded-[40px] shadow-2xl flex flex-col border-4 border-white max-h-[85vh] overflow-hidden">
          {/* Header */}
          <div className="p-6 bg-indigo-50 border-b border-indigo-100 flex items-start gap-4">
              <div className="p-3 bg-white rounded-full shadow-sm border border-indigo-100">
                  <Sparkles className="w-6 h-6 text-indigo-500" />
              </div>
              <div className="flex-1">
                  <h3 className="text-xl font-extrabold text-slate-800">喵喵發現了 {matches.length} 筆相似交易！</h3>
                  <p className="text-sm text-slate-500 mt-1">
                      您剛剛修正了 <strong>{source.merchant}</strong> ({source.category.l2})。<br/>
                      是否要將這些相似項目也一併更新，節省時間？
                  </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-full transition text-slate-400">
                  <X className="w-6 h-6" />
              </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
              <div className="flex justify-between items-center px-4 mb-2">
                  <button onClick={toggleAll} className="text-xs font-bold text-indigo-500 flex items-center gap-1 hover:underline">
                      {selectedIds.size === matches.length ? <CheckSquare className="w-4 h-4"/> : <Square className="w-4 h-4"/>}
                      {selectedIds.size === matches.length ? '取消全選' : '全選'}
                  </button>
                  <span className="text-xs font-bold text-slate-400">已選 {selectedIds.size} 筆</span>
              </div>

              {matches.map(t => {
                  const isSelected = selectedIds.has(t.id);
                  const isIncome = t.type === 'income';
                  
                  return (
                      <div 
                        key={t.id} 
                        onClick={() => toggleSelection(t.id)}
                        className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-4 group ${isSelected ? 'border-indigo-400 bg-indigo-50/30' : 'border-slate-100 bg-white hover:border-indigo-100'}`}
                      >
                          <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 bg-white'}`}>
                              {isSelected && <Check className="w-4 h-4" />}
                          </div>
                          
                          <div className="flex-1">
                              <div className="flex justify-between">
                                  <span className="font-bold text-slate-700">{t.date}</span>
                                  <span className={`font-mono font-bold ${isIncome ? 'text-emerald-600' : 'text-slate-700'}`}>
                                      {isIncome ? '+' : '-'}${t.amount}
                                  </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-sm">
                                  <span className="text-slate-500 line-through decoration-slate-300">{t.merchant}</span>
                                  <ArrowRight className="w-3 h-3 text-slate-300" />
                                  <span className="font-bold text-indigo-600">{source.merchant}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-xs">
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md">{t.category.l1} &bull; {t.category.l2}</span>
                                  <ArrowRight className="w-3 h-3 text-slate-300" />
                                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-md font-bold">{source.category.l1} &bull; {source.category.l2}</span>
                              </div>
                          </div>
                      </div>
                  )
              })}
          </div>

          {/* Footer */}
          <div className="p-6 bg-white border-t border-slate-100 flex justify-end gap-3">
              <button 
                  onClick={onClose} 
                  className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition"
              >
                  不用了
              </button>
              <button 
                  onClick={() => onConfirm(Array.from(selectedIds))}
                  disabled={selectedIds.size === 0}
                  className="px-8 py-3 rounded-2xl font-bold text-white bg-indigo-500 shadow-lg hover:bg-indigo-600 shadow-indigo-200 transition transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  確認更新 ({selectedIds.size})
              </button>
          </div>
       </div>
    </div>
  );
};

export default BatchCorrectionModal;
