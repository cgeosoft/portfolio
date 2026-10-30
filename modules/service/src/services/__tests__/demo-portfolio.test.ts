/** Demo portfolio: generated transactions, prices from quotes, consistent sells, and repeated creation. */
import { describe, it, expect, afterAll } from "bun:test";
import { generateDemoTransactions, DEMO_ASSETS } from "../demo-portfolio";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";
import * as txRepo from "../../db/transaction.repo";

const BASE_DATE = new Date("2026-06-30T10:00:00Z");

const emptyProvider: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

const service = new PortfolioService(emptyProvider);
const created: string[] = [];

afterAll(() => {
  for (const id of created) service.deletePortfolio(id);
  service.destroy();
});

describe("generateDemoTransactions", () => {
  const rows = generateDemoTransactions("zq-demo", "EUR", undefined, BASE_DATE);

  it("generates 100 sorted rows with stable ids", () => {
    expect(rows.length).toBe(100);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
    expect(counts).toEqual({ CUSTOMER_INBOUND: 6, BUY: 64, SELL: 10, DIVIDEND: 20 });
    expect(new Set(rows.map((r) => r.id)).size).toBe(100);
    const ids = rows.map((r) => r.id).sort();
    expect(ids[0]).toBe("zq-demo_demo_tx_001");
    expect(ids[99]).toBe("zq-demo_demo_tx_100");
    const keys = rows.map((r) => `${r.date}|${r.datetime ?? ""}`);
    expect(keys).toEqual([...keys].sort());
    expect(rows[0]).toMatchObject({ date: "2025-07-01", datetime: "2025-07-01T14:30:00.000Z", id: "zq-demo_demo_tx_001", symbol: "CASH", amount: 60000 });
    expect(rows[99]!.date).toBe("2026-06-22");
  });

  it("prices buys, sells and dividends from the reference prices", () => {
    const aapl = rows.filter((r) => r.symbol === "AAPL");
    expect(aapl.find((r) => r.type === "BUY")).toMatchObject({
      date: "2025-07-10",
      price: 252,
      shares: 7,
      amount: 1764,
      fee: 1.5,
      tax: 0,
      currency: "EUR",
      assetClass: "STOCK",
      id: "zq-demo_demo_tx_007",
    });
    expect(aapl.find((r) => r.type === "SELL")).toMatchObject({ date: "2026-02-10", shares: 3, price: 268.8, amount: 806.4, fee: 2, tax: 1.61 });
    expect(rows.find((r) => r.type === "DIVIDEND")).toMatchObject({
      symbol: "AAPL",
      date: "2025-09-28",
      amount: 24.5,
      tax: 3.67,
      shares: 0,
      price: 0,
      name: "Apple Inc. Quarterly Dividend",
    });
  });

  it("uses positive quotes in the base currency and ignores zero quotes", () => {
    const priced = generateDemoTransactions("zq-demo", "USD", new Map([["AAPL", 100], ["MSFT", 0]]), BASE_DATE);
    expect(priced.find((r) => r.symbol === "AAPL" && r.type === "BUY")).toMatchObject({ price: 90, amount: 630, currency: "USD" });
    expect(priced.find((r) => r.symbol === "MSFT" && r.type === "BUY")).toMatchObject({ price: 382.7, amount: 1530.8 });
  });

  it("never sells more than it holds and ends with 11 holdings", () => {
    const held = new Map<string, number>();
    for (const r of rows) {
      if (r.type === "BUY") held.set(r.symbol, (held.get(r.symbol) ?? 0) + (r.shares ?? 0));
      if (r.type === "SELL") {
        const left = (held.get(r.symbol) ?? 0) - (r.shares ?? 0);
        expect(left).toBeGreaterThan(0);
        held.set(r.symbol, left);
      }
    }
    const txs = rows.map((r) => ({ isin: null, createdAt: "", updatedAt: "", ...r }) as txRepo.TransactionRow);
    const holdings = service.computeHoldingsFromTransactions(txs);
    expect(holdings.length).toBe(11);
    for (const asset of DEMO_ASSETS) {
      const h = holdings.find((x) => x.symbol === asset.symbol);
      expect(h).toBeDefined();
      expect(h!.shares).toBeGreaterThan(0);
    }
  });

  it("has target weights that sum to one", () => {
    expect(DEMO_ASSETS.reduce((s, a) => s + a.targetWeight, 0)).toBeCloseTo(1, 9);
  });
});

describe("createDemoPortfolio", () => {
  it("creates a full demo portfolio every time", async () => {
    const counts: number[] = [];
    for (let i = 0; i < 2; i++) {
      const res = (await service.createDemoPortfolio("EUR")) as unknown as { id?: string; portfolio?: { id: string } };
      const id = res.id ?? res.portfolio!.id;
      created.push(id);
      counts.push(txRepo.findByPortfolio(id).length);
    }
    expect(counts).toEqual([100, 100]);
  });
});
