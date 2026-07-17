// ============================================================
// 分類清單設定
// ============================================================
// 這裡的中文字串，就是 App 裡「分類」下拉選單實際會顯示、可選的選項。
// 想新增/修改/刪除分類，只要編輯這個檔案，不用去畫面元件（components/ 底下那些）裡找程式碼。
//
// 結構是「大類(L1) -> 次分類(L2)清單」：
//   - 大類(L1) 只有四種，是整個 App 的固定骨架：固定支出／變動支出／投資儲蓄／收入帳戶，不建議增減。
//   - 次分類(L2) 是你平常實際會用到的分類，例如「餐飲食品」「交通通勤」，這裡可以自由增減。
//     陣列裡的順序，就是下拉選單顯示的順序；每個大類陣列的「第一個」項目會被當作預設值。

// L1Category 定義在這裡（而不是 types.ts），是為了避免 types.ts 跟這個檔案互相 import 造成循環引用。
// 其他檔案請照舊從 '../types' import L1Category，那邊會自動轉手 re-export。
export enum L1Category {
  FIXED = 'Fixed',
  VARIABLE = 'Variable',
  INVESTMENT = 'Investment',
  INCOME = 'Income'
}

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

// 大類(L1)本身在畫面上顯示的中文名稱
export const CATEGORY_LABELS: Record<L1Category, string> = {
  [L1Category.FIXED]: '固定支出',
  [L1Category.VARIABLE]: '變動支出',
  [L1Category.INVESTMENT]: '投資儲蓄',
  [L1Category.INCOME]: '收入帳戶'
};
