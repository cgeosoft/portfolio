/** Portfolio P&L math: average cost, fees, dividends, splits, oversells, multi-currency and indicators. */
import { describe, it, expect, afterAll, mock } from "bun:test";
import type * as portfolioRepo from "../../db/portfolio.repo";
import type * as txRepo from "../../db/transaction.repo";
import type { YahooChartData, YahooQuote } from "../yahoo-finance";
import { PortfolioService, portfolioColor, type IMarketDataProvider } from "../portfolio";

const portfolio = { id: "pnl-test", name: "PnL", baseCurrency: "EUR" } as portfolioRepo.PortfolioRow;

let seq = 0;
function tx(f: Partial<txRepo.TransactionRow> & { type: string; date: string }): txRepo.TransactionRow {
  seq++;
  return {
    id: `pnl${seq}`,
    portfolioId: portfolio.id,
    datetime: null,
    assetClass: null,
    name: null,
    symbol: "",
    isin: null,
    shares: null,
    price: null,
    amount: null,
    fee: null,
    tax: null,
    currency: "EUR",
    createdAt: "",
    updatedAt: "",
    ...f,
  };
}

const q = (symbol: string, price: number, currency: string, previousClose?: number): YahooQuote =>
  ({ symbol, regularMarketPrice: price, previousClose, regularMarketChange: 0, regularMarketChangePercent: 0, currency, updatedAt: "" });
const quotes: Record<string, YahooQuote> = {
  PNLX: q("PNLX", 25, "EUR", 24),
  PNLU: q("PNLU", 20, "USD", 20),
  PNLD: q("PNLD", 55, "EUR", 50),
  PNLS: q("PNLS", 60, "EUR"),
};
const rates: Record<string, number> = { USD: 0.5 };
const getQuotesMock = mock(async (s: string[]) => new Map(s.filter((x) => quotes[x]).map((x) => [x, quotes[x]!])));
const provider: IMarketDataProvider = {
  getQuotes: getQuotesMock,
  getExchangeRates: async (_b, t) => new Map(t.filter((c) => rates[c]).map((c) => [c, rates[c]!])),
  getChart: async () => {
    throw new Error("offline");
  },
};

const service = new PortfolioService(provider);
afterAll(() => service.destroy());

async function build(txs: txRepo.TransactionRow[]) {
  const holdings = service.computeHoldingsFromTransactions(txs);
  return { holdings, data: await service.buildPortfolioData(portfolio, holdings, txs, "EUR") };
}

describe("average cost after partial sells", () => {
  const txs = [
    tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100, fee: 1 }),
    tx({ date: "2025-01-03", type: "BUY", symbol: "PNLX", shares: 10, price: 20, amount: -200, fee: 1 }),
    tx({ date: "2025-01-04", type: "SELL", symbol: "PNLX", shares: 5, price: 30, amount: 150, fee: 1, tax: 2 }),
  ];

  it("keeps the average cost of the remaining shares", async () => {
    const { holdings } = await build(txs);
    expect(holdings).toEqual([
      { symbol: "PNLX", name: "PNLX", shares: 15, buyPrice: 15, assetType: "Stock", isPrivate: false, currency: "EUR" },
    ]);
  });

  it("leaves fees out of the cost basis and realized P&L and taxes out of the total gain", async () => {
    const { data } = await build(txs);
    expect(data.summary).toMatchObject({
      totalValue: 375,
      totalCost: 225,
      totalGainLossDollar: 150,
      totalGainLossPercent: 66.67,
      dayGainLossDollar: 15,
      dayGainLossPercent: 4.17,
      realizedPnL: 75,
      totalFees: 3,
      totalTaxes: 2,
      totalGainSinceStartDollar: 222,
      totalGainSinceStartPercent: 98.67,
      cashBalance: 0,
      totalPortfolioValue: 375,
      stockWeightPercent: 100,
      cashWeightPercent: 0,
    });
  });

  it("fills the holding's day change and the best performer", async () => {
    const { data } = await build(txs);
    const h = data.holdings.find((x) => x.symbol === "PNLX");
    expect(h).toMatchObject({ currentPrice: 25, previousClose: 24, dayChangeDollar: 15, dayChangePercent: 4.17, weightPercent: 100 });
    expect(data.summary.bestPerformer).toEqual({ symbol: "PNLX", changePercent: 4.17 } as any);
    expect(data.summary.worstPerformer).toBeUndefined();
    expect(data.holdings.some((x) => x.symbol === "CASH")).toBe(false);
  });

  it("drops the holding when every share is sold", async () => {
    const { holdings, data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100 }),
      tx({ date: "2025-01-03", type: "SELL", symbol: "PNLX", shares: 10, amount: 120 }),
    ]);
    expect(holdings).toEqual([]);
    expect(data.summary.realizedPnL).toBe(20);
  });
});

describe("fees, dividends and withholding with a deposit", () => {
  const txs = [
    tx({ date: "2025-01-01", type: "DEPOSIT", amount: 1000 }),
    tx({ date: "2025-01-02", type: "BUY", symbol: "PNLD", shares: 10, price: 50, amount: -500, fee: 2 }),
    tx({ date: "2025-01-03", type: "DIVIDEND", symbol: "PNLD", amount: 20, tax: 3 }),
    tx({ date: "2025-01-04", type: "INTEREST_PAYMENT", amount: 5, tax: 1 }),
    tx({ date: "2025-01-05", type: "WITHDRAWAL", amount: -100 }),
  ];

  it("sums cash flows, income, taxes and fees", async () => {
    const { data } = await build(txs);
    expect(data.summary).toMatchObject({
      cashBalance: 419,
      totalCashInjected: 1000,
      totalCashWithdrawn: 100,
      totalDividends: 20,
      totalInterest: 5,
      totalTaxes: 4,
      totalFees: 2,
      totalValue: 550,
      totalCost: 500,
      totalGainLossDollar: 50,
      dayGainLossDollar: 50,
      dayGainLossPercent: 10,
      totalGainSinceStartDollar: 73,
      totalGainSinceStartPercent: 14.6,
      totalPortfolioValue: 969,
      stockWeightPercent: 56.76,
      cashWeightPercent: 43.24,
    });
  });

  it("appends a CASH holding after the stocks", async () => {
    const { data } = await build(txs);
    expect(data.holdings.map((h) => h.symbol)).toEqual(["PNLD", "CASH"]);
    expect(data.holdings[0]?.weightPercent).toBe(56.76);
    expect(data.holdings[1]).toMatchObject({ shares: 419, currentValue: 419, weightPercent: 43.24, assetType: "Cash" });
  });

  it("treats a negative dividend tax as a refund", async () => {
    const { data } = await build([
      tx({ date: "2025-01-01", type: "DEPOSIT", amount: 100 }),
      tx({ date: "2025-01-02", type: "DIVIDEND", symbol: "PNLD", amount: 10, tax: -2 }),
    ]);
    expect(data.summary.cashBalance).toBe(112);
    expect(data.summary.totalTaxes).toBe(-2);
  });
});

describe("splits", () => {
  it("counts a split recorded as a no-cost BUY", async () => {
    const { holdings, data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLS", shares: 10, price: 100, amount: -1000 }),
      tx({ date: "2025-02-02", type: "BUY", symbol: "PNLS", shares: 10, price: 0, amount: 0 }),
    ]);
    expect(holdings[0]).toMatchObject({ shares: 20, buyPrice: 50 });
    expect(data.summary).toMatchObject({ totalCost: 1000, totalValue: 1200, totalGainLossDollar: 200 });
  });

  it("ignores a SPLIT transaction", async () => {
    const { holdings, data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLS", shares: 10, price: 100, amount: -1000 }),
      tx({ date: "2025-02-02", type: "SPLIT", symbol: "PNLS", shares: 10 }),
    ]);
    expect(holdings[0]).toMatchObject({ shares: 10, buyPrice: 100 });
    expect(data.summary).toMatchObject({ totalValue: 600, totalGainLossDollar: -400, cashBalance: 0 });
  });

  it("adds cost from a cost-only BUY and no cost from a shares-only BUY", async () => {
    const { holdings, data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLS", shares: 0, amount: -500 }),
      tx({ date: "2025-01-03", type: "BUY", symbol: "PNLS", shares: 10, price: 50, amount: 0 }),
    ]);
    expect(holdings[0]).toMatchObject({ shares: 10, buyPrice: 50 });
    expect(data.summary.totalCost).toBe(500);
  });

  it("uses price x shares when a BUY has no amount", async () => {
    const { holdings, data } = await build([tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 4, price: 10 })]);
    expect(holdings[0]?.buyPrice).toBe(10);
    expect(data.summary.totalCost).toBe(40);
    expect(data.summary.totalValue).toBe(100);
  });
});

describe("sells beyond the position", () => {
  it("never yields a negative holding", async () => {
    const { holdings, data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100 }),
      tx({ date: "2025-01-03", type: "SELL", symbol: "PNLX", shares: 15, price: 12, amount: 180 }),
    ]);
    expect(holdings).toEqual([]);
    expect(data.summary).toMatchObject({ totalValue: 0, cashBalance: 80, totalPortfolioValue: 80 });
    const cash = data.holdings.filter((h) => h.symbol === "CASH");
    expect(cash.length).toBe(1);
    expect(cash[0]?.weightPercent).toBe(100);
  });

  // B6: realized P&L counts only the held shares; the full proceeds still reach cash.
  it("pro-rates realized P&L to the held shares and warns about the oversell", async () => {
    const { data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100 }),
      tx({ date: "2025-01-03", type: "SELL", symbol: "PNLX", shares: 15, price: 12, amount: 180 }),
    ]);
    // 180 * 10/15 - 100
    expect(data.summary.realizedPnL).toBe(20);
    expect(data.summary.cashBalance).toBe(80);
    expect(data.warnings).toEqual([{ kind: "oversell", symbol: "PNLX", date: "2025-01-03" }]);
  });

  it("keeps the lifetime gain percent at 0 without cost or deposits", async () => {
    const { data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100 }),
      tx({ date: "2025-01-03", type: "SELL", symbol: "PNLX", shares: 15, price: 12, amount: 180 }),
    ]);
    expect(data.summary.totalGainSinceStartDollar).toBe(20);
    expect(data.summary.totalGainSinceStartPercent).toBe(0);
  });

  it("measures the lifetime gain percent against deposits after an oversell", async () => {
    const { data } = await build([
      tx({ date: "2025-01-01", type: "DEPOSIT", amount: 100 }),
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100 }),
      tx({ date: "2025-01-03", type: "SELL", symbol: "PNLX", shares: 15, price: 12, amount: 180 }),
    ]);
    expect(data.summary).toMatchObject({ realizedPnL: 20, cashBalance: 180, totalGainSinceStartPercent: 20 });
  });

  it("sends no warnings when no sell exceeds the holding", async () => {
    const { data } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNLX", shares: 10, price: 10, amount: -100 }),
      tx({ date: "2025-01-03", type: "SELL", symbol: "PNLX", shares: 10, price: 12, amount: 120 }),
    ]);
    expect(data.summary.realizedPnL).toBe(20);
    expect(data.warnings).toBeUndefined();
  });

  it("ignores a SELL without any BUY for realized P&L", async () => {
    const { holdings, data } = await build([tx({ date: "2025-01-02", type: "SELL", symbol: "PNLX", shares: 5, amount: 60 })]);
    expect(holdings).toEqual([]);
    expect(data.summary.realizedPnL).toBe(0);
    expect(data.summary.cashBalance).toBe(60);
    expect(data.warnings).toEqual([{ kind: "oversell", symbol: "PNLX", date: "2025-01-02" }]);
  });
});

describe("multi-currency realized P&L (B1)", () => {
  const txs = [
    tx({ date: "2025-01-01", type: "DEPOSIT", amount: 1000 }),
    tx({ date: "2025-01-02", type: "BUY", symbol: "PNLU", shares: 10, price: 10, amount: -100, currency: "USD", fee: 2 }),
    tx({ date: "2025-01-03", type: "SELL", symbol: "PNLU", shares: 5, price: 16, amount: 80, currency: "USD" }),
    tx({ date: "2025-01-04", type: "DIVIDEND", symbol: "PNLU", amount: 10, tax: 1.5, currency: "USD" }),
  ];

  it("converts the holding and the cash to the base currency", async () => {
    const { data } = await build(txs);
    const h = data.holdings.find((x) => x.symbol === "PNLU");
    expect(h).toMatchObject({ shares: 5, buyPrice: 10, currentPrice: 10, totalCost: 25, currentValue: 50 });
    expect(data.summary).toMatchObject({ cashBalance: 993.25, totalCashInjected: 1000, stockWeightPercent: 4.79, cashWeightPercent: 95.21 });
  });

  // Suspected bug: portfolio.ts:717 realized P&L, income, fees and taxes are summed in trade currency, never converted to base.
  it.failing("converts realized P&L, dividends, fees and taxes to the base currency", async () => {
    const { data } = await build(txs);
    expect(data.summary).toMatchObject({
      realizedPnL: 15,
      totalDividends: 5,
      totalFees: 1,
      totalTaxes: 0.75,
      totalGainSinceStartDollar: 44,
      totalGainSinceStartPercent: 176,
    });
  });
});

describe("private holdings", () => {
  it("values a private market buy at cost without asking for a quote", async () => {
    getQuotesMock.mockClear();
    const { holdings, data } = await build([
      tx({ date: "2025-01-02", type: "PRIVATE_MARKET_BUY", symbol: "pnl_pe", shares: 2, price: 1000, amount: -2000 }),
    ]);
    expect(holdings[0]).toMatchObject({ symbol: "PNL_PE", assetType: "Other", isPrivate: true });
    expect(data.summary).toMatchObject({ totalValue: 2000, totalCost: 2000, otherWeightPercent: 100, dayGainLossDollar: 0 });
    for (const call of getQuotesMock.mock.calls) expect(call[0]).not.toContain("PNL_PE");
  });

  it("treats a PRIVATE_EQUITY asset class as private", async () => {
    const { holdings } = await build([
      tx({ date: "2025-01-02", type: "BUY", symbol: "PNL_PE2", assetClass: "PRIVATE_EQUITY", shares: 1, price: 100, amount: -100 }),
    ]);
    expect(holdings[0]).toMatchObject({ assetType: "Other", isPrivate: true });
  });
});

describe("indicators", () => {
  const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
  const series: Record<string, number[]> = {
    PNLUP: Array.from({ length: 60 }, (_, i) => i + 1),
    PNLALT: Array.from({ length: 15 }, (_, i) => (i % 2 ? 11 : 10)),
    PNLFLAT: Array.from({ length: 20 }, () => 5),
    PNLSHORT: Array.from({ length: 14 }, (_, i) => i + 1),
  };
  const chartProvider: IMarketDataProvider = {
    getQuotes: async () => new Map(),
    getExchangeRates: async (_b, t) => new Map(t.filter((c) => rates[c]).map((c) => [c, rates[c]!])),
    getChart: async (symbol: string): Promise<YahooChartData> => {
      const closes = series[symbol] ?? [];
      const n = closes.length;
      return {
        symbol,
        currency: symbol === "PNLUP" ? "USD" : "EUR",
        regularMarketPrice: closes[n - 1] ?? 0,
        fiftyTwoWeekHigh: 70,
        candles: closes.map((c, i) => {
          const date = day(i - n);
          return { timestamp: Date.parse(`${date}T00:00:00Z`), date, open: c, high: c, low: c, close: c, volume: 0 };
        }),
      };
    },
  };
  const chartService = new PortfolioService(chartProvider);
  afterAll(() => chartService.destroy());

  async function holdingsFor() {
    const txs = Object.keys(series).map((s) =>
      tx({ date: day(-200), type: "BUY", symbol: s, shares: 1, price: 1, amount: -1, currency: s === "PNLUP" ? "USD" : "EUR" }),
    );
    const h = chartService.computeHoldingsFromTransactions(txs);
    const data = await chartService.buildPortfolioData(portfolio, h, txs, "EUR");
    return (s: string) => data.holdings.find((x) => x.symbol === s) as Record<string, unknown> | undefined;
  }

  it("computes RSI and SMA50 for a rising USD series in base currency", async () => {
    const get = await holdingsFor();
    expect(get("PNLUP")).toMatchObject({ rsi: 100, sma50: 17.75, nativePrice: 60, currentPrice: 30, previousClose: 29.5, fiftyTwoWeekHigh: 35, fxRate: 2 });
    expect(get("PNLUP")?.sma200).toBeUndefined();
  });

  it("gives RSI 50 for an alternating series and no SMA50 under 50 closes", async () => {
    const get = await holdingsFor();
    expect(get("PNLALT")).toMatchObject({ rsi: 50, currentPrice: 10, previousClose: 11 });
    expect(get("PNLALT")?.sma50).toBeUndefined();
  });

  it("has no RSI with only 14 closes", async () => {
    const get = await holdingsFor();
    expect(get("PNLSHORT")?.rsi).toBeUndefined();
    // A flat series reports RSI 100 today (avgLoss 0); 50 would be more natural. Documented, not asserted.
  });
});

describe("empty portfolio", () => {
  it("returns a zero summary without asking any provider", async () => {
    const p = {
      getQuotes: mock(async () => new Map()),
      getExchangeRates: mock(async () => new Map()),
      getChart: mock(async () => {
        throw new Error("offline");
      }),
    };
    const s = new PortfolioService(p as unknown as IMarketDataProvider);
    try {
      const data = await s.buildPortfolioData(portfolio, [], [], "USD");
      expect(data.summary.baseCurrency).toBe("USD");
      for (const [k, v] of Object.entries(data.summary)) {
        if (typeof v === "number") expect([k, v]).toEqual([k, 0]);
      }
      expect(data.holdings).toEqual([]);
      expect(data.chartHistory).toEqual([]);
      expect(data.individualCharts).toEqual({});
      expect(p.getQuotes).toHaveBeenCalledTimes(0);
      expect(p.getExchangeRates).toHaveBeenCalledTimes(0);
      expect(p.getChart).toHaveBeenCalledTimes(0);
    } finally {
      s.destroy();
    }
  });
});

describe("portfolioColor", () => {
  it("accepts empty values and #rrggbb only", () => {
    expect(portfolioColor(undefined)).toBeUndefined();
    expect(portfolioColor(null)).toBeNull();
    expect(portfolioColor("")).toBeNull();
    expect(portfolioColor("#ABCDEF")).toBe("#abcdef");
    for (const bad of ["red", "#abc", 123]) {
      expect(() => portfolioColor(bad as any)).toThrow("Portfolio colour must be #rrggbb");
    }
  });
});
