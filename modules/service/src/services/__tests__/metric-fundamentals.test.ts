/**
 * The FMP to metric fundamentals mapping with a stub FMP client: field
 * mapping, fund detection, eligibility, caching, failure tolerance, and logs
 * that never name a symbol. The symbol XMPL is fictional.
 */

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding, PortfolioSummary } from "portfolio-shared/portfolio";
import { MetricFundamentalsService } from "../metrics/fundamentals.js";
import type { FmpService } from "../fmp.js";
import { appLogger } from "../../logger.js";

type Table = Record<string, Record<string, unknown[] | null>>;
type Profiles = Record<string, Record<string, unknown> | null>;

const fullTable = (): Table => ({
  XMPL: {
    "/key-metrics-ttm": [{ earningsYieldTTM: 0.05, freeCashFlowYieldTTM: 0.04, returnOnEquityTTM: 0.2 }],
    "/ratios-ttm": [
      {
        priceToEarningsRatioTTM: 20,
        priceToBookRatioTTM: 3,
        dividendYieldTTM: 0.015,
        dividendPayoutRatioTTM: 0.3,
        netProfitMarginTTM: 0.25,
        debtToEquityRatioTTM: 1.5,
      },
    ],
    "/price-target-consensus": [{ targetConsensus: 120 }],
    "/discounted-cash-flow": [{ dcf: 150, "Stock Price": 90 }],
    "/financial-scores": [{ piotroskiScore: 7, altmanZScore: 4.2 }],
    "/grades-consensus": [{ strongBuy: 2, buy: 3, hold: 4, sell: 1, strongSell: 0 }],
  },
});
const fullProfiles = (): Profiles => ({ XMPL: { price: 100, beta: 1.2, marketCap: 1e9 } });

function stub(opts: { configured?: boolean; table?: Table; profiles?: Profiles } = {}) {
  const table = opts.table ?? fullTable();
  const profiles = opts.profiles ?? fullProfiles();
  const getProfile = mock(async (sym: string) => profiles[sym] ?? null);
  const get = mock(async (path: string, params: { symbol: string }) => table[params.symbol]?.[path] ?? null);
  const isConfigured = () => opts.configured ?? true;
  const fmp = { isConfigured, getProfile, get } as unknown as FmpService;
  return { fmp, getProfile, get, service: new MetricFundamentalsService(fmp) };
}

function holding(symbol: string, overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    symbol, name: symbol, assetType: "Stock", shares: 1, buyPrice: 1, currentPrice: 1, previousClose: 1, totalCost: 1,
    currentValue: 1, dayChangeDollar: 0, dayChangePercent: 0, totalGainLossDollar: 0, totalGainLossPercent: 0,
    weightPercent: 100, currency: "USD",
    ...overrides,
  };
}

const data = (...holdings: PortfolioHolding[]): FinancialPortfolioData => ({
  summary: undefined as unknown as PortfolioSummary,
  holdings,
  chartHistory: [],
  individualCharts: {},
  transactions: [],
});

afterEach(() => {
  mock.restore();
});

describe("MetricFundamentalsService", () => {
  it("returns nothing and calls nothing when FMP is not configured", async () => {
    const s = stub({ configured: false });
    expect(s.service.isAvailable()).toBe(false);
    expect(await s.service.forPortfolio(data(holding("XMPL")))).toEqual([]);
    expect(s.getProfile).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    expect(stub({ configured: true }).service.isAvailable()).toBe(true);
  });

  it("maps a full row", async () => {
    const s = stub();
    const rows = await s.service.forPortfolio(data(holding("XMPL")));
    expect(rows).toHaveLength(1);
    const { targetUpside, ...values } = rows[0].values;
    expect(rows[0].symbol).toBe("XMPL");
    expect(rows[0].isFund).toBe(false);
    expect(values).toEqual({
      beta: 1.2, marketCap: 1e9, price: 100, peRatio: 20, priceToBook: 3, earningsYield: 0.05, freeCashFlowYield: 0.04,
      dividendYield: 0.015, payoutRatio: 0.3, returnOnEquity: 0.2, netMargin: 0.25, debtToEquity: 1.5, priceTarget: 120,
      dcfValue: 150, dcfUpside: 0.5, piotroski: 7, altmanZ: 4.2, analystScore: 3.6, analystCount: 10,
    });
    expect(targetUpside).toBeCloseTo(0.2, 10);
    const paths = s.get.mock.calls.map(([path]) => path);
    expect(paths.sort()).toEqual(Object.keys(fullTable().XMPL).sort());
    for (const [, params] of s.get.mock.calls) expect(params).toEqual({ symbol: "XMPL" });
  });

  it("falls back to the DCF stock price when the profile has no price", async () => {
    const s = stub({ profiles: { XMPL: { beta: 1.2, marketCap: 1e9 } } });
    const [row] = await s.service.forPortfolio(data(holding("XMPL")));
    expect(row.values.price).toBeUndefined();
    expect(row.values.targetUpside).toBeUndefined();
    expect(row.values.dcfUpside).toBeCloseTo(150 / 90 - 1, 10);
  });

  it("drops zero or negative ratios but keeps a zero beta", async () => {
    for (const pe of [0, -3]) {
      const table = fullTable();
      (table.XMPL["/ratios-ttm"]![0] as Record<string, number>).priceToEarningsRatioTTM = pe;
      const [row] = await stub({ table }).service.forPortfolio(data(holding("XMPL")));
      expect(row.values.peRatio).toBeUndefined();
    }
    const [row] = await stub({ profiles: { XMPL: { price: 100, beta: 0, marketCap: 0 } } }).service.forPortfolio(data(holding("XMPL")));
    expect(row.values.marketCap).toBeUndefined();
    expect(row.values.beta).toBe(0);
  });

  it("treats a fund by asset type or profile as a fund", async () => {
    const etf = stub();
    const [byType] = await etf.service.forPortfolio(data(holding("XMPL", { assetType: "ETF" })));
    expect(byType).toEqual({ symbol: "XMPL", isFund: true, values: { beta: 1.2, marketCap: 1e9, price: 100 } });
    expect(etf.get).not.toHaveBeenCalled();

    for (const flag of ["isEtf", "isFund"]) {
      const s = stub({ profiles: { XMPL: { price: 100, beta: 1.2, marketCap: 1e9, [flag]: true } } });
      const [byProfile] = await s.service.forPortfolio(data(holding("XMPL")));
      expect(byProfile).toEqual({ symbol: "XMPL", isFund: true, values: { beta: 1.2, marketCap: 1e9, price: 100 } });
      expect(s.get).not.toHaveBeenCalled();
    }
  });

  it("skips cash, crypto, currencies, indices and private holdings", async () => {
    const s = stub();
    const rows = await s.service.forPortfolio(
      data(
        holding("CASH", { assetType: "Cash" }),
        holding("BTC-USD", { assetType: "Crypto" }),
        holding("EURUSD=X"),
        holding("^GSPC"),
        holding("XMPL", { isPrivate: true }),
      ),
    );
    expect(rows).toEqual([]);
    expect(s.getProfile).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
  });

  it("asks once per symbol", async () => {
    const s = stub();
    const rows = await s.service.forPortfolio(data(holding("XMPL"), holding("XMPL")));
    expect(rows).toHaveLength(1);
    expect(s.getProfile).toHaveBeenCalledTimes(1);
  });

  it("asks FMP in upper case and keeps the holding's symbol", async () => {
    const s = stub();
    const [row] = await s.service.forPortfolio(data(holding("xmpl")));
    expect(s.getProfile.mock.calls[0][0]).toBe("XMPL");
    expect(row.symbol).toBe("xmpl");
  });

  it("omits a symbol with no data at all", async () => {
    const s = stub({ table: {}, profiles: {} });
    expect(await s.service.forPortfolio(data(holding("XMPL")))).toEqual([]);
  });

  it("treats a rejected call as missing data", async () => {
    const s = stub();
    s.getProfile.mockImplementation(async () => {
      throw new Error("down");
    });
    const [row] = await s.service.forPortfolio(data(holding("XMPL")));
    expect(row.values.beta).toBeUndefined();
    expect(row.values.peRatio).toBe(20);

    const t = stub();
    t.get.mockImplementation(async (path: string, params: { symbol: string }) => {
      if (path === "/ratios-ttm") throw new Error("down");
      return fullTable()[params.symbol]?.[path] ?? null;
    });
    const [other] = await t.service.forPortfolio(data(holding("XMPL")));
    expect(other.values.peRatio).toBeUndefined();
    expect(other.values.beta).toBe(1.2);
    expect(other.values.piotroski).toBe(7);
  });

  it("caches rows per instance", async () => {
    const s = stub();
    await s.service.forPortfolio(data(holding("XMPL")));
    await s.service.forPortfolio(data(holding("XMPL")));
    expect(s.getProfile).toHaveBeenCalledTimes(1);
  });

  it("leaves the analyst score out when no analyst covers the symbol", async () => {
    const table = fullTable();
    table.XMPL["/grades-consensus"] = [{ strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }];
    const [row] = await stub({ table }).service.forPortfolio(data(holding("XMPL")));
    expect(row.values.analystScore).toBeUndefined();
    expect(row.values.analystCount).toBeUndefined();
  });

  it("never logs a symbol", async () => {
    const logStep = spyOn(appLogger, "logStep").mockImplementation(() => {});
    await stub().service.forPortfolio(data(holding("XMPL")));
    expect(JSON.stringify(logStep.mock.calls)).not.toContain("XMPL");
    const lastCall = logStep.mock.calls.at(-1) as unknown[];
    expect(lastCall).toContainEqual({ symbols: 1, found: 1 });
  });
});
