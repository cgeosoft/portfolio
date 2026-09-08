/**
 * Yahoo Finance API client.
 * Ported from the NestJS service, removing DI decorators.
 */

import * as marketCache from "../db/market-cache.repo.js";
import { appLogger } from "../logger.js";

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
  const prevClose = chart.previousClose || prev?.close || price;
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
    previousClose: prevClose,
    updatedAt: new Date().toISOString(),
  };
}

export class YahooFinanceService {
  private static readonly fxCache = new Map<string, { multiplier: number; expiresAt: number }>();
  private static readonly chartCache = new Map<string, { data: YahooChartData; expiresAt: number }>();
  private static readonly inFlightCharts = new Map<string, Promise<YahooChartData>>();

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

  public async searchSymbols(query: string): Promise<YahooSymbolSearchResult[]> {
    if (!query || !query.trim()) return [];

    for (const baseUrl of BASE_QUERY_URLS) {
      try {
        const url = `${baseUrl}/v1/finance/search?q=${encodeURIComponent(query.trim())}&quotesCount=10&newsCount=0`;
        const res = await fetch(url, {
          headers: DEFAULT_HEADERS,
          signal: AbortSignal.timeout(10_000),
        });

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
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[YahooFinance] Failed search on ${baseUrl} for "${query}": ${msg}`);
      }
    }
    return [];
  }

  public async getChart(symbol: string, range = "1y", interval = "1d", forceFresh = false): Promise<YahooChartData> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${cleanSymbol}:${range}:${interval}`;

    const diskCached = marketCache.get<YahooChartData>(`chart:${cacheKey}`);

    if (!forceFresh) {
      // 1. Check in-memory cache
      const cached = YahooFinanceService.chartCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        appLogger.logStep("debug", "yahoo", "chart_cache_mem", `In-memory chart cache hit for ${cleanSymbol}`);
        return cached.data;
      }

      // 2. Check persistent SQLite cache
      if (diskCached && !diskCached.isExpired) {
        YahooFinanceService.chartCache.set(cacheKey, { data: diskCached.data, expiresAt: diskCached.expiresAt });
        appLogger.logStep("debug", "yahoo", "chart_cache_disk", `Disk chart cache hit for ${cleanSymbol}`);
        return diskCached.data;
      }
    }

    // 3. Check in-flight request deduplication
    const existing = YahooFinanceService.inFlightCharts.get(cacheKey);
    if (existing) {
      return existing;
    }

    const fetchPromise = (async (): Promise<YahooChartData> => {
      let lastError: Error | null = null;
      const fetchStart = performance.now();

      for (const baseUrl of BASE_QUERY_URLS) {
        try {
          const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=${range}&interval=${interval}`;
          const res = await fetch(url, {
            headers: DEFAULT_HEADERS,
            signal: AbortSignal.timeout(4_000),
          });

          if (!res.ok) {
            lastError = new Error(`Yahoo Finance API error (${res.status}) on ${baseUrl} for symbol ${cleanSymbol}`);
            appLogger.logStep("warning", "yahoo", "chart_http_error", `${cleanSymbol} got HTTP ${res.status} from ${baseUrl}`);
            continue;
          }

          const data = (await res.json()) as Record<string, unknown>;
          const chart = data.chart as Record<string, unknown> | undefined;
          const resultArr = chart?.result as Array<Record<string, unknown>> | undefined;
          const result = resultArr?.[0];
          if (!result || !result.meta) {
            const errObj = chart?.error as Record<string, string> | undefined;
            const err = errObj?.description ?? `No chart data returned for ${cleanSymbol}`;
            lastError = new Error(err);
            appLogger.logStep("warning", "yahoo", "chart_empty_result", `${cleanSymbol}: ${err}`);
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
            previousClose: (meta.previousClose as number) ?? (meta.chartPreviousClose as number),
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh as number | undefined,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow as number | undefined,
            shortName: meta.shortName as string | undefined,
            longName: (meta.longName as string) || (meta.shortName as string) || cleanSymbol,
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
          appLogger.logStep("debug", "yahoo", "chart_fetched", `Chart fetched for ${cleanSymbol} in ${dur}ms`, dur);
          return chartData;
        } catch (e: unknown) {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      }

      // Network query failed, check if we have stale disk cache for offline use
      if (diskCached && diskCached.data) {
        appLogger.logStep("warning", "yahoo", "chart_stale_fallback", `Using stale cached chart data for ${cleanSymbol}`);
        return diskCached.data;
      }

      appLogger.logStep("error", "yahoo", "chart_failed", `Failed to fetch chart data for ${cleanSymbol}: ${lastError?.message}`);
      throw lastError || new Error(`Failed to fetch chart data for ${cleanSymbol}`);
    })().finally(() => {
      YahooFinanceService.inFlightCharts.delete(cacheKey);
    });

    YahooFinanceService.inFlightCharts.set(cacheKey, fetchPromise);
    return fetchPromise;
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
        const chart = await this.getChart(sym, "5d", "1d", forceFresh);
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
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[YahooFinance] Failed to fetch quote for ${sym}: ${msg}`);
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

      if (upper === base) {
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
      const fxQuotes = await this.getQuotes(pairSymbols);

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
            console.warn(
              `[YahooFinance] Could not resolve FX pair ${item.pairSymbol} for base currency ${base}, falling back to 1`,
            );
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
}
