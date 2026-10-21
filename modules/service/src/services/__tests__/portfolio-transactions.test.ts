import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getDatabase } from "../../db/database";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as txRepo from "../../db/transaction.repo";
import * as marketCache from "../../db/market-cache.repo";
import { loadConfig, updateConfig } from "../../config";
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

  it("imports the same broker ids into two portfolios and dedupes a re-import", async () => {
    const brokerId = `broker-${crypto.randomUUID()}`;
    const rows = [{ id: brokerId, date: "2026-01-05", type: "BUY", symbol: "DUP", shares: 1, price: 5, amount: 5, currency: "EUR" }];
    const first = await service.manageTransactions(a.id, { action: "import", transactions: rows });
    expect(first.newTransactionsCount).toBe(1);
    const second = await service.manageTransactions(b.id, { action: "import", transactions: rows });
    expect(second.success).toBe(true);
    expect(second.newTransactionsCount).toBe(1);
    const again = await service.manageTransactions(b.id, { action: "import", transactions: rows });
    expect(again.newTransactionsCount).toBe(0);
    expect(again.unchangedTransactionsCount).toBe(1);
    expect(txRepo.findById(brokerId)?.portfolioId).toBe(a.id);
    expect(txRepo.findByPortfolio(b.id).filter((t) => t.symbol === "DUP").length).toBe(1);
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

  it("drops the transaction and snapshot indexes no query uses", () => {
    const names = (getDatabase().query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("idx_transactions_portfolio_order");
    for (const dropped of ["idx_transactions_portfolio", "idx_transactions_date", "idx_transactions_symbol", "idx_snapshots_portfolio"]) {
      expect(names).not.toContain(dropped);
    }
  });

  it("an update keeps the fields it leaves out and counts only stored rows", () => {
    const [row] = txRepo.bulkCreate([
      { portfolioId: a.id, date: "2026-01-05", type: "BUY", symbol: "KEEP", name: "Keep Co", shares: 3, price: 2, amount: 6, fee: 1 },
    ]);
    const changed = txRepo.bulkUpdate([
      { id: row!.id, data: { price: 4, name: undefined, fee: null } },
      { id: "missing-transaction", data: { price: 1 } },
    ]);
    expect(changed).toBe(1);
    const stored = txRepo.findById(row!.id)!;
    expect(stored.price).toBe(4);
    expect(stored.name).toBe("Keep Co");
    expect(stored.fee).toBe(1);
    expect(stored.shares).toBe(3);
    expect(txRepo.update("missing-transaction", { price: 1 })).toBeNull();
    expect(txRepo.update(row!.id, { amount: 0 })?.amount).toBe(0);
  });

  it("saveImport writes the new and the changed rows together, or none of them", () => {
    txRepo.bulkCreate([{ id: "import-update", portfolioId: a.id, date: "2026-01-06", type: "BUY", symbol: "IMP", shares: 1, price: 5, amount: 5 }]);
    const creates = [{ id: "import-new", portfolioId: a.id, date: "2026-01-07", type: "BUY", symbol: "IMPNEW", shares: 1, price: 1, amount: 1 }];
    const updates = [{ id: "import-update", data: { price: 6 } }];
    const db = getDatabase();
    // The update fails after the insert of the same import ran.
    db.run("CREATE TEMP TRIGGER fail_import_update BEFORE UPDATE ON transactions WHEN OLD.id = 'import-update' BEGIN SELECT RAISE(ABORT, 'update refused'); END");
    try {
      expect(() => txRepo.saveImport(creates, updates)).toThrow("update refused");
    } finally {
      db.run("DROP TRIGGER IF EXISTS fail_import_update");
    }
    expect(txRepo.findById("import-new")).toBeNull();
    expect(txRepo.findById("import-update")?.price).toBe(5);

    const saved = txRepo.saveImport(creates, updates);
    expect(saved.created.map((r) => r.id)).toEqual(["import-new"]);
    expect(saved.updated).toBe(1);
    expect(txRepo.findById("import-update")?.price).toBe(6);
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

describe("deleting a portfolio", () => {
  it("switches off the automations aimed at it and leaves the others alone", () => {
    const service = new PortfolioService(offline);
    const original = loadConfig();
    const gone = portfolioRepo.create({ name: "Gone", baseCurrency: "EUR" });
    const kept = portfolioRepo.create({ name: "Kept", baseCurrency: "EUR" });
    try {
      updateConfig({
        dailyBriefPortfolioId: gone.id,
        dailyBriefEnabled: true,
        eventAlertsPortfolioId: gone.id,
        eventAlertsEnabled: true,
        weeklyAnalysisPortfolioId: kept.id,
        weeklyAnalysisEnabled: true,
      });
      expect(service.deletePortfolio(gone.id)).toBe(true);
      const cfg = loadConfig();
      expect(cfg.dailyBriefPortfolioId).toBe("");
      expect(cfg.dailyBriefEnabled).toBe(false);
      expect(cfg.eventAlertsPortfolioId).toBe("");
      expect(cfg.eventAlertsEnabled).toBe(false);
      expect(cfg.weeklyAnalysisPortfolioId).toBe(kept.id);
      expect(cfg.weeklyAnalysisEnabled).toBe(true);
    } finally {
      updateConfig({
        dailyBriefPortfolioId: original.dailyBriefPortfolioId,
        eventAlertsPortfolioId: original.eventAlertsPortfolioId,
        weeklyAnalysisPortfolioId: original.weeklyAnalysisPortfolioId,
        dailyBriefEnabled: original.dailyBriefEnabled,
        eventAlertsEnabled: original.eventAlertsEnabled,
        weeklyAnalysisEnabled: original.weeklyAnalysisEnabled,
      });
      portfolioRepo.deleteById(kept.id);
      service.destroy();
    }
  });
});

describe("re-importing a file without broker ids", () => {
  let service: PortfolioService;
  let p: portfolioRepo.PortfolioRow;

  beforeAll(() => {
    getDatabase();
    service = new PortfolioService(offline);
    p = portfolioRepo.create({ name: "Fingerprint", baseCurrency: "EUR" });
  });

  afterAll(() => {
    service.destroy();
    portfolioRepo.deleteById(p.id);
  });

  // The import page numbers a row without a broker id by its place in the file.
  const row = (index: number, date: string, amount: number) => ({
    id: `tx_${date}_DIVIDEND_FPTEST_${amount}__${index}`,
    date,
    type: "DIVIDEND",
    symbol: "FPTEST",
    amount,
    currency: "EUR",
  });

  it("matches rows whose place in the file moved, each stored row once", async () => {
    // Two identical rows: two payouts on one day.
    const first = [row(0, "2026-02-01", 1.5), row(1, "2026-02-01", 1.5), row(2, "2026-03-01", 2)];
    const saved = await service.manageTransactions(p.id, { action: "import", transactions: first });
    expect(saved.newTransactionsCount).toBe(3);

    // A longer export adds an older row on top, so every row moves down one place.
    const longer = [row(0, "2026-01-01", 1), row(1, "2026-02-01", 1.5), row(2, "2026-02-01", 1.5), row(3, "2026-03-01", 2)];
    const again = await service.manageTransactions(p.id, { action: "import", dryRun: true, transactions: longer });
    expect(again.newTransactionsCount).toBe(1);
    expect(again.unchangedTransactionsCount).toBe(3);

    // A third payout on the same day is new.
    const extra = [...longer, row(4, "2026-02-01", 1.5)];
    const more = await service.manageTransactions(p.id, { action: "import", dryRun: true, transactions: extra });
    expect(more.newTransactionsCount).toBe(2);
  });
});
