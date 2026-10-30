/**
 * MCP privacy end to end: a real portfolio computed by PortfolioService, projected by the MCP tools and sent
 * through the HTTP endpoint, never carries an absolute amount, quantity, price or the portfolio description.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import * as portfolioRepo from "../../db/portfolio.repo";
import { authService } from "../auth";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";
import { assertPercentOnly, callMcpTool, projectSummary, projectHoldings, type McpToolDeps } from "../mcp-tools";
import { handleMcpHttp } from "../mcp-server";

const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

const SECRETS = [98765.43, 13.13, 777.77, 10212.12, 88553.31, 10212.1201];
const SECRET_TEXT = ["98765.43", "13.13", "777.77", "10212.12", "88553.31"];
const MONEY_KEYS = ["shares", "price", "buyPrice", "currentPrice", "currentValue", "totalValue", "totalCost", "amount", "cashBalance", "totalPortfolioValue", "totalCashInjected", "realizedPnL", "dayChangeDollar", "totalGainLossDollar", "description"];

function numbersIn(value: unknown): number[] {
  return (JSON.stringify(value).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

function keysIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysIn(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  }
  return out;
}

function expectNoSecrets(out: unknown): void {
  for (const n of numbersIn(out)) expect(SECRETS).not.toContain(n);
  const keys = keysIn(out);
  for (const k of MONEY_KEYS) expect(keys.has(k)).toBe(false);
}

let service: PortfolioService;
let pid = "";
let deps: McpToolDeps;

beforeAll(async () => {
  service = new PortfolioService(offline);
  pid = portfolioRepo.create({ name: "Privacy", description: "Balance 98765.43 EUR", baseCurrency: "EUR" }).id;
  await service.manageTransactions(pid, {
    action: "batch_add",
    transactions: [
      { id: `pv-d1-${crypto.randomUUID()}`, date: "2025-01-01", type: "CUSTOMER_INBOUND", symbol: "", amount: 98765.43, currency: "EUR" },
      { id: `pv-b1-${crypto.randomUUID()}`, date: "2025-01-02", type: "PRIVATE_MARKET_BUY", symbol: "PFUND", shares: 13.13, price: 777.77, amount: -10212.12, currency: "EUR" },
    ],
  } as unknown as Parameters<PortfolioService["manageTransactions"]>[1]);
  deps = { portfolioService: service, exposure: {}, income: {}, yahoo: {}, finnhub: {}, fmp: {} } as unknown as McpToolDeps;
});

afterAll(() => {
  portfolioRepo.deleteById(pid);
  service.destroy();
});

describe("MCP privacy with real portfolio math", () => {
  it("lists portfolios without the description", async () => {
    const out = (await callMcpTool(deps, "list_portfolios", { portfolio_id: pid })) as { portfolios: Record<string, unknown>[] };
    expect(out.portfolios).toContainEqual(expect.objectContaining({ id: pid, name: "Privacy", baseCurrency: "EUR" }));
    expect(JSON.stringify(out)).not.toContain("98765.43");
    expect(keysIn(out).has("description")).toBe(false);
  });

  it("summarizes in percentages only", async () => {
    const out = (await callMcpTool(deps, "get_portfolio_summary", { portfolio_id: pid })) as any;
    expect(out.allocation.otherPercent).toBe(10.34);
    expect(out.allocation.cashPercent).toBe(89.66);
    expect(out.holdingsCount).toBe(1);
    expect(out.returns.onCostPercent).toBe(0);
    expect(out.bestToday.symbol).toBe("PFUND");
    expect(out.worstToday).toBeNull();
    expectNoSecrets(out);
  });

  it("lists holdings by weight with no amounts", async () => {
    const raw = await callMcpTool(deps, "get_holdings", { portfolio_id: pid });
    // Checked as JSON, the form a client receives.
    const out = JSON.parse(JSON.stringify(raw)) as { holdings: Record<string, unknown>[] };
    expect(out.holdings.map((h) => h.symbol)).toEqual(["CASH", "PFUND"]);
    const [cash, fund] = out.holdings;
    expect(cash).toMatchObject({ assetType: "Cash", weightPercent: 89.66 });
    expect(cash).not.toHaveProperty("dayChangePercent");
    expect(cash).not.toHaveProperty("onCostPercent");
    expect(fund).toMatchObject({ isPrivate: true, weightPercent: 10.34, onCostPercent: 0 });
    expectNoSecrets(out);
    expect(() => assertPercentOnly(raw)).not.toThrow();
  });

  it("sends no amount through the HTTP endpoint", async () => {
    authService.acceptTerms();
    const req = new Request("http://127.0.0.1:5131/mcp", {
      method: "POST",
      headers: { host: "127.0.0.1:5131", authorization: "Bearer any", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_holdings", arguments: { portfolio_id: pid } } }),
    });
    const res = await handleMcpHttp(req, deps, () => true);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toBeDefined();
    for (const s of SECRET_TEXT) expect(text).not.toContain(s);
  });

  it("rounds weights to two decimals and drops non-finite ones", async () => {
    const data = await service.getPortfolioData(pid);
    const row = portfolioRepo.findById(pid)!;
    const idx = data.holdings.findIndex((h) => h.symbol === "PFUND");
    expect(idx).toBeGreaterThanOrEqual(0);

    const rounded = structuredClone(data) as FinancialPortfolioData;
    rounded.holdings[idx]!.weightPercent = 10.126;
    const projected = projectHoldings(row, rounded) as { holdings: Record<string, unknown>[] };
    expect(projected.holdings.find((h) => h.symbol === "PFUND")?.weightPercent).toBe(10.13);
    expect(() => assertPercentOnly(projectSummary(row, rounded))).not.toThrow();

    for (const bad of [NaN, Infinity]) {
      const copy = structuredClone(data) as FinancialPortfolioData;
      copy.holdings[idx]!.weightPercent = bad;
      const out = JSON.parse(JSON.stringify(projectHoldings(row, copy))) as { holdings: Record<string, unknown>[] };
      const fund = out.holdings.find((h) => h.symbol === "PFUND");
      expect(fund).toBeDefined();
      expect(fund).not.toHaveProperty("weightPercent");
    }
  });

  it("would stop any summary amount passed through", async () => {
    const data = await service.getPortfolioData(pid);
    const keys = Object.entries(data.summary).filter(([k, v]) => typeof v === "number" && !k.endsWith("Percent")).map(([k]) => k);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(() => assertPercentOnly({ [key]: 1 })).toThrow();
  });
});
