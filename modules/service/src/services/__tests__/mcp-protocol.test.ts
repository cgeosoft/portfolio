/**
 * MCP server protocol edges: JSON-RPC envelope handling, tool errors as tool results, privacy withholding,
 * HTTP transport checks (host, token, origin, version, size, batches) and the MCP switch in mcp-access.
 */
import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import * as portfolioRepo from "../../db/portfolio.repo";
import { authService, sessionCookieName } from "../auth";
import { getDatabase } from "../../db/database";
import { HttpError, Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { loadConfig, saveConfig, updateConfig } from "../../config";
import { appLogger } from "../../logger";
import { MCP_PATH, createMcpToken, hasMcpToken, isValidMcpToken, mcpAccessInfo, rotateMcpToken, setMcpAccess, startMcpAccess, stopMcpAccess } from "../mcp-access";
import { MCP_PROTOCOL_VERSIONS, bearerToken, handleMcpHttp, handleMcpMessage, mcpOriginAllowed } from "../mcp-server";
import { MCP_TOOLS, type McpToolDeps } from "../mcp-tools";
import type { AppServices } from "../container";

type Rpc = { jsonrpc: "2.0"; id: string | number | null; result?: any; error?: { code: number; message: string } };

const NO_DEPS = {} as McpToolDeps;
const ok = (t: string | null) => t === "good";

function upcomingDeps(events: unknown[] = []): McpToolDeps {
  return {
    portfolioService: { getPortfolioData: async () => { throw new Error("not used"); } },
    exposure: {},
    income: {
      getUpcomingEvents: async (id: string, days: number) => ({ portfolioId: id, baseCurrency: "EUR", days, from: "2026-10-30", to: "2026-11-29", sources: [], events }),
    },
    yahoo: {},
    finnhub: {},
    fmp: {},
  } as unknown as McpToolDeps;
}

async function rpc(deps: McpToolDeps, msg: unknown): Promise<Rpc | null> {
  return (await handleMcpMessage(deps, msg)) as Rpc | null;
}

async function tool(deps: McpToolDeps, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await rpc(deps, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return res?.result;
}

function post(body: unknown, headers: Record<string, string> = {}, method = "POST"): Request {
  const init: RequestInit = {
    method,
    headers: { host: "127.0.0.1:5131", authorization: "Bearer good", "content-type": "application/json", ...headers },
  };
  if (method !== "GET" && method !== "HEAD" && body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://127.0.0.1:5131/mcp", init);
}

const PING = { jsonrpc: "2.0", id: 1, method: "ping" };

let pid = "";
beforeAll(() => {
  authService.acceptTerms();
  pid = portfolioRepo.create({ name: "MCP protocol", description: "Notes 4242.42", baseCurrency: "EUR" }).id;
});
afterAll(() => {
  if (portfolioRepo.findById(pid)) portfolioRepo.deleteById(pid);
});

describe("handleMcpMessage envelope", () => {
  it("answers non-object messages with Invalid request and a null id", async () => {
    for (const msg of [null, [], "x", 42]) {
      expect(await rpc(NO_DEPS, msg)).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
    }
  });

  it("refuses a wrong jsonrpc version or a missing method, keeping the id", async () => {
    expect(await rpc(NO_DEPS, { jsonrpc: "1.0", id: 1, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid request" } });
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1 })).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid request" } });
  });

  it("ignores client responses", async () => {
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", id: 5, result: {} })).toBeNull();
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", id: 5, error: { code: 1, message: "x" } })).toBeNull();
  });

  it("answers nothing to notifications, including a null or object id", async () => {
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", id: null, method: "ping" })).toBeNull();
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", id: {}, method: "ping" })).toBeNull();
  });

  it("answers ping with an empty result", async () => {
    expect(await rpc(NO_DEPS, { jsonrpc: "2.0", id: "a", method: "ping" })).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
  });

  it("negotiates the protocol version and describes the server", async () => {
    expect(MCP_PROTOCOL_VERSIONS).toEqual(["2025-06-18", "2025-03-26", "2024-11-05"]);
    const old = await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    expect(old?.result.protocolVersion).toBe("2024-11-05");
    const unknown = await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(unknown?.result.protocolVersion).toBe("2025-06-18");
    const missing = await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(missing?.result.protocolVersion).toBe("2025-06-18");
    const r = missing!.result;
    expect(r.serverInfo).toEqual({ name: "portfolio", title: "Portfolio", version: expect.any(String) });
    expect(r.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.instructions).toContain("percentage");
    expect(r.instructions).toContain("never shares money amounts");
  });

  it("lists the seven read-only tools with closed schemas", async () => {
    const res = await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = res!.result.tools as { name: string; description: string; annotations: { readOnlyHint: boolean }; inputSchema: { type: string; additionalProperties: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(["list_portfolios", "get_portfolio_summary", "get_holdings", "get_exposure", "get_performance", "get_dividend_yield", "get_upcoming_events"]);
    expect(MCP_TOOLS.length).toBe(7);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.description).toContain("Percentages only");
    }
  });

  it("refuses tools/call without a name or with an unknown tool", async () => {
    expect((await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }))?.error).toEqual({ code: -32602, message: "params.name is required" });
    expect((await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "drop_table" } }))?.error).toEqual({ code: -32602, message: "Unknown tool: drop_table" });
  });

  it("answers an unknown method with -32601", async () => {
    expect((await rpc(NO_DEPS, { jsonrpc: "2.0", id: 1, method: "resources/read" }))?.error).toEqual({ code: -32601, message: "Method not found: resources/read" });
  });
});

describe("MCP tool results", () => {
  it("turns input errors into tool results", async () => {
    const deps = upcomingDeps();
    for (const days of [0, 2.5, 366]) {
      const r = await tool(deps, "get_upcoming_events", { portfolio_id: pid, days });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe("days must be a whole number from 1 to 365");
    }
    expect((await tool(deps, "get_upcoming_events", { portfolio_id: pid, days: "10" })).isError).toBe(false);
    expect((await tool(deps, "get_holdings", { portfolio_id: 42 })).content[0].text).toBe("portfolio_id must be a string");
    expect((await tool(deps, "get_holdings", { portfolio_id: "nope" })).content[0].text).toBe("Portfolio not found");
  });

  it("asks for portfolio_id only when it cannot pick one", async () => {
    const saved = portfolioRepo.findAll();
    for (const p of saved) portfolioRepo.deleteById(p.id);
    try {
      expect((await tool(NO_DEPS, "get_holdings", {})).content[0].text).toBe("There are no portfolios yet.");
      const a = portfolioRepo.create({ name: "MCP a", baseCurrency: "EUR" }).id;
      const b = portfolioRepo.create({ name: "MCP b", baseCurrency: "EUR" }).id;
      expect((await tool(NO_DEPS, "get_holdings", {})).content[0].text).toBe("portfolio_id is required: there is more than one portfolio (see list_portfolios).");
      portfolioRepo.deleteById(a);
      portfolioRepo.deleteById(b);
    } finally {
      pid = portfolioRepo.create({ name: "MCP protocol", description: "Notes 4242.42", baseCurrency: "EUR" }).id;
    }
  });

  it("withholds an answer that holds a non-percentage number and logs where", async () => {
    const deps = upcomingDeps([{ date: "2026-11-07", kind: "exDividend", symbol: "AAPL", name: "Apple", time: 1234, source: null }]);
    const spy = spyOn(appLogger, "logStep");
    try {
      const r = await tool(deps, "get_upcoming_events", { portfolio_id: pid });
      expect(r).toEqual({ content: [{ type: "text", text: "The answer was withheld because it would have included a value that is not a percentage." }], isError: true });
      expect(r).not.toHaveProperty("structuredContent");
      expect(JSON.stringify(r)).not.toContain("1234");
      const hit = spy.mock.calls.find((c) => c[0] === "error" && c[1] === "mcp" && c[2] === "privacy");
      expect(hit?.slice(0, 4)).toEqual(["error", "mcp", "privacy", "Tool get_upcoming_events was stopped: Refused to send a non-percentage number ($.events[0].time)"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("hides provider error text from the client and the log", async () => {
    const deps = {
      portfolioService: { getPortfolioData: async () => { throw new Error("upstream said 987654.32"); } },
      exposure: {}, income: {}, yahoo: {}, finnhub: {}, fmp: {},
    } as unknown as McpToolDeps;
    const spy = spyOn(appLogger, "logStep");
    try {
      const r = await tool(deps, "get_holdings", { portfolio_id: pid });
      expect(r).toEqual({ content: [{ type: "text", text: "The tool get_holdings failed. Try again later." }], isError: true });
      const hit = spy.mock.calls.find((c) => c[1] === "mcp" && c[2] === "tool");
      expect(hit?.slice(0, 4)).toEqual(["warning", "mcp", "tool", "Tool get_holdings failed (Error)"]);
      expect(JSON.stringify(r)).not.toContain("987654.32");
      expect(JSON.stringify(spy.mock.calls)).not.toContain("987654.32");
    } finally {
      spy.mockRestore();
    }
  });

  it("wraps a success with structured content and the same JSON as text, without descriptions", async () => {
    const r = await tool(NO_DEPS, "list_portfolios", {});
    expect(r.isError).toBe(false);
    expect(typeof r.structuredContent).toBe("object");
    expect(r.content[0].text).toBe(JSON.stringify(r.structuredContent, null, 2));
    for (const p of r.structuredContent.portfolios as Record<string, unknown>[]) expect(p).not.toHaveProperty("description");
    expect(r.content[0].text).not.toContain("4242.42");
  });
});

describe("MCP HTTP transport", () => {
  it("reads the bearer token", () => {
    const withAuth = (v?: string) => new Request("http://127.0.0.1:5131/mcp", { headers: v === undefined ? {} : { authorization: v } });
    expect(bearerToken(withAuth("Bearer abc"))).toBe("abc");
    expect(bearerToken(withAuth("bearer abc"))).toBe("abc");
    expect(bearerToken(withAuth("Bearer  abc  "))).toBe("abc");
    expect(bearerToken(withAuth("Bearer a b"))).toBeNull();
    expect(bearerToken(withAuth("Basic abc"))).toBeNull();
    expect(bearerToken(withAuth())).toBeNull();
  });

  it("allows no Origin or an Origin that matches the host exactly", () => {
    const withOrigin = (origin?: string) => new Request("http://127.0.0.1:5131/mcp", { headers: { host: "127.0.0.1:5131", ...(origin ? { origin } : {}) } });
    expect(mcpOriginAllowed(withOrigin())).toBe(true);
    expect(mcpOriginAllowed(withOrigin("http://127.0.0.1:5131"))).toBe(true);
    expect(mcpOriginAllowed(withOrigin("http://localhost:5131"))).toBe(false);
    expect(mcpOriginAllowed(withOrigin("null"))).toBe(false);
    expect(mcpOriginAllowed(withOrigin("https://evil.example"))).toBe(false);
  });

  it("accepts loopback host names and checks the host before the token", async () => {
    expect((await handleMcpHttp(post(PING, { host: "localhost:5131" }), NO_DEPS, ok)).status).toBe(200);
    expect((await handleMcpHttp(post(PING, { host: "[::1]:5131" }), NO_DEPS, ok)).status).toBe(200);
    const foreign = await handleMcpHttp(post(PING, { host: "evil.example:5131", authorization: "" }), NO_DEPS, ok);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "Invalid Host header" });
  });

  it("refuses a host name that only starts with 127.", async () => {
    const res = await handleMcpHttp(post(PING, { host: "127.0.0.1.evil.example:5131" }), NO_DEPS, ok);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid Host header" });
  });

  it("asks for a token with WWW-Authenticate", async () => {
    const res = await handleMcpHttp(post(PING, { authorization: "Bearer bad" }), NO_DEPS, ok);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer realm="portfolio-mcp"');
    expect(await res.json()).toEqual({ error: "A valid access token is required (Settings, Privacy & Security, MCP server)" });
  });

  it("answers other methods with 405 and Allow: POST", async () => {
    const res = await handleMcpHttp(post(undefined, {}, "DELETE"), NO_DEPS, ok);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
    expect(await res.json()).toEqual({ error: "Method DELETE not allowed" });
  });

  it("refuses until the Terms of Use are accepted", async () => {
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:acceptedTermsAt'");
    (authService as unknown as { termsCache: unknown }).termsCache = undefined;
    try {
      const res = await handleMcpHttp(post(PING), NO_DEPS, ok);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Open Portfolio and accept the Terms of Use first" });
    } finally {
      authService.acceptTerms();
    }
  });

  it("checks the MCP-Protocol-Version header", async () => {
    const bad = await handleMcpHttp(post(PING, { "mcp-protocol-version": "2099-01-01" }), NO_DEPS, ok);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unsupported MCP-Protocol-Version: 2099-01-01" } });
    const long = "a".repeat(40);
    const cut = await (await handleMcpHttp(post(PING, { "mcp-protocol-version": long }), NO_DEPS, ok)).json();
    expect(cut.error.message).toBe(`Unsupported MCP-Protocol-Version: ${"a".repeat(32)}`);
    expect((await handleMcpHttp(post(PING, { "mcp-protocol-version": "2025-03-26" }), NO_DEPS, ok)).status).toBe(200);
  });

  it("refuses a body that is too large", async () => {
    const big = await handleMcpHttp(post("x".repeat(300_000)), NO_DEPS, ok);
    expect(big.status).toBe(413);
    expect((await big.json()).error).toEqual({ code: -32600, message: "Request body is too large" });
    const declared = post(PING, { "content-length": "999999" });
    if (declared.headers.get("content-length") === "999999") {
      expect((await handleMcpHttp(declared, NO_DEPS, ok)).status).toBe(413);
    }
  });

  it("answers parse errors and an empty batch with 400", async () => {
    const bad = await handleMcpHttp(post("{bad"), NO_DEPS, ok);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toEqual({ code: -32700, message: "Parse error" });
    const empty = await handleMcpHttp(post([]), NO_DEPS, ok);
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.message).toBe("Empty batch");
  });

  it("answers a batch with one entry per request and 202 for notifications only", async () => {
    const note = { jsonrpc: "2.0", method: "notifications/initialized" };
    const batch = await handleMcpHttp(post([{ jsonrpc: "2.0", id: 1, method: "ping" }, note, { jsonrpc: "2.0", id: 2, method: "ping" }]), NO_DEPS, ok);
    expect(batch.status).toBe(200);
    const answers = (await batch.json()) as Rpc[];
    expect(answers.map((a) => a.id)).toEqual([1, 2]);
    const onlyNotes = await handleMcpHttp(post([note, note]), NO_DEPS, ok);
    expect(onlyNotes.status).toBe(202);
    expect(await onlyNotes.text()).toBe("");
    expect((await handleMcpHttp(post(note), NO_DEPS, ok)).status).toBe(202);
  });

  it("sets the JSON response headers", async () => {
    const res = await handleMcpHttp(post(PING), NO_DEPS, ok);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("MCP access switch extras", () => {
  const original = loadConfig();
  const deps = NO_DEPS;
  const fakeBind = () => ({ stop() {} });

  afterAll(() => {
    stopMcpAccess();
    saveConfig({ ...original });
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'mcp:tokenHash'");
  });

  it("creates a pmcp_ token and stores only its hash", () => {
    const t = createMcpToken();
    expect(t).toMatch(/^pmcp_[A-Za-z0-9_-]{43}$/);
    const row = getDatabase().query("SELECT value FROM kv_entries WHERE key = 'mcp:tokenHash'").get() as { value: string } | null;
    expect(row?.value).toBe(createHash("sha256").update(t).digest("hex"));
    expect(isValidMcpToken(t)).toBe(true);
    expect(isValidMcpToken(t + "x")).toBe(false);
    expect(isValidMcpToken(null)).toBe(false);
    expect(isValidMcpToken("")).toBe(false);
  });

  it("refuses the port used for other devices", () => {
    stopMcpAccess();
    startMcpAccess(fakeBind, deps);
    updateConfig({ allowRemoteConnections: true, remotePort: 5130, mcpEnabled: false });
    const before = hasMcpToken();
    let err: unknown;
    try {
      setMcpAccess({ enabled: true, port: 5130 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as Error).message).toBe("The MCP port must differ from the port for other devices");
    expect(hasMcpToken()).toBe(before);

    updateConfig({ allowRemoteConnections: false });
    expect(setMcpAccess({ enabled: true, port: 5130 }).enabled).toBe(true);
    setMcpAccess({ enabled: false });
    stopMcpAccess();
  });

  it("reports a bind failure as 409 and stays off without a token", () => {
    stopMcpAccess();
    updateConfig({ mcpEnabled: false });
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'mcp:tokenHash'");
    startMcpAccess(() => {
      throw new Error("EADDRINUSE");
    }, deps);
    let err: unknown;
    try {
      setMcpAccess({ enabled: true, port: 5198 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as Error).message).toBe("Could not listen on port 5198: EADDRINUSE");
    expect(hasMcpToken()).toBe(false);
    expect(loadConfig().mcpEnabled).toBe(false);
    stopMcpAccess();
  });

  it("refuses to rotate the token while off", () => {
    updateConfig({ mcpEnabled: false });
    let err: unknown;
    try {
      rotateMcpToken();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as Error).message).toBe("Turn on the MCP server first");
  });

  it("serves only the MCP path on its listener", async () => {
    stopMcpAccess();
    updateConfig({ mcpEnabled: false });
    let captured: ((r: Request) => Promise<Response>) | null = null;
    startMcpAccess((_port: number, fetch: (r: Request) => Promise<Response>) => {
      captured = fetch;
      return { stop() {} };
    }, deps);
    const info = setMcpAccess({ enabled: true, port: 5197 });
    expect(captured).not.toBeNull();
    const handler = captured as unknown as (r: Request) => Promise<Response>;

    const other = await handler(new Request("http://127.0.0.1:5197/other", { headers: { host: "127.0.0.1:5197" } }));
    expect(other.status).toBe(404);
    expect(await other.text()).toBe("Not found");

    const ping = (token: string) =>
      new Request(`http://127.0.0.1:5197${MCP_PATH}/`, {
        method: "POST",
        headers: { host: "127.0.0.1:5197", authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(PING),
      });
    const good = await handler(ping(info.token!));
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect((await handler(ping("wrong"))).status).toBe(401);

    setMcpAccess({ enabled: false });
    stopMcpAccess();
  });

  it("binds once on start when the switch is on", () => {
    stopMcpAccess();
    updateConfig({ mcpEnabled: true, mcpPort: 5196 });
    createMcpToken();
    const ports: number[] = [];
    startMcpAccess((port: number) => {
      ports.push(port);
      return { stop() {} };
    }, deps);
    expect(ports).toEqual([5196]);
    const info = mcpAccessInfo();
    expect(info).toEqual({ enabled: true, port: 5196, url: "http://127.0.0.1:5196/mcp", listening: true, hasToken: true });
    expect(info).not.toHaveProperty("token");
    stopMcpAccess();
    updateConfig({ mcpEnabled: false });
  });

  it("validates the MCP routes and protects mcpEnabled in the config route", async () => {
    stopMcpAccess();
    startMcpAccess(fakeBind, deps);
    updateConfig({ mcpEnabled: false });
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'mcp:tokenHash'");
    const router = new Router();
    registerRoutes(router, {} as AppServices, () => {});
    const cookie = `${sessionCookieName()}=${authService.login()}`;
    const call = (method: string, path: string, body?: unknown) =>
      router.handle(
        new Request("http://127.0.0.1:4000" + path, {
          method,
          headers: { host: "127.0.0.1:4000", cookie, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        "127.0.0.1",
      );

    await call("PATCH", "/api/host/mcp", { enabled: "yes" });
    expect(loadConfig().mcpEnabled).toBe(false);

    const port = (await call("PATCH", "/api/host/mcp", { port: "abc" }))!;
    expect(port.status).toBe(400);
    expect((await port.json()).message).toBe("The port must be a whole number from 1024 to 65535");

    const rotate = (await call("POST", "/api/host/mcp/token"))!;
    expect(rotate.status).toBe(400);
    expect((await rotate.json()).message).toBe("Turn on the MCP server first");

    await call("PATCH", "/api/config", { mcpEnabled: true });
    expect(loadConfig().mcpEnabled).toBe(false);
    stopMcpAccess();
  });
});
