
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertCircle, TrendingUp, Download, Sparkles, TrendingDown, DollarSign, Cat, Smile, Frown, Meh, ArrowRight, PawPrint, Calendar, Settings, X, Check, PiggyBank, ChevronLeft, ChevronRight, ChevronDown, Activity, Zap, Percent, BarChart3, AlertTriangle, Info, ArrowDownRight, ArrowUpRight, Fish, PieChart as PieIcon, Search, Repeat, MousePointer2, Wallet, Target, Rocket, Gavel, Scale, AlertOctagon, Hourglass, Landmark, BrainCircuit, Lightbulb, PartyPopper, Disc, Star, Loader2, Sprout, Leaf, Flame, Trophy } from 'lucide-react';
import { Alert, Transaction, L1Category, CATEGORY_LABELS, TimeScope, SavingsGoal, Budget, PenaltyConfig, STANDARD_CATEGORIES, DateRange } from '../types';
import { addMonths, format, startOfMonth, endOfMonth, startOfDay, endOfDay, isValid, parseISO } from 'date-fns';
import { analyzeFinancialHealth, calculateOpportunityCost, getSeasonalTrends, analyzeL3Anomalies, analyzeL2Frequency, getCategoryBreakdown, calculateGoalMetrics, calculateProjectedPenalty, calculateRunway, calculateTaxEstimation, calculateGapProjection, GoalMetrics, getDateRange } from '../services/logicService';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface DashboardProps {
  alerts: Alert[];
  budgets: Budget[]; 
  transactions: Transaction[]; 
  allTransactions: Transaction[]; 
  goal: SavingsGoal | null; 
  onPrint: () => void;
  timeScope: TimeScope;
  setTimeScope: (scope: TimeScope) => void;
  cycleStartDay: number;
  setCycleStartDay: (day: number) => void;
  dateRangeLabel: string;
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  penaltyConfig: PenaltyConfig;
  setPenaltyConfig: (config: PenaltyConfig) => void;
  customRange: {start: Date, end: Date};
  setCustomRange: (range: {start: Date, end: Date}) => void;
}

const COLORS = ['#FBBF24', '#34D399', '#F472B6', '#A78BFA', '#60A5FA'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const MeowneyGoalBar = ({ 
    metrics, 
    goalName, 
    onActionClick, 
    showGapAction, 
    healthMetrics,
    anomalies,
    freqAlerts
}: { 
    metrics: GoalMetrics, 
    goalName: string, 
    onActionClick: (type: string) => void,
    showGapAction: boolean,
    healthMetrics: any,
    anomalies: any[],
    freqAlerts: any[]
}) => {
    const [displayPercent, setDisplayPercent] = useState(0);
    const prevPercentRef = useRef(0);
    
    useEffect(() => {
        const start = prevPercentRef.current;
        const end = metrics.weightedPercent; 
        if (start === end) return;
        let animationFrameId: number;
        const duration = 1200; 
        const startTime = performance.now();
        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 4);
            const currentVal = start + (end - start) * ease;
            setDisplayPercent(currentVal);
            if (progress < 1) animationFrameId = requestAnimationFrame(animate);
            else prevPercentRef.current = end;
        };
        animationFrameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrameId);
    }, [metrics.weightedPercent]);

    const getStageConfig = (weightedP: number) => {
        if (weightedP <= 25) return { stage: 'seed', barBackground: 'bg-[#A8E6CF]', textColor: 'text-[#5DAA8E]', lightBg: 'bg-[#E0F7EF]', borderColor: 'border-[#A8E6CF]', icon: <Sprout className="w-5 h-5 text-[#5DAA8E] animate-bounce" />, mascot: <Cat className="w-12 h-12 text-[#5DAA8E]" />, message: "起步萌芽期", subMessage: "萬事起頭難，我們已經種下希望的種子！", glow: false, texture: false };
        if (weightedP <= 50) return { stage: 'grow', barBackground: 'bg-[#4D80E6]', textColor: 'text-[#4D80E6]', lightBg: 'bg-[#EEF4FF]', borderColor: 'border-[#BDD5FF]', icon: <Leaf className="w-5 h-5 text-white animate-pulse" />, mascot: <Cat className="w-12 h-12 text-[#4D80E6] -scale-x-100" />, message: "穩健成長期", subMessage: "根基越來越穩固，就像小樹苗正在長高！", glow: false, texture: false };
        if (weightedP <= 80) return { stage: 'sprint', barBackground: 'bg-[#FFB74D]', textColor: 'text-[#F57C00]', lightBg: 'bg-[#FFF3E0]', borderColor: 'border-[#FFCC80]', icon: <Flame className="w-5 h-5 text-white animate-pulse" />, mascot: <Cat className="w-12 h-12 text-[#FFB74D] -scale-x-100" />, message: "熱情衝刺期", subMessage: "目標已經過半，全力加速向前衝刺吧！", glow: false, texture: true };
        return { stage: 'harvest', barBackground: 'bg-gradient-to-r from-[#FFD700] to-[#FDB931]', textColor: 'text-[#D4AF37]', lightBg: 'bg-[#FFFBE6]', borderColor: 'border-[#FFE082]', icon: <Trophy className="w-5 h-5 text-white animate-bounce" />, mascot: <PartyPopper className="w-12 h-12 text-[#FFD700]" />, message: "榮耀豐收期", subMessage: "太耀眼了！夢想寶箱就在眼前，伸手可及！", glow: true, texture: false };
    };

    const config = getStageConfig(metrics.weightedPercent);
    return (
        <div className={`bg-white p-6 rounded-[40px] shadow-xl border-2 flex flex-col relative overflow-hidden transition-all duration-500 ${config.borderColor} ${config.glow ? 'shadow-amber-200/50' : ''}`}>
            <div className="flex justify-between items-start mb-6 z-10">
                <div>
                    <h4 className="font-extrabold text-slate-700 text-lg flex items-center gap-2"><Target className={`w-5 h-5 ${config.textColor}`} />{goalName}</h4>
                    <p className={`text-xs font-bold ${config.textColor} mt-1 opacity-80`}>{config.message} &bull; {config.subMessage}</p>
                    <p className="text-[10px] text-slate-400 mt-1">時間進度: {metrics.timePercent.toFixed(1)}% &bull; 存款進度: {metrics.financialPercent.toFixed(1)}%</p>
                </div>
                <div className={`p-2 rounded-full bg-white shadow-sm border-2 ${config.borderColor} transition-colors duration-500`}>{config.mascot}</div>
            </div>
            <div className="mb-8 z-10 relative">
                <div className="flex justify-between items-end mb-2 px-1">
                    <span className="text-xs font-bold text-slate-400 font-mono tracking-wider">SAVINGS PROGRESS</span>
                    <span className={`text-3xl font-black ${config.textColor} tabular-nums transition-colors duration-500`}>{displayPercent.toFixed(1)}%</span>
                </div>
                <div className="h-6 bg-slate-100 rounded-full w-full relative shadow-inner overflow-hidden border border-slate-100">
                    <div className={`h-full rounded-full relative flex items-center justify-end pr-1 transition-all duration-[1200ms] ease-out shadow-sm ${config.barBackground}`} style={{ width: `${metrics.weightedPercent}%`, backgroundImage: config.texture ? 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.2) 10px, rgba(255,255,255,0.2) 20px)' : undefined }}>
                        <div className="absolute -right-3 top-1/2 -translate-y-1/2 bg-white p-1 rounded-full shadow-md z-20 scale-110 border-2 border-white">{config.icon}</div>
                    </div>
                </div>
                <div className="flex justify-between mt-2 text-xs font-bold text-slate-400 px-1">
                    <span>$0</span>
                    <span>${Math.round(metrics.currentProgress).toLocaleString()} / ${metrics.targetAmount.toLocaleString()}</span>
                </div>
            </div>
            <div className={`p-5 rounded-[24px] ${config.lightBg} border ${config.borderColor} relative z-10 transition-colors duration-500`}>
                <div className="flex gap-3">
                    <div className={`p-2 rounded-xl h-fit shrink-0 bg-white shadow-sm ${config.textColor}`}>{metrics.isFeasible ? <Smile className="w-5 h-5" /> : <BrainCircuit className="w-5 h-5" />}</div>
                    <div className="space-y-2 flex-1">
                        <div className="flex justify-between items-start">
                            <p className="text-sm font-bold text-slate-700">{metrics.isFeasible ? '教練診斷：狀況極佳！' : '教練診斷：發現阻力'}</p>
                            {!metrics.isFeasible && <span className="bg-white px-2 py-1 rounded-lg text-[10px] font-bold text-rose-500 shadow-sm border border-rose-100">缺口 ${Math.round(metrics.gap).toLocaleString()}/月</span>}
                        </div>
                        <div className="text-xs text-slate-500 leading-relaxed font-medium">
                            {metrics.isFeasible ? <>您的平均存力 (ANC) <strong>${Math.round(metrics.anc).toLocaleString()}</strong> 超越了目標要求。建議保持當前節奏，或考慮增加投資比例加速複利效應。</> : <>教練發現每月有資金缺口。{healthMetrics.dtiRatio > 35 ? <span className="block mt-1 text-rose-500">🔴 <strong>風險阻礙：</strong>固定債務佔比過高 ({healthMetrics.dtiRatio.toFixed(0)}%)，請優先處理債務。</span> : healthMetrics.ratios.variable > 30 ? <span className="block mt-1 text-amber-600">🟠 <strong>結構失衡：</strong>變動支出過高，建議從「{(anomalies[0]?.category?.l2 || freqAlerts[0]?.l2 || '非必要支出')}」開始縮減。</span> : <span className="block mt-1 text-slate-600">🔵 <strong>建議：</strong>試著減少 {(anomalies[0]?.category?.l3 || '零食飲料')} 的頻率來填補缺口。</span>}</>}
                        </div>
                    </div>
                </div>
            </div>
            <div className={`absolute -top-10 -right-10 w-40 h-40 bg-gradient-to-br from-white/0 to-slate-100/50 rounded-full blur-3xl pointer-events-none transition-all duration-1000 ${config.glow ? 'opacity-80 scale-150 bg-amber-200/50' : 'opacity-100'}`}></div>
        </div>
    );
};

const Dashboard: React.FC<DashboardProps> = ({ 
    alerts, budgets, transactions, allTransactions, goal, onPrint, timeScope, setTimeScope, cycleStartDay, setCycleStartDay, dateRangeLabel, currentDate, setCurrentDate, penaltyConfig, setPenaltyConfig, customRange, setCustomRange
}) => {
  const expenses = transactions.filter(t => t.type === 'expense');
  const incomes = transactions.filter(t => t.type === 'income');
  const expenseData = [{ name: CATEGORY_LABELS[L1Category.VARIABLE], value: expenses.filter(t => t.category.l1 === L1Category.VARIABLE).reduce((a, b) => a + b.amount, 0) }, { name: CATEGORY_LABELS[L1Category.FIXED], value: expenses.filter(t => t.category.l1 === L1Category.FIXED).reduce((a, b) => a + b.amount, 0) }, { name: CATEGORY_LABELS[L1Category.INVESTMENT], value: expenses.filter(t => t.category.l1 === L1Category.INVESTMENT).reduce((a, b) => a + b.amount, 0) }].filter(d => d.value > 0);
  const totalExpense = expenseData.reduce((acc, curr) => acc + curr.value, 0);
  const totalIncome = incomes.reduce((acc, curr) => acc + curr.amount, 0);
  const netCashFlow = totalIncome - totalExpense;
  const healthMetrics = useMemo(() => analyzeFinancialHealth(transactions), [transactions]);
  const opportunityCost = useMemo(() => calculateOpportunityCost(healthMetrics.variableAmount), [healthMetrics.variableAmount]);
  const seasonalData = useMemo(() => getSeasonalTrends(allTransactions), [allTransactions]);
  const anomalies = useMemo(() => analyzeL3Anomalies(transactions, allTransactions), [transactions, allTransactions]);
  const freqAlerts = useMemo(() => analyzeL2Frequency(transactions, allTransactions, currentDate), [transactions, allTransactions, currentDate]);
  const incomeBreakdown = useMemo(() => getCategoryBreakdown(transactions, 'income'), [transactions]);
  const expenseBreakdown = useMemo(() => getCategoryBreakdown(transactions, 'expense', L1Category.VARIABLE), [transactions]); 
  const goalMetrics = useMemo(() => goal ? calculateGoalMetrics(goal, allTransactions) : null, [goal, allTransactions]);
  const penaltyData = useMemo(() => timeScope === 'all' ? { isOverspent: false, overage: 0, penaltyAmount: 0 } : calculateProjectedPenalty(transactions, budgets, penaltyConfig), [transactions, budgets, penaltyConfig, timeScope]);
  const runwayData = useMemo(() => calculateRunway(allTransactions), [allTransactions]);
  const taxData = useMemo(() => calculateTaxEstimation(allTransactions), [allTransactions]);

  const [expandedL2, setExpandedL2] = useState<string | null>(null);
  const [showGapAction, setShowGapAction] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const handleGoalAction = (type: string) => { if (type === 'opportunity') setShowGapAction(!showGapAction); };

  // --- Robust Date Range Fetching for Header and Modal ---
  const currentRangeObj = useMemo(() => {
    return getDateRange(timeScope, cycleStartDay, allTransactions, currentDate, customRange.start, customRange.end);
  }, [timeScope, cycleStartDay, allTransactions, currentDate, customRange]);

  const allRange = useMemo(() => getDateRange('all', cycleStartDay, allTransactions, new Date()), [allTransactions, cycleStartDay]);
  const monthRange = useMemo(() => getDateRange('natural_month', cycleStartDay, allTransactions, currentDate), [allTransactions, cycleStartDay, currentDate]);
  const cycleRange = useMemo(() => getDateRange('custom_cycle', cycleStartDay, allTransactions, currentDate), [allTransactions, cycleStartDay, currentDate]);

  const triggerExport = async () => {
    setShowExportModal(false);
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = 210, pageHeight = 297, marginX = 15, marginY = 20, contentWidth = pageWidth - (marginX * 2), spacingY = 8;
        let currentY = marginY, pageNum = 1;
        const addPageMetadata = (pNum: number) => {
            pdf.setFontSize(10); pdf.setTextColor(150, 150, 150);
            pdf.text('Pawket 喵喵財庫 - 財務分析報告', marginX, 12);
            pdf.text(format(new Date(), 'yyyy/MM/dd HH:mm'), pageWidth - marginX - 35, 12);
            pdf.text(`${pNum}`, pageWidth / 2, pageHeight - 10);
        };
        addPageMetadata(pageNum);
        const sections = document.querySelectorAll('[data-pdf-section]');
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i] as HTMLElement;
            // Capture even off-screen elements
            const canvas = await html2canvas(section, { 
                scale: 2, 
                useCORS: true, 
                backgroundColor: '#FFFFFF', 
                logging: false,
                onclone: (clonedDoc) => {
                    const el = clonedDoc.querySelector('[data-pdf-header-container]');
                    if (el) (el as HTMLElement).style.position = 'static';
                }
            });
            const imgData = canvas.toDataURL('image/png'), imgProps = pdf.getImageProperties(imgData);
            const imgHeight = (imgProps.height * contentWidth) / imgProps.width;
            if (currentY + imgHeight > pageHeight - marginY) { pdf.addPage(); pageNum++; currentY = marginY; addPageMetadata(pageNum); }
            pdf.addImage(imgData, 'PNG', marginX, currentY, contentWidth, imgHeight);
            currentY += imgHeight + spacingY;
        }
        pdf.save(`Pawket_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    } catch (err) { console.error(err); alert("匯出失敗。"); } finally { setIsExporting(false); }
  };

  const isCritical = alerts.some(a => a.level === 'critical'), isDtiHigh = healthMetrics.dtiRatio > 35, isPenaltyActive = penaltyData.isOverspent, isCaution = (!isCritical && alerts.length > 0) || (healthMetrics.dtiRatio > 30 && healthMetrics.dtiRatio <= 35) || isPenaltyActive;
  let meowneyStatus: 'safe' | 'caution' | 'alert' = (timeScope === 'all') ? 'safe' : (isCritical || isDtiHigh || isPenaltyActive) ? 'alert' : isCaution ? 'caution' : 'safe';

  const [showSettings, setShowSettings] = useState(false), [tempCycleDay, setTempCycleDay] = useState(cycleStartDay), [tempPenaltyConfig, setTempPenaltyConfig] = useState(penaltyConfig), [showDatePicker, setShowDatePicker] = useState(false), [pickerYear, setPickerYear] = useState(currentDate.getFullYear());
  const datePickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setPickerYear(currentDate.getFullYear()); }, [showDatePicker, currentDate]);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setShowDatePicker(false); };
    document.addEventListener("mousedown", click); return () => document.removeEventListener("mousedown", click);
  }, []);

  const saveSettings = () => { if (tempCycleDay >= 1 && tempCycleDay <= 31) { setCycleStartDay(tempCycleDay); setPenaltyConfig(tempPenaltyConfig); setShowSettings(false); } };
  const navigateMonth = (direction: number) => setCurrentDate(addMonths(currentDate, direction));
  const handleMonthSelect = (monthIndex: number) => { setCurrentDate(new Date(pickerYear, monthIndex, 1)); setShowDatePicker(false); };

  const MeowneyMascot = ({ status }: { status: 'safe' | 'caution' | 'alert' }) => {
    let bgColor = "bg-emerald-50", message = "Meow~ 財務狀況很健康喔！", subMessage = "目前一切都在掌控中，繼續保持！", face = <Smile className="w-12 h-12 text-emerald-500" />;
    if (timeScope === 'all') { bgColor = "bg-indigo-50"; message = "喵～這是我們的累積成果！"; subMessage = `目前共記錄了 ${allTransactions.length} 筆交易。`; face = <Cat className="w-12 h-12 text-indigo-500" />; }
    else if (status === 'caution') { bgColor = "bg-amber-50"; message = "注意喔！花費有點快了..."; subMessage = "建議減少不必要的零食開銷。"; face = <Meh className="w-12 h-12 text-amber-500" />; }
    else if (status === 'alert') { bgColor = "bg-rose-50"; if (isPenaltyActive) { message = "罰則啟動！下期預算縮減"; subMessage = `強制扣除 $${penaltyData.penaltyAmount.toFixed(0)}。`; face = <AlertOctagon className="w-12 h-12 text-rose-500" />; } else if (isDtiHigh) { message = "壓力山大！固定債務過高！"; subMessage = "DTI 償債比率危險。"; face = <Frown className="w-12 h-12 text-rose-500" />; } else { message = "喵嗚！超支了！快停下來！"; subMessage = "請立即檢視紅色項目！"; face = <Frown className="w-12 h-12 text-rose-500" />; } }
    return (
      <div className={`col-span-1 md:col-span-2 rounded-[40px] p-8 flex items-center justify-between shadow-sm border border-white relative overflow-hidden transition-colors duration-500 ${bgColor}`}>
         <div className="z-10 flex flex-col justify-center h-full">
            <div className="flex items-center gap-3 mb-2"><span className={`px-4 py-1.5 rounded-full text-sm font-bold bg-white/60 backdrop-blur shadow-sm flex items-center gap-2 ${timeScope === 'all' ? 'text-indigo-500' : status === 'alert' ? 'text-rose-500' : status === 'caution' ? 'text-amber-500' : 'text-emerald-500'}`}><ActivityIcon />{timeScope === 'all' ? '累積總覽模式' : 'Meowney 情緒指標'}</span></div>
            <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight mb-2 ${timeScope === 'all' ? 'text-indigo-600' : status === 'alert' ? 'text-rose-600' : status === 'caution' ? 'text-amber-600' : 'text-emerald-600'}`}>{message}</h2>
            <p className="text-slate-500 font-medium leading-relaxed max-w-md">{subMessage}</p>
         </div>
         <div className="relative w-32 h-32 md:w-40 md:h-40 shrink-0 hidden sm:block">
             <div className={`w-full h-full rounded-full flex items-center justify-center bg-white shadow-xl shadow-black/5 border-4 transition-all duration-500 ${timeScope === 'all' ? 'border-indigo-200' : status === 'alert' ? 'border-rose-200 animate-pulse' : status === 'caution' ? 'border-amber-200' : 'border-emerald-200'}`}>{face}</div>
             <div className={`absolute top-0 left-2 w-8 h-8 bg-white rounded-lg rotate-[-15deg] -z-10 border-t-4 ${timeScope === 'all' ? 'border-indigo-200' : status === 'alert' ? 'border-rose-200' : status === 'caution' ? 'border-amber-200' : 'border-emerald-200'}`}></div>
             <div className={`absolute top-0 right-2 w-8 h-8 bg-white rounded-lg rotate-[15deg] -z-10 border-t-4 ${timeScope === 'all' ? 'border-indigo-200' : status === 'alert' ? 'border-rose-200' : status === 'caution' ? 'border-amber-200' : 'border-emerald-200'}`}></div>
         </div>
      </div>
    );
  };

  // Robust month/date change handlers for the export modal
  const handleExportMonthChange = (val: string) => {
    if (!val) return;
    const [y, m] = val.split('-');
    const yearNum = parseInt(y);
    const monthNum = parseInt(m);
    if (!isNaN(yearNum) && !isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
        setCurrentDate(new Date(yearNum, monthNum - 1, 1));
    }
  };

  return (
    <div id="dashboard-content" className="space-y-8 relative">
      {/* RESTORED: SETTINGS MODAL */}
      {showSettings && (
          <div className="absolute top-16 right-0 md:right-auto z-50 mt-2 w-80 bg-white rounded-3xl shadow-2xl border-4 border-amber-100 p-6 animate-in fade-in zoom-in-95 duration-200" data-html2canvas-ignore>
              <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-slate-700 flex items-center gap-2">
                      <Settings className="w-5 h-5 text-amber-500" /> 設定與偏好
                  </h4>
                  <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <p className="text-xs text-slate-400 mb-2 font-bold uppercase">理財週期</p>
                  <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-slate-600">每月</span>
                      <input 
                        type="number" min="1" max="31" 
                        value={tempCycleDay} 
                        onChange={e => setTempCycleDay(parseInt(e.target.value))}
                        className="w-20 p-2 text-center bg-white border-2 border-amber-200 rounded-xl font-bold text-slate-900 outline-none focus:border-amber-400"
                      />
                      <span className="text-sm font-bold text-slate-600">號開始</span>
                  </div>
                </div>
                <div className="h-px bg-slate-100"></div>
                <div>
                   <div className="flex justify-between items-center mb-2">
                       <p className="text-xs text-slate-400 font-bold uppercase flex items-center gap-1"><Gavel className="w-3 h-3" /> 預算罰則系統 (Beta)</p>
                       <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={tempPenaltyConfig.enabled} onChange={e => setTempPenaltyConfig({...tempPenaltyConfig, enabled: e.target.checked})} className="sr-only peer" />
                          <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-amber-400 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                       </label>
                   </div>
                   {tempPenaltyConfig.enabled && (
                       <div className="bg-slate-50 p-3 rounded-2xl space-y-3 animate-in fade-in">
                           <div>
                               <label className="text-[10px] font-bold text-slate-500 mb-1 block">懲罰目標分類</label>
                               <select 
                                  value={tempPenaltyConfig.targetCategory}
                                  onChange={e => setTempPenaltyConfig({...tempPenaltyConfig, targetCategory: e.target.value})}
                                  className="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200 outline-none"
                               >
                                  {STANDARD_CATEGORIES[L1Category.VARIABLE].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                               </select>
                           </div>
                           <div>
                               <label className="text-[10px] font-bold text-slate-500 mb-1 block">懲罰比例</label>
                               <div className="flex items-center gap-2">
                                  <input type="range" min="0.1" max="1.0" step="0.1" value={tempPenaltyConfig.ratio} onChange={e => setTempPenaltyConfig({...tempPenaltyConfig, ratio: parseFloat(e.target.value)})} className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-400" />
                                  <span className="text-xs font-bold text-amber-600">{Math.round(tempPenaltyConfig.ratio * 100)}%</span>
                               </div>
                           </div>
                       </div>
                   )}
                </div>
                <button onClick={saveSettings} className="w-full py-2 bg-amber-400 text-white rounded-xl font-bold shadow-md hover:bg-amber-500 active:scale-95 transition">儲存設定</button>
              </div>
          </div>
      )}

      {/* EXPORT PERIOD MODAL */}
      {showExportModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200" data-html2canvas-ignore>
              <div className="bg-white w-full max-w-xl rounded-[40px] shadow-2xl border-4 border-white p-8 relative overflow-hidden flex flex-col gap-6">
                  <div className="flex justify-between items-center">
                      <h3 className="text-2xl font-extrabold text-slate-700 flex items-center gap-3">
                          <div className="p-2.5 bg-amber-100 text-amber-500 rounded-2xl"><Download className="w-6 h-6" /></div>
                          匯出 PDF 報告
                      </h3>
                      <button onClick={() => setShowExportModal(false)} className="p-2 hover:bg-slate-50 rounded-full transition"><X className="w-6 h-6 text-slate-300" /></button>
                  </div>
                  
                  <p className="text-slate-400 font-medium">請使用日期選單選擇欲匯出的期間，Meowney 會自動將資料排版成報告。</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Option 1: All Time */}
                      <button onClick={() => { setTimeScope('all'); triggerExport(); }} className="p-5 border-2 border-slate-50 bg-slate-50 rounded-3xl hover:border-amber-400 hover:bg-white transition-all flex flex-col items-start gap-1 group">
                          <div className="flex items-center gap-2">
                              <span className="font-extrabold text-slate-700 text-lg">至今累積模式</span>
                              <Cat className="w-4 h-4 text-slate-300" />
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono font-bold">{format(allRange.startDate, 'yyyy/MM/dd')} ~ {format(allRange.endDate, 'yyyy/MM/dd')}</span>
                      </button>

                      {/* Option 2: Monthly */}
                      <div className="p-5 border-2 border-slate-50 bg-slate-50 rounded-3xl flex flex-col items-start gap-1 relative group hover:border-amber-200 transition-all">
                          <span className="font-extrabold text-slate-700 text-lg">自然月模式</span>
                          <span className="text-[11px] text-slate-400 font-mono font-bold mb-2">{format(monthRange.startDate, 'yyyy/MM/dd')} ~ {format(monthRange.endDate, 'yyyy/MM/dd')}</span>
                          <div className="flex items-center gap-2 w-full">
                              <input 
                                type="month" 
                                value={format(currentDate, 'yyyy-MM')} 
                                onChange={e => handleExportMonthChange(e.target.value)} 
                                className="flex-1 text-[11px] p-2 rounded-lg bg-white border border-slate-200 font-bold outline-none cursor-pointer hover:border-amber-400 transition" 
                              />
                              <button onClick={() => { setTimeScope('natural_month'); triggerExport(); }} className="bg-amber-400 text-white p-2 rounded-lg hover:bg-amber-500 transition shadow-sm active:scale-95"><Download className="w-4 h-4"/></button>
                          </div>
                      </div>

                      {/* Option 3: Cycle */}
                      <div className="p-5 border-2 border-slate-50 bg-slate-50 rounded-3xl flex flex-col items-start gap-1 relative group hover:border-amber-200 transition-all">
                          <span className="font-extrabold text-slate-700 text-lg">週期結算模式</span>
                          <span className="text-[11px] text-slate-400 font-mono font-bold mb-2">{format(cycleRange.startDate, 'yyyy/MM/dd')} ~ {format(cycleRange.endDate, 'yyyy/MM/dd')}</span>
                          <div className="flex items-center gap-2 w-full">
                              <input 
                                type="month" 
                                value={format(currentDate, 'yyyy-MM')} 
                                onChange={e => handleExportMonthChange(e.target.value)} 
                                className="flex-1 text-[11px] p-2 rounded-lg bg-white border border-slate-200 font-bold outline-none cursor-pointer hover:border-amber-400 transition" 
                              />
                              <button onClick={() => { setTimeScope('custom_cycle'); triggerExport(); }} className="bg-amber-400 text-white p-2 rounded-lg hover:bg-amber-500 transition shadow-sm active:scale-95"><Download className="w-4 h-4"/></button>
                          </div>
                          <span className="text-[10px] text-amber-500 font-bold mt-1">(目前結算日：每月 {cycleStartDay} 號)</span>
                      </div>

                      {/* Option 4: Custom Range */}
                      <div className="p-5 border-2 border-slate-50 bg-slate-50 rounded-3xl flex flex-col items-start gap-1 relative group hover:border-amber-200 transition-all">
                          <span className="font-extrabold text-slate-700 text-lg">自訂任意區間</span>
                          <div className="flex flex-col gap-2 w-full mt-1">
                              <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase ml-1">開始日期</p>
                                      <input 
                                        type="date" 
                                        value={format(customRange.start, 'yyyy-MM-dd')} 
                                        onChange={e => setCustomRange({...customRange, start: new Date(e.target.value)})} 
                                        className="w-full text-sm p-2.5 rounded-xl bg-white border border-slate-200 font-mono outline-none cursor-pointer hover:border-amber-400 transition shadow-sm" 
                                      />
                                  </div>
                                  <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase ml-1">結束日期</p>
                                      <input 
                                        type="date" 
                                        value={format(customRange.end, 'yyyy-MM-dd')} 
                                        onChange={e => setCustomRange({...customRange, end: new Date(e.target.value)})} 
                                        className="w-full text-sm p-2.5 rounded-xl bg-white border border-slate-200 font-mono outline-none cursor-pointer hover:border-amber-400 transition shadow-sm" 
                                      />
                                  </div>
                              </div>
                              <button onClick={() => { setTimeScope('custom_range'); triggerExport(); }} className="bg-amber-400 text-white text-xs font-bold py-3.5 rounded-2xl hover:bg-amber-500 transition active:scale-95 shadow-lg shadow-amber-100 flex items-center justify-center gap-2 mt-2">匯出自訂區間</button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* HEADER SECTION (App View) */}
      <div className="flex flex-col gap-6" data-html2canvas-ignore>
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div>
                <h1 className="text-3xl font-extrabold text-slate-700 tracking-tight flex items-center gap-3">貓咪指揮中心<span className="text-sm bg-amber-100 text-amber-600 px-3 py-1 rounded-full font-bold">Pawket AI</span></h1>
                <p className="text-slate-400 text-sm font-medium mt-1 ml-1">讓每一分錢都變成可愛的形狀 ✨</p>
            </div>
            <button onClick={() => setShowExportModal(true)} disabled={isExporting} className={`flex items-center gap-2 px-6 py-3 bg-white border border-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-amber-50 hover:text-amber-600 hover:border-amber-100 transition shadow-sm active:scale-95 ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {isExporting ? '生成中...' : '匯出 PDF 報告'}
            </button>
        </div>

        <div className="bg-white p-2 rounded-[24px] shadow-sm border border-orange-50 inline-flex flex-col md:flex-row gap-2 md:gap-0 w-full md:w-fit self-start items-center">
            <div className="flex bg-slate-50 p-1.5 rounded-2xl relative">
                <button onClick={() => setTimeScope('all')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 relative z-10 ${timeScope === 'all' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>至今累積</button>
                <button onClick={() => setTimeScope('natural_month')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 relative z-10 ${timeScope === 'natural_month' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>月度模式</button>
                <button onClick={() => setTimeScope('custom_cycle')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 relative z-10 ${timeScope === 'custom_cycle' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>週期模式</button>
            </div>
            <div className="flex items-center gap-3 px-3 py-1 relative">
                <div className="h-6 w-px bg-slate-200 hidden md:block"></div>
                <div className="flex items-center gap-1 text-slate-500 bg-orange-50/50 p-1 rounded-xl border border-orange-100/50 relative z-20">
                    {timeScope !== 'all' && <button onClick={() => navigateMonth(-1)} className="p-1.5 hover:bg-white rounded-lg transition text-orange-400"><ChevronLeft className="w-4 h-4" /></button>}
                    <div className="px-3 py-1 flex items-center gap-2 cursor-pointer hover:bg-white rounded-lg transition select-none group" onClick={() => timeScope !== 'all' && setShowDatePicker(!showDatePicker)}>
                         <Calendar className="w-4 h-4 text-orange-400" />
                         <span className="text-xs font-bold font-mono text-slate-700">{dateRangeLabel}</span>
                         {timeScope !== 'all' && <ChevronDown className="w-3 h-3 text-slate-400" />}
                    </div>
                    {showDatePicker && (
                        <div ref={datePickerRef} className="absolute top-full left-0 mt-2 bg-white rounded-3xl shadow-xl border-4 border-amber-100 p-4 z-50 w-72 animate-in fade-in zoom-in-95 duration-200">
                             <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-50">
                                <button onClick={() => setPickerYear(pickerYear-1)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"><ChevronLeft className="w-5 h-5" /></button>
                                <span className="font-extrabold text-lg text-slate-700">{pickerYear} 年</span>
                                <button onClick={() => setPickerYear(pickerYear+1)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"><ChevronRight className="w-5 h-5" /></button>
                             </div>
                             <div className="grid grid-cols-4 gap-2 mb-4">{MONTH_NAMES.map((name, idx) => <button key={idx} onClick={() => handleMonthSelect(idx)} className={`py-2 rounded-xl text-sm font-bold transition ${currentDate.getFullYear() === pickerYear && currentDate.getMonth() === idx ? 'bg-amber-400 text-white shadow-md' : 'text-slate-500 hover:bg-amber-50'}`}>{name}</button>)}</div>
                        </div>
                    )}
                    {timeScope !== 'all' && <button onClick={() => navigateMonth(1)} className="p-1.5 hover:bg-white rounded-lg transition text-orange-400"><ChevronRight className="w-4 h-4" /></button>}
                </div>
                <button onClick={() => { setTempCycleDay(cycleStartDay); setTempPenaltyConfig(penaltyConfig); setShowSettings(!showSettings); }} className={`p-2 rounded-xl transition-colors ${timeScope === 'custom_cycle' ? 'bg-amber-100 text-amber-600' : 'text-slate-300 hover:bg-slate-100'}`}><Settings className="w-4 h-4" /></button>
            </div>
        </div>
      </div>

      {/* --- RECTIFIED PDF REPORT HEADER (OFF-SCREEN BUT VISIBLE TO CAPTURE) --- */}
      <div data-pdf-section data-pdf-header-container className="fixed -left-[9999px] top-0 p-12 bg-white w-[190mm] border-b-8 border-amber-400" style={{ zIndex: -100 }}>
          <div className="flex justify-between items-end">
              <div>
                  <h2 className="text-5xl font-black text-slate-800 tracking-tighter mb-4">財務決策分析報告</h2>
                  <div className="flex items-center gap-4">
                      <div className="bg-amber-50 px-6 py-4 rounded-[24px] border border-amber-100">
                          <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-1">報告分析期間</p>
                          <p className="text-2xl font-black text-slate-700 font-mono">
                              {isValid(currentRangeObj.startDate) ? format(currentRangeObj.startDate, 'yyyy年MM月dd日') : 'N/A'} ~ 
                              {isValid(currentRangeObj.endDate) ? format(currentRangeObj.endDate, 'yyyy年MM月dd日') : 'N/A'}
                          </p>
                      </div>
                  </div>
              </div>
              <div className="text-right">
                  <p className="text-lg font-bold text-slate-400 uppercase tracking-widest">分析視角：{timeScope === 'all' ? '至今累積' : timeScope === 'natural_month' ? '自然月度' : timeScope === 'custom_cycle' ? '週期結算' : '自訂區間'}</p>
                  <p className="text-sm text-slate-300 mt-1">匯出日期：{format(new Date(), 'yyyy/MM/dd')}</p>
                  <p className="text-sm text-slate-300">資料來源：Pawket AI 指揮中心</p>
              </div>
          </div>
      </div>

      {/* SECTION 1: Mascot & DTI */}
      <div data-pdf-section className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-transparent">
         <MeowneyMascot status={meowneyStatus} />
         {isPenaltyActive ? (
            <div className="rounded-[40px] p-6 border bg-rose-50 border-rose-100 flex flex-col justify-between relative overflow-hidden group">
                 <div className="absolute top-0 right-0 p-4 opacity-5"><Gavel className="w-32 h-32 text-rose-500" /></div>
                 <div className="flex items-start justify-between z-10">
                     <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2"><Scale className="w-4 h-4 text-rose-500" />預算罰則生效</h3>
                        <div className="mt-2 flex items-baseline gap-2"><span className="text-4xl font-extrabold text-rose-600">-${penaltyData.penaltyAmount.toFixed(0)}</span></div>
                     </div>
                     <div className="p-2 bg-rose-200 text-rose-600 rounded-full animate-bounce"><AlertOctagon className="w-6 h-6" /></div>
                 </div>
                 <div className="mt-4 pt-4 border-t border-rose-200 z-10"><p className="text-xs font-bold leading-relaxed text-rose-500">警告：下期預算將強制縮減。</p></div>
            </div>
         ) : (
            <div className={`rounded-[40px] p-6 border flex flex-col justify-between ${isDtiHigh ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-100 shadow-sm'}`}>
                <div className="flex items-start justify-between">
                   <div>
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2"><Zap className={`w-4 h-4 ${isDtiHigh ? 'text-rose-500' : 'text-amber-400'}`} />償債比率 (DTI)</h3>
                      <div className="mt-2 flex items-baseline gap-2"><span className={`text-4xl font-extrabold ${isDtiHigh ? 'text-rose-600' : healthMetrics.dtiRatio > 30 ? 'text-amber-500' : 'text-emerald-500'}`}>{healthMetrics.dtiRatio.toFixed(1)}%</span></div>
                   </div>
                   {isDtiHigh && <div className="p-2 bg-rose-200 text-rose-600 rounded-full animate-bounce"><AlertTriangle className="w-6 h-6" /></div>}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100/50"><p className={`text-xs font-bold leading-relaxed ${isDtiHigh ? 'text-rose-500' : 'text-slate-400'}`}>{isDtiHigh ? '警告：固定支出佔比過高。' : '信用狀況健康。'}</p></div>
            </div>
         )}
      </div>

      {/* SECTION 2: Alerts */}
      {timeScope !== 'all' && alerts.length > 0 && (
          <div data-pdf-section className="bg-white p-6 rounded-[30px] border border-amber-100 shadow-sm">
            <h3 className="text-sm font-bold text-slate-500 flex items-center gap-2 mb-4 uppercase tracking-wider"><AlertCircle className="w-4 h-4 text-rose-400" />需立即關注的項目</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {alerts.slice(0, 3).map(alert => (
                    <div key={alert.id} className={`p-4 rounded-2xl border flex items-center gap-3 ${alert.level === 'critical' ? 'bg-rose-50 border-rose-100' : 'bg-amber-50 border-amber-100'}`}>
                        <div className={`p-2 rounded-full ${alert.level === 'critical' ? 'bg-rose-200 text-rose-600' : 'bg-amber-200 text-amber-600'}`}>{alert.level === 'critical' ? <AlertTriangle className="w-4 h-4" /> : <Info className="w-4 h-4" />}</div>
                        <div className="flex-1"><p className="font-bold text-slate-700 text-sm">{alert.metric}</p><p className="text-xs text-slate-500 mt-0.5 font-medium line-clamp-1">{alert.message}</p></div>
                    </div>
                ))}
            </div>
          </div>
      )}

      {/* SECTION 3: Financial Structure */}
      <div data-pdf-section>
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-2 mt-4 mb-4"><BarChart3 className="w-6 h-6 text-amber-400" />財務結構分析</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-[30px] shadow-xl shadow-orange-50/50 border border-orange-50 flex flex-col justify-between">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-6">支出佔比分配</h4>
                  <div className="space-y-6">
                      {['Fixed', 'Variable', 'Investment'].map(k => {
                        const val = healthMetrics.ratios[k.toLowerCase() as keyof typeof healthMetrics.ratios];
                        const labels = { Fixed: '固定支出', Variable: '變動支出', Investment: '儲蓄投資' };
                        const color = k === 'Fixed' ? 'bg-slate-600' : k === 'Variable' ? 'bg-amber-400' : 'bg-emerald-400';
                        return (
                          <div key={k}>
                              <div className="flex justify-between text-sm font-bold mb-1"><span className="text-slate-600">{labels[k as keyof typeof labels]}</span><span className="text-slate-600">{val.toFixed(1)}%</span></div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(val, 100)}%` }}></div></div>
                          </div>
                        )
                      })}
                  </div>
              </div>
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-8 rounded-[30px] shadow-xl shadow-indigo-200 text-white flex flex-col justify-between relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-6 opacity-10"><TrendingUp className="w-32 h-32 text-white" /></div>
                   <div className="relative z-10">
                       <h4 className="text-sm font-bold text-indigo-100 uppercase tracking-wider mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4" /> 潛在財富機會</h4>
                       <p className="text-indigo-100 text-xs font-medium mb-6 opacity-80">將本期「非必要支出」投入年化 7% 理財...</p>
                       <div className="p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20">
                           <p className="text-xs font-bold text-yellow-300 uppercase mb-1">10 年後將額外獲利</p>
                           <p className="text-3xl font-extrabold tracking-tight">+${Math.round(opportunityCost).toLocaleString()}</p>
                       </div>
                   </div>
              </div>
              <div className="bg-white p-6 rounded-[30px] shadow-xl shadow-orange-50/50 border border-orange-50 flex flex-col items-center justify-center text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-400 to-emerald-400"></div>
                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">本期淨現金流</h4>
                    <p className={`text-4xl font-black mb-2 ${netCashFlow >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{netCashFlow >= 0 ? '+' : ''}{netCashFlow.toLocaleString()}</p>
              </div>
          </div>
      </div>

      {/* SECTION 4: Category Insights */}
      <div data-pdf-section>
          <h3 className="text-xl font-extrabold text-slate-700 flex items-center gap-2 mt-4 mb-4"><Search className="w-6 h-6 text-amber-400" />分類洞察</h3>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-[30px] border border-orange-50 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Wallet className="w-4 h-4 text-emerald-400" /> 收入來源分析</h4>
                  <div className="space-y-3">{incomeBreakdown.slice(0, 3).map((item, idx) => (<div key={idx} className="flex justify-between items-center p-3 rounded-2xl bg-emerald-50/50"><span className="font-bold text-slate-700">{item.l2}</span><p className="font-bold text-emerald-600">${item.amount.toLocaleString()}</p></div>))}</div>
              </div>
              <div className="bg-white p-6 rounded-[30px] border border-orange-50 shadow-lg shadow-orange-50/50 flex flex-col">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-rose-400" /> 支出排行榜</h4>
                  <div className="flex-1 space-y-4">{expenseBreakdown.slice(0, 3).map((l2Item, idx) => (<div key={l2Item.l2} className="p-4 rounded-2xl border-2 border-slate-50 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-400">{idx+1}</div><p className="font-bold text-slate-700">{l2Item.l2}</p></div><p className="font-bold text-slate-700">${l2Item.amount.toLocaleString()}</p></div>))}</div>
              </div>
              <div className="bg-white p-6 rounded-[30px] border border-orange-50 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-pink-500" /> 異常消費偵測</h4>
                  <div className="space-y-3">{anomalies.slice(0, 3).map((tx) => (<div key={tx.id} className="p-4 bg-pink-50/50 rounded-2xl border border-pink-100 flex items-start gap-3"><div className="flex-1"><p className="font-bold text-slate-700 text-sm">{tx.merchant}</p><span className="font-black text-pink-600">${tx.amount.toLocaleString()}</span></div></div>))}</div>
              </div>
          </div>
      </div>

      {/* SECTION 5: Heatmap & Goal */}
      <div data-pdf-section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-white p-6 rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50">
              <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-6"><TrendingUp className="w-5 h-5 text-amber-400" />季節性支出趨勢 (24個月)</h4>
              <div className="grid grid-cols-12 gap-1.5">{seasonalData.slice(-12).map((data, idx) => (<div key={idx} className="flex flex-col items-center gap-2"><div className="w-full bg-slate-50 rounded-lg h-32 relative flex items-end overflow-hidden"><div className="w-full rounded-t-lg" style={{ height: `${Math.max(data.intensity * 100, 5)}%`, backgroundColor: `rgba(251, 191, 36, ${Math.max(data.intensity, 0.2)})` }}></div></div><span className="text-[10px] font-bold text-slate-400">{data.label}</span></div>))}</div>
          </div>
          {goalMetrics && goal ? <MeowneyGoalBar metrics={goalMetrics} goalName={goal.name} onActionClick={handleGoalAction} showGapAction={showGapAction} healthMetrics={healthMetrics} anomalies={anomalies} freqAlerts={freqAlerts} /> : <div className="bg-white p-6 rounded-[40px] border border-orange-50 flex items-center justify-center text-slate-300 text-sm">尚未設定目標</div>}
      </div>

      {/* SECTION 6: Forecasting */}
      <div data-pdf-section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={`p-6 rounded-[30px] border shadow-sm flex items-center gap-6 ${runwayData.daysRemaining < 90 ? 'bg-rose-50 border-rose-100' : 'bg-white border-emerald-50'}`}>
              <div className={`p-4 rounded-full ${runwayData.daysRemaining < 90 ? 'bg-rose-200 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}><Hourglass className="w-8 h-8" /></div>
              <div><h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">現金緩衝耗盡預警</h4><div className="flex items-baseline gap-2"><span className={`text-2xl font-black ${runwayData.daysRemaining < 90 ? 'text-rose-600' : 'text-slate-700'}`}>{runwayData.daysRemaining > 3650 ? '> 10 年' : `${runwayData.daysRemaining} 天`}</span></div></div>
          </div>
          <div className="p-6 bg-white rounded-[30px] border border-blue-50 shadow-sm flex items-center gap-6">
              <div className="p-4 bg-blue-50 text-blue-500 rounded-full"><Landmark className="w-8 h-8" /></div>
              <div><h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">年度稅務抵扣估算</h4><span className="text-2xl font-black text-blue-600">${taxData.totalDeductible.toLocaleString()}</span></div>
          </div>
      </div>
    </div>
  );
};

const ActivityIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;

export default Dashboard;
