
import { Transaction, Account, Budget, Alert, L1Category, CATEGORY_LABELS, TimeScope, DateRange, WishlistItem, PenaltyConfig } from '../types';
import { format, getDaysInMonth, getDate, startOfMonth, endOfMonth, addMonths, subMonths, differenceInDays, isAfter, isBefore, startOfDay, endOfDay, parseISO, startOfYear, getMonth, getYear, isSameMonth, differenceInMonths, subDays, addDays } from 'date-fns';
import {
  ALERT_K_FACTOR, ALERT_CRITICAL_THRESHOLD_PERCENT,
  OPPORTUNITY_COST_ANNUAL_RETURN, OPPORTUNITY_COST_YEARS,
  RUNWAY_ANALYSIS_WINDOW_DAYS,
  ANOMALY_MIN_HISTORY_COUNT, ANOMALY_AMOUNT_MULTIPLIER, ANOMALY_MIN_AMOUNT,
  FREQUENCY_HISTORY_MONTHS, FREQUENCY_MULTIPLIER, FREQUENCY_MIN_COUNT,
  CASH_DUPLICATE_CHECK_DAYS, CASH_WITHDRAWAL_KEYWORDS,
  TAX_DEDUCTIBLE_KEYWORDS,
} from '../config/financialRules';

// Precision helper to avoid floating point errors
const toCents = (val: number) => Math.round(val * 100);
const fromCents = (val: number) => val / 100;

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
 * Module III.2: Dynamic Time-Weighted Alert Logic
 */
export const generateTimeWeightedAlerts = (
  transactions: Transaction[], 
  budgets: Budget[],
  periodStart: Date,
  periodEnd: Date,
  kFactor: number = ALERT_K_FACTOR
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

  const spendingByL1: Record<string, number> = {
    [L1Category.FIXED]: 0,
    [L1Category.VARIABLE]: 0,
    [L1Category.INVESTMENT]: 0,
    [L1Category.INCOME]: 0,
  };

  transactions.forEach(t => {
    if (t.type === 'expense') {
      spendingByL1[t.category.l1] = fromCents(toCents(spendingByL1[t.category.l1]) + toCents(t.amount));
    }
  });

  budgets.forEach(budget => {
    if (budget.l1 === L1Category.INCOME) return;

    const currentSpent = spendingByL1[budget.l1];
    const totalBudget = budget.amount;
    const categoryName = CATEGORY_LABELS[budget.l1];

    if (totalBudget <= 0) return;

    const currentDailyRate = currentSpent / daysPassed;
    const budgetDailyRate = totalBudget / totalDaysInPeriod;
    
    const threshold = budgetDailyRate * kFactor;

    if (currentDailyRate > threshold) {
      const excessRate = ((currentDailyRate - threshold) / threshold) * 100;
      const isCritical = excessRate > ALERT_CRITICAL_THRESHOLD_PERCENT;
      
      alerts.push({
        id: `alert-${budget.l1}-${Date.now()}`,
        level: isCritical ? 'critical' : 'warning',
        message: isCritical 
          ? `哎呀！${categoryName}的花費速度太快了，目前超標 ${(excessRate).toFixed(1)}%，建議立刻檢視開銷！` 
          : `注意喔，${categoryName}的支出速度比預期快了 ${(excessRate).toFixed(1)}%，要稍微控制一下囉。`,
        metric: categoryName,
        value: currentDailyRate * totalDaysInPeriod, 
        threshold: totalBudget
      });
    }
  });

  return alerts;
};

export const calculateProjectedPenalty = (
    transactions: Transaction[],
    budgets: Budget[],
    config: PenaltyConfig
): { isOverspent: boolean; overage: number; penaltyAmount: number } => {
    
    if (!config.enabled) return { isOverspent: false, overage: 0, penaltyAmount: 0 };

    const variableSpending = transactions
        .filter(t => t.type === 'expense' && t.category.l1 === L1Category.VARIABLE)
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
        if (t.type === 'expense') {
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

  transactions.filter(t => t.type === 'expense').forEach(t => {
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

export const calculateOpportunityCost = (variableSpending: number): number => {
  const r = OPPORTUNITY_COST_ANNUAL_RETURN;
  const n = OPPORTUNITY_COST_YEARS;
  const futureValue = variableSpending * Math.pow((1 + r), n);
  return futureValue - variableSpending;
};

export const getSeasonalTrends = (allTransactions: Transaction[]) => {
  const monthlyData: Record<string, number> = {};
  
  const variableTxs = allTransactions.filter(
    t => t.type === 'expense' && t.category.l1 === L1Category.VARIABLE
  );

  variableTxs.forEach(t => {
    const date = parseISO(t.date);
    const key = format(date, 'yyyy-MM');
    monthlyData[key] = (monthlyData[key] || 0) + t.amount;
  });

  const result = [];
  const now = new Date();
  let maxAmount = 0;

  for (let i = 23; i >= 0; i--) {
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
      if (t.type !== 'expense') return;
      const key = `${t.category.l2}-${t.category.l3}`;
      if (!historyMap[key]) historyMap[key] = { sum: 0, count: 0 };
      historyMap[key].sum += t.amount;
      historyMap[key].count += 1;
  });

  currentTransactions.forEach(t => {
      if (t.type !== 'expense') return;
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
      if (t.type === 'expense' && t.category.l1 === L1Category.VARIABLE) {
          currentCounts[t.category.l2] = (currentCounts[t.category.l2] || 0) + 1;
      }
  });

  const historyCounts: Record<string, Record<string, number>> = {};
  const startAnalysisDate = subMonths(startOfMonth(currentDateAnchor), FREQUENCY_HISTORY_MONTHS);
  const endAnalysisDate = endOfMonth(subMonths(currentDateAnchor, 1)); 

  allTransactions.forEach(t => {
      if (t.type === 'expense' && t.category.l1 === L1Category.VARIABLE) {
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
        const candidateName = t.merchant.trim().toLowerCase();
        const nameMatch = targetName.includes(candidateName) || candidateName.includes(targetName);
        const targetRaw = (target.originalText || '').toLowerCase();
        const candidateRaw = (t.originalText || '').toLowerCase();
        const rawMatch = (targetRaw.length > 3 && candidateRaw.includes(targetRaw)) || 
                         (candidateRaw.length > 3 && targetRaw.includes(candidateRaw));
        return nameMatch || rawMatch;
    });
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
    items: Record<string, WishlistItemMetrics>;
}

export const calculateWishlistMetrics = (
    items: WishlistItem[],
    accounts: Account[],
    allTransactions: Transaction[],
    dailyBuffer: number,
    emergencyFund: number,
): WishlistMetricsResult => {
    // 只算現金＋金融卡帳戶（bank_debit），電子支付錢包/儲值卡/信用卡不算「可以拿來買大東西」的錢
    const liquidAccounts = accounts.filter(a => !a.isArchived && (a.type === 'cash' || a.type === 'bank_debit'));
    const balances = calculateAccountBalances(liquidAccounts, allTransactions);
    const totalLiquidBalance = liquidAccounts.reduce((sum, a) => sum + (balances[a.id] || 0), 0);

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

    return { totalLiquidBalance, items: result };
};

// 幫使用者抓一個「不會太緊迫」的日常開銷保留／緊急預備金建議值：
// 用最近12個月的固定+變動支出算中位數（比平均值更不受單月爆買影響）當「一般月份」代表值，
// 日常開銷保留 = 1.5個月，緊急預備金 = 3個月。
export const calculateSuggestedReserves = (allTransactions: Transaction[]): { monthlyBaseline: number; dailyBuffer: number; emergencyFund: number } => {
    const now = new Date();
    const monthlyTotals: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
        monthlyTotals[format(subMonths(now, i), 'yyyy-MM')] = 0;
    }
    allTransactions.forEach(t => {
        if (t.type !== 'expense') return;
        if (t.category.l1 !== L1Category.FIXED && t.category.l1 !== L1Category.VARIABLE) return;
        const key = format(parseISO(t.date), 'yyyy-MM');
        if (key in monthlyTotals) monthlyTotals[key] += t.amount;
    });
    const values = Object.values(monthlyTotals).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const monthlyBaseline = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return {
        monthlyBaseline,
        dailyBuffer: Math.round(monthlyBaseline * 1.5),
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

export const checkCashDuplicate = (newCashTx: Transaction, history: Transaction[]): boolean => {
    const txDate = parseISO(newCashTx.date);
    const checkStart = subDays(txDate, CASH_DUPLICATE_CHECK_DAYS);
    const checkEnd = addMonths(txDate, 0);
    const potentialMatches = history.filter(t => {
         const tDate = parseISO(t.date);
         if (isBefore(tDate, checkStart) || isAfter(tDate, checkEnd)) return false;
         const name = t.merchant.toLowerCase();
         const isWithdrawal = CASH_WITHDRAWAL_KEYWORDS.some(k => name.includes(k));
         return isWithdrawal;
    });
    return potentialMatches.length > 0;
};

export const calculateRunway = (allTransactions: Transaction[]) => {
    const totalIncome = allTransactions.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
    const totalExpense = allTransactions.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    const currentBalance = Math.max(totalIncome - totalExpense, 0);
    const now = new Date();
    const windowStart = subDays(now, RUNWAY_ANALYSIS_WINDOW_DAYS);
    const recentVariableExpenses = allTransactions
        .filter(t => {
            const d = parseISO(t.date);
            return t.type === 'expense'
                && t.category.l1 === L1Category.VARIABLE
                && isAfter(d, windowStart)
                && isBefore(d, now);
        })
        .reduce((sum, t) => sum + t.amount, 0);
    const firstTxDate = allTransactions.length > 0
        ? allTransactions.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0].date
        : now.toISOString();
    const actualDays = Math.min(RUNWAY_ANALYSIS_WINDOW_DAYS, differenceInDays(now, parseISO(firstTxDate)) + 1);
    const daysDivisor = Math.max(actualDays, 1);
    const dailyBurnRate = recentVariableExpenses / daysDivisor;
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

export const calculateTaxEstimation = (allTransactions: Transaction[]) => {
    const currentYear = new Date().getFullYear();
    const deductibleTxs = allTransactions.filter(t => {
        const tDate = parseISO(t.date);
        if (getYear(tDate) !== currentYear) return false;
        if (t.type !== 'expense') return false;
        const combinedText = (t.merchant + t.category.l2 + t.category.l3).toLowerCase();
        return TAX_DEDUCTIBLE_KEYWORDS.some(k => combinedText.includes(k));
    });
    const totalDeductible = deductibleTxs.reduce((sum, t) => sum + t.amount, 0);
    return { year: currentYear, totalDeductible, count: deductibleTxs.length };
};
