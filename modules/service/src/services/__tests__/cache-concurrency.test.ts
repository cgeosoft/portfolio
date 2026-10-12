import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import { appLogger } from "../../logger.js";
import { mapWithConcurrencyLimit, extractQuoteFromChart, type YahooChartData, type YahooQuote } from "../yahoo-finance.js";
import { PortfolioService, type IMarketDataProvider } from "../portfolio.js";
import * as marketCache from "../../db/market-cache.repo.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { getDatabase } from "../../db/database.js";

describe("mapWithConcurrencyLimit", () => {
  it("processes all items and preserves order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const results = await mapWithConcurrencyLimit(items, 3, async (num) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return num * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("never exceeds the specified concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const limit = 4;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrencyLimit(items, limit, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(limit);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("handles empty arrays", async () => {
    const results = await mapWithConcurrencyLimit([], 4, async (x) => x);
    expect(results).toEqual([]);
  });
});

describe("extractQuoteFromChart", () => {
  it("extracts quote values accurately from chart candles and meta", () => {
    const mockChart: YahooChartData = {
      symbol: "AAPL",
      currency: "USD",
      regularMarketPrice: 155.5,
      previousClose: 150.0,
      fiftyTwoWeekHigh: 180.0,
      fiftyTwoWeekLow: 130.0,
      shortName: "Apple Inc.",
      longName: "Apple Inc.",
      candles: [
        { timestamp: 1000, date: "2026-09-01", open: 148, high: 151, low: 147, close: 150, volume: 1000 },
        { timestamp: 2000, date: "2026-09-02", open: 151, high: 156, low: 150, close: 155.5, volume: 2000 },
      ],
    };

    const quote = extractQuoteFromChart(mockChart);
    expect(quote).not.toBeNull();
    expect(quote!.symbol).toBe("AAPL");
    expect(quote!.regularMarketPrice).toBe(155.5);
    expect(quote!.previousClose).toBe(150.0);
    expect(quote!.regularMarketChange).toBe(5.5);
    expect(quote!.regularMarketChangePercent).toBeCloseTo(3.67, 1);
    expect(quote!.currency).toBe("USD");
  });

  it("takes the previous close from the candle before the latest, not the range start", () => {
    const yearChart: YahooChartData = {
      symbol: "SXR8.DE",
      currency: "EUR",
      regularMarketPrice: 600,
      previousClose: 500,
      candles: [
        { timestamp: 1000, date: "2025-10-09", open: 500, high: 500, low: 500, close: 500, volume: 0 },
        { timestamp: 2000, date: "2026-10-08", open: 594, high: 596, low: 593, close: 595, volume: 0 },
        { timestamp: 3000, date: "2026-10-09", open: 595, high: 601, low: 594, close: 600, volume: 0 },
      ],
    };

    const quote = extractQuoteFromChart(yearChart);
    expect(quote!.previousClose).toBe(595);
    expect(quote!.regularMarketChangePercent).toBeCloseTo(0.84, 2);
  });

  it("returns null for empty candle data", () => {
    const emptyChart: YahooChartData = {
      symbol: "TEST",
      currency: "USD",
      regularMarketPrice: 0,
      candles: [],
    };
    expect(extractQuoteFromChart(emptyChart)).toBeNull();
  });
});

describe("marketCache SQLite repository", () => {
  beforeEach(() => {
    getDatabase();
  });

  it("sets and retrieves cached entries with expiration status", () => {
    const testKey = "test:quote:XYZ";
    const testData = { price: 42.5, symbol: "XYZ" };

    marketCache.set(testKey, testData, 60_000);

    const entry = marketCache.get<typeof testData>(testKey);
    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual(testData);
    expect(entry!.isExpired).toBe(false);

    marketCache.deleteKey(testKey);
    expect(marketCache.get(testKey)).toBeNull();
  });

  it("correctly identifies expired entries", async () => {
    const testKey = "test:expired:ABC";
    marketCache.set(testKey, { val: 1 }, 1); // 1ms TTL

    await new Promise((resolve) => setTimeout(resolve, 10));

    const entry = marketCache.get(testKey);
    expect(entry).not.toBeNull();
    expect(entry!.isExpired).toBe(true);

    marketCache.deleteKey(testKey);
  });

  it("prunes entries expired longer than the grace, but no portfolio entry", () => {
    marketCache.set("test:prune:old", { v: 1 }, -10_000);
    marketCache.set("test:prune:recent", { v: 1 }, -1_000);
    marketCache.set("test:prune:fresh", { v: 1 }, 60_000);
    marketCache.set("portfolio:prune-test_EUR", { v: 1 }, -10_000);

    expect(marketCache.pruneExpired(5_000)).toBeGreaterThanOrEqual(1);
    expect(marketCache.get("test:prune:old")).toBeNull();
    expect(marketCache.get("test:prune:recent")).not.toBeNull();
    expect(marketCache.get("test:prune:fresh")).not.toBeNull();
    expect(marketCache.get("portfolio:prune-test_EUR")).not.toBeNull();

    for (const key of ["test:prune:recent", "test:prune:fresh", "portfolio:prune-test_EUR"]) marketCache.deleteKey(key);
  });

  it("reads the expiry of an entry without its data", () => {
    marketCache.set("test:expiry", { big: "x".repeat(10_000) }, 60_000);
    const expiresAt = marketCache.getExpiresAt("test:expiry");
    expect(expiresAt).not.toBeNull();
    expect(expiresAt! - Date.now()).toBeGreaterThan(50_000);
    expect(marketCache.getExpiresAt("test:expiry:missing")).toBeNull();
    marketCache.deleteKey("test:expiry");
  });

  it("deletes a key prefix and nothing next to it", () => {
    const keys = ["portfolio:pfx_EUR", "portfolio:pfx_USD", "portfolio:pfx", "portfolio:pfx-EUR", "portfolio:pfxa_EUR", "portfolio:pfw_EUR", "portfolio:pfx`"];
    for (const key of keys) marketCache.set(key, { ok: 1 }, 60_000);

    expect(marketCache.deleteByPrefix("portfolio:pfx_")).toBe(2);
    expect(keys.filter((key) => marketCache.get(key) !== null)).toEqual([
      "portfolio:pfx",
      "portfolio:pfx-EUR",
      "portfolio:pfxa_EUR",
      "portfolio:pfw_EUR",
      "portfolio:pfx`",
    ]);
    expect(marketCache.deleteByPrefix("")).toBe(0);

    for (const key of keys) marketCache.deleteKey(key);
  });

  it("logs a failed write with the kind of key, not the key", () => {
    const logSpy = spyOn(appLogger, "logStep").mockImplementation(() => {});
    try {
      // JSON cannot hold a BigInt, so the write fails.
      marketCache.set("fmp:quote:ZZCACHESYM", { volume: 1n }, 60_000);
      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logged).toContain("market_cache_set");
      expect(logged).toContain('\\"fmp\\" entry');
      expect(logged).not.toContain("ZZCACHESYM");
    } finally {
      logSpy.mockRestore();
    }
    expect(marketCache.get("fmp:quote:ZZCACHESYM")).toBeNull();
  });
});

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function chartOf(symbol: string, closes: Array<[string, number]>): YahooChartData {
  return {
    symbol,
    currency: "EUR",
    regularMarketPrice: closes[closes.length - 1]![1],
    candles: closes.map(([date, close], i) => ({ timestamp: i, date, open: close, high: close, low: close, close, volume: 0 })),
  };
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(condition()).toBe(true);
}

const buy = (date: string, symbol: string, shares: number, price: number) => ({
  date,
  type: "BUY",
  symbol,
  shares,
  price,
  amount: shares * price,
  currency: "EUR",
});

describe("PortfolioService forced refresh and stale builds", () => {
  it("refreshes the quotes in one call and puts the live price on the cached charts", async () => {
    const quoteCalls: Array<{ symbols: string[]; forceFresh?: boolean }> = [];
    const chartForce: Array<boolean | undefined> = [];
    const provider: IMarketDataProvider = {
      getQuotes: async (symbols, forceFresh) => {
        quoteCalls.push({ symbols: [...symbols].sort(), forceFresh });
        const quote = (symbol: string): YahooQuote => ({
          symbol,
          regularMarketPrice: 110,
          regularMarketChange: 10,
          regularMarketChangePercent: 10,
          previousClose: 100,
          currency: "EUR",
          updatedAt: `${today}T15:00:00.000Z`,
        });
        return new Map(symbols.map((s) => [s, quote(s)]));
      },
      getExchangeRates: async () => new Map(),
      getChart: async (symbol, _range, _interval, forceFresh) => {
        chartForce.push(forceFresh);
        // AAA's cached chart ends on the previous session, BBB's on today's.
        return chartOf(symbol, [
          ["2026-01-02", 90],
          symbol === "AAA" ? [yesterday, 100] : [today, 105],
        ]);
      },
    };
    const service = new PortfolioService(provider);
    const id = portfolioRepo.create({ name: "Forced refresh", baseCurrency: "EUR" }).id;
    try {
      await service.manageTransactions(id, { action: "batch_add", transactions: [buy("2026-01-02", "AAA", 1, 90), buy("2026-01-03", "BBB", 2, 90)] });
      const data = await service.getPortfolioData(id, "EUR", true);

      expect(quoteCalls).toEqual([{ symbols: ["AAA", "BBB"], forceFresh: true }]);
      expect(chartForce.length).toBe(2);
      expect(chartForce.every((force) => !force)).toBe(true);
      expect(data.holdings.find((h) => h.symbol === "AAA")?.currentPrice).toBe(110);
      // A chart that ended on the previous session gets today's point; today's point takes the live price.
      expect(data.individualCharts["AAA"]?.slice(-2)).toEqual([
        { date: yesterday, close: 100 },
        { date: today, close: 110 },
      ]);
      expect(data.individualCharts["BBB"]).toEqual([
        { date: "2026-01-02", close: 90 },
        { date: today, close: 110 },
      ]);
    } finally {
      portfolioRepo.deleteById(id);
      service.clearPortfolioCache(id);
      service.destroy();
    }
  });

  it("logs a failed chart without the symbol", async () => {
    const provider: IMarketDataProvider = {
      getQuotes: async () => {
        throw new Error("No quote for ZZLOGSYM");
      },
      getExchangeRates: async () => new Map(),
      getChart: async (symbol) => {
        throw new Error(`No chart data returned for ${symbol}`);
      },
    };
    const service = new PortfolioService(provider);
    const id = portfolioRepo.create({ name: "Quiet logs", baseCurrency: "EUR" }).id;
    try {
      await service.manageTransactions(id, { action: "add", transaction: buy("2026-01-02", "ZZLOGSYM", 1, 90) });
      const logSpy = spyOn(appLogger, "logStep").mockImplementation(() => {});
      try {
        await service.getPortfolioData(id, "EUR", true);
        const logged = JSON.stringify(logSpy.mock.calls);
        expect(logged).toContain("chart_fetch_error");
        expect(logged).not.toContain("ZZLOGSYM");
      } finally {
        logSpy.mockRestore();
      }
    } finally {
      portfolioRepo.deleteById(id);
      service.clearPortfolioCache(id);
      service.destroy();
    }
  });

  it("neither caches nor returns a build that started before the transactions changed", async () => {
    const first = gate();
    let chartCalls = 0;
    const provider: IMarketDataProvider = {
      getQuotes: async () => new Map(),
      getExchangeRates: async () => new Map(),
      getChart: async (symbol) => {
        chartCalls++;
        if (chartCalls === 1) await first.promise;
        return chartOf(symbol, [[yesterday, 100]]);
      },
    };
    const service = new PortfolioService(provider);
    const id = portfolioRepo.create({ name: "Stale build", baseCurrency: "EUR" }).id;
    try {
      await service.manageTransactions(id, { action: "add", transaction: buy("2026-01-02", "AAA", 1, 90) });
      const stale = service.getPortfolioData(id, "EUR");
      await waitFor(() => chartCalls === 1);
      await service.manageTransactions(id, { action: "add", transaction: buy("2026-01-03", "AAA", 2, 95) });
      first.open();

      const data = await stale;
      expect(data.holdings.find((h) => h.symbol === "AAA")?.shares).toBe(3);
      const disk = marketCache.get<FinancialPortfolioData>(`portfolio:${id}_EUR`);
      expect(disk?.data.holdings.find((h) => h.symbol === "AAA")?.shares).toBe(3);
    } finally {
      portfolioRepo.deleteById(id);
      service.clearPortfolioCache(id);
      service.destroy();
    }
  });

  it("leaves a newer in-flight build in place when an older one fails", async () => {
    const first = gate();
    const second = gate();
    let fxCalls = 0;
    const provider: IMarketDataProvider = {
      getQuotes: async () => new Map(),
      getExchangeRates: async () => {
        fxCalls++;
        if (fxCalls === 1) {
          await first.promise;
          throw new Error("offline");
        }
        if (fxCalls === 2) await second.promise;
        return new Map();
      },
      getChart: async (symbol) => chartOf(symbol, [[yesterday, 100]]),
    };
    const service = new PortfolioService(provider);
    const id = portfolioRepo.create({ name: "In-flight build", baseCurrency: "EUR" }).id;
    try {
      await service.manageTransactions(id, { action: "add", transaction: buy("2026-01-02", "AAA", 1, 90) });
      const older = service.getPortfolioData(id, "EUR");
      await waitFor(() => fxCalls === 1);
      service.clearPortfolioCache(id);
      const newer = service.getPortfolioData(id, "EUR");
      await waitFor(() => fxCalls === 2);

      first.open();
      await expect(older).rejects.toThrow("offline");
      // The failed build must not drop the newer one: this call joins it.
      const joined = service.getPortfolioData(id, "EUR");
      second.open();
      expect(await joined).toBe(await newer);
      expect(fxCalls).toBe(2);
    } finally {
      portfolioRepo.deleteById(id);
      service.clearPortfolioCache(id);
      service.destroy();
    }
  });
});

describe("PortfolioService cache & deduplication", () => {
  it("deduplicates concurrent in-flight requests for the same portfolio", async () => {
    const { PortfolioService } = await import("../portfolio.js");
    const { YahooFinanceService } = await import("../yahoo-finance.js");
    const portfolioRepo = await import("../../db/portfolio.repo.js");

    // Create a temporary portfolio
    const tempPortfolio = portfolioRepo.create({
      name: "Deduplication Test",
      baseCurrency: "EUR",
    });

    const mockYahoo = new YahooFinanceService();
    const service = new PortfolioService(mockYahoo);

    try {
      // Launch two concurrent requests for the same portfolio
      const [res1, res2] = await Promise.all([
        service.getPortfolioData(tempPortfolio.id, "EUR", true),
        service.getPortfolioData(tempPortfolio.id, "EUR", false),
      ]);

      // Both should resolve to the exact same object in memory (built once)
      expect(res1).toBe(res2);
    } finally {
      portfolioRepo.deleteById(tempPortfolio.id);
      service.clearPortfolioCache(tempPortfolio.id);
      service.destroy();
    }
  });

  it("loads cached portfolio data from SQLite persistent storage on cold restart", async () => {
    const { PortfolioService } = await import("../portfolio.js");
    const { YahooFinanceService } = await import("../yahoo-finance.js");
    const portfolioRepo = await import("../../db/portfolio.repo.js");

    const tempPortfolio = portfolioRepo.create({
      name: "Cold Start Test",
      baseCurrency: "USD",
    });

    const mockYahoo = new YahooFinanceService();
    const service1 = new PortfolioService(mockYahoo);

    try {
      // 1. Initial build writes to SQLite cache
      const data1 = await service1.getPortfolioData(tempPortfolio.id, "USD", true);
      expect(data1.summary).toBeDefined();

      // 2. Simulate complete cold app restart by creating a new service instance with empty memory cache
      const service2 = new PortfolioService(mockYahoo);

      const start = performance.now();
      const data2 = await service2.getPortfolioData(tempPortfolio.id, "USD", false);
      const duration = performance.now() - start;

      // Loaded from disk instantly
      expect(duration).toBeLessThan(100);
      expect(data2.summary.baseCurrency).toBe("USD");
      service2.destroy();

      // 3. Simulate expired disk cache on cold restart
      marketCache.set(`portfolio:${tempPortfolio.id}_USD`, data1, -1000); // already expired
      const service3 = new PortfolioService(mockYahoo);
      const startExpired = performance.now();
      const data3 = await service3.getPortfolioData(tempPortfolio.id, "USD", false);
      const durationExpired = performance.now() - startExpired;

      expect(durationExpired).toBeLessThan(100);
      expect(data3.summary.baseCurrency).toBe("USD");
      service3.destroy();
    } finally {
      portfolioRepo.deleteById(tempPortfolio.id);
      service1.clearPortfolioCache(tempPortfolio.id);
      service1.destroy();
    }
  });

  it("retains market data cache for 60 minutes across app restarts", async () => {
    const { PortfolioService } = await import("../portfolio.js");
    const { YahooFinanceService } = await import("../yahoo-finance.js");
    const portfolioRepo = await import("../../db/portfolio.repo.js");

    const tempPortfolio = portfolioRepo.create({
      name: "60Min Cache Test",
      baseCurrency: "EUR",
    });

    const mockYahoo = new YahooFinanceService();
    const service = new PortfolioService(mockYahoo);

    try {
      const data = await service.getPortfolioData(tempPortfolio.id, "EUR", true);
      const cacheKey = `portfolio:${tempPortfolio.id}_EUR`;
      const cached = marketCache.get(cacheKey);

      expect(cached).not.toBeNull();
      expect(cached!.isExpired).toBe(false);
      // Expiration should be roughly 60 minutes in the future
      const remainingMs = cached!.expiresAt - Date.now();
      expect(remainingMs).toBeGreaterThan(50 * 60 * 1000);
      expect(remainingMs).toBeLessThanOrEqual(60 * 60 * 1000);
    } finally {
      portfolioRepo.deleteById(tempPortfolio.id);
      service.clearPortfolioCache(tempPortfolio.id);
      service.destroy();
    }
  });
});

