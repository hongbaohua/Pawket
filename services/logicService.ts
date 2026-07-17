
import { Transaction, Budget, Alert, L1Category, CATEGORY_LABELS, TimeScope, DateRange, SavingsGoal, PenaltyConfig } from '../types';
import { format, getDaysInMonth, getDate, startOfMonth, endOfMonth, addMonths, subMonths, differenceInDays, isAfter, isBefore, startOfDay, endOfDay, parseISO, startOfYear, getMonth, getYear, isSameMonth, differenceInMonths, subDays, addDays } from 'date-fns';
import {
  ALERT_K_FACTOR, ALERT_CRITICAL_THRESHOLD_PERCENT,
  OPPORTUNITY_COST_ANNUAL_RETURN, OPPORTUNITY_COST_YEARS,
  RUNWAY_ANALYSIS_WINDOW_DAYS,
  ANOMALY_MIN_HISTORY_COUNT, ANOMALY_AMOUNT_MULTIPLIER, ANOMALY_MIN_AMOUNT,
  FREQUENCY_HISTORY_MONTHS, FREQUENCY_MULTIPLIER, FREQUENCY_MIN_COUNT,
  CASH_DUPLICATE_CHECK_DAYS, CASH_WITHDRAWAL_KEYWORDS,
  TAX_DEDUCTIBLE_KEYWORDS,
  GOAL_CASHFLOW_ANALYSIS_DAYS,
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

export interface GoalMetrics {
    currentProgress: number; 
    smartProgress: number;   
    targetAmount: number;    
    financialPercent: number; 
    timePercent: number;      
    weightedPercent: number;  
    progressPercent: number;  
    rms: number; 
    anc: number; 
    gap: number; 
    isFeasible: boolean; 
    monthsRemaining: number;
}

export const calculateGoalMetrics = (goal: SavingsGoal, allTransactions: Transaction[]): GoalMetrics => {
    const now = new Date();
    const currentDate = now;
    const targetAmount = goal.targetAmount || 1;
    const investmentTxs = allTransactions.filter(t => t.category.l1 === L1Category.INVESTMENT);
    const investmentNet = investmentTxs.reduce((acc, t) => {
        if (t.type === 'expense') return acc + t.amount;
        else return acc - t.amount;
    }, 0);

    const currentProgress = Math.max(0, goal.initialAmount + investmentNet);
    const startDate = goal.startDate ? parseISO(goal.startDate) : subDays(now, 30);
    const targetDate = parseISO(goal.targetDate);
    const monthsDiff = differenceInMonths(targetDate, currentDate);
    const monthsRemaining = Math.max(monthsDiff, 1); 
    const remainingAmount = Math.max(targetAmount - currentProgress, 0);
    const isOverdue = isAfter(currentDate, targetDate);
    const rms = isOverdue ? remainingAmount : (remainingAmount / monthsRemaining);
    const cashflowWindowStart = subDays(currentDate, GOAL_CASHFLOW_ANALYSIS_DAYS);
    const recentTxs = allTransactions.filter(t => {
        const d = parseISO(t.date);
        return isAfter(d, cashflowWindowStart) && isBefore(d, currentDate);
    });
    const totalIncomeWindow = recentTxs.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
    const totalExpenseWindow = recentTxs.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
    // 把窗口內的淨現金流換算成「平均每月」（窗口天數 ÷ 30 天/月）
    const anc = Math.max((totalIncomeWindow - totalExpenseWindow) / (GOAL_CASHFLOW_ANALYSIS_DAYS / 30), 0);
    // smartProgress = actual amount saved (no confusing "excess capacity" addition)
    const smartProgress = currentProgress;

    let financialPercent = (currentProgress / targetAmount) * 100;
    financialPercent = Math.max(0, Math.min(100, financialPercent));

    const totalDays = differenceInDays(targetDate, startDate);
    const daysPassed = differenceInDays(currentDate, startDate);

    let timePercent = 0;
    if (totalDays > 0) {
        timePercent = (daysPassed / totalDays) * 100;
    } else {
        timePercent = isAfter(currentDate, targetDate) ? 100 : 0;
    }
    timePercent = Math.max(0, Math.min(100, timePercent));

    // weightedPercent = actual financial progress (bar reflects real savings %)
    // timePercent kept for coach diagnosis reference only
    const weightedPercent = financialPercent;

    const gap = rms - anc;
    const isFeasible = gap <= 0; 

    return {
        currentProgress,
        smartProgress,
        targetAmount,
        financialPercent,
        timePercent,
        weightedPercent,
        progressPercent: weightedPercent,
        rms,
        anc,
        gap,
        isFeasible,
        monthsRemaining
    };
};

export const calculateGapProjection = (gap: number) => {
    const r = OPPORTUNITY_COST_ANNUAL_RETURN;
    const n = OPPORTUNITY_COST_YEARS;
    const futureValue = gap * Math.pow((1 + r), n);
    return futureValue;
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
