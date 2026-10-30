/**
 * Yahoo Finance API client.
 * Ported from the NestJS service, removing DI decorators.
 */

import * as marketCache from "../db/market-cache.repo.js";
import { appLogger } from "../logger.js";
import { OfflineBreaker } from "./providers/offline.js";
import { RequestThrottle } from "./providers/throttle.js";

export interface YahooSymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
  typeDisp?: string;
}

export interface YahooQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  currency: string;
  instrumentType?: string;
  previousClose?: number;
  updatedAt: string;
}

export interface YahooChartCandle {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YahooChartData {
  symbol: string;
  currency: string;
  regularMarketPrice: number;
  previousClose?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  shortName?: string;
  longName?: string;
  /** Yahoo `meta.instrumentType`: EQUITY, ETF, MUTUALFUND, CRYPTOCURRENCY and so on. */
  instrumentType?: string;
  candles: YahooChartCandle[];
}

const BASE_QUERY_URLS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"];
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://finance.yahoo.com/",
};
const FX_CACHE_TTL_MS = 60 * 60 * 1000;
const CHART_CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_CONCURRENCY_LIMIT = 8;
/** After HTTP 429 no call goes to Yahoo for this long; callers get the stale copy. */
const RATE_LIMIT_PAUSE_MS = 60 * 1000;
/** A failed cookie and crumb lookup is not repeated for this long. */
const SESSION_RETRY_MS = 60 * 1000;
/** After this many requests in a row without a response, Yahoo counts as offline for `OFFLINE_PAUSE_MS`. */
const OFFLINE_THRESHOLD = 5;
const OFFLINE_PAUSE_MS = 60 * 1000;
/** How long a stale copy served after a failed request stays in the memory cache before the next try. */
const STALE_RETRY_MS = 60 * 1000;
/**
 * One throttle for every Yahoo call, so a UI refresh, the daily brief and the
 * exposure and income views together cannot stack up requests.
 */
export const YAHOO_THROTTLE = { maxConcurrent: 8, maxPerWindow: 300, windowMs: 60 * 1000 } as const;

/**
 * An error's type and code for a log line ("TypeError, ConnectionRefused").
 * Never the message: request URLs carry the symbol or the search query.
 */
function errorKind(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as Error & { code?: unknown }).code;
  return typeof code === "string" ? `${e.name}, ${code}` : e.name;
}

/** Run async work over items with at most `limit` operations in flight */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;
      results[current] = await fn(items[current] as T, current);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function extractQuoteFromChart(chart: YahooChartData): YahooQuote | null {
  if (!chart || !chart.candles || chart.candles.length === 0) return null;
  const candles = chart.candles;
  const latest = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : undefined;

  const price = chart.regularMarketPrice || latest?.close || 0;
  // The close before the latest candle. meta.previousClose is absent on
  // multi-day ranges and chartPreviousClose is the close before the range start.
  const prevClose = prev?.close || chart.previousClose || price;
  const change = price - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    symbol: chart.symbol,
    shortName: chart.shortName,
    longName: chart.longName,
    regularMarketPrice: Number(price.toFixed(2)),
    regularMarketChange: Number(change.toFixed(2)),
    regularMarketChangePercent: Number(changePercent.toFixed(2)),
    regularMarketDayHigh: latest?.high,
    regularMarketDayLow: latest?.low,
    regularMarketVolume: latest?.volume,
    fiftyTwoWeekHigh: chart.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: chart.fiftyTwoWeekLow,
    currency: chart.currency,
    instrumentType: chart.instrumentType,
    previousClose: prevClose,
    updatedAt: new Date().toISOString(),
  };
}

export class YahooFinanceService {
  private static readonly fxCache = new Map<string, { multiplier: number; expiresAt: number }>();
  private static readonly chartCache = new Map<string, { data: YahooChartData; expiresAt: number }>();
  private static readonly inFlightCharts = new Map<string, Promise<YahooChartData>>();
  /** No call goes to Yahoo before this time (epoch ms). Set by HTTP 429; shared by every call. */
  private static pausedUntil = 0;
  private static readonly throttle = new RequestThrottle(YAHOO_THROTTLE);
  private static readonly offline = new OfflineBreaker({ threshold: OFFLINE_THRESHOLD, pauseMs: OFFLINE_PAUSE_MS });

  private static isRateLimited(): boolean {
    return Date.now() < YahooFinanceService.pausedUntil;
  }

  /** True after HTTP 429 or while Yahoo counts as offline: callers use their cached copies. */
  private static isPaused(): boolean {
    return YahooFinanceService.isRateLimited() || YahooFinanceService.offline.isOpen();
  }

  /**
   * GET through the shared throttle. The timeout starts when the request
   * leaves the queue. A request still queued when Yahoo pauses fails at once.
   */
  private static request(url: string, timeoutMs: number, init: { headers?: Record<string, string>; redirect?: RequestRedirect } = {}): Promise<Response> {
    return YahooFinanceService.throttle.run(async () => {
      if (YahooFinanceService.isPaused()) throw new Error("Yahoo Finance is paused (rate limit or no network)");
      try {
        const res = await fetch(url, { headers: init.headers ?? DEFAULT_HEADERS, redirect: init.redirect, signal: AbortSignal.timeout(timeoutMs) });
        YahooFinanceService.offline.success();
        return res;
      } catch (e: unknown) {
        if (YahooFinanceService.offline.failure()) {
          appLogger.logStep("warning", "yahoo", "offline", `Yahoo Finance did not answer ${OFFLINE_THRESHOLD} requests in a row (${errorKind(e)}); using cached data for ${OFFLINE_PAUSE_MS / 1000}s`);
        }
        throw e;
      }
    });
  }

  /** Pauses every Yahoo call after HTTP 429, so no other host or symbol adds to the limit. Logs once per pause. */
  private static pauseAfterRateLimit(): void {
    if (!YahooFinanceService.isRateLimited()) {
      appLogger.logStep("warning", "yahoo", "rate_limit", `Yahoo Finance rate limit reached (HTTP 429); pausing Yahoo calls for ${RATE_LIMIT_PAUSE_MS / 1000}s`);
    }
    YahooFinanceService.pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
  }

  // Periodic eviction of expired in-memory cache entries to prevent unbounded growth.
  // Runs every 5 minutes and sweeps entries older than their TTL.
  private static cacheSweepHandle: ReturnType<typeof setInterval>;

  static {
    YahooFinanceService.cacheSweepHandle = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of YahooFinanceService.fxCache) {
        if (now >= entry.expiresAt) YahooFinanceService.fxCache.delete(key);
      }
      for (const [key, entry] of YahooFinanceService.chartCache) {
        if (now >= entry.expiresAt) YahooFinanceService.chartCache.delete(key);
      }
    }, 5 * 60 * 1000).unref();
  }

  /** Stop the periodic cache sweep timer (called during app shutdown). */
  public static destroy(): void {
    clearInterval(YahooFinanceService.cacheSweepHandle);
  }

  /** Test connection to Yahoo Finance API endpoints */
  public async testConnection(): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const start = performance.now();
    let lastError = "No response from Yahoo Finance";
    for (const baseUrl of BASE_QUERY_URLS) {
      try {
        const url = `${baseUrl}/v1/finance/search?q=AAPL&quotesCount=1&newsCount=0`;
        const res = await fetch(url, {
          headers: DEFAULT_HEADERS,
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const latencyMs = Math.round(performance.now() - start);
          return { success: true, latencyMs };
        }
        lastError = `HTTP ${res.status}`;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    return { success: false, error: lastError };
  }

  /** Fetch general market news headlines from Yahoo Finance */
  public async getMarketNews(limit = 5): Promise<Array<{ headline: string; summary: string; source: string; datetime: number; url?: string }>> {
    const cached = marketCache.get<Array<{ headline: string; summary: string; source: string; datetime: number; url?: string }>>("yahoo:market_news");
    if (cached && !cached.isExpired) {
      return cached.data;
    }
    if (YahooFinanceService.isPaused()) return cached ? cached.data : [];

    for (const baseUrl of BASE_QUERY_URLS) {
      try {
        const url = `${baseUrl}/v1/finance/search?q=market&quotesCount=0&newsCount=${Math.min(limit, 10)}`;
        const res = await YahooFinanceService.request(url, 6_000);
        if (res.status === 429) {
          YahooFinanceService.pauseAfterRateLimit();
          break;
        }
        if (!res.ok) continue;

        const data = (await res.json()) as {
          news?: Array<{
            uuid?: string;
            title?: string;
            publisher?: string;
            link?: string;
            providerPublishTime?: number;
          }>;
        };

        const news = (data.news ?? [])
          .filter((item) => item.title && item.title.trim().length > 0)
          .slice(0, limit)
          .map((item) => ({
            headline: item.title!.trim(),
            summary: item.title!.trim(),
            source: item.publisher || "Yahoo Finance",
            datetime: item.providerPublishTime || Math.floor(Date.now() / 1000),
            url: item.link,
          }));

        if (news.length > 0) {
          marketCache.set("yahoo:market_news", news, 30 * 60 * 1000);
          return news;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        appLogger.logStep("warning", "yahoo", "market_news", `Failed to fetch market news from ${baseUrl}: ${msg}`);
      }
    }

    if (cached) return cached.data;
    return [];
  }

  public async searchSymbols(query: string): Promise<YahooSymbolSearchResult[]> {
    if (!query || !query.trim()) return [];
    if (YahooFinanceService.isPaused()) return [];

    for (const baseUrl of BASE_QUERY_URLS) {
      try {
        const url = `${baseUrl}/v1/finance/search?q=${encodeURIComponent(query.trim())}&quotesCount=10&newsCount=0`;
        const res = await YahooFinanceService.request(url, 10_000);

        if (res.status === 429) {
          YahooFinanceService.pauseAfterRateLimit();
          return [];
        }
        if (!res.ok) continue;

        const data = (await res.json()) as {
          quotes?: Array<{
            symbol?: string;
            shortname?: string;
            longname?: string;
            exchange?: string;
            quoteType?: string;
            typeDisp?: string;
          }>;
        };

        const quotes = data.quotes ?? [];
        return quotes
          .filter(
            (q) =>
              q.symbol &&
              (q.quoteType === "EQUITY" ||
                q.quoteType === "ETF" ||
                q.quoteType === "MUTUALFUND" ||
                q.quoteType === "INDEX" ||
                q.quoteType === "CRYPTOCURRENCY"),
          )
          .map((q) => ({
            symbol: q.symbol!,
            name: q.longname || q.shortname || q.symbol!,
            exchange: q.exchange || "US",
            quoteType: q.quoteType || "EQUITY",
            typeDisp: q.typeDisp || q.quoteType || "Equity",
          }));
      } catch (e: unknown) {
        // The query can be a ticker or an ISIN; log the error type only (CLAUDE.md rule 3).
        appLogger.logStep("warning", "yahoo", "search", `Search failed on ${baseUrl} (${errorKind(e)})`);
      }
    }
    return [];
  }

  public async getChart(symbol: string, range = "1y", interval = "1d", forceFresh = false): Promise<YahooChartData> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${cleanSymbol}:${range}:${interval}`;
    // Logs and errors below never name the symbol (CLAUDE.md rule 3): callers log the errors again.

    // 1. Check in-memory cache, before any disk read
    if (!forceFresh) {
      const cached = YahooFinanceService.chartCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        appLogger.logStep("debug", "yahoo", "chart_cache_mem", "Chart served from the memory cache");
        return cached.data;
      }
    }

    // 2. Check persistent SQLite cache; an expired copy is the offline fallback below
    const diskCached = marketCache.get<YahooChartData>(`chart:${cacheKey}`);
    if (!forceFresh && diskCached && !diskCached.isExpired) {
      YahooFinanceService.chartCache.set(cacheKey, { data: diskCached.data, expiresAt: diskCached.expiresAt });
      appLogger.logStep("debug", "yahoo", "chart_cache_disk", "Chart served from the disk cache");
      return diskCached.data;
    }

    // 3. Check in-flight request deduplication
    const existing = YahooFinanceService.inFlightCharts.get(cacheKey);
    if (existing) {
      return existing;
    }

    // 4. Paused after HTTP 429 or offline: the stale copy, without a request
    if (YahooFinanceService.isPaused()) {
      if (diskCached?.data) return diskCached.data;
      throw new Error("Yahoo Finance is paused (rate limit or no network)");
    }

    const fetchPromise = (async (): Promise<YahooChartData> => {
      let lastError: Error | null = null;
      /** What went wrong, for the log: an HTTP status, a Yahoo error code or an error type. */
      let failure = "no response";
      const fetchStart = performance.now();

      for (const baseUrl of BASE_QUERY_URLS) {
        try {
          const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=${range}&interval=${interval}`;
          let res: Response;
          try {
            res = await YahooFinanceService.request(url, 4_000);
          } catch (e: unknown) {
            // No response (DNS, connection, timeout): the other host would most likely fail the same way.
            lastError = e instanceof Error ? e : new Error(String(e));
            failure = errorKind(e);
            break;
          }

          if (res.status === 429) {
            // The other host shares the limit: stop here.
            YahooFinanceService.pauseAfterRateLimit();
            failure = "HTTP 429";
            lastError = new Error("Yahoo Finance rate limit reached (HTTP 429)");
            break;
          }
          if (!res.ok) {
            failure = `HTTP ${res.status}`;
            lastError = new Error(`Yahoo Finance chart request failed with HTTP ${res.status}`);
            appLogger.logStep("warning", "yahoo", "chart_http_error", `Chart request got HTTP ${res.status} from ${baseUrl}`);
            continue;
          }

          const data = (await res.json()) as Record<string, unknown>;
          const chart = data.chart as Record<string, unknown> | undefined;
          const resultArr = chart?.result as Array<Record<string, unknown>> | undefined;
          const result = resultArr?.[0];
          if (!result || !result.meta) {
            // Yahoo's error description can name the symbol; keep the code only.
            const errObj = chart?.error as Record<string, unknown> | undefined;
            const code = typeof errObj?.code === "string" ? errObj.code : "empty";
            failure = `no chart data, ${code}`;
            lastError = new Error(`Yahoo Finance returned no chart data (${code})`);
            appLogger.logStep("warning", "yahoo", "chart_empty_result", `Chart response held no data (${code})`);
            continue;
          }

          const meta = result.meta as Record<string, unknown>;
          const timestamps = (result.timestamp as number[]) ?? [];
          const indicators = result.indicators as Record<string, unknown>;
          const quoteArr = indicators?.quote as Array<Record<string, number[]>> | undefined;
          const quotes = quoteArr?.[0] ?? {};

          const opens = quotes.open ?? [];
          const highs = quotes.high ?? [];
          const lows = quotes.low ?? [];
          const closes = quotes.close ?? [];
          const volumes = quotes.volume ?? [];

          const candles: YahooChartCandle[] = [];
          for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i]!;
            const close = closes[i];
            if (close === null || close === undefined || isNaN(close)) continue;

            const dateStr = new Date(ts * 1000).toISOString().split("T")[0]!;
            candles.push({
              timestamp: ts * 1000,
              date: dateStr,
              open: opens[i] ?? close,
              high: highs[i] ?? close,
              low: lows[i] ?? close,
              close,
              volume: volumes[i] ?? 0,
            });
          }

          const currentPrice = (meta.regularMarketPrice as number) ?? candles[candles.length - 1]?.close ?? 0;

          const chartData: YahooChartData = {
            symbol: cleanSymbol,
            currency: (meta.currency as string) || "USD",
            regularMarketPrice: currentPrice,
            previousClose: meta.previousClose as number | undefined,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh as number | undefined,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow as number | undefined,
            shortName: meta.shortName as string | undefined,
            longName: (meta.longName as string) || (meta.shortName as string) || cleanSymbol,
            instrumentType: typeof meta.instrumentType === "string" ? meta.instrumentType : undefined,
            candles,
          };

          const expiresAt = Date.now() + CHART_CACHE_TTL_MS;
          YahooFinanceService.chartCache.set(cacheKey, { data: chartData, expiresAt });
          marketCache.set(`chart:${cacheKey}`, chartData, CHART_CACHE_TTL_MS);

          const quote = extractQuoteFromChart(chartData);
          if (quote) {
            marketCache.set(`quote:${cleanSymbol}`, quote, 24 * 60 * 60 * 1000);
          }

          const dur = Math.round(performance.now() - fetchStart);
          appLogger.logStep("debug", "yahoo", "chart_fetched", `Chart fetched in ${dur}ms`, dur);
          return chartData;
        } catch (e: unknown) {
          lastError = e instanceof Error ? e : new Error(String(e));
          failure = errorKind(e);
        }
      }

      // Network query failed, check if we have stale disk cache for offline use
      if (diskCached && diskCached.data) {
        // Kept in memory for a short while, so the next caller does not wait for the network again.
        YahooFinanceService.chartCache.set(cacheKey, { data: diskCached.data, expiresAt: Date.now() + STALE_RETRY_MS });
        if (!YahooFinanceService.isPaused()) {
          appLogger.logStep("warning", "yahoo", "chart_stale_fallback", `Chart request failed (${failure}); using the stale cached copy`);
        }
        return diskCached.data;
      }

      appLogger.logStep("error", "yahoo", "chart_failed", `Chart request failed (${failure})`);
      throw lastError || new Error("Yahoo Finance returned no chart");
    })().finally(() => {
      YahooFinanceService.inFlightCharts.delete(cacheKey);
    });

    YahooFinanceService.inFlightCharts.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /** True when the memory or disk cache holds an unexpired chart under `cacheKey` (symbol:range:interval). */
  private static hasFreshChart(cacheKey: string): boolean {
    const mem = YahooFinanceService.chartCache.get(cacheKey);
    if (mem && Date.now() < mem.expiresAt) return true;
    const diskExpiresAt = marketCache.getExpiresAt(`chart:${cacheKey}`);
    return diskExpiresAt !== null && Date.now() < diskExpiresAt;
  }

  public async getQuotes(symbols: string[], forceFresh = false): Promise<Map<string, YahooQuote>> {
    const results = new Map<string, YahooQuote>();
    if (symbols.length === 0) return results;

    const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase())));

    await mapWithConcurrencyLimit(uniqueSymbols, FETCH_CONCURRENCY_LIMIT, async (sym) => {
      // 1. Check persistent SQLite cache first (if not forcing fresh)
      const diskQuote = marketCache.get<YahooQuote>(`quote:${sym}`);
      if (!forceFresh && diskQuote && !diskQuote.isExpired) {
        results.set(sym, diskQuote.data);
        return;
      }

      try {
        // A refresh takes the 1y daily chart when its cache has expired: it carries the same quote,
        // and the portfolio build reads it next, so one request serves both.
        const range = forceFresh && !YahooFinanceService.hasFreshChart(`${sym}:1y:1d`) ? "1y" : "5d";
        const chart = await this.getChart(sym, range, "1d", forceFresh);
        const quote = extractQuoteFromChart(chart);
        if (quote) {
          results.set(sym, quote);
          marketCache.set(`quote:${sym}`, quote, 24 * 60 * 60 * 1000);
        }
      } catch (e: unknown) {
        // If network failed, fall back to stale disk cache if present
        if (diskQuote && diskQuote.data) {
          results.set(sym, diskQuote.data);
          return;
        }
        // A pause after HTTP 429 was logged once; it needs no line per symbol.
        if (!YahooFinanceService.isPaused()) {
          appLogger.logStep("warning", "yahoo", "get_quote", `Failed to fetch a quote (${errorKind(e)})`);
        }
      }
    });

    return results;
  }

  public async getExchangeRates(baseCurrency: string, targetCurrencies: string[], forceFresh = false): Promise<Map<string, number>> {
    const base = (baseCurrency || "EUR").trim().toUpperCase();
    const result = new Map<string, number>();
    const now = Date.now();

    const neededCurrencies: string[] = [];

    for (const rawCurr of targetCurrencies) {
      const curr = (rawCurr || base).trim();
      const upper = curr.toUpperCase();

      // GBp (pence) upper-cases to GBP but is a hundredth of it; the pence branch below prices it.
      if (upper === base && curr !== "GBp") {
        result.set(curr, 1);
        continue;
      }

      const cacheKey = `${base}:${curr}`;
      if (!forceFresh) {
        const cached = YahooFinanceService.fxCache.get(cacheKey);
        if (cached && now < cached.expiresAt) {
          result.set(curr, cached.multiplier);
          continue;
        }

        const diskCached = marketCache.get<number>(`fx:${cacheKey}`);
        if (diskCached && !diskCached.isExpired) {
          result.set(curr, diskCached.data);
          YahooFinanceService.fxCache.set(cacheKey, { multiplier: diskCached.data, expiresAt: diskCached.expiresAt });
          continue;
        }
      }

      neededCurrencies.push(curr);
    }

    if (neededCurrencies.length === 0) {
      return result;
    }

    const pairsToFetch: { rawCurr: string; pairSymbol: string; isBaseTarget: boolean; isSubUnit?: boolean }[] = [];

    for (const rawCurr of neededCurrencies) {
      const isPence = rawCurr === "GBp";
      const standardCurr = isPence ? "GBP" : rawCurr.toUpperCase();

      if (standardCurr === base) {
        const mult = isPence ? 0.01 : 1;
        result.set(rawCurr, mult);
        YahooFinanceService.fxCache.set(`${base}:${rawCurr}`, { multiplier: mult, expiresAt: now + FX_CACHE_TTL_MS });
        marketCache.set(`fx:${base}:${rawCurr}`, mult, FX_CACHE_TTL_MS);
        continue;
      }

      pairsToFetch.push({
        rawCurr,
        pairSymbol: `${base}${standardCurr}=X`,
        isBaseTarget: true,
        isSubUnit: isPence,
      });
    }

    if (pairsToFetch.length > 0) {
      const pairSymbols = Array.from(new Set(pairsToFetch.map((p) => p.pairSymbol)));
      // Pass forceFresh on: a cached pair quote lives 24 hours, far longer than an FX rate.
      const fxQuotes = await this.getQuotes(pairSymbols, forceFresh);

      for (const item of pairsToFetch) {
        const quote = fxQuotes.get(item.pairSymbol);
        let multiplier = 1;

        if (quote && quote.regularMarketPrice > 0) {
          multiplier = item.isBaseTarget ? 1 / quote.regularMarketPrice : quote.regularMarketPrice;
          if (item.isSubUnit) {
            multiplier *= 0.01;
          }
        } else {
          // Check if stale disk cache has a previous rate before falling back to 1
          const staleDisk = marketCache.get<number>(`fx:${base}:${item.rawCurr}`);
          if (staleDisk && staleDisk.data) {
            multiplier = staleDisk.data;
          } else {
            // Leave the currency out so the next provider can fill it, and cache
            // nothing so the next refresh tries again instead of keeping a rate of 1.
            // The pair names the user's currencies; the log does not.
            appLogger.logStep("warning", "yahoo", "fx_rates", "Could not resolve an FX pair; leaving it to the next provider");
            continue;
          }
        }

        result.set(item.rawCurr, multiplier);
        YahooFinanceService.fxCache.set(`${base}:${item.rawCurr}`, {
          multiplier,
          expiresAt: now + FX_CACHE_TTL_MS,
        });
        marketCache.set(`fx:${base}:${item.rawCurr}`, multiplier, FX_CACHE_TTL_MS);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------- quoteSummary

  /** Cookie and crumb that `/v10/finance/quoteSummary` requires; shared by every caller. */
  private static summarySession: { cookie: string; crumb: string; expiresAt: number } | null = null;
  private static summarySessionPromise: Promise<{ cookie: string; crumb: string } | null> | null = null;
  private static readonly inFlightSummaries = new Map<string, Promise<Record<string, unknown> | null>>();
  /** When the last cookie and crumb lookup failed (epoch ms). */
  private static sessionFailedAt = 0;

  /** Notes a failed cookie and crumb lookup, so the next `SESSION_RETRY_MS` ask for none. */
  private static sessionFailed(): null {
    YahooFinanceService.sessionFailedAt = Date.now();
    return null;
  }

  /** Gets a Yahoo cookie (fc.yahoo.com) and the crumb that goes with it, reused for an hour. */
  private static async getSummarySession(forceNew = false): Promise<{ cookie: string; crumb: string } | null> {
    const current = YahooFinanceService.summarySession;
    if (!forceNew && current && Date.now() < current.expiresAt) return current;
    if (Date.now() - YahooFinanceService.sessionFailedAt < SESSION_RETRY_MS) return null;
    if (YahooFinanceService.summarySessionPromise) return YahooFinanceService.summarySessionPromise;

    YahooFinanceService.summarySessionPromise = (async () => {
      try {
        const res = await YahooFinanceService.request("https://fc.yahoo.com", 8_000, { redirect: "manual" });
        const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
        const cookie = setCookies.map((c) => c.split(";")[0]?.trim() ?? "").filter(Boolean).join("; ");
        if (!cookie) return YahooFinanceService.sessionFailed();
        for (const baseUrl of BASE_QUERY_URLS) {
          const crumbRes = await YahooFinanceService.request(`${baseUrl}/v1/test/getcrumb`, 8_000, { headers: { ...DEFAULT_HEADERS, Cookie: cookie } });
          if (crumbRes.status === 429) {
            YahooFinanceService.pauseAfterRateLimit();
            break;
          }
          if (!crumbRes.ok) continue;
          const crumb = (await crumbRes.text()).trim();
          if (!crumb || crumb.includes("<")) continue;
          YahooFinanceService.summarySession = { cookie, crumb, expiresAt: Date.now() + 60 * 60 * 1000 };
          return { cookie, crumb };
        }
        return YahooFinanceService.sessionFailed();
      } catch (e: unknown) {
        // Bun's fetch rejects with a TypeError on network failures; the code
        // (ENOTFOUND, ConnectionRefused, ...) says which one.
        appLogger.logStep("warning", "yahoo", "summary_session", `Could not open a Yahoo session (${errorKind(e)})`);
        return YahooFinanceService.sessionFailed();
      } finally {
        YahooFinanceService.summarySessionPromise = null;
      }
    })();
    return YahooFinanceService.summarySessionPromise;
  }

  /**
   * `quoteSummary` modules for one symbol (for example `topHoldings`,
   * `fundProfile`, `assetProfile`, `quoteType`), or null when Yahoo has none.
   * Cached in `market_cache` under `yahoo:summary:` for `ttlMs`; a miss is
   * cached for an hour so a symbol without data is not asked again at once.
   */
  public async getQuoteSummary(symbol: string, modules: string[], ttlMs = 24 * 60 * 60 * 1000): Promise<Record<string, unknown> | null> {
    const sym = symbol.trim().toUpperCase();
    if (!sym || modules.length === 0) return null;
    const moduleList = Array.from(new Set(modules)).sort().join(",");
    const cacheKey = `yahoo:summary:${sym}:${moduleList}`;
    const cached = marketCache.get<Record<string, unknown> | null>(cacheKey);
    if (cached && !cached.isExpired) return cached.data;
    if (YahooFinanceService.isPaused()) return cached ? cached.data : null;

    const existing = YahooFinanceService.inFlightSummaries.get(cacheKey);
    if (existing) return existing;

    const promise = (async (): Promise<Record<string, unknown> | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const session = await YahooFinanceService.getSummarySession(attempt > 0);
        if (!session) break;
        let authFailed = false;
        for (const baseUrl of BASE_QUERY_URLS) {
          try {
            const url = `${baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${encodeURIComponent(moduleList)}&formatted=false&crumb=${encodeURIComponent(session.crumb)}`;
            const res = await YahooFinanceService.request(url, 10_000, { headers: { ...DEFAULT_HEADERS, Cookie: session.cookie } });
            if (res.status === 429) {
              YahooFinanceService.pauseAfterRateLimit();
              return cached ? cached.data : null;
            }
            if (res.status === 401 || res.status === 403) {
              authFailed = true;
              break;
            }
            if (res.status === 404) {
              marketCache.set(cacheKey, null, 60 * 60 * 1000);
              return null;
            }
            if (!res.ok) continue;
            const body = (await res.json()) as { quoteSummary?: { result?: Array<Record<string, unknown>> | null } };
            const result = body.quoteSummary?.result?.[0] ?? null;
            marketCache.set(cacheKey, result, result ? ttlMs : 60 * 60 * 1000);
            return result;
          } catch (e: unknown) {
            // The URL carries the symbol; log the error type only (CLAUDE.md rule 3).
            appLogger.logStep("warning", "yahoo", "quote_summary", `quoteSummary request failed (${errorKind(e)})`);
          }
        }
        if (!authFailed) break;
        YahooFinanceService.summarySession = null;
      }
      return cached ? cached.data : null;
    })().finally(() => {
      YahooFinanceService.inFlightSummaries.delete(cacheKey);
    });

    YahooFinanceService.inFlightSummaries.set(cacheKey, promise);
    return promise;
  }

  // ---------------------------------------------------------------- dividends and splits

  /**
   * Past dividends and splits from the chart endpoint (`events=div,splits`),
   * oldest first. Dividend amounts are per share in `currency`, adjusted for
   * later splits. Cached in `market_cache` under `yahoo:events:` for 12 hours;
   * an expired copy is returned when Yahoo fails. Null when Yahoo has no chart
   * for the symbol.
   */
  public async getCorporateEvents(symbol: string, range = "5y"): Promise<YahooCorporateEvents | null> {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return null;
    const cacheKey = `yahoo:events:${sym}:${range}`;
    const cached = marketCache.get<YahooCorporateEvents | null>(cacheKey);
    if (cached && !cached.isExpired) return cached.data;
    if (YahooFinanceService.isPaused()) return cached ? cached.data : null;

    for (const baseUrl of BASE_QUERY_URLS) {
      try {
        const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(sym)}?range=${encodeURIComponent(range)}&interval=1mo&events=div%2Csplits`;
        const res = await YahooFinanceService.request(url, 6_000);
        if (res.status === 429) {
          YahooFinanceService.pauseAfterRateLimit();
          break;
        }
        if (res.status === 404) {
          marketCache.set(cacheKey, null, 60 * 60 * 1000);
          return null;
        }
        if (!res.ok) continue;
        const body = (await res.json()) as { chart?: { result?: Array<Record<string, unknown>> | null } };
        const result = body.chart?.result?.[0];
        if (!result) continue;
        const meta = (result.meta ?? {}) as Record<string, unknown>;
        const events = (result.events ?? {}) as {
          dividends?: Record<string, { amount?: number; date?: number }>;
          splits?: Record<string, { date?: number; numerator?: number; denominator?: number }>;
        };
        const day = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 10);
        const dividends = Object.values(events.dividends ?? {})
          .filter((d) => typeof d.date === "number" && typeof d.amount === "number" && d.amount > 0)
          .map((d) => ({ date: day(d.date!), amount: d.amount! }))
          .sort((a, b) => a.date.localeCompare(b.date));
        const splits = Object.values(events.splits ?? {})
          .filter((s) => typeof s.date === "number" && Number(s.numerator) > 0 && Number(s.denominator) > 0)
          .map((s) => ({ date: day(s.date!), numerator: Number(s.numerator), denominator: Number(s.denominator) }))
          .sort((a, b) => a.date.localeCompare(b.date));
        const data: YahooCorporateEvents = { symbol: sym, currency: (meta.currency as string) || "", dividends, splits };
        marketCache.set(cacheKey, data, 12 * 60 * 60 * 1000);
        return data;
      } catch (e: unknown) {
        // The URL carries the symbol; log the error type only (CLAUDE.md rule 3).
        appLogger.logStep("warning", "yahoo", "corporate_events", `Dividend and split request failed (${errorKind(e)})`);
      }
    }
    return cached ? cached.data : null;
  }
}

/** Past dividends and splits of a symbol from the Yahoo chart endpoint. */
export interface YahooCorporateEvents {
  symbol: string;
  /** Trading currency of the dividend amounts ("GBp" for pence). */
  currency: string;
  /** Ex-date and amount per share, oldest first. */
  dividends: { date: string; amount: number }[];
  splits: { date: string; numerator: number; denominator: number }[];
}
