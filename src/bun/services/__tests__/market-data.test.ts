import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { MarketDataCoordinator } from "../market-data.js";
import { YahooFinanceService, type YahooQuote, type YahooChartData } from "../yahoo-finance.js";
import { FinnhubService } from "../finnhub.js";
import { saveConfig, loadConfig } from "../../config.js";
import { getDatabase } from "../../db/database.js";
import * as marketCache from "../../db/market-cache.repo.js";

describe("MarketDataCoordinator & Provider Isolation", () => {
  const originalConfig = loadConfig();

  beforeEach(() => {
    const db = getDatabase();
    db.run("DELETE FROM market_cache");
    saveConfig({
      ...originalConfig,
      finnhubApiKey: "test-finnhub-key",
      dataProviderRouting: {
        quotes: "yahoo",
        news: "finnhub",
        charts: "yahoo",
        fx: "yahoo",
        fundamentals: "finnhub",
        search: "yahoo",
      },
    });
  });

  afterEach(() => {
    saveConfig(originalConfig);
    const db = getDatabase();
    db.run("DELETE FROM market_cache");
  });

  it("routes quotes to Yahoo Finance by default", async () => {
    const mockYahoo = {
      getQuotes: mock(async (symbols: string[]) => {
        const m = new Map<string, YahooQuote>();
        m.set("AAPL", {
          symbol: "AAPL",
          regularMarketPrice: 150,
          regularMarketChange: 1,
          regularMarketChangePercent: 0.67,
          currency: "USD",
          updatedAt: new Date().toISOString(),
        });
        return m;
      }),
    } as unknown as YahooFinanceService;

    const mockFinnhub = {
      isConfigured: () => true,
      getQuotes: mock(async () => new Map<string, YahooQuote>()),
    } as unknown as FinnhubService;

    const coordinator = new MarketDataCoordinator(mockYahoo, mockFinnhub);
    const quotes = await coordinator.getQuotes(["AAPL"]);

    expect(quotes.has("AAPL")).toBe(true);
    expect(quotes.get("AAPL")!.regularMarketPrice).toBe(150);
    expect((mockYahoo.getQuotes as any).mock.calls.length).toBe(1);
    expect((mockFinnhub.getQuotes as any).mock.calls.length).toBe(0);
  });

  it("routes quotes to Finnhub when configured in dataProviderRouting", async () => {
    saveConfig({
      ...loadConfig(),
      dataProviderRouting: {
        quotes: "finnhub",
        news: "finnhub",
        charts: "yahoo",
        fx: "yahoo",
        fundamentals: "finnhub",
        search: "yahoo",
      },
    });

    const mockYahoo = {
      getQuotes: mock(async () => new Map<string, YahooQuote>()),
    } as unknown as YahooFinanceService;

    const mockFinnhub = {
      isConfigured: () => true,
      getQuotes: mock(async (symbols: string[]) => {
        const m = new Map<string, YahooQuote>();
        m.set("AAPL", {
          symbol: "AAPL",
          regularMarketPrice: 155,
          regularMarketChange: 2,
          regularMarketChangePercent: 1.3,
          currency: "USD",
          updatedAt: new Date().toISOString(),
        });
        return m;
      }),
    } as unknown as FinnhubService;

    const coordinator = new MarketDataCoordinator(mockYahoo, mockFinnhub);
    const quotes = await coordinator.getQuotes(["AAPL"]);

    expect(quotes.has("AAPL")).toBe(true);
    expect(quotes.get("AAPL")!.regularMarketPrice).toBe(155);
    expect((mockFinnhub.getQuotes as any).mock.calls.length).toBe(1);
    expect((mockYahoo.getQuotes as any).mock.calls.length).toBe(0);
  });

  it("isolates provider failures: falls back to Yahoo when Finnhub throws error", async () => {
    saveConfig({
      ...loadConfig(),
      dataProviderRouting: {
        quotes: "finnhub",
        news: "finnhub",
        charts: "yahoo",
        fx: "yahoo",
        fundamentals: "finnhub",
        search: "yahoo",
      },
    });

    const mockYahoo = {
      getQuotes: mock(async (symbols: string[]) => {
        const m = new Map<string, YahooQuote>();
        m.set("AAPL", {
          symbol: "AAPL",
          regularMarketPrice: 150,
          regularMarketChange: 1,
          regularMarketChangePercent: 0.67,
          currency: "USD",
          updatedAt: new Date().toISOString(),
        });
        return m;
      }),
    } as unknown as YahooFinanceService;

    const mockFinnhub = {
      isConfigured: () => true,
      getQuotes: mock(async () => {
        throw new Error("Finnhub rate limit 429");
      }),
    } as unknown as FinnhubService;

    const coordinator = new MarketDataCoordinator(mockYahoo, mockFinnhub);
    const quotes = await coordinator.getQuotes(["AAPL"]);

    expect(quotes.has("AAPL")).toBe(true);
    expect(quotes.get("AAPL")!.regularMarketPrice).toBe(150);
    expect((mockYahoo.getQuotes as any).mock.calls.length).toBe(1);
  });

  it("routes symbol search to Finnhub when selected, with fallback to Yahoo", async () => {
    saveConfig({
      ...loadConfig(),
      dataProviderRouting: {
        quotes: "yahoo",
        news: "finnhub",
        charts: "yahoo",
        fx: "yahoo",
        fundamentals: "finnhub",
        search: "finnhub",
      },
    });

    const mockFinnhub = {
      isConfigured: () => true,
      searchSymbols: mock(async (query: string) => [
        {
          symbol: "TSLA",
          name: "TESLA INC",
          exchange: "Finnhub",
          quoteType: "EQUITY",
        },
      ]),
    } as unknown as FinnhubService;

    const mockYahoo = {
      searchSymbols: mock(async () => []),
    } as unknown as YahooFinanceService;

    const coordinator = new MarketDataCoordinator(mockYahoo, mockFinnhub);
    const results = await coordinator.searchSymbols("TSLA");

    expect(results.length).toBe(1);
    expect(results[0]!.symbol).toBe("TSLA");
    expect((mockFinnhub.searchSymbols as any).mock.calls.length).toBe(1);
  });

  it("routes FX exchange rates based on category setting", async () => {
    saveConfig({
      ...loadConfig(),
      dataProviderRouting: {
        quotes: "yahoo",
        news: "finnhub",
        charts: "yahoo",
        fx: "finnhub",
        fundamentals: "finnhub",
        search: "yahoo",
      },
    });

    const mockFinnhub = {
      isConfigured: () => true,
      getExchangeRates: mock(async () => {
        const m = new Map<string, number>();
        m.set("USD", 0.91);
        return m;
      }),
    } as unknown as FinnhubService;

    const mockYahoo = {
      getExchangeRates: mock(async () => new Map<string, number>()),
    } as unknown as YahooFinanceService;

    const coordinator = new MarketDataCoordinator(mockYahoo, mockFinnhub);
    const rates = await coordinator.getExchangeRates("EUR", ["USD"]);

    expect(rates.get("USD")).toBe(0.91);
    expect((mockFinnhub.getExchangeRates as any).mock.calls.length).toBe(1);
  });

  it("clears market cache records successfully", () => {
    marketCache.set("quote:AAPL", { test: 123 }, 60000);
    marketCache.set("fx:EUR:USD", 1.08, 60000);
    marketCache.set("finnhub:news", { items: [] }, 60000);

    const mockYahoo = {} as YahooFinanceService;
    const mockFinnhub = {} as FinnhubService;
    const coordinator = new MarketDataCoordinator(mockYahoo, mockFinnhub);

    const res = coordinator.clearMarketCache();
    expect(res.success).toBe(true);
    expect(res.clearedEntries).toBeGreaterThanOrEqual(3);

    expect(marketCache.get("quote:AAPL")).toBeNull();
    expect(marketCache.get("fx:EUR:USD")).toBeNull();
    expect(marketCache.get("finnhub:news")).toBeNull();
  });
});
