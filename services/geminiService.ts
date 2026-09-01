
import { GoogleGenAI, Type } from "@google/genai";
import { BankStatementRow } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { GEMINI_MODEL, OCR_MAX_RETRIES } from '../config/aiSettings';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 共用的重試迴圈：呼叫Gemini、解析回應、失敗時指數退避重試。schema/systemInstruction/mapper
// 參數化後，銀行對帳單辨識(多筆交易)跟收據品項辨識(單筆交易內的品項)可以共用同一套
// 重試/錯誤處理邏輯，不用各寫一份。
const runExtraction = async <T>(parts: any[], schema: any, systemInstruction: string, mapper: (text: string) => T): Promise<T> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const MAX_RETRIES = OCR_MAX_RETRIES;
  let lastError: any;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");
      return mapper(text);

    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed:`, error);
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await wait(1000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error("Failed to process statement after multiple attempts.");
};

// 收據/明細品項辨識用：跟下面「一份對帳單抓出好幾筆原始資料列」不同層級——這是「單一一筆
// 交易內部買了哪些品項」，給EditTransactionModal.tsx的「喵喵購物清單」上傳收據照片自動填用。
const RECEIPT_SYSTEM_INSTRUCTION = `
Role: Receipt Line-Item Extraction Specialist.
Task: Read a photo of a single receipt/itemized bill (convenience store receipt, restaurant bill, retail invoice, etc.) and extract line items.

**CRITICAL RULES:**

1. **unitPrice must be the PER-UNIT price, not the line subtotal.**
   - If the receipt shows "雞腿飯 x2 $160" (a line subtotal for multiple quantity), you MUST divide by
     quantity to report unitPrice=80, quantity=2. Do NOT put the line subtotal (160) into unitPrice.
   - If quantity is not shown, assume quantity=1 and unitPrice = the printed price.

2. **Discounts**: extract any visible discount lines (e.g. "會員折扣 -$20", "9折" converted to an amount)
   into the discounts array as {label, amount}. If there are no visible discounts, return an empty array.
   Do not invent discounts that aren't shown.

3. **mergedName**: write ONE short Traditional Chinese phrase summarizing all the items together
   (e.g. "早餐(蛋餅+豆漿)", "超商雜貨"), for a user who prefers not to itemize.

4. **Output language**: all text fields (item names, discount labels, mergedName) MUST be Traditional
   Chinese (繁體中文), never Simplified Chinese, regardless of what script appears on the receipt.

5. If the image contains multiple unrelated purchases or looks like a multi-transaction statement rather
   than a single receipt, do not force it into one coherent breakdown — extract whatever is legible.
   Low-confidence items are fine; the user can edit them by hand afterward.

6. **merchant**: if the store/merchant name is printed on the receipt (usually near the top), extract it
   as a short Traditional Chinese name (e.g. "7-ELEVEN", "全家便利商店", "五桐號"). If it's not legible or
   not printed, omit this field entirely — do not guess.

7. **Combo / set-meal items (subItems)**: if a line on the receipt represents a bundled set (printed as
   "套餐"/"combo"/"組合", or a priced line immediately followed by indented/listed component lines with
   no separate prices of their own), extract it as ONE item whose \`subItems\` array lists the included
   components. Only give a sub-item its own \`unitPrice\` if the receipt prints a distinct price for that
   specific component; otherwise omit \`unitPrice\` for that sub-item (its cost is already included in the
   parent combo item's own unitPrice/subtotal). Do NOT invent a breakdown for a plain single product —
   only use \`subItems\` when the receipt itself visibly shows a bundle/breakdown relationship.
`;

const RECEIPT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    merchant: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          unitPrice: { type: Type.NUMBER },
          quantity: { type: Type.NUMBER },
          // 套餐/組合品項用：內含的子項目，只在收據本身就印出「一項底下列了好幾個內含品項」
          // 這種結構時才填，不要對單純的單一商品硬湊一個breakdown（見上面規則7）。
          subItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                unitPrice: { type: Type.NUMBER },
                quantity: { type: Type.NUMBER }
              },
              required: ["name"]
            }
          }
        },
        required: ["name", "unitPrice", "quantity"]
      }
    },
    discounts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          amount: { type: Type.NUMBER }
        },
        required: ["label", "amount"]
      }
    },
    mergedName: { type: Type.STRING }
  },
  required: ["items", "mergedName"]
};

export interface ReceiptAnalysisResult {
  items: { name: string; unitPrice: number; quantity: number; subItems?: { name: string; unitPrice?: number; quantity?: number }[] }[];
  discounts: { label: string; amount: number }[];
  mergedName: string;
  merchant?: string;
}

const mapResponseToReceiptResult = (responseText: string): ReceiptAnalysisResult => {
  const parsed = JSON.parse(responseText);
  return {
    items: (parsed.items || []).map((it: any) => ({
      name: it.name || '',
      unitPrice: typeof it.unitPrice === 'number' ? it.unitPrice : 0,
      quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1,
      subItems: Array.isArray(it.subItems) && it.subItems.length > 0
        ? it.subItems.map((sub: any) => ({
            name: sub.name || '',
            unitPrice: typeof sub.unitPrice === 'number' ? sub.unitPrice : undefined,
            quantity: typeof sub.quantity === 'number' && sub.quantity > 0 ? sub.quantity : undefined
          }))
        : undefined
    })),
    discounts: (parsed.discounts || []).map((d: any) => ({
      label: d.label || '',
      amount: typeof d.amount === 'number' ? d.amount : 0
    })),
    mergedName: parsed.mergedName || '',
    merchant: parsed.merchant || undefined
  };
};

export const analyzeReceiptItems = async (base64Image: string): Promise<ReceiptAnalysisResult> => {
  const mimeMatch = base64Image.match(/^data:(.*?);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const cleanBase64 = base64Image.replace(/^data:.*?;base64,/, '');

  return runExtraction([
    { inlineData: { mimeType: mimeType, data: cleanBase64 } },
    { text: "Extract line items from this receipt. Follow strict rules for unit price vs line subtotal, and output Traditional Chinese only." }
  ], RECEIPT_RESPONSE_SCHEMA, RECEIPT_SYSTEM_INSTRUCTION, mapResponseToReceiptResult);
};

// 對帳模組用：從銀行對帳單文字抽出「原始資料列」——對帳只需要日期/金額/收支方向來比對，
// 完全不需要猜分類，硬逼AI分類反而容易亂猜（尤其月結單格式常常只有卡號末四碼+日期+金額，
// 連商家描述都沒有）。schema故意不要求分類欄位。
const BANK_ROW_SYSTEM_INSTRUCTION = `
Role: Bank Statement Row Extraction Specialist.
Task: Extract every transaction ROW from the given bank statement text — this is for reconciliation
(matching against the user's own manually-kept records), NOT for categorization. Do not guess a category.

**CRITICAL RULES:**

1. **flowType (debit/credit) detection is the highest priority**:
   - "debit": money left the account (withdrawal, purchase, payment, 扣款/支出/消費/提款).
   - "credit": money entered the account (deposit, refund, interest, salary, 存入/入帳/配息).
   - amount is always a POSITIVE number; direction is expressed only via flowType, never via sign.

2. **Date**: use the transaction/consumption date (交易日/消費日), not the posting date (入帳日) or
   the statement print date, if multiple dates are shown per row.

3. **rawDescription**: copy the merchant/description text exactly as printed, including truncated bank
   codes (e.g. "連支＊樂樂早餐"). Many bank monthly statements have NO description at all (only
   card-last-4/date/amount) — in that case leave rawDescription empty/omit it, do NOT invent one.

4. **last4**: the last 4 digits of the card number if shown, otherwise omit.

5. Extract EVERY row in the main transaction table. Ignore summary/total boxes, marketing text, and
   duplicate fee-confirmation slips that repeat a row already in the main table.
`;

const BANK_ROW_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          amount: { type: Type.NUMBER },
          flowType: { type: Type.STRING, enum: ["debit", "credit"] },
          rawDescription: { type: Type.STRING },
          last4: { type: Type.STRING }
        },
        required: ["date", "amount", "flowType"]
      }
    }
  },
  required: ["rows"]
};

const mapResponseToBankStatementRows = (responseText: string): BankStatementRow[] => {
  const parsed = JSON.parse(responseText);
  const rawList = parsed.rows || [];
  return rawList.map((item: any) => ({
    id: uuidv4(),
    date: item.date,
    amount: Math.abs(Number(item.amount) || 0),
    flowType: item.flowType === 'credit' ? 'credit' : 'debit',
    rawDescription: item.rawDescription || undefined,
    last4: item.last4 || undefined
  }));
};

export const analyzeBankStatementRows = async (extractedText: string): Promise<BankStatementRow[]> => {
  return runExtraction([
    { text: "The following is text extracted directly from a bank statement PDF (not an image). Extract every row for reconciliation purposes — do not guess a category.\n\n--- PDF TEXT START ---\n" + extractedText + "\n--- PDF TEXT END ---" }
  ], BANK_ROW_RESPONSE_SCHEMA, BANK_ROW_SYSTEM_INSTRUCTION, mapResponseToBankStatementRows);
};

// 對帳模組用：紙本對帳單拍照、或掃描成沒有文字層的PDF，都沒辦法走上面文字抽取那條路，
// 改用Gemini的多模態視覺能力直接讀檔案本身(圖片或PDF都可以直接當inlineData送出，
// 跟舊版整頁圖片OCR的做法一樣)，但用同一套「不猜分類」的schema，維持對帳「只比對、
// 不亂猜」的一貫設計，不會退化成猜分類就整批新增的舊行為。
export const analyzeBankStatementRowsFromFile = async (dataUrl: string): Promise<BankStatementRow[]> => {
  const mimeMatch = dataUrl.match(/^data:(.*?);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const cleanBase64 = dataUrl.replace(/^data:.*?;base64,/, '');

  return runExtraction([
    { inlineData: { mimeType, data: cleanBase64 } },
    { text: "Extract every row from this bank/postal statement (photo or scanned document) for reconciliation purposes — do not guess a category." }
  ], BANK_ROW_RESPONSE_SCHEMA, BANK_ROW_SYSTEM_INSTRUCTION, mapResponseToBankStatementRows);
};
