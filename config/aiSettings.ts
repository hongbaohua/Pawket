// ============================================================
// AI / OCR 設定
// ============================================================
// 呼叫 Gemini 時用到的相關參數。目前有兩個地方會用到：
//   1. 新增/編輯交易裡的「上傳收據照片自動辨識」（辨識商家/金額/品項）
//   2. 「戰情報告」請 AI 解讀這期的財務資料
// （舊的「餵食帳單 Scanner」整批 OCR 新增功能 2026-07-27 已移除，改用餵食核對對帳）

export const GEMINI_MODEL = 'gemini-3-flash-preview';

// 辨識失敗（例如網路問題、Gemini 暫時無回應）時，最多自動重試幾次
// 重試間隔會用指數退避：1秒 → 2秒 → 4秒
export const OCR_MAX_RETRIES = 3;

// Gemini 回傳的信心度（0~1）低於這個值，這筆交易會被標記為「需要人工確認」
export const OCR_VERIFY_CONFIDENCE_THRESHOLD = 0.85;

// Gemini 沒有回傳信心度數字時，套用的預設信心度
export const OCR_DEFAULT_CONFIDENCE = 0.8;
