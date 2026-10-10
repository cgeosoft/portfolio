import { describe, it, expect, afterAll } from "bun:test";
import type * as portfolioRepo from "../../db/portfolio.repo";
import type * as txRepo from "../../db/transaction.repo";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";

const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

const portfolio = { id: "cash-test", name: "Cash", baseCurrency: "EUR" } as portfolioRepo.PortfolioRow;

let seq = 0;
function tx(fields: Partial<txRepo.TransactionRow> & { type: string; date: string }): txRepo.TransactionRow {
  seq++;
  return {
    id: `t${seq}`,
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

async function build(service: PortfolioService, transactions: txRepo.TransactionRow[]) {
  const holdings = service.computeHoldingsFromTransactions(transactions);
  return service.buildPortfolioData(portfolio, holdings, transactions, "EUR");
}

describe("cash balance follows every cash flow", () => {
  const service = new PortfolioService(offline);
  afterAll(() => service.destroy());

  // Shaped like a Trade Republic export: signed amounts, negative fees and taxes.
  const trExport = [
    tx({ date: "2025-01-01", type: "CUSTOMER_INBOUND", amount: 200 }),
    tx({ date: "2025-01-02", type: "BUY", symbol: "AAA", shares: 1, price: 75, amount: -75, fee: 1 }),
    tx({ date: "2025-01-03", type: "STOCKPERK", symbol: "BBB", amount: 10 }),
    tx({ date: "2025-01-03", type: "BUY", symbol: "BBB", shares: 0.5, price: 20, amount: -10 }),
    tx({ date: "2025-01-04", type: "CARD_TRANSACTION", amount: -0.96 }),
    tx({ date: "2025-01-05", type: "MANUAL_CASH_TRANSFER", amount: 0.12 }),
    tx({ date: "2025-01-06", type: "DIVIDEND", symbol: "AAA", amount: 0.5, tax: 0.1 }),
    tx({ date: "2025-01-07", type: "INTEREST_PAYMENT", amount: 1, tax: -0.2 }),
    tx({ date: "2025-01-08", type: "SELL", symbol: "AAA", shares: -1, price: 80, amount: 80, fee: 1 }),
  ];

  it("counts the stock perk once and keeps its cash credit", async () => {
    const holdings = service.computeHoldingsFromTransactions(trExport);
    const bbb = holdings.find((h) => h.symbol === "BBB");
    expect(bbb?.shares).toBe(0.5);
    expect(bbb?.buyPrice).toBe(20);
  });

  it("adds card payments, manual transfers and tax refunds to cash", async () => {
    const data = await build(service, trExport);
    // 200 - 76 + 10 - 10 - 0.96 + 0.12 + 0.4 + 1.2 + 79
    expect(data.summary.cashBalance).toBe(203.76);
    expect(data.summary.totalTaxes).toBe(-0.1);
    const last = data.chartHistory[data.chartHistory.length - 1];
    expect(last?.cashBalance).toBe(203.76);
  });

  it("shows an overdraft when deposits exist", async () => {
    const data = await build(service, [
      tx({ date: "2025-01-01", type: "CUSTOMER_INBOUND", amount: 10 }),
      tx({ date: "2025-01-02", type: "BUY", symbol: "AAA", shares: 1, price: 15, amount: -15 }),
    ]);
    expect(data.summary.cashBalance).toBe(-5);
  });

  it("clamps cash at zero for a trades-only history", async () => {
    const data = await build(service, [tx({ date: "2025-01-02", type: "BUY", symbol: "AAA", shares: 1, price: 15, amount: 15 })]);
    expect(data.summary.cashBalance).toBe(0);
  });

  it("marks holdings without a quote or an exchange rate", async () => {
    const data = await build(service, [
      tx({ date: "2025-01-02", type: "BUY", symbol: "USX", shares: 1, price: 10, amount: 10, currency: "USD" }),
    ]);
    const h = data.holdings.find((x) => x.symbol === "USX");
    expect(h?.quoteMissing).toBe(true);
    expect(h?.fxMissing).toBe(true);
  });
});
