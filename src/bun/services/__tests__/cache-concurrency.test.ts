import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mapWithConcurrencyLimit, extractQuoteFromChart, type YahooChartData } from "../yahoo-finance.js";
import * as marketCache from "../../db/market-cache.repo.js";
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

