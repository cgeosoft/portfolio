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
import type { PortfolioSummary } from "portfolio-shared/portfolio";
import { t } from "../../i18n";
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

/**
 * A metric explanation. Its text lives in `metrics.info.defs.<key>` of the
 * language file and is read at render time: `title`, `category`, `short`,
 * `full`, `formula`, `formulaDescription`, `components.<id>.label|description`
 * and `takeaways.<id>`.
 */
interface MetricDefinition {
  key: MetricKey;
  icon: React.ElementType;
  iconColor: string;
  components: Array<{
    id: string;
    getValue?: (summary: PortfolioSummary | null | undefined, currency: string, hide: boolean) => string;
    colorClass?: string | ((summary: PortfolioSummary | null | undefined) => string);
  }>;
  takeaways: string[];
}

const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  totalGain: {
    key: "totalGain",
    icon: TrendingUp,
    iconColor: "text-mint",
    components: [
      {
        id: "unrealized",
        getValue: (s, c, h) => {
          const val = (s?.totalValue ?? 0) - (s?.totalCost ?? 0);
          return `${val >= 0 ? "+" : ""}${fmtCurrency(val, s?.baseCurrency || c, h)}`;
        },
        colorClass: "text-mint",
      },
      {
        id: "realized",
        getValue: (s, c, h) =>
          `${(s?.realizedPnL ?? 0) >= 0 ? "+" : ""}${fmtCurrency(s?.realizedPnL ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-mint",
      },
      {
        id: "income",
        getValue: (s, c, h) =>
          `+${fmtCurrency((s?.totalDividends ?? 0) + (s?.totalInterest ?? 0), s?.baseCurrency || c, h)}`,
        colorClass: "text-mint",
      },
      {
        id: "fees",
        getValue: (s, c, h) => `-${fmtCurrency(s?.totalFees ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-[#DD3C73]",
      },
    ],
    takeaways: ["alpha", "cashFlow", "netOfFees"],
  },
  valuation: {
    key: "valuation",
    icon: Wallet,
    iconColor: "text-[#DD3C73]",
    components: [
      {
        id: "holdings",
        getValue: (s, c, h) => fmtCurrency(s?.totalValue ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-[#DD3C73]",
      },
      {
        id: "cash",
        getValue: (s, c, h) => fmtCurrency(s?.cashBalance ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-mint",
      },
      {
        id: "costBasis",
        getValue: (s, c, h) => fmtCurrency(s?.totalCost ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-slate-300",
      },
    ],
    takeaways: ["liquidWorth", "multiAsset", "cashDrag"],
  },
  todayReturn: {
    key: "todayReturn",
    icon: DollarSign,
    iconColor: "text-[#DD3C73]",
    components: [
      {
        id: "currencyDelta",
        getValue: (s, c, h) =>
          `${(s?.dayGainLossDollar ?? 0) >= 0 ? "+" : ""}${fmtCurrency(s?.dayGainLossDollar ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: (s) => ((s?.dayGainLossDollar ?? 0) >= 0 ? "text-mint" : "text-[#DD3C73]"),
      },
      {
        id: "percentChange",
        getValue: (s) =>
          `${(s?.dayGainLossPercent ?? 0) >= 0 ? "+" : ""}${fmtPercent(s?.dayGainLossPercent ?? 0)}`,
        colorClass: (s) => ((s?.dayGainLossPercent ?? 0) >= 0 ? "text-mint" : "text-[#DD3C73]"),
      },
      {
        id: "topWinner",
        getValue: (s) =>
          s?.bestPerformer ? `${s.bestPerformer.symbol} (+${s.bestPerformer.changePercent.toFixed(1)}%)` : "—",
        colorClass: "text-mint",
      },
    ],
    takeaways: ["volatility", "excludesCash", "realTime"],
  },
  realizedIncome: {
    key: "realizedIncome",
    icon: PiggyBank,
    iconColor: "text-mint",
    components: [
      {
        id: "sells",
        getValue: (s, c, h) =>
          `${(s?.realizedPnL ?? 0) >= 0 ? "+" : ""}${fmtCurrency(s?.realizedPnL ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-mint",
      },
      {
        id: "dividends",
        getValue: (s, c, h) => `+${fmtCurrency(s?.totalDividends ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-mint",
      },
      {
        id: "interest",
        getValue: (s, c, h) => `+${fmtCurrency(s?.totalInterest ?? 0, s?.baseCurrency || c, h)}`,
        colorClass: "text-mint",
      },
    ],
    takeaways: ["permanent", "income", "tax"],
  },
  cashReserves: {
    key: "cashReserves",
    icon: Coins,
    iconColor: "text-mint",
    components: [
      {
        id: "balance",
        getValue: (s, c, h) => fmtCurrency(s?.cashBalance ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-mint",
      },
      {
        id: "share",
        getValue: (s) => t("metrics.info.defs.cashReserves.components.share.value", { percent: s?.cashWeightPercent ?? 0 }),
        colorClass: "text-slate-300",
      },
    ],
    takeaways: ["liquidity", "risk"],
  },
  capitalInjected: {
    key: "capitalInjected",
    icon: Layers,
    iconColor: "text-royal-bright",
    components: [
      {
        id: "deposited",
        getValue: (s, c, h) =>
          fmtCurrency(s?.totalCashInjected || s?.totalCost || 0, s?.baseCurrency || c, h),
        colorClass: "text-royal-bright",
      },
    ],
    takeaways: ["benchmark", "returnBase"],
  },
  dividends: {
    key: "dividends",
    icon: CircleDollarSign,
    iconColor: "text-mint",
    components: [
      {
        id: "cumulative",
        getValue: (s, c, h) => fmtCurrency(s?.totalDividends ?? 0, s?.baseCurrency || c, h),
        colorClass: "text-mint",
      },
    ],
    takeaways: ["cashFlow", "compounding"],
  },
  topPerformer: {
    key: "topPerformer",
    icon: Flame,
    iconColor: "text-[#DD3C73]",
    components: [
      {
        id: "topAsset",
        getValue: (s) =>
          s?.bestPerformer
            ? `${s.bestPerformer.symbol} (+${s.bestPerformer.changePercent.toFixed(1)}%)`
            : t("metrics.info.defs.topPerformer.components.topAsset.none"),
        colorClass: "text-mint",
      },
    ],
    takeaways: ["momentum", "attribution"],
  },
};

/** Text of a metric explanation, e.g. `defText("valuation", "formula")`. */
function defText(key: MetricKey, path: string): string {
  return t(`metrics.info.defs.${key}.${path}`);
}

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
          sub: t("metrics.info.live.sinceInception", {
            percent: `${isStartUp ? "+" : ""}${fmtPercent(summary?.totalGainSinceStartPercent ?? summary?.totalGainLossPercent ?? 0)}`,
          }),
          color: isStartUp ? "text-mint" : "text-[#DD3C73]",
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
              ? t("metrics.info.live.invested", { amount: fmtCurrency(summary?.totalValue ?? 0, baseCurr, hideCurrencyValues) })
              : t("metrics.info.live.costBasis", { amount: fmtCurrency(summary?.totalCost ?? 0, baseCurr, hideCurrencyValues) }),
          color: "text-slate-100",
        };
      case "todayReturn":
        return {
          main: `${isDayUp ? "+" : ""}${fmtCurrency(summary?.dayGainLossDollar ?? 0, baseCurr, hideCurrencyValues)}`,
          sub: t("metrics.info.live.dayChange", { arrow: isDayUp ? "▲" : "▼", percent: fmtPercent(summary?.dayGainLossPercent ?? 0) }),
          color: isDayUp ? "text-mint" : "text-[#DD3C73]",
        };
      case "realizedIncome": {
        const combined =
          (summary?.realizedPnL ?? 0) + (summary?.totalDividends ?? 0) + (summary?.totalInterest ?? 0);
        return {
          main: `+${fmtCurrency(combined, baseCurr, hideCurrencyValues)}`,
          sub: t("metrics.info.live.sellsAndDividends", {
            sells: fmtCurrency(summary?.realizedPnL ?? 0, baseCurr, hideCurrencyValues),
            dividends: fmtCurrency(summary?.totalDividends ?? 0, baseCurr, hideCurrencyValues),
          }),
          color: "text-mint",
        };
      }
      case "cashReserves":
        return {
          main: `${fmtCurrency(summary?.cashBalance ?? 0, baseCurr, hideCurrencyValues)}`,
          sub: t("metrics.info.live.cashShare", { percent: summary?.cashWeightPercent ?? 0 }),
          color: "text-mint",
        };
      case "capitalInjected":
        return {
          main: fmtCurrency(
            summary?.totalCashInjected || summary?.totalCost || 0,
            baseCurr,
            hideCurrencyValues
          ),
          sub: t("metrics.info.live.netDeposits"),
          color: "text-slate-100",
        };
      case "dividends":
        return {
          main: fmtCurrency(summary?.totalDividends || 0, baseCurr, hideCurrencyValues),
          sub: t("metrics.info.live.cashDistributions"),
          color: "text-mint",
        };
      case "topPerformer":
        return {
          main: summary?.bestPerformer ? summary.bestPerformer.symbol : "—",
          sub: summary?.bestPerformer
            ? t("metrics.info.live.sessionChange", { percent: summary.bestPerformer.changePercent.toFixed(1) })
            : t("metrics.info.live.noEquities"),
          color: summary?.bestPerformer ? "text-mint" : "text-slate-400",
        };
      default:
        return { main: "—", sub: "", color: "text-slate-100" };
    }
  };

  const liveDisplay = getLiveMetricDisplay();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto font-mono"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
    >
      <div
        className="cx-card w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl! shadow-2xl relative my-auto flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] overflow-hidden"
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
                {t("metrics.info.title")}
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate mt-0.5">
                {t("metrics.info.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0 ml-2"
            aria-label={t("metrics.info.closeLabel")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metric Selector Tabs */}
        <div className="border-b border-slate-800/80 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 bg-slate-950/20 overflow-x-auto custom-scrollbar">
          <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1.5 sm:mb-2">
            {t("metrics.info.selectMetric")}
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
                      ? "bg-[#DD3C73]/20 text-[#DD3C73] border-[#DD3C73]/40 shadow-xs shadow-[#DD3C73]/10"
                      : "bg-slate-950/40 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  <TabIcon className={`w-3.5 h-3.5 ${isSelected ? "text-[#DD3C73]" : "text-slate-400"}`} />
                  <span>{defText(key, "title")}</span>
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
                    {defText(currentDef.key, "title")}
                  </span>
                  <span className="text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded-sm bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                    {defText(currentDef.key, "category")}
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
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">{t("metrics.info.activeCurrency")}</div>
                <div className="text-xs sm:text-sm font-bold text-slate-200 font-mono mt-0.5">{baseCurr}</div>
              </div>
              <div className="text-[10px] text-mint flex items-center gap-1 justify-end sm:mt-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{t("metrics.info.liveData")}</span>
              </div>
            </div>
          </div>

          {/* Section 1: Detailed Explanation */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
              <Info className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>{t("metrics.info.whatItMeans")}</span>
            </div>
            <div className="p-3 sm:p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 text-xs text-slate-300 leading-relaxed font-mono">
              <p className="font-semibold text-slate-200 mb-1">{defText(currentDef.key, "short")}</p>
              <p className="text-slate-400 text-[11px] sm:text-[11.5px] leading-normal">{defText(currentDef.key, "full")}</p>
            </div>
          </div>

          {/* Section 2: Formula & Calculation */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
              <Calculator className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>{t("metrics.info.formula")}</span>
            </div>
            <div className="p-3 sm:p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 font-mono space-y-2">
              <div className="p-2 sm:p-2.5 rounded-lg bg-canvas border border-[#DD3C73]/20 text-[#DD3C73] text-[11px] sm:text-xs font-bold wrap-break-word sm:break-normal">
                {defText(currentDef.key, "formula")}
              </div>
              <p className="text-[10.5px] sm:text-[11px] text-slate-400 leading-relaxed">
                {defText(currentDef.key, "formulaDescription")}
              </p>
            </div>
          </div>

          {/* Section 3: Live Component Breakdown */}
          {currentDef.components.length > 0 && (
            <div className="space-y-1.5 sm:space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                <Layers className="w-3.5 h-3.5 text-[#DD3C73]" />
                <span>{t("metrics.info.components")}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
                {currentDef.components.map((comp) => {
                  const valStr = comp.getValue ? comp.getValue(summary, baseCurr, hideCurrencyValues) : null;
                  const color =
                    typeof comp.colorClass === "function"
                      ? comp.colorClass(summary)
                      : comp.colorClass || "text-slate-200";

                  return (
                    <div
                      key={comp.id}
                      className="p-2.5 sm:p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                          {defText(currentDef.key, `components.${comp.id}.label`)}
                        </span>
                        {valStr && <span className={`text-[11px] sm:text-xs font-bold font-mono ${color}`}>{valStr}</span>}
                      </div>
                      <p className="text-[10px] sm:text-[10.5px] text-slate-400 leading-tight mt-1.5">{defText(currentDef.key, `components.${comp.id}.description`)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 4: Key Insights & Takeaways */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-mint" />
              <span>{t("metrics.info.insights")}</span>
            </div>
            <ul className="space-y-1 sm:space-y-1.5 p-3 sm:p-3.5 rounded-xl bg-slate-950/30 border border-slate-800/60 text-xs text-slate-400 font-mono">
              {currentDef.takeaways.map((id) => (
                <li key={id} className="flex items-start gap-2 text-[10.5px] sm:text-[11px] leading-relaxed">
                  <span className="text-[#DD3C73] font-bold shrink-0">▸</span>
                  <span>{defText(currentDef.key, `takeaways.${id}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 bg-slate-950/40 flex items-center justify-between">
          <div className="text-[10px] sm:text-[11px] text-slate-500 font-mono hidden sm:block">
            {t("metrics.info.footerHint")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer ml-auto"
          >
            {t("metrics.info.closeGuide")}
          </button>
        </div>
      </div>
    </div>
  );
}
