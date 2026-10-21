import { describe, it, expect, beforeAll } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding } from "portfolio-shared/portfolio";
import type { PortfolioExposureResponse, PortfolioIncomeSummary } from "portfolio-shared/api-types";
import * as portfolioRepo from "../../db/portfolio.repo";
import { authService } from "../auth";
import { loadConfig, updateConfig } from "../../config";
import { createMcpToken, isValidMcpToken, mcpAccessInfo, rotateMcpToken, setMcpAccess, startMcpAccess, stopMcpAccess } from "../mcp-access";
import { handleMcpHttp } from "../mcp-server";
import { McpPrivacyError, assertPercentOnly, callMcpTool, projectExposure, projectHoldings, projectPerformance, type McpToolDeps } from "../mcp-tools";

// Money amounts that must never appear in an answer. Odd numbers, so a match is not a coincidence.
const SECRET_NUMBERS = [987654.32, 123456.78, 4321.09, 77.77, 1313, 55555.5];

function holding(over: Partial<PortfolioHolding>): PortfolioHolding {
  return {
    symbol: "AAPL",
    name: "Apple",
    assetType: "Stock",
    shares: 1313,
    buyPrice: 77.77,
    currentPrice: 94.05,
    previousClose: 93.5,
    totalCost: 4321.09,
    currentValue: 123456.78,
    dayChangeDollar: 55555.5,
    dayChangePercent: 0.59,
    totalGainLossDollar: 987654.32,
    totalGainLossPercent: 20.93,
    weightPercent: 62.5,
    currency: "EUR",
    fiftyTwoWeekHigh: 110,
    fiftyTwoWeekLow: 80,
    sma50: 90,
    sma200: 85,
    rsi: 58.3,
    ...over,
  };
}

const DATA: FinancialPortfolioData = {
  summary: {
    totalValue: 987654.32,
    totalCost: 123456.78,
    totalGainLossDollar: 4321.09,
    totalGainLossPercent: 12.34,
    dayGainLossDollar: 55555.5,
    dayGainLossPercent: -0.42,
    totalGainSinceStartDollar: 77.77,
    totalGainSinceStartPercent: 15.5,
    totalCashInjected: 123456.78,
    cashBalance: 4321.09,
    totalPortfolioValue: 987654.32,
    realizedPnL: 1313,
    totalDividends: 77.77,
    totalInterest: 55555.5,
    totalFees: 77.77,
    totalTaxes: 77.77,
    bestPerformer: { symbol: "AAPL", changePercent: 0.59 },
    stockWeightPercent: 62.5,
    etfWeightPercent: 30,
    cryptoWeightPercent: 0,
    cashWeightPercent: 7.5,
    baseCurrency: "EUR",
    lastUpdated: "2026-10-20T16:00:00.000Z",
  },
  holdings: [
    holding({}),
    holding({ symbol: "VWCE.DE", name: "Vanguard FTSE All-World", assetType: "ETF", weightPercent: 30 }),
    holding({ symbol: "SOLD", name: "Sold out", shares: 0, weightPercent: 0 }),
  ],
  chartHistory: [{ date: "2026-10-20", timestamp: 0, totalValue: 987654.32, totalCost: 123456.78, totalGainLoss: 4321.09 }],
  individualCharts: { AAPL: [{ date: "2026-10-20", close: 77.77 }] },
};

const EXPOSURE: PortfolioExposureResponse = {
  portfolioId: "p",
  baseCurrency: "EUR",
  totalValue: 987654.32,
  generatedAt: "2026-10-20T16:00:00.000Z",
  sectors: { items: [{ name: "Technology", percent: 70, value: 123456.78 }], unknownPercent: 5, notApplicablePercent: 25 },
  countries: { items: [{ name: "United States", percent: 80, value: 4321.09 }], unknownPercent: 0, notApplicablePercent: 20 },
  assetClasses: { items: [{ name: "Equity", percent: 92.5, value: 55555.5 }], unknownPercent: 0, notApplicablePercent: 7.5 },
  topStocks: [{ symbol: "AAPL", name: "Apple", percent: 64, value: 1313, directPercent: 62.5, viaFundsPercent: 1.5, breakdown: [{ via: "direct", percent: 62.5, value: 77.77 }] }],
  funds: [
    {
      symbol: "VWCE.DE",
      percent: 30,
      value: 123456.78,
      expenseRatio: 0.22,
      aum: 987654.32,
      aumCurrency: "EUR",
      holdingsCount: 1313,
      holdingsComplete: false,
      holdingsKnownPercent: 40,
      sources: { holdings: null, sectors: null, countries: null, assetClasses: null, info: null },
    },
  ],
  overlaps: [],
  warnings: [{ kind: "stock", name: "AAPL", percent: 64, limit: 20, message: "Apple is 64% of the portfolio. Limit: 20%." }],
  limits: { stockPercent: 20, sectorPercent: 40, countryPercent: 70, overlapPercent: 50 },
  coverage: { directPercent: 70, lookedThroughPercent: 30, unknownPercent: 0, holdingsKnownPercent: 82 },
  weightedExpenseRatio: { percent: 0.22, coveragePercent: 100 },
  sources: [],
};

const INCOME: PortfolioIncomeSummary = {
  portfolioId: "p",
  baseCurrency: "EUR",
  generatedAt: "2026-10-20T16:00:00.000Z",
  projected12m: { total: 4321.09, months: [{ month: "2026-11", declared: 77.77, estimated: 1313 }] },
  received12m: { total: 55555.5, count: 4 },
  yieldOnCostPercent: 2.1,
  currentYieldPercent: 1.8,
  holdings: [
    {
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      forwardDividendPerShare: 77.77,
      trailingDividendPerShare: 77.77,
      projectedIncome12m: 4321.09,
      receivedIncome12m: 1313,
      yieldOnCostPercent: 2.1,
      currentYieldPercent: 1.8,
      nextExDate: "2026-11-07",
      estimated: false,
      source: null,
    },
  ],
  splitWarnings: [],
  sources: [],
};

function fakeDeps(): McpToolDeps {
  return {
    portfolioService: { getPortfolioData: async () => DATA },
    exposure: { getExposure: async () => EXPOSURE },
    income: {
      getIncomeSummary: async () => INCOME,
      getUpcomingEvents: async (id: string, days: number) => ({
        portfolioId: id,
        baseCurrency: "EUR",
        days,
        from: "2026-10-21",
        to: "2026-11-20",
        sources: [],
        events: [
          { date: "2026-11-07", kind: "exDividend", symbol: "AAPL", name: "Apple", amountPerShare: 77.77, expectedIncome: 4321.09, currency: "USD", source: null },
          { date: "2026-11-10", kind: "split", symbol: "AAPL", name: "Apple", numerator: 4, denominator: 1, source: null },
        ],
      }),
    },
    yahoo: {},
    finnhub: {},
    fmp: {},
  } as unknown as McpToolDeps;
}

/** Every number in the serialized answer, so a test can check none of them is a money amount. */
function numbersIn(value: unknown): number[] {
  return (JSON.stringify(value).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe("percent-only guard", () => {
  it("accepts percentages and the listed counts", () => {
    expect(() => assertPercentOnly({ weightPercent: 1, a: { returnPercent: 2, rsi: 50, holdingsCount: 3 }, list: [{ percent: 4 }], name: "x", ok: true, none: null })).not.toThrow();
  });

  it("refuses money amounts, quantities and bare numbers in arrays", () => {
    expect(() => assertPercentOnly({ totalValue: 1 })).toThrow(McpPrivacyError);
    expect(() => assertPercentOnly({ holdings: [{ shares: 3 }] })).toThrow(McpPrivacyError);
    expect(() => assertPercentOnly({ series: [1, 2] })).toThrow(McpPrivacyError);
    expect(() => assertPercentOnly({ price: 0 })).toThrow(McpPrivacyError);
  });
});

describe("MCP tools", () => {
  let portfolioId = "";
  beforeAll(() => {
    for (const p of portfolioRepo.findAll()) portfolioRepo.deleteById(p.id);
    portfolioId = portfolioRepo.create({ name: "MCP test", baseCurrency: "EUR" }).id;
  });

  for (const tool of ["list_portfolios", "get_portfolio_summary", "get_holdings", "get_exposure", "get_dividend_yield", "get_upcoming_events"]) {
    it(`${tool} answers with no money amount`, async () => {
      const answer = await callMcpTool(fakeDeps(), tool, { portfolio_id: portfolioId });
      for (const n of numbersIn(answer)) expect(SECRET_NUMBERS).not.toContain(n);
    });
  }

  it("names the return series in percent", () => {
    const answer = projectPerformance(portfolioId, {
      symbol: "^GSPC",
      label: "S&P 500",
      range: "1y",
      from: "2025-10-20",
      to: "2026-10-20",
      portfolioReturnPercent: 12.3,
      benchmarkReturnPercent: 10.1,
      excessReturnPercent: 2.2,
      series: [{ date: "2025-10-20", portfolio: 0, benchmark: 0 }],
      source: null,
    });
    expect(() => assertPercentOnly(answer)).not.toThrow();
    expect(answer.series?.[0]).toEqual({ date: "2025-10-20", portfolioPercent: 0, benchmarkPercent: 0 });
  });

  it("leaves out sold holdings and keeps weights, returns and technicals", () => {
    const row = portfolioRepo.findById(portfolioId)!;
    const answer = projectHoldings(row, DATA);
    expect(answer.holdings.map((h) => h.symbol)).toEqual(["AAPL", "VWCE.DE"]);
    const aapl = answer.holdings[0]!;
    expect(aapl.weightPercent).toBe(62.5);
    expect(aapl.onCostPercent).toBe(20.93);
    expect(aapl.from52WeekHighPercent).toBe(-14.5);
    expect(aapl.vsSma50Percent).toBe(4.5);
    expect(JSON.stringify(aapl)).not.toContain("shares");
  });

  it("drops fund size and holding values from the exposure", () => {
    const answer = projectExposure(EXPOSURE);
    expect(JSON.stringify(answer)).not.toMatch(/"(value|aum|totalValue|holdingsCount)"/);
    expect(answer.warnings[0]).toEqual({ kind: "stock", name: "AAPL", percent: 64, limitPercent: 20 });
  });

  it("gives the split ratio as text and no dividend amounts", async () => {
    const answer = (await callMcpTool(fakeDeps(), "get_upcoming_events", { portfolio_id: portfolioId, days: 30 })) as { events: Record<string, unknown>[] };
    expect(answer.events[1]!.splitRatio).toBe("4:1");
    expect(answer.events[0]).not.toHaveProperty("amountPerShare");
    expect(answer.events[0]).not.toHaveProperty("expectedIncome");
  });

  it("picks the only portfolio when no id is given, and refuses an unknown id", async () => {
    const summary = (await callMcpTool(fakeDeps(), "get_portfolio_summary", {})) as { portfolioId: string };
    expect(summary.portfolioId).toBe(portfolioId);
    await expect(callMcpTool(fakeDeps(), "get_holdings", { portfolio_id: "nope" })).rejects.toThrow("Portfolio not found");
  });
});

describe("MCP endpoint", () => {
  let token = "";
  beforeAll(() => {
    authService.acceptTerms();
    token = createMcpToken();
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:5131/mcp", {
      method: "POST",
      headers: { host: "127.0.0.1:5131", "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify(body),
    });
  const call = (req: Request) => handleMcpHttp(req, fakeDeps(), isValidMcpToken);

  it("requires the access token", async () => {
    expect((await call(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "" }))).status).toBe(401);
    expect((await call(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer wrong" }))).status).toBe(401);
    expect(isValidMcpToken(token)).toBe(true);
  });

  it("refuses web pages and foreign host names", async () => {
    expect((await call(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await call(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { host: "evil.example:5131" }))).status).toBe(403);
    expect((await call(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "http://127.0.0.1:5131" }))).status).toBe(200);
  });

  it("initializes, lists the tools and calls one", async () => {
    const init = await (await call(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }))).json();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();

    expect((await call(post({ jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);

    const list = await (await call(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("get_holdings");

    const res = await (await call(post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_portfolios", arguments: {} } }))).json();
    expect(res.result.isError).toBe(false);
    expect(res.result.structuredContent.portfolios.length).toBeGreaterThan(0);
  });

  it("answers an unknown method with a JSON-RPC error and GET with 405", async () => {
    const res = await (await call(post({ jsonrpc: "2.0", id: 4, method: "resources/list" }))).json();
    expect(res.error.code).toBe(-32601);
    const get = new Request("http://127.0.0.1:5131/mcp", { headers: { host: "127.0.0.1:5131", authorization: `Bearer ${token}` } });
    expect((await call(get)).status).toBe(405);
  });
});

describe("MCP switch", () => {
  it("creates a token when turned on, shows it once and deletes it when turned off", () => {
    let started = 0;
    let stopped = 0;
    startMcpAccess(() => {
      started++;
      return { stop: () => void stopped++ };
    }, fakeDeps());
    updateConfig({ mcpEnabled: false });
    setMcpAccess({ enabled: false });

    const on = setMcpAccess({ enabled: true, port: 5199 });
    expect(on.enabled).toBe(true);
    expect(on.listening).toBe(true);
    expect(on.token).toMatch(/^pmcp_/);
    expect(on.url).toBe("http://127.0.0.1:5199/mcp");
    expect(mcpAccessInfo().token).toBeUndefined();
    expect(isValidMcpToken(on.token)).toBe(true);

    const rotated = rotateMcpToken();
    expect(isValidMcpToken(on.token)).toBe(false);
    expect(isValidMcpToken(rotated.token)).toBe(true);

    const off = setMcpAccess({ enabled: false });
    expect(off.listening).toBe(false);
    expect(off.hasToken).toBe(false);
    expect(isValidMcpToken(rotated.token)).toBe(false);
    expect(started).toBe(1);
    expect(stopped).toBe(1);
    expect(loadConfig().mcpEnabled).toBe(false);
    stopMcpAccess();
  });

  it("refuses a port out of range", () => {
    expect(() => setMcpAccess({ port: 80 })).toThrow("1024");
  });
});
