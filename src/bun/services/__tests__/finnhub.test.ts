import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { FinnhubService } from "../finnhub.js";
import * as marketCache from "../../db/market-cache.repo.js";
import { getDatabase } from "../../db/database.js";
import { saveConfig, loadConfig } from "../../config.js";

describe("FinnhubService", () => {
  const originalFetch = globalThis.fetch;
  const originalConfig = loadConfig();

  beforeEach(() => {
    const db = getDatabase();
    db.run("DELETE FROM market_cache WHERE key LIKE 'finnhub:%'");
    saveConfig({ ...originalConfig, finnhubApiKey: "test-finnhub-key" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    saveConfig(originalConfig);
    const db = getDatabase();
    db.run("DELETE FROM market_cache WHERE key LIKE 'finnhub:%'");
  });

  it("checks configuration status and api key resolution", () => {
    const service = new FinnhubService();
    expect(service.isConfigured()).toBe(true);
    expect(service.getApiKey()).toBe("test-finnhub-key");
    expect(service.getApiKey("override-key")).toBe("override-key");

    saveConfig({ ...originalConfig, finnhubApiKey: "" });
    expect(service.isConfigured()).toBe(false);
    expect(service.isConfigured("custom-key")).toBe(true);
  });

  it("testConnection returns success on valid response", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toBeDefined();
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Finnhub-Token"]).toBe("test-finnhub-key");
      return new Response(JSON.stringify([{ headline: "Market rally", summary: "Stocks up" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const service = new FinnhubService();
    const result = await service.testConnection();
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("testConnection returns failure on 401 unauthorized", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as any;

    const service = new FinnhubService();
    const result = await service.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication failed");
  });

  it("testConnection returns failure on 429 rate limit", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Too Many Requests", { status: 429 });
    }) as any;

    const service = new FinnhubService();
    const result = await service.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain("rate limit exceeded");
  });

  it("getMarketNews retrieves and caches general news", async () => {
    let fetchCount = 0;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetchCount++;
      return new Response(
        JSON.stringify([
          { id: 1, headline: "Tech Earnings Strong", summary: "Mega-cap tech reports gains", source: "Bloomberg", datetime: 1700000000, url: "https://bloomberg.com/news1" },
          { id: 2, headline: "Fed Holds Rates", summary: "Central bank maintains current policy", source: "Reuters", datetime: 1700001000, url: "https://reuters.com/news2" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const service = new FinnhubService();
    const news1 = await service.getMarketNews("general", 5);
    expect(news1.length).toBe(2);
    expect(news1[0]!.headline).toBe("Tech Earnings Strong");
    expect(fetchCount).toBe(1);

    // Second call should hit the cache and not trigger fetch
    const news2 = await service.getMarketNews("general", 5);
    expect(news2.length).toBe(2);
    expect(fetchCount).toBe(1);
  });

  it("getCompanyNews retrieves news for a specific symbol", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      expect(urlStr).toContain("/company-news");
      expect(urlStr).toContain("symbol=AAPL");
      expect(urlStr).toContain("from=2026-09-01");
      expect(urlStr).toContain("to=2026-09-07");

      return new Response(
        JSON.stringify([
          { id: 101, headline: "Apple Unveils New Hardware", summary: "Event announced for next month", source: "CNBC", datetime: 1700002000, url: "https://cnbc.com/apple1" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const service = new FinnhubService();
    const news = await service.getCompanyNews("AAPL", "2026-09-01", "2026-09-07", 2);
    expect(news.length).toBe(1);
    expect(news[0]!.headline).toBe("Apple Unveils New Hardware");
  });

  it("getRecommendationTrends returns analyst consensus distribution", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      return new Response(
        JSON.stringify([
          { symbol: "MSFT", buy: 30, hold: 5, sell: 1, strongBuy: 15, strongSell: 0, period: "2026-09-01" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const service = new FinnhubService();
    const trend = await service.getRecommendationTrends("MSFT");
    expect(trend).not.toBeNull();
    expect(trend!.strongBuy).toBe(15);
    expect(trend!.buy).toBe(30);
    expect(trend!.hold).toBe(5);
  });

  it("getBasicFinancials retrieves company metrics", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          symbol: "NVDA",
          metricType: "all",
          metric: {
            "52WeekHigh": 140.5,
            "52WeekLow": 45.2,
            beta: 1.65,
            peBasicExclExtraTTM: 35.8,
            dividendYieldIndicatedAnnual: 0.08,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const service = new FinnhubService();
    const fin = await service.getBasicFinancials("NVDA");
    expect(fin).not.toBeNull();
    expect(fin!.metric["52WeekHigh"]).toBe(140.5);
    expect(fin!.metric.peBasicExclExtraTTM).toBe(35.8);
  });

  it("getReportMarketIntelligence aggregates market news, holdings news, and analyst ratings", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/news?")) {
        return new Response(
          JSON.stringify([
            { id: 1, headline: "Global Markets Advance", summary: "Indexes hit records", source: "WSJ", datetime: 1700000000, url: "https://wsj.com" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("/company-news")) {
        return new Response(
          JSON.stringify([
            { id: 2, headline: "Product Release", summary: "New cloud architecture", source: "Reuters", datetime: 1700000000, url: "https://reuters.com" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("/stock/recommendation")) {
        return new Response(
          JSON.stringify([
            { symbol: "AAPL", buy: 20, hold: 4, sell: 1, strongBuy: 10, strongSell: 0, period: "2026-09-01" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("/stock/metric")) {
        return new Response(
          JSON.stringify({
            symbol: "AAPL",
            metric: { peBasicExclExtraTTM: 28.5, beta: 1.1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("/stock/profile2")) {
        return new Response(
          JSON.stringify({
            name: "Apple Inc",
            finnhubIndustry: "Consumer Electronics",
            marketCapitalization: 3000000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const service = new FinnhubService();
    const intel = await service.getReportMarketIntelligence({
      symbols: ["AAPL", "BTC-USD"], // BTC-USD should be filtered out
      fromDate: "2026-09-01",
      toDate: "2026-09-07",
    });

    expect(intel.configured).toBe(true);
    expect(intel.marketNews.length).toBe(1);
    expect(intel.marketNews[0]!.headline).toBe("Global Markets Advance");

    expect(intel.holdings["AAPL"]).toBeDefined();
    expect(intel.holdings["AAPL"]!.profile?.name).toBe("Apple Inc");
    expect(intel.holdings["AAPL"]!.recommendation?.strongBuy).toBe(10);
    expect(intel.holdings["AAPL"]!.metrics?.peRatio).toBe(28.5);
    expect(intel.holdings["BTC-USD"]).toBeUndefined();
  });
});
