import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { MarketDataCoordinator } from "../market-data.js";
import { YahooFinanceService, type YahooQuote, type YahooChartData } from "../yahoo-finance.js";
import { FinnhubService } from "../finnhub.js";
import { saveConfig, loadConfig, DEFAULT_DATA_PROVIDER_ROUTING } from "../../config.js";
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
        ...DEFAULT_DATA_PROVIDER_ROUTING,
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
        ...DEFAULT_DATA_PROVIDER_ROUTING,
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
        ...DEFAULT_DATA_PROVIDER_ROUTING,
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
        ...DEFAULT_DATA_PROVIDER_ROUTING,
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
        ...DEFAULT_DATA_PROVIDER_ROUTING,
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

describe("coordinator chain details", () => {
  const originalConfig = loadConfig();

  const quote = (symbol: string, price: number): YahooQuote => ({
    symbol,
    regularMarketPrice: price,
    regularMarketChange: 0,
    regularMarketChangePercent: 0,
    currency: "USD",
    updatedAt: new Date().toISOString(),
  });

  /** Quote provider stub answering only the listed symbols. */
  const quoteProvider = (known: Record<string, number>) =>
    mock(async (symbols: string[]) => new Map(symbols.filter((s) => s in known).map((s) => [s, quote(s, known[s]!)])));

  const route = (overrides: Record<string, string>) =>
    saveConfig({
      ...originalConfig,
      finnhubApiKey: "test-finnhub-key",
      dataProviderRouting: { ...DEFAULT_DATA_PROVIDER_ROUTING, ...overrides },
    } as never);

  beforeEach(() => {
    getDatabase().run("DELETE FROM market_cache");
    route({ quotes: "yahoo", news: "finnhub", charts: "yahoo", fx: "yahoo", fundamentals: "finnhub", search: "yahoo" });
  });

  afterEach(() => {
    saveConfig(originalConfig);
    getDatabase().run("DELETE FROM market_cache");
  });

  const coordinator = (yahoo: unknown, finnhub: unknown, fmp: unknown) =>
    new (MarketDataCoordinator as unknown as new (...a: unknown[]) => MarketDataCoordinator)(yahoo, finnhub, fmp);

  it("normalizes and dedupes the requested symbols", async () => {
    const yahoo = { getQuotes: quoteProvider({ AAPL: 1 }) };
    const fmp = { isConfigured: () => false, getQuotes: quoteProvider({}) };
    const finnhub = { isConfigured: () => true, getQuotes: quoteProvider({}) };
    const res = await coordinator(yahoo, finnhub, fmp).getQuotesWithSource([" aapl ", "AAPL", ""]);
    expect(yahoo.getQuotes.mock.calls.length).toBe(1);
    expect(yahoo.getQuotes.mock.calls[0]![0]).toEqual(["AAPL"]);
    expect(res.data.get("AAPL")?.regularMarketPrice).toBe(1);
  });

  it("fills each symbol from the next provider in the chain", async () => {
    route({ quotes: "fmp" });
    const fmp = { isConfigured: () => true, getQuotes: quoteProvider({ A: 1 }) };
    const yahoo = { getQuotes: quoteProvider({ B: 2 }) };
    const finnhub = { isConfigured: () => true, getQuotes: quoteProvider({ C: 3 }) };
    const res = await coordinator(yahoo, finnhub, fmp).getQuotesWithSource(["A", "B", "C"]);
    expect(yahoo.getQuotes.mock.calls[0]![0]).toEqual(["B", "C"]);
    expect(finnhub.getQuotes.mock.calls[0]![0]).toEqual(["C"]);
    expect(Object.fromEntries(res.sources)).toEqual({ A: "fmp", B: "yahoo", C: "finnhub" });
    expect(res.tried).toEqual(["fmp", "yahoo", "finnhub"]);
  });

  it("searches an ISIN with FMP first and falls back to the normal chain", async () => {
    const fmpResults = [{ symbol: "AAPL", name: "Apple", exchange: "FMP", quoteType: "EQUITY" }];
    const yahooResults = [{ symbol: "AAPL", name: "Apple Inc.", exchange: "NMS", quoteType: "EQUITY" }];
    const yahoo = { searchSymbols: mock(async () => yahooResults) };
    const finnhub = { isConfigured: () => false, searchSymbols: mock(async () => []) };
    const fmp = { isConfigured: () => true, searchIdentifier: mock(async () => fmpResults), searchSymbols: mock(async () => []) };
    const md = coordinator(yahoo, finnhub, fmp);
    expect(await md.searchSymbolsWithSource("US0378331005")).toEqual({ data: fmpResults, source: "fmp", tried: ["fmp"] } as never);
    expect(yahoo.searchSymbols.mock.calls.length).toBe(0);

    fmp.searchIdentifier = mock(async () => {
      throw new Error("fmp down");
    });
    const fallback = await md.searchSymbolsWithSource("US0378331005");
    expect(fallback.data).toEqual(yahooResults);
    expect(yahoo.searchSymbols.mock.calls.length).toBe(1);

    expect(await md.searchSymbolsWithSource("  ")).toEqual({ data: [], source: null, tried: [] } as never);
  });

  it("prefetches chart quotes from FMP only when it serves charts", async () => {
    route({});
    const prefetchQuotes = mock(async (_s: string[]) => {});
    const off = coordinator({}, { isConfigured: () => false }, { isConfigured: () => false, prefetchQuotes });
    await off.prefetchChartQuotes(["A"]);
    expect(prefetchQuotes.mock.calls.length).toBe(0);

    const on = coordinator({}, { isConfigured: () => false }, { isConfigured: () => true, prefetchQuotes });
    await on.prefetchChartQuotes(["A"]);
    expect(prefetchQuotes.mock.calls).toEqual([[["A"]]]);
    await on.prefetchChartQuotes([]);
    expect(prefetchQuotes.mock.calls.length).toBe(1);

    route({ charts: "yahoo" });
    await on.prefetchChartQuotes(["A"]);
    expect(prefetchQuotes.mock.calls.length).toBe(1);
  });

  it("rejects a chart with the provider error or a generic message", async () => {
    const fmp = { isConfigured: () => false, getChart: mock(async () => null) };
    const finnhub = { isConfigured: () => false };
    const failing = coordinator(
      {
        getChart: mock(async () => {
          throw new Error("boom");
        }),
      },
      finnhub,
      fmp,
    );
    await expect(failing.getChart("ZQCH1", "1y", "1d")).rejects.toThrow("boom");

    const empty = coordinator({ getChart: mock(async () => null) }, finnhub, fmp);
    await expect(empty.getChart("ZQCH2", "1y", "1d")).rejects.toThrow("No chart data from any provider");

    // An empty candle list counts as an empty answer, which the chain still returns.
    const noCandles: YahooChartData = { symbol: "ZQCH3", currency: "USD", regularMarketPrice: 1, candles: [] };
    const blank = coordinator({ getChart: mock(async () => noCandles) }, finnhub, fmp);
    expect(await blank.getChart("ZQCH3", "1y", "1d")).toEqual(noCandles);
  });

  it("maps Finnhub news to the shared fields only", async () => {
    const item = { headline: "H", summary: "S", source: "Src", datetime: 1772445600, url: "https://example.com/n", id: 9, image: "img", category: "general", related: "X" };
    const finnhub = { isConfigured: () => true, getMarketNews: mock(async () => [item]), getCompanyNews: mock(async () => [item]) };
    const md = coordinator({ getMarketNews: mock(async () => []) }, finnhub, { isConfigured: () => false });
    const news = await md.getMarketNews();
    expect(news).toEqual([{ headline: "H", summary: "S", source: "Src", datetime: 1772445600, url: "https://example.com/n" }] as never);
  });
});
