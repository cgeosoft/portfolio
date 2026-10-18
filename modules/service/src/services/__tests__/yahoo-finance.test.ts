import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { YahooFinanceService, type YahooChartData, type YahooQuote } from "../yahoo-finance.js";
import * as marketCache from "../../db/market-cache.repo.js";
import { getDatabase } from "../../db/database.js";
import { appLogger } from "../../logger.js";

/** The client's shared state, reset around every test. */
const internals = YahooFinanceService as unknown as {
  pausedUntil: number;
  offline: { reset(): void };
  sessionFailedAt: number;
  summarySession: unknown;
  chartCache: Map<string, unknown>;
  fxCache: Map<string, unknown>;
};

function resetYahoo(): void {
  internals.pausedUntil = 0;
  internals.offline.reset();
  internals.sessionFailedAt = 0;
  internals.summarySession = null;
  internals.chartCache.clear();
  internals.fxCache.clear();
  getDatabase().run("DELETE FROM market_cache WHERE key LIKE 'chart:%' OR key LIKE 'quote:%' OR key LIKE 'fx:%' OR key LIKE 'yahoo:%'");
}

/** A Yahoo chart response with two daily candles that close at `price`. */
function chartBody(price: number): string {
  const t = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: { currency: "USD", regularMarketPrice: price, previousClose: price },
          timestamp: [t - 86_400, t],
          indicators: { quote: [{ open: [price, price], high: [price, price], low: [price, price], close: [price, price], volume: [0, 0] }] },
        },
      ],
      error: null,
    },
  });
}

describe("YahooFinanceService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(resetYahoo);

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetYahoo();
  });

  it("stops at the first host on HTTP 429, pauses Yahoo and serves the stale copy", async () => {
    const stale: YahooChartData = {
      symbol: "PAUSE1",
      currency: "USD",
      regularMarketPrice: 10,
      candles: [{ timestamp: 1, date: "2026-10-01", open: 10, high: 10, low: 10, close: 10, volume: 0 }],
    };
    marketCache.set("chart:PAUSE1:1y:1d", stale, -1000);
    const fetchMock = mock(async () => new Response("Too Many Requests", { status: 429 }));
    globalThis.fetch = fetchMock as any;
    const yahoo = new YahooFinanceService();

    expect(await yahoo.getChart("PAUSE1", "1y", "1d", true)).toEqual(stale);
    // query1 shares the limit: it was not asked after query2 answered 429.
    expect(fetchMock.mock.calls.length).toBe(1);

    // While paused nothing goes to Yahoo: callers get a stale copy, or nothing.
    await expect(yahoo.getChart("PAUSE2", "1y", "1d", true)).rejects.toThrow("paused");
    expect(await yahoo.getQuoteSummary("PAUSE2", ["price"])).toBeNull();
    expect(await yahoo.getCorporateEvents("PAUSE2")).toBeNull();
    expect(await yahoo.searchSymbols("pause")).toEqual([]);
    expect(await yahoo.getMarketNews()).toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(1);

    // After the pause Yahoo is asked again.
    internals.pausedUntil = Date.now() - 1;
    globalThis.fetch = mock(async () => new Response(chartBody(12), { status: 200 })) as any;
    expect((await yahoo.getChart("PAUSE2", "1y", "1d", true)).regularMarketPrice).toBe(12);
  });

  it("treats Yahoo as offline after repeated network failures and serves stale copies without asking", async () => {
    const stale: YahooChartData = {
      symbol: "OFF1",
      currency: "USD",
      regularMarketPrice: 7,
      candles: [{ timestamp: 1, date: "2026-10-01", open: 7, high: 7, low: 7, close: 7, volume: 0 }],
    };
    marketCache.set("chart:OFF1:1y:1d", stale, -1000);
    const fetchMock = mock(async () => {
      throw new TypeError("Unable to connect");
    });
    globalThis.fetch = fetchMock as any;
    const yahoo = new YahooFinanceService();

    // A network failure skips the second host and serves the stale copy.
    expect(await yahoo.getChart("OFF1", "1y", "1d", true)).toEqual(stale);
    expect(fetchMock.mock.calls.length).toBe(1);
    // The stale copy stays in memory briefly: the next plain call does not wait for the network.
    expect(await yahoo.getChart("OFF1", "1y", "1d")).toEqual(stale);
    expect(fetchMock.mock.calls.length).toBe(1);

    for (let i = 2; i <= 5; i++) await yahoo.getChart(`OFF${i}`, "1y", "1d", true).catch(() => null);
    expect(fetchMock.mock.calls.length).toBe(5);
    // Offline now: no request goes out.
    expect(await yahoo.getChart("OFF1", "1y", "1d", true)).toEqual(stale);
    await expect(yahoo.getChart("OFF6", "1y", "1d", true)).rejects.toThrow("paused");
    expect(fetchMock.mock.calls.length).toBe(5);
  });

  it("refreshes a quote with the 1y chart when that chart has expired, so the build needs no second request", async () => {
    const fetchMock = mock(async (_url: string | URL | Request) => new Response(chartBody(30), { status: 200 }));
    globalThis.fetch = fetchMock as any;
    const yahoo = new YahooFinanceService();

    expect((await yahoo.getQuotes(["ONEY"], true)).get("ONEY")?.regularMarketPrice).toBe(30);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("range=1y");
    expect((await yahoo.getChart("ONEY", "1y", "1d")).regularMarketPrice).toBe(30);
    expect(fetchMock.mock.calls.length).toBe(1);

    // With a fresh 1y chart, a refresh asks only for the small 5d chart.
    await yahoo.getQuotes(["ONEY"], true);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("range=5d");
  });

  it("checks the memory cache before it reads the disk row", async () => {
    globalThis.fetch = mock(async () => new Response(chartBody(20), { status: 200 })) as any;
    const yahoo = new YahooFinanceService();
    await yahoo.getChart("MEMO", "1y", "1d");

    const diskReads = spyOn(marketCache, "get");
    try {
      expect((await yahoo.getChart("MEMO", "1y", "1d")).regularMarketPrice).toBe(20);
      expect(diskReads.mock.calls.some(([key]) => key === "chart:MEMO:1y:1d")).toBe(false);
    } finally {
      diskReads.mockRestore();
    }
  });

  it("remembers a failed cookie and crumb lookup for a minute", async () => {
    // fc.yahoo.com without a Set-Cookie header: no session.
    const fetchMock = mock(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as any;
    const yahoo = new YahooFinanceService();

    expect(await yahoo.getQuoteSummary("SESS1", ["price"])).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(await yahoo.getQuoteSummary("SESS2", ["price"])).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(1);

    internals.sessionFailedAt = Date.now() - 61_000;
    await yahoo.getQuoteSummary("SESS3", ["price"]);
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("names no symbol or query in its logs and errors", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/v1/finance/search")) throw new TypeError(`Unable to connect to ${href}`);
      return new Response(JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found for ZZLOGSYM" } } }), { status: 200 });
    }) as any;
    const logSpy = spyOn(appLogger, "logStep").mockImplementation(() => {});

    try {
      const yahoo = new YahooFinanceService();
      const error = await yahoo.getChart("ZZLOGSYM", "1y", "1d").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("ZZLOGSYM");
      expect((await yahoo.getQuotes(["ZZLOGSYM"])).size).toBe(0);
      expect(await yahoo.searchSymbols("ZZLOGSYM")).toEqual([]);

      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logged).toContain("chart_failed");
      expect(logged).toContain("search");
      expect(logged).not.toContain("ZZLOGSYM");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fetches the FX pair again when fresh rates are asked for", async () => {
    const dayOld: YahooQuote = {
      symbol: "EURUSD=X",
      regularMarketPrice: 1,
      regularMarketChange: 0,
      regularMarketChangePercent: 0,
      currency: "USD",
      updatedAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    };
    marketCache.set("quote:EURUSD=X", dayOld, 4 * 60 * 60 * 1000);
    globalThis.fetch = mock(async () => new Response(chartBody(1.25), { status: 200 })) as any;
    const yahoo = new YahooFinanceService();

    // A plain call may use the cached pair quote.
    expect((await yahoo.getExchangeRates("EUR", ["USD"])).get("USD")).toBeCloseTo(1, 6);
    // A refresh asks Yahoo: 1 / 1.25 USD per EUR.
    expect((await yahoo.getExchangeRates("EUR", ["USD"], true)).get("USD")).toBeCloseTo(0.8, 6);
  });
});
