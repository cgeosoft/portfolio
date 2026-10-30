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

/** Replaces fetch with a router and records each URL and the request headers. */
function routeFetch(route: (url: URL, n: number) => Response | Promise<Response>): { url: URL; headers: Record<string, string> }[] {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return route(url, calls.length);
  }) as unknown as typeof fetch;
  return calls;
}

describe("YahooFinanceService chart parsing", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(resetYahoo);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetYahoo();
  });

  it("maps meta and candles and skips a null close", async () => {
    routeFetch(() =>
      Response.json({
        chart: {
          result: [
            {
              meta: { currency: "EUR", regularMarketPrice: 101, previousClose: 99, fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80, shortName: "Short", instrumentType: "ETF" },
              timestamp: [1767225600, 1767312000, 1767398400],
              indicators: { quote: [{ open: [1, null, 3], high: [2, null, 4], low: [0.5, null, 2], close: [1.5, null, 3.5], volume: [10, null, null] }] },
            },
          ],
          error: null,
        },
      }),
    );
    const chart = await new YahooFinanceService().getChart("ZQPARSE", "1y", "1d");
    expect(chart).toEqual({
      symbol: "ZQPARSE",
      currency: "EUR",
      regularMarketPrice: 101,
      previousClose: 99,
      fiftyTwoWeekHigh: 120,
      fiftyTwoWeekLow: 80,
      shortName: "Short",
      longName: "Short",
      instrumentType: "ETF",
      candles: [
        { timestamp: 1767225600000, date: "2026-01-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        { timestamp: 1767398400000, date: "2026-01-03", open: 3, high: 4, low: 2, close: 3.5, volume: 0 },
      ],
    } as YahooChartData);
  });

  it("fills defaults from a bare meta and writes a quote row", async () => {
    routeFetch(() =>
      Response.json({
        chart: {
          result: [{ meta: {}, timestamp: [1767225600, 1767312000], indicators: { quote: [{ open: [1, 2], high: [1, 2], low: [1, 2], close: [1, 2], volume: [0, 0] }] } }],
          error: null,
        },
      }),
    );
    const chart = await new YahooFinanceService().getChart("ZQBARE", "1y", "1d");
    expect(chart.currency).toBe("USD");
    expect(chart.regularMarketPrice).toBe(2);
    expect(chart.longName).toBe("ZQBARE");
    expect(chart.instrumentType).toBeUndefined();
    expect(marketCache.get("quote:ZQBARE")).not.toBeNull();
  });

  it("tries query1 after an HTTP 500 from query2", async () => {
    const calls = routeFetch((_url, n) => (n === 1 ? new Response("err", { status: 500 }) : new Response(chartBody(5), { status: 200 })));
    const chart = await new YahooFinanceService().getChart("ZQHOST", "1y", "1d");
    expect(chart.regularMarketPrice).toBe(5);
    expect(calls.length).toBe(2);
    expect(calls[0]!.url.host).toBe("query2.finance.yahoo.com");
    expect(calls[1]!.url.host).toBe("query1.finance.yahoo.com");
  });

  it("rejects with Yahoo's error code and without the symbol", async () => {
    routeFetch(() => Response.json({ chart: { result: null, error: { code: "Not Found" } } }));
    const error = await new YahooFinanceService().getChart("ZQNOTFOUND", "1y", "1d").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Not Found");
    expect((error as Error).message).not.toContain("ZQNOTFOUND");
  });

  it("shares one fetch between two concurrent chart calls", async () => {
    const calls = routeFetch(() => new Response(chartBody(8), { status: 200 }));
    const yahoo = new YahooFinanceService();
    const [a, b] = await Promise.all([yahoo.getChart("ZQDEDUP", "1y", "1d"), yahoo.getChart("ZQDEDUP", "1y", "1d")]);
    expect(a.regularMarketPrice).toBe(8);
    expect(b.regularMarketPrice).toBe(8);
    expect(calls.length).toBe(1);
  });
});

describe("YahooFinanceService search filtering", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(resetYahoo);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetYahoo();
  });

  it("drops options, futures and rows without a symbol and fills defaults", async () => {
    const calls = routeFetch(() =>
      Response.json({
        quotes: [
          { symbol: "A", quoteType: "EQUITY", longname: "Long", shortname: "S", exchange: "NMS", typeDisp: "Equity" },
          { symbol: "O", quoteType: "OPTION" },
          { symbol: "F", quoteType: "FUTURE" },
          { quoteType: "ETF" },
          { symbol: "I", quoteType: "INDEX" },
          { symbol: "C", quoteType: "CRYPTOCURRENCY", shortname: "Coin" },
        ],
      }),
    );
    const yahoo = new YahooFinanceService();
    const res = await yahoo.searchSymbols("zqsearch");
    expect(res.length).toBe(3);
    expect(res[0]).toMatchObject({ symbol: "A", name: "Long", exchange: "NMS", quoteType: "EQUITY", typeDisp: "Equity" });
    expect(res[1]).toMatchObject({ symbol: "I", name: "I", exchange: "US", quoteType: "INDEX", typeDisp: "INDEX" });
    expect(res[2]).toMatchObject({ symbol: "C", name: "Coin", exchange: "US", quoteType: "CRYPTOCURRENCY", typeDisp: "CRYPTOCURRENCY" });

    expect(await yahoo.searchSymbols("   ")).toEqual([]);
    expect(calls.length).toBe(1);
  });
});

describe("YahooFinanceService corporate events", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(resetYahoo);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetYahoo();
  });

  it("sorts dividends, drops zero amounts and invalid splits", async () => {
    const calls = routeFetch(() =>
      Response.json({
        chart: {
          result: [
            {
              meta: { currency: "GBp" },
              events: {
                dividends: { a: { amount: 0.2, date: 1767225600 }, b: { amount: 0, date: 1767312000 }, c: { amount: 0.1, date: 1735689600 } },
                splits: { s: { date: 1767398400, numerator: "2", denominator: "1" }, bad: { date: 1767398400, numerator: 0, denominator: 1 } },
              },
            },
          ],
        },
      }),
    );
    const events = await new YahooFinanceService().getCorporateEvents("ZQEV");
    expect(events).toEqual({
      symbol: "ZQEV",
      currency: "GBp",
      dividends: [
        { date: "2025-01-01", amount: 0.1 },
        { date: "2026-01-01", amount: 0.2 },
      ],
      splits: [{ date: "2026-01-03", numerator: 2, denominator: 1 }],
    });
    const href = calls[0]!.url.href;
    expect(href).toContain("interval=1mo&events=div%2Csplits");
    expect(calls[0]!.url.searchParams.get("range")).toBe("5y");
  });

  it("caches a 404 as a miss", async () => {
    const calls = routeFetch(() => new Response("Not Found", { status: 404 }));
    const yahoo = new YahooFinanceService();
    expect(await yahoo.getCorporateEvents("ZQEV404")).toBeNull();
    const after = calls.length;
    expect(await yahoo.getCorporateEvents("ZQEV404")).toBeNull();
    expect(calls.length).toBe(after);
  });
});

describe("YahooFinanceService quoteSummary session", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(resetYahoo);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetYahoo();
  });

  /** Session router; `summary` answers the quoteSummary request. */
  function sessionRouter(summary: (url: URL, n: number) => Response) {
    let summaryCalls = 0;
    return routeFetch((url) => {
      if (url.host === "fc.yahoo.com") return new Response("", { status: 200, headers: { "Set-Cookie": "A3=abc; Path=/" } });
      if (url.pathname === "/v1/test/getcrumb") return new Response("crumb123", { status: 200 });
      if (url.pathname.startsWith("/v10/finance/quoteSummary/")) return summary(url, ++summaryCalls);
      return new Response("", { status: 404 });
    });
  }

  it("opens a session, dedupes and sorts modules, and caches the answer", async () => {
    const calls = sessionRouter(() => Response.json({ quoteSummary: { result: [{ price: { longName: "X" } }] } }));
    const yahoo = new YahooFinanceService();
    expect(await yahoo.getQuoteSummary("zqsum", ["price", "quoteType", "price"])).toEqual({ price: { longName: "X" } } as never);
    const summary = calls.find((c) => c.url.pathname === "/v10/finance/quoteSummary/ZQSUM");
    expect(summary).toBeDefined();
    expect(summary!.url.href).toContain("modules=price%2CquoteType");
    expect(summary!.url.searchParams.get("formatted")).toBe("false");
    expect(summary!.url.searchParams.get("crumb")).toBe("crumb123");
    expect(summary!.headers.cookie).toBe("A3=abc");
    expect(marketCache.get("yahoo:summary:ZQSUM:price,quoteType")).not.toBeNull();

    const before = calls.length;
    await yahoo.getQuoteSummary("ZQSUM", ["price", "quoteType"]);
    expect(calls.length).toBe(before);
  });

  it("opens a new session once after a 401", async () => {
    const calls = sessionRouter((_url, n) => (n === 1 ? new Response("", { status: 401 }) : Response.json({ quoteSummary: { result: [{ price: { longName: "Y" } }] } })));
    const res = await new YahooFinanceService().getQuoteSummary("ZQSUM401", ["price"]);
    expect(res).toEqual({ price: { longName: "Y" } } as never);
    expect(calls.filter((c) => c.url.pathname.startsWith("/v10/finance/quoteSummary/")).length).toBe(2);
    expect(calls.filter((c) => c.url.host === "fc.yahoo.com").length).toBe(2);
  });

  it("caches a 404 as a miss", async () => {
    const calls = sessionRouter(() => new Response("", { status: 404 }));
    const yahoo = new YahooFinanceService();
    expect(await yahoo.getQuoteSummary("ZQSUM404", ["price"])).toBeNull();
    const before = calls.length;
    expect(await yahoo.getQuoteSummary("ZQSUM404", ["price"])).toBeNull();
    expect(calls.length).toBe(before);
  });
});
