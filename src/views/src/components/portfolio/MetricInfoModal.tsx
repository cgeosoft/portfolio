import React, { useEffect, useId } from "react";
import {
  X,
  TrendingUp,
  Wallet,
  DollarSign,
  PiggyBank,
  Coins,
  Layers,
  CircleDollarSign,
  Flame,
  Calculator,
  Info,
  CheckCircle2,
} from "lucide-react";
import type { PortfolioSummary } from "../../types/portfolio";
import { fmtCurrency, fmtPercent } from "./utils";

export type MetricKey =
  | "totalGain"
  | "valuation"
  | "todayReturn"
  | "realizedIncome"
  | "cashReserves"
  | "capitalInjected"
  | "dividends"
  | "topPerformer";

interface MetricInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMetricKey: MetricKey;
  onSelectMetricKey: (key: MetricKey) => void;
  summary?: PortfolioSummary | null;
  currency: string;
  hideCurrencyValues?: boolean;
}

interface MetricDefinition {
  key: MetricKey;
  title: string;
  category: string;
  icon: React.ElementType;
  iconColor: string;
  shortDescription: string;
  fullExplanation: string;
  formula: string;
  formulaDescription: string;
  components: Array<{
    label: string;
    description: string;
    getValue?: (summary: PortfolioSummary | null | undefined, currency: string, hide: boolean) => string;
    colorClass?: string | ((summary: PortfolioSummary | null | undefined) => string);
  }>;
  keyTakeaways: string[];
}

const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  totalGain: {
    key: "totalGain",
    title: "Total Gain Since Start",
    category: "Performance",
    icon: TrendingUp,
    iconColor: "text-[#A7E2C0]",
    shortDescription: "All-time net economic performance generated across your entire portfolio since inception.",
    fullExplanation:
      "This metric captures the comprehensive net performance of your capital. It does not look merely at current unrealized paper gains, but synthesizes all asset price changes, realized profits from closed sales, dividend distributions, interest payouts, and subtracts transaction fees paid across time.",
    formula:
      "Total Gain = (Invested Value - Cost Basis) + Realized PnL + Dividends + Interest - Broker Fees",
    formulaDescription:
      "Return % = (Total Gain Since Start ÷ Total Capital Invested) × 100",
    components: [
      {
        label: "Unrealized Gain / Loss",
        description: "Paper profit or loss on currently open positions (Invested Value − Cost Basis).",
        getValue: (s, c, h) => {
          const val = (s?.totalValue ?? 0) - (s?.totalCost ?? 0);
          return `${val >= 0 ? "+" : ""}${fmtCurrency(val, s?.baseCurrency || c, h)}`;
        },
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Closed / Realized PnL",
        description: "Net profit or loss locked in upon selling assets over time.",
        getValue: (s, c, h) =>
          `${(s?.realizedPnL ?? 0) >= 0 ? "+" : ""}${fmtCurrency(s?.realizedPnL ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Dividends & Interest",
        description: "Cumulative cash distributions and fixed yields credited into the portfolio.",
        getValue: (s, c, h) =>
          `+${fmtCurrency((s?.totalDividends ?? 0) + (s?.totalInterest ?? 0), s?.baseCurrency || c, h)}`,
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Transaction Fees",
        description: "Total brokerage commissions and order fees deducted over time.",
        getValue: (s, c, h) => `-${fmtCurrency(s?.totalFees ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-[#DD3C73]",
      },
    ],
    keyTakeaways: [
      "True Economic Alpha: Evaluates total wealth created rather than just static ticker price changes.",
      "Cash Flow Included: Reinvested or collected dividends and interest are fully accounted for in the return percentage.",
      "Net of Fees: Broker commissions and trade frictions are deducted to show realistic net returns.",
    ],
  },
  valuation: {
    key: "valuation",
    title: "Portfolio Valuation",
    category: "Valuation",
    icon: Wallet,
    iconColor: "text-[#DD3C73]",
    shortDescription: "Total liquidated net worth of your portfolio at live market quotes.",
    fullExplanation:
      "Portfolio Valuation reflects the exact total liquid value of your entire investment portfolio right now. It combines the real-time market value of all active securities (stocks, ETFs, cryptocurrencies, mutual funds) with your uninvested cash reserves.",
    formula: "Portfolio Valuation = Total Market Value of Holdings + Cash Reserves",
    formulaDescription:
      "Holdings Value is calculated by multiplying each active position's share count by its latest live market quote.",
    components: [
      {
        label: "Invested Holdings Value",
        description: "Aggregate live value of all active stocks, ETFs, crypto, and other assets.",
        getValue: (s, c, h) => fmtCurrency(s?.totalValue ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-[#DD3C73]",
      },
      {
        label: "Uninvested Cash Reserves",
        description: "Liquid cash buffer available for new buys or safe-haven liquidity.",
        getValue: (s, c, h) => fmtCurrency(s?.cashBalance ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Holdings Cost Basis",
        description: "Total capital expended to acquire currently open positions.",
        getValue: (s, c, h) => fmtCurrency(s?.totalCost ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-slate-300",
      },
    ],
    keyTakeaways: [
      "Liquid Worth: What your portfolio would yield before taxes if all holdings were liquidated immediately at current market bids.",
      "Multi-Asset Integration: Seamlessly consolidates multi-currency positions, cash balances, and fractional assets.",
      "Includes Cash Drag: Accurately weights liquid reserves alongside invested assets.",
    ],
  },
  todayReturn: {
    key: "todayReturn",
    title: "Today's Return",
    category: "Daily Return",
    icon: DollarSign,
    iconColor: "text-[#DD3C73]",
    shortDescription: "Single-session valuation delta compared to previous market close.",
    fullExplanation:
      "Today's Return measures the monetary and percentage fluctuation of your active positions during the current trading session. It compares live quotes against the prior day's official market closing prices for each holding.",
    formula:
      "Today's Return ($) = Sum of [ (Current Price - Previous Close Price) × Shares ]",
    formulaDescription:
      "Today's Return (%) = (Today's Return $ ÷ Aggregate Previous Session Close Value) × 100",
    components: [
      {
        label: "24h Currency Delta",
        description: "Absolute financial gain or loss experienced in the current session.",
        getValue: (s, c, h) =>
          `${(s?.dayGainLossDollar ?? 0) >= 0 ? "+" : ""}${fmtCurrency(s?.dayGainLossDollar ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: (s) => ((s?.dayGainLossDollar ?? 0) >= 0 ? "text-[#A7E2C0]" : "text-[#DD3C73]"),
      },
      {
        label: "24h Percentage Change",
        description: "Percentage return relative to yesterday's closing baseline valuation.",
        getValue: (s) =>
          `${(s?.dayGainLossPercent ?? 0) >= 0 ? "+" : ""}${fmtPercent(s?.dayGainLossPercent ?? 0)}`,
        colorClass: (s) => ((s?.dayGainLossPercent ?? 0) >= 0 ? "text-[#A7E2C0]" : "text-[#DD3C73]"),
      },
      {
        label: "Session Top Winner",
        description: "The best performing asset in your active portfolio during this session.",
        getValue: (s) =>
          s?.bestPerformer ? `${s.bestPerformer.symbol} (+${s.bestPerformer.changePercent.toFixed(1)}%)` : "—",
        colorClass: "text-[#A7E2C0]",
      },
    ],
    keyTakeaways: [
      "Session Volatility: Shows how daily macro events, earnings reports, or market shifts impacted your holdings today.",
      "Excludes Cash: Only price-sensitive securities drive daily returns; cash reserves maintain zero daily volatility.",
      "Real-time Updates: Recalculates dynamically as new quote ticks arrive during market hours.",
    ],
  },
  realizedIncome: {
    key: "realizedIncome",
    title: "Realized & Income",
    category: "Income & Yield",
    icon: PiggyBank,
    iconColor: "text-[#A7E2C0]",
    shortDescription: "Cumulative locked-in cash profits from executed sales, dividends, and yields.",
    fullExplanation:
      "While unrealized paper gains rise and fall with market sentiment, Realized & Income tracks the permanent, crystalized wealth you have banked. It sums all profits realized from sold securities together with regular income flows from dividends and interest.",
    formula:
      "Realized & Income = Closed Sale PnL + Total Dividends Received + Fixed Interest Earned",
    formulaDescription:
      "Closed Sale PnL is computed on each SELL execution using the FIFO / average cost basis method.",
    components: [
      {
        label: "Net Realized Sells",
        description: "Crystalized capital gains from executed sell transactions.",
        getValue: (s, c, h) =>
          `${(s?.realizedPnL ?? 0) >= 0 ? "+" : ""}${fmtCurrency(s?.realizedPnL ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Dividends Received",
        description: "Cash payments distributed by portfolio holdings directly to you.",
        getValue: (s, c, h) => `+${fmtCurrency(s?.totalDividends ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Fixed Interest / Yields",
        description: "Income earned from cash yields, bond coupons, or lending.",
        getValue: (s, c, h) => `+${fmtCurrency(s?.totalInterest ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-[#A7E2C0]",
      },
    ],
    keyTakeaways: [
      "Permanent Wealth: Locked-in gains cannot be reversed by future market downturns.",
      "Income Generation: Clear visibility into passive yield generation from dividend-paying assets.",
      "Tax & Accounting: Useful for tracking annual taxable capital events and dividend distributions.",
    ],
  },
  cashReserves: {
    key: "cashReserves",
    title: "Cash Reserves",
    category: "Liquidity",
    icon: Coins,
    iconColor: "text-[#A7E2C0]",
    shortDescription: "Unallocated liquid cash available for strategic rebalancing or safety.",
    fullExplanation:
      "Cash Reserves represent uninvested fiat currency in your portfolio. This liquidity serves as 'dry powder' for opportunistic market dips, emergency buffers, or awaiting dividend reinvestment.",
    formula: "Cash Reserves = Total Injected Deposits - Total Buys + Total Sells + Dividends - Withdrawals - Fees",
    formulaDescription: "Cash Weight (%) = (Cash Reserves ÷ Total Portfolio Valuation) × 100",
    components: [
      {
        label: "Current Balance",
        description: "Instant liquid cash available in the portfolio base currency.",
        getValue: (s, c, h) => fmtCurrency(s?.cashBalance ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-[#A7E2C0]",
      },
      {
        label: "Allocation Share",
        description: "Percentage proportion of total portfolio value held in cash.",
        getValue: (s) => `${s?.cashWeightPercent ?? 0}% of portfolio`,
        colorClass: "text-slate-300",
      },
    ],
    keyTakeaways: [
      "Opportunistic Liquidity: Enables immediate execution on market drawdowns without selling existing assets.",
      "Risk Mitigation: Dampens overall portfolio volatility during bear cycles.",
    ],
  },
  capitalInjected: {
    key: "capitalInjected",
    title: "Capital Injected",
    category: "Principal",
    icon: Layers,
    iconColor: "text-[#7392fa]",
    shortDescription: "Total cumulative principal capital deposited into the portfolio.",
    fullExplanation:
      "Capital Injected tracks your total principal contributions (deposits) into the portfolio ledger. It acts as the financial baseline denominator for calculating true Return on Invested Capital (ROIC).",
    formula: "Capital Injected = Cumulative Deposits - Cumulative Capital Withdrawals",
    formulaDescription: "Calculated from all DEPOSIT and WITHDRAWAL transaction records in your portfolio.",
    components: [
      {
        label: "Total Capital Deposited",
        description: "Sum of all historical external deposits transferred into the portfolio.",
        getValue: (s, c, h) =>
          fmtCurrency(s?.totalCashInjected || s?.totalCost || 0, s?.baseCurrency || c, h),
        colorClass: "text-[#7392fa]",
      },
    ],
    keyTakeaways: [
      "Principal Benchmark: Differentiates external savings contributions from organic market growth.",
      "Return Base: Forms the denominator for accurate Money-Weighted and Time-Weighted Return models.",
    ],
  },
  dividends: {
    key: "dividends",
    title: "Total Dividends",
    category: "Distributions",
    icon: CircleDollarSign,
    iconColor: "text-[#A7E2C0]",
    shortDescription: "All-time cash dividend payouts received from equity and fund holdings.",
    fullExplanation:
      "Total Dividends represents the aggregate lifetime cash distributions paid directly to your portfolio by dividend-yielding equities, ETFs, and REITs. These can be held as cash liquidity or redeployed into new holdings.",
    formula: "Total Dividends = Sum of all DIVIDEND transactions credited to the account",
    formulaDescription: "Excludes price appreciation and focuses strictly on corporate earnings distributions.",
    components: [
      {
        label: "Cumulative Dividends",
        description: "Total monetary dividends credited across all portfolio assets.",
        getValue: (s, c, h) => fmtCurrency(s?.totalDividends ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-[#A7E2C0]",
      },
    ],
    keyTakeaways: [
      "Passive Cash Flow: Measures the real cash payout power of your income-oriented investments.",
      "Compounding Fuel: Dividends can be systematically reinvested to accelerate compound growth.",
    ],
  },
  topPerformer: {
    key: "topPerformer",
    title: "Top Session Performer",
    category: "Session Leader",
    icon: Flame,
    iconColor: "text-[#DD3C73]",
    shortDescription: "The individual active asset with the highest percentage gain in the current market session.",
    fullExplanation:
      "Identifies the standout asset in your portfolio based on intraday percentage gain from the previous official market close. Helps spot momentum drivers and market leadership across your holdings.",
    formula: "Top Performer = max( (Current Quote - Previous Close) ÷ Previous Close ) across all active holdings",
    formulaDescription: "Evaluated across all active non-cash assets in the portfolio.",
    components: [
      {
        label: "Top Asset",
        description: "Asset ticker and intraday percentage return.",
        getValue: (s) =>
          s?.bestPerformer
            ? `${s.bestPerformer.symbol} (+${s.bestPerformer.changePercent.toFixed(1)}%)`
            : "No active equity positions",
        colorClass: "text-[#A7E2C0]",
      },
    ],
    keyTakeaways: [
      "Momentum Tracking: Instant visibility into today's strongest asset rally.",
      "Attribution: Understand what position is carrying today's portfolio performance.",
    ],
  },
};

const ALL_METRIC_KEYS: MetricKey[] = [
  "totalGain",
  "valuation",
  "todayReturn",
  "realizedIncome",
  "cashReserves",
  "capitalInjected",
  "dividends",
  "topPerformer",
];

export function MetricInfoModal({
  isOpen,
  onClose,
  selectedMetricKey,
  onSelectMetricKey,
  summary,
  currency,
  hideCurrencyValues = false,
}: MetricInfoModalProps) {
  const modalTitleId = useId();

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentDef = METRIC_DEFINITIONS[selectedMetricKey] || METRIC_DEFINITIONS.totalGain;
  const Icon = currentDef.icon;

  const baseCurr = summary?.baseCurrency || currency;
  const isStartUp = (summary?.totalGainSinceStartDollar ?? 0) >= 0;
  const isDayUp = (summary?.dayGainLossDollar ?? 0) >= 0;

  // Compute live card summary display for the selected metric
  const getLiveMetricDisplay = () => {
    switch (selectedMetricKey) {
      case "totalGain":
        return {
          main: `${isStartUp ? "+" : ""}${fmtCurrency(
            summary?.totalGainSinceStartDollar ?? summary?.totalGainLossDollar ?? 0,
            baseCurr,
            hideCurrencyValues
          )}`,
          sub: `Return: ${isStartUp ? "+" : ""}${fmtPercent(
            summary?.totalGainSinceStartPercent ?? summary?.totalGainLossPercent ?? 0
          )} since inception`,
          color: isStartUp ? "text-[#A7E2C0]" : "text-[#DD3C73]",
        };
      case "valuation":
        return {
          main: fmtCurrency(
            summary?.totalPortfolioValue ?? (summary?.totalValue ?? 0) + (summary?.cashBalance ?? 0),
            baseCurr,
            hideCurrencyValues
          ),
          sub:
            (summary?.cashBalance ?? 0) > 0
              ? `Invested: ${fmtCurrency(summary?.totalValue ?? 0, baseCurr, hideCurrencyValues)}`
              : `Cost Basis: ${fmtCurrency(summary?.totalCost ?? 0, baseCurr, hideCurrencyValues)}`,
          color: "text-slate-100",
        };
      case "todayReturn":
        return {
          main: `${isDayUp ? "+" : ""}${fmtCurrency(summary?.dayGainLossDollar ?? 0, baseCurr, hideCurrencyValues)}`,
          sub: `24h Change: ${isDayUp ? "▲" : "▼"} ${fmtPercent(summary?.dayGainLossPercent ?? 0)}`,
          color: isDayUp ? "text-[#A7E2C0]" : "text-[#DD3C73]",
        };
      case "realizedIncome": {
        const combined =
          (summary?.realizedPnL ?? 0) + (summary?.totalDividends ?? 0) + (summary?.totalInterest ?? 0);
        return {
          main: `+${fmtCurrency(combined, baseCurr, hideCurrencyValues)}`,
          sub: `Sells: ${fmtCurrency(summary?.realizedPnL ?? 0, baseCurr, hideCurrencyValues)} | Divs: ${fmtCurrency(
            summary?.totalDividends ?? 0,
            baseCurr,
            hideCurrencyValues
          )}`,
          color: "text-[#A7E2C0]",
        };
      }
      case "cashReserves":
        return {
          main: `${fmtCurrency(summary?.cashBalance ?? 0, baseCurr, hideCurrencyValues)}`,
          sub: `${summary?.cashWeightPercent ?? 0}% of Total Portfolio`,
          color: "text-[#A7E2C0]",
        };
      case "capitalInjected":
        return {
          main: fmtCurrency(
            summary?.totalCashInjected || summary?.totalCost || 0,
            baseCurr,
            hideCurrencyValues
          ),
          sub: "Total Cumulative Net Deposits",
          color: "text-slate-100",
        };
      case "dividends":
        return {
          main: fmtCurrency(summary?.totalDividends || 0, baseCurr, hideCurrencyValues),
          sub: "All-Time Cash Distributions",
          color: "text-[#A7E2C0]",
        };
      case "topPerformer":
        return {
          main: summary?.bestPerformer ? summary.bestPerformer.symbol : "—",
          sub: summary?.bestPerformer ? `+${summary.bestPerformer.changePercent.toFixed(1)}% session change` : "No equities active",
          color: summary?.bestPerformer ? "text-[#A7E2C0]" : "text-slate-400",
        };
      default:
        return { main: "—", sub: "", color: "text-slate-100" };
    }
  };

  const liveDisplay = getLiveMetricDisplay();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto font-mono"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
    >
      <div
        className="cx-card w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl shadow-2xl relative my-auto flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0 bg-slate-950/40">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-[#DD3C73]/10 border border-[#DD3C73]/20 text-[#DD3C73] shrink-0">
              <Calculator className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id={modalTitleId} className="text-xs font-bold text-slate-200 uppercase tracking-wider truncate">
                Metric Explanations & Methodology
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate mt-0.5">
                Formulas, component breakdowns, and live calculated values
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0 ml-2"
            aria-label="Close metric explanations modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metric Selector Tabs */}
        <div className="border-b border-slate-800/80 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 bg-slate-950/20 overflow-x-auto custom-scrollbar">
          <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1.5 sm:mb-2">
            Select Metric to Inspect:
          </div>
          <div className="flex sm:flex-wrap items-center gap-1.5 sm:gap-2 pb-1 sm:pb-0 overflow-x-auto sm:overflow-visible">
            {ALL_METRIC_KEYS.map((key) => {
              const def = METRIC_DEFINITIONS[key];
              const TabIcon = def.icon;
              const isSelected = selectedMetricKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectMetricKey(key)}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer border shrink-0 sm:shrink ${
                    isSelected
                      ? "bg-[#DD3C73]/20 text-[#DD3C73] border-[#DD3C73]/40 shadow-sm shadow-[#DD3C73]/10"
                      : "bg-slate-950/40 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  <TabIcon className={`w-3.5 h-3.5 ${isSelected ? "text-[#DD3C73]" : "text-slate-400"}`} />
                  <span>{def.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3.5 sm:p-5 space-y-4 sm:space-y-5">
          {/* Live Current Value Card */}
          <div className="p-3 sm:p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[#DD3C73] shrink-0">
                <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${currentDef.iconColor}`} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                    {currentDef.title}
                  </span>
                  <span className="text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                    {currentDef.category}
                  </span>
                </div>
                <div className={`text-xl sm:text-2xl font-bold font-mono tracking-tight mt-0.5 ${liveDisplay.color}`}>
                  {liveDisplay.main}
                </div>
                {liveDisplay.sub && (
                  <div className="text-[11px] sm:text-xs font-mono font-medium text-slate-400 mt-0.5">{liveDisplay.sub}</div>
                )}
              </div>
            </div>

            <div className="text-left sm:text-right pt-2.5 sm:pt-0 border-t sm:border-t-0 sm:border-l border-slate-800 sm:pl-4 flex sm:flex-col justify-between sm:justify-start items-center sm:items-end">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Active Currency</div>
                <div className="text-xs sm:text-sm font-bold text-slate-200 font-mono mt-0.5">{baseCurr}</div>
              </div>
              <div className="text-[10px] text-[#A7E2C0] flex items-center gap-1 justify-end sm:mt-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Live Portfolio Data</span>
              </div>
            </div>
          </div>

          {/* Section 1: Detailed Explanation */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
              <Info className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>What this value means</span>
            </div>
            <div className="p-3 sm:p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 text-xs text-slate-300 leading-relaxed font-mono">
              <p className="font-semibold text-slate-200 mb-1">{currentDef.shortDescription}</p>
              <p className="text-slate-400 text-[11px] sm:text-[11.5px] leading-normal">{currentDef.fullExplanation}</p>
            </div>
          </div>

          {/* Section 2: Formula & Calculation */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
              <Calculator className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>Mathematical Formula & Method</span>
            </div>
            <div className="p-3 sm:p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 font-mono space-y-2">
              <div className="p-2 sm:p-2.5 rounded-lg bg-[#0b0f19] border border-[#DD3C73]/20 text-[#DD3C73] text-[11px] sm:text-xs font-bold break-words sm:break-normal">
                {currentDef.formula}
              </div>
              <p className="text-[10.5px] sm:text-[11px] text-slate-400 leading-relaxed">
                {currentDef.formulaDescription}
              </p>
            </div>
          </div>

          {/* Section 3: Live Component Breakdown */}
          {currentDef.components.length > 0 && (
            <div className="space-y-1.5 sm:space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                <Layers className="w-3.5 h-3.5 text-[#DD3C73]" />
                <span>Components & Current Balances</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
                {currentDef.components.map((comp, idx) => {
                  const valStr = comp.getValue ? comp.getValue(summary, baseCurr, hideCurrencyValues) : null;
                  const color =
                    typeof comp.colorClass === "function"
                      ? comp.colorClass(summary)
                      : comp.colorClass || "text-slate-200";

                  return (
                    <div
                      key={idx}
                      className="p-2.5 sm:p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                          {comp.label}
                        </span>
                        {valStr && <span className={`text-[11px] sm:text-xs font-bold font-mono ${color}`}>{valStr}</span>}
                      </div>
                      <p className="text-[10px] sm:text-[10.5px] text-slate-400 leading-tight mt-1.5">{comp.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 4: Key Insights & Takeaways */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#A7E2C0]" />
              <span>Key Analytical Insights</span>
            </div>
            <ul className="space-y-1 sm:space-y-1.5 p-3 sm:p-3.5 rounded-xl bg-slate-950/30 border border-slate-800/60 text-xs text-slate-400 font-mono">
              {currentDef.keyTakeaways.map((point, index) => (
                <li key={index} className="flex items-start gap-2 text-[10.5px] sm:text-[11px] leading-relaxed">
                  <span className="text-[#DD3C73] font-bold shrink-0">▸</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 bg-slate-950/40 flex items-center justify-between">
          <div className="text-[10px] sm:text-[11px] text-slate-500 font-mono hidden sm:block">
            Click any tab above to switch metric explanation
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer ml-auto"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
}
