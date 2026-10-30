/** Exchange rates from Yahoo, Finnhub and FMP, pence handling, and the coordinator's FX fallback. */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { YahooFinanceService } from "../yahoo-finance";
import { FinnhubService } from "../finnhub";
import { FmpService } from "../fmp";
import { MarketDataCoordinator } from "../market-data";
import { getDatabase } from "../../db/database";
import * as marketCache from "../../db/market-cache.repo";
import { loadConfig, saveConfig } from "../../config";

/** An FMP client with a key of its own, so the stored settings stay untouched. */
class KeyedFmp extends FmpService {
  override getApiKey(o?: string): string {
    return o?.trim() || "test-fmp-key";
  }
}

const yInternals = YahooFinanceService as unknown as {
  pausedUntil: number;
  offline: { reset(): void };
  chartCache: Map<string, unknown>;
  fxCache: Map<string, unknown>;
};
const fi = FmpService as unknown as {
  authFailedKey?: string;
  authFailedUntil?: number;
  failures?: Map<string, unknown>;
  offline?: { reset(): void };
  throttle?: { pausedUntil: number };
};
const fh = FinnhubService as unknown as { throttle?: { pausedUntil: number } };

function resetAll(): void {
  yInternals.pausedUntil = 0;
  yInternals.offline.reset();
  yInternals.chartCache.clear();
  yInternals.fxCache.clear();
  fi.authFailedKey = "";
  fi.authFailedUntil = 0;
  fi.failures?.clear();
  fi.offline?.reset();
  if (fi.throttle) fi.throttle.pausedUntil = 0;
  if (fh.throttle) fh.throttle.pausedUntil = 0;
  getDatabase().run(
    "DELETE FROM market_cache WHERE key LIKE 'chart:%' OR key LIKE 'quote:%' OR key LIKE 'fx:%' OR key LIKE 'finnhub:%' OR key LIKE 'fmp:%'",
  );
}

/** A Yahoo chart response for an FX pair priced at `price`. */
function fxChart(price: number): string {
  const t = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: { currency: "GBP", regularMarketPrice: price, previousClose: price },
          timestamp: [t - 86_400, t],
          indicators: { quote: [{ open: [price, price], high: [price, price], low: [price, price], close: [price, price], volume: [0, 0] }] },
        },
      ],
      error: null,
    },
  });
}

function hasCacheRow(key: string): boolean {
  return getDatabase().query("SELECT key FROM market_cache WHERE key = ?").get(key) != null;
}

const originalFetch = globalThis.fetch;
const originalConfig = loadConfig();

beforeEach(resetAll);
afterEach(() => {
  globalThis.fetch = originalFetch;
  saveConfig(originalConfig);
  resetAll();
});

describe("Yahoo FX", () => {
  it("prices pence as a hundredth of the pound pair", async () => {
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(fxChart(0.8), { status: 200 });
    }) as unknown as typeof fetch;
    const rates = await new YahooFinanceService().getExchangeRates("EUR", ["GBp"]);
    expect(rates.get("GBp")).toBeCloseTo(0.0125, 8);
    expect(urls[0]).toContain("/v8/finance/chart/EURGBP%3DX?range=5d&interval=1d");
  });

  it("returns 1 for the base currency in any case without fetching", async () => {
    const fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const rates = await new YahooFinanceService().getExchangeRates("EUR", ["eur", "EUR"]);
    expect(rates.get("eur")).toBe(1);
    expect(rates.get("EUR")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("keeps GBP at 1 for a GBP base without fetching", async () => {
    const fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const rates = await new YahooFinanceService().getExchangeRates("GBP", ["gbp", "GBP"]);
    expect(rates.get("gbp")).toBe(1);
    expect(rates.get("GBP")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  // Suspected bug: yahoo-finance.ts:568 upper-cased GBp matches the GBP base before the pence branch, so pence get 1.
  it.failing("prices GBp at 0.01 for a GBP base (B2)", async () => {
    const fetchMock = mock(async () => new Response("", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const rates = await new YahooFinanceService().getExchangeRates("GBP", ["GBp", "gbp", "GBP"]);
    expect(rates.get("GBp")).toBe(0.01);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("leaves out a pair it cannot price and serves an expired copy", async () => {
    globalThis.fetch = mock(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const yahoo = new YahooFinanceService();
    const rates = await yahoo.getExchangeRates("EUR", ["SEK"]);
    expect(rates.size).toBe(0);
    expect(hasCacheRow("fx:EUR:SEK")).toBe(false);

    marketCache.set("fx:EUR:CHF", 0.95, -1000);
    const stale = await yahoo.getExchangeRates("EUR", ["CHF"]);
    expect(stale.get("CHF")).toBe(0.95);
  });
});

describe("Finnhub FX", () => {
  function stubForex() {
    const calls: { url: URL; headers: Record<string, string> }[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.pathname.endsWith("/forex/rates")) {
        return Response.json({ base: u.searchParams.get("base"), quote: { USD: 1.25, GBP: 0.8 } });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;
    return calls;
  }

  it("inverts the quote and leaves unknown currencies out", async () => {
    saveConfig({ ...originalConfig, finnhubApiKey: "test-finnhub-key" });
    const calls = stubForex();
    const rates = await new FinnhubService().getExchangeRates("EUR", ["USD", "EUR", "JPY"]);
    expect(rates.get("USD")).toBeCloseTo(0.8, 8);
    expect(rates.get("EUR")).toBe(1);
    expect(rates.has("JPY")).toBe(false);
    expect(calls[0]?.url.searchParams.get("base")).toBe("EUR");
    expect(calls[0]?.headers["X-Finnhub-Token"]).toBe("test-finnhub-key");
  });

  it("prices GBp as a hundredth of GBP (B3)", async () => {
    saveConfig({ ...originalConfig, finnhubApiKey: "test-finnhub-key" });
    stubForex();
    const svc = new FinnhubService();
    const eur = await svc.getExchangeRates("EUR", ["GBp"]);
    expect(eur.get("GBp")).toBeCloseTo(0.0125, 8);
    const gbp = await svc.getExchangeRates("GBP", ["GBp"]);
    expect(gbp.get("GBp")).toBeCloseTo(0.01, 8);
  });

  it("returns only the base currency when not configured", async () => {
    saveConfig({ ...originalConfig, finnhubApiKey: "" });
    const fetchMock = mock(async () => Response.json({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const rates = await new FinnhubService().getExchangeRates("EUR", ["USD", "EUR"]);
    expect([...rates.entries()]).toEqual([["EUR", 1]]);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("FMP FX", () => {
  function stubForex() {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      const u = new URL(String(url));
      if (u.pathname.endsWith("/batch-forex-quotes")) {
        return Response.json([
          { symbol: "EURUSD", price: 1.25 },
          { symbol: "EURGBP", price: 0.8 },
          { symbol: "USDJPY", price: 150 },
          { symbol: "USDCHF", price: 0.9 },
        ]);
      }
      return Response.json([]);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return { calls, fetchMock };
  }

  it("derives direct, inverse, pence and cross rates", async () => {
    const { calls } = stubForex();
    const rates = await new KeyedFmp("http://fmp.test").getExchangeRates("EUR", ["USD", "GBp", "eur", "JPY", "XXX"]);
    expect(rates.get("eur")).toBe(1);
    expect(rates.get("USD")).toBeCloseTo(0.8, 8);
    expect(rates.get("GBp")).toBeCloseTo(0.0125, 8);
    expect(rates.get("JPY")).toBeCloseTo(0.0053333, 6);
    expect(rates.has("XXX")).toBe(false);
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/batch-forex-quotes");
    expect(u.searchParams.get("short")).toBe("true");
    expect(calls[0]!.url).not.toContain("test-fmp-key");
    expect(calls[0]!.headers.apikey).toBe("test-fmp-key");
  });

  it("crosses through USD for another base and keeps pence local for GBP", async () => {
    const { fetchMock } = stubForex();
    const fmp = new KeyedFmp("http://fmp.test");
    const chf = await fmp.getExchangeRates("CHF", ["JPY"]);
    expect(chf.get("JPY")).toBeCloseTo(0.006, 8);

    resetAll();
    fetchMock.mockClear();
    const gbp = await fmp.getExchangeRates("GBP", ["GBp"]);
    expect(gbp.get("GBp")).toBeCloseTo(0.01, 8);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("caches the forex list until forced", async () => {
    const { fetchMock } = stubForex();
    const fmp = new KeyedFmp("http://fmp.test");
    await fmp.getExchangeRates("EUR", ["USD"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fmp.getExchangeRates("EUR", ["USD"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fmp.getExchangeRates("EUR", ["USD"], true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("coordinator FX fallback", () => {
  it("fills missing and invalid rates from the next provider", async () => {
    const fmpStub = {
      isConfigured: () => true,
      getExchangeRates: mock(async () => new Map([["USD", 0.8]])),
    };
    const yahooStub = {
      isConfigured: () => true,
      getExchangeRates: mock(async () => new Map([["GBp", NaN], ["CHF", 0]])),
    };
    const finnhubStub = {
      isConfigured: () => true,
      getExchangeRates: mock(async () => new Map([["GBp", 0.0125], ["CHF", 1.05]])),
    };
    const coordinator = new MarketDataCoordinator(yahooStub as any, finnhubStub as any, fmpStub as any);
    const res = (await coordinator.getExchangeRatesWithSource("EUR", ["USD", "GBp", " CHF ", ""])) as any;

    const entries = (v: unknown): [string, unknown][] => (v instanceof Map ? [...v.entries()] : Object.entries(v as object));
    const data = Object.fromEntries(entries(res.data));
    expect(Object.keys(data).sort()).toEqual(["CHF", "GBp", "USD"]);
    expect(data.USD).toBe(0.8);
    expect(data.GBp).toBe(0.0125);
    expect(data.CHF).toBe(1.05);
    expect(Object.fromEntries(entries(res.sources))).toEqual({ USD: "fmp", GBp: "finnhub", CHF: "finnhub" });
    expect(res.missing).toEqual([]);

    expect(yahooStub.getExchangeRates.mock.calls.length).toBe(1);
    expect((yahooStub.getExchangeRates.mock.calls[0] as unknown[])[1]).toEqual(["GBp", "CHF"]);
    expect(finnhubStub.getExchangeRates.mock.calls.length).toBe(1);
    expect((finnhubStub.getExchangeRates.mock.calls[0] as unknown[])[1]).toEqual(["GBp", "CHF"]);
  });
});
