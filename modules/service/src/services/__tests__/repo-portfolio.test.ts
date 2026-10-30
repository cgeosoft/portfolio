/**
 * Portfolio repository: CRUD, metrics JSON, foreign keys and the cascade across every child table.
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
import * as reportRepo from "../../db/report.repo";
import * as snapshotRepo from "../../db/snapshot.repo";
import * as conversationRepo from "../../db/conversation.repo";
import * as manualPriceRepo from "../../db/manual-price.repo";
import * as suggestionRepo from "../../db/suggestion.repo";
import * as symbolMapRepo from "../../db/symbol-map.repo";
import * as marketCache from "../../db/market-cache.repo";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";

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

const suggestion = (o: Partial<PortfolioSuggestion> & { id: string; portfolioId: string }): PortfolioSuggestion => ({
  key: "increase:AAA",
  action: "increase",
  symbol: "AAA",
  name: "Triple A",
  fromWeight: 5,
  targetWeight: 8,
  title: "Add",
  why: "Because",
  priority: 2,
  validity: { expiresAt: "2099-01-01T00:00:00.000Z", weight: { max: 10 } },
  fundedBy: [{ key: "decrease:BBB", weight: 3 }],
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let env: ReturnType<typeof useFreshDataDir>;
beforeAll(() => {
  env = useFreshDataDir();
});
afterAll(() => env.restore());

describe("portfolioRepo", () => {
  it("creates with defaults", () => {
    const p = portfolioRepo.create({ name: "A" });
    expect(p.id).toMatch(UUID_V4);
    expect(p.name).toBe("A");
    expect(p.baseCurrency).toBe("EUR");
    expect(p.description).toBeNull();
    expect(p.color).toBeNull();
    expect(p.metricsJson).toBeNull();
    expect(p.createdAt).toBe(p.updatedAt);
    expect(p.createdAt).toMatch(ISO);
  });

  it("round-trips every given field", () => {
    const p = portfolioRepo.create({ name: "B", description: "d", baseCurrency: "USD", color: "#ff0000" });
    const found = portfolioRepo.findById(p.id)!;
    expect(found.name).toBe("B");
    expect(found.description).toBe("d");
    expect(found.baseCurrency).toBe("USD");
    expect(found.color).toBe("#ff0000");
  });

  it("findAll orders by createdAt ascending", () => {
    getDatabase().run("DELETE FROM portfolios");
    const x = portfolioRepo.create({ name: "X" });
    const y = portfolioRepo.create({ name: "Y" });
    const z = portfolioRepo.create({ name: "Z" });
    const db = getDatabase();
    db.run("UPDATE portfolios SET createdAt = ? WHERE id = ?", ["2026-03-01T00:00:00.000Z", x.id]);
    db.run("UPDATE portfolios SET createdAt = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", y.id]);
    db.run("UPDATE portfolios SET createdAt = ? WHERE id = ?", ["2026-02-01T00:00:00.000Z", z.id]);
    expect(portfolioRepo.findAll().map((p) => p.name)).toEqual(["Y", "Z", "X"]);
  });

  it("update keeps omitted fields, clears explicit nulls, and always bumps updatedAt", () => {
    const p = portfolioRepo.create({ name: "U", description: "d", baseCurrency: "USD", color: "#00ff00" });
    const renamed = portfolioRepo.update(p.id, { name: "N" })!;
    expect(renamed.name).toBe("N");
    expect(renamed.description).toBe("d");
    expect(renamed.baseCurrency).toBe("USD");
    expect(renamed.color).toBe("#00ff00");

    const cleared = portfolioRepo.update(p.id, { description: null, color: null })!;
    expect(cleared.description).toBeNull();
    expect(cleared.color).toBeNull();
    expect(cleared.name).toBe("N");

    getDatabase().run("UPDATE portfolios SET updatedAt = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", p.id]);
    const touched = portfolioRepo.update(p.id, {})!;
    expect(touched.name).toBe("N");
    expect(touched.baseCurrency).toBe("USD");
    expect(touched.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("update and findById of a missing id return null", () => {
    expect(portfolioRepo.update("missing", { name: "x" })).toBeNull();
    expect(portfolioRepo.findById("missing")).toBeNull();
  });

  it("stores and reads metrics JSON", () => {
    const p = portfolioRepo.create({ name: "M" });
    expect(portfolioRepo.findMetricsJson(p.id)).toBeNull();
    expect(portfolioRepo.updateMetricsJson(p.id, '[{"key":"sharpe"}]')).toBe(true);
    expect(portfolioRepo.findMetricsJson(p.id)).toBe('[{"key":"sharpe"}]');
    expect(portfolioRepo.updateMetricsJson("missing", "[]")).toBe(false);
    expect(portfolioRepo.findMetricsJson("missing")).toBeNull();
  });

  it("count follows create and delete; delete reports whether a row went", () => {
    const before = portfolioRepo.count();
    const p = portfolioRepo.create({ name: "C" });
    expect(portfolioRepo.count()).toBe(before + 1);
    expect(portfolioRepo.deleteById(p.id)).toBe(true);
    expect(portfolioRepo.count()).toBe(before);
    expect(portfolioRepo.deleteById(p.id)).toBe(false);
    expect(portfolioRepo.count()).toBe(before);
  });

  it("deleting a portfolio cascades to every child table and leaves shared tables", () => {
    const P = portfolioRepo.create({ name: "P" });
    const Q = portfolioRepo.create({ name: "Q" });
    for (const [portfolioId, tag] of [
      [P.id, "p"],
      [Q.id, "q"],
    ] as const) {
      txRepo.create({ portfolioId, date: "2025-01-01", type: "BUY", symbol: "AAA", shares: 1, price: 10, amount: -10 });
      reportRepo.upsert({
        id: "r-" + tag,
        portfolioId,
        period: "weekly",
        weekStartDate: "2025-01-06",
        weekEndDate: "2025-01-12",
        weekKey: "2025-W02",
        title: "t",
        summary: "s",
        content: "c",
        metrics: { totalPortfolioValue: 1, cashBalance: 0, baseCurrency: "EUR", holdingsCount: 1 },
        model: "m",
        provider: "p",
      });
      snapshotRepo.upsert({ portfolioId, date: "2025-01-01", timestamp: 1735689600000, totalValue: 1, totalCost: 1, totalGainLoss: 0, cashBalance: 0, totalPortfolioValue: 1 });
      conversationRepo.upsert({ id: "c-" + tag, portfolioId, title: "t", messages: "[]" });
      manualPriceRepo.upsert({ portfolioId, symbol: "PRIV", price: 1, currency: "EUR", setAt: "2025-01-01" });
      suggestionRepo.upsert(suggestion({ id: "s-" + tag, portfolioId }));
      suggestionRepo.saveRun({ portfolioId, generatedAt: "2025-01-01T00:00:00.000Z", txFingerprint: "f", summary: null, notes: [], provider: null, model: null });
    }
    symbolMapRepo.upsert({ isin: "US0000000001", symbol: "AAA", source: "manual" });
    marketCache.set("quote:AAA", { p: 1 }, 60_000);

    expect(portfolioRepo.deleteById(P.id)).toBe(true);

    const db = getDatabase();
    for (const t of ["transactions", "reports", "snapshots", "assistant_conversations", "manual_prices", "suggestions", "suggestion_runs"]) {
      const count = (pid: string) => (db.query(`SELECT COUNT(*) AS n FROM ${t} WHERE portfolioId = ?`).get(pid) as { n: number }).n;
      expect({ t, n: count(P.id) }).toEqual({ t, n: 0 });
      expect({ t, n: count(Q.id) }).toEqual({ t, n: 1 });
    }
    expect(symbolMapRepo.findByIsin("US0000000001")).not.toBeNull();
    expect(marketCache.get("quote:AAA")).not.toBeNull();
  });

  it("enforces foreign keys on child rows", () => {
    expect(() => txRepo.create({ portfolioId: "no-such", date: "2025-01-01", type: "BUY", symbol: "X" })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => manualPriceRepo.upsert({ portfolioId: "no-such", symbol: "X", price: 1, currency: "EUR", setAt: "2025-01-01" })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it("round-trips a Unicode name", () => {
    const name = "Ελληνικό χαρτοφυλάκιο 📈";
    const p = portfolioRepo.create({ name });
    expect(portfolioRepo.findById(p.id)!.name).toBe(name);
  });
});
