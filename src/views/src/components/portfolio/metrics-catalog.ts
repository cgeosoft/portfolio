/**
 * Catalog of every metric that the overview page can display.
 * The marketplace page and the overview page both read this catalog, so a
 * metric is described, valued, and rendered from a single definition.
 */

import type { LucideIcon } from "lucide-react";
import {
  Calculator,
  CircleDollarSign,
  Coins,
  Flame,
  Landmark,
  Layers,
  PiggyBank,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { OverviewMetricKey } from "../../../../shared/metrics";
import type { PortfolioSummary } from "../../types/portfolio";
import type { MetricKey } from "./MetricInfoModal";
import { fmtCurrency, fmtPercent } from "./utils";

/** Live data that a metric needs to produce its displayed value. */
export interface MetricContext {
  summary?: PortfolioSummary | null;
  currency: string;
  hideValues: boolean;
}

export interface MetricCatalogEntry {
  key: OverviewMetricKey;
  /** Title of the large card. */
  title: string;
  /** Shorter label used by the compact tile. */
  compactTitle: string;
  /** Marketplace grouping. */
  category: string;
  icon: LucideIcon;
  /** Tailwind color class of the card icon. */
  iconClass: string;
  /** What the metric shows. */
  description: string;
  /** Why the metric is useful to follow. */
  importance: string;
  /** Metric explanation opened by the info button. */
  infoKey: MetricKey;
  /** Main displayed value. */
  getValue: (ctx: MetricContext) => string;
  /** Secondary line of the large card. */
  getSubValue?: (ctx: MetricContext) => string | undefined;
  /** Color of the value in the compact tile. */
  getCompactValueClass?: (ctx: MetricContext) => string;
}

const sign = (val: number | undefined): string => ((val ?? 0) >= 0 ? "+" : "");

const deltaClass = (val: number | undefined): string =>
  (val ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400";

export const METRIC_CATALOG: MetricCatalogEntry[] = [
  {
    key: "totalPortfolioValue",
    title: "Total Portfolio Value",
    compactTitle: "Portfolio Value",
    category: "Valuation",
    icon: Wallet,
    iconClass: "text-[#DD3C73]",
    description:
      "Live net worth of the portfolio. It adds the market value of every open position to the uninvested cash balance, with foreign assets converted into your base currency.",
    importance:
      "This is the single number that answers 'what is my portfolio worth right now'. Use it as the headline figure and as the baseline for allocation and risk decisions.",
    infoKey: "valuation",
    getValue: ({ summary, currency, hideValues }) =>
      fmtCurrency(summary?.totalPortfolioValue, currency, hideValues),
    getSubValue: ({ summary, currency, hideValues }) =>
      summary?.totalGainSinceStartDollar !== undefined
        ? `${sign(summary.totalGainSinceStartDollar)}${fmtCurrency(
            summary.totalGainSinceStartDollar,
            currency,
            hideValues,
          )} (${fmtPercent(summary.totalGainSinceStartPercent)})`
        : undefined,
  },
  {
    key: "dayGainLoss",
    title: "Day Gain / Loss",
    compactTitle: "Day Gain / Loss",
    category: "Performance",
    icon: TrendingUp,
    iconClass: "text-[#A7E2C0]",
    description:
      "Value change of your open positions during the current trading session, measured against the previous official close of each holding.",
    importance:
      "Shows how today's market moves hit your capital. It separates short-term noise from your long-term result and tells you if a market event touched your holdings.",
    infoKey: "todayReturn",
    getValue: ({ summary, currency, hideValues }) =>
      `${sign(summary?.dayGainLossDollar)}${fmtCurrency(summary?.dayGainLossDollar, currency, hideValues)}`,
    getSubValue: ({ summary }) => `${fmtPercent(summary?.dayGainLossPercent)} today`,
    getCompactValueClass: ({ summary }) => deltaClass(summary?.dayGainLossDollar),
  },
  {
    key: "lifetimeGain",
    title: "Lifetime Total Gain",
    compactTitle: "Lifetime Gain",
    category: "Performance",
    icon: Flame,
    iconClass: "text-[#DD3C73]",
    description:
      "All-time net result since the first transaction. It combines unrealized gains, realized profits from closed positions, dividends, and interest, minus broker fees.",
    importance:
      "The honest measure of the wealth your portfolio created. Daily and monthly swings cancel out, so you see if your strategy works over the full holding period.",
    infoKey: "totalGain",
    getValue: ({ summary, currency, hideValues }) =>
      `${sign(summary?.totalGainSinceStartDollar)}${fmtCurrency(
        summary?.totalGainSinceStartDollar,
        currency,
        hideValues,
      )}`,
    getSubValue: ({ summary }) => `${fmtPercent(summary?.totalGainSinceStartPercent)} all-time return`,
    getCompactValueClass: ({ summary }) => deltaClass(summary?.totalGainSinceStartDollar),
  },
  {
    key: "cashLiquidity",
    title: "Cash Liquidity",
    compactTitle: "Cash Liquidity",
    category: "Liquidity",
    icon: CircleDollarSign,
    iconClass: "text-[#243C8F]",
    description:
      "Uninvested cash held in the portfolio, calculated from deposits, withdrawals, buys, sells, dividends, and fees.",
    importance:
      "Free cash is your reaction capacity. It shows the money available for a new position or a market drop, and how much of your portfolio currently earns no market return.",
    infoKey: "cashReserves",
    getValue: ({ summary, currency, hideValues }) => fmtCurrency(summary?.cashBalance, currency, hideValues),
    getSubValue: ({ summary }) => `${fmtPercent(summary?.cashWeightPercent)} portfolio allocation`,
  },
  {
    key: "investedCapital",
    title: "Invested Capital",
    compactTitle: "Invested Capital",
    category: "Principal",
    icon: Layers,
    iconClass: "text-[#7392fa]",
    description:
      "Total principal you moved into the portfolio, that is all deposits minus all capital withdrawals.",
    importance:
      "Separates your own savings from market growth. It is the denominator of your return, so it tells you if the portfolio grew because of performance or because of new money.",
    infoKey: "capitalInjected",
    getValue: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalCashInjected, currency, hideValues),
    getSubValue: () => "Net deposits since inception",
  },
  {
    key: "holdingsCost",
    title: "Current Holdings Cost",
    compactTitle: "Current Holdings Cost",
    category: "Principal",
    icon: Calculator,
    iconClass: "text-[#7392fa]",
    description:
      "Acquisition cost of the positions you hold today, in base currency, without closed positions and without cash.",
    importance:
      "Compare it against the market value of your holdings to read the unrealized gain directly. It is also the cost basis that a future sale will use.",
    infoKey: "valuation",
    getValue: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalCost, currency, hideValues),
    getSubValue: ({ summary, currency, hideValues }) =>
      `Market value ${fmtCurrency(summary?.totalValue, currency, hideValues)}`,
  },
  {
    key: "realizedPnL",
    title: "Realized P&L",
    compactTitle: "Realized P&L",
    category: "Income & Yield",
    icon: PiggyBank,
    iconClass: "text-[#A7E2C0]",
    description:
      "Profit or loss locked in by executed sells, calculated against the cost basis of each sold position.",
    importance:
      "Realized results cannot be taken back by a later market drop, and they usually drive your tax bill. Watch it to judge your exit decisions, not only your open positions.",
    infoKey: "realizedIncome",
    getValue: ({ summary, currency, hideValues }) =>
      `${sign(summary?.realizedPnL)}${fmtCurrency(summary?.realizedPnL, currency, hideValues)}`,
    getSubValue: () => "Closed position result",
    getCompactValueClass: ({ summary }) => deltaClass(summary?.realizedPnL),
  },
  {
    key: "dividendsInterest",
    title: "Dividends & Interest",
    compactTitle: "Dividends & Interest",
    category: "Income & Yield",
    icon: Coins,
    iconClass: "text-[#A7E2C0]",
    description:
      "All cash distributions credited to the portfolio: dividends from equities and funds, plus interest and coupon payments.",
    importance:
      "Income arrives independently of price moves and keeps compounding when reinvested. It shows the cash yield of your holdings during flat or falling markets.",
    infoKey: "dividends",
    getValue: ({ summary, currency, hideValues }) =>
      `+${fmtCurrency((summary?.totalDividends ?? 0) + (summary?.totalInterest ?? 0), currency, hideValues)}`,
    getSubValue: ({ summary, currency, hideValues }) =>
      `Dividends ${fmtCurrency(summary?.totalDividends, currency, hideValues)} | Interest ${fmtCurrency(
        summary?.totalInterest,
        currency,
        hideValues,
      )}`,
    getCompactValueClass: () => "text-emerald-400",
  },
  {
    key: "brokerFees",
    title: "Broker Fees",
    compactTitle: "Broker Fees",
    category: "Costs",
    icon: Receipt,
    iconClass: "text-[#E3EACD]",
    description: "Sum of all commissions and order fees charged on your transactions since inception.",
    importance:
      "Fees are a certain loss while returns are not. Tracking the total exposes expensive trading habits or an expensive broker before they erode your performance.",
    infoKey: "realizedIncome",
    getValue: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalFees, currency, hideValues),
    getSubValue: () => "Lifetime transaction costs",
    getCompactValueClass: () => "text-slate-400",
  },
  {
    key: "taxesWithheld",
    title: "Taxes Withheld",
    compactTitle: "Taxes Withheld",
    category: "Costs",
    icon: Landmark,
    iconClass: "text-[#E3EACD]",
    description:
      "Tax amounts already deducted at the source on your transactions and distributions, for example withholding tax on dividends.",
    importance:
      "Your net result is what remains after tax. The total helps you prepare a tax declaration and compare accounts or jurisdictions on an after-tax basis.",
    infoKey: "realizedIncome",
    getValue: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalTaxes, currency, hideValues),
    getSubValue: () => "Lifetime tax deductions",
    getCompactValueClass: () => "text-slate-400",
  },
];

export const METRIC_CATALOG_BY_KEY: Record<OverviewMetricKey, MetricCatalogEntry> = METRIC_CATALOG.reduce(
  (acc, entry) => {
    acc[entry.key] = entry;
    return acc;
  },
  {} as Record<OverviewMetricKey, MetricCatalogEntry>,
);

/** Marketplace categories, in catalog order. */
export const METRIC_CATEGORIES: string[] = METRIC_CATALOG.reduce<string[]>((acc, entry) => {
  if (!acc.includes(entry.category)) acc.push(entry.category);
  return acc;
}, []);
