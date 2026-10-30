/**
 * Transaction repository: ledger ordering, COALESCE updates, bulk writes, counts and ISIN remapping.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, setDataDirForTests } from "../../paths";
import { getDatabase, closeDatabase } from "../../db/database";
import { saveConfig, type DesktopConfig } from "../../config";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as txRepo from "../../db/transaction.repo";

/** Points the service at an empty data dir; `restore()` goes back to the shared one. */
function useFreshDataDir(prefix = "portfolio-iso-"): { dir: string; restore: () => void } {
  const previous = DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  setDataDirForTests(dir);
  closeDatabase();
  saveConfig({} as DesktopConfig);
  return {
    dir,
    restore: () => {
      closeDatabase();
      setDataDirForTests(previous);
      saveConfig({} as DesktopConfig);
    },
  };
}

const setTx = (id: string, column: "createdAt" | "updatedAt", value: string) => getDatabase().run(`UPDATE transactions SET ${column} = ? WHERE id = ?`, [value, id]);

let env: ReturnType<typeof useFreshDataDir>;
let P1: string;
let P2: string;
beforeAll(() => {
  env = useFreshDataDir();
  P1 = portfolioRepo.create({ name: "P1" }).id;
  P2 = portfolioRepo.create({ name: "P2" }).id;
});
afterAll(() => env.restore());

describe("txRepo create and order", () => {
  it("creates a minimal row with defaults", () => {
    const t = txRepo.create({ portfolioId: P1, date: "2025-01-02", type: "BUY", symbol: "AAA" });
    expect(t.id).toMatch(/^tx_\d+_[0-9a-f]{8}$/);
    expect(t.currency).toBe("EUR");
    for (const k of ["datetime", "assetClass", "name", "isin", "shares", "price", "amount", "fee", "tax"] as const) {
      expect({ k, v: t[k] }).toEqual({ k, v: null });
    }
    expect(t.createdAt).toBe(t.updatedAt);
  });

  it("keeps an explicit id and rejects a duplicate", () => {
    expect(txRepo.create({ id: "t-dup", portfolioId: P1, date: "2025-01-02", type: "BUY", symbol: "AAA" }).id).toBe("t-dup");
    expect(() => txRepo.create({ id: "t-dup", portfolioId: P1, date: "2025-01-02", type: "BUY", symbol: "AAA" })).toThrow(
      /UNIQUE constraint failed: transactions.id/,
    );
  });

  it("orders by date, then datetime or date, then createdAt", () => {
    txRepo.create({ id: "a", portfolioId: P2, date: "2025-01-02", type: "BUY", symbol: "AAA" });
    txRepo.create({ id: "b", portfolioId: P2, date: "2025-01-01", datetime: "2025-01-01T15:00", type: "BUY", symbol: "AAA" });
    txRepo.create({ id: "c", portfolioId: P2, date: "2025-01-01", datetime: "2025-01-01T09:00", type: "BUY", symbol: "AAA" });
    txRepo.create({ id: "d", portfolioId: P2, date: "2025-01-01", type: "BUY", symbol: "AAA" });
    txRepo.create({ id: "e", portfolioId: P2, date: "2025-01-03", type: "BUY", symbol: "AAA" });
    txRepo.create({ id: "f", portfolioId: P2, date: "2025-01-03", type: "BUY", symbol: "AAA" });
    setTx("e", "createdAt", "2026-01-02T00:00:00.000Z");
    setTx("f", "createdAt", "2026-01-01T00:00:00.000Z");
    expect(txRepo.findByPortfolio(P2).map((r) => r.id)).toEqual(["d", "c", "b", "a", "f", "e"]);
  });
});

describe("txRepo update", () => {
  it("stores zero values", () => {
    const t = txRepo.create({ portfolioId: P1, date: "2025-01-03", type: "BUY", symbol: "ZERO", price: 5, fee: 2 });
    const u = txRepo.update(t.id, { price: 0, fee: 0 })!;
    expect(u.price).toBe(0);
    expect(u.fee).toBe(0);
  });

  it("does not clear a field to null", () => {
    const t = txRepo.create({ portfolioId: P1, date: "2025-01-03", type: "BUY", symbol: "NAMED", name: "Kept" });
    expect(txRepo.update(t.id, { name: null })!.name).toBe("Kept");
  });

  it("an empty update changes only updatedAt", () => {
    const t = txRepo.create({ portfolioId: P1, date: "2025-01-03", type: "BUY", symbol: "SAME", shares: 3, price: 7 });
    setTx(t.id, "updatedAt", "2000-01-01T00:00:00.000Z");
    const before = txRepo.findById(t.id)!;
    const after = txRepo.update(t.id, {})!;
    expect(after.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect({ ...after, updatedAt: "" }).toEqual({ ...before, updatedAt: "" });
  });

  it("returns null for a missing id", () => {
    expect(txRepo.update("missing", { name: "x" })).toBeNull();
  });
});

describe("txRepo bulk and counts", () => {
  it("bulkCreate returns rows in input order", () => {
    expect(txRepo.bulkCreate([])).toEqual([]);
    const rows = txRepo.bulkCreate([
      { id: "bk3", portfolioId: P1, date: "2025-02-03", type: "BUY", symbol: "B3" },
      { id: "bk1", portfolioId: P1, date: "2025-02-01", type: "BUY", symbol: "B1" },
      { id: "bk2", portfolioId: P1, date: "2025-02-02", type: "SELL", symbol: "B2" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["bk3", "bk1", "bk2"]);
    expect(rows.map((r) => r.currency)).toEqual(["EUR", "EUR", "EUR"]);
  });

  it("bulkCreate with a duplicate id inserts nothing", () => {
    const before = txRepo.countByPortfolio(P1);
    expect(() =>
      txRepo.bulkCreate([
        { id: "dup-bulk", portfolioId: P1, date: "2025-02-01", type: "BUY", symbol: "D" },
        { id: "dup-bulk", portfolioId: P1, date: "2025-02-01", type: "BUY", symbol: "D" },
      ]),
    ).toThrow();
    expect(txRepo.countByPortfolio(P1)).toBe(before);
  });

  it("bulkUpdate counts only rows that exist", () => {
    expect(txRepo.bulkUpdate([])).toBe(0);
    expect(
      txRepo.bulkUpdate([
        { id: "bk1", data: { fee: 1 } },
        { id: "missing", data: { fee: 1 } },
      ]),
    ).toBe(1);
    expect(txRepo.findById("bk1")!.fee).toBe(1);
  });

  it("countTotal is the sum over portfolios", () => {
    expect(txRepo.countTotal()).toBe(txRepo.countByPortfolio(P1) + txRepo.countByPortfolio(P2));
  });

  it("deleteByPortfolio returns the number of rows removed", () => {
    expect(txRepo.deleteByPortfolio(P2)).toBe(6);
    expect(txRepo.countByPortfolio(P2)).toBe(0);
    expect(txRepo.deleteByPortfolio(P2)).toBe(0);
  });

  it("deleteById reports whether a row went", () => {
    const t = txRepo.create({ portfolioId: P1, date: "2025-01-05", type: "BUY", symbol: "DEL" });
    expect(txRepo.deleteById(t.id)).toBe(true);
    expect(txRepo.deleteById(t.id)).toBe(false);
  });
});

describe("txRepo.setSymbolForIsin", () => {
  let Q1: string;
  let Q2: string;
  beforeAll(() => {
    Q1 = portfolioRepo.create({ name: "Q1" }).id;
    Q2 = portfolioRepo.create({ name: "Q2" }).id;
    txRepo.create({ id: "q1a", portfolioId: Q1, date: "2025-01-01", type: "BUY", symbol: "US0378331005", isin: "US0378331005", name: "Old" });
    txRepo.create({ id: "q2a", portfolioId: Q2, date: "2025-01-01", type: "BUY", symbol: "us0378331005", isin: null });
    txRepo.create({ id: "q1b", portfolioId: Q1, date: "2025-01-01", type: "BUY", symbol: "SAP", isin: "DE0007164600", name: "SAP SE" });
    for (const id of ["q1a", "q2a", "q1b"]) setTx(id, "updatedAt", "2000-01-01T00:00:00.000Z");
  });

  it("remaps rows by ISIN or ISIN-like symbol across portfolios", () => {
    const q1bBefore = txRepo.findById("q1b")!;
    const touched = txRepo.setSymbolForIsin("us0378331005", "AAPL", "Apple Inc.");
    expect([...touched].sort()).toEqual([Q1, Q2].sort());
    for (const id of ["q1a", "q2a"]) {
      const r = txRepo.findById(id)!;
      expect(r.symbol).toBe("AAPL");
      expect(r.isin).toBe("US0378331005");
      expect(r.name).toBe("Apple Inc.");
      expect(r.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    }
    expect(txRepo.findById("q1b")).toEqual(q1bBefore);
  });

  it("returns [] when nothing matches", () => {
    const before = txRepo.findByPortfolio(Q1);
    expect(txRepo.setSymbolForIsin("XS0000000000", "ZZZ")).toEqual([]);
    expect(txRepo.findByPortfolio(Q1)).toEqual(before);
  });

  it("keeps the name when none is given and stores the symbol as given", () => {
    txRepo.setSymbolForIsin("DE0007164600", "SAP.DE");
    let r = txRepo.findById("q1b")!;
    expect(r.symbol).toBe("SAP.DE");
    expect(r.name).toBe("SAP SE");
    txRepo.setSymbolForIsin("DE0007164600", "sap.de");
    r = txRepo.findById("q1b")!;
    expect(r.symbol).toBe("sap.de");
  });
});
