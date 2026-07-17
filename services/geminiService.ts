
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

export const analyzeStatementImage = async (base64Image: string): Promise<Transaction[]> => {
  // Lazy initialization to ensure env vars are ready
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Clean base64 string
  const mimeMatch = base64Image.match(/^data:(.*?);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const cleanBase64 = base64Image.replace(/^data:.*?;base64,/, '');

  const MAX_RETRIES = OCR_MAX_RETRIES;
  let lastError: any;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: {
          parts: [
            { inlineData: { mimeType: mimeType, data: cleanBase64 } },
            { text: "Extract transaction data. Follow strict logic rules, especially for Income/Expense detection." }
          ]
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: {
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
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");

      const parsed = JSON.parse(text);
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

    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed:`, error);
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await wait(1000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error("Failed to process image after multiple attempts.");
};
