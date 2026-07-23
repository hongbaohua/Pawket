// ============================================================
// 財務規則設定
// ============================================================
// 這裡集中放 Dashboard 各種警示、計算公式用到的「門檻數字」與「起始值」。
// 想調整「超支多少才警示」「DTI多高算危險」之類的敏感度，改這裡的數字就好，
// 不用去 services/logicService.ts 或 components/Dashboard.tsx 裡翻程式碼找數字。
//
// 改完存檔後，重新整理瀏覽器就會套用新數字，不需要額外設定。

import { L1Category } from '../types';
import type { Budget } from '../types';

// ── 1. 預設預算 ──
// App 第一次開啟、還沒手動設定過預算時使用的起始值（單位：元/期）。
// 之後使用者可以在畫面上自行調整，這裡只是「初始值」。
export const INITIAL_BUDGETS: Budget[] = [
  { l1: L1Category.FIXED, amount: 2000 },
  { l1: L1Category.VARIABLE, amount: 1200 },
  { l1: L1Category.INVESTMENT, amount: 800 },
];

// ── 3. DTI 償債比率警戒線（固定支出 ÷ 收入 的百分比） ──
export const DTI_CAUTION_THRESHOLD = 30;   // 超過這個百分比，介面轉黃色提醒
export const DTI_CRITICAL_THRESHOLD = 35;  // 超過這個百分比，介面轉紅色警戒

// ── 5. 現金緩衝耗盡預警（Runway，估算「照目前花錢速度還能撐幾天」） ──
export const RUNWAY_ANALYSIS_WINDOW_DAYS = 90; // 用「最近幾天」的變動支出來估算平均燒錢速度
export const RUNWAY_WARNING_DAYS = 90;         // 估算剩餘天數低於這個數字，介面轉紅色警戒

// ── 6. 異常消費偵測（單筆金額突然變超高才提醒） ──
// 2026-07-22 Ivy 實測回報：原本的門檻(3筆歷史紀錄、超過平均1.5倍)太敏感，把很多正常的
// 消費波動也標成「異常」（例如平常晚餐$100、這次$151這種程度的正常差異）。調高門檻，
// 只有真的明顯偏離平常花費的才提醒，避免「什麼都是異常」讓警示失去意義。
export const ANOMALY_MIN_HISTORY_COUNT = 5;   // 同一個次分類至少要出現超過幾次歷史紀錄，才有「平均值」可以比較（原本2太少，3筆就能定義「平常」不可靠）
export const ANOMALY_AMOUNT_MULTIPLIER = 2.2; // 這筆金額超過歷史平均的幾倍，才會被標記為異常（原本1.5倍太容易觸發）
export const ANOMALY_MIN_AMOUNT = 300;        // 金額低於這個數字不列入異常偵測（原本50太低，小額類別稍微高一點就被標記，但金額本身不痛不癢）

// ── 7. 異常頻率偵測（同一個次分類，這個週期刷太多次才提醒） ──
export const FREQUENCY_HISTORY_MONTHS = 3;  // 拿最近幾個月的平均次數當比較基準
export const FREQUENCY_MULTIPLIER = 1.2;    // 這個週期的次數超過平均的幾倍，才會被標記為異常
export const FREQUENCY_MIN_COUNT = 3;       // 次數低於這個數字不列入偵測（避免小樣本誤判，例如平常只買1次、這次買2次就被誤判）

// ── 8. 現金提款重複偵測（掃描帳單時，避免同一筆 ATM 提款被記兩次：一次在銀行明細、一次是手動記的現金） ──
export const CASH_DUPLICATE_CHECK_DAYS = 7; // 往前找幾天內的提款紀錄
export const CASH_WITHDRAWAL_KEYWORDS = ['atm', 'withdrawal', '提款', '領錢', 'cash'];

// ── 9. 分類比率圓餅圖（貓咪指揮中心開頭卡片） ──
// 預設用L2次分類分塊；如果某個L3細項單獨佔全部支出的比例超過這個門檻，
// 就從它所屬的L2塊拆出來單獨顯示一塊（例如「飲料」從「餐飲食品」裡拆出來）。
export const PIE_L3_PROMOTE_THRESHOLD = 0.15; // 15%

// ── 10. 月度花費配速警示（取代舊的、跟寫死budgets比較的generateTimeWeightedAlerts） ──
// 用「這個L2次分類過去每個月實際花多少」的中位數當作合理基準，
// 依照這個月已經過了幾天算出「到今天應該花到多少才正常」，
// 實際花費超過這個「到今天應該花多少」的倍數才觸發警示。
export const PACING_MIN_HISTORY_MONTHS = 3;      // 這個L2次分類至少要有幾個月的歷史紀錄，才有可信的「合理基準」可比較
export const PACING_WARNING_MULTIPLIER = 1.3;    // 超過「到今天應該花多少」的幾倍，變黃色提醒
export const PACING_CRITICAL_MULTIPLIER = 1.6;   // 超過「到今天應該花多少」的幾倍，變紅色警戒
export const PACING_MIN_AMOUNT = 200;            // 「到今天應該花多少」低於這個數字不列入偵測，避免小額類別的正常波動也被標記

// ── 11. 固定週期性支出偵測（例如訂閱制，不一定分類是「固定支出」，但行為模式每月固定出現） ──
export const RECURRING_MIN_HISTORY_MONTHS = 3;     // 這個商家至少要出現過幾個不同月份才夠判斷是不是「幾乎每月都有」
export const RECURRING_MONTH_COVERAGE_RATIO = 0.75; // 從第一次出現到現在的月份區間裡，至少要有這個比例的月份有出現，才算「幾乎每月都有」

// ── 12. 預算罰則系統（Beta）預設值 ──
// 使用者可在「設定」畫面手動開關/調整，這裡只是預設值。
export const DEFAULT_PENALTY_CONFIG = {
  enabled: false,
  ratio: 0.5,               // 超支金額的 50% 會被視為下期預算的「罰款」扣除
  targetCategory: '休閒娛樂' // 罰則預設鎖定的次分類目標
};
