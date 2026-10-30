/** HTTP client: request headers, timeouts, error mapping, the 401 handler and URL building. */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { api, request, ApiError, setUnauthorizedHandler } from "./api";

const realFetch = globalThis.fetch;
const calls: { url: string; init: RequestInit }[] = [];
let respond: () => Response = () => new Response("{}", { status: 200 });

beforeEach(() => {
  calls.length = 0;
  respond = () => new Response("{}", { status: 200 });
  setUnauthorizedHandler(null);
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as any;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  setUnauthorizedHandler(null);
});

async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("request", () => {
  it("sends credentials with every call", async () => {
    await api.getPortfolios();
    const init = calls[0].init;
    expect(init.credentials).toBe("include");
    expect(init.signal).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it("adds a JSON content type to a string body", async () => {
    await (api as any).login();
    const init = calls[0].init;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("keeps an explicit content type", async () => {
    await request("/x", { method: "POST", body: "raw", headers: { "Content-Type": "text/plain" } });
    expect(calls[0].init.headers).toEqual({ "Content-Type": "text/plain" });
  });

  it("sends no content type without a body", async () => {
    await api.acceptTerms();
    const init = calls[0].init;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it("turns timeoutMs into an AbortSignal", async () => {
    await api.health();
    expect(calls[0].init.signal instanceof AbortSignal).toBe(true);
  });

  it("passes a caller signal through", async () => {
    const ac = new AbortController();
    await (api as any).getPortfolios(ac.signal);
    expect(calls[0].init.signal).toBe(ac.signal);
  });

  it("resolves undefined for 204 and an empty body", async () => {
    respond = () => new Response(null, { status: 204 });
    expect(await request("/x")).toBeUndefined();
    respond = () => new Response("", { status: 200 });
    expect(await request("/x")).toBeUndefined();
  });

  it("parses a JSON body", async () => {
    respond = () => new Response("[1,2]");
    expect(await request("/x")).toEqual([1, 2]);
  });

  it("throws ApiError on a non-JSON 200 body", async () => {
    respond = () => new Response("not json", { status: 200 });
    const err = await rejection(request("/x"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(200);
    expect(err.message).toBe("Invalid JSON response from the server");
    expect(err.name).toBe("ApiError");
  });

  it("reads message and requestId from an error body", async () => {
    respond = () => new Response(JSON.stringify({ message: "Bad thing", requestId: "r1" }), { status: 400 });
    const err = await rejection(request("/x"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Bad thing");
    expect(err.requestId).toBe("r1");
  });

  it("reads the error field when there is no message", async () => {
    respond = () => new Response('{"error":"Err field"}', { status: 500 });
    const err = await rejection(request("/x"));
    expect(err.message).toBe("Err field");
    expect(err.requestId).toBeUndefined();
  });

  it("falls back to the status for a non-JSON error body", async () => {
    respond = () => new Response("<html>", { status: 502 });
    const err = await rejection(request("/x"));
    expect(err.message).toBe("HTTP 502");
  });

  it("calls the unauthorized handler once on 401", async () => {
    let n = 0;
    setUnauthorizedHandler(() => n++);
    respond = () => new Response("{}", { status: 401 });
    const err = await rejection(request("/x"));
    expect(err.status).toBe(401);
    expect(err.message).toBe("HTTP 401");
    expect(n).toBe(1);
  });

  it("does not call the handler for calls that own their 401", async () => {
    let n = 0;
    setUnauthorizedHandler(() => n++);
    respond = () => new Response("{}", { status: 401 });
    expect((await rejection(api.authStatus())).status).toBe(401);
    expect((await rejection(api.login("1"))).status).toBe(401);
    expect((await rejection(api.setPin("1" as any))).status).toBe(401);
    expect(n).toBe(0);
  });

  it("rejects a 401 cleanly after the handler is cleared", async () => {
    setUnauthorizedHandler(null);
    respond = () => new Response("{}", { status: 401 });
    const err = await rejection(request("/x"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(TypeError);
  });

  it("does not call the handler on 403", async () => {
    let n = 0;
    setUnauthorizedHandler(() => n++);
    respond = () => new Response("{}", { status: 403 });
    await rejection(request("/x"));
    expect(n).toBe(0);
  });
});

describe("api URL building", () => {
  const last = () => calls.at(-1)!;

  it("encodes the portfolio id and query of getPortfolioData", async () => {
    await (api as any).getPortfolioData("a/b c", "EUR", true);
    expect(last().url).toBe("/api/portfolios/a%2Fb%20c/data?baseCurrency=EUR&refresh=true");
    await (api as any).getPortfolioData("p");
    expect(last().url).toBe("/api/portfolios/p/data");
  });

  it("sends the pin on login", async () => {
    await api.login("1234");
    expect(last().init.body).toBe('{"pin":"1234"}');
  });

  it("builds the macro snapshot query", async () => {
    await (api as any).getMacroSnapshot(undefined, true);
    expect(last().url).toBe("/api/market/macro?refresh=true");
    await (api as any).getMacroSnapshot("US D");
    expect(last().url).toBe("/api/market/macro?baseCurrency=US%20D");
    await (api as any).getMacroSnapshot();
    expect(last().url).toBe("/api/market/macro");
  });

  it("builds the sponsor banner query", async () => {
    await (api as any).getSponsorBanner();
    expect(last().url).toBe("/api/app/sponsor");
    await (api as any).getSponsorBanner("https://x/?a=1&b", "dark");
    expect(last().url).toBe("/api/app/sponsor?url=https%3A%2F%2Fx%2F%3Fa%3D1%26b&theme=dark");
  });

  it("builds the company intel query", async () => {
    await (api as any).getCompanyIntel("BRK.B", ["profile", "news"], "ETF", true);
    expect(last().url).toBe("/api/symbols/BRK.B/intel?include=profile%2Cnews&assetType=ETF&private=1");
    await (api as any).getCompanyIntel("X");
    expect(last().url).toBe("/api/symbols/X/intel");
    await (api as any).getCompanyIntel("X", []);
    expect(last().url).toBe("/api/symbols/X/intel");
  });

  it("builds the benchmark query", async () => {
    await (api as any).getBenchmarkComparison("p", "1y");
    expect(last().url).toBe("/api/portfolios/p/benchmark?range=1y");
    await (api as any).getBenchmarkComparison("p", "1y", "^GSPC");
    expect(last().url).toBe("/api/portfolios/p/benchmark?range=1y&symbol=%5EGSPC");
  });

  it("defaults events to 30 days", async () => {
    await (api as any).getPortfolioEvents("p");
    expect(last().url).toBe("/api/portfolios/p/events?days=30");
    await (api as any).getPortfolioEvents("p", 7);
    expect(last().url).toBe("/api/portfolios/p/events?days=7");
  });

  it("adds refresh to exposure only when asked", async () => {
    await (api as any).getPortfolioExposure("p", true);
    expect(last().url).toBe("/api/portfolios/p/exposure?refresh=true");
    await (api as any).getPortfolioExposure("p");
    expect(last().url).toBe("/api/portfolios/p/exposure");
  });

  it("encodes the symbol search", async () => {
    await (api as any).searchSymbol("a&b=c");
    expect(last().url).toBe("/api/symbols/search?q=a%26b%3Dc");
  });

  it("builds the suggestions query", async () => {
    await (api as any).getSuggestions("p", "EUR");
    expect(last().url).toBe("/api/portfolios/p/suggestions?baseCurrency=EUR");
    await (api as any).getSuggestions("p");
    expect(last().url).toBe("/api/portfolios/p/suggestions");
  });

  it("sets and clears a manual price", async () => {
    await (api as any).setManualPrice("p", "PRIV/1", { price: 1 });
    expect(last().url).toBe("/api/portfolios/p/manual-prices/PRIV%2F1");
    expect(last().init.method).toBe("PUT");
    expect(last().init.body).toBe('{"price":1}');
    await (api as any).clearManualPrice("p", "PRIV/1");
    expect(last().url).toBe("/api/portfolios/p/manual-prices/PRIV%2F1");
    expect(last().init.method).toBe("DELETE");
  });

  it("removes the pin with the current pin", async () => {
    await (api as any).removePin("1234");
    expect(last().url).toBe("/api/auth/pin");
    expect(last().init.method).toBe("DELETE");
    expect(last().init.body).toBe('{"currentPin":"1234"}');
  });

  it("sends force on update checks", async () => {
    await (api as any).checkForUpdates();
    expect(last().init.body).toBe('{"force":false}');
    await (api as any).checkForUpdates(true);
    expect(last().init.body).toBe('{"force":true}');
  });

  it("encodes the report id on delete", async () => {
    await (api as any).deleteReport("p", "r 1");
    expect(last().url).toBe("/api/portfolios/p/reports/r%201");
    expect(last().init.method).toBe("DELETE");
  });

  it("patches a portfolio with the whole argument", async () => {
    const arg = { portfolioId: "a b", name: "x" };
    await (api as any).updatePortfolio(arg);
    expect(last().url).toBe("/api/portfolios/a%20b");
    expect(last().init.method).toBe("PATCH");
    expect(last().init.body).toBe(JSON.stringify(arg));
  });

  it("builds frame and diagnostics URLs without a request", () => {
    expect((api as any).sponsorFrameUrl("light")).toBe("/api/app/sponsor/frame?theme=light");
    expect(api.diagnosticsUrl()).toBe("/api/app/support/diagnostics");
    expect(calls.length).toBe(0);
  });
});
