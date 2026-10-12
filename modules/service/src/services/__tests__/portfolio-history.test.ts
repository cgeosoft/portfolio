import { describe, it, expect, afterAll } from "bun:test";
import { relativePerformance } from "portfolio-shared/benchmark";
import type * as portfolioRepo from "../../db/portfolio.repo";
import type * as txRepo from "../../db/transaction.repo";
import type { YahooChartData } from "../yahoo-finance";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";

/** The date `offset` days from today, "YYYY-MM-DD". */
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// Daily closes per symbol, by day offset. Each chart starts about a year ago, like the 1y charts the service asks for.
const charts: Record<string, { currency: string; closes: [number, number][] }> = {
  OLD: { currency: "EUR", closes: [[-364, 150], [-180, 160], [-1, 180]] },
  USQ: { currency: "USD", closes: [[-364, 300], [-1, 360]] },
  // Two exchange calendars: LATE trades first a day after EARLY.
  EARLY: { currency: "EUR", closes: [[-364, 11], [-1, 12]] },
  LATE: { currency: "EUR", closes: [[-363, 25], [-1, 26]] },
};

// EUR base: one USD is 0.5 EUR.
const provider: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async (_base, targets) => new Map(targets.filter((c) => c === "USD").map((c) => [c, 0.5])),
  getChart: async (symbol) => {
    const chart = charts[symbol];
    if (!chart) throw new Error("offline");
    const candles = chart.closes.map(([offset, close]) => ({ timestamp: 0, date: day(offset), open: close, high: close, low: close, close, volume: 0 }));
    return { symbol, currency: chart.currency, regularMarketPrice: candles[candles.length - 1]!.close, candles } satisfies YahooChartData;
  },
};

const portfolio = { id: "history-test", name: "History", baseCurrency: "EUR" } as portfolioRepo.PortfolioRow;

let seq = 0;
function tx(fields: Partial<txRepo.TransactionRow> & { type: string; date: string }): txRepo.TransactionRow {
  seq++;
  return {
    id: `h${seq}`,
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
    ...fields,
  };
}

async function history(service: PortfolioService, transactions: txRepo.TransactionRow[]) {
  const holdings = service.computeHoldingsFromTransactions(transactions);
  const data = await service.buildPortfolioData(portfolio, holdings, transactions, "EUR");
  return { points: data.chartHistory, at: (date: string) => data.chartHistory.find((p) => p.date === date) };
}

describe("history of a holding older than its chart", () => {
  const service = new PortfolioService(provider);
  afterAll(() => service.destroy());

  it("counts the holding at cost until its chart starts", async () => {
    const { points, at } = await history(service, [
      tx({ date: day(-730), type: "CUSTOMER_INBOUND", amount: 1000 }),
      tx({ date: day(-730), type: "BUY", symbol: "OLD", shares: 5, price: 100, amount: -500 }),
      tx({ date: day(-500), type: "CUSTOMER_INBOUND", amount: 100 }),
    ]);
    // The buy moves cash into the holding at cost: the portfolio does not jump.
    expect(at(day(-730))).toMatchObject({ totalValue: 500, totalCost: 500, totalGainLoss: 0, cashBalance: 500, totalPortfolioValue: 1000 });
    expect(at(day(-500))).toMatchObject({ totalValue: 500, totalGainLoss: 0 });
    // From the first close on, the chart prices the holding.
    expect(at(day(-364))?.totalValue).toBe(750);
    expect(at(day(-180))?.totalValue).toBe(800);
    expect(at(day(0))?.totalValue).toBe(900);

    // All time, the holding went from 100 to 180 a share.
    const series = relativePerformance(points, [{ date: day(-800), close: 1 }]);
    expect(series[series.length - 1]?.portfolio).toBeCloseTo(80, 6);
  });

  it("converts the cost from the transaction currency", async () => {
    // Bought in EUR, quoted in USD.
    const { at } = await history(service, [tx({ date: day(-730), type: "BUY", symbol: "USQ", shares: 4, price: 100, amount: -400 })]);
    expect(at(day(-730))?.totalValue).toBe(400);
    expect(at(day(-364))?.totalValue).toBe(600);
  });

  it("keeps the first close for a day inside the chart year before a symbol's first trade", async () => {
    const { at } = await history(service, [
      tx({ date: day(-730), type: "BUY", symbol: "EARLY", shares: 1, price: 10, amount: -10 }),
      tx({ date: day(-730), type: "BUY", symbol: "LATE", shares: 1, price: 20, amount: -20 }),
    ]);
    expect(at(day(-730))?.totalValue).toBe(30);
    // LATE has no close yet on EARLY's first day; it takes its first close, not its cost.
    expect(at(day(-364))?.totalValue).toBe(36);
    expect(at(day(-363))?.totalValue).toBe(36);
  });
});
