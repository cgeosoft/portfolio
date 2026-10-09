/**
 * Market data coordinator service.
 * Resolves quotes, FX rates, charts, symbol search and market news through
 * the provider chain (./providers/chain.ts): the provider picked in
 * dataProviderRouting first, then the other configured providers in quality
 * order (FMP, Yahoo Finance, Finnhub; Finnhub before Yahoo for news).
 * Each `...WithSource` method also names the provider that supplied the data.
 */

import { appLogger } from "../logger.js";
import * as marketCache from "../db/market-cache.repo.js";
import {
  type YahooQuote,
  type YahooChartData,
  type YahooSymbolSearchResult,
  YahooFinanceService,
} from "./yahoo-finance.js";
import { FinnhubService } from "./finnhub.js";
import type { FmpService } from "./fmp.js";
import { fillByKey, firstAvailable, type BatchChainResult, type ChainResult } from "./providers/chain.js";
import { isCusip, isIsin } from "./providers/identifiers.js";
import type { MarketNewsItem } from "./providers/types.js";

export type { MarketNewsItem } from "./providers/types.js";

export class MarketDataCoordinator {
  constructor(
    private readonly yahoo: YahooFinanceService,
    private readonly finnhub: FinnhubService,
    private readonly fmp?: FmpService,
  ) {}

  private fmpReady(): boolean {
    return Boolean(this.fmp?.isConfigured());
  }

  private finnhubReady(): boolean {
    return this.finnhub.isConfigured();
  }

  /**
   * Retrieve market quotes. Keys are the symbols trimmed and upper-cased.
   */
  public async getQuotes(symbols: string[], forceFresh = false): Promise<Map<string, YahooQuote>> {
    return (await this.getQuotesWithSource(symbols, forceFresh)).data;
  }

  /** Quotes plus the provider of each symbol. Each provider only gets the symbols still missing. */
  public async getQuotesWithSource(symbols: string[], forceFresh = false): Promise<BatchChainResult<YahooQuote>> {
    const keys = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    return fillByKey<YahooQuote>({
      category: "quotes",
      keys,
      attempts: [
        { provider: "fmp", isAvailable: () => this.fmpReady(), fetch: (missing) => this.fmp!.getQuotes(missing, forceFresh) },
        { provider: "yahoo", fetch: (missing) => this.yahoo.getQuotes(missing, forceFresh) },
        { provider: "finnhub", isAvailable: () => this.finnhubReady(), fetch: (missing) => this.finnhub.getQuotes(missing, forceFresh) },
      ],
    });
  }

  /**
   * Retrieve exchange rates: per target currency, the multiplier that turns
   * an amount in that currency into `baseCurrency`.
   */
  public async getExchangeRates(
    baseCurrency: string,
    targetCurrencies: string[],
    forceFresh = false,
  ): Promise<Map<string, number>> {
    return (await this.getExchangeRatesWithSource(baseCurrency, targetCurrencies, forceFresh)).data;
  }

  /** Exchange rates plus the provider of each currency. */
  public async getExchangeRatesWithSource(
    baseCurrency: string,
    targetCurrencies: string[],
    forceFresh = false,
  ): Promise<BatchChainResult<number>> {
    return fillByKey<number>({
      category: "fx",
      keys: targetCurrencies.map((c) => (c || "").trim()).filter(Boolean),
      isValid: (rate) => Number.isFinite(rate) && rate > 0,
      attempts: [
        { provider: "fmp", isAvailable: () => this.fmpReady(), fetch: (missing) => this.fmp!.getExchangeRates(baseCurrency, missing, forceFresh) },
        { provider: "yahoo", fetch: (missing) => this.yahoo.getExchangeRates(baseCurrency, missing, forceFresh) },
        { provider: "finnhub", isAvailable: () => this.finnhubReady(), fetch: (missing) => this.finnhub.getExchangeRates(baseCurrency, missing, forceFresh) },
      ],
    });
  }

  /**
   * Retrieve historical chart candle data. Throws when no provider has the
   * symbol, as the Yahoo client did.
   */
  public async getChart(
    symbol: string,
    range = "1y",
    interval = "1d",
    forceFresh = false,
  ): Promise<YahooChartData> {
    const result = await this.getChartWithSource(symbol, range, interval, forceFresh);
    if (result.data) return result.data;
    throw result.error instanceof Error ? result.error : new Error("No chart data from any provider");
  }

  /** Chart plus the provider that supplied it. FMP serves daily intervals only. */
  public async getChartWithSource(
    symbol: string,
    range = "1y",
    interval = "1d",
    forceFresh = false,
  ): Promise<ChainResult<YahooChartData>> {
    return firstAvailable<YahooChartData>({
      category: "charts",
      isEmpty: (chart) => !chart.candles || chart.candles.length === 0,
      attempts: [
        { provider: "fmp", isAvailable: () => this.fmpReady(), fetch: () => this.fmp!.getChart(symbol, range, interval, forceFresh) },
        { provider: "yahoo", fetch: () => this.yahoo.getChart(symbol, range, interval, forceFresh) },
      ],
    });
  }

  /**
   * Search symbols. An ISIN or CUSIP query resolves through FMP first when
   * a key is set.
   */
  public async searchSymbols(query: string): Promise<YahooSymbolSearchResult[]> {
    return (await this.searchSymbolsWithSource(query)).data ?? [];
  }

  /** Search results plus the provider that supplied them. */
  public async searchSymbolsWithSource(query: string): Promise<ChainResult<YahooSymbolSearchResult[]>> {
    if (!query || !query.trim()) return { data: [], source: null, tried: [] };

    if ((isIsin(query) || isCusip(query)) && this.fmpReady()) {
      try {
        const results = await this.fmp!.searchIdentifier(query);
        if (results.length > 0) return { data: results, source: "fmp", tried: ["fmp"] };
      } catch {
        appLogger.logStep("warning", "market_data", "identifier_search_failed", "FMP identifier search failed; trying a plain search");
      }
    }

    return firstAvailable<YahooSymbolSearchResult[]>({
      category: "search",
      attempts: [
        { provider: "fmp", isAvailable: () => this.fmpReady(), fetch: () => this.fmp!.searchSymbols(query) },
        { provider: "yahoo", fetch: () => this.yahoo.searchSymbols(query) },
        { provider: "finnhub", isAvailable: () => this.finnhubReady(), fetch: () => this.finnhub.searchSymbols(query) },
      ],
    });
  }

  /**
   * Fetch general market news.
   */
  public async getMarketNews(limit = 5): Promise<MarketNewsItem[]> {
    return (await this.getMarketNewsWithSource(limit)).data ?? [];
  }

  /** Market news plus the provider that supplied it. */
  public async getMarketNewsWithSource(limit = 5): Promise<ChainResult<MarketNewsItem[]>> {
    return firstAvailable<MarketNewsItem[]>({
      category: "news",
      attempts: [
        { provider: "fmp", isAvailable: () => this.fmpReady(), fetch: () => this.fmp!.getMarketNews(limit) },
        {
          provider: "finnhub",
          isAvailable: () => this.finnhubReady(),
          fetch: async () =>
            (await this.finnhub.getMarketNews("general", limit)).map((n) => ({
              headline: n.headline,
              summary: n.summary,
              source: n.source,
              datetime: n.datetime,
              url: n.url,
            })),
        },
        { provider: "yahoo", fetch: () => this.yahoo.getMarketNews(limit) },
      ],
    });
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
