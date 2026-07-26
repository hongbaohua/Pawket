
import { GoogleGenAI, Type } from "@google/genai";
import { Transaction, L1Category, TransactionType, STANDARD_CATEGORIES } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { GEMINI_MODEL, OCR_MAX_RETRIES, OCR_VERIFY_CONFIDENCE_THRESHOLD, OCR_DEFAULT_CONFIDENCE } from '../config/aiSettings';

// Construct dynamic category list for prompt
const CATEGORY_GUIDE = Object.entries(STANDARD_CATEGORIES)
  .map(([l1, l2s]) => `- ${l1}: [${l2s.join(', ')}]`)
  .join('\n');

const SYSTEM_INSTRUCTION = `
Role: Senior Financial Data Extraction Specialist.
Task: Extract transaction records from bank statement images/PDFs into structured JSON.

**CRITICAL LOGIC RULES (Anti-Hallucination & De-duplication):**

1. **Income vs Expense Detection (Sign/Type Rules)** - **HIGHEST PRIORITY**:
   - **Expense (支出)**: 
     - Keywords: "Debit", "DR", "Withdrawal", "Payment", "Purchase", "支出", "消費", "扣款".
     - Signs: Negative numbers (e.g., -100) indicate expense in most CSVs, BUT in bank statements, "Debit" column is positive. **Check the column header**.
   - **Income (收入)**: 
     - Keywords: "Credit", "CR", "Deposit", "Refund", "Interest", "Salary", "存入", "入帳", "配息".
     - Signs: Positive numbers in a "Credit" column.
   - **Ambiguity Rule**: If a column is named "Amount" with no sign:
     - If description contains "Payment" or "Purchase" -> Expense.
     - If description contains "Deposit" or "Transfer from" -> Income.

2. **Master List Priority (主表優先原則)**: 
   - Scan for the main "Transaction List" table first. 
   - **IGNORE** isolated receipt summaries, fee confirmation slips, or "Total Due" boxes if they duplicate data already found in the main table.
   - If a "Handling Fee" appears in the summary but is also listed in the table, do not extract it twice.

3. **Date Distinction (日期辨識邏輯)**:
   - **Target**: 'Transaction Date' (消費日/交易日).
   - **Avoid**: 'Posting Date' (入帳日) if possible.
   - **FORBIDDEN**: Do NOT use the 'Statement Date' (製表日) or 'Print Date' as the transaction date for individual rows.
   - If a row has two dates, select the **earlier** one.

4. **Smart Pre-Classification & Synonym Merging (智能分類與合併)**:
   - **STRICT RULE**: You MUST assign the L2 category form the PROVIDED LIST below. **Do NOT invent new L2 categories.**
   - **MERGE SYNONYMS**: If a transaction implies a category not in the list, map it to the closest existing one.
     - "Taxi", "Uber", "High Speed Rail", "Gas" -> Map to '交通通勤' (Do NOT use 'Transport').
     - "7-11", "Supermarket", "Groceries", "Toilet paper" -> Map to '生活日用'.
     - "Spotify", "Netflix", "Youtube" -> Map to '訂閱服務'.
     - "Doctor", "Pharmacy", "Medicine" -> Map to '醫療保健'.
   
   **Standard Category List**:
   ${CATEGORY_GUIDE}

5. **Row-Level Alignment**:
   - Use the **Date** column as the anchor. A valid row MUST have a specific date.
   - Scan horizontally. Handle multi-line descriptions by grouping them under the Date anchor.

**Data Cleaning**:
- Merge truncated merchant names (e.g., "Uber * Trip" -> "Uber").
- Ensure all dates are in YYYY-MM-DD format.
`;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TRANSACTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          merchant: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          type: { type: Type.STRING, enum: ["income", "expense"] },
          confidence: { type: Type.NUMBER },
          l1_category: { type: Type.STRING, enum: ["Fixed", "Variable", "Investment", "Income"] },
          l2_category: { type: Type.STRING },
          l3_category: { type: Type.STRING }
        },
        required: ["date", "merchant", "amount", "type", "l1_category"]
      }
    }
  }
};

// 兩種來源(圖片OCR / PDF文字解析)最後都要轉成同一種Transaction格式，這段共用邏輯抽出來，
// 避免兩個function各寫一份、以後改欄位對應規則要改兩個地方。
const mapResponseToTransactions = (responseText: string): Transaction[] => {
  const parsed = JSON.parse(responseText);
  const rawList = parsed.transactions || (Array.isArray(parsed) ? parsed : []);

  return rawList.map((item: any) => ({
    id: uuidv4(),
    date: item.date,
    merchant: item.merchant || "Unknown Merchant",
    originalText: `${item.merchant} ${item.amount}`,
    amount: item.amount,
    type: (item.type?.toLowerCase() === 'income') ? 'income' : 'expense',
    category: {
      l1: item.l1_category as L1Category || L1Category.VARIABLE,
      l2: item.l2_category || '其他雜項', // Default fallback
      l3: item.l3_category || ''
    },
    confidence: item.confidence || OCR_DEFAULT_CONFIDENCE,
    isVerified: (item.confidence || 0) >= OCR_VERIFY_CONFIDENCE_THRESHOLD,
    isSplit: false
  }));
};

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

export const analyzeStatementImage = async (base64Image: string): Promise<Transaction[]> => {
  // Clean base64 string
  const mimeMatch = base64Image.match(/^data:(.*?);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const cleanBase64 = base64Image.replace(/^data:.*?;base64,/, '');

  return runExtraction([
    { inlineData: { mimeType: mimeType, data: cleanBase64 } },
    { text: "Extract transaction data. Follow strict logic rules, especially for Income/Expense detection." }
  ], TRANSACTION_RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, mapResponseToTransactions);
};

// PDF結構化解析用：直接把PDF抽出來的純文字(見services/pdfTextExtractor.ts)交給Gemini結構化，
// 不用把整份PDF當圖片辨識——文字比圖片token少很多(便宜)、也不會有OCR看錯字的問題，
// 前提是這份PDF本身有文字層(不是掃描圖片)，這件事由呼叫端用looksLikeScannedPdf先判斷過。
export const analyzeStatementText = async (extractedText: string): Promise<Transaction[]> => {
  return runExtraction([
    { text: "The following is text extracted directly from a bank statement PDF (not an image). Extract transaction data. Follow strict logic rules, especially for Income/Expense detection.\n\n--- PDF TEXT START ---\n" + extractedText + "\n--- PDF TEXT END ---" }
  ], TRANSACTION_RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, mapResponseToTransactions);
};

// 收據/明細品項辨識用：跟上面兩個「一份對帳單抓出好幾筆新交易」不同層級——這是「單一一筆
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
`;

const RECEIPT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          unitPrice: { type: Type.NUMBER },
          quantity: { type: Type.NUMBER }
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
  items: { name: string; unitPrice: number; quantity: number }[];
  discounts: { label: string; amount: number }[];
  mergedName: string;
}

const mapResponseToReceiptResult = (responseText: string): ReceiptAnalysisResult => {
  const parsed = JSON.parse(responseText);
  return {
    items: (parsed.items || []).map((it: any) => ({
      name: it.name || '',
      unitPrice: typeof it.unitPrice === 'number' ? it.unitPrice : 0,
      quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1
    })),
    discounts: (parsed.discounts || []).map((d: any) => ({
      label: d.label || '',
      amount: typeof d.amount === 'number' ? d.amount : 0
    })),
    mergedName: parsed.mergedName || ''
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
