/**
 * Finnhub API client and market intelligence service.
 * Connects to https://finnhub.io/api/v1 to retrieve macroeconomic news,
 * company news, analyst recommendations, and financial metrics for AI reports.
 */

import * as marketCache from "../db/market-cache.repo.js";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";

export interface FinnhubNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image?: string;
  related?: string;
  source: string;
  summary: string;
  url: string;
}

export interface FinnhubRecommendation {
  buy: number;
  hold: number;
  period: string;
  sell: number;
  strongBuy: number;
  strongSell: number;
  symbol: string;
}

export interface FinnhubBasicFinancials {
  symbol: string;
  metricType: string;
  metric: {
    "52WeekHigh"?: number;
    "52WeekLow"?: number;
    "52WeekPriceReturnDaily"?: number;
    beta?: number;
    peBasicExclExtraTTM?: number;
    psTTM?: number;
    dividendYieldIndicatedAnnual?: number;
    [key: string]: unknown;
  };
}

export interface FinnhubCompanyProfile {
  country?: string;
  currency?: string;
  exchange?: string;
  finnhubIndustry?: string;
  ipo?: string;
  marketCapitalization?: number;
  name?: string;
  phone?: string;
  shareOutstanding?: number;
  ticker?: string;
  weburl?: string;
  logo?: string;
}

export interface FinnhubQuote {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

export interface FinnhubHoldingIntelligence {
  symbol: string;
  profile?: {
    name?: string;
    industry?: string;
    marketCap?: number;
  };
  news: {
    headline: string;
    summary: string;
    source: string;
    datetime: number;
    url?: string;
  }[];
  recommendation?: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
    period: string;
  };
  metrics?: {
    peRatio?: number;
    beta?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    dividendYield?: number;
  };
}

export interface FinnhubReportIntelligence {
  configured: boolean;
  marketNews: {
    headline: string;
    summary: string;
    source: string;
    datetime: number;
    url?: string;
  }[];
  holdings: Record<string, FinnhubHoldingIntelligence>;
  summaryStats: {
    totalNewsArticles: number;
    enrichedSymbolsCount: number;
  };
}

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

const TTL_MARKET_NEWS_MS = 30 * 60 * 1000; // 30 minutes
const TTL_COMPANY_NEWS_MS = 60 * 60 * 1000; // 1 hour
const TTL_RECOMMENDATIONS_MS = 6 * 60 * 60 * 1000; // 6 hours
const TTL_METRICS_MS = 6 * 60 * 60 * 1000; // 6 hours
const TTL_PROFILE_MS = 24 * 60 * 60 * 1000; // 24 hours
const TTL_QUOTE_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 7_000;

export class FinnhubService {
  private readonly baseUrl: string;

  constructor(baseUrl: string = FINNHUB_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Determine the active Finnhub API key.
   */
  public getApiKey(overrideKey?: string): string {
    if (overrideKey && overrideKey.trim().length > 0) {
      return overrideKey.trim();
    }
    const config = loadConfig();
    return (config.finnhubApiKey || "").trim();
  }

  /**
   * Check whether a Finnhub API key is configured.
   */
  public isConfigured(overrideKey?: string): boolean {
    return this.getApiKey(overrideKey).length > 0;
  }

  /**
   * Test connection to Finnhub API using the provided or stored key.
   */
  public async testConnection(apiKey?: string): Promise<{ success: boolean; error?: string }> {
    const key = this.getApiKey(apiKey);
    if (!key) {
      return { success: false, error: "Finnhub API key is not configured" };
    }

    try {
      const url = `${this.baseUrl}/news?category=general&minId=0`;
      const res = await fetch(url, {
        headers: {
          "X-Finnhub-Token": key,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        return { success: false, error: "Invalid Finnhub API key (Authentication failed)" };
      }
      if (res.status === 429) {
        return { success: false, error: "Finnhub rate limit exceeded (60 calls/min)" };
      }
      if (!res.ok) {
        return { success: false, error: `Finnhub returned HTTP status ${res.status}` };
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        return { success: false, error: "Unexpected response format from Finnhub" };
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Connection failed: ${msg}` };
    }
  }

  /**
   * Internal generic request helper with SQLite caching.
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>,
    ttlMs: number,
    overrideKey?: string,
  ): Promise<T | null> {
    const key = this.getApiKey(overrideKey);
    if (!key) return null;

    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) {
        searchParams.set(k, String(v));
      }
    }

    const queryStr = searchParams.toString();
    const relativeUrl = queryStr ? `${endpoint}?${queryStr}` : endpoint;
    const cacheKey = `finnhub:${relativeUrl}`;

    // Check cache first
    const cached = marketCache.get<T>(cacheKey);
    if (cached && !cached.isExpired) {
      return cached.data;
    }

    try {
      const url = `${this.baseUrl}${relativeUrl}`;
      const res = await fetch(url, {
        headers: {
          "X-Finnhub-Token": key,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        appLogger.logStep("warning", "finnhub", "auth_error", "Finnhub authentication failed: invalid API key");
        return null;
      }
      if (res.status === 429) {
        appLogger.logStep("warning", "finnhub", "rate_limit", "Finnhub API rate limit reached (429)");
        // If expired cache exists, fall back to it
        if (cached) return cached.data;
        return null;
      }
      if (!res.ok) {
        appLogger.logStep("warning", "finnhub", "http_error", `Finnhub request failed with status ${res.status}`);
        if (cached) return cached.data;
        return null;
      }

      const json = (await res.json()) as T;
      marketCache.set(cacheKey, json, ttlMs);
      return json;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.logStep("warning", "finnhub", "request_exception", `Finnhub request error: ${msg}`);
      if (cached) return cached.data;
      return null;
    }
  }

  /**
   * Fetch general macroeconomic and financial market news.
   * Endpoint: GET /news?category=general
   */
  public async getMarketNews(
    category: string = "general",
    limit: number = 5,
    overrideKey?: string,
  ): Promise<FinnhubNewsItem[]> {
    const data = await this.request<FinnhubNewsItem[]>(
      "/news",
      { category, minId: 0 },
      TTL_MARKET_NEWS_MS,
      overrideKey,
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter((item) => item.headline && item.summary)
      .slice(0, limit);
  }

  /**
   * Fetch company-specific news for a given symbol and date window.
   * Endpoint: GET /company-news?symbol=...&from=...&to=...
   */
  public async getCompanyNews(
    symbol: string,
    fromDate: string,
    toDate: string,
    limit: number = 3,
    overrideKey?: string,
  ): Promise<FinnhubNewsItem[]> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return [];

    const data = await this.request<FinnhubNewsItem[]>(
      "/company-news",
      { symbol: cleanSymbol, from: fromDate, to: toDate },
      TTL_COMPANY_NEWS_MS,
      overrideKey,
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter((item) => item.headline && item.summary)
      .slice(0, limit);
  }

  /**
   * Fetch analyst recommendation trends for a stock.
   * Endpoint: GET /stock/recommendation?symbol=...
   */
  public async getRecommendationTrends(
    symbol: string,
    overrideKey?: string,
  ): Promise<FinnhubRecommendation | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return null;

    const data = await this.request<FinnhubRecommendation[]>(
      "/stock/recommendation",
      { symbol: cleanSymbol },
      TTL_RECOMMENDATIONS_MS,
      overrideKey,
    );
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] || null;
  }

  /**
   * Fetch basic company financials (ratios, beta, 52-week ranges).
   * Endpoint: GET /stock/metric?symbol=...&metric=all
   */
  public async getBasicFinancials(
    symbol: string,
    overrideKey?: string,
  ): Promise<FinnhubBasicFinancials | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return null;

    const data = await this.request<FinnhubBasicFinancials>(
      "/stock/metric",
      { symbol: cleanSymbol, metric: "all" },
      TTL_METRICS_MS,
      overrideKey,
    );
    if (!data || !data.metric) return null;
    return data;
  }

  /**
   * Fetch company profile (industry, market cap, name).
   * Endpoint: GET /stock/profile2?symbol=...
   */
  public async getCompanyProfile(
    symbol: string,
    overrideKey?: string,
  ): Promise<FinnhubCompanyProfile | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return null;

    const data = await this.request<FinnhubCompanyProfile>(
      "/stock/profile2",
      { symbol: cleanSymbol },
      TTL_PROFILE_MS,
      overrideKey,
    );
    if (!data || !data.name) return null;
    return data;
  }

  /**
   * Fetch real-time quote for a symbol.
   * Endpoint: GET /quote?symbol=...
   */
  public async getQuote(
    symbol: string,
    overrideKey?: string,
  ): Promise<FinnhubQuote | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return null;

    const data = await this.request<FinnhubQuote>(
      "/quote",
      { symbol: cleanSymbol },
      TTL_QUOTE_MS,
      overrideKey,
    );
    if (!data || typeof data.c !== "number" || data.c === 0) return null;
    return data;
  }

  /**
   * High-level aggregator to collect comprehensive market intelligence for portfolio reports.
   * Gathers macro market news plus holding-level news, analyst recommendations, and fundamentals.
   */
  public async getReportMarketIntelligence(options: {
    symbols: string[];
    fromDate: string;
    toDate: string;
    maxSymbols?: number;
    overrideKey?: string;
  }): Promise<FinnhubReportIntelligence> {
    const key = this.getApiKey(options.overrideKey);
    if (!key) {
      return {
        configured: false,
        marketNews: [],
        holdings: {},
        summaryStats: { totalNewsArticles: 0, enrichedSymbolsCount: 0 },
      };
    }

    const maxSymbols = options.maxSymbols ?? 5;
    // Filter symbols to valid alphanumeric stock tickers (ignore crypto pairs like BTC-USD or special cash symbols)
    const targetSymbols = options.symbols
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9.\-_]{1,10}$/.test(s) && !s.includes("USD") && !s.includes("EUR"))
      .slice(0, maxSymbols);

    // Fetch macro market news
    const rawMarketNews = await this.getMarketNews("general", 4, options.overrideKey);
    const marketNews = rawMarketNews.map((n) => ({
      headline: n.headline.trim(),
      summary: n.summary.trim(),
      source: n.source,
      datetime: n.datetime,
      url: n.url,
    }));

    let totalNewsArticles = marketNews.length;
    const holdings: Record<string, FinnhubHoldingIntelligence> = {};

    // Fetch intelligence for each target holding with bounded concurrency
    for (const sym of targetSymbols) {
      try {
        const [newsItems, recTrend, financials, profile] = await Promise.all([
          this.getCompanyNews(sym, options.fromDate, options.toDate, 2, options.overrideKey),
          this.getRecommendationTrends(sym, options.overrideKey),
          this.getBasicFinancials(sym, options.overrideKey),
          this.getCompanyProfile(sym, options.overrideKey),
        ]);

        const cleanedNews = newsItems.map((n) => ({
          headline: n.headline.trim(),
          summary: n.summary.trim(),
          source: n.source,
          datetime: n.datetime,
          url: n.url,
        }));
        totalNewsArticles += cleanedNews.length;

        const holdingIntel: FinnhubHoldingIntelligence = {
          symbol: sym,
          news: cleanedNews,
        };

        if (profile) {
          holdingIntel.profile = {
            name: profile.name,
            industry: profile.finnhubIndustry,
            marketCap: profile.marketCapitalization,
          };
        }

        if (recTrend) {
          holdingIntel.recommendation = {
            strongBuy: recTrend.strongBuy,
            buy: recTrend.buy,
            hold: recTrend.hold,
            sell: recTrend.sell,
            strongSell: recTrend.strongSell,
            period: recTrend.period,
          };
        }

        if (financials?.metric) {
          const m = financials.metric;
          holdingIntel.metrics = {
            peRatio: typeof m.peBasicExclExtraTTM === "number" ? Number(m.peBasicExclExtraTTM.toFixed(2)) : undefined,
            beta: typeof m.beta === "number" ? Number(m.beta.toFixed(2)) : undefined,
            fiftyTwoWeekHigh: typeof m["52WeekHigh"] === "number" ? Number(m["52WeekHigh"].toFixed(2)) : undefined,
            fiftyTwoWeekLow: typeof m["52WeekLow"] === "number" ? Number(m["52WeekLow"].toFixed(2)) : undefined,
            dividendYield:
              typeof m.dividendYieldIndicatedAnnual === "number"
                ? Number(m.dividendYieldIndicatedAnnual.toFixed(2))
                : undefined,
          };
        }

        holdings[sym] = holdingIntel;
      } catch (symErr) {
        appLogger.logStep("warning", "finnhub", "symbol_intel_error", `Failed gathering Finnhub intel for ${sym}`, undefined, {
          error: symErr instanceof Error ? symErr.message : String(symErr),
        });
      }
    }

    return {
      configured: true,
      marketNews,
      holdings,
      summaryStats: {
        totalNewsArticles,
        enrichedSymbolsCount: Object.keys(holdings).length,
      },
    };
  }
}
