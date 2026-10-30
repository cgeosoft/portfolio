/**
 * API contract through the real routes with a real PortfolioService on the isolated test database:
 * portfolio and transaction CRUD, validation answers, settings masking and that no secret reaches a
 * response body or a log line.
 */
import { describe, it, expect, beforeAll, afterAll, spyOn, mock } from "bun:test";
import { SECRET_MASK } from "portfolio-shared/config-types";
import { Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { authService, sessionCookieName } from "../auth";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";
import type { AppServices } from "../container";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as txRepo from "../../db/transaction.repo";
import { getDatabase } from "../../db/database";
import { loadConfig, saveConfig } from "../../config";

const BASE = "http://127.0.0.1:4000";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_KEYS = ["baseCurrency", "color", "createdAt", "description", "id", "name", "updatedAt"];

const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

const portfolioService = new PortfolioService(offline);
const router = new Router();
const onQuit = mock(() => {});
registerRoutes(router, { portfolioService } as unknown as AppServices, onQuit);

const original = loadConfig();
const bodies: string[] = [];
const created: string[] = [];
let cookie = "";
let sid = "";
let logSpy: ReturnType<typeof spyOn>;
const logged = () => logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

type CallOptions = { cookie?: string | null; ip?: string; isLocal?: boolean; headers?: Record<string, string> };

async function call(method: string, path: string, body?: unknown, o: CallOptions = {}) {
  const headers: Record<string, string> = { host: new URL(BASE).host, ...(o.headers ?? {}) };
  const c = o.cookie === undefined ? cookie : o.cookie;
  if (c) headers.cookie = c;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await router.handle(new Request(BASE + path, init), o.ip ?? "127.0.0.1", o.isLocal);
  return res;
}

/** Calls a route and returns status plus the parsed JSON body, recording the raw text. */
async function api(method: string, path: string, body?: unknown, o: CallOptions = {}) {
  const res = await call(method, path, body, o);
  expect(res).not.toBeNull();
  const text = await res!.text();
  bodies.push(text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (text ? JSON.parse(text) : null) as any;
  return { status: res!.status, body: data, res: res! };
}

beforeAll(() => {
  getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:pinHash' OR key LIKE 'rate-limit:pin%'");
  authService.acceptTerms();
  sid = authService.login();
  cookie = `${sessionCookieName()}=${sid}`;
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  saveConfig({ ...original });
  for (const id of created) {
    try {
      portfolioRepo.deleteById(id);
    } catch {
      // already gone
    }
  }
  portfolioService.destroy();
  logSpy.mockRestore();
});

describe("HTTP API contract", () => {
  let pid = "";
  const depId = "ct-dep-" + crypto.randomUUID();
  const buyId = "ct-buy-" + crypto.randomUUID();

  it("answers health without a session", async () => {
    const { status, body, res } = await api("GET", "/api/health", undefined, { cookie: null });
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.env).toBe("development");
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("refuses portfolios without a valid session", async () => {
    const missing = await api("GET", "/api/portfolios", undefined, { cookie: null });
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ statusCode: 401, message: "Session cookie is missing", requestId: missing.body.requestId });
    expect(typeof missing.body.requestId).toBe("string");
    const bad = await api("GET", "/api/portfolios", undefined, { cookie: `${sessionCookieName()}=not-a-session` });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe("Invalid or expired session");
  });

  it("lists portfolios with exactly the item keys", async () => {
    const { status, body } = await api("GET", "/api/portfolios");
    expect(status).toBe(200);
    expect(Array.isArray(body.portfolios)).toBe(true);
    for (const item of body.portfolios) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
  });

  it("creates a portfolio with trimmed and normalised fields", async () => {
    const { status, body } = await api("POST", "/api/portfolios", { name: "  Contract  ", description: "  d ", baseCurrency: "usd", color: "#AABBCC" });
    expect(status).toBe(200);
    expect(body.id).toMatch(UUID);
    pid = body.id;
    created.push(pid);
    expect(body).toEqual({ id: pid, name: "Contract", description: "d", baseCurrency: "USD", color: "#aabbcc", createdAt: body.createdAt, updatedAt: body.updatedAt });
    expect(body.createdAt).toMatch(ISO);
    expect(body.createdAt).toBe(body.updatedAt);
    const list = await api("GET", "/api/portfolios");
    expect(list.body.portfolios.some((p: { id: string }) => p.id === pid)).toBe(true);
  });

  it("fills defaults for a portfolio with only a name", async () => {
    const { status, body } = await api("POST", "/api/portfolios", { name: "Defaults" });
    expect(status).toBe(200);
    created.push(body.id);
    expect(body.description).toBeNull();
    expect(body.color).toBeNull();
    expect(body.baseCurrency).toBe(loadConfig().baseCurrency);
    portfolioRepo.deleteById(body.id);
  });

  it("rejects an invalid currency and a malformed body", async () => {
    const euro = await api("POST", "/api/portfolios", { name: "x", baseCurrency: "EURO" });
    expect(euro.status).toBe(400);
    expect(euro.body.message).toBe("Invalid currency");
    const digit = await api("POST", "/api/portfolios", { name: "x", baseCurrency: "e1r" });
    expect(digit.status).toBe(400);
    expect(digit.body.message).toBe("Invalid currency");
    const broken = await api("POST", "/api/portfolios", "{not json");
    expect(broken.status).toBe(400);
    expect(broken.body.message).toBe("Request body is not valid JSON");
  });

  // Suspected bug: modules/service/src/http/routes.ts:259-273 PortfolioService validation errors answer 500
  it.failing("answers 400 for a missing name or a bad colour", async () => {
    const empty = await api("POST", "/api/portfolios", { name: "" });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("Portfolio name is required");
    const blank = await api("POST", "/api/portfolios", { name: "   " });
    expect(blank.status).toBe(400);
    const colour = await api("POST", "/api/portfolios", { name: "x", color: "red" });
    expect(colour.status).toBe(400);
    expect(colour.body.message).toBe("Portfolio colour must be #rrggbb");
  });

  it("refuses a cross-site create and accepts the own origin", async () => {
    const name = "CSRF " + crypto.randomUUID();
    const refused = await api("POST", "/api/portfolios", { name }, { headers: { origin: "https://evil.example" } });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe("Cross-origin requests are not allowed");
    expect(portfolioRepo.findAll().some((p) => p.name === name)).toBe(false);
    const own = await api("POST", "/api/portfolios", { name }, { headers: { origin: "http://127.0.0.1:4000" } });
    expect(own.status).toBe(200);
    created.push(own.body.id);
    portfolioRepo.deleteById(own.body.id);
  });

  it("updates a portfolio and keeps fields not sent", async () => {
    const { status, body } = await api("PATCH", `/api/portfolios/${pid}`, { name: "Renamed", baseCurrency: "eur" });
    expect(status).toBe(200);
    expect(body.name).toBe("Renamed");
    expect(body.baseCurrency).toBe("EUR");
    expect(body.description).toBe("d");
    expect(body.color).toBe("#aabbcc");
    expect(body.updatedAt >= body.createdAt).toBe(true);
    const cleared = await api("PATCH", `/api/portfolios/${pid}`, { color: null });
    expect(cleared.body.color).toBeNull();
    const bad = await api("PATCH", `/api/portfolios/${pid}`, { baseCurrency: "XXXX" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Invalid currency");
  });

  // Suspected bug: modules/service/src/http/routes.ts:269 not found from PortfolioService answers 500
  it.failing("answers 404 when updating an unknown portfolio", async () => {
    const { status } = await api("PATCH", "/api/portfolios/nope", { name: "x" });
    expect(status).toBe(404);
  });

  it("answers 405 for a wrong method and null for an unknown path", async () => {
    const { status, body } = await api("PUT", `/api/portfolios/${pid}`, {});
    expect(status).toBe(405);
    expect(body).toEqual({ statusCode: 405, message: "Method PUT not allowed" });
    expect(await call("GET", "/api/does-not-exist")).toBeNull();
  });

  it("adds a deposit", async () => {
    const { status, body } = await api("POST", `/api/portfolios/${pid}/transactions`, {
      action: "add",
      transaction: { id: depId, date: "2025-01-01", type: "CUSTOMER_INBOUND", symbol: "", amount: 1000, currency: "EUR" },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("add");
    expect(body.totalTransactions).toBe(1);
    expect(body.transaction).toEqual({
      id: depId,
      portfolioId: pid,
      date: "2025-01-01",
      datetime: null,
      type: "CUSTOMER_INBOUND",
      assetClass: null,
      name: null,
      symbol: "",
      isin: null,
      shares: null,
      price: null,
      amount: 1000,
      fee: null,
      tax: null,
      currency: "EUR",
      createdAt: body.transaction.createdAt,
      updatedAt: body.transaction.updatedAt,
    });
    expect(body.transaction.createdAt).toMatch(ISO);
    expect(body.transaction.updatedAt).toMatch(ISO);
  });

  it("adds a private buy", async () => {
    const { body } = await api("POST", `/api/portfolios/${pid}/transactions`, {
      action: "add",
      transaction: { id: buyId, date: "2025-01-02", type: "PRIVATE_MARKET_BUY", symbol: "PFUND", shares: 10, price: 10, amount: -100, currency: "EUR" },
    });
    expect(body.totalTransactions).toBe(2);
    expect(body.transaction.shares).toBe(10);
  });

  it("lists transactions by date", async () => {
    const { body } = await api("GET", `/api/portfolios/${pid}/transactions`);
    expect(body.transactions.length).toBe(2);
    expect(body.transactions.map((t: { id: string }) => t.id)).toEqual([depId, buyId]);
  });

  it("values holdings offline with the private holding at cost", async () => {
    const { status, body } = await api("GET", `/api/portfolios/${pid}/data`);
    expect(status).toBe(200);
    expect(body.summary.baseCurrency).toBe("EUR");
    expect(body.summary.totalValue).toBe(100);
    expect(body.summary.totalCost).toBe(100);
    expect(body.summary.cashBalance).toBe(900);
    expect(body.summary.totalPortfolioValue).toBe(1000);
    expect(body.summary.totalCashInjected).toBe(1000);
    expect(body.summary.otherWeightPercent).toBe(10);
    expect(body.summary.cashWeightPercent).toBe(90);
    const pfund = body.holdings.find((h: { symbol: string }) => h.symbol === "PFUND");
    expect(pfund).toMatchObject({ symbol: "PFUND", assetType: "Other", shares: 10, currentValue: 100, weightPercent: 10, isPrivate: true });
    const cash = body.holdings.find((h: { symbol: string }) => h.symbol === "CASH");
    expect(cash).toMatchObject({ symbol: "CASH", assetType: "Cash", currentValue: 900, weightPercent: 90 });
    const bad = await api("GET", `/api/portfolios/${pid}/data?baseCurrency=x1y`);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Invalid currency");
  });

  // Suspected bug: modules/service/src/services/portfolio.ts:364-404 unknown portfolio data answers 500
  it.failing("answers 404 for data of an unknown portfolio", async () => {
    const { status } = await api("GET", "/api/portfolios/nope/data");
    expect(status).toBe(404);
  });

  it("edits a transaction and clears the holdings cache", async () => {
    const { body } = await api("POST", `/api/portfolios/${pid}/transactions`, { action: "edit", transactionId: buyId, transaction: { shares: 20, amount: -200 } });
    expect(body.success).toBe(true);
    expect(body.action).toBe("edit");
    expect(body.totalTransactions).toBe(2);
    expect(body.transaction.shares).toBe(20);
    expect(body.transaction.price).toBe(10);
    const data = await api("GET", `/api/portfolios/${pid}/data`);
    const pfund = data.body.holdings.find((h: { symbol: string }) => h.symbol === "PFUND");
    expect(pfund).toMatchObject({ shares: 20, currentValue: 200 });
  });

  it("answers success false for an unknown transaction", async () => {
    const { status, body } = await api("POST", `/api/portfolios/${pid}/transactions`, { action: "edit", transactionId: "missing", transaction: { shares: 1 } });
    expect(status).toBe(200);
    expect(body).toEqual({ success: false, action: "edit", totalTransactions: 0, error: "Transaction not found" });
  });

  it("answers success false for transactions of an unknown portfolio", async () => {
    const { status, body } = await api("POST", "/api/portfolios/nope/transactions", {
      action: "add",
      transaction: { id: "ct-x-" + crypto.randomUUID(), date: "2025-01-01", type: "CUSTOMER_INBOUND", symbol: "", amount: 1, currency: "EUR" },
    });
    expect(status).toBe(200);
    expect(body).toEqual({ success: false, action: "add", totalTransactions: 0, error: "Portfolio not found" });
  });

  it("answers 400 naming the missing field for an incomplete transaction", async () => {
    const { status, body } = await api("POST", `/api/portfolios/${pid}/transactions`, { action: "add", transaction: { symbol: "X" } });
    expect(status).toBe(400);
    expect(String(body.message)).not.toContain("constraint");
    expect(body.message).toBe("Transaction is missing: date, type");
  });

  it("answers 400 naming each incomplete import row and imports none of them", async () => {
    const good = { id: "imp-ok-" + crypto.randomUUID(), date: "2025-02-01", type: "CUSTOMER_INBOUND", symbol: "", amount: 5, currency: "EUR" };
    const before = txRepo.countByPortfolio(pid);
    for (const dryRun of [true, false]) {
      const { status, body } = await api("POST", `/api/portfolios/${pid}/transactions`, {
        action: "import",
        dryRun,
        transactions: [good, { symbol: "X", type: "BUY", shares: 1 }, { date: "2025-02-02", amount: 1 }],
      });
      expect(status).toBe(400);
      expect(String(body.message)).not.toContain("constraint");
      expect(body.message).toBe("Import rows are missing required fields: row 2 (date); row 3 (type, symbol)");
    }
    expect(txRepo.countByPortfolio(pid)).toBe(before);
    expect(txRepo.findById(good.id)).toBeNull();
  });

  it("answers 400 for an import row that is not an object", async () => {
    const { status, body } = await api("POST", `/api/portfolios/${pid}/transactions`, { action: "import", transactions: [null] });
    expect(status).toBe(400);
    expect(body.message).toBe("Import rows are missing required fields: row 1 (date, type, symbol)");
  });

  it("deletes a transaction", async () => {
    const { body } = await api("POST", `/api/portfolios/${pid}/transactions`, { action: "delete", transactionId: buyId });
    expect(body.success).toBe(true);
    expect(body.action).toBe("delete");
    expect(body.totalTransactions).toBe(1);
    expect(txRepo.findById(buyId)).toBeNull();
  });

  it("validates input before reaching a missing service", async () => {
    const expectError = async (method: string, path: string, body: unknown, status: number, message: string) => {
      const r = await api(method, path, body);
      expect({ path, status: r.status, message: r.body?.message }).toEqual({ path, status, message });
    };
    for (const tail of ["exposure", "income", "events"]) await expectError("GET", `/api/portfolios/nope/${tail}`, undefined, 404, "Portfolio not found");
    for (const days of ["0", "366", "abc"]) await expectError("GET", `/api/portfolios/${pid}/events?days=${days}`, undefined, 400, "days must be between 1 and 365");
    await expectError("PUT", "/api/symbol-map/NOTANISIN", { symbol: "AAPL" }, 400, "Not a valid ISIN");
    await expectError("PUT", "/api/symbol-map/US0378331005", { symbol: "bad symbol!" }, 400, "Invalid symbol");
    await expectError("PUT", "/api/symbol-map/US0378331005", {}, 400, "symbol is required");
    for (const body of [{ price: -1 }, { price: 0 }, { price: "10" }, {}]) {
      await expectError("PUT", `/api/portfolios/${pid}/manual-prices/PFUND`, body, 400, "price must be a positive number");
    }
    await expectError("PUT", `/api/portfolios/${pid}/manual-prices/PFUND`, { price: 12.5, currency: "eu" }, 400, "Invalid currency");
    await expectError("PUT", `/api/portfolios/${pid}/manual-prices/PFUND`, { price: 12.5, currency: "" }, 400, "currency is required");
    await expectError("POST", `/api/portfolios/${pid}/suggestions/s1/status`, { status: "bogus" }, 400, "status must be active, done or dismissed");
    await expectError("POST", "/api/metrics/install", { url: "https://example.com/m.wasm", sha256: "xyz" }, 400, "Invalid sha256");
    await expectError("POST", "/api/files/save", {}, 400, "fileName is required");
    await expectError("POST", "/api/files/reveal", {}, 400, "filePath is required");
    await expectError("POST", "/api/app/update/download", {}, 400, "version is required");
  });

  it("deletes a portfolio with its transactions", async () => {
    const { status, body } = await api("DELETE", `/api/portfolios/${pid}`);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    const list = await api("GET", "/api/portfolios");
    expect(list.body.portfolios.some((p: { id: string }) => p.id === pid)).toBe(false);
    const txs = await api("GET", `/api/portfolios/${pid}/transactions`);
    expect(txs.body).toEqual({ transactions: [] });
    expect(txRepo.findById(depId)).toBeNull();
  });

  // Suspected bug: modules/service/src/http/routes.ts:275-287 deleting a deleted portfolio answers 500
  it.failing("answers 404 when deleting a portfolio twice", async () => {
    const { status } = await api("DELETE", `/api/portfolios/${pid}`);
    expect(status).toBe(404);
  });

  it("masks secrets when reading settings", async () => {
    const { status, body } = await api("GET", "/api/config");
    expect(status).toBe(200);
    for (const key of ["llmApiKey", "finnhubApiKey", "fmpApiKey", "gotifyToken", "ntfyToken"]) {
      expect(["", SECRET_MASK]).toContain(body[key]);
    }
    for (const value of Object.values(body.llmApiKeys ?? {})) expect(["", SECRET_MASK]).toContain(value as string);
    const settings = await api("GET", "/api/settings");
    expect(Array.isArray(settings.body.settings)).toBe(true);
    for (const entry of settings.body.settings) {
      expect(typeof entry.key).toBe("string");
      expect(typeof entry.kind).toBe("string");
      expect("value" in entry).toBe(true);
      expect(typeof entry.isSet).toBe("boolean");
    }
  });

  it("stores allowed settings, masks secrets and ignores protected or unknown keys", async () => {
    const { status, body } = await api("PATCH", "/api/config", {
      theme: "light",
      finnhubApiKey: "fh-contract-secret-123",
      llmApiKeys: { "openai-compatible": "sk-contract-999" },
      bogusKey: 1,
      deviceId: "hijack",
      allowRemoteConnections: true,
      remotePort: 6000,
      mcpEnabled: true,
      mcpPort: 6001,
    });
    expect(status).toBe(200);
    expect(body.theme).toBe("light");
    expect(body.finnhubApiKey).toBe(SECRET_MASK);
    expect(body.llmApiKeys["openai-compatible"]).toBe(SECRET_MASK);
    expect("bogusKey" in body).toBe(false);
    expect(body.deviceId).toBe(original.deviceId);
    expect(body.allowRemoteConnections).toBe(original.allowRemoteConnections);
    expect(body.remotePort).toBe(original.remotePort);
    expect(body.mcpEnabled).toBe(original.mcpEnabled);
    expect(body.mcpPort).toBe(original.mcpPort);
    expect(loadConfig().finnhubApiKey).toBe("fh-contract-secret-123");
    expect(loadConfig().llmApiKeys["openai-compatible"]).toBe("sk-contract-999");
  });

  it("keeps a secret when the mask comes back and clears it on an empty string", async () => {
    await api("PATCH", "/api/config", { finnhubApiKey: SECRET_MASK });
    expect(loadConfig().finnhubApiKey).toBe("fh-contract-secret-123");
    const { body } = await api("PATCH", "/api/config", { finnhubApiKey: "" });
    expect(loadConfig().finnhubApiKey).toBe("");
    expect(body.finnhubApiKey).toBe("");
  });

  it("limits the client log body", async () => {
    const big = JSON.stringify({ level: "info", message: "x".repeat(70 * 1024) });
    const tooBig = await api("POST", "/api/app/logs", big, { headers: { "content-length": String(big.length) } });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.message).toBe("Request body is too large");
    const ok = await api("POST", "/api/app/logs", { level: "info", message: "hello" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });
  });

  it("describes the app to the local window", async () => {
    const { status, body } = await api("GET", "/api/app/info");
    expect(status).toBe(200);
    expect(typeof body.version).toBe("string");
    expect(body.majorMinor).toBe(body.version.split(".").slice(0, 2).join("."));
    expect(body.webpageUrl).toBe("https://portfolio.cgeosoft.com");
    expect(typeof body.devEmail).toBe("string");
    expect(body.isDev).toBe(true);
    expect(body.channel).toBe("development");
    // Before any quote sync the value is undefined, so JSON drops the key.
    if ("lastQuotesSync" in body) expect(body.lastQuotesSync === null || typeof body.lastQuotesSync === "string" || typeof body.lastQuotesSync === "number").toBe(true);
    expect(body.isLocalClient).toBe(true);
    expect(typeof body.paths.data).toBe("string");
    expect(typeof body.paths.logs).toBe("string");
  });

  it("quits only for the local window", async () => {
    const local = await api("POST", "/api/app/quit");
    expect(local.status).toBe(200);
    expect(local.body).toEqual({ success: true });
    await Bun.sleep(80);
    expect(onQuit).toHaveBeenCalledTimes(1);
    const remote = await api("POST", "/api/app/quit", undefined, { ip: "127.0.0.1", isLocal: false });
    expect(remote.status).toBe(403);
    expect(remote.body.message).toBe("Remote connections are disabled on this Portfolio");
    await Bun.sleep(80);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("never puts a secret or the session id in a response body or a log line", () => {
    const all = bodies.join("\n");
    const logs = logged();
    for (const secret of ["fh-contract-secret-123", "sk-contract-999", sid]) {
      expect(all).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
  });
});
