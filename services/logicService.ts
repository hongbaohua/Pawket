
import { Transaction, Account, Budget, Alert, L1Category, CATEGORY_LABELS, TimeScope, DateRange, WishlistItem, PenaltyConfig, MerchantAlias, MerchantAliasCandidate, LongTermReserve } from '../types';
import { format, getDaysInMonth, getDate, startOfMonth, endOfMonth, addMonths, subMonths, differenceInDays, isAfter, isBefore, startOfDay, endOfDay, parseISO, startOfYear, getMonth, getYear, isSameMonth, differenceInMonths, subDays, addDays } from 'date-fns';
import {
  RUNWAY_ANALYSIS_WINDOW_DAYS, RUNWAY_OUTLIER_IQR_MULTIPLIER, RUNWAY_OUTLIER_MIN_SAMPLE_SIZE,
  ANOMALY_MIN_HISTORY_COUNT, ANOMALY_AMOUNT_MULTIPLIER, ANOMALY_MIN_AMOUNT,
  FREQUENCY_HISTORY_MONTHS, FREQUENCY_MULTIPLIER, FREQUENCY_MIN_COUNT,
  PIE_L3_PROMOTE_THRESHOLD, PIE_MAX_SLICES,
  PACING_WARNING_MULTIPLIER, PACING_CRITICAL_MULTIPLIER, PACING_MIN_AMOUNT,
  BUDGET_SUGGESTION_RECENT_MONTHS, BUDGET_SUGGESTION_MIN_HISTORY_MONTHS,
  RECURRING_MIN_HISTORY_MONTHS, RECURRING_MONTH_COVERAGE_RATIO, RECURRING_AMOUNT_BAND_RATIO, RECURRING_MIN_CONSISTENT_RATIO,
} from '../config/financialRules';

// Precision helper to avoid floating point errors
const toCents = (val: number) => Math.round(val * 100);
const fromCents = (val: number) => val / 100;

// 「消費分析」類函式（圓餅圖/配速警示/固定週期性/異常提醒等，用來分析Ivy自己的花費習慣）
// 一律用這個判斷，把有specialTag(代購/工作代墊/借貸)的支出排除在外——這些錢雖然真的
// 從帳戶流出，但不是Ivy自己的消費，是先幫別人墊、之後會收回來的，混進消費分析只會讓
// 統計失真（2026-08-11 Ivy反應）。跟「餘額/現金緩衝耗盡預警」這種看「錢真的流出去多少」
// 的函式是不同的關注點，那些刻意不套用這個排除。
const isPersonalConsumption = (t: Transaction): boolean => t.type === 'expense' && !t.specialTag;

/**
 * Helper: Calculate Date Range based on Scope and Cycle Day
 * Updated to accept anchorDate for viewing historical data
 */
export const getDateRange = (
  scope: TimeScope, 
  cycleStartDay: number, 
  allTransactions: Transaction[],
  anchorDate: Date = new Date(), // Default to today if not provided
  customStart?: Date,
  customEnd?: Date
): DateRange => {
  
  if (scope === 'all') {
    let earliest = anchorDate;
    if (allTransactions.length > 0) {
       const sorted = [...allTransactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
       earliest = new Date(sorted[0].date);
    }
    return {
      startDate: startOfDay(earliest),
      endDate: endOfDay(anchorDate),
      label: '至今累積'
    };
  }

  if (scope === 'custom_range' && customStart && customEnd) {
      return {
          startDate: startOfDay(customStart),
          endDate: endOfDay(customEnd),
          label: `${format(customStart, 'yyyy/MM/dd')} - ${format(customEnd, 'yyyy/MM/dd')}`
      };
  }

  if (scope === 'natural_month') {
    return {
      startDate: startOfMonth(anchorDate),
      endDate: endOfMonth(anchorDate),
      label: format(anchorDate, 'yyyy年MM月')
    };
  }

  // Custom Cycle Logic
  const currentDay = getDate(anchorDate);
  let start: Date;
  let end: Date;

  if (currentDay >= cycleStartDay) {
    start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), cycleStartDay);
    end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, cycleStartDay - 1);
  } else {
    start = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, cycleStartDay);
    end = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), cycleStartDay - 1);
  }

  return {
    startDate: startOfDay(start),
    endDate: endOfDay(end),
    label: `${format(start, 'MM/dd')} - ${format(end, 'MM/dd')}`
  };
};

/**
 * 月度花費配速警示：2026-08-11重新設計。原本用「歷史中位數×已過天數比例」自動外推
 * 一個「應該花多少」，Ivy反應這樣算出來的基準她不知道哪來的、也不可靠（月初幾筆消費
 * 就能讓配速誤判成整月嚴重超支，餐飲食品那次就是實例）。改成只跟Ivy自己在系統設定裡
 * 確認過的「分類月預算」(categoryBudgets，見suggestCategoryBudgets)比對——這是她自己
 * 看過近期/長期歷史數字後決定的基準，不是系統自動猜的。**沒有設定月預算的分類，
 * 完全不會出現在這裡**，不再嘗試自動猜測基準，避免重演誤報問題。
 */
export const generateMonthlyPacingAlerts = (
  currentPeriodTransactions: Transaction[],
  periodStart: Date,
  periodEnd: Date,
  categoryBudgets: Record<string, number>
): Alert[] => {
  const alerts: Alert[] = [];
  const now = new Date();

  const totalDaysInPeriod = differenceInDays(periodEnd, periodStart) + 1;
  let daysPassed: number;
  if (isBefore(periodEnd, now)) {
      daysPassed = totalDaysInPeriod;
  } else if (isAfter(periodStart, now)) {
      daysPassed = 1;
  } else {
      daysPassed = differenceInDays(now, periodStart) + 1;
  }
  if (daysPassed <= 0) daysPassed = 1;
  const daysRemaining = Math.max(totalDaysInPeriod - daysPassed, 0);

  // 只看「變動支出」——固定支出(房租/電信/保費...)常常是月初一次整筆扣款(不是分散在
  // 整個月慢慢花)，用「到今天應該花多少」這種按天數比例推算的邏輯去比對，扣款當天就會
  // 被誤判成大幅超支，這不是真的異常，只是這套配速邏輯本來就不適合用在「一次整筆扣款」
  // 的固定支出上（2026-07-23 Ivy實測時發現電信費多收$1，順勢指出這點）。
  // 也排除代購/工作代墊/借貸(specialTag)——那不是Ivy自己的消費，不該算進超支警示。
  const currentSpentByL2: Record<string, number> = {};
  currentPeriodTransactions.forEach(t => {
    if (!isPersonalConsumption(t) || t.category.l1 !== L1Category.VARIABLE) return;
    const l2 = t.category.l2;
    if (!l2) return;
    currentSpentByL2[l2] = (currentSpentByL2[l2] || 0) + t.amount;
  });

  Object.entries(categoryBudgets).forEach(([l2, monthlyBudget]) => {
    if (!monthlyBudget || monthlyBudget <= 0) return;

    const expectedToDate = monthlyBudget * (daysPassed / totalDaysInPeriod);
    if (expectedToDate < PACING_MIN_AMOUNT) return; // 太小的預算不列入偵測

    const actual = currentSpentByL2[l2] || 0;
    if (actual <= expectedToDate * PACING_WARNING_MULTIPLIER) return;

    const percent = (actual / expectedToDate) * 100;
    const isCritical = actual > expectedToDate * PACING_CRITICAL_MULTIPLIER;
    const remainingBudget = Math.max(monthlyBudget - actual, 0);
    const suggestionText = daysRemaining > 0
      ? (remainingBudget > 0
          ? `本月剩${daysRemaining}天，照你設定的預算還可以花$${Math.round(remainingBudget).toLocaleString()}，建議接下來每天控制在$${Math.round(remainingBudget / daysRemaining).toLocaleString()}以內。`
          : `本月剩${daysRemaining}天，已經超過你設定的月預算了，建議這個類別先暫停消費。`)
      : `這期間已經結束，實際花了預算的${Math.round(percent)}%。`;

    alerts.push({
      id: `pacing-${l2}`,
      level: isCritical ? 'critical' : 'warning',
      message: `${l2}這個月已經花到你設定預算的${Math.round(percent)}%（$${Math.round(actual).toLocaleString()}，月預算$${Math.round(monthlyBudget).toLocaleString()}）。${suggestionText}`,
      metric: l2,
      value: actual,
      threshold: expectedToDate,
    });
  });

  return alerts.sort((a, b) => (b.value / b.threshold) - (a.value / a.threshold));
};

export interface CategoryBudgetSuggestion {
  l2: string;
  recentMedian: number;   // 近期基準（最近幾個月的月度中位數，見BUDGET_SUGGESTION_RECENT_MONTHS）
  overallMedian: number;  // 長期基準（全部歷史的月度中位數）
  monthsOfHistory: number;
}

// 分類預算建議：只給參考數字，不自動套用——近期/長期分開列出，讓Ivy自己判斷「最近的習慣
// 是不是跟長期不一樣」再決定要設多少，不是系統關起門幫她決定。只對變動支出(Variable)
// 開放，固定支出金額通常已經接近固定，不需要「預算」這種概念。
export const suggestCategoryBudgets = (allTransactions: Transaction[]): CategoryBudgetSuggestion[] => {
  const monthlyByL2: Record<string, Record<string, number>> = {};
  allTransactions.forEach(t => {
    if (!isPersonalConsumption(t) || t.category.l1 !== L1Category.VARIABLE) return;
    const l2 = t.category.l2;
    if (!l2) return;
    const monthKey = format(parseISO(t.date), 'yyyy-MM');
    if (!monthlyByL2[l2]) monthlyByL2[l2] = {};
    monthlyByL2[l2][monthKey] = (monthlyByL2[l2][monthKey] || 0) + t.amount;
  });

  const median = (vals: number[]): number => {
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const results: CategoryBudgetSuggestion[] = [];
  Object.entries(monthlyByL2).forEach(([l2, months]) => {
    const monthKeys = Object.keys(months).sort();
    if (monthKeys.length < BUDGET_SUGGESTION_MIN_HISTORY_MONTHS) return; // 樣本太少，建議值容易誤導

    const overallMedian = median(Object.values(months));
    const recentKeys = monthKeys.slice(-BUDGET_SUGGESTION_RECENT_MONTHS);
    const recentMedian = median(recentKeys.map(k => months[k]));

    results.push({ l2, recentMedian, overallMedian, monthsOfHistory: monthKeys.length });
  });

  return results.sort((a, b) => b.overallMedian - a.overallMedian);
};

// 長期預留支出：算出「平均每個月應該為這些週期性大額支出多存多少錢」（每次繳費金額
// 除以繳費週期月數再加總）。不追蹤精確到期日——真實資料完全不夠推算(保險費用全部歷史
// 只出現過1筆)，這裡採用比較保守可靠的「每月均攤」版本，見PROJECT_STATUS.md說明。
export const calculateLongTermReserveMonthly = (reserves: LongTermReserve[]): number => {
  return reserves.reduce((sum, r) => sum + (r.frequencyMonths > 0 ? r.amount / r.frequencyMonths : 0), 0);
};

export const calculateProjectedPenalty = (
    transactions: Transaction[],
    budgets: Budget[],
    config: PenaltyConfig
): { isOverspent: boolean; overage: number; penaltyAmount: number } => {
    
    if (!config.enabled) return { isOverspent: false, overage: 0, penaltyAmount: 0 };

    const variableSpending = transactions
        .filter(t => isPersonalConsumption(t) && t.category.l1 === L1Category.VARIABLE)
        .reduce((sum, t) => sum + t.amount, 0);

    const variableBudget = budgets.find(b => b.l1 === L1Category.VARIABLE)?.amount || 0;

    if (variableSpending > variableBudget) {
        const overage = variableSpending - variableBudget;
        const penaltyAmount = overage * config.ratio;
        return { isOverspent: true, overage, penaltyAmount };
    }

    return { isOverspent: false, overage: 0, penaltyAmount: 0 };
};

export const validateSplit = (originalAmount: number, splits: { amount: number }[]): boolean => {
  const originalCents = toCents(originalAmount);
  const splitSumCents = splits.reduce((acc, curr) => acc + toCents(curr.amount), 0);
  return Math.abs(originalCents - splitSumCents) < 1; 
};

export const calculateSuggestedBudget = (historyTransactions: Transaction[]): Budget[] => {
    const sums: Record<string, number> = {
        [L1Category.FIXED]: 0,
        [L1Category.VARIABLE]: 0,
        [L1Category.INVESTMENT]: 0,
        [L1Category.INCOME]: 0,
    };
    
    historyTransactions.forEach(t => {
        if (isPersonalConsumption(t)) {
            sums[t.category.l1] += t.amount;
        }
    });

    return Object.entries(sums)
        .filter(([l1]) => l1 !== L1Category.INCOME)
        .map(([l1, amount]) => ({
            l1: l1 as L1Category,
            amount: parseFloat((amount * 0.9).toFixed(2)) 
        }));
};

export const analyzeFinancialHealth = (transactions: Transaction[]) => {
  const income = transactions
    .filter(t => t.type === 'income')
    .reduce((acc, t) => acc + t.amount, 0);

  const expenses = {
    [L1Category.FIXED]: 0,
    [L1Category.VARIABLE]: 0,
    [L1Category.INVESTMENT]: 0
  };

  transactions.filter(isPersonalConsumption).forEach(t => {
    if (expenses[t.category.l1 as keyof typeof expenses] !== undefined) {
      expenses[t.category.l1 as keyof typeof expenses] += t.amount;
    }
  });

  const safeIncome = income || 1; 

  return {
    totalIncome: income,
    ratios: {
      fixed: (expenses[L1Category.FIXED] / safeIncome) * 100,
      variable: (expenses[L1Category.VARIABLE] / safeIncome) * 100,
      investment: (expenses[L1Category.INVESTMENT] / safeIncome) * 100,
    },
    dtiRatio: (expenses[L1Category.FIXED] / safeIncome) * 100,
    variableAmount: expenses[L1Category.VARIABLE]
  };
};

// 季節性支出趨勢：只算「變動支出」，回傳最近12個月，每個月的金額+相對強度(0~1)。
// 2026-07-23 修好一個bug：intensity（長條高度）原本是拿最近24個月裡最高的那個月當基準，
// 但畫面只顯示最近12個月——如果真正的最高月份剛好在13~24個月前（畫面外），
// 顯示出來的12條長條全部會被壓得偏矮，看起來都不嚴重。改成直接只算最近12個月，
// 基準值跟顯示範圍一致。
export const getSeasonalTrends = (allTransactions: Transaction[]) => {
  const monthlyData: Record<string, number> = {};

  const variableTxs = allTransactions.filter(
    t => isPersonalConsumption(t) && t.category.l1 === L1Category.VARIABLE
  );

  variableTxs.forEach(t => {
    const date = parseISO(t.date);
    const key = format(date, 'yyyy-MM');
    monthlyData[key] = (monthlyData[key] || 0) + t.amount;
  });

  const result = [];
  const now = new Date();
  let maxAmount = 0;

  for (let i = 11; i >= 0; i--) {
    const d = subMonths(now, i);
    const key = format(d, 'yyyy-MM');
    const amount = monthlyData[key] || 0;
    if (amount > maxAmount) maxAmount = amount;

    result.push({
      date: d,
      label: format(d, 'M'),
      fullLabel: format(d, 'yyyy年M月'),
      amount,
      intensity: 0
    });
  }

  return result.map(item => ({
    ...item,
    intensity: maxAmount > 0 ? (item.amount / maxAmount) : 0
  }));
};

export interface AnomalyTransaction extends Transaction {
  avgAmount: number;
  diffPercent: number;
}

export const analyzeL3Anomalies = (
  currentTransactions: Transaction[], 
  allTransactions: Transaction[]
): AnomalyTransaction[] => {
  const anomalies: AnomalyTransaction[] = [];
  const historyMap: Record<string, { sum: number; count: number }> = {};
  
  allTransactions.forEach(t => {
      if (!isPersonalConsumption(t)) return;
      const key = `${t.category.l2}-${t.category.l3}`;
      if (!historyMap[key]) historyMap[key] = { sum: 0, count: 0 };
      historyMap[key].sum += t.amount;
      historyMap[key].count += 1;
  });

  currentTransactions.forEach(t => {
      if (!isPersonalConsumption(t)) return;
      const key = `${t.category.l2}-${t.category.l3}`;
      const history = historyMap[key];

      if (history && history.count > ANOMALY_MIN_HISTORY_COUNT) {
          const avg = history.sum / history.count;
          if (t.amount > avg * ANOMALY_AMOUNT_MULTIPLIER && t.amount > ANOMALY_MIN_AMOUNT) {
              anomalies.push({
                  ...t,
                  avgAmount: avg,
                  diffPercent: ((t.amount - avg) / avg) * 100
              });
          }
      }
  });

  return anomalies.sort((a, b) => (b.amount - b.avgAmount) - (a.amount - a.avgAmount)).slice(0, 5);
};

export interface FrequencyAlert {
  l2: string;
  currentCount: number;
  avgCount: number;
  percent: number;
}

export const analyzeL2Frequency = (
  currentTransactions: Transaction[],
  allTransactions: Transaction[],
  currentDateAnchor: Date
): FrequencyAlert[] => {
  const alerts: FrequencyAlert[] = [];
  const currentCounts: Record<string, number> = {};
  
  currentTransactions.forEach(t => {
      if (isPersonalConsumption(t) && t.category.l1 === L1Category.VARIABLE) {
          currentCounts[t.category.l2] = (currentCounts[t.category.l2] || 0) + 1;
      }
  });

  const historyCounts: Record<string, Record<string, number>> = {};
  const startAnalysisDate = subMonths(startOfMonth(currentDateAnchor), FREQUENCY_HISTORY_MONTHS);
  const endAnalysisDate = endOfMonth(subMonths(currentDateAnchor, 1)); 

  allTransactions.forEach(t => {
      if (isPersonalConsumption(t) && t.category.l1 === L1Category.VARIABLE) {
          const tDate = parseISO(t.date);
          if (isAfter(tDate, startAnalysisDate) && isBefore(tDate, endAnalysisDate)) {
              const monthKey = format(tDate, 'yyyy-MM');
              if (!historyCounts[t.category.l2]) historyCounts[t.category.l2] = {};
              historyCounts[t.category.l2][monthKey] = (historyCounts[t.category.l2][monthKey] || 0) + 1;
          }
      }
  });

  Object.keys(currentCounts).forEach(l2 => {
      const current = currentCounts[l2];
      const history = historyCounts[l2];
      
      let avg = 0;
      if (history) {
          const months = Object.keys(history).length;
          const totalHistory = Object.values(history).reduce((a, b) => a + b, 0);
          avg = months > 0 ? totalHistory / FREQUENCY_HISTORY_MONTHS : 0;
      }

      if (avg > 0 && current > avg * FREQUENCY_MULTIPLIER && current > FREQUENCY_MIN_COUNT) {
          alerts.push({
              l2,
              currentCount: current,
              avgCount: avg,
              percent: ((current - avg) / avg) * 100
          });
      }
  });

  return alerts.sort((a, b) => b.percent - a.percent);
};

export const getCategoryBreakdown = (transactions: Transaction[], type: 'income' | 'expense', l1Filter?: L1Category) => {
    const map: Record<string, { amount: number; l3Map: Record<string, number> }> = {};

    transactions.forEach(t => {
        if (t.type !== type) return;
        // 代購/工作代墊/借貸(specialTag)不是Ivy自己的真實收入/支出，兩種方向都要排除，
        // 不然「借廖妤甄$500」會混進支出排行榜、「廖妤甄還$500」會混進收入來源分析——
        // 這裡跟isPersonalConsumption()同一個原則，但那個helper只認expense，這裡income/
        // expense都要擋，所以直接檢查specialTag本身。
        if (t.specialTag) return;
        if (l1Filter && t.category.l1 !== l1Filter) return;

        if (!map[t.category.l2]) map[t.category.l2] = { amount: 0, l3Map: {} };
        map[t.category.l2].amount += t.amount;
        map[t.category.l2].l3Map[t.category.l3] = (map[t.category.l2].l3Map[t.category.l3] || 0) + t.amount;
    });

    return Object.entries(map)
        .map(([l2, data]) => ({
            l2,
            amount: data.amount,
            l3Breakdown: Object.entries(data.l3Map)
                .map(([l3, amt]) => ({ l3, amount: amt }))
                .sort((a, b) => b.amount - a.amount)
        }))
        .sort((a, b) => b.amount - a.amount);
};

export interface CategoryPieSlice {
  name: string;
  amount: number;
  percent: number; // 0~100
  topMerchant: string | null;   // 這一塊裡面金額最高的商家/店家（"其他"整併塊沒有這個資訊，會是null）
  topMerchantAmount: number;
  topMerchantCount: number;     // 那個商家在這一塊裡出現幾筆
}

type MerchantTally = Record<string, { amount: number; count: number }>;

const addToMerchantTally = (tally: MerchantTally, merchant: string, amount: number) => {
  if (!tally[merchant]) tally[merchant] = { amount: 0, count: 0 };
  tally[merchant].amount += amount;
  tally[merchant].count += 1;
};

const topMerchantFrom = (tally: MerchantTally) => {
  let top: { name: string; amount: number; count: number } | null = null;
  Object.entries(tally).forEach(([name, data]) => {
    if (!top || data.amount > top.amount) top = { name, amount: data.amount, count: data.count };
  });
  return top;
};

const mergeMerchantTally = (target: MerchantTally, source: MerchantTally) => {
  Object.entries(source).forEach(([name, data]) => {
    if (!target[name]) target[name] = { amount: 0, count: 0 };
    target[name].amount += data.amount;
    target[name].count += data.count;
  });
};

// 貓咪指揮中心開頭的分類比率圓餅圖：用L2次分類分塊（不是Fixed/Variable/Investment那個大類），
// 如果某個L3細項自己就佔了全部支出很大一塊（超過PIE_L3_PROMOTE_THRESHOLD），
// 從它所屬的L2塊拆出來單獨顯示一塊，方便看出「其實是某個具體東西買太多」，
// 而不是被埋在一個大分類裡看不出來（例如「飲料」從「餐飲食品」拆出來）。
// 每一塊都會標出裡面金額最高的商家/店家（連同出現次數），讓Ivy一眼看出這塊主要是被
// 什麼撐起來的。塊數超過PIE_MAX_SLICES會把剩下的合併成「其他」，一方面避免圓餅圖
// 被塞成幾十塊看不清楚，一方面確保配色不會重複用完。
export const getCategoryPieData = (transactions: Transaction[]): CategoryPieSlice[] => {
  const expenseTxs = transactions.filter(isPersonalConsumption);
  const total = expenseTxs.reduce((sum, t) => sum + t.amount, 0);
  if (total <= 0) return [];

  // 三層彙總：L2 -> L3 -> 商家，才能同時判斷「L3要不要拆出來」跟「這一塊裡面誰花最多」。
  const l2Map: Record<string, { amount: number; l3Map: Record<string, { amount: number; merchants: MerchantTally }> }> = {};

  expenseTxs.forEach(t => {
    const l2 = t.category.l2 || '未分類';
    const l3 = t.category.l3 || '';
    const merchant = t.merchant || '未知商家';
    if (!l2Map[l2]) l2Map[l2] = { amount: 0, l3Map: {} };
    l2Map[l2].amount += t.amount;
    if (!l2Map[l2].l3Map[l3]) l2Map[l2].l3Map[l3] = { amount: 0, merchants: {} };
    l2Map[l2].l3Map[l3].amount += t.amount;
    addToMerchantTally(l2Map[l2].l3Map[l3].merchants, merchant, t.amount);
  });

  const slices: CategoryPieSlice[] = [];

  Object.entries(l2Map).forEach(([l2, l2Data]) => {
    const remainderMerchants: MerchantTally = {};
    let remainderAmount = 0;

    Object.entries(l2Data.l3Map).forEach(([l3, l3Data]) => {
      if (l3 && l3Data.amount / total >= PIE_L3_PROMOTE_THRESHOLD) {
        const top = topMerchantFrom(l3Data.merchants);
        slices.push({
          name: l3, amount: l3Data.amount, percent: (l3Data.amount / total) * 100,
          topMerchant: top?.name ?? null, topMerchantAmount: top?.amount ?? 0, topMerchantCount: top?.count ?? 0,
        });
      } else {
        remainderAmount += l3Data.amount;
        mergeMerchantTally(remainderMerchants, l3Data.merchants);
      }
    });

    if (remainderAmount > 0) {
      const top = topMerchantFrom(remainderMerchants);
      slices.push({
        name: l2, amount: remainderAmount, percent: (remainderAmount / total) * 100,
        topMerchant: top?.name ?? null, topMerchantAmount: top?.amount ?? 0, topMerchantCount: top?.count ?? 0,
      });
    }
  });

  slices.sort((a, b) => b.amount - a.amount);

  if (slices.length > PIE_MAX_SLICES) {
    const visible = slices.slice(0, PIE_MAX_SLICES);
    const restAmount = slices.slice(PIE_MAX_SLICES).reduce((sum, s) => sum + s.amount, 0);
    visible.push({ name: '其他', amount: restAmount, percent: (restAmount / total) * 100, topMerchant: null, topMerchantAmount: 0, topMerchantCount: 0 });
    return visible;
  }

  return slices;
};

export interface RecurringExpense {
  merchant: string;
  monthsPresent: number;
  monthsSpan: number;
  medianAmount: number;
  lastDate: string;
}

// 固定週期性支出偵測：不是看「分類=固定支出」（那是使用者手動選的），
// 而是看「行為模式」——這個商家幾乎每個月都出現一次，就算分類是變動支出
// （例如訂閱制的遊戲特權卡）也算，抓出來給使用者一個「這些錢幾乎跑不掉」的清單參考。
export const detectRecurringExpenses = (allTransactions: Transaction[]): RecurringExpense[] => {
  const byMerchant: Record<string, { months: Record<string, number>; lastDate: string }> = {};

  allTransactions.forEach(t => {
    if (!isPersonalConsumption(t) || !t.merchant) return;
    const monthKey = format(parseISO(t.date), 'yyyy-MM');
    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = { months: {}, lastDate: t.date };
    byMerchant[t.merchant].months[monthKey] = (byMerchant[t.merchant].months[monthKey] || 0) + t.amount;
    if (t.date > byMerchant[t.merchant].lastDate) byMerchant[t.merchant].lastDate = t.date;
  });

  const results: RecurringExpense[] = [];

  const currentMonthKey = format(new Date(), 'yyyy-MM');

  Object.entries(byMerchant).forEach(([merchant, data]) => {
    const monthKeys = Object.keys(data.months).sort();
    if (monthKeys.length < RECURRING_MIN_HISTORY_MONTHS) return;

    // 最近2個月都沒出現過，就不算「還在持續」的週期性支出（避免已經停掉的訂閱還被列出來）。
    const monthsSinceLast = differenceInMonths(parseISO(currentMonthKey + '-01'), parseISO(monthKeys[monthKeys.length - 1] + '-01'));
    if (monthsSinceLast > 1) return;

    const firstMonth = monthKeys[0];
    const monthsSpan = differenceInMonths(parseISO(currentMonthKey + '-01'), parseISO(firstMonth + '-01')) + 1;
    const coverage = monthKeys.length / Math.max(monthsSpan, 1);
    if (coverage < RECURRING_MONTH_COVERAGE_RATIO) return;

    const amounts = Object.values(data.months).sort((a, b) => a - b);
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 === 0 ? (amounts[mid - 1] + amounts[mid]) / 2 : amounts[mid];

    // 只看「出現在幾成的月份」還不夠——像「常去一陣子的飲料店」「常搭但次數金額都不固定
    // 的公車」也會通過上面的涵蓋率檢查，但每個月的金額差異很大，不是真的「固定」。
    // 真正的固定週期性支出(訂閱制)大部分月份金額應該落在中位數附近，偶爾才會因為加購/
    // 折扣有出入。用真實資料校準過這個門檻（見financialRules.ts的說明）。
    const consistentCount = amounts.filter(a =>
      a >= median * (1 - RECURRING_AMOUNT_BAND_RATIO) && a <= median * (1 + RECURRING_AMOUNT_BAND_RATIO)
    ).length;
    if (consistentCount / amounts.length < RECURRING_MIN_CONSISTENT_RATIO) return;

    results.push({ merchant, monthsPresent: monthKeys.length, monthsSpan, medianAmount: median, lastDate: data.lastDate });
  });

  return results.sort((a, b) => b.medianAmount - a.medianAmount);
};

export const findSimilarTransactions = (
    target: Transaction, 
    allTransactions: Transaction[]
): Transaction[] => {
    const targetName = target.merchant.trim().toLowerCase();
    if (targetName.length < 2 || targetName === 'manual add') return [];

    return allTransactions.filter(t => {
        if (t.id === target.id) return false;
        if (t.type !== target.type) return false;
        if (target.amount === 0) {
             if (t.amount !== 0) return false; 
        } else {
             const diffPercent = Math.abs(t.amount - target.amount) / target.amount;
             if (diffPercent > 0.1) return false;
        }
        // 2026-07-27 Ivy反應：商家名稱／完整分類(含細項)其實已經跟target一模一樣時，
        // 套用這次修改等於沒有任何看得到的變化，卻還是跳出來問「要不要套用」，
        // 讓人搞不懂到底要確認什麼。這種「改了也沒差」的候選直接排除，不再拿出來問。
        const alreadyIdentical = t.merchant.trim() === target.merchant.trim()
            && t.category.l1 === target.category.l1
            && t.category.l2 === target.category.l2
            && t.category.l3 === target.category.l3;
        if (alreadyIdentical) return false;

        const candidateName = t.merchant.trim().toLowerCase();
        const nameMatch = targetName.includes(candidateName) || candidateName.includes(targetName);
        const targetRaw = (target.originalText || '').toLowerCase();
        const candidateRaw = (t.originalText || '').toLowerCase();
        // "manual add"是每一筆手動新增交易共用的通用佔位字串(不是真的抽自同一份來源文件)，
        // 完全比對不到任何實際內容，卻會讓任兩筆手動新增的交易永遠rawMatch成立——
        // 2026-08-03 Ivy改「借廖妤甄」的分類時，就被兩筆完全不相關、只是同樣手動新增的
        // 舊交易(蝦皮$529、肯德基$455)誤判成「相似交易」跳出來問。這個佔位字串要排除，
        // 不能拿來當「同一份原始資料」的證據。
        const rawMatch = targetRaw !== 'manual add' && candidateRaw !== 'manual add' &&
                         ((targetRaw.length > 3 && candidateRaw.includes(targetRaw)) ||
                         (candidateRaw.length > 3 && targetRaw.includes(candidateRaw)));
        return nameMatch || rawMatch;
    });
};

// 對帳模組用：拿銀行原始描述文字去查商家別名候選清單。故意不用額外的模糊比對套件，
// 沿用上面findSimilarTransactions一樣的「小寫子字串包含」比對風格。
// 回傳的candidates只有1筆時UI才能自動帶入，2筆以上一定要列清單讓使用者選——
// 這裡完全不做「挑一個最像的」判斷，判斷權留給使用者。
export const findMerchantAliasCandidates = (
    rawDescription: string | undefined,
    aliases: MerchantAlias[],
    accountId?: string
): MerchantAliasCandidate[] => {
    const raw = (rawDescription || '').trim().toLowerCase();
    if (raw.length < 2) return [];

    // 帳戶限定的別名優先於不限帳戶的別名（同樣代碼在不同銀行可能對應不同店）
    const scoped = aliases.filter(a => !a.accountId || a.accountId === accountId);

    const exact = scoped.find(a => a.officialPattern.trim().toLowerCase() === raw);
    if (exact) return exact.candidates;

    const fuzzyMatches = scoped.filter(a => {
        const pattern = a.officialPattern.trim().toLowerCase();
        return pattern.length > 1 && (raw.includes(pattern) || pattern.includes(raw));
    });
    if (fuzzyMatches.length === 0) return [];

    // 子字串比對可能同時命中好幾筆別名紀錄，合併候選清單（同商家名稱的次數加總），
    // 不要武斷選其中一筆別名紀錄當唯一依據。
    const merged = new Map<string, number>();
    fuzzyMatches.forEach(a => a.candidates.forEach(c => {
        merged.set(c.userMerchant, (merged.get(c.userMerchant) || 0) + c.count);
    }));
    return Array.from(merged.entries())
        .map(([userMerchant, count]) => ({ userMerchant, count }))
        .sort((a, b) => b.count - a.count);
};

// 願望清單（2026-07-21重新設計，取代舊的「夢想目標/存錢進度」）：
// 這個App本質是記帳，使用者沒有另外做「存錢」的動作，所有錢就是帳戶餘額本身，
// 所以不追蹤「存了多少」，而是追蹤「想買的東西，現在的餘額夠不夠、還差多少」。
// 可動用餘額 = 現金+金融卡(bank_debit)總餘額 − 日常開銷保留 − 緊急預備金 − 排在前面、還沒買的項目金額。
// items 陣列的順序＝優先順序（index 0 最優先），分配時先扣優先項目的錢。
export interface WishlistItemMetrics {
    totalLiquidBalance: number;      // 現金+金融卡總餘額（電子支付/儲值卡/信用卡不算）
    reservedByEarlierItems: number;  // 排在前面、還沒買的項目已經佔用掉多少
    availableForThisItem: number;    // 扣掉保留水位跟前面項目後，這個項目能動用的錢
    shortfall: number;               // 還差多少，0代表夠了
    canAffordNow: boolean;
    daysRemaining?: number;          // 有設targetDate才有
    isOverdue?: boolean;
}

export interface WishlistMetricsResult {
    totalLiquidBalance: number; // 現金+金融卡總餘額，跟清單裡有沒有項目無關，隨時都能算
    dailyBuffer: number;        // 即時計算出來的日常開銷保留（見calculateSuggestedReserves）
    emergencyFund: number;      // 即時計算出來的緊急預備金
    items: Record<string, WishlistItemMetrics>;
}

export const calculateWishlistMetrics = (
    items: WishlistItem[],
    accounts: Account[],
    allTransactions: Transaction[],
    longTermReserves: LongTermReserve[] = [],
): WishlistMetricsResult => {
    // 只算現金＋金融卡帳戶（bank_debit），電子支付錢包/儲值卡/信用卡不算「可以拿來買大東西」的錢
    const liquidAccounts = accounts.filter(a => !a.isArchived && (a.type === 'cash' || a.type === 'bank_debit'));
    const balances = calculateAccountBalances(liquidAccounts, allTransactions);
    const totalLiquidBalance = liquidAccounts.reduce((sum, a) => sum + (balances[a.id] || 0), 0);

    // 2026-08-13改成即時計算：Ivy指出「日常開銷保留/緊急預備金」存成一個固定數字、要手動點
    // 「套用」才更新沒有意義——這個理想數字本來就會隨消費歷史/長期預留支出天天變化，存一個
    // 靜態快照只會愈放愈舊。改成每次都用calculateSuggestedReserves現算，不再有獨立的手動輸入值。
    const { dailyBuffer, emergencyFund } = calculateSuggestedReserves(allTransactions, longTermReserves);

    const now = new Date();
    const result: Record<string, WishlistItemMetrics> = {};
    let reservedByEarlierItems = 0;

    for (const item of items) {
        if (item.isPurchased) {
            // 已買的項目不再佔用可動用餘額，但仍給一組metrics方便畫面顯示歷史紀錄
            result[item.id] = {
                totalLiquidBalance, reservedByEarlierItems, availableForThisItem: 0,
                shortfall: 0, canAffordNow: true,
            };
            continue;
        }
        const availableForThisItem = totalLiquidBalance - dailyBuffer - emergencyFund - reservedByEarlierItems;
        const shortfall = Math.max(0, item.targetAmount - availableForThisItem);
        const metrics: WishlistItemMetrics = {
            totalLiquidBalance,
            reservedByEarlierItems,
            availableForThisItem,
            shortfall,
            canAffordNow: shortfall === 0,
        };
        if (item.targetDate) {
            const targetDate = parseISO(item.targetDate);
            metrics.isOverdue = isAfter(now, targetDate);
            metrics.daysRemaining = metrics.isOverdue ? 0 : differenceInDays(targetDate, now);
        }
        result[item.id] = metrics;
        reservedByEarlierItems += item.targetAmount;
    }

    return { totalLiquidBalance, dailyBuffer, emergencyFund, items: result };
};

// 幫使用者抓一個「不會太緊迫」的日常開銷保留／緊急預備金建議值：
// 用最近12個月的固定+變動支出算中位數（比平均值更不受單月爆買影響）當「一般月份」代表值，
// 日常開銷保留 = 1.5個月，緊急預備金 = 3個月。
export const calculateSuggestedReserves = (allTransactions: Transaction[], longTermReserves: LongTermReserve[] = []): { monthlyBaseline: number; dailyBuffer: number; emergencyFund: number } => {
    const now = new Date();
    const monthlyTotals: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
        monthlyTotals[format(subMonths(now, i), 'yyyy-MM')] = 0;
    }
    allTransactions.forEach(t => {
        if (t.type !== 'expense') return;
        // 2026-08-13補：代購/工作代墊/借貸(specialTag)不是Ivy自己的真實支出，這裡漏了
        // 排除——跟Dashboard淨現金流那次修的是同一個原則，只是這個函式當時沒有一起改到。
        if (t.specialTag) return;
        if (t.category.l1 !== L1Category.FIXED && t.category.l1 !== L1Category.VARIABLE) return;
        const key = format(parseISO(t.date), 'yyyy-MM');
        if (key in monthlyTotals) monthlyTotals[key] += t.amount;
    });
    const values = Object.values(monthlyTotals).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const monthlyBaseline = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    // 2026-08-11新增：年繳/半年繳這種大額但低頻率的支出（保險費/稅務規費等），只在12個月裡
    // 出現1-2次，取中位數時幾乎完全被稀釋掉，導致日常開銷保留看起來比實際能安心花的還多。
    // 加上這些長期預留支出的月均攤金額，確保帳單到期時不會拿不出錢（見calculateLongTermReserveMonthly）。
    const longTermReserveMonthly = calculateLongTermReserveMonthly(longTermReserves);
    return {
        monthlyBaseline,
        dailyBuffer: Math.round((monthlyBaseline + longTermReserveMonthly) * 1.5),
        emergencyFund: Math.round(monthlyBaseline * 3),
    };
};

export const applyHistoricalCategory = (newTx: Transaction, history: Transaction[]): Transaction => {
    if (!newTx.merchant) return newTx;
    const targetName = newTx.merchant.trim().toLowerCase();
    const matches = history.filter(t => t.merchant.trim().toLowerCase() === targetName);
    if (matches.length > 0) {
        matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const bestMatch = matches[0];
        return {
            ...newTx,
            type: bestMatch.type,
            category: {
                l1: bestMatch.category.l1,
                l2: bestMatch.category.l2,
                l3: bestMatch.category.l3 || '' 
            },
            isVerified: true 
        };
    }
    return newTx;
};

// 盒鬚圖法(IQR)排除離群值：超過 Q3 + RUNWAY_OUTLIER_IQR_MULTIPLIER×IQR 的金額視為極端值。
// 樣本數太少時四分位數沒有統計意義，直接原樣返回、不做排除。
const excludeOutliers = (amounts: number[]): number[] => {
    if (amounts.length < RUNWAY_OUTLIER_MIN_SAMPLE_SIZE) return amounts;
    const sorted = [...amounts].sort((a, b) => a - b);
    const quartile = (p: number): number => {
        const pos = (sorted.length - 1) * p;
        const base = Math.floor(pos);
        const rest = pos - base;
        return sorted[base + 1] !== undefined
            ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
            : sorted[base];
    };
    const iqr = quartile(0.75) - quartile(0.25);
    const upperBound = quartile(0.75) + RUNWAY_OUTLIER_IQR_MULTIPLIER * iqr;
    return amounts.filter(a => a <= upperBound);
};

// 現金緩衝耗盡預警(Runway)：估算「照最近的燒錢速度，手上真的能動用的錢還能撐幾天」。
// 2026-07-23重新設計（Ivy確認）：
// - 餘額改用「可動用餘額」(現金+金融卡帳戶的真實餘額，沿用calculateWishlistMetrics
//   已經在用的定義)，不再用「全部收入減全部支出」這種混算所有帳戶(含信用卡/電子
//   支付/儲值卡)的虛擬數字——後者算出來的不是真的能花的錢。
// - 燒錢速度改成固定支出+變動支出一起算，不再只看變動支出——房租水電這些固定支出
//   一樣會讓現金變少，只算變動支出會低估真實燒錢速度、高估還能撐幾天。
// 2026-08-26新增：算日均燒錢速度前先用IQR排除單筆極端值(見上方excludeOutliers)，
// 避免一次繳一整年保費、買筆電這種罕見大額支出把「還能撐幾天」嚴重低估。
export const calculateRunway = (allTransactions: Transaction[], accounts: Account[]) => {
    const liquidAccounts = accounts.filter(a => !a.isArchived && (a.type === 'cash' || a.type === 'bank_debit'));
    const balances = calculateAccountBalances(liquidAccounts, allTransactions);
    const currentBalance = Math.max(liquidAccounts.reduce((sum, a) => sum + (balances[a.id] || 0), 0), 0);

    const now = new Date();
    const windowStart = subDays(now, RUNWAY_ANALYSIS_WINDOW_DAYS);
    const recentExpenseAmounts = allTransactions
        .filter(t => {
            const d = parseISO(t.date);
            return t.type === 'expense'
                && (t.category.l1 === L1Category.VARIABLE || t.category.l1 === L1Category.FIXED)
                && isAfter(d, windowStart)
                && isBefore(d, now);
        })
        .map(t => t.amount);
    const recentExpenses = excludeOutliers(recentExpenseAmounts).reduce((sum, amount) => sum + amount, 0);
    const firstTxDate = allTransactions.length > 0
        ? allTransactions.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0].date
        : now.toISOString();
    const actualDays = Math.min(RUNWAY_ANALYSIS_WINDOW_DAYS, differenceInDays(now, parseISO(firstTxDate)) + 1);
    const daysDivisor = Math.max(actualDays, 1);
    const dailyBurnRate = recentExpenses / daysDivisor;
    let daysRemaining = 9999;
    let depletionDate: Date | null = null;
    if (dailyBurnRate > 0) {
        daysRemaining = Math.floor(currentBalance / dailyBurnRate);
        if (daysRemaining < 3650) {
            depletionDate = addDays(now, daysRemaining);
        }
    }
    return { currentBalance, dailyBurnRate, daysRemaining, depletionDate };
};

// 即時計算每個帳戶目前的餘額：純粹從所有交易紀錄加總算出來，不用「期初餘額」這種
// 額外欄位——income/expense 用 accountId 記到哪個帳戶，transfer 用 fromAccountId
// 扣、toAccountId 加。前提是這個帳戶「從開始使用這個App起」的交易都有記，數字才會準；
// 如果帳戶本身在使用App之前就已經有錢，這裡算出來的只會是「用了App之後的淨變化」，
// 不是真實餘額——要對到真的餘額，之後靠階段5對帳模組來抓落差，不是靠這個功能。
export const calculateAccountBalances = (accounts: Account[], allTransactions: Transaction[]): Record<string, number> => {
  const balances: Record<string, number> = {};
  accounts.forEach(a => { balances[a.id] = 0; });

  allTransactions.forEach(t => {
    if (t.type === 'income' && t.accountId && balances[t.accountId] !== undefined) {
      balances[t.accountId] = fromCents(toCents(balances[t.accountId]) + toCents(t.amount));
    } else if (t.type === 'expense' && t.accountId && balances[t.accountId] !== undefined) {
      balances[t.accountId] = fromCents(toCents(balances[t.accountId]) - toCents(t.amount));
    } else if (t.type === 'transfer') {
      if (t.fromAccountId && balances[t.fromAccountId] !== undefined) {
        balances[t.fromAccountId] = fromCents(toCents(balances[t.fromAccountId]) - toCents(t.amount));
      }
      if (t.toAccountId && balances[t.toAccountId] !== undefined) {
        balances[t.toAccountId] = fromCents(toCents(balances[t.toAccountId]) + toCents(t.amount));
      }
    }
  });

  return balances;
};
