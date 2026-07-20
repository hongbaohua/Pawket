
// 'transfer' 是帳戶間的資金移動（例如提款、儲值電子支付），不算收入也不算支出，
// 各項財務計算(logicService.ts)都用明確的 === 'income' / === 'expense' 判斷，'transfer' 自然不會被算進去。
export type TransactionType = 'income' | 'expense' | 'transfer';

// L1Category / CATEGORY_LABELS / STANDARD_CATEGORIES 已搬到 config/categories.ts，
// 想新增/修改分類選項請去那個檔案編輯。這裡保留 import + re-export，讓其他檔案的 import 路徑不用改。
import { L1Category, CATEGORY_LABELS, STANDARD_CATEGORIES } from './config/categories';
export { L1Category, CATEGORY_LABELS, STANDARD_CATEGORIES };

export interface CategoryHierarchy {
  l1: L1Category;
  l2: string;
  l3: string;
}

// 帳戶：使用者自訂清單，不是寫死的銀行清單。
// 型別順序刻意照「誰是真正的錢、誰是衍生出來的」排：
// 現金/銀行帳戶/信用卡 是原始金流；電子支付錢包（LINE Pay Money、全支付、悠遊付）是要先儲值進去的獨立餘額，
// 儲值可以來自任何一個銀行帳戶/信用卡，不是固定綁死一個來源；
// 實體儲值卡（悠遊卡、點點卡）又是更下游、有些甚至只能從電子支付錢包加值（例如悠遊卡只能從悠遊付加值，不能直接刷銀行帳戶）。
// 因此帳戶之間不設「固定連結」欄位，儲值/加值一律用交易紀錄裡的「轉帳」型態表示（見 Transaction.type === 'transfer'，之後會實作），
// 每一筆儲值可以自由選來源帳戶，符合實際狀況（LINE Pay Money、全支付都能綁多家銀行/多張卡）。
export type AccountType = 'cash' | 'bank_debit' | 'bank_credit' | 'e_wallet' | 'stored_value';

export interface Account {
  id: string;
  name: string;              // 自訂顯示名稱，如「中國信託簽帳卡」
  institution: string;       // 自由文字，如「中國信託」「LINE Pay」
  type: AccountType;
  currency: string;
  isArchived: boolean;
}

// 一筆折扣明細，例如 { label: 'LINE POINT', amount: 40 }
export interface Discount {
  label: string;
  amount: number;
}

export interface Transaction {
  id: string;
  date: string; // ISO Date string YYYY-MM-DD
  merchant: string; // 商家名稱
  note?: string; // 備註/品項細節，跟商家名稱分開存（例如商家填「潮玩城」，備註填「名偵探柯南盲盒×2」）
  originalText: string; // Raw OCR text for audit
  amount: number; // 實付金額（所有財務計算都用這個欄位，等於 grossAmount 扣掉 discounts 加總）
  grossAmount?: number; // 原始金額（折扣前）。沒有折扣時可以不填，視同等於 amount
  discounts?: Discount[]; // 折扣明細（選填），例如 [{label:'LINE POINT', amount:40}, {label:'會員折扣', amount:10}]
  type: TransactionType; // New field for Income/Expense
  accountId?: string; // 屬於哪個帳戶（選填，之後逐步補齊舊資料時可以留空）——取代舊的 source_type
  fromAccountId?: string; // 僅 type === 'transfer' 使用：資金來源帳戶
  toAccountId?: string;   // 僅 type === 'transfer' 使用：資金去向帳戶
  category: CategoryHierarchy;
  confidence: number; // 0.0 to 1.0
  isVerified: boolean;
  isSplit: boolean;
  parentId?: string; // If this is a child of a split
}

export interface Budget {
  l1: L1Category;
  amount: number;
}

// NEW: Penalty Configuration for Module III
export interface PenaltyConfig {
  enabled: boolean;
  ratio: number; // 0.1 to 1.0 (default 0.5)
  targetCategory: string; // L2 Category Name, default '休閒娛樂'
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  startDate: string; // YYYY-MM-DD (Added for Dream Goal Center)
  targetDate: string; // YYYY-MM-DD
  initialAmount: number; // Amount saved before using the app
  isPrimary: boolean;
}

export interface Alert {
  id: string;
  level: 'critical' | 'warning' | 'info';
  message: string;
  metric: string; // e.g., "Variable Spending"
  value: number;
  threshold: number;
}

export interface AnalysisResult {
  transactions: Transaction[];
  rawText: string;
}

export type TimeScope = 'all' | 'natural_month' | 'custom_cycle' | 'custom_range';

export interface DateRange {
  startDate: Date;
  endDate: Date;
  label: string;
}
