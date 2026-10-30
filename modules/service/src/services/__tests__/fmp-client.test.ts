/** FmpService beyond getEodChart: request building, caching, error classification, quotes, charts, search and news. */
import { describe, it, expect, beforeEach, afterEach, mock, setSystemTime } from "bun:test";
import { FmpService, redactFmpSecrets } from "../fmp";
import * as marketCache from "../../db/market-cache.repo";
import { loadConfig, saveConfig } from "../../config";

/** An FMP client with a key of its own, so the stored settings stay untouched. */
class KeyedFmp extends FmpService {
  override getApiKey(o?: string): string {
    return o?.trim() || "test-fmp-key";
  }
}

const fi = FmpService as unknown as {
  authFailedKey: string;
  authFailedUntil: number;
  failures: Map<string, unknown>;
  inFlight: Map<string, unknown>;
  offline: { reset(): void };
  throttle: { pausedUntil: number };
};

function resetFmp(): void {
  fi.authFailedKey = "";
  fi.authFailedUntil = 0;
  fi.failures.clear();
  fi.inFlight.clear();
  fi.offline.reset();
  fi.throttle.pausedUntil = 0;
  marketCache.deleteByPrefix("fmp:");
}

type Call = { url: URL; headers: Record<string, string> };
const originalFetch = globalThis.fetch;

/** Replaces fetch with a router and records every request. */
function stubFetch(route: (url: URL) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return route(url);
  }) as unknown as typeof fetch;
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(resetFmp);
afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
  resetFmp();
});

describe("get() request building and caching", () => {
  it("sorts the query, drops empty values and the apikey param, and sends the key in a header", async () => {
    const calls = stubFetch(() => Response.json([{ ok: 1 }]));
    const fmp = new KeyedFmp("http://fmp.test");
    const res = await fmp.get("/zq7-q", { b: 2, a: "x", c: undefined, d: null, e: "", apikey: "leak" } as never, 60000);
    expect(res).toEqual([{ ok: 1 }]);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url.href).toBe("http://fmp.test/zq7-q?a=x&b=2");
    expect(calls[0]!.headers).toEqual({ accept: "application/json", apikey: "test-fmp-key" });
    expect(calls[0]!.url.href).not.toContain("test-fmp-key");
    expect(calls[0]!.url.href).not.toContain("leak");
  });

  it("caches under the sorted URL, refetches when forced and never caches with ttl 0", async () => {
    const calls = stubFetch(() => Response.json([{ ok: 1 }]));
    const fmp = new KeyedFmp("http://fmp.test");
    await fmp.get("/zq7-q", { b: 2, a: "x" }, 60000);
    expect(marketCache.get("fmp:/zq7-q?a=x&b=2")?.data).toEqual([{ ok: 1 }]);
    await fmp.get("/zq7-q", { b: 2, a: "x" }, 60000);
    expect(calls.length).toBe(1);
    await fmp.get("/zq7-q", { b: 2, a: "x" }, { ttlMs: 60000, forceFresh: true });
    expect(calls.length).toBe(2);

    await fmp.get("/zq7-nocache", {}, 0);
    await fmp.get("/zq7-nocache", {}, 0);
    expect(calls.length).toBe(4);
  });

  it("shares one fetch between two concurrent identical calls", async () => {
    let release!: (r: Response) => void;
    const calls = stubFetch(() => new Promise<Response>((r) => (release = r)));
    const fmp = new KeyedFmp("http://fmp.test");
    const a = fmp.get("/zq7-shared", { symbol: "S" }, 60000);
    const b = fmp.get("/zq7-shared", { symbol: "S" }, 60000);
    await flush();
    release(Response.json([{ v: 1 }]));
    expect(await a).toEqual([{ v: 1 }]);
    expect(await b).toEqual([{ v: 1 }]);
    expect(calls.length).toBe(1);
  });

  it("returns null without a key and asks nothing", async () => {
    const original = loadConfig();
    saveConfig({ ...original, fmpApiKey: "" });
    try {
      const calls = stubFetch(() => Response.json([{ ok: 1 }]));
      const fmp = new FmpService("http://fmp.test");
      expect(await fmp.get("/zq7-nokey", {}, 60000)).toBeNull();
      expect(calls.length).toBe(0);
      expect(await fmp.requestStatus("/zq7-nokey", {})).toBe("no_key");
    } finally {
      saveConfig(original);
    }
  });
});

describe("get() error classification", () => {
  it("marks the whole path as not in plan on HTTP 402", async () => {
    const calls = stubFetch(() => new Response("Premium endpoint", { status: 402 }));
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.get("/zq7-prem", { symbol: "A" }, 60000)).toBeNull();
    expect(await fmp.requestStatus("/zq7-prem", { symbol: "OTHER" })).toBe("restricted");
    expect(await fmp.get("/zq7-prem", { symbol: "OTHER" }, 60000)).toBeNull();
    expect(calls.length).toBe(1);
  });

  it("marks only the request on HTTP 403 for a symbol outside the plan", async () => {
    stubFetch(() => new Response("Invalid parameter symbol not available under your plan", { status: 403 }));
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.get("/zq7-sym", { symbol: "A" }, 60000)).toBeNull();
    expect(await fmp.requestStatus("/zq7-sym", { symbol: "A" })).toBe("restricted");
    expect(await fmp.requestStatus("/zq7-sym", { symbol: "B" })).toBe("ok");
  });

  it("stops using a rejected key on HTTP 401 but still tries another key", async () => {
    const calls = stubFetch(() => new Response("Unauthorized", { status: 401 }));
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.get("/zq7-auth", { symbol: "A" }, 60000)).toBeNull();
    expect(await fmp.requestStatus("/zq7-auth", { symbol: "A" })).toBe("key_rejected");
    expect(await fmp.get("/zq7-auth", { symbol: "B" }, 60000)).toBeNull();
    expect(calls.length).toBe(1);
    await fmp.get("/zq7-auth", { symbol: "C" }, { ttlMs: 0, apiKey: "other" });
    expect(calls.length).toBe(2);
  });

  it("serves the expired copy on HTTP 500 unless staleOnError is off", async () => {
    marketCache.set("fmp:/zq7-stale?symbol=S", [{ old: true }], -1000);
    stubFetch(() => new Response("boom", { status: 500 }));
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.get<unknown>("/zq7-stale", { symbol: "S" }, 60000)).toEqual([{ old: true }]);
    expect(await fmp.get("/zq7-stale", { symbol: "S" }, { ttlMs: 60000, forceFresh: true, staleOnError: false })).toBeNull();
    expect(await fmp.requestStatus("/zq7-stale", { symbol: "S" })).toBe("failed");
  });

  it("returns null on a non-JSON body and flags an invalid key message", async () => {
    stubFetch((url) =>
      url.pathname === "/zq7-text" ? new Response("<html>oops</html>", { status: 200 }) : Response.json({ "Error Message": "Invalid API KEY" }),
    );
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.get("/zq7-text", {}, 60000)).toBeNull();
    expect(await fmp.get("/zq7-badkey", { symbol: "A" }, 60000)).toBeNull();
    expect(await fmp.requestStatus("/zq7-badkey", { symbol: "A" })).toBe("key_rejected");
  });

  // Suspected bug: fmp.ts:564 the daily "Limit Reach" text contains "upgrade your plan" and marks the endpoint restricted.
  it.failing("treats the daily limit message as a rate limit, not as a plan restriction", async () => {
    const calls = stubFetch(() =>
      Response.json({
        "Error Message": "Limit Reach . Please upgrade your plan or visit our documentation for more details at https://site.financialmodelingprep.com/",
      }),
    );
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.get("/zq7-limit", { symbol: "A" }, 60000)).toBeNull();
    expect(await fmp.requestStatus("/zq7-limit", { symbol: "B" })).toBe("ok");
    fi.throttle.pausedUntil = 0;
    await fmp.get("/zq7-limit", { symbol: "B" }, 60000);
    expect(calls.length).toBe(2);
  });

  it("stops asking after three network failures", async () => {
    const calls = stubFetch(() => {
      throw new TypeError("Unable to connect");
    });
    const fmp = new KeyedFmp("http://fmp.test");
    for (let i = 1; i <= 3; i++) expect(await fmp.get(`/zq7-net${i}`, {}, 0)).toBeNull();
    expect(calls.length).toBe(3);
    expect(await fmp.get("/zq7-net4", {}, 0)).toBeNull();
    expect(calls.length).toBe(3);
  });
});

describe("quotes", () => {
  function quoteRouter(): Call[] {
    return stubFetch((url) => {
      if (url.pathname === "/batch-quote") {
        return Response.json([
          { symbol: "AAPL", price: 200, previousClose: 190, name: "Apple", yearHigh: 250, timestamp: 1700000000 },
          { symbol: "BTCUSD", price: 60000, previousClose: 61000, change: -1000, changePercentage: -1.639 },
          { symbol: "EURUSD", price: 1.1 },
          { symbol: "BAD", price: 0 },
        ]);
      }
      if (url.pathname === "/profile") return Response.json([{ symbol: "AAPL", currency: "USD" }]);
      return Response.json([]);
    });
  }

  it("maps FMP quotes back to app symbols and drops missing or zero prices", async () => {
    quoteRouter();
    const quotes = await new KeyedFmp("http://fmp.test").getQuotes(["aapl", "BTC-USD", "EURUSD=X", "NOPE", "BAD"]);
    expect([...quotes.keys()].sort()).toEqual(["AAPL", "BTC-USD", "EURUSD=X"]);
    expect(quotes.get("AAPL")).toMatchObject({
      symbol: "AAPL",
      shortName: "Apple",
      longName: "Apple",
      regularMarketPrice: 200,
      regularMarketChange: 10,
      regularMarketChangePercent: 5.26,
      fiftyTwoWeekHigh: 250,
      currency: "USD",
      previousClose: 190,
      updatedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(quotes.get("BTC-USD")).toMatchObject({ regularMarketChange: -1000, regularMarketChangePercent: -1.64, currency: "USD" });
    expect(quotes.get("EURUSD=X")).toMatchObject({ currency: "USD", previousClose: 1.1, regularMarketChange: 0 });
  });

  it("asks one batch, a profile only for the stock, and caches per symbol", async () => {
    const calls = quoteRouter();
    const fmp = new KeyedFmp("http://fmp.test");
    await fmp.getQuotes(["aapl", "BTC-USD", "EURUSD=X", "NOPE", "BAD"]);
    const batches = calls.filter((c) => c.url.pathname === "/batch-quote");
    expect(batches.length).toBe(1);
    expect(batches[0]!.url.searchParams.get("symbols")).toBe("AAPL,BTCUSD,EURUSD,NOPE,BAD");
    const profiles = calls.filter((c) => c.url.pathname === "/profile");
    expect(profiles.length).toBeGreaterThan(0);
    for (const p of profiles) expect(p.url.searchParams.get("symbol")).toBe("AAPL");

    const before = calls.length;
    const again = await fmp.getQuotes(["AAPL", "BTC-USD", "EURUSD=X"]);
    expect(again.get("AAPL")?.regularMarketPrice).toBe(200);
    expect(calls.length).toBe(before);
  });

  it("splits a large batch into chunks of 50", async () => {
    const calls = stubFetch(() => Response.json([]));
    const symbols = Array.from({ length: 120 }, (_, i) => `ZQB${i}`);
    await new KeyedFmp("http://fmp.test").getBatchQuotes(symbols);
    const sizes = calls.filter((c) => c.url.pathname === "/batch-quote").map((c) => c.url.searchParams.get("symbols")!.split(",").length);
    expect(sizes).toEqual([50, 50, 20]);
  });
});

describe("daily chart with the live quote", () => {
  function chartRouter(previousClose: number): Call[] {
    return stubFetch((url) => {
      if (url.pathname === "/historical-price-eod/full") {
        return Response.json([
          { date: "2026-03-13", open: 10, high: 11.5, low: 9.5, close: 11, volume: 5 },
          { date: "2026-03-12", close: 10 },
        ]);
      }
      if (url.pathname === "/profile") return Response.json([{ symbol: url.searchParams.get("symbol"), currency: "EUR" }]);
      if (url.pathname === "/batch-quote") {
        const symbol = url.searchParams.get("symbols");
        return Response.json([
          { symbol, price: 12, previousClose, dayHigh: 12.5, dayLow: 11.2, open: 11.1, volume: 7, timestamp: Date.parse("2026-03-16T14:00:00Z") / 1000, name: "Live One" },
        ]);
      }
      return Response.json([]);
    });
  }

  const ohlcv = (c: { date: string; open: number; high: number; low: number; close: number; volume: number }) => ({
    date: c.date,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  });

  it("adds a session candle from the quote when the last close is the previous close", async () => {
    setSystemTime(new Date("2026-03-16T15:00:00Z"));
    const calls = chartRouter(11);
    const chart = await new KeyedFmp("http://fmp.test").getChart("zqlive", "5d", "1d");
    const eod = calls.find((c) => c.url.pathname === "/historical-price-eod/full");
    expect(eod?.url.searchParams.get("from")).toBe("2026-03-01");
    expect(chart).toMatchObject({
      symbol: "ZQLIVE",
      currency: "EUR",
      regularMarketPrice: 12,
      previousClose: 11,
      shortName: "Live One",
      longName: "Live One",
    });
    expect(chart!.candles.map(ohlcv)).toEqual([
      { date: "2026-03-12", open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { date: "2026-03-13", open: 10, high: 11.5, low: 9.5, close: 11, volume: 5 },
      { date: "2026-03-16", open: 11.1, high: 12.5, low: 11.2, close: 12, volume: 7 },
    ]);
  });

  it("updates the last candle in place when the previous close differs", async () => {
    setSystemTime(new Date("2026-03-16T15:00:00Z"));
    chartRouter(10);
    const chart = await new KeyedFmp("http://fmp.test").getChart("zqlive2", "5d", "1d");
    expect(chart!.candles.length).toBe(2);
    expect(chart!.candles[1]).toMatchObject({ close: 12, high: 12, low: 9.5 });
  });

  it("returns null for weekly bars, unknown ranges and without a key", async () => {
    chartRouter(11);
    const fmp = new KeyedFmp("http://fmp.test");
    expect(await fmp.getChart("ZQLIVE3", "1y", "1wk")).toBeNull();
    expect(await fmp.getChart("ZQLIVE3", "2w", "1d")).toBeNull();

    const original = loadConfig();
    saveConfig({ ...original, fmpApiKey: "" });
    try {
      expect(await new FmpService("http://fmp.test").getChart("ZQLIVE3", "5d", "1d")).toBeNull();
    } finally {
      saveConfig(original);
    }
  });
});

describe("search, news, redaction", () => {
  it("searches ISINs and CUSIPs and skips plain tickers", async () => {
    const calls = stubFetch((url) => {
      if (url.pathname === "/search-isin") {
        return Response.json([
          { symbol: "AAPL", name: "Apple" },
          { symbol: "AAPL", name: "dup" },
          { symbol: "APC.DE", name: "Apple" },
        ]);
      }
      if (url.pathname === "/search-cusip") return Response.json([{ symbol: "AAPL", companyName: "Apple Inc.", cusip: "037833100" }]);
      return Response.json([]);
    });
    const fmp = new KeyedFmp("http://fmp.test");
    const isin = await fmp.searchIdentifier("US0378331005");
    expect(calls[0]!.url.pathname).toBe("/search-isin");
    expect(calls[0]!.url.searchParams.get("isin")).toBe("US0378331005");
    expect(isin.length).toBe(2);
    expect(isin[0]).toMatchObject({ symbol: "AAPL", name: "Apple", exchange: "FMP", quoteType: "EQUITY", typeDisp: "Equity" });
    expect(isin[1]).toMatchObject({ symbol: "APC.DE", name: "Apple", exchange: "FMP", quoteType: "EQUITY", typeDisp: "Equity" });

    const cusip = await fmp.searchIdentifier("037833100");
    expect(calls[1]!.url.pathname).toBe("/search-cusip");
    expect(cusip[0]).toMatchObject({ symbol: "AAPL", name: "Apple Inc." });

    expect(await fmp.searchIdentifier("AAPL")).toEqual([]);
    expect(calls.length).toBe(2);
  });

  it("merges symbol and name search, dedupes, limits and maps the asset type", async () => {
    stubFetch((url) => {
      if (url.pathname === "/search-symbol") return Response.json([{ symbol: "APP", name: "AppLovin", exchange: "NASDAQ", currency: "USD" }]);
      if (url.pathname === "/search-name") {
        return Response.json([
          { symbol: "APP", name: "AppLovin", exchange: "NASDAQ", currency: "USD" },
          { symbol: "APPCUSD", name: "App Coin", exchange: "CRYPTO", currency: "USD" },
          { symbol: "APPUSD", name: "App FX", exchange: "FOREX", currency: "USD" },
          { symbol: "^APPX", name: "App Index", exchange: "INDEX", currency: "USD" },
        ]);
      }
      return Response.json([]);
    });
    const res = await new KeyedFmp("http://fmp.test").searchSymbols("app", 3);
    expect(res.length).toBe(3);
    expect(res[0]!.symbol).toBe("APP");
    expect(new Set(res.map((r) => r.symbol)).size).toBe(3);
    expect(res.find((r) => r.name === "App Coin")).toMatchObject({ quoteType: "CRYPTOCURRENCY", typeDisp: "Cryptocurrency" });
    expect(res.find((r) => r.name === "App FX")).toMatchObject({ quoteType: "CURRENCY" });

    marketCache.deleteByPrefix("fmp:");
    const all = await new KeyedFmp("http://fmp.test").searchSymbols("app", 10);
    expect(all.find((r) => r.name === "App Index")).toMatchObject({ quoteType: "INDEX" });
  });

  it("maps news newest first and drops untitled items", () => {
    const items = FmpService.toNewsItems([
      { title: " B ", publishedDate: "2026-03-02 10:00:00", publisher: "P" },
      { title: "", publishedDate: "2026-03-03 10:00:00" },
      { title: "A", publishedDate: "2026-03-01 09:00:00", site: "S", text: "body", url: "u" },
    ] as never);
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ headline: "B", summary: "B", source: "P", datetime: 1772445600 });
    expect(items[1]).toMatchObject({ headline: "A", summary: "body", source: "S", datetime: 1772355600, url: "u" });
  });

  it("redacts the key from text and leaves very short keys alone", () => {
    expect(redactFmpSecrets("https://x?apikey=SECRET&a=1 and SECRET", "SECRET")).toBe("https://x?apikey=***&a=1 and ***");
    expect(redactFmpSecrets("k=abc", "abc")).toBe("k=abc");
  });
});
