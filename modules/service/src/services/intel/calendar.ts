/**
 * Dividends, splits and earnings per symbol.
 *
 * Each kind of data goes through the provider chain (`firstAvailable`), so
 * the best provider that has it wins and the result names its source:
 *
 * - dividends: FMP `/dividends`, then Yahoo chart events (`events=div`) with
 *   the declared ex-date and pay date of Yahoo `calendarEvents`;
 * - splits: FMP `/splits`, then Yahoo chart events (`events=splits`);
 * - earnings: FMP `/earnings`, then Finnhub `/calendar/earnings` (free plan),
 *   then Yahoo `calendarEvents` (next date and estimates only).
 *
 * Per-symbol endpoints only: a portfolio holds a few dozen symbols and every
 * answer is cached for 12 hours, so the market-wide calendars would not save
 * calls. Symbols never reach a log line (AGENTS.md rule 3).
 */
import { mapWithConcurrencyLimit, type YahooCorporateEvents, type YahooFinanceService } from "../yahoo-finance.js";
import type { FinnhubService } from "../finnhub.js";
import { FMP_TTL, toFmpSymbol, type FmpService } from "../fmp.js";
import { firstAvailable } from "../providers/chain.js";
import type { DividendEvent, DividendFrequency, EarningsEvent, SplitEvent, SymbolCalendar } from "portfolio-shared/api-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_TTL_MS = 12 * 60 * 60 * 1000;
/** Symbols resolved at the same time; each runs up to three chains. */
const SYMBOL_CONCURRENCY = 4;
/** Earnings rows asked from Finnhub around today. */
const FINNHUB_EARNINGS_WINDOW_DAYS = 200;

// ── FMP rows ────────────────────────────────────────────────────────────────

interface FmpDividendRow {
  symbol?: string;
  date?: string;
  recordDate?: string;
  paymentDate?: string;
  declarationDate?: string;
  adjDividend?: number;
  dividend?: number;
  yield?: number;
  frequency?: string;
}

interface FmpSplitRow {
  symbol?: string;
  date?: string;
  numerator?: number;
  denominator?: number;
  splitType?: string;
}

interface FmpEarningsRow {
  symbol?: string;
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
}

// ── dates ───────────────────────────────────────────────────────────────────

/** Local calendar date, YYYY-MM-DD. */
export function isoDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `date` (YYYY-MM-DD) plus `days` calendar days. */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

/** `date` plus `months` calendar months; the day is clamped to the end of a shorter month. */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(y, m - 1 + months, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return isoDay(target);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / DAY_MS);
}

const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
const dateOnly = (value: string) => value.slice(0, 10);
const optDate = (value: unknown) => (validDate(value) ? dateOnly(value) : undefined);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A Yahoo `quoteSummary` value: a number, or `{ raw }` when formatted. */
function rawNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "raw" in value) return finite((value as { raw: unknown }).raw);
  return null;
}

const fromUnix = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 10);

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ── dividend frequency and projection ───────────────────────────────────────

const MONTHS_PER_PAYMENT: Record<Exclude<DividendFrequency, "irregular">, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** Maps a provider label ("Quarterly", "Semi-Annual", ...) to a frequency; undefined when unknown. */
export function mapFrequency(label: string | undefined | null): DividendFrequency | undefined {
  const l = (label || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!l) return undefined;
  if (l.startsWith("month")) return "monthly";
  if (l.startsWith("quarter")) return "quarterly";
  if (l.startsWith("semi") || l.startsWith("biannual") || l === "halfyearly") return "semiannual";
  if (l.startsWith("annual") || l === "yearly") return "annual";
  if (l.startsWith("irregular") || l.startsWith("special") || l === "other" || l === "unknown") return "irregular";
  return undefined;
}

/** The frequency from the gaps between the ex-dates of the last three years; undefined with fewer than two. */
export function inferFrequency(exDates: string[]): DividendFrequency | undefined {
  const sorted = [...exDates].sort();
  const last = sorted[sorted.length - 1];
  if (!last) return undefined;
  const recent = sorted.filter((d) => daysBetween(d, last) <= 3 * 365);
  if (recent.length < 2) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(daysBetween(recent[i - 1]!, recent[i]!));
  const gap = median(gaps.filter((g) => g > 0));
  if (gap === undefined) return undefined;
  if (gap <= 45) return "monthly";
  if (gap <= 120) return "quarterly";
  if (gap <= 240) return "semiannual";
  if (gap <= 420) return "annual";
  return "irregular";
}

/**
 * Dividends expected after the last known one, up to `until` (ex-date,
 * inclusive), following the frequency, with the last amount and the usual
 * gap between ex-date and pay date. Every result has `estimated: true`.
 * Empty for an irregular or unknown frequency, and when the last dividend is
 * so old that the payments look suspended.
 */
export function projectDividends(history: DividendEvent[], frequency: DividendFrequency | undefined, until: string, today = isoDay()): DividendEvent[] {
  if (!frequency || frequency === "irregular" || history.length === 0) return [];
  const step = MONTHS_PER_PAYMENT[frequency];
  const last = history[history.length - 1]!;
  const intervalDays = step * 30.44;
  if (daysBetween(last.exDate, today) > intervalDays * 1.5 + 31) return [];

  const lags = history
    .slice(-8)
    .filter((d) => d.payDate)
    .map((d) => daysBetween(d.exDate, d.payDate!))
    .filter((lag) => lag >= 0 && lag <= 120);
  const lag = median(lags);

  const out: DividendEvent[] = [];
  for (let k = 1; k <= 60; k++) {
    const exDate = addMonthsIso(last.exDate, step * k);
    if (exDate > until) break;
    out.push({
      exDate,
      payDate: lag !== undefined ? addDaysIso(exDate, Math.round(lag)) : undefined,
      amount: last.amount,
      estimated: true,
    });
  }
  return out;
}

// ── earnings ────────────────────────────────────────────────────────────────

function surprise(actual: number | null | undefined, estimate: number | null | undefined): number | null {
  if (typeof actual !== "number" || typeof estimate !== "number" || estimate === 0) return null;
  return Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(2));
}

/** The next report from today on, and the latest past report (with an actual EPS when one exists). */
export function pickEarnings(events: EarningsEvent[], today = isoDay()): { upcoming?: EarningsEvent; last?: EarningsEvent } {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.find((e) => e.date >= today);
  const past = sorted.filter((e) => e.date < today);
  const last = [...past].reverse().find((e) => typeof e.epsActual === "number") ?? past[past.length - 1];
  return { upcoming, last };
}

// ── service ─────────────────────────────────────────────────────────────────

export interface CalendarOptions {
  /** Whether to resolve earnings (stocks); funds and ETFs report none. Default true. */
  earnings?: boolean;
}

const emptyCalendar = (symbol: string): SymbolCalendar => ({
  symbol,
  dividends: { history: [], upcoming: [], source: null },
  splits: { history: [], upcoming: [], source: null },
  earnings: { source: null },
});

export class CalendarService {
  constructor(
    private readonly fmp: FmpService,
    private readonly yahoo: YahooFinanceService,
    private readonly finnhub: FinnhubService,
  ) {}

  /** Calendars of many symbols, keyed by the symbol as given. A symbol that fails gets an empty calendar. */
  public async getCalendars(symbols: string[], options: (symbol: string) => CalendarOptions = () => ({})): Promise<Map<string, SymbolCalendar>> {
    const out = new Map<string, SymbolCalendar>();
    const unique = Array.from(new Set(symbols.filter(Boolean)));
    await mapWithConcurrencyLimit(unique, SYMBOL_CONCURRENCY, async (symbol) => {
      try {
        out.set(symbol, await this.getSymbolCalendar(symbol, options(symbol)));
      } catch {
        out.set(symbol, emptyCalendar(symbol));
      }
    });
    return out;
  }

  /** Dividends, splits and (unless switched off) earnings of one symbol. */
  public async getSymbolCalendar(symbol: string, options: CalendarOptions = {}): Promise<SymbolCalendar> {
    const sym = symbol.trim().toUpperCase();
    const today = isoDay();

    // One Yahoo chart call serves both dividends and splits; one quoteSummary call both dividends and earnings.
    let eventsPromise: Promise<YahooCorporateEvents | null> | null = null;
    const yahooEvents = () => (eventsPromise ??= this.yahoo.getCorporateEvents(sym).catch(() => null));
    let summaryPromise: Promise<Record<string, unknown> | null> | null = null;
    const yahooCalendar = () =>
      (summaryPromise ??= this.yahoo
        .getQuoteSummary(sym, ["calendarEvents"], CALENDAR_TTL_MS)
        .then((r) => ((r?.calendarEvents as Record<string, unknown> | undefined) ?? null))
        .catch(() => null));

    const [dividends, splits, earnings] = await Promise.all([
      this.resolveDividends(sym, yahooEvents, yahooCalendar),
      this.resolveSplits(sym, yahooEvents),
      options.earnings === false ? Promise.resolve({ data: null, source: null }) : this.resolveEarnings(sym, today, yahooCalendar),
    ]);

    const history = dividends.data?.history ?? [];
    const splitRows = splits.data ?? [];
    return {
      symbol: sym,
      dividends: {
        history,
        upcoming: history.filter((d) => d.exDate >= today || (d.payDate !== undefined && d.payDate >= today)),
        frequency: dividends.data ? (dividends.data.frequency ?? inferFrequency(history.map((d) => d.exDate))) : undefined,
        source: history.length > 0 ? dividends.source : null,
      },
      splits: {
        history: splitRows.filter((s) => s.date <= today),
        upcoming: splitRows.filter((s) => s.date > today),
        source: splitRows.length > 0 ? splits.source : null,
      },
      earnings: {
        upcoming: earnings.data?.upcoming,
        last: earnings.data?.last,
        source: earnings.data && (earnings.data.upcoming || earnings.data.last) ? earnings.source : null,
      },
    };
  }

  private resolveDividends(
    sym: string,
    yahooEvents: () => Promise<YahooCorporateEvents | null>,
    yahooCalendar: () => Promise<Record<string, unknown> | null>,
  ) {
    return firstAvailable<{ history: DividendEvent[]; frequency?: DividendFrequency }>({
      category: "dividends",
      isEmpty: (v) => v.history.length === 0,
      attempts: [
        {
          provider: "fmp",
          isAvailable: () => this.fmp.isConfigured(),
          fetch: async () => {
            const rows = await this.fmp.get<FmpDividendRow[]>("/dividends", { symbol: toFmpSymbol(sym), limit: 40 }, FMP_TTL.calendar);
            if (!Array.isArray(rows)) return null;
            const valid = rows.filter((r) => validDate(r.date) && ((finite(r.adjDividend) ?? 0) > 0 || (finite(r.dividend) ?? 0) > 0));
            const history = valid
              .map(
                (r): DividendEvent => ({
                  exDate: dateOnly(r.date!),
                  payDate: optDate(r.paymentDate),
                  recordDate: optDate(r.recordDate),
                  declarationDate: optDate(r.declarationDate),
                  // The split-adjusted amount matches today's share count.
                  amount: (finite(r.adjDividend) ?? 0) > 0 ? r.adjDividend! : r.dividend!,
                }),
              )
              .sort((a, b) => a.exDate.localeCompare(b.exDate));
            const latest = [...valid].sort((a, b) => b.date!.localeCompare(a.date!))[0];
            return { history, frequency: mapFrequency(latest?.frequency) };
          },
        },
        {
          provider: "yahoo",
          fetch: async () => {
            const events = await yahooEvents();
            if (!events) return null;
            const history: DividendEvent[] = events.dividends.map((d) => ({ exDate: d.date, amount: d.amount }));
            if (history.length === 0) return { history };
            // calendarEvents names the latest declared ex-date and pay date.
            const cal = await yahooCalendar();
            const exSecs = rawNumber(cal?.exDividendDate);
            const paySecs = rawNumber(cal?.dividendDate);
            if (exSecs) {
              const exDate = fromUnix(exSecs);
              const payDate = paySecs ? fromUnix(paySecs) : undefined;
              const last = history[history.length - 1]!;
              if (exDate === last.exDate) last.payDate = payDate && payDate >= exDate ? payDate : undefined;
              else if (exDate > last.exDate) {
                // A declared date with the amount not yet known: the last amount stands in.
                history.push({ exDate, payDate: payDate && payDate >= exDate ? payDate : undefined, amount: last.amount, estimated: true });
              }
            }
            return { history };
          },
        },
      ],
    });
  }

  private resolveSplits(sym: string, yahooEvents: () => Promise<YahooCorporateEvents | null>) {
    return firstAvailable<SplitEvent[]>({
      category: "splits",
      attempts: [
        {
          provider: "fmp",
          isAvailable: () => this.fmp.isConfigured(),
          fetch: async () => {
            const rows = await this.fmp.get<FmpSplitRow[]>("/splits", { symbol: toFmpSymbol(sym), limit: 30 }, FMP_TTL.calendar);
            if (!Array.isArray(rows)) return null;
            return rows
              .filter((r) => validDate(r.date) && (finite(r.numerator) ?? 0) > 0 && (finite(r.denominator) ?? 0) > 0)
              .map((r) => ({ date: dateOnly(r.date!), numerator: r.numerator!, denominator: r.denominator! }))
              .sort((a, b) => a.date.localeCompare(b.date));
          },
        },
        {
          provider: "yahoo",
          fetch: async () => (await yahooEvents())?.splits ?? null,
        },
      ],
    });
  }

  private resolveEarnings(sym: string, today: string, yahooCalendar: () => Promise<Record<string, unknown> | null>) {
    return firstAvailable<{ upcoming?: EarningsEvent; last?: EarningsEvent }>({
      category: "earnings",
      isEmpty: (v) => !v.upcoming && !v.last,
      attempts: [
        {
          provider: "fmp",
          isAvailable: () => this.fmp.isConfigured(),
          fetch: async () => {
            const rows = await this.fmp.get<FmpEarningsRow[]>("/earnings", { symbol: toFmpSymbol(sym), limit: 12 }, FMP_TTL.calendar);
            if (!Array.isArray(rows)) return null;
            const events = rows
              .filter((r) => validDate(r.date))
              .map(
                (r): EarningsEvent => ({
                  date: dateOnly(r.date!),
                  epsEstimate: finite(r.epsEstimated),
                  epsActual: finite(r.epsActual),
                  surprisePercent: surprise(finite(r.epsActual), finite(r.epsEstimated)),
                  revenueEstimate: finite(r.revenueEstimated),
                  revenueActual: finite(r.revenueActual),
                }),
              );
            return pickEarnings(events, today);
          },
        },
        {
          provider: "finnhub",
          isAvailable: () => this.finnhub.isConfigured(),
          fetch: async () => {
            const rows = await this.finnhub.getEarningsCalendar(
              sym,
              addDaysIso(today, -FINNHUB_EARNINGS_WINDOW_DAYS),
              addDaysIso(today, FINNHUB_EARNINGS_WINDOW_DAYS),
            );
            const events = rows.map(
              (r): EarningsEvent => ({
                date: dateOnly(r.date),
                epsEstimate: finite(r.epsEstimate),
                epsActual: finite(r.epsActual),
                surprisePercent: surprise(finite(r.epsActual), finite(r.epsEstimate)),
                revenueEstimate: finite(r.revenueEstimate),
                revenueActual: finite(r.revenueActual),
                time: r.hour === "bmo" || r.hour === "amc" ? r.hour : undefined,
              }),
            );
            return pickEarnings(events, today);
          },
        },
        {
          provider: "yahoo",
          fetch: async () => {
            const cal = await yahooCalendar();
            const earnings = cal?.earnings as Record<string, unknown> | undefined;
            const dates = Array.isArray(earnings?.earningsDate) ? (earnings!.earningsDate as unknown[]) : [];
            const secs = dates.map(rawNumber).filter((n): n is number => n !== null).sort((a, b) => a - b)[0];
            if (!secs) return null;
            const date = fromUnix(secs);
            if (date < today) return null;
            return {
              upcoming: {
                date,
                epsEstimate: rawNumber(earnings?.earningsAverage),
                revenueEstimate: rawNumber(earnings?.revenueAverage),
              },
            };
          },
        },
      ],
    });
  }
}
