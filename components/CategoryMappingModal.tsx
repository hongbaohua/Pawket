
import React, { useState, useMemo } from 'react';
import { L1Category, CATEGORY_LABELS, STANDARD_CATEGORIES } from '../types';
import { ArrowRight, Check, AlertCircle, Tag, Shuffle, Plus, History } from 'lucide-react';

interface ConflictItem {
  key: string; // "L1::L2"
  originalL1: string;
  originalL2: string;
  count: number;
}

interface CategoryMappingModalProps {
  conflicts: ConflictItem[];
  existingCustomOptions: Record<string, string[]>; // NEW: Custom tags from App history
  onConfirm: (mapping: Record<string, { l1: L1Category; l2: string }>) => void;
  onCancel: () => void;
}

const CategoryMappingModal: React.FC<CategoryMappingModalProps> = ({ conflicts, existingCustomOptions, onConfirm, onCancel }) => {
  // Store the mapping decision for each conflict key
  const [mapping, setMapping] = useState<Record<string, { l1: L1Category; l2: string }>>({});
  
  // State for the active selector (which conflict row is currently selecting?)
  const [activeSelectorKey, setActiveSelectorKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<L1Category>(L1Category.VARIABLE);

  // Custom Tag Creation State
  const [isAddingL2, setIsAddingL2] = useState(false);
  const [newL2Val, setNewL2Val] = useState("");
  
  // NEW: Session-based custom tags (created right now during this import)
  const [sessionCustomTags, setSessionCustomTags] = useState<Record<string, string[]>>({});

  const handleSelect = (conflictKey: string, l1: L1Category, l2: string) => {
    setMapping(prev => ({
      ...prev,
      [conflictKey]: { l1, l2 }
    }));
    setActiveSelectorKey(null); // Close selector after choice
    setIsAddingL2(false);
    setNewL2Val("");
  };

  const handleAddCustomTag = (conflictKey: string, l1: L1Category, val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return;

      // 1. Add to session memory so it appears for other conflicts immediately
      setSessionCustomTags(prev => {
          const currentList = prev[l1] || [];
          if (currentList.includes(trimmed)) return prev;
          return { ...prev, [l1]: [...currentList, trimmed] };
      });

      // 2. Select it for current item
      handleSelect(conflictKey, l1, trimmed);
  };

  const isAllMapped = conflicts.every(c => mapping[c.key]);

  // Helper to merge Standard + History + Session tags for the active tab
  const currentOptions = useMemo(() => {
      const standard = STANDARD_CATEGORIES[activeTab] || [];
      const history = existingCustomOptions[activeTab] || [];
      const session = sessionCustomTags[activeTab] || [];
      
      // Combine and Dedup
      const uniqueCustom = Array.from(new Set([...history, ...session]))
          .filter(opt => !standard.includes(opt)); // Remove if it overlaps with standard
      
      return { standard, custom: uniqueCustom };
  }, [activeTab, existingCustomOptions, sessionCustomTags]);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFBF5] rounded-[40px] shadow-2xl max-w-2xl w-full flex flex-col border-4 border-white max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 bg-amber-50 border-b border-amber-100 flex items-start gap-4">
           <div className="p-3 bg-white rounded-full shadow-sm border border-amber-100 text-amber-500">
               <Shuffle className="w-6 h-6" />
           </div>
           <div className="flex-1">
               <h3 className="text-xl font-extrabold text-slate-800">發現舊制分類標籤</h3>
               <p className="text-sm text-slate-500 mt-1">
                   匯入的檔案中包含 <strong>{conflicts.length}</strong> 種系統無法識別的分類。
                   <br/>為了確保統計準確，請協助將它們對應到目前的標準分類。
               </p>
           </div>
        </div>

        {/* List of Conflicts */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-white scrollbar-thin scrollbar-thumb-amber-200">
           {conflicts.map((item) => {
             const decision = mapping[item.key];
             const isSelecting = activeSelectorKey === item.key;

             return (
               <div key={item.key} className="relative">
                  <div className={`p-4 rounded-3xl border-2 flex flex-col md:flex-row items-start md:items-center gap-4 transition-all ${
                      decision ? 'border-emerald-100 bg-emerald-50/30' : 'border-amber-200 bg-white shadow-sm'
                  }`}>
                      {/* Left: Old Category */}
                      <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-bold line-through">
                                  {item.originalL2}
                              </span>
                              <span className="text-[10px] text-slate-400 bg-slate-50 px-1.5 rounded-full">
                                  {item.count} 筆
                              </span>
                          </div>
                          <p className="text-xs text-slate-400">
                              原歸屬: {CATEGORY_LABELS[item.originalL1 as L1Category] || item.originalL1}
                          </p>
                      </div>

                      <ArrowRight className="w-5 h-5 text-slate-300 hidden md:block" />

                      {/* Right: New Selector Trigger */}
                      <div className="w-full md:w-1/2 relative">
                          <button 
                             onClick={() => {
                                 setActiveSelectorKey(isSelecting ? null : item.key);
                                 // Smart default tab: try to match L1 if possible
                                 const matchL1 = Object.values(L1Category).find(cat => cat === item.originalL1);
                                 if (matchL1) setActiveTab(matchL1);
                                 setIsAddingL2(false);
                             }}
                             className={`w-full p-3 rounded-2xl border-2 text-left flex justify-between items-center transition-all ${
                                 decision 
                                 ? 'bg-white border-emerald-200 text-emerald-600 font-bold' 
                                 : 'bg-amber-50 border-dashed border-amber-300 text-amber-600 hover:bg-amber-100'
                             }`}
                          >
                             {decision ? (
                                 <span className="flex items-center gap-2">
                                     <Tag className="w-4 h-4" />
                                     {CATEGORY_LABELS[decision.l1]} &bull; {decision.l2}
                                 </span>
                             ) : (
                                 <span className="flex items-center gap-2 text-sm font-bold">
                                     <AlertCircle className="w-4 h-4" /> 點擊選擇對應分類...
                                 </span>
                             )}
                          </button>

                          {/* Inline Dropdown Selector */}
                          {isSelecting && (
                              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-3xl shadow-xl border-2 border-amber-100 z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                  {/* L1 Tabs */}
                                  <div className="flex bg-slate-50 border-b border-slate-100 p-1 gap-1 overflow-x-auto no-scrollbar">
                                      {Object.values(L1Category).map(cat => (
                                          <button
                                              key={cat}
                                              onClick={(e) => { e.stopPropagation(); setActiveTab(cat); setIsAddingL2(false); }}
                                              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                                                  activeTab === cat 
                                                  ? 'bg-white text-slate-800 shadow-sm' 
                                                  : 'text-slate-400 hover:text-slate-600'
                                              }`}
                                          >
                                              {CATEGORY_LABELS[cat]}
                                          </button>
                                      ))}
                                  </div>
                                  
                                  {/* Options Container */}
                                  <div className="p-3 max-h-48 overflow-y-auto bg-[#FFFBF5]">
                                      <div className="flex flex-wrap gap-2">
                                          {/* Standard Categories */}
                                          {currentOptions.standard.map(option => (
                                              <button
                                                  key={option}
                                                  onClick={() => handleSelect(item.key, activeTab, option)}
                                                  className="px-3 py-1.5 bg-white border border-amber-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-amber-400 hover:text-white hover:border-amber-400 transition shadow-sm"
                                              >
                                                  {option}
                                              </button>
                                          ))}

                                          {/* Custom Categories (History + Session) - Separator if needed */}
                                          {currentOptions.custom.length > 0 && (
                                              <>
                                                 <div className="w-full h-px bg-slate-200 my-1"></div>
                                                 <p className="w-full text-[10px] text-slate-400 font-bold flex items-center gap-1">
                                                    <History className="w-3 h-3" /> 自訂標籤
                                                 </p>
                                                 {currentOptions.custom.map(option => (
                                                      <button
                                                          key={option}
                                                          onClick={() => handleSelect(item.key, activeTab, option)}
                                                          className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl text-xs font-bold text-indigo-600 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition shadow-sm"
                                                      >
                                                          {option}
                                                      </button>
                                                 ))}
                                              </>
                                          )}

                                          {/* New Tag Input */}
                                          <div className="w-full h-px bg-transparent my-1"></div>
                                          {isAddingL2 ? (
                                              <div className="flex items-center gap-1 w-full animate-in fade-in slide-in-from-left-2">
                                                  <input
                                                      autoFocus
                                                      value={newL2Val}
                                                      onChange={(e) => setNewL2Val(e.target.value)}
                                                      onKeyDown={(e) => {
                                                          if (e.key === 'Enter') {
                                                              handleAddCustomTag(item.key, activeTab, newL2Val);
                                                          }
                                                      }}
                                                      placeholder="輸入新標籤..."
                                                      className="flex-1 px-3 py-2 rounded-xl text-xs font-bold border border-amber-300 outline-none shadow-inner bg-white text-slate-700"
                                                      onClick={(e) => e.stopPropagation()}
                                                  />
                                                  <button 
                                                      onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleAddCustomTag(item.key, activeTab, newL2Val);
                                                      }}
                                                      className="p-2 bg-amber-400 text-white rounded-xl hover:bg-amber-500 shadow-sm"
                                                  >
                                                      <Check className="w-4 h-4" />
                                                  </button>
                                              </div>
                                          ) : (
                                              <button
                                                  onClick={(e) => { e.stopPropagation(); setIsAddingL2(true); }}
                                                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-dashed border-slate-300 text-slate-400 hover:text-slate-600 hover:border-slate-400 flex items-center gap-1 hover:bg-white w-full justify-center"
                                              >
                                                  <Plus className="w-3 h-3" /> 新增自訂標籤
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              </div>
                          )}
                      </div>
                  </div>
               </div>
             );
           })}
        </div>

        {/* Footer */}
        <div className="p-6 bg-white border-t border-slate-100 flex justify-end gap-3">
           <button 
             onClick={onCancel}
             className="px-6 py-3 rounded-2xl font-bold text-slate-400 hover:bg-slate-50 transition"
           >
             取消匯入
           </button>
           <button 
             onClick={() => onConfirm(mapping)}
             disabled={!isAllMapped}
             className={`px-8 py-3 rounded-2xl font-bold text-white shadow-lg transition transform active:scale-95 flex items-center gap-2 ${
                 isAllMapped 
                 ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200' 
                 : 'bg-slate-300 cursor-not-allowed shadow-none'
             }`}
           >
             <Check className="w-5 h-5" />
             轉換並匯入
           </button>
        </div>
      </div>
    </div>
  );
};

export default CategoryMappingModal;
