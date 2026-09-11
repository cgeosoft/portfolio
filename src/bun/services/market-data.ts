/**
 * Market data coordinator service.
 * Routes market data requests to Yahoo Finance or Finnhub according to
 * user preferences in dataProviderRouting, with fault-isolated fallbacks.
 */

import { loadConfig, type DataProviderCategoryRouting, DEFAULT_DATA_PROVIDER_ROUTING } from "../config.js";
import { appLogger } from "../logger.js";
import * as marketCache from "../db/market-cache.repo.js";
import {
  type YahooQuote,
  type YahooChartData,
  type YahooSymbolSearchResult,
  YahooFinanceService,
} from "./yahoo-finance.js";
import { FinnhubService } from "./finnhub.js";

export class MarketDataCoordinator {
  constructor(
    private readonly yahoo: YahooFinanceService,
    private readonly finnhub: FinnhubService,
  ) {}

  private getRouting(): DataProviderCategoryRouting {
    const config = loadConfig();
    return {
      ...DEFAULT_DATA_PROVIDER_ROUTING,
      ...(config.dataProviderRouting || {}),
    };
  }

  /**
   * Retrieve market quotes with category-based routing and safe fallback.
   */
  public async getQuotes(symbols: string[], forceFresh = false): Promise<Map<string, YahooQuote>> {
    if (symbols.length === 0) return new Map();

    const routing = this.getRouting();
    const primaryProvider = routing.quotes;

    // 1. If Finnhub is preferred and configured:
    if (primaryProvider === "finnhub" && this.finnhub.isConfigured()) {
      try {
        const finnhubQuotes = await this.finnhub.getQuotes(symbols, forceFresh);
        const missingSymbols = symbols.filter((s) => !finnhubQuotes.has(s.trim().toUpperCase()));

        // If all resolved, return immediately
        if (missingSymbols.length === 0) {
          return finnhubQuotes;
        }

        // Otherwise fallback to Yahoo for remaining symbols without failing
        appLogger.logStep(
          "info",
          "market_data",
          "quotes_fallback",
          `Falling back to Yahoo Finance for ${missingSymbols.length} missing symbols`,
        );
        const yahooQuotes = await this.yahoo.getQuotes(missingSymbols, forceFresh);
        for (const [k, v] of yahooQuotes) {
          finnhubQuotes.set(k, v);
        }
        return finnhubQuotes;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        appLogger.logStep(
          "warning",
          "market_data",
          "finnhub_quotes_failed",
          `Finnhub quotes failed, falling back to Yahoo: ${msg}`,
        );
        return this.yahoo.getQuotes(symbols, forceFresh);
      }
    }

    // 2. Default: Yahoo Finance
    try {
      return await this.yahoo.getQuotes(symbols, forceFresh);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.logStep("warning", "market_data", "yahoo_quotes_failed", `Yahoo quotes failed: ${msg}`);
      if (this.finnhub.isConfigured()) {
        appLogger.logStep("info", "market_data", "quotes_fallback", "Attempting Finnhub quotes fallback");
        return await this.finnhub.getQuotes(symbols, forceFresh);
      }
      return new Map();
    }
  }

  /**
   * Retrieve exchange rates with category-based routing and safe fallback.
   */
  public async getExchangeRates(
    baseCurrency: string,
    targetCurrencies: string[],
    forceFresh = false,
  ): Promise<Map<string, number>> {
    const routing = this.getRouting();
    const primaryProvider = routing.fx;

    if (primaryProvider === "finnhub" && this.finnhub.isConfigured()) {
      try {
        const rates = await this.finnhub.getExchangeRates(baseCurrency, targetCurrencies, forceFresh);
        const missing = targetCurrencies.filter((c) => !rates.has(c));
        if (missing.length === 0) return rates;

        const fallback = await this.yahoo.getExchangeRates(baseCurrency, missing, forceFresh);
        for (const [k, v] of fallback) {
          rates.set(k, v);
        }
        return rates;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        appLogger.logStep(
          "warning",
          "market_data",
          "finnhub_fx_failed",
          `Finnhub FX failed, falling back to Yahoo: ${msg}`,
        );
        return this.yahoo.getExchangeRates(baseCurrency, targetCurrencies, forceFresh);
      }
    }

    return this.yahoo.getExchangeRates(baseCurrency, targetCurrencies, forceFresh);
  }

  /**
   * Retrieve historical chart candle data.
   */
  public async getChart(
    symbol: string,
    range = "1y",
    interval = "1d",
    forceFresh = false,
  ): Promise<YahooChartData> {
    return this.yahoo.getChart(symbol, range, interval, forceFresh);
  }

  /**
   * Search symbols with category-based routing and safe fallback.
   */
  public async searchSymbols(query: string): Promise<YahooSymbolSearchResult[]> {
    if (!query || !query.trim()) return [];

    const routing = this.getRouting();
    const primaryProvider = routing.search;

    if (primaryProvider === "finnhub" && this.finnhub.isConfigured()) {
      try {
        const results = await this.finnhub.searchSymbols(query);
        if (results.length > 0) return results;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        appLogger.logStep(
          "warning",
          "market_data",
          "finnhub_search_failed",
          `Finnhub search failed, falling back to Yahoo: ${msg}`,
        );
      }
      return this.yahoo.searchSymbols(query);
    }

    try {
      const results = await this.yahoo.searchSymbols(query);
      if (results.length > 0) return results;
      if (this.finnhub.isConfigured()) {
        return await this.finnhub.searchSymbols(query);
      }
      return [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.logStep("warning", "market_data", "yahoo_search_failed", `Yahoo search failed: ${msg}`);
      if (this.finnhub.isConfigured()) {
        return await this.finnhub.searchSymbols(query);
      }
      return [];
    }
  }

  /**
   * Fetch market news with category-based routing.
   */
  public async getMarketNews(
    limit = 5,
  ): Promise<Array<{ headline: string; summary: string; source: string; datetime: number; url?: string }>> {
    const routing = this.getRouting();
    const primaryProvider = routing.news;

    if (primaryProvider === "finnhub" && this.finnhub.isConfigured()) {
      try {
        const news = await this.finnhub.getMarketNews("general", limit);
        if (news.length > 0) {
          return news.map((n) => ({
            headline: n.headline,
            summary: n.summary,
            source: n.source,
            datetime: n.datetime,
            url: n.url,
          }));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        appLogger.logStep(
          "warning",
          "market_data",
          "finnhub_news_failed",
          `Finnhub news failed, falling back to Yahoo: ${msg}`,
        );
      }
      return this.yahoo.getMarketNews(limit);
    }

    try {
      const news = await this.yahoo.getMarketNews(limit);
      if (news.length > 0) return news;
      if (this.finnhub.isConfigured()) {
        const fNews = await this.finnhub.getMarketNews("general", limit);
        return fNews.map((n) => ({
          headline: n.headline,
          summary: n.summary,
          source: n.source,
          datetime: n.datetime,
          url: n.url,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Purge stored market quotes, FX rates, and cached news.
   */
  public clearMarketCache(): { success: boolean; clearedEntries: number } {
    const cleared = marketCache.clearMarketData();
    appLogger.logStep("info", "market_data", "cache_cleared", `Cleared ${cleared} market cache records`);
    return { success: true, clearedEntries: cleared };
  }
}
