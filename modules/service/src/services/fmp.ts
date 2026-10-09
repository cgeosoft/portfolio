/**
 * Financial Modeling Prep (FMP) REST client, https://financialmodelingprep.com/stable.
 *
 * Every call goes through `get()`, which:
 * - reads the key from the settings (`fmpApiKey`) and sends it in the
 *   `apikey` header, so URLs and logs never carry it;
 * - caches the JSON in `market_cache` under `fmp:<path>?<sorted params>` for
 *   the TTL the caller passes (see `FMP_TTL`);
 * - shares one in-flight request between identical callers;
 * - runs through one throttle for the whole app (`FMP_THROTTLE`), far below
 *   the plan limit of 3000 calls a minute;
 * - remembers an endpoint the plan does not include (HTTP 402/403, or a
 *   "Restricted"/"Premium" message) for `FMP_TTL.restricted` and returns null,
 *   so the provider chain falls back to the next provider;
 * - returns an expired cache entry when FMP fails for a transient reason.
 *
 * Logs name the endpoint path only: never the key, a symbol, a quantity or a
 * balance (AGENTS.md rule 3).
 *
 * Other modules add endpoints in their own files on top of `get()`:
 *
 * ```ts
 * import { FMP_TTL, toFmpSymbol, type FmpService } from "./fmp";
 * export function getEtfHoldings(fmp: FmpService, symbol: string) {
 *   return fmp.get<FmpEtfHolding[]>("/etf/holdings", { symbol: toFmpSymbol(symbol) }, FMP_TTL.etfHoldings);
 * }
 *
 * Then resolve it through `firstAvailable()` in ./providers/chain so a
 * missing key or plan falls back to another provider.
 * ```
 */
import * as marketCache from "../db/market-cache.repo.js";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import { mapWithConcurrencyLimit, type YahooChartCandle, type YahooChartData, type YahooQuote, type YahooSymbolSearchResult } from "./yahoo-finance.js";
import { RequestThrottle } from "./providers/throttle.js";
import { isCusip, isIsin } from "./providers/identifiers.js";
import type { MarketNewsItem } from "./providers/types.js";

export const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Cache lifetimes per kind of data. Pass one of these as `ttlMs` to `get()`. */
export const FMP_TTL = {
  /** Live quotes, the same as the Finnhub quote TTL. */
  quote: 5 * MINUTE,
  /** The forex quote list behind FX rates. */
  forex: 15 * MINUTE,
  /** Intraday candles. */
  intraday: 5 * MINUTE,
  /** End-of-day candles, the same as the Yahoo chart TTL. */
  chart: HOUR,
  /** Market caps. */
  marketCap: HOUR,
  /** General and stock news. */
  news: 30 * MINUTE,
  /** Calendars: earnings, dividends, splits, IPOs, economic releases. */
  calendar: 12 * HOUR,
  /** Company profiles. */
  profile: DAY,
  /** Statements, ratios, key metrics, ratings, estimates. */
  fundamentals: DAY,
  /** Symbol, name, ISIN and CUSIP search. */
  search: DAY,
  /** ETF and fund holdings, sector and country weights. */
  etfHoldings: 7 * DAY,
  /** Trading currency of a symbol (from its profile). */
  currency: 30 * DAY,
  /** How long an endpoint outside the plan is skipped. */
  restricted: DAY,
} as const;

/** One throttle for every FMP call: 6 in flight and 300 a minute (the plan allows 3000). */
export const FMP_THROTTLE = { maxConcurrent: 6, maxPerWindow: 300, windowMs: MINUTE } as const;

/** Symbols per batch call (batch quote, batch market cap). */
export const FMP_BATCH_SIZE = 50;

const REQUEST_TIMEOUT_MS = 10_000;
/** Pause after HTTP 429 before the next call. */
const RATE_LIMIT_PAUSE_MS = 30_000;
/** Pause after HTTP 401 before the stored key is tried again. */
const AUTH_FAILURE_PAUSE_MS = 5 * MINUTE;
/** Repeated warnings of the same kind and path are logged once per window. */
const LOG_REPEAT_MS = 10 * MINUTE;

export type FmpParamValue = string | number | boolean | undefined | null;
export type FmpParams = Record<string, FmpParamValue>;

export interface FmpRequestOptions {
  /** Cache lifetime in ms; 0 disables the cache for this call. */
  ttlMs: number;
  /** Skip a fresh cache entry. The call is still throttled and shared. */
  forceFresh?: boolean;
  /** Return an expired cache entry when FMP fails for a transient reason. Default true. */
  staleOnError?: boolean;
  /** Use this key instead of the stored one (Settings → Test). Disables the cache. */
  apiKey?: string;
}

/** `/quote` and `/batch-quote` row. FMP sends no currency; see `FmpService.getQuotes`. */
export interface FmpQuote {
  symbol: string;
  name?: string;
  price: number;
  changePercentage?: number;
  change?: number;
  volume?: number;
  dayLow?: number;
  dayHigh?: number;
  yearHigh?: number;
  yearLow?: number;
  marketCap?: number | null;
  priceAvg50?: number;
  priceAvg200?: number;
  exchange?: string;
  open?: number;
  previousClose?: number;
  /** Unix seconds. */
  timestamp?: number;
}

/** `/batch-forex-quotes?short=true` row. `price` is the quote currency per unit of the base (EURUSD: USD per EUR). */
export interface FmpForexQuoteShort {
  symbol: string;
  price: number;
  change?: number;
  volume?: number;
}

/** One end-of-day bar, the same shape for every adjustment. Dates are "YYYY-MM-DD". */
export interface FmpEodBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * `split`: split-adjusted prices (`/historical-price-eod/full`, like Yahoo's close).
 * `dividend`: split and dividend adjusted (`/historical-price-eod/dividend-adjusted`).
 * `none`: as traded (`/historical-price-eod/non-split-adjusted`).
 */
export type FmpEodAdjustment = "split" | "dividend" | "none";

export interface FmpCompanyProfile {
  symbol: string;
  companyName?: string;
  price?: number;
  marketCap?: number;
  beta?: number;
  lastDividend?: number;
  range?: string;
  change?: number;
  changePercentage?: number;
  volume?: number;
  averageVolume?: number;
  currency?: string;
  cik?: string;
  isin?: string;
  cusip?: string;
  exchangeFullName?: string;
  exchange?: string;
  industry?: string;
  website?: string;
  description?: string;
  ceo?: string;
  sector?: string;
  country?: string;
  fullTimeEmployees?: string;
  image?: string;
  ipoDate?: string;
  isEtf?: boolean;
  isActivelyTrading?: boolean;
  isAdr?: boolean;
  isFund?: boolean;
  [key: string]: unknown;
}

export interface FmpSymbolSearchRow {
  symbol: string;
  name?: string;
  currency?: string;
  exchangeFullName?: string;
  exchange?: string;
}

export interface FmpIsinRow {
  symbol: string;
  name?: string;
  isin?: string;
  marketCap?: number;
}

export interface FmpCusipRow {
  symbol: string;
  companyName?: string;
  cusip?: string;
  marketCap?: number;
}

export interface FmpMarketCapRow {
  symbol: string;
  date?: string;
  marketCap: number;
}

/** `/news/general-latest`, `/news/stock-latest` and `/news/stock` row. */
export interface FmpNewsArticle {
  symbol?: string | null;
  /** "YYYY-MM-DD HH:mm:ss". */
  publishedDate: string;
  publisher?: string;
  title: string;
  image?: string;
  site?: string;
  text?: string;
  url?: string;
}

export interface FmpNewsQuery {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

const CRYPTO_QUOTES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "USDT", "USDC", "BTC", "ETH"]);

/**
 * The FMP form of an app (Yahoo-style) symbol: "BTC-USD" → "BTCUSD",
 * "EURUSD=X" → "EURUSD". Stocks, ETFs and indices ("AAPL", "VOD.L",
 * "BRK-B", "^GSPC") are the same in both.
 */
export function toFmpSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const fx = /^([A-Z]{6})=X$/.exec(s);
  if (fx) return fx[1]!;
  const crypto = /^([A-Z0-9]{2,10})-([A-Z]{3,4})$/.exec(s);
  if (crypto && CRYPTO_QUOTES.has(crypto[2]!)) return `${crypto[1]}${crypto[2]}`;
  return s;
}

/** The currency a symbol is quoted in when the symbol itself says so (FX pair, crypto pair). */
function currencyFromSymbol(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  const fx = /^[A-Z]{3}([A-Z]{3})=X$/.exec(s);
  if (fx) return fx[1]!;
  const crypto = /^[A-Z0-9]{2,10}-([A-Z]{3,4})$/.exec(s);
  if (crypto && CRYPTO_QUOTES.has(crypto[1]!)) return crypto[1]!;
  return null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First day of a Yahoo-style range ("5d", "1mo", "1y", "ytd", "max"), or undefined for an unknown range. */
function rangeStart(range: string, now = new Date()): string | null | undefined {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const m = /^(\d+)(d|mo|y)$/.exec(range);
  if (range === "max") return null;
  if (range === "ytd") return `${d.getUTCFullYear()}-01-01`;
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2] === "d") d.setUTCDate(d.getUTCDate() - Math.max(7, n * 2));
  else if (m[2] === "mo") d.setUTCMonth(d.getUTCMonth() - n);
  else d.setUTCFullYear(d.getUTCFullYear() - n);
  return isoDate(d);
}

/** "YYYY-MM-DD HH:mm:ss" (FMP news) to Unix seconds. */
function publishedToUnix(value: string): number {
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Removes the key from a URL or message before it reaches a log or an error. */
export function redactFmpSecrets(text: string, apiKey?: string): string {
  let out = text.replace(/([?&]apikey=)[^&\s"']*/gi, "$1***");
  if (apiKey && apiKey.length >= 4) out = out.split(apiKey).join("***");
  return out;
}

type FetchOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "restricted"; scope: "endpoint" | "request" }
  | { kind: "auth" }
  | { kind: "rate_limited" }
  | { kind: "error"; message: string };

const RESTRICTED_PATTERN = /restricted|premium|subscription|upgrade your plan|exclusive endpoint|not available under/i;

export class FmpService {
  private static readonly throttle = new RequestThrottle(FMP_THROTTLE);
  private static readonly inFlight = new Map<string, Promise<unknown>>();
  private static readonly lastLogged = new Map<string, number>();
  private static authFailedKey = "";
  private static authFailedUntil = 0;

  private readonly baseUrl: string;

  constructor(baseUrl: string = FMP_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** The key to use: the override when given, else the stored one. */
  public getApiKey(overrideKey?: string): string {
    if (overrideKey && overrideKey.trim()) return overrideKey.trim();
    return (loadConfig().fmpApiKey || "").trim();
  }

  /** Whether an FMP key is stored. */
  public isConfigured(overrideKey?: string): boolean {
    return this.getApiKey(overrideKey).length > 0;
  }

  /** Throttle state, for diagnostics. */
  public throttleStats(): { active: number; queued: number; inWindow: number } {
    return FmpService.throttle.stats();
  }

  // ---------------------------------------------------------------- core

  /**
   * GET `path` (relative to /stable, with a leading slash) and return the
   * parsed JSON. Null when no key is set, the endpoint is not in the plan,
   * the key is rejected, or the call fails without a cached copy. An
   * unknown symbol usually comes back as an empty array, not null.
   * Keep symbols in `params`, never in `path`: logs print the path.
   */
  public async get<T>(path: string, params: FmpParams = {}, options: number | FmpRequestOptions = 0): Promise<T | null> {
    const opts: FmpRequestOptions = typeof options === "number" ? { ttlMs: options } : options;
    const key = this.getApiKey(opts.apiKey);
    if (!key) return null;
    const useCache = opts.ttlMs > 0 && !opts.apiKey;

    const query = this.buildQuery(params);
    const relative = query ? `${path}?${query}` : path;
    const cacheKey = `fmp:${relative}`;
    const fp = this.fingerprint(key);

    const cached = useCache ? marketCache.get<T>(cacheKey) : null;
    if (cached && !cached.isExpired && !opts.forceFresh) return cached.data;

    if (this.isRestricted(fp, path, relative)) return null;
    if (!opts.apiKey && FmpService.authFailedKey === fp && Date.now() < FmpService.authFailedUntil) return null;

    const flightKey = `${fp}:${relative}`;
    const existing = FmpService.inFlight.get(flightKey) as Promise<FetchOutcome<T>> | undefined;
    const pending =
      existing ??
      FmpService.throttle.run(() => this.fetchJson<T>(relative, key)).finally(() => {
        FmpService.inFlight.delete(flightKey);
      });
    if (!existing) FmpService.inFlight.set(flightKey, pending);

    const outcome = await pending;
    const stale = opts.staleOnError !== false && cached ? cached.data : null;

    switch (outcome.kind) {
      case "ok":
        if (useCache && !existing) marketCache.set(cacheKey, outcome.data, opts.ttlMs);
        return outcome.data;
      case "restricted":
        if (!existing) {
          const scope = outcome.scope === "endpoint" ? path : relative;
          marketCache.set(`fmp:restricted:${fp}:${scope}`, true, FMP_TTL.restricted);
          this.logOnce(`restricted:${path}`, "info", "endpoint_not_in_plan", `FMP ${path} is not in the current plan; using other providers for ${Math.round(FMP_TTL.restricted / HOUR)}h`);
        }
        return null;
      case "auth":
        if (!opts.apiKey) {
          FmpService.authFailedKey = fp;
          FmpService.authFailedUntil = Date.now() + AUTH_FAILURE_PAUSE_MS;
        }
        this.logOnce("auth", "warning", "auth_error", "FMP rejected the API key (HTTP 401)");
        return null;
      case "rate_limited":
        FmpService.throttle.pause(RATE_LIMIT_PAUSE_MS);
        this.logOnce("rate_limit", "warning", "rate_limit", `FMP rate limit reached (HTTP 429); pausing FMP calls for ${RATE_LIMIT_PAUSE_MS / 1000}s`);
        return stale;
      case "error":
        this.logOnce(`error:${path}`, "warning", "request_failed", `FMP ${path} failed: ${outcome.message}`);
        return stale;
    }
  }

  /** Test the stored key, or `apiKey` when given. Bypasses the cache and the plan markers. */
  public async testConnection(apiKey?: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const key = this.getApiKey(apiKey);
    if (!key) return { success: false, error: "FMP API key is not configured" };
    const start = performance.now();
    const outcome = await FmpService.throttle.run(() => this.fetchJson<unknown>("/search-symbol?query=AAPL&limit=1", key));
    const latencyMs = Math.round(performance.now() - start);
    switch (outcome.kind) {
      case "ok":
        if (!Array.isArray(outcome.data)) return { success: false, error: "Unexpected response format from FMP" };
        if (FmpService.authFailedKey === this.fingerprint(key)) FmpService.authFailedUntil = 0;
        return { success: true, latencyMs };
      case "restricted":
        // The key authenticated; only the test endpoint is outside the plan.
        return { success: true, latencyMs };
      case "auth":
        return { success: false, error: "Invalid FMP API key (authentication failed)" };
      case "rate_limited":
        return { success: false, error: "FMP rate limit exceeded (HTTP 429)" };
      case "error":
        return { success: false, error: `Connection failed: ${outcome.message}` };
    }
  }

  private buildQuery(params: FmpParams): string {
    const search = new URLSearchParams();
    for (const k of Object.keys(params).sort()) {
      const v = params[k];
      if (v === undefined || v === null || v === "") continue;
      if (k.toLowerCase() === "apikey") continue;
      search.set(k, String(v));
    }
    return search.toString();
  }

  private fingerprint(key: string): string {
    return Bun.hash(key).toString(36);
  }

  private isRestricted(fp: string, path: string, relative: string): boolean {
    for (const scope of [path, relative]) {
      const marker = marketCache.get<boolean>(`fmp:restricted:${fp}:${scope}`);
      if (marker && !marker.isExpired) return true;
    }
    return false;
  }

  private logOnce(id: string, level: "info" | "warning", step: string, message: string): void {
    const now = Date.now();
    const last = FmpService.lastLogged.get(id) ?? 0;
    if (now - last < LOG_REPEAT_MS) return;
    FmpService.lastLogged.set(id, now);
    appLogger.logStep(level, "fmp", step, message);
  }

  private async fetchJson<T>(relative: string, key: string): Promise<FetchOutcome<T>> {
    // The key goes in the `apikey` header (documented by FMP), so no URL ever carries it.
    const url = `${this.baseUrl}${relative}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", apikey: key }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const text = await res.text();
      if (res.status === 401) return { kind: "auth" };
      if (res.status === 429) return { kind: "rate_limited" };
      if (res.status === 402 || res.status === 403 || (!res.ok && RESTRICTED_PATTERN.test(text))) {
        return { kind: "restricted", scope: /parameter|symbol/i.test(text) ? "request" : "endpoint" };
      }
      if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` };

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        if (RESTRICTED_PATTERN.test(text)) return { kind: "restricted", scope: /parameter|symbol/i.test(text) ? "request" : "endpoint" };
        return { kind: "error", message: "response is not JSON" };
      }
      // FMP reports some failures as 200 with { "Error Message": "..." }.
      if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as Record<string, unknown>)["Error Message"] === "string") {
        const message = String((data as Record<string, unknown>)["Error Message"]);
        if (RESTRICTED_PATTERN.test(message)) return { kind: "restricted", scope: /parameter|symbol/i.test(message) ? "request" : "endpoint" };
        if (/api key/i.test(message)) return { kind: "auth" };
        if (/limit reach/i.test(message)) return { kind: "rate_limited" };
        return { kind: "error", message: "FMP returned an error message" };
      }
      return { kind: "ok", data: data as T };
    } catch (err) {
      const message = err instanceof Error ? (err.name === "TimeoutError" ? "timeout" : err.message) : String(err);
      // A URL in the message would carry the key and the symbols.
      return { kind: "error", message: redactFmpSecrets(message, key).replace(/https?:\/\/\S+/g, "<url>") };
    }
  }

  // ---------------------------------------------------------------- quotes

  /**
   * Raw quotes keyed by FMP symbol (upper case), through `/batch-quote` in
   * chunks of `FMP_BATCH_SIZE`. Each symbol is cached on its own
   * (`fmp:quote:<SYMBOL>`, `FMP_TTL.quote`), so only stale symbols are asked.
   */
  public async getBatchQuotes(fmpSymbols: string[], forceFresh = false): Promise<Map<string, FmpQuote>> {
    const out = new Map<string, FmpQuote>();
    if (!this.isConfigured()) return out;
    const unique = Array.from(new Set(fmpSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const needed: string[] = [];
    for (const sym of unique) {
      const cached = forceFresh ? null : marketCache.get<FmpQuote>(`fmp:quote:${sym}`);
      if (cached && !cached.isExpired) out.set(sym, cached.data);
      else needed.push(sym);
    }
    await Promise.all(
      chunk(needed, FMP_BATCH_SIZE).map(async (part) => {
        const rows = await this.get<FmpQuote[]>("/batch-quote", { symbols: part.join(",") }, { ttlMs: 0 });
        if (!Array.isArray(rows)) return;
        for (const row of rows) {
          if (!row || typeof row.symbol !== "string" || !(num(row.price)! > 0)) continue;
          const sym = row.symbol.toUpperCase();
          out.set(sym, row);
          marketCache.set(`fmp:quote:${sym}`, row, FMP_TTL.quote);
        }
      }),
    );
    return out;
  }

  /**
   * Quotes in the app shape, keyed by the app symbol as given (trimmed, upper
   * case). A symbol whose trading currency is unknown is left out, so the
   * chain asks the next provider for it.
   */
  public async getQuotes(symbols: string[], forceFresh = false): Promise<Map<string, YahooQuote>> {
    const out = new Map<string, YahooQuote>();
    if (!this.isConfigured() || symbols.length === 0) return out;
    const appSymbols = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const raw = await this.getBatchQuotes(appSymbols.map(toFmpSymbol), forceFresh);
    const found = appSymbols.filter((s) => raw.has(toFmpSymbol(s)));
    await mapWithConcurrencyLimit(found, FMP_THROTTLE.maxConcurrent, async (sym) => {
      const currency = await this.resolveCurrency(sym);
      if (!currency) return;
      out.set(sym, this.toAppQuote(sym, raw.get(toFmpSymbol(sym))!, currency));
    });
    return out;
  }

  /** Market caps keyed by FMP symbol, through `/market-capitalization-batch`. */
  public async getMarketCaps(fmpSymbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!this.isConfigured()) return out;
    const unique = Array.from(new Set(fmpSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const needed: string[] = [];
    for (const sym of unique) {
      const cached = marketCache.get<number>(`fmp:marketcap:${sym}`);
      if (cached && !cached.isExpired) out.set(sym, cached.data);
      else needed.push(sym);
    }
    await Promise.all(
      chunk(needed, FMP_BATCH_SIZE).map(async (part) => {
        const rows = await this.get<FmpMarketCapRow[]>("/market-capitalization-batch", { symbols: part.join(",") }, { ttlMs: 0 });
        if (!Array.isArray(rows)) return;
        for (const row of rows) {
          if (!row?.symbol || !(num(row.marketCap)! > 0)) continue;
          const sym = row.symbol.toUpperCase();
          out.set(sym, row.marketCap);
          marketCache.set(`fmp:marketcap:${sym}`, row.marketCap, FMP_TTL.marketCap);
        }
      }),
    );
    return out;
  }

  /**
   * Trading currency of an app symbol: from the symbol for FX and crypto
   * pairs, else from the company profile (kept for `FMP_TTL.currency`).
   */
  public async resolveCurrency(appSymbol: string): Promise<string | null> {
    const fromSymbol = currencyFromSymbol(appSymbol);
    if (fromSymbol) return fromSymbol;
    const fmpSymbol = toFmpSymbol(appSymbol);
    const cacheKey = `fmp:currency:${fmpSymbol}`;
    const cached = marketCache.get<string>(cacheKey);
    if (cached && !cached.isExpired && cached.data) return cached.data;
    const profile = await this.getProfile(fmpSymbol);
    const currency = typeof profile?.currency === "string" && profile.currency.trim() ? profile.currency.trim() : null;
    if (currency) marketCache.set(cacheKey, currency, FMP_TTL.currency);
    return currency ?? cached?.data ?? null;
  }

  private toAppQuote(appSymbol: string, q: FmpQuote, currency: string): YahooQuote {
    const price = q.price;
    const prevClose = num(q.previousClose) && q.previousClose! > 0 ? q.previousClose! : price;
    const change = num(q.change) ?? price - prevClose;
    const changePercent = num(q.changePercentage) ?? (prevClose > 0 ? (change / prevClose) * 100 : 0);
    return {
      symbol: appSymbol,
      shortName: q.name,
      longName: q.name,
      regularMarketPrice: price,
      regularMarketChange: round2(change),
      regularMarketChangePercent: round2(changePercent),
      regularMarketDayHigh: num(q.dayHigh),
      regularMarketDayLow: num(q.dayLow),
      regularMarketVolume: num(q.volume),
      fiftyTwoWeekHigh: num(q.yearHigh),
      fiftyTwoWeekLow: num(q.yearLow),
      currency,
      previousClose: prevClose,
      updatedAt: new Date(q.timestamp ? q.timestamp * 1000 : Date.now()).toISOString(),
    };
  }

  // ---------------------------------------------------------------- FX

  /** Every forex pair FMP quotes, through one `/batch-forex-quotes?short=true` call. */
  public async getForexQuotes(forceFresh = false): Promise<FmpForexQuoteShort[] | null> {
    const rows = await this.get<FmpForexQuoteShort[]>("/batch-forex-quotes", { short: true }, { ttlMs: FMP_TTL.forex, forceFresh });
    return Array.isArray(rows) ? rows : null;
  }

  /**
   * FX multipliers in the shape of `YahooFinanceService.getExchangeRates`:
   * an amount in the target currency times the multiplier gives the amount
   * in `baseCurrency`. Keys are the target codes as given ("GBp" stays
   * "GBp", worth 0.01 GBP). A pair FMP cannot price is left out.
   */
  public async getExchangeRates(baseCurrency: string, targetCurrencies: string[], forceFresh = false): Promise<Map<string, number>> {
    const base = (baseCurrency || "EUR").trim().toUpperCase();
    const result = new Map<string, number>();
    const targets = Array.from(new Set(targetCurrencies.map((c) => (c || "").trim()).filter(Boolean)));
    const pending: string[] = [];
    for (const curr of targets) {
      if (curr.toUpperCase() === base && curr !== "GBp") result.set(curr, 1);
      else if (curr === "GBp" && base === "GBP") result.set(curr, 0.01);
      else pending.push(curr);
    }
    if (pending.length === 0 || !this.isConfigured()) return result;

    const rows = await this.getForexQuotes(forceFresh);
    if (!rows) return result;
    const prices = new Map<string, number>();
    for (const row of rows) if (row?.symbol && num(row.price)! > 0) prices.set(row.symbol.toUpperCase(), row.price);

    /** Units of `to` per unit of `from`. */
    const rate = (from: string, to: string): number | null => {
      if (from === to) return 1;
      const direct = prices.get(`${from}${to}`);
      if (direct) return direct;
      const inverse = prices.get(`${to}${from}`);
      if (inverse) return 1 / inverse;
      return null;
    };
    const viaUsd = (from: string, to: string): number | null => {
      const r = rate(from, to);
      if (r) return r;
      const a = rate(from, "USD");
      const b = rate("USD", to);
      return a && b ? a * b : null;
    };

    for (const curr of pending) {
      const isPence = curr === "GBp";
      const code = isPence ? "GBP" : curr.toUpperCase();
      const r = viaUsd(code, base);
      if (r && Number.isFinite(r) && r > 0) result.set(curr, isPence ? r * 0.01 : r);
    }
    return result;
  }

  // ---------------------------------------------------------------- charts

  /**
   * End-of-day bars, oldest first. `from`/`to` are "YYYY-MM-DD"; FMP picks
   * its default window when both are omitted. Null when FMP has no answer.
   */
  public async getEodChart(
    fmpSymbol: string,
    options: { from?: string | null; to?: string; adjustment?: FmpEodAdjustment; forceFresh?: boolean } = {},
  ): Promise<FmpEodBar[] | null> {
    const symbol = fmpSymbol.trim().toUpperCase();
    if (!symbol) return null;
    const adjustment = options.adjustment ?? "split";
    const path =
      adjustment === "dividend" ? "/historical-price-eod/dividend-adjusted" : adjustment === "none" ? "/historical-price-eod/non-split-adjusted" : "/historical-price-eod/full";
    const rows = await this.get<Array<Record<string, unknown>>>(path, { symbol, from: options.from ?? undefined, to: options.to }, { ttlMs: FMP_TTL.chart, forceFresh: options.forceFresh });
    if (!Array.isArray(rows)) return null;
    const bars: FmpEodBar[] = [];
    for (const r of rows) {
      const date = typeof r.date === "string" ? r.date.slice(0, 10) : "";
      const close = num(r.close) ?? num(r.adjClose);
      if (!date || close === undefined) continue;
      bars.push({
        date,
        open: num(r.open) ?? num(r.adjOpen) ?? close,
        high: num(r.high) ?? num(r.adjHigh) ?? close,
        low: num(r.low) ?? num(r.adjLow) ?? close,
        close,
        volume: num(r.volume) ?? 0,
      });
    }
    bars.sort((a, b) => a.date.localeCompare(b.date));
    return bars;
  }

  /**
   * A chart in the shape of `YahooFinanceService.getChart`, for daily
   * intervals only (null otherwise, so Yahoo serves it). The live quote
   * updates or extends the last candle, as Yahoo's daily chart does, so
   * `extractQuoteFromChart` gives the right price and day change.
   */
  public async getChart(symbol: string, range = "1y", interval = "1d", forceFresh = false): Promise<YahooChartData | null> {
    if (interval !== "1d" || !this.isConfigured()) return null;
    const appSymbol = symbol.trim().toUpperCase();
    const fmpSymbol = toFmpSymbol(appSymbol);
    const from = rangeStart(range);
    if (from === undefined) return null;

    const bars = await this.getEodChart(fmpSymbol, { from, forceFresh });
    if (!bars || bars.length === 0) return null;
    const currency = await this.resolveCurrency(appSymbol);
    if (!currency) return null;
    const quote = (await this.getBatchQuotes([fmpSymbol], forceFresh)).get(fmpSymbol);

    const candles: YahooChartCandle[] = bars.map((b) => ({
      timestamp: Date.parse(`${b.date}T00:00:00Z`),
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));

    if (quote) this.applyLiveQuote(candles, quote);
    const keep = range === "1d" ? 1 : range === "5d" ? 5 : candles.length;
    const trimmed = candles.slice(-keep);
    const last = trimmed[trimmed.length - 1]!;

    return {
      symbol: appSymbol,
      currency,
      regularMarketPrice: quote?.price ?? last.close,
      previousClose: num(quote?.previousClose),
      fiftyTwoWeekHigh: num(quote?.yearHigh),
      fiftyTwoWeekLow: num(quote?.yearLow),
      shortName: quote?.name,
      longName: quote?.name || appSymbol,
      candles: trimmed,
    };
  }

  /** Puts the live price on the current session's candle, adding that candle when the history ends a session earlier. */
  private applyLiveQuote(candles: YahooChartCandle[], quote: FmpQuote): void {
    const last = candles[candles.length - 1];
    if (!last || !(quote.price > 0)) return;
    const prevClose = num(quote.previousClose);
    const lastIsPreviousSession = prevClose !== undefined && Math.abs(last.close - prevClose) <= Math.max(1e-9, Math.abs(prevClose) * 1e-6) && Math.abs(quote.price - prevClose) > 0;
    if (lastIsPreviousSession) {
      let date = quote.timestamp ? isoDate(new Date(quote.timestamp * 1000)) : isoDate(new Date());
      if (date <= last.date) {
        const next = new Date(`${last.date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        date = isoDate(next);
      }
      candles.push({
        timestamp: Date.parse(`${date}T00:00:00Z`),
        date,
        open: num(quote.open) ?? quote.price,
        high: Math.max(num(quote.dayHigh) ?? quote.price, quote.price),
        low: Math.min(num(quote.dayLow) ?? quote.price, quote.price),
        close: quote.price,
        volume: num(quote.volume) ?? 0,
      });
      return;
    }
    last.close = quote.price;
    last.high = Math.max(last.high, quote.price);
    last.low = Math.min(last.low, quote.price);
  }

  // ---------------------------------------------------------------- search

  /** `/search-symbol` rows. */
  public async searchSymbolRows(query: string, limit = 10): Promise<FmpSymbolSearchRow[] | null> {
    const q = query.trim();
    if (!q) return [];
    return this.get<FmpSymbolSearchRow[]>("/search-symbol", { query: q, limit }, FMP_TTL.search);
  }

  /** `/search-name` rows. */
  public async searchNameRows(query: string, limit = 10): Promise<FmpSymbolSearchRow[] | null> {
    const q = query.trim();
    if (!q) return [];
    return this.get<FmpSymbolSearchRow[]>("/search-name", { query: q, limit }, FMP_TTL.search);
  }

  /** `/search-isin` rows (one per listing). */
  public async searchByIsin(isin: string): Promise<FmpIsinRow[] | null> {
    const value = isin.trim().toUpperCase();
    if (!isIsin(value)) return [];
    return this.get<FmpIsinRow[]>("/search-isin", { isin: value }, FMP_TTL.search);
  }

  /** `/search-cusip` rows. */
  public async searchByCusip(cusip: string): Promise<FmpCusipRow[] | null> {
    const value = cusip.trim().toUpperCase();
    if (!isCusip(value)) return [];
    return this.get<FmpCusipRow[]>("/search-cusip", { cusip: value }, FMP_TTL.search);
  }

  /** Ticker and name search in the app shape: symbol matches first, then name matches. */
  public async searchSymbols(query: string, limit = 10): Promise<YahooSymbolSearchResult[]> {
    if (!query.trim() || !this.isConfigured()) return [];
    const bySymbol = (await this.searchSymbolRows(query, limit)) ?? [];
    const byName = bySymbol.length >= limit ? [] : ((await this.searchNameRows(query, limit)) ?? []);
    const seen = new Set<string>();
    const out: YahooSymbolSearchResult[] = [];
    for (const row of [...bySymbol, ...byName]) {
      if (!row?.symbol || seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      out.push(this.toSearchResult(row.symbol, row.name, row.exchange));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** ISIN or CUSIP lookup in the app shape; empty for any other query. */
  public async searchIdentifier(query: string): Promise<YahooSymbolSearchResult[]> {
    const q = query.trim().toUpperCase();
    if (!this.isConfigured()) return [];
    let rows: Array<{ symbol: string; name?: string }> = [];
    if (isIsin(q)) rows = ((await this.searchByIsin(q)) ?? []).map((r) => ({ symbol: r.symbol, name: r.name }));
    else if (isCusip(q)) rows = ((await this.searchByCusip(q)) ?? []).map((r) => ({ symbol: r.symbol, name: r.companyName }));
    const seen = new Set<string>();
    return rows
      .filter((r) => r?.symbol && !seen.has(r.symbol) && seen.add(r.symbol))
      .slice(0, 10)
      .map((r) => this.toSearchResult(r.symbol, r.name));
  }

  private toSearchResult(symbol: string, name?: string, exchange?: string): YahooSymbolSearchResult {
    const ex = (exchange || "").toUpperCase();
    const quoteType = ex === "CRYPTO" ? "CRYPTOCURRENCY" : ex === "FOREX" ? "CURRENCY" : ex === "INDEX" ? "INDEX" : "EQUITY";
    return {
      symbol,
      name: name || symbol,
      exchange: exchange || "FMP",
      quoteType,
      typeDisp: quoteType === "CRYPTOCURRENCY" ? "Cryptocurrency" : quoteType === "CURRENCY" ? "Currency" : quoteType === "INDEX" ? "Index" : "Equity",
    };
  }

  // ---------------------------------------------------------------- company

  /** `/profile` for one FMP symbol, or null. */
  public async getProfile(fmpSymbol: string): Promise<FmpCompanyProfile | null> {
    const symbol = fmpSymbol.trim().toUpperCase();
    if (!symbol) return null;
    const rows = await this.get<FmpCompanyProfile[]>("/profile", { symbol }, FMP_TTL.profile);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // ---------------------------------------------------------------- news

  /** `/news/general-latest` articles. */
  public async getGeneralNews(query: FmpNewsQuery = {}): Promise<FmpNewsArticle[] | null> {
    return this.get<FmpNewsArticle[]>("/news/general-latest", { page: query.page ?? 0, limit: query.limit ?? 20, from: query.from, to: query.to }, FMP_TTL.news);
  }

  /** `/news/stock` for the given FMP symbols, or `/news/stock-latest` when none are given. */
  public async getStockNews(fmpSymbols: string[] = [], query: FmpNewsQuery = {}): Promise<FmpNewsArticle[] | null> {
    const symbols = Array.from(new Set(fmpSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort();
    const params: FmpParams = { page: query.page ?? 0, limit: query.limit ?? 20, from: query.from, to: query.to };
    if (symbols.length === 0) return this.get<FmpNewsArticle[]>("/news/stock-latest", params, FMP_TTL.news);
    return this.get<FmpNewsArticle[]>("/news/stock", { ...params, symbols: symbols.join(",") }, FMP_TTL.news);
  }

  /** General market headlines in the shared news shape, newest first. */
  public async getMarketNews(limit = 5): Promise<MarketNewsItem[]> {
    if (!this.isConfigured()) return [];
    const rows = await this.getGeneralNews({ limit: Math.max(20, limit) });
    return FmpService.toNewsItems(rows ?? []).slice(0, limit);
  }

  /** Maps FMP articles to the shared news shape, newest first, skipping untitled ones. */
  public static toNewsItems(rows: FmpNewsArticle[]): MarketNewsItem[] {
    return rows
      .filter((r) => r && typeof r.title === "string" && r.title.trim())
      .map((r) => ({
        headline: r.title.trim(),
        summary: (r.text || r.title).trim(),
        source: r.publisher || r.site || "Financial Modeling Prep",
        datetime: publishedToUnix(r.publishedDate || ""),
        url: r.url,
      }))
      .sort((a, b) => b.datetime - a.datetime);
  }
}
