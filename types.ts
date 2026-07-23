
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

// 特殊交易性質標記：代購（幫別人買/別人幫忙買）、工作代墊（先墊付，之後跟公司/主管報帳）。
// 只做輕量標記＋顯示用，不是完整的分帳/結清計算——那是之後「共同支出/代墊分帳」
// 功能的範圍，這裡只負責讓這幾筆在畫面上跟一般支出區分開來。
export interface SpecialTag {
  type: 'proxy_purchase' | 'work_advance'; // 代購 / 工作代墊
  counterparty?: string; // 代購人是誰／之後要跟誰報帳（選填，代購者不重要時可以不寫）
  note?: string; // 額外說明，例如「已打統編」「0313批次」
}

// 一筆品項，例如 { name: '吉拿棒' } 或 { name: '小卡鐳塔', unitPrice: 18.69, quantity: 9, note: '日幣4.2×匯率4.45' }
export interface TransactionItem {
  name: string;
  unitPrice?: number; // 單價（選填，已換算成台幣）
  quantity?: number; // 數量（選填，沒填視為1）
  note?: string; // 額外說明（選填，例如匯率換算依據、代購批次）
}

export interface Transaction {
  id: string;
  date: string; // ISO Date string YYYY-MM-DD
  merchant: string; // 商家名稱（真正的商家本體，例如遊戲儲值就算是透過Google Play/MyCard付款，
                     // 這裡也應該填遊戲名稱本身，而不是帳單上顯示的付款通道名稱）
  items?: TransactionItem[]; // 品項清單（選填），一筆交易買了多樣商品時用
  note?: string; // 備註，不屬於任何品項的額外說明文字，跟商家名稱分開存
  originalText: string; // Raw OCR text for audit
  amount: number; // 實付金額（所有財務計算都用這個欄位，等於 grossAmount 扣掉 discounts 加總）
  grossAmount?: number; // 原始金額（折扣前）。沒有折扣時可以不填，視同等於 amount
  discounts?: Discount[]; // 折扣明細（選填），例如 [{label:'LINE POINT', amount:40}, {label:'會員折扣', amount:10}]
  specialTag?: SpecialTag; // 代購/工作代墊等特殊性質標記（選填）
  type: TransactionType; // New field for Income/Expense
  accountId?: string; // 屬於哪個帳戶（選填，之後逐步補齊舊資料時可以留空）——取代舊的 source_type
  paymentChannel?: string; // 同一個帳戶底下實際刷的通道（選填），例如中國信託底下可能是
                            // VISA/方便付/LINE Pay，這幾個通道共用同一個帳戶餘額，不是各自獨立的帳戶
  fromAccountId?: string; // 僅 type === 'transfer' 使用：資金來源帳戶
  toAccountId?: string;   // 僅 type === 'transfer' 使用：資金去向帳戶
  category: CategoryHierarchy;
  confidence: number; // 0.0 to 1.0
  isVerified: boolean;
  isSplit: boolean;
  parentId?: string; // If this is a child of a split
  deletedAt?: string; // 軟刪除時間戳記（選填），有值代表在垃圾桶裡，正常列表不會顯示
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

// 願望清單項目（2026-07-21 從舊的「夢想目標/存錢進度」重新設計）：
// 這個App本質是記帳，使用者沒有另外做「存錢」這個動作，所有錢就是帳戶餘額本身。
// 所以這裡不追蹤「存了多少」，而是追蹤「想買的東西，現在的餘額夠不夠、還差多少」，
// 排在陣列裡的順序＝優先順序（index 0 = 最優先），決定資金分配時誰先被扣。
export interface WishlistItem {
  id: string;
  name: string;             // 想買的東西，例如「手機」
  targetAmount: number;     // 價錢
  targetDate?: string;      // 選填 YYYY-MM-DD：有填＝這天前要準備好；沒填＝錢夠了才買，不趕時間
  isPurchased?: boolean;    // 標記已經買了，買了之後不再佔用可動用餘額計算
  purchasedDate?: string;
}

// 願望清單的「安全水位」設定：日常開銷保留＋緊急預備金，計算「可動用餘額」時要先扣掉，
// 存在 Supabase Auth 的 user_metadata（跟暱稱同一套機制），使用者可以自己調整，
// App 也會用 calculateSuggestedReserves 抓一個「不會太緊迫」的建議值給她參考。
export interface WishlistSettings {
  dailyBuffer: number;    // 日常開銷保留
  emergencyFund: number;  // 緊急預備金
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
