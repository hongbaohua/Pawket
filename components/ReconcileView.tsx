// 對帳模組第一批可用切片：選一個帳戶、上傳一份對帳單（電子PDF/掃描PDF/照片都可以），
// 比對出「已對到/正常等待入帳/你可能忘了記/官方紀錄一直沒出現」四種狀態。這個功能取代
// 了原本的「餵食帳單」(Scanner.tsx，2026-07-27移除)——差異在於餵食帳單假設「都是新交易，
// 猜完分類就整批新增」，完全不檢查是不是已經記過了；對帳則是「先跟已有資料比對，只有
// 真正遺漏的才要新增」，架構上更安全。上傳+密碼詢問流程沿用原本Scanner.tsx那套邏輯
// （直接重用services/pdfTextExtractor.ts），這裡只支援單一份檔案、不落地存對帳結果，
// 跑完這次Ivy處理完就結束（見PROJECT_STATUS.md的設計說明）。
import React, { useState, useRef, useMemo } from 'react';
import { Upload, Lock, Loader2, FileSearch, CheckCircle2, AlertTriangle, HelpCircle, Plus, Pencil, X, RotateCcw } from 'lucide-react';
import { Account, Transaction, BankStatementRow, MerchantAlias, ReconcileStatus, L1Category, STANDARD_CATEGORIES } from '../types';
import { extractPdfText, looksLikeScannedPdf, PdfPasswordRequiredError } from '../services/pdfTextExtractor';
import { analyzeBankStatementRows, analyzeBankStatementRowsFromFile } from '../services/geminiService';
import { reconcile, BankRowMatch } from '../services/reconciliationService';
import { findMerchantAliasCandidates, applyHistoricalCategory } from '../services/logicService';
import { RECONCILE_MAX_PDF_PAGES } from '../config/financialRules';
import { v4 as uuidv4 } from 'uuid';

const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer => {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

interface ReconcileViewProps {
  accounts: Account[];
  transactions: Transaction[];
  merchantAliases: MerchantAlias[];
  onAddFromBankRow: (prefilled: Transaction, officialPattern?: string) => void;
  onEditTransaction: (tx: Transaction) => void;
  onApplyReconcileStatuses: (updates: { transactionId: string; status: ReconcileStatus }[]) => void;
  onOpenAccountsModal: () => void;
}

const ReconcileView: React.FC<ReconcileViewProps> = ({
  accounts, transactions, merchantAliases, onAddFromBankRow, onEditTransaction, onApplyReconcileStatuses, onOpenAccountsModal
}) => {
  const activeAccounts = accounts.filter(a => !a.isArchived);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(activeAccounts[0]?.id || '');
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const accountReady = selectedAccount && selectedAccount.postingDelayMin != null && selectedAccount.postingDelayMax != null;

  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ bankRowMatches: BankRowMatch[]; manualUpdates: { transactionId: string; status: 'pending_settlement' | 'missing_official' }[] } | null>(null);
  const [aliasPicker, setAliasPicker] = useState<{ row: BankStatementRow; candidates: { userMerchant: string; count: number }[] } | null>(null);

  // PDF密碼詢問，完全比照Scanner.tsx那套（Promise-based彈窗，答對一次就存起來給下次用）
  const [pdfPasswordPrompt, setPdfPasswordPrompt] = useState<{ isRetry: boolean; resolve: (pw: string | null) => void } | null>(null);
  const [pdfPasswordInput, setPdfPasswordInput] = useState('');
  const askForPdfPassword = (isRetry: boolean): Promise<string | null> => {
    setPdfPasswordInput('');
    return new Promise(resolve => setPdfPasswordPrompt({ isRetry, resolve }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setError(null);
    setResult(null);
    const fr = new FileReader();
    fr.onloadend = () => setPreviewDataUrl(fr.result as string);
    fr.readAsDataURL(file);
  };

  // 三種來源都支援：電子PDF(有文字層，優先走這條，快又不耗視覺辨識額度)、掃描PDF(沒有
  // 文字層，退回視覺辨識)、照片(直接視覺辨識)——呼應原本Scanner.tsx「文字抽取失敗就退回
  // 圖片OCR」的備援哲學，但這裡不管走哪條路，用的都是同一套「不猜分類」的schema，
  // 不會退化成猜完分類就整批新增的舊行為。
  const getBankRows = async (dataUrl: string): Promise<BankStatementRow[]> => {
    if (dataUrl.startsWith('data:image/')) {
      return analyzeBankStatementRowsFromFile(dataUrl);
    }
    const buffer = dataUrlToArrayBuffer(dataUrl);
    let password: string | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const parsed = await extractPdfText(buffer, password);
        // 頁數防呆兩條路都要套用，避免掃描版PDF繞過去重演「整份丟給AI漏資料」的問題。
        if (parsed.pageCount > RECONCILE_MAX_PDF_PAGES) {
          throw new Error(`這份對帳單有${parsed.pageCount}頁，看起來涵蓋很長的期間。目前一次只支援一份月結單(通常1-2頁)，請分批上傳，不要整批貼歷史明細。`);
        }
        if (looksLikeScannedPdf(parsed)) {
          return await analyzeBankStatementRowsFromFile(dataUrl);
        }
        return await analyzeBankStatementRows(parsed.text);
      } catch (err) {
        if (err instanceof PdfPasswordRequiredError) {
          const input = await askForPdfPassword(err.isRetry);
          if (input === null) throw new Error('沒有輸入密碼，無法解析這份PDF。');
          password = input;
          continue;
        }
        throw err;
      }
    }
    throw new Error('密碼一直不對，請確認後重新上傳。');
  };

  const handleParse = async () => {
    if (!previewDataUrl || !selectedAccount || !accountReady) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);
    try {
      const bankRows = await getBankRows(previewDataUrl);
      if (bankRows.length === 0) {
        setError('沒有從這份檔案讀到任何交易資料，請確認上傳的內容正確。');
        return;
      }
      const r = reconcile(selectedAccount, bankRows, transactions);
      setResult(r);

      // 已對到/正常等待入帳/官方紀錄沒出現 這三種是純資訊性標記，直接套用；
      // 只有「missing_manual」需要Ivy動手新增，不在這裡自動處理。只送真的有變化的部分，
      // 避免無意義的重複寫入。
      const matchedUpdates = r.bankRowMatches
        .filter((m): m is BankRowMatch & { matchedTransactionId: string } => m.status === 'matched' && !!m.matchedTransactionId)
        .map(m => ({ transactionId: m.matchedTransactionId, status: 'matched' as ReconcileStatus }))
        .filter(u => transactions.find(t => t.id === u.transactionId)?.reconcileStatus !== 'matched');
      const otherUpdates = r.manualUpdates
        .filter(u => transactions.find(t => t.id === u.transactionId)?.reconcileStatus !== u.status)
        .map(u => ({ transactionId: u.transactionId, status: u.status as ReconcileStatus }));
      if (matchedUpdates.length > 0 || otherUpdates.length > 0) {
        onApplyReconcileStatuses([...matchedUpdates, ...otherUpdates]);
      }
    } catch (err: any) {
      console.error('對帳解析失敗', err);
      setError(err?.message || '解析失敗，請確認檔案/密碼正確後重新上傳。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setPreviewDataUrl(null);
    setResult(null);
    setError(null);
  };

  const commitAddFromRow = (row: BankStatementRow, merchantName?: string) => {
    const l1 = row.flowType === 'credit' ? L1Category.INCOME : L1Category.VARIABLE;
    const draft: Transaction = {
      id: uuidv4(),
      date: row.date,
      merchant: merchantName || '',
      originalText: row.rawDescription || '',
      amount: row.amount,
      type: row.flowType === 'credit' ? 'income' : 'expense',
      accountId: selectedAccountId,
      category: { l1, l2: STANDARD_CATEGORIES[l1][0], l3: '' },
      confidence: 1,
      isVerified: true,
      isSplit: false,
    };
    // 商家名稱確定的話，套用這個商家過去記過的分類/收支類型（原本是餵食帳單專用的邏輯，
    // 移除餵食帳單後改給這裡用，行為不變：同一家店這次一樣直接帶出上次的分類，不用重選）。
    const prefilled = applyHistoricalCategory(draft, transactions);
    onAddFromBankRow(prefilled, row.rawDescription);
    setAliasPicker(null);
  };

  const handleAddMissingManual = (row: BankStatementRow) => {
    const candidates = findMerchantAliasCandidates(row.rawDescription, merchantAliases, selectedAccountId);
    if (candidates.length >= 2) {
      setAliasPicker({ row, candidates });
    } else {
      commitAddFromRow(row, candidates[0]?.userMerchant);
    }
  };

  const matchedCount = useMemo(() => result?.bankRowMatches.filter(m => m.status === 'matched').length ?? 0, [result]);
  const missingManualRows = useMemo(() => (result?.bankRowMatches.filter(m => m.status === 'missing_manual').map(m => m.bankRow)) ?? [], [result]);
  const pendingCount = useMemo(() => result?.manualUpdates.filter(u => u.status === 'pending_settlement').length ?? 0, [result]);
  const missingOfficialTxs = useMemo(() => {
    if (!result) return [];
    const ids = new Set(result.manualUpdates.filter(u => u.status === 'missing_official').map(u => u.transactionId));
    return transactions.filter(t => ids.has(t.id));
  }, [result, transactions]);

  return (
    <div className="p-4 md:p-8 bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 min-h-[600px]">
      <h2 className="text-2xl font-extrabold text-slate-700 mb-2 flex items-center gap-3">
        <div className="p-3 bg-sky-100 rounded-2xl text-sky-500"><FileSearch className="w-6 h-6" /></div>
        對帳
      </h2>
      <p className="text-sm text-slate-400 mb-6 ml-1">上傳一份銀行月結單，跟妳自己記的帳互相核對——不是精確比對商家名稱，是看日期+金額對不對得上。</p>

      <div className="mb-6">
        <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">選帳戶</label>
        <select
          value={selectedAccountId}
          onChange={e => { setSelectedAccountId(e.target.value); handleReset(); }}
          className="w-full max-w-sm p-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl font-bold outline-none focus:border-sky-300"
        >
          {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {selectedAccount && !accountReady && (
        <div className="p-5 bg-amber-50 border border-amber-100 rounded-3xl flex items-center justify-between gap-4 mb-6">
          <p className="text-sm font-bold text-amber-600">「{selectedAccount.name}」還沒設定入帳延遲天數，要先設定才能對帳。</p>
          <button onClick={onOpenAccountsModal} className="px-4 py-2 bg-amber-400 text-white rounded-xl font-bold text-sm hover:bg-amber-500 transition shrink-0">去設定</button>
        </div>
      )}

      {accountReady && (
        <>
          {!previewDataUrl ? (
            <div
              className="border-4 border-dashed border-sky-100 rounded-[40px] p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-sky-50/30 hover:border-sky-200 transition duration-300 group bg-[#FFFBF5]"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform"><Upload className="w-9 h-9 text-sky-400" /></div>
              <p className="text-lg text-slate-600 font-extrabold">點擊上傳一份對帳單</p>
              <p className="text-sm text-slate-400 mt-2 text-center font-medium">PDF、掃描檔、拍照都可以，一次一份，通常1-2頁的那種月結單</p>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-4 bg-sky-50/50 border border-sky-100 rounded-3xl mb-4">
              <FileSearch className="w-8 h-8 text-sky-400 shrink-0" />
              <p className="flex-1 font-bold text-slate-600">已選好一份檔案，可以開始比對</p>
              <button onClick={handleReset} className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-rose-400 transition"><X className="w-5 h-5" /></button>
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="application/pdf,image/*" />

          {previewDataUrl && !result && (
            <button onClick={handleParse} disabled={isProcessing} className="w-full mt-2 py-4 bg-gradient-to-r from-sky-400 to-blue-400 text-white rounded-2xl font-bold text-lg shadow-lg shadow-sky-100 hover:shadow-sky-200 transition flex justify-center items-center gap-3">
              {isProcessing ? <><Loader2 className="w-5 h-5 animate-spin" />正在比對中...</> : <><FileSearch className="w-5 h-5" />開始比對</>}
            </button>
          )}

          {error && (
            <div className="mt-4 p-4 bg-rose-50 border border-rose-100 rounded-2xl text-sm font-bold text-rose-500">{error}</div>
          )}

          {result && (
            <div className="space-y-6 mt-6">
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                    <p className="text-xs font-bold text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />已比對成功</p>
                    <p className="text-2xl font-extrabold text-emerald-600">{matchedCount}</p>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                    <p className="text-xs font-bold text-amber-500">🟡 正常等待入帳</p>
                    <p className="text-2xl font-extrabold text-amber-600">{pendingCount}</p>
                  </div>
                </div>
                <button onClick={handleReset} className="ml-4 p-3 border border-slate-100 rounded-2xl text-slate-400 hover:bg-slate-50 transition" title="重新上傳另一份"><RotateCcw className="w-5 h-5" /></button>
              </div>

              {missingManualRows.length > 0 && (
                <div>
                  <h4 className="font-extrabold text-rose-500 mb-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />官方有紀錄，你可能忘了記（{missingManualRows.length}）</h4>
                  <p className="text-xs text-slate-400 mb-2">每一筆點「新增這筆」直接開新增交易表單，資料先幫妳帶好</p>
                  <div className="space-y-2">
                    {missingManualRows.map(row => (
                      <div key={row.id} className="p-3 bg-white border border-rose-100 rounded-2xl flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700">{row.date} · {row.flowType === 'debit' ? '-' : '+'}${row.amount}</p>
                          <p className="text-xs text-slate-400 truncate">{row.rawDescription || (row.last4 ? `卡號末四碼 ${row.last4}` : '（銀行沒有提供商家描述）')}</p>
                        </div>
                        <button onClick={() => handleAddMissingManual(row)} className="px-4 py-2 bg-rose-400 text-white rounded-xl font-bold text-sm hover:bg-rose-500 transition shrink-0 flex items-center gap-1"><Plus className="w-4 h-4" />新增這筆</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {missingOfficialTxs.length > 0 && (
                <div>
                  <h4 className="font-extrabold text-orange-500 mb-1 flex items-center gap-1"><HelpCircle className="w-4 h-4" />妳記了，但官方紀錄一直沒出現（{missingOfficialTxs.length}）</h4>
                  <p className="text-xs text-slate-400 mb-2">可能是日期或金額打錯了，點進去可以確認/修改</p>
                  <div className="space-y-2">
                    {missingOfficialTxs.map(t => (
                      <button key={t.id} onClick={() => onEditTransaction(t)} className="w-full p-3 bg-white border border-orange-100 rounded-2xl flex items-center justify-between gap-3 hover:border-orange-300 transition text-left">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700">{t.date} · {t.merchant || '（沒有商家名稱）'}</p>
                          <p className="text-xs text-slate-400">${t.amount}</p>
                        </div>
                        <Pencil className="w-4 h-4 text-slate-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {missingManualRows.length === 0 && missingOfficialTxs.length === 0 && (
                <p className="text-center text-emerald-500 font-bold py-4">全部對得上，這份對帳單沒有問題喵～</p>
              )}
            </div>
          )}
        </>
      )}

      {pdfPasswordPrompt && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[32px] shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-sky-100 text-sky-500 rounded-2xl"><Lock className="w-5 h-5" /></div>
              <h3 className="font-extrabold text-slate-700 text-lg">PDF有密碼保護</h3>
            </div>
            {pdfPasswordPrompt.isRetry && <p className="text-xs text-rose-500 font-bold mb-3">密碼不對，請再試一次</p>}
            <input
              type="password"
              autoFocus
              value={pdfPasswordInput}
              onChange={e => setPdfPasswordInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && pdfPasswordInput) { pdfPasswordPrompt.resolve(pdfPasswordInput); setPdfPasswordPrompt(null); } }}
              placeholder="請輸入這份PDF的開啟密碼"
              className="w-full p-4 bg-[#FFFBF5] border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-sky-200 outline-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { pdfPasswordPrompt.resolve(null); setPdfPasswordPrompt(null); }} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold hover:bg-slate-200 transition">取消</button>
              <button
                onClick={() => { if (pdfPasswordInput) { pdfPasswordPrompt.resolve(pdfPasswordInput); setPdfPasswordPrompt(null); } }}
                disabled={!pdfPasswordInput}
                className="flex-1 py-3 bg-sky-400 text-white rounded-2xl font-bold hover:bg-sky-500 transition disabled:opacity-40"
              >
                確認
              </button>
            </div>
          </div>
        </div>
      )}

      {aliasPicker && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[32px] shadow-2xl p-6 w-full max-w-sm">
            <h3 className="font-extrabold text-slate-700 text-lg mb-1">這筆是哪家店？</h3>
            <p className="text-xs text-slate-400 mb-4">
              銀行顯示「{aliasPicker.row.rawDescription}」，過去對應過好幾種不同商家，選一個或自己填：
            </p>
            <div className="space-y-2 mb-4">
              {aliasPicker.candidates.map(c => (
                <button
                  key={c.userMerchant}
                  onClick={() => commitAddFromRow(aliasPicker.row, c.userMerchant)}
                  className="w-full flex justify-between items-center p-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl hover:border-sky-300 transition text-left"
                >
                  <span className="font-bold text-slate-700">{c.userMerchant}</span>
                  <span className="text-xs text-slate-400">{c.count}次</span>
                </button>
              ))}
            </div>
            <button onClick={() => commitAddFromRow(aliasPicker.row)} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold hover:border-slate-300 hover:text-slate-500 transition">
              都不是，我自己填
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReconcileView;
