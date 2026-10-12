import { describe, it, expect, afterAll } from "bun:test";
import { relativePerformance } from "portfolio-shared/benchmark";
import type * as portfolioRepo from "../../db/portfolio.repo";
import type * as txRepo from "../../db/transaction.repo";
import type { YahooChartData, YahooQuote } from "../yahoo-finance";
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
  USB: { currency: "USD", closes: [[-364, 100], [-180, 120], [-1, 150]] },
};

// LSE.L has no chart, only a quote in pence.
const quotes: Record<string, YahooQuote> = {
  "LSE.L": { symbol: "LSE.L", regularMarketPrice: 250, regularMarketChange: 0, regularMarketChangePercent: 0, currency: "GBp", updatedAt: "" },
};

// EUR base: one USD is 0.5 EUR, one GBP 1.2 EUR.
const rates: Record<string, number> = { USD: 0.5, GBP: 1.2, GBp: 0.012 };
const provider: IMarketDataProvider = {
  getQuotes: async (symbols) => new Map(symbols.filter((s) => quotes[s]).map((s) => [s, quotes[s]!])),
  getExchangeRates: async (_base, targets) => new Map(targets.filter((c) => rates[c]).map((c) => [c, rates[c]!])),
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
  return { summary: data.summary, points: data.chartHistory, at: (date: string) => data.chartHistory.find((p) => p.date === date) };
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

describe("history cost in the base currency", () => {
  const service = new PortfolioService(provider);
  afterAll(() => service.destroy());

  it("converts the cost of trades in another currency", async () => {
    const { summary, points, at } = await history(service, [
      tx({ date: day(-364), type: "BUY", symbol: "USB", shares: 1, price: 100, amount: -100, currency: "USD" }),
      tx({ date: day(-180), type: "BUY", symbol: "USB", shares: 1, price: 120, amount: -120, currency: "USD" }),
    ]);
    expect(at(day(-364))).toMatchObject({ totalValue: 50, totalCost: 50, totalGainLoss: 0 });
    expect(at(day(-180))).toMatchObject({ totalValue: 120, totalCost: 110, totalGainLoss: 10 });
    expect(at(day(0))).toMatchObject({ totalValue: 150, totalCost: 110, totalGainLoss: 40 });
    // The summary and the last point agree.
    expect(summary).toMatchObject({ totalValue: 150, totalCost: 110 });

    // The price went from 100 to 150 USD; the second buy is a flow, not a gain.
    const series = relativePerformance(points, [{ date: day(-800), close: 1 }]);
    expect(series[series.length - 1]?.portfolio).toBeCloseTo(50, 6);
  });

  it("values a private holding without a price at its converted cost", async () => {
    const { summary, at } = await history(service, [
      tx({ date: day(-200), type: "BUY", symbol: "PRIVATE_FUND", shares: 2, price: 50, amount: -100, currency: "USD" }),
    ]);
    expect(at(day(-200))).toMatchObject({ totalValue: 50, totalCost: 50, totalGainLoss: 0 });
    expect(at(day(0))).toMatchObject({ totalValue: 50, totalCost: 50, totalGainLoss: 0 });
    expect(summary).toMatchObject({ totalValue: 50, totalCost: 50 });
  });

  it("values a holding without a chart at its cost in the trade currency, not the quote currency", async () => {
    // Bought in GBP, quoted in pence.
    const { at } = await history(service, [
      tx({ date: day(-100), type: "BUY", symbol: "LSE.L", shares: 10, price: 2, amount: -20, currency: "GBP" }),
    ]);
    expect(at(day(-100))).toMatchObject({ totalValue: 24, totalCost: 24, totalGainLoss: 0 });
  });

  it("converts the cost of a closed position while it was held", async () => {
    const { at } = await history(service, [
      tx({ date: day(-300), type: "BUY", symbol: "CLOSED", shares: 1, price: 100, amount: -100, currency: "USD" }),
      tx({ date: day(-250), type: "SELL", symbol: "CLOSED", shares: 1, price: 110, amount: 110, currency: "USD" }),
    ]);
    expect(at(day(-300))).toMatchObject({ totalValue: 50, totalCost: 50, totalGainLoss: 0 });
    expect(at(day(-250))).toMatchObject({ totalValue: 0, totalCost: 0, cashBalance: 5 });
  });

  it("leaves a portfolio traded only in the base currency unchanged", async () => {
    const { summary, points, at } = await history(service, [
      tx({ date: day(-730), type: "CUSTOMER_INBOUND", amount: 2000 }),
      tx({ date: day(-730), type: "BUY", symbol: "OLD", shares: 5, price: 100, amount: -500 }),
      tx({ date: day(-200), type: "BUY", symbol: "EARLY", shares: 10, price: 11.5 }),
      tx({ date: day(-180), type: "SELL", symbol: "OLD", shares: 2, price: 160, amount: 320 }),
      // Private without a manual price, a symbol whose chart fails, a closed position.
      tx({ date: day(-100), type: "BUY", symbol: "PRIVATE_X", shares: 3, price: 40, amount: -120 }),
      tx({ date: day(-90), type: "BUY", symbol: "GONE", shares: 4, price: 25, amount: -100 }),
      tx({ date: day(-60), type: "BUY", symbol: "SHORT", shares: 2, price: 30, amount: -60 }),
      tx({ date: day(-30), type: "SELL", symbol: "SHORT", shares: 2, price: 35, amount: 70 }),
    ]);
    expect(at(day(-730))).toMatchObject({ totalValue: 500, totalCost: 500, cashBalance: 1500 });
    expect(at(day(-364))).toMatchObject({ totalValue: 750, totalCost: 500 });
    expect(at(day(-200))).toMatchObject({ totalValue: 860, totalCost: 615 });
    expect(at(day(-180))).toMatchObject({ totalValue: 590, totalCost: 415 });
    expect(at(day(-100))).toMatchObject({ totalValue: 710, totalCost: 535 });
    expect(at(day(-90))).toMatchObject({ totalValue: 810, totalCost: 635 });
    expect(at(day(-60))).toMatchObject({ totalValue: 870, totalCost: 695 });
    expect(at(day(-30))).toMatchObject({ totalValue: 810, totalCost: 635 });
    expect(at(day(0))).toMatchObject({ totalValue: 880, totalCost: 635, totalGainLoss: 245, cashBalance: 1495, totalPortfolioValue: 2375 });
    expect(summary).toMatchObject({ totalValue: 880, totalCost: 635 });
    expect(points.length).toBe(10);
  });
});

describe("summary cost in the base currency", () => {
  const service = new PortfolioService(provider);
  afterAll(() => service.destroy());

  const last = (points: { totalCost: number }[]) => points[points.length - 1]!;

  it("converts GBP trades on a pence quote at the GBP rate", async () => {
    const { summary, points } = await history(service, [
      tx({ date: day(-100), type: "BUY", symbol: "LSE.L", shares: 10, price: 2, amount: -20, currency: "GBP" }),
    ]);
    // 20 GBP is 24 EUR, not 20 pence.
    expect(summary.totalCost).toBe(24);
    expect(last(points).totalCost).toBe(24);
    // 250 pence a share is 3 EUR.
    expect(summary).toMatchObject({ totalValue: 30, totalGainLossDollar: 6 });
  });

  it("converts USD trades on a pence quote at the USD rate", async () => {
    const { summary, points } = await history(service, [
      tx({ date: day(-100), type: "BUY", symbol: "LSE.L", shares: 10, price: 4, amount: -40, currency: "USD" }),
    ]);
    expect(summary.totalCost).toBe(20);
    expect(last(points).totalCost).toBe(20);
  });

  it("converts each trade of a symbol traded in two currencies at its own rate", async () => {
    const { summary, points } = await history(service, [
      tx({ date: day(-364), type: "BUY", symbol: "USB", shares: 1, price: 100, amount: -100, currency: "USD" }),
      tx({ date: day(-180), type: "BUY", symbol: "USB", shares: 1, price: 120, amount: -120, currency: "EUR" }),
    ]);
    // 100 USD is 50 EUR; the EUR trade, the last one, does not set the rate for both.
    expect(summary.totalCost).toBe(170);
    expect(last(points).totalCost).toBe(170);
    expect(summary).toMatchObject({ totalValue: 150, totalGainLossDollar: -20 });
  });

  it("keeps the converted cost of the shares left after a sell", async () => {
    const { summary, points } = await history(service, [
      tx({ date: day(-364), type: "BUY", symbol: "USB", shares: 2, price: 100, amount: -200, currency: "USD" }),
      tx({ date: day(-200), type: "BUY", symbol: "USB", shares: 2, price: 60, amount: -120, currency: "EUR" }),
      tx({ date: day(-180), type: "SELL", symbol: "USB", shares: 2, price: 120, amount: 240, currency: "USD" }),
    ]);
    // 100 EUR + 120 EUR for 4 shares; half of it stays.
    expect(summary.totalCost).toBe(110);
    expect(last(points).totalCost).toBe(110);
  });

  it("agrees with the history for a base-currency portfolio on foreign quotes", async () => {
    const { summary, points } = await history(service, [
      tx({ date: day(-730), type: "BUY", symbol: "USQ", shares: 4, price: 100, amount: -400 }),
      tx({ date: day(-100), type: "BUY", symbol: "LSE.L", shares: 3, price: 10, amount: -30 }),
      tx({ date: day(-90), type: "BUY", symbol: "OLD", shares: 3, price: 100 / 3, amount: -100 }),
    ]);
    expect(summary.totalCost).toBe(530);
    expect(last(points).totalCost).toBe(530);
  });
});
