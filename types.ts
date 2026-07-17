
export type TransactionType = 'income' | 'expense';
export type SourceType = 'BANK_CARD' | 'CASH_MANUAL';

// L1Category / CATEGORY_LABELS / STANDARD_CATEGORIES 已搬到 config/categories.ts，
// 想新增/修改分類選項請去那個檔案編輯。這裡保留 import + re-export，讓其他檔案的 import 路徑不用改。
import { L1Category, CATEGORY_LABELS, STANDARD_CATEGORIES } from './config/categories';
export { L1Category, CATEGORY_LABELS, STANDARD_CATEGORIES };

export interface CategoryHierarchy {
  l1: L1Category;
  l2: string;
  l3: string;
}

export interface Transaction {
  id: string;
  date: string; // ISO Date string YYYY-MM-DD
  merchant: string;
  originalText: string; // Raw OCR text for audit
  amount: number;
  type: TransactionType; // New field for Income/Expense
  source_type: SourceType; // NEW: Track source of transaction
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
