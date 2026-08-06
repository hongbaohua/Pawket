
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { Sparkles, X, Check, ArrowRight, CheckSquare, Square, AlertTriangle } from 'lucide-react';

interface BatchCorrectionModalProps {
  matches: Transaction[];
  source: Transaction;
  allTransactions: Transaction[];
  onConfirm: (selectedIds: string[]) => void;
  onClose: () => void;
}

// 這筆交易目前的「商家＋完整分類(含細項)」寫法，用來判斷兩筆是不是完全同一種分類方式。
const sameClassification = (a: Transaction, b: Transaction) =>
  a.merchant.trim() === b.merchant.trim() &&
  a.category.l1 === b.category.l1 &&
  a.category.l2 === b.category.l2 &&
  a.category.l3 === b.category.l3;

const BatchCorrectionModal: React.FC<BatchCorrectionModalProps> = ({ matches, source, allTransactions, onConfirm, onClose }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(matches.map(m => m.id)));
  // 2026-08-02 Ivy手滑：剛存完編輯，這個彈窗馬上跳出來、「確認更新」又跟編輯畫面的
  // 儲存鍵在同一個右下角位置，連續點擊時很容易誤觸。改成兩段式確認，第二段的按鈕
  // 換位置、換顏色、換文字，讓人不可能沿用同一個點擊動作誤觸。
  const [confirmStep, setConfirmStep] = useState(false);

  // 2026-07-27 Ivy指出：這個功能原本假設「剛剛存的這次修改一定是對的」，但如果剛好是這次
  // 手滑打錯，反而會把錯誤擴散到原本正確的舊紀錄。改成顯示「資料庫裡多數已經是哪種寫法」，
  // 讓Ivy自己判斷這次的修改是不是反而才是那個異常值，而不是盲目相信最新一次的編輯。
  const { newVersionCount, oldVersionCounts } = useMemo(() => {
    const excludedIds = new Set([source.id, ...matches.map(m => m.id)]);
    const pool = allTransactions.filter(t => !excludedIds.has(t.id));
    const newCount = pool.filter(t => sameClassification(t, source)).length;
    const oldCounts = new Map<string, number>();
    matches.forEach(m => {
      oldCounts.set(m.id, pool.filter(t => sameClassification(t, m)).length);
    });
    return { newVersionCount: newCount, oldVersionCounts: oldCounts };
  }, [matches, source, allTransactions]);

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
          {/* Header：2026-08-06 Ivy反應這裡文字太擠——三段說明(標題/主要說明/版本統計備註)
              原本擠在同一個flex-1欄位裡只靠mt-1/mt-2小間距分隔，改成space-y+獨立的淺色卡片
              包住版本統計備註，視覺上真的分開成三個區塊，行距也加大。 */}
          <div className="p-6 bg-indigo-50 border-b border-indigo-100 flex items-start gap-4">
              <div className="p-3 bg-white rounded-full shadow-sm border border-indigo-100 shrink-0">
                  <Sparkles className="w-6 h-6 text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                      <h3 className="text-xl font-extrabold text-slate-800 leading-snug">喵喵發現了 {matches.length} 筆相似交易！</h3>
                      <button onClick={onClose} className="p-2 -mt-1 -mr-1 hover:bg-white/50 rounded-full transition text-slate-400 shrink-0">
                          <X className="w-6 h-6" />
                      </button>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">
                      您剛剛把 <strong>{source.merchant}</strong> 改成「{source.category.l1}／{source.category.l2}{source.category.l3 ? `／${source.category.l3}` : ''}」。
                      下面這些交易的<strong>金額跟這筆差不到10%、商家名稱也對得上一部分</strong>，
                      猜測可能是同一家店的其他消費記錄——要不要一起套用剛剛這次的修改？
                      （不是完全比對，覺得不是同一家的話取消勾選就好，不會影響其他筆）
                  </p>
                  <p className="text-xs text-slate-400 bg-white/60 rounded-xl px-3 py-2.5 leading-relaxed">
                      {newVersionCount > 0
                        ? `這次改成的寫法，資料庫裡另外還有 ${newVersionCount} 筆本來就是這樣分類的。`
                        : `這次改成的寫法，目前資料庫裡沒有其他紀錄用一樣的寫法——如果是這次手滑打錯，建議先按右上角 ✕ 取消，不要往下套用。`}
                  </p>
              </div>
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
                  const oldCount = oldVersionCounts.get(t.id) || 0;
                  // 舊寫法比新寫法更多資料在用，代表這次的修改才可能是異常值(打錯字/選錯分類)，
                  // 不是舊紀錄需要被「修正」——這種情況特別標示出來，不要讓Ivy誤以為新的一定對。
                  const oldIsMoreEstablished = oldCount > newVersionCount;

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
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md">{t.category.l1} &bull; {t.category.l2}{t.category.l3 ? ` • ${t.category.l3}` : ''}</span>
                                  <ArrowRight className="w-3 h-3 text-slate-300" />
                                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-md font-bold">{source.category.l1} &bull; {source.category.l2}{source.category.l3 ? ` • ${source.category.l3}` : ''}</span>
                              </div>
                              <p className={`mt-1 text-[10px] ${oldIsMoreEstablished ? 'text-amber-600 font-bold flex items-center gap-1' : 'text-slate-300'}`}>
                                  {oldIsMoreEstablished && <AlertTriangle className="w-3 h-3 shrink-0" />}
                                  {oldCount > 0
                                    ? `這個舊寫法目前資料庫裡另外還有 ${oldCount} 筆，`
                                    : `這個舊寫法目前資料庫裡沒有其他紀錄在用，`}
                                  {oldIsMoreEstablished
                                    ? `比新寫法的 ${newVersionCount} 筆還多——這次的修改反而可能才是打錯的，建議先取消勾選這筆`
                                    : `新寫法有 ${newVersionCount} 筆`}
                              </p>
                          </div>
                      </div>
                  )
              })}
          </div>

          {/* Footer */}
          {!confirmStep ? (
              <div className="p-6 bg-white border-t border-slate-100 flex justify-end gap-3">
                  <button
                      onClick={onClose}
                      className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition"
                  >
                      不用了
                  </button>
                  <button
                      onClick={() => setConfirmStep(true)}
                      disabled={selectedIds.size === 0}
                      className="px-8 py-3 rounded-2xl font-bold text-white bg-indigo-500 shadow-lg hover:bg-indigo-600 shadow-indigo-200 transition transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                      確認更新 ({selectedIds.size})
                  </button>
              </div>
          ) : (
              // 第二段確認：跟上面那顆按鈕刻意不同位置/顏色/文字，避免連續點擊誤觸
              <div className="p-6 bg-amber-50 border-t border-amber-200 flex flex-col items-center gap-3">
                  <p className="text-sm font-bold text-amber-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      再確認一次：真的要把這 {selectedIds.size} 筆也改成一樣的分類嗎？這個動作會直接覆蓋原本的分類。
                  </p>
                  <div className="flex gap-4">
                      <button
                          onClick={() => setConfirmStep(false)}
                          className="px-6 py-3 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition"
                      >
                          再想一下
                      </button>
                      <button
                          onClick={() => onConfirm(Array.from(selectedIds))}
                          className="px-8 py-3 rounded-2xl font-bold text-white bg-rose-500 shadow-lg hover:bg-rose-600 shadow-rose-200 transition transform active:scale-95"
                      >
                          是，確定套用
                      </button>
                  </div>
              </div>
          )}
       </div>
    </div>
  );
};

export default BatchCorrectionModal;
