/**
 * Yahoo Finance API client.
 * Ported from the NestJS service, removing DI decorators.
 */

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
const FX_CACHE_TTL_MS = 15 * 60 * 1000;
const CHART_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_CONCURRENCY_LIMIT = 8;

/** Run async work over items with at most `limit` operations in flight */
async function mapWithConcurrencyLimit<T, R>(
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

export class YahooFinanceService {
  private static readonly fxCache = new Map<string, { multiplier: number; expiresAt: number }>();
  private static readonly chartCache = new Map<string, { data: YahooChartData; expiresAt: number }>();

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

  public async getChart(symbol: string, range = "1y", interval = "1d"): Promise<YahooChartData> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${cleanSymbol}:${range}:${interval}`;
    const cached = YahooFinanceService.chartCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    let lastError: Error | null = null;

    for (const baseUrl of BASE_QUERY_URLS) {
      try {
        const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=${range}&interval=${interval}`;
        const res = await fetch(url, {
          headers: DEFAULT_HEADERS,
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          lastError = new Error(`Yahoo Finance API error (${res.status}) on ${baseUrl} for symbol ${cleanSymbol}`);
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

        YahooFinanceService.chartCache.set(cacheKey, { data: chartData, expiresAt: Date.now() + CHART_CACHE_TTL_MS });
        return chartData;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw lastError || new Error(`Failed to fetch chart data for ${cleanSymbol}`);
  }

  public async getQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
    const results = new Map<string, YahooQuote>();
    if (symbols.length === 0) return results;

    const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase())));

    await mapWithConcurrencyLimit(uniqueSymbols, FETCH_CONCURRENCY_LIMIT, async (sym) => {
      try {
        const chart = await this.getChart(sym, "5d", "1d");
        if (!chart || !chart.candles) return;
        const candles = chart.candles;
        const latest = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : undefined;

        const price = chart.regularMarketPrice || latest?.close || 0;
        const prevClose = chart.previousClose || prev?.close || price;
        const change = price - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

        results.set(sym, {
          symbol: sym,
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
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[YahooFinance] Failed to fetch quote for ${sym}: ${msg}`);
      }
    });

    return results;
  }

  public async getExchangeRates(baseCurrency: string, targetCurrencies: string[]): Promise<Map<string, number>> {
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
      const cached = YahooFinanceService.fxCache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        result.set(curr, cached.multiplier);
      } else {
        neededCurrencies.push(curr);
      }
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
          console.warn(
            `[YahooFinance] Could not resolve FX pair ${item.pairSymbol} for base currency ${base}, falling back to 1`,
          );
        }

        result.set(item.rawCurr, multiplier);
        YahooFinanceService.fxCache.set(`${base}:${item.rawCurr}`, {
          multiplier,
          expiresAt: now + FX_CACHE_TTL_MS,
        });
      }
    }

    return result;
  }
}
