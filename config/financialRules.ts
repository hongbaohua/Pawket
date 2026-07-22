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

// ── 2. 動態時間加權警示（貓咪指揮中心的紅／黃燈邏輯） ──
// 公式：目前日均花費 > (預算日均 × ALERT_K_FACTOR) 就開始出現警示。
// K 值越大，代表允許「花得比預算快」的空間越大，警示會比較晚出現；
// K = 1.0 代表完全不給緩衝，只要花費速度略快於預算就會警示。
export const ALERT_K_FACTOR = 1.15;

// 超標率（花費速度超過門檻的百分比）超過這個數字，
// 就從「黃色警告 (warning)」升級成「紅色危急 (critical)」。
export const ALERT_CRITICAL_THRESHOLD_PERCENT = 20;

// ── 3. DTI 償債比率警戒線（固定支出 ÷ 收入 的百分比） ──
export const DTI_CAUTION_THRESHOLD = 30;   // 超過這個百分比，介面轉黃色提醒
export const DTI_CRITICAL_THRESHOLD = 35;  // 超過這個百分比，介面轉紅色警戒

// ── 4. 機會成本試算 ──
// 「這筆變動支出如果拿去投資，幾年後會變多少」的估算參數，純粹是財務教育性質的試算，不是真實投資建議。
export const OPPORTUNITY_COST_ANNUAL_RETURN = 0.07; // 假設年化報酬率 7%
export const OPPORTUNITY_COST_YEARS = 10;           // 試算幾年後的複利結果

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

// ── 9. 年度稅務可能抵扣項目關鍵字 ──
// 僅供初步篩選參考用（例如提醒「這些支出報稅時可能用得到」），不是正式的稅務建議，實際申報請以官方規定為準。
export const TAX_DEDUCTIBLE_KEYWORDS = [
  '醫療', '診所', '掛號', '醫院', 'medical', 'clinic', 'hospital',
  '保險', '壽險', 'insurance',
  '捐款', '公益', 'donation', 'charity',
  '學費', 'education', 'tuition'
];

// ── 11. 預算罰則系統（Beta）預設值 ──
// 使用者可在「設定」畫面手動開關/調整，這裡只是預設值。
export const DEFAULT_PENALTY_CONFIG = {
  enabled: false,
  ratio: 0.5,               // 超支金額的 50% 會被視為下期預算的「罰款」扣除
  targetCategory: '休閒娛樂' // 罰則預設鎖定的次分類目標
};
