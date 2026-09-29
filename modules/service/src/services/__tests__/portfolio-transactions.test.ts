import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getDatabase } from "../../db/database";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as txRepo from "../../db/transaction.repo";
import * as marketCache from "../../db/market-cache.repo";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";

const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

describe("transactions stay inside their portfolio", () => {
  let service: PortfolioService;
  let a: portfolioRepo.PortfolioRow;
  let b: portfolioRepo.PortfolioRow;

  beforeAll(() => {
    getDatabase();
    service = new PortfolioService(offline);
    a = portfolioRepo.create({ name: "A", baseCurrency: "EUR" });
    b = portfolioRepo.create({ name: "B", baseCurrency: "EUR" });
  });

  afterAll(() => {
    service.destroy();
    portfolioRepo.deleteById(a.id);
    portfolioRepo.deleteById(b.id);
  });

  it("refuses to delete a transaction through another portfolio", async () => {
    const tx = txRepo.create({ portfolioId: a.id, date: "2026-01-02", type: "BUY", symbol: "TEST", shares: 1, price: 10, amount: 10 });
    const res = await service.manageTransactions(b.id, { action: "delete", transactionId: tx.id });
    expect(res.success).toBe(false);
    expect(txRepo.findById(tx.id)).not.toBeNull();
    const ok = await service.manageTransactions(a.id, { action: "delete", transactionId: tx.id });
    expect(ok.success).toBe(true);
    expect(txRepo.findById(tx.id)).toBeNull();
  });

  it("bulkCreate returns the inserted rows and bulkUpdate applies every change", () => {
    const rows = txRepo.bulkCreate([
      { portfolioId: a.id, date: "2026-01-03", type: "BUY", symbol: "ONE", shares: 1, price: 1, amount: 1 },
      { portfolioId: a.id, date: "2026-01-04", type: "BUY", symbol: "TWO", shares: 2, price: 2, amount: 4 },
    ]);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.symbol)).toEqual(["ONE", "TWO"]);
    expect(rows[0]!.createdAt).toBeTruthy();
    const changed = txRepo.bulkUpdate(rows.map((r) => ({ id: r.id, data: { price: 9 } })));
    expect(changed).toBe(2);
    expect(txRepo.findById(rows[0]!.id)?.price).toBe(9);
    expect(txRepo.bulkUpdate([])).toBe(0);
  });

  it("clearing a portfolio's cache drops its disk entries in every currency", () => {
    marketCache.set(`portfolio:${a.id}_EUR`, { ok: 1 }, 60_000);
    marketCache.set(`portfolio:${a.id}_USD`, { ok: 1 }, 60_000);
    marketCache.set(`portfolio:${b.id}_EUR`, { ok: 1 }, 60_000);
    service.clearPortfolioCache(a.id);
    expect(marketCache.get(`portfolio:${a.id}_EUR`)).toBeNull();
    expect(marketCache.get(`portfolio:${a.id}_USD`)).toBeNull();
    expect(marketCache.get(`portfolio:${b.id}_EUR`)).not.toBeNull();
    service.clearPortfolioCache();
    expect(marketCache.get(`portfolio:${b.id}_EUR`)).toBeNull();
  });

  it("deleteByPrefix treats the prefix literally", () => {
    marketCache.set("quote:A_B", { ok: 1 }, 60_000);
    marketCache.set("quote:AXB", { ok: 1 }, 60_000);
    expect(marketCache.deleteByPrefix("quote:A_")).toBe(1);
    expect(marketCache.get("quote:AXB")).not.toBeNull();
    marketCache.deleteKey("quote:AXB");
  });
});
