/**
 * Dividend income and upcoming events of a portfolio, on top of the symbol
 * calendars of ./intel/calendar.ts.
 *
 * - `getIncomeSummary(portfolioId)`: expected dividend income of the next 12
 *   months by month (declared dividends plus a projection from the past
 *   pattern), dividends received in the last 12 months (DIVIDEND
 *   transactions), yield on cost and current yield per holding and in total,
 *   and splits the recorded quantities may not reflect.
 * - `getUpcomingEvents(portfolioId, days)`: ex-dividend dates, pay dates,
 *   earnings reports and splits of held symbols in the next `days` days.
 *
 * Money amounts are in the portfolio base currency, converted with the FX
 * path of the quotes (`MarketDataCoordinator.getExchangeRates`). Per-share
 * amounts stay in the trading currency of the symbol. Split warnings only
 * inform; nothing here changes stored data.
 *
 * `describeIncomeForAssistant()` and `describeEventsForAssistant()` turn the
 * results into compact text for the assistant without money amounts,
 * quantities or balances. No log line names a symbol (AGENTS.md rule 3).
 */
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as txRepo from "../db/transaction.repo.js";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import type { MarketDataCoordinator } from "./market-data.js";
import type { PortfolioService } from "./portfolio.js";
import { addDaysIso, addMonthsIso, daysBetween, isoDay, projectDividends, type CalendarService } from "./intel/calendar.js";
import type {
  DataProviderId,
  DividendEvent,
  DividendIncomeHolding,
  PortfolioEvent,
  PortfolioEventsResponse,
  PortfolioIncomeSummary,
  SplitWarning,
  SymbolCalendar,
} from "portfolio-shared/api-types";
import type { HoldingPerformance } from "portfolio-shared/portfolio";

/** Longest window `getUpcomingEvents` accepts. */
export const MAX_EVENT_DAYS = 365;
/** A holding shows in the income list when it paid a dividend in this many days or has one declared. */
const RECENT_DIVIDEND_DAYS = 730;
/** A transaction this close to a split date that adds or removes shares at no cost counts as the split itself. */
const SPLIT_MATCH_DAYS = 10;

const BUY_TYPES = new Set(["BUY", "STOCKPERK", "PRIVATE_MARKET_BUY"]);

const round2 = (n: number) => Number(n.toFixed(2));
const round4 = (n: number) => Number(n.toFixed(4));
/** The day that counts for income: the pay date, else the ex-date. */
const incomeDay = (d: DividendEvent) => d.payDate ?? d.exDate;

interface PortfolioContext {
  portfolioId: string;
  baseCurrency: string;
  holdings: HoldingPerformance[];
  transactions: txRepo.TransactionRow[];
  calendars: Map<string, SymbolCalendar>;
  /** Multiplier from a currency to the base currency; undefined when no provider had the rate. */
  fx: (currency: string) => number | undefined;
  totalCost: number;
  totalValue: number;
}

/** Public, quoted holdings that can pay dividends: no crypto, cash or private assets. */
function isEligible(h: HoldingPerformance): boolean {
  if (h.isPrivate || h.shares <= 0) return false;
  if (h.assetType === "Crypto" || h.assetType === "Cash" || h.assetType === "Other") return false;
  return Boolean(h.symbol) && h.symbol !== "CASH";
}

/** Declared dividends that still pay out from `today`, plus the projection up to `until` (ex-date). */
function forwardDividends(cal: SymbolCalendar, until: string, today: string): DividendEvent[] {
  const declared = cal.dividends.history.filter((d) => incomeDay(d) >= today || d.exDate >= today);
  const projected = projectDividends(cal.dividends.history, cal.dividends.frequency, until, today);
  return [...declared, ...projected].sort((a, b) => a.exDate.localeCompare(b.exDate));
}

function addSource(list: DataProviderId[], source: DataProviderId | null | undefined): void {
  if (source && !list.includes(source)) list.push(source);
}

/** The month keys (YYYY-MM) of the 12 calendar months from the one of `today`. */
export function nextTwelveMonths(today: string): string[] {
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: 12 }, (_, i) => addMonthsIso(first, i).slice(0, 7));
}

/**
 * Splits after the first purchase that the recorded quantities do not seem to
 * include. A split counts as recorded when a transaction near its date adds or
 * removes shares at no cost, or when the average cost per share sits closer to
 * today's price than to the price the split implies.
 */
export function detectSplitWarnings(
  holding: HoldingPerformance,
  cal: SymbolCalendar,
  transactions: txRepo.TransactionRow[],
  today = isoDay(),
): SplitWarning[] {
  const sym = holding.symbol.toUpperCase();
  const own = transactions.filter((tx) => (tx.symbol || "").toUpperCase() === sym);
  const firstBuy = own
    .filter((tx) => BUY_TYPES.has(tx.type) && (tx.shares ?? 0) > 0)
    .map((tx) => (tx.date || "").slice(0, 10))
    .sort()[0];
  if (!firstBuy) return [];

  const candidates = cal.splits.history.filter((s) => s.date > firstBuy && s.date <= today && s.numerator !== s.denominator);
  const unrecorded = candidates.filter(
    (s) =>
      !own.some((tx) => {
        const date = (tx.date || "").slice(0, 10);
        if (Math.abs(daysBetween(s.date, date)) > SPLIT_MATCH_DAYS) return false;
        if (tx.type.toUpperCase().includes("SPLIT")) return true;
        const noCost = !(Math.abs(tx.amount ?? 0) > 0) && !((tx.price ?? 0) > 0);
        return noCost && Math.abs(tx.shares ?? 0) > 0;
      }),
  );
  if (unrecorded.length === 0) return [];

  // Price check: unrecorded forward splits leave the average cost far above the price.
  const ratio = unrecorded.reduce((acc, s) => acc * (s.numerator / s.denominator), 1);
  const avgCost = holding.shares > 0 ? holding.totalCost / holding.shares : 0;
  if (avgCost > 0 && holding.currentPrice > 0 && !holding.quoteMissing) {
    const gap = Math.log(avgCost / holding.currentPrice);
    if (Math.abs(gap - Math.log(ratio)) >= Math.abs(gap)) return [];
  }

  return unrecorded.map((s) => ({
    symbol: sym,
    name: holding.name,
    date: s.date,
    numerator: s.numerator,
    denominator: s.denominator,
    message: `${sym} split ${s.numerator}-for-${s.denominator} on ${s.date}, after your first purchase. The recorded quantities may not include it. Check the transactions; Portfolio does not change them.`,
    source: cal.splits.source,
  }));
}

export class IncomeService {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly marketData: MarketDataCoordinator,
    private readonly calendar: CalendarService,
  ) {}

  private async load(portfolioId: string): Promise<PortfolioContext> {
    const row = portfolioRepo.findById(portfolioId);
    if (!row) throw new Error("Portfolio not found");
    const baseCurrency = row.baseCurrency || loadConfig().baseCurrency || "EUR";
    const data = await this.portfolioService.getPortfolioData(row, baseCurrency);
    const holdings = (data.holdings ?? []).filter(isEligible);
    const transactions = (data.transactions as txRepo.TransactionRow[] | undefined) ?? txRepo.findByPortfolio(row.id);

    const calendars = await this.calendar.getCalendars(
      holdings.map((h) => h.symbol),
      (symbol) => ({ earnings: holdings.find((h) => h.symbol === symbol)?.assetType === "Stock" }),
    );

    const currencies = new Set<string>();
    for (const h of holdings) currencies.add(h.nativeCurrency || baseCurrency);
    for (const tx of transactions) if (tx.type === "DIVIDEND" && tx.currency) currencies.add(tx.currency);
    currencies.delete(baseCurrency);
    let rates = new Map<string, number>();
    if (currencies.size > 0) {
      try {
        rates = await this.marketData.getExchangeRates(baseCurrency, [...currencies]);
      } catch (err) {
        appLogger.logStep("warning", "income", "fx", `Exchange rates failed (${err instanceof Error ? err.name : typeof err})`);
      }
    }
    const fx = (currency: string) => {
      if (!currency || currency === baseCurrency) return 1;
      const rate = rates.get(currency);
      return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : undefined;
    };

    return {
      portfolioId: row.id,
      baseCurrency,
      holdings,
      transactions,
      calendars,
      fx,
      totalCost: data.summary?.totalCost ?? 0,
      totalValue: data.summary?.totalValue ?? 0,
    };
  }

  /** Expected and received dividend income, yields and split warnings of a portfolio. */
  public async getIncomeSummary(portfolioId: string): Promise<PortfolioIncomeSummary> {
    const timer = appLogger.startTimer("income", "summary", "Building the dividend income summary");
    const ctx = await this.load(portfolioId);
    const today = isoDay();
    const months = nextTwelveMonths(today);
    const windowEnd = addMonthsIso(`${months[0]}-01`, 12);
    const yearAgo = addDaysIso(today, -365);
    const recentCutoff = addDaysIso(today, -RECENT_DIVIDEND_DAYS);
    const buckets = new Map<string, { month: string; declared: number; estimated: number }>(
      months.map((m): [string, { month: string; declared: number; estimated: number }] => [m, { month: m, declared: 0, estimated: 0 }]),
    );
    const sources: DataProviderId[] = [];

    // Dividends received: DIVIDEND transactions of the last 12 months.
    const received = new Map<string, number>();
    let receivedTotal = 0;
    let receivedCount = 0;
    for (const tx of ctx.transactions) {
      if (tx.type !== "DIVIDEND") continue;
      const date = (tx.date || "").slice(0, 10);
      if (date < yearAgo || date > today) continue;
      const rate = ctx.fx(tx.currency || ctx.baseCurrency);
      if (rate === undefined) continue;
      const amount = Math.abs(tx.amount ?? 0) * rate;
      receivedTotal += amount;
      receivedCount++;
      const sym = (tx.symbol || "").toUpperCase();
      if (sym) received.set(sym, (received.get(sym) ?? 0) + amount);
    }

    const holdings: DividendIncomeHolding[] = [];
    const splitWarnings: SplitWarning[] = [];
    let projectedTotal = 0;

    for (const h of ctx.holdings) {
      const cal = ctx.calendars.get(h.symbol);
      if (!cal) continue;
      splitWarnings.push(...detectSplitWarnings(h, cal, ctx.transactions, today));
      if (splitWarnings.some((w) => w.symbol === h.symbol.toUpperCase())) addSource(sources, cal.splits.source);

      const history = cal.dividends.history;
      const hasRecent = history.some((d) => d.exDate >= recentCutoff) || cal.dividends.upcoming.length > 0;
      if (!hasRecent) continue;
      addSource(sources, cal.dividends.source);

      const currency = h.nativeCurrency || ctx.baseCurrency;
      const rate = ctx.fx(currency);
      const forward = forwardDividends(cal, windowEnd, today).filter((d) => incomeDay(d) >= today && incomeDay(d) < windowEnd);
      const forwardPerShare = forward.reduce((acc, d) => acc + d.amount, 0);
      const trailingPerShare = history.filter((d) => d.exDate >= yearAgo && d.exDate < today).reduce((acc, d) => acc + d.amount, 0);
      const projected = rate !== undefined ? h.shares * forwardPerShare * rate : 0;
      projectedTotal += projected;

      if (rate !== undefined) {
        for (const d of forward) {
          const bucket = buckets.get(incomeDay(d).slice(0, 7));
          if (!bucket) continue;
          const amount = h.shares * d.amount * rate;
          if (d.estimated) bucket.estimated += amount;
          else bucket.declared += amount;
        }
      }

      const upcomingEx = forward.find((d) => d.exDate >= today);
      const upcomingPay = forward.find((d) => d.payDate !== undefined && d.payDate >= today);
      holdings.push({
        symbol: h.symbol,
        name: h.name,
        currency,
        frequency: cal.dividends.frequency,
        forwardDividendPerShare: round4(forwardPerShare),
        trailingDividendPerShare: round4(trailingPerShare),
        projectedIncome12m: round2(projected),
        receivedIncome12m: round2(received.get(h.symbol.toUpperCase()) ?? 0),
        yieldOnCostPercent: rate !== undefined && h.totalCost > 0 ? round2((projected / h.totalCost) * 100) : undefined,
        currentYieldPercent: rate !== undefined && h.currentValue > 0 ? round2((projected / h.currentValue) * 100) : undefined,
        nextExDate: upcomingEx?.exDate,
        nextPayDate: upcomingPay?.payDate,
        estimated: forward.some((d) => d.estimated),
        fxMissing: rate === undefined ? true : undefined,
        source: cal.dividends.source,
      });
    }

    holdings.sort((a, b) => b.projectedIncome12m - a.projectedIncome12m || a.symbol.localeCompare(b.symbol));
    timer.end("info", `Income summary: ${holdings.length} paying holding(s), ${splitWarnings.length} split warning(s)`);

    return {
      portfolioId: ctx.portfolioId,
      baseCurrency: ctx.baseCurrency,
      generatedAt: new Date().toISOString(),
      projected12m: {
        total: round2(projectedTotal),
        months: [...buckets.values()].map((b) => ({ month: b.month, declared: round2(b.declared), estimated: round2(b.estimated) })),
      },
      received12m: { total: round2(receivedTotal), count: receivedCount },
      yieldOnCostPercent: ctx.totalCost > 0 ? round2((projectedTotal / ctx.totalCost) * 100) : undefined,
      currentYieldPercent: ctx.totalValue > 0 ? round2((projectedTotal / ctx.totalValue) * 100) : undefined,
      holdings,
      splitWarnings,
      sources,
    };
  }

  /** Ex-dividend dates, pay dates, earnings reports and splits of held symbols from today to `days` days ahead. */
  public async getUpcomingEvents(portfolioId: string, days = 30): Promise<PortfolioEventsResponse> {
    const span = Math.min(MAX_EVENT_DAYS, Math.max(1, Math.round(Number.isFinite(days) ? days : 30)));
    const ctx = await this.load(portfolioId);
    const from = isoDay();
    const to = addDaysIso(from, span);
    const inWindow = (date: string | undefined) => date !== undefined && date >= from && date <= to;
    const events: PortfolioEvent[] = [];
    const sources: DataProviderId[] = [];

    for (const h of ctx.holdings) {
      const cal = ctx.calendars.get(h.symbol);
      if (!cal) continue;
      const currency = h.nativeCurrency || ctx.baseCurrency;
      const rate = ctx.fx(currency);
      const base = { symbol: h.symbol, name: h.name };

      for (const d of forwardDividends(cal, to, from)) {
        const dividend = {
          ...base,
          estimated: d.estimated || undefined,
          amountPerShare: round4(d.amount),
          currency,
          expectedIncome: rate !== undefined ? round2(h.shares * d.amount * rate) : undefined,
          source: cal.dividends.source,
        };
        if (inWindow(d.exDate)) events.push({ ...dividend, date: d.exDate, kind: "exDividend" });
        if (inWindow(d.payDate)) events.push({ ...dividend, date: d.payDate!, kind: "dividendPayment" });
        if (inWindow(d.exDate) || inWindow(d.payDate)) addSource(sources, cal.dividends.source);
      }

      const next = cal.earnings.upcoming;
      if (next && inWindow(next.date)) {
        events.push({ ...base, date: next.date, kind: "earnings", epsEstimate: next.epsEstimate ?? null, time: next.time, source: cal.earnings.source });
        addSource(sources, cal.earnings.source);
      }

      for (const s of cal.splits.upcoming) {
        if (!inWindow(s.date)) continue;
        events.push({ ...base, date: s.date, kind: "split", numerator: s.numerator, denominator: s.denominator, source: cal.splits.source });
        addSource(sources, cal.splits.source);
      }
    }

    const kindOrder: Record<PortfolioEvent["kind"], number> = { exDividend: 0, earnings: 1, split: 2, dividendPayment: 3 };
    events.sort((a, b) => a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind] || a.symbol.localeCompare(b.symbol));
    return { portfolioId: ctx.portfolioId, baseCurrency: ctx.baseCurrency, days: span, from, to, events, sources };
  }
}

// ── compact text for the assistant ─────────────────────────────────────────

const EVENT_LABELS: Record<PortfolioEvent["kind"], string> = {
  exDividend: "ex-dividend",
  dividendPayment: "dividend payment",
  earnings: "earnings report",
  split: "stock split",
};

/**
 * The income summary as short lines for an assistant prompt: yields,
 * frequencies, dividend dates and split hints per symbol. Without money
 * amounts, quantities or balances, like the rest of the assistant context.
 */
export function describeIncomeForAssistant(summary: PortfolioIncomeSummary): string {
  const lines = [`Dividend income (sources: ${summary.sources.join(", ") || "none"})`];
  if (summary.yieldOnCostPercent !== undefined) lines.push(`- Portfolio yield on cost: ${summary.yieldOnCostPercent}%`);
  if (summary.currentYieldPercent !== undefined) lines.push(`- Portfolio current yield: ${summary.currentYieldPercent}%`);
  for (const h of summary.holdings) {
    const parts = [
      h.frequency ? `${h.frequency}` : "",
      h.yieldOnCostPercent !== undefined ? `yield on cost ${h.yieldOnCostPercent}%` : "",
      h.currentYieldPercent !== undefined ? `current yield ${h.currentYieldPercent}%` : "",
      h.nextExDate ? `next ex-date ${h.nextExDate}` : "",
      h.nextPayDate ? `next pay date ${h.nextPayDate}` : "",
      h.estimated ? "partly estimated" : "",
    ].filter(Boolean);
    lines.push(`- ${h.symbol}: ${parts.join(", ")}`);
  }
  for (const w of summary.splitWarnings) lines.push(`- Split hint: ${w.symbol} ${w.numerator}-for-${w.denominator} on ${w.date} may be missing from the transactions`);
  return lines.join("\n");
}

/** Upcoming events as short lines for an assistant prompt, without money amounts or quantities. */
export function describeEventsForAssistant(res: PortfolioEventsResponse): string {
  const lines = [`Upcoming events ${res.from} to ${res.to} (sources: ${res.sources.join(", ") || "none"})`];
  if (res.events.length === 0) lines.push("- None");
  for (const e of res.events) {
    let detail = "";
    if (e.kind === "exDividend" || e.kind === "dividendPayment") detail = e.amountPerShare !== undefined ? ` ${e.amountPerShare} ${e.currency ?? ""} per share`.trimEnd() : "";
    if (e.kind === "earnings" && typeof e.epsEstimate === "number") detail = ` EPS estimate ${e.epsEstimate}`;
    if (e.kind === "split") detail = ` ${e.numerator}-for-${e.denominator}`;
    lines.push(`- ${e.date} ${e.symbol} ${EVENT_LABELS[e.kind]}${detail}${e.estimated ? " (estimated)" : ""}`);
  }
  return lines.join("\n");
}
