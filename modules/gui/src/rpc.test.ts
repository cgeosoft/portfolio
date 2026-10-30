/** RPC shim: readiness check, client log buffer and the request mapping onto the HTTP client. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { rpc, clientLogger, ensureRpcReady } from "./rpc";

const realFetch = globalThis.fetch;
const realLog = console.log;
const calls: { url: string; init: RequestInit }[] = [];
const logs: unknown[][] = [];
let up = false;
const tick = () => new Promise((r) => setTimeout(r, 10));
const bodies = () => calls.map((c) => JSON.parse(String(c.init.body)));

beforeAll(() => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (!up) throw new Error("down");
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }) as any;
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
});

afterAll(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

describe("ensureRpcReady", () => {
  it("resolves false after one retry pause while the service is down", async () => {
    calls.length = 0;
    const started = performance.now();
    expect(await ensureRpcReady(50)).toBe(false);
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/health");
  });

  it("shares one health check between concurrent callers", async () => {
    calls.length = 0;
    up = true;
    expect(await Promise.all([ensureRpcReady(1000), ensureRpcReady(1000)])).toEqual([true, true]);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/health");
  });

  it("does not check again after a success", async () => {
    calls.length = 0;
    expect(await ensureRpcReady()).toBe(true);
    expect(calls.length).toBe(0);
  });
});

describe("clientLogger", () => {
  beforeEach(() => {
    calls.length = 0;
    logs.length = 0;
  });

  it("writes debug lines to the console only", async () => {
    up = true;
    clientLogger.log("debug", "s", "dbg");
    await tick();
    expect(calls.length).toBe(0);
    expect(logs.length).toBe(1);
    const first = logs[0][0];
    expect(typeof first).toBe("string");
    expect((first as string).startsWith("%c")).toBe(true);
    expect(first as string).toContain("gui:s");
    expect(first as string).toContain("dbg");
  });

  it("sends info lines to the service", async () => {
    clientLogger.log("info", "step1", "hello");
    await tick();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/app/logs");
    expect(bodies()[0]).toEqual({ level: "info", source: "gui", step: "step1", message: "hello" });
    expect(logs[0][0] as string).toContain("INFO");
    expect(logs[0][0] as string).toContain("gui:step1");
  });

  it("keeps entries in order while the service is down", async () => {
    up = false;
    clientLogger.log("error", "s2", "first");
    clientLogger.log("warning", "s3", "second");
    await tick();
    expect(calls.length).toBe(1);
    expect(bodies()[0].message).toBe("first");
    up = true;
    calls.length = 0;
    await clientLogger.flush();
    expect(bodies().map((b) => b.message)).toEqual(["first", "second"]);
  });

  it("logs a start entry and a failure with the error", async () => {
    const timer = clientLogger.startTimer("load", "starting");
    const ms = timer.fail(new Error("boom"), "load failed", { k: 1 });
    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThanOrEqual(0);
    await tick();
    const b = bodies();
    expect(b[0]).toEqual({ level: "info", source: "gui", step: "load:start", message: "starting" });
    expect(b[1]).toMatchObject({ level: "error", step: "load", message: "load failed: boom", data: { k: 1, error: "boom" } });
    expect(b[1].data).toEqual({ k: 1, error: "boom" });
    expect(typeof b[1].durationMs).toBe("number");
  });

  it("ends a timer without a start entry", async () => {
    clientLogger.startTimer("x").end();
    await tick();
    const b = bodies();
    expect(b.length).toBe(1);
    expect(b[0]).toMatchObject({ level: "info", step: "x", message: "completed" });
    expect(typeof b[0].durationMs).toBe("number");
  });

  it("formats a non-Error failure", async () => {
    clientLogger.startTimer("y").fail("plain string");
    await tick();
    expect(bodies().at(-1).message).toBe("failed: plain string");
  });

  it("caps the buffer at 200 entries", async () => {
    up = false;
    for (let i = 0; i < 205; i++) clientLogger.log("info", "cap", `m${i}`);
    await tick();
    up = true;
    calls.length = 0;
    await clientLogger.flush();
    const messages = bodies().map((b) => b.message);
    expect(messages.length).toBe(200);
    expect(messages[0]).toBe("m5");
    expect(messages.at(-1)).toBe("m204");
  });
});

describe("rpc.request shim", () => {
  beforeEach(() => {
    calls.length = 0;
    up = true;
  });

  it("refuses an unsafe external URL", async () => {
    expect(await rpc.request.openExternalUrl({ url: "javascript:alert(1)" })).toEqual({ success: false });
  });

  it("maps getPortfolioData", async () => {
    await (rpc.request as any).getPortfolioData({ portfolioId: "p", refresh: true });
    expect(calls.at(-1)!.url).toBe("/api/portfolios/p/data?refresh=true");
  });

  it("maps checkForUpdates force to a boolean", async () => {
    await (rpc.request as any).checkForUpdates({ force: 1 });
    expect(calls.at(-1)!.init.body).toBe('{"force":true}');
    await (rpc.request as any).checkForUpdates();
    expect(calls.at(-1)!.init.body).toBe('{"force":false}');
  });

  it("maps deleteReport", async () => {
    await (rpc.request as any).deleteReport({ portfolioId: "p", reportId: "r 1" });
    expect(calls.at(-1)!.url).toBe("/api/portfolios/p/reports/r%201");
    expect(calls.at(-1)!.init.method).toBe("DELETE");
  });

  it("maps installMetric", async () => {
    await (rpc.request as any).installMetric({ url: "u", grantedScopes: ["holdings"] });
    expect(calls.at(-1)!.init.body).toBe('{"url":"u","grantedScopes":["holdings"]}');
  });

  it("reloads the window", async () => {
    const g = globalThis as any;
    const hadWindow = "window" in g;
    const realWindow = g.window;
    let n = 0;
    g.window = { location: { reload: () => n++ } };
    try {
      expect(await (rpc.request as any).reloadApp()).toEqual({ success: true });
      expect(n).toBe(1);
    } finally {
      if (hadWindow) g.window = realWindow;
      else delete g.window;
    }
  });
});
