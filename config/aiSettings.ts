// ============================================================
// AI / OCR 設定
// ============================================================
// 「餵食帳單 Scanner」呼叫 Gemini 辨識帳單圖片時用到的相關參數。

export const GEMINI_MODEL = 'gemini-3-flash-preview';

// 辨識失敗（例如網路問題、Gemini 暫時無回應）時，最多自動重試幾次
// 重試間隔會用指數退避：1秒 → 2秒 → 4秒
export const OCR_MAX_RETRIES = 3;

// Gemini 回傳的信心度（0~1）低於這個值，這筆交易會被標記為「需要人工確認」
export const OCR_VERIFY_CONFIDENCE_THRESHOLD = 0.85;

// Gemini 沒有回傳信心度數字時，套用的預設信心度
export const OCR_DEFAULT_CONFIDENCE = 0.8;
