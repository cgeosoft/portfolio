/**
 * Macro context: US Treasury yield curve, key US economic indicators, the
 * economic calendar of the next 7 days, market risk premium, sector
 * performance and sector P/E, and the risk-free rate.
 *
 * FMP first for every piece. Fallbacks:
 * - yield curve: Yahoo `^IRX` (13-week bill), `^FVX` (5 years), `^TNX`
 *   (10 years) and `^TYX` (30 years);
 * - sector performance: the SPDR sector ETFs (XLK, XLF, ...) through the
 *   quotes chain;
 * - risk-free rate: the 3-month yield of the curve, else `DEFAULT_RISK_FREE_RATE`.
 * Indicators, calendar, risk premium and sector P/E come from FMP only and
 * are null without it.
 *
 * Each piece carries the provider that supplied it. Logs name no symbol,
 * quantity or balance (AGENTS.md rule 3).
 */
import type {
  EconomicEvent,
  EconomicIndicatorId,
  EconomicIndicatorReading,
  MacroSnapshot,
  MarketRiskPremiumRow,
  SectorPerformanceRow,
  YieldCurvePoint,
  YieldCurveSnapshot,
} from "portfolio-shared/api-types";
import type { DataProviderId } from "portfolio-shared/config-types";
import { loadConfig } from "../../config.js";
import { appLogger } from "../../logger.js";
import { FMP_TTL, type FmpService } from "../fmp.js";
import type { YahooFinanceService } from "../yahoo-finance.js";
import type { MarketDataCoordinator } from "../market-data.js";
import { firstAvailable } from "../providers/chain.js";

export interface MacroDeps {
  fmp: FmpService;
  yahoo: YahooFinanceService;
  marketData: MarketDataCoordinator;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TREASURY_TTL_MS = 6 * HOUR_MS;
const RISK_PREMIUM_TTL_MS = 7 * DAY_MS;
const SECTOR_TODAY_TTL_MS = 15 * 60 * 1000;
/** A whole snapshot is kept this long in memory per base currency. */
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

/**
 * Risk-free rate when no provider has the 3-month T-bill yield. The app had
 * no risk-free constant before; 3% is a neutral long-run figure.
 */
export const DEFAULT_RISK_FREE_RATE = 0.03;

const TENORS: ReadonlyArray<{ tenor: string; label: string; years: number }> = [
  { tenor: "month1", label: "1M", years: 1 / 12 },
  { tenor: "month2", label: "2M", years: 2 / 12 },
  { tenor: "month3", label: "3M", years: 0.25 },
  { tenor: "month6", label: "6M", years: 0.5 },
  { tenor: "year1", label: "1Y", years: 1 },
  { tenor: "year2", label: "2Y", years: 2 },
  { tenor: "year3", label: "3Y", years: 3 },
  { tenor: "year5", label: "5Y", years: 5 },
  { tenor: "year7", label: "7Y", years: 7 },
  { tenor: "year10", label: "10Y", years: 10 },
  { tenor: "year20", label: "20Y", years: 20 },
  { tenor: "year30", label: "30Y", years: 30 },
];

/** Yahoo yield indices and the FMP tenor each stands for. */
const YAHOO_YIELDS: ReadonlyArray<{ symbol: string; tenor: string }> = [
  { symbol: "^IRX", tenor: "month3" },
  { symbol: "^FVX", tenor: "year5" },
  { symbol: "^TNX", tenor: "year10" },
  { symbol: "^TYX", tenor: "year30" },
];

const INDICATORS: ReadonlyArray<{ id: EconomicIndicatorId; fmpName: string; name: string; unit: string }> = [
  { id: "gdp", fmpName: "GDP", name: "GDP", unit: "bn USD" },
  { id: "cpi", fmpName: "CPI", name: "CPI", unit: "index" },
  { id: "inflationRate", fmpName: "inflationRate", name: "Inflation rate", unit: "%" },
  { id: "unemploymentRate", fmpName: "unemploymentRate", name: "Unemployment rate", unit: "%" },
  { id: "federalFunds", fmpName: "federalFunds", name: "Fed funds rate", unit: "%" },
];

/** SPDR sector ETFs, named as FMP names the sectors. */
export const SECTOR_ETFS: ReadonlyArray<{ etf: string; sector: string }> = [
  { etf: "XLK", sector: "Technology" },
  { etf: "XLF", sector: "Financial Services" },
  { etf: "XLV", sector: "Healthcare" },
  { etf: "XLE", sector: "Energy" },
  { etf: "XLI", sector: "Industrials" },
  { etf: "XLY", sector: "Consumer Cyclical" },
  { etf: "XLP", sector: "Consumer Defensive" },
  { etf: "XLU", sector: "Utilities" },
  { etf: "XLB", sector: "Basic Materials" },
  { etf: "XLRE", sector: "Real Estate" },
  { etf: "XLC", sector: "Communication Services" },
];

/** Country of the FMP risk premium table for a base currency. EUR maps to Germany. */
const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "United States",
  EUR: "Germany",
  GBP: "United Kingdom",
  CHF: "Switzerland",
  JPY: "Japan",
  CAD: "Canada",
  AUD: "Australia",
  NZD: "New Zealand",
  SEK: "Sweden",
  NOK: "Norway",
  DKK: "Denmark",
  PLN: "Poland",
  CZK: "Czech Republic",
  HUF: "Hungary",
  HKD: "Hong Kong",
  CNY: "China",
  INR: "India",
  KRW: "South Korea",
  SGD: "Singapore",
  BRL: "Brazil",
  MXN: "Mexico",
  ZAR: "South Africa",
  TRY: "Turkey",
};

// ── helpers ────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** One point a week (the last of each 7-day step), always keeping the newest. Oldest first. */
function weekly<T extends { date: string }>(rows: T[]): T[] {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const out: T[] = [];
  let next = "";
  for (const row of sorted) {
    if (row.date >= next) {
      out.push(row);
      next = isoDate(addDays(new Date(`${row.date}T00:00:00Z`), 7));
    }
  }
  const last = sorted[sorted.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/** The most common provider of a map, for a piece built from several quotes. */
function dominantSource(sources: Map<string, DataProviderId>): DataProviderId | null {
  const counts = new Map<DataProviderId, number>();
  for (const s of sources.values()) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: DataProviderId | null = null;
  let max = 0;
  for (const [s, n] of counts) {
    if (n > max) {
      best = s;
      max = n;
    }
  }
  return best;
}

async function settle<T>(step: string, fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const kind = err instanceof Error ? err.name : typeof err;
    appLogger.logStep("warning", "macro", step, `Macro ${step} failed (${kind})`);
    return null;
  }
}

// ── yield curve ────────────────────────────────────────────────────────────

type TreasuryRow = { date: string } & Record<string, unknown>;

async function fmpYieldCurve(fmp: FmpService, forceFresh: boolean): Promise<YieldCurveSnapshot | null> {
  const now = new Date();
  // A month-aligned start keeps the cache key stable for a month.
  const from = `${now.getUTCFullYear() - 1}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const rows = await fmp.get<TreasuryRow[]>("/treasury-rates", { from }, { ttlMs: TREASURY_TTL_MS, forceFresh });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const valid = rows.filter((r) => typeof r.date === "string").map((r) => ({ ...r, date: r.date.slice(0, 10) }));
  const latest = valid.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const points: YieldCurvePoint[] = [];
  for (const t of TENORS) {
    const v = num(latest[t.tenor]);
    if (v !== undefined) points.push({ tenor: t.tenor, label: t.label, years: t.years, yield: v });
  }
  if (points.length === 0) return null;
  const history = weekly(valid).map((r) => ({ date: r.date, month3: num(r.month3), year2: num(r.year2), year10: num(r.year10), year30: num(r.year30) }));
  return { date: latest.date, points, history, source: "fmp" };
}

/** Yahoo quotes yields in percent; very old feeds used ten times that. */
function yahooYield(value: number): number {
  return value > 25 ? value / 10 : value;
}

async function yahooYieldCurve(yahoo: YahooFinanceService, forceFresh: boolean): Promise<YieldCurveSnapshot | null> {
  const charts = await Promise.allSettled(YAHOO_YIELDS.map((y) => yahoo.getChart(y.symbol, "1y", "1d", forceFresh)));
  const byDate = new Map<string, Record<string, number>>();
  const points: YieldCurvePoint[] = [];
  let date = "";
  charts.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const { tenor } = YAHOO_YIELDS[i]!;
    const candles = res.value.candles.filter((c) => Number.isFinite(c.close) && c.close > 0);
    const last = candles[candles.length - 1];
    if (!last) return;
    const meta = TENORS.find((t) => t.tenor === tenor)!;
    points.push({ tenor, label: meta.label, years: meta.years, yield: round(yahooYield(last.close), 3) });
    const d = last.date.slice(0, 10);
    if (d > date) date = d;
    for (const c of candles) {
      const key = c.date.slice(0, 10);
      const row = byDate.get(key) ?? {};
      row[tenor] = round(yahooYield(c.close), 3);
      byDate.set(key, row);
    }
  });
  if (points.length === 0) return null;
  points.sort((a, b) => a.years - b.years);
  const rows = [...byDate.entries()].map(([d, r]) => ({ date: d, month3: r.month3, year10: r.year10, year30: r.year30 }));
  return { date, points, history: weekly(rows), source: "yahoo" };
}

/** Latest US Treasury curve and a year of weekly history. FMP, then Yahoo yield indices. */
export async function getYieldCurve(deps: Pick<MacroDeps, "fmp" | "yahoo">, forceFresh = false): Promise<YieldCurveSnapshot | null> {
  const res = await firstAvailable<YieldCurveSnapshot>({
    category: "treasury",
    isEmpty: (v) => !v.points || v.points.length === 0,
    attempts: [
      { provider: "fmp", isAvailable: () => deps.fmp.isConfigured(), fetch: () => fmpYieldCurve(deps.fmp, forceFresh) },
      { provider: "yahoo", fetch: () => yahooYieldCurve(deps.yahoo, forceFresh) },
    ],
  });
  return res.data;
}

/**
 * The risk-free rate as a decimal (0.042 = 4.2%): the 3-month T-bill yield,
 * else `DEFAULT_RISK_FREE_RATE`.
 */
export async function getRiskFreeRate(deps: Pick<MacroDeps, "fmp" | "yahoo">, curve?: YieldCurveSnapshot | null): Promise<{ rate: number; source: DataProviderId | "default" }> {
  const c = curve === undefined ? await settle("risk_free_rate", () => getYieldCurve(deps)) : curve;
  const bill = c?.points.find((p) => p.tenor === "month3") ?? c?.points.find((p) => p.tenor === "month1") ?? c?.points.find((p) => p.tenor === "month6");
  if (c && bill && bill.yield > -5 && bill.yield < 50) return { rate: round(bill.yield / 100, 5), source: c.source };
  return { rate: DEFAULT_RISK_FREE_RATE, source: "default" };
}

// ── economic indicators ────────────────────────────────────────────────────

/** Latest US readings of GDP, CPI, inflation, unemployment and the fed funds rate. FMP only. */
export async function getEconomicIndicators(fmp: FmpService, forceFresh = false): Promise<{ items: EconomicIndicatorReading[]; source: DataProviderId } | null> {
  if (!fmp.isConfigured()) return null;
  const from = `${new Date().getUTCFullYear() - 2}-01-01`;
  const results = await Promise.all(
    INDICATORS.map(async (ind) => {
      const rows = await fmp.get<Array<{ name?: string; date?: string; value?: number }>>("/economic-indicators", { name: ind.fmpName, from }, { ttlMs: FMP_TTL.fundamentals, forceFresh });
      if (!Array.isArray(rows)) return null;
      const valid = rows
        .filter((r) => typeof r.date === "string" && num(r.value) !== undefined)
        .map((r) => ({ date: r.date!.slice(0, 10), value: r.value! }))
        .sort((a, b) => b.date.localeCompare(a.date));
      const latest = valid[0];
      if (!latest) return null;
      const prev = valid[1];
      const reading: EconomicIndicatorReading = { id: ind.id, name: ind.name, unit: ind.unit, value: round(latest.value, 3), date: latest.date };
      if (prev) {
        reading.previous = round(prev.value, 3);
        reading.previousDate = prev.date;
      }
      return reading;
    }),
  );
  const items = results.filter((r): r is EconomicIndicatorReading => r !== null);
  return items.length > 0 ? { items, source: "fmp" } : null;
}

// ── economic calendar ──────────────────────────────────────────────────────

const MAX_EVENTS = 30;

/**
 * Releases of the next `days` days that matter to the user: high or medium
 * impact in the base currency or USD, plus high impact anywhere in the euro
 * area, the UK, Japan and China. FMP only.
 */
export async function getEconomicCalendar(
  fmp: FmpService,
  baseCurrency: string,
  days = 7,
  forceFresh = false,
): Promise<{ from: string; to: string; events: EconomicEvent[]; source: DataProviderId } | null> {
  if (!fmp.isConfigured()) return null;
  const now = new Date();
  const from = isoDate(now);
  const to = isoDate(addDays(now, days));
  const rows = await fmp.get<Array<Record<string, unknown>>>("/economic-calendar", { from, to }, { ttlMs: FMP_TTL.calendar, forceFresh });
  if (!Array.isArray(rows)) return null;

  const base = baseCurrency.trim().toUpperCase();
  const home = new Set([base, "USD"]);
  const majors = new Set(["USD", "EUR", "GBP", "JPY", "CNY"]);

  const events: EconomicEvent[] = [];
  for (const r of rows) {
    const date = typeof r.date === "string" ? r.date : "";
    const event = typeof r.event === "string" ? r.event : "";
    if (!date || !event || date.slice(0, 10) < from) continue;
    const currency = typeof r.currency === "string" ? r.currency.toUpperCase() : "";
    const impact = typeof r.impact === "string" ? r.impact : "";
    const relevant = (home.has(currency) && (impact === "High" || impact === "Medium")) || (majors.has(currency) && impact === "High");
    if (!relevant) continue;
    events.push({
      date,
      country: typeof r.country === "string" ? r.country : "",
      currency,
      event,
      impact,
      previous: num(r.previous) ?? null,
      estimate: num(r.estimate) ?? null,
      actual: num(r.actual) ?? null,
      unit: typeof r.unit === "string" ? r.unit : null,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.impact === "High" ? -1 : 1));
  // Over the cap, keep every high-impact release first.
  let kept = events;
  if (events.length > MAX_EVENTS) {
    const high = events.filter((e) => e.impact === "High").slice(0, MAX_EVENTS);
    const rest = events.filter((e) => e.impact !== "High").slice(0, MAX_EVENTS - high.length);
    kept = [...high, ...rest].sort((a, b) => a.date.localeCompare(b.date));
  }
  return { from, to, events: kept, source: "fmp" };
}

// ── market risk premium ────────────────────────────────────────────────────

/** Equity risk premium of the United States and of the base currency's country. FMP only. */
export async function getMarketRiskPremium(fmp: FmpService, baseCurrency: string, forceFresh = false): Promise<{ items: MarketRiskPremiumRow[]; source: DataProviderId } | null> {
  if (!fmp.isConfigured()) return null;
  const rows = await fmp.get<Array<Record<string, unknown>>>("/market-risk-premium", {}, { ttlMs: RISK_PREMIUM_TTL_MS, forceFresh });
  if (!Array.isArray(rows)) return null;
  const wanted = ["United States", CURRENCY_COUNTRY[baseCurrency.trim().toUpperCase()]].filter((c): c is string => Boolean(c));
  const items: MarketRiskPremiumRow[] = [];
  for (const country of new Set(wanted)) {
    const row = rows.find((r) => typeof r.country === "string" && r.country.toLowerCase() === country.toLowerCase());
    const total = num(row?.totalEquityRiskPremium);
    if (!row || total === undefined) continue;
    items.push({ country, totalEquityRiskPremium: round(total), countryRiskPremium: round(num(row.countryRiskPremium) ?? 0) });
  }
  return items.length > 0 ? { items, source: "fmp" } : null;
}

// ── sectors ────────────────────────────────────────────────────────────────

/** The last `count` weekdays up to today (UTC), newest first. */
function recentWeekdays(count: number): string[] {
  const out: string[] = [];
  let d = new Date();
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(isoDate(d));
    d = addDays(d, -1);
  }
  return out;
}

/** Mean of a numeric field per sector across exchanges. */
function averageBySector(rows: Array<Record<string, unknown>>, field: string, accept: (v: number) => boolean): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const sector = typeof r.sector === "string" ? r.sector : "";
    const v = num(r[field]);
    if (!sector || v === undefined || !accept(v)) continue;
    const s = sums.get(sector) ?? { sum: 0, n: 0 };
    s.sum += v;
    s.n += 1;
    sums.set(sector, s);
  }
  const out = new Map<string, number>();
  for (const [sector, s] of sums) out.set(sector, s.sum / s.n);
  return out;
}

async function fmpSectorSnapshot(fmp: FmpService, path: string, field: string, accept: (v: number) => boolean, forceFresh: boolean): Promise<{ date: string; values: Map<string, number> } | null> {
  const today = isoDate(new Date());
  for (const date of recentWeekdays(4)) {
    const rows = await fmp.get<Array<Record<string, unknown>>>(path, { date }, { ttlMs: date === today ? SECTOR_TODAY_TTL_MS : FMP_TTL.fundamentals, forceFresh });
    if (rows === null) return null; // not in the plan or no key: stop asking
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const values = averageBySector(rows, field, accept);
    if (values.size > 0) return { date, values };
  }
  return null;
}

async function etfSectorPerformance(marketData: MarketDataCoordinator, forceFresh: boolean): Promise<{ date: string; items: SectorPerformanceRow[]; source: DataProviderId } | null> {
  const res = await marketData.getQuotesWithSource(SECTOR_ETFS.map((s) => s.etf), forceFresh);
  const items: SectorPerformanceRow[] = [];
  let date = "";
  for (const s of SECTOR_ETFS) {
    const q = res.data.get(s.etf);
    const change = num(q?.regularMarketChangePercent);
    if (!q || change === undefined) continue;
    items.push({ sector: s.sector, changePercent: round(change), etf: s.etf });
    const d = (q.updatedAt || "").slice(0, 10);
    if (d > date) date = d;
  }
  const source = dominantSource(res.sources);
  if (items.length === 0 || !source) return null;
  return { date: date || isoDate(new Date()), items, source };
}

/**
 * Average daily change per sector (FMP snapshot of the latest trading day)
 * with the sector P/E when FMP has it; else the day change of the SPDR
 * sector ETFs. Sorted best first.
 */
export async function getSectorPerformance(deps: Pick<MacroDeps, "fmp" | "marketData">, forceFresh = false): Promise<MacroSnapshot["sectors"]> {
  let result: MacroSnapshot["sectors"] = null;
  if (deps.fmp.isConfigured()) {
    const perf = await settle("sector_performance", () => fmpSectorSnapshot(deps.fmp, "/sector-performance-snapshot", "averageChange", (v) => Math.abs(v) < 50, forceFresh));
    if (perf) {
      result = { date: perf.date, items: [...perf.values].map(([sector, change]) => ({ sector, changePercent: round(change) })), source: "fmp" };
    }
  }
  if (!result) result = await settle("sector_etfs", () => etfSectorPerformance(deps.marketData, forceFresh));
  if (!result) return null;

  if (deps.fmp.isConfigured()) {
    const pe = await settle("sector_pe", () => fmpSectorSnapshot(deps.fmp, "/sector-pe-snapshot", "pe", (v) => v > 0 && v < 500, forceFresh));
    if (pe) {
      for (const item of result.items) {
        const v = pe.values.get(item.sector);
        if (v !== undefined) item.pe = round(v, 1);
      }
      if (result.items.some((i) => i.pe !== undefined)) result.peSource = "fmp";
    }
  }
  result.items.sort((a, b) => b.changePercent - a.changePercent);
  return result;
}

// ── snapshot ───────────────────────────────────────────────────────────────

const snapshotCache = new Map<string, { at: number; data: MacroSnapshot }>();
const snapshotInFlight = new Map<string, Promise<MacroSnapshot>>();

/**
 * Every macro piece in one call, for the Markets card, reports and the
 * assistant. `baseCurrency` defaults to the settings; it picks the calendar
 * currencies and the risk premium country. Kept in memory for 10 minutes.
 */
export async function getMacroSnapshot(deps: MacroDeps, options: { baseCurrency?: string; forceFresh?: boolean } = {}): Promise<MacroSnapshot> {
  const baseCurrency = (options.baseCurrency || loadConfig().baseCurrency || "USD").trim().toUpperCase();
  const forceFresh = Boolean(options.forceFresh);
  const cached = snapshotCache.get(baseCurrency);
  if (!forceFresh && cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.data;
  const pending = snapshotInFlight.get(baseCurrency);
  if (pending) return pending;

  const run = (async (): Promise<MacroSnapshot> => {
    const [yieldCurve, indicators, calendar, riskPremium, sectors] = await Promise.all([
      settle("yield_curve", () => getYieldCurve(deps, forceFresh)),
      settle("indicators", () => getEconomicIndicators(deps.fmp, forceFresh)),
      settle("calendar", () => getEconomicCalendar(deps.fmp, baseCurrency, 7, forceFresh)),
      settle("risk_premium", () => getMarketRiskPremium(deps.fmp, baseCurrency, forceFresh)),
      getSectorPerformance(deps, forceFresh),
    ]);
    const riskFreeRate = await getRiskFreeRate(deps, yieldCurve);
    const data: MacroSnapshot = { asOf: new Date().toISOString(), baseCurrency, yieldCurve, indicators, calendar, riskPremium, sectors, riskFreeRate };
    snapshotCache.set(baseCurrency, { at: Date.now(), data });
    return data;
  })().finally(() => snapshotInFlight.delete(baseCurrency));
  snapshotInFlight.set(baseCurrency, run);
  return run;
}
