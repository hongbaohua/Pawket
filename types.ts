
export type TransactionType = 'income' | 'expense';
export type SourceType = 'BANK_CARD' | 'CASH_MANUAL';

export enum L1Category {
  FIXED = 'Fixed',
  VARIABLE = 'Variable',
  INVESTMENT = 'Investment',
  INCOME = 'Income'
}

export const CATEGORY_LABELS: Record<L1Category, string> = {
  [L1Category.FIXED]: '固定支出',
  [L1Category.VARIABLE]: '變動支出',
  [L1Category.INVESTMENT]: '投資儲蓄',
  [L1Category.INCOME]: '收入帳戶'
};

// NEW: Standard Classification Library for Smart Selectors
export const STANDARD_CATEGORIES: Record<L1Category, string[]> = {
  [L1Category.VARIABLE]: [
    '餐飲食品', '交通通勤', '生活日用', '休閒娛樂', 
    '服飾美妝', '醫療保健', '學習進修', '社交人情', '寵物花費', 
    '銀行手續費', '轉帳', '網路購物', '其他雜項'
  ],
  [L1Category.FIXED]: [
    '居住房租', '水電瓦斯', '電信網路', '保險費用', 
    '稅務規費', '訂閱服務', '孝親費用', '教育學費'
  ],
  [L1Category.INVESTMENT]: [
    '緊急預備金', '股票投資', '定期定額', '加密貨幣', '儲蓄險', '活簿存款'
  ],
  [L1Category.INCOME]: [
    '薪資收入', '獎金紅利', '兼職收入', '投資配息', '活簿存款', '退款', '提款', '其他', '轉帳'
  ]
};

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
