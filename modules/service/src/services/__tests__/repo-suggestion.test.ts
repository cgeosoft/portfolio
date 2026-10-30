/**
 * Suggestion repository: round trip, ordering, status changes, history trim, runs and the transaction fingerprint.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { DATA_DIR, setDataDirForTests } from "../../paths";
import { getDatabase, closeDatabase } from "../../db/database";
import { saveConfig, type DesktopConfig } from "../../config";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as txRepo from "../../db/transaction.repo";
import * as marketCache from "../../db/market-cache.repo";
import * as suggestionRepo from "../../db/suggestion.repo";

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

const sha32 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

let env: ReturnType<typeof useFreshDataDir>;
let P: string;
let Q: string;
beforeAll(() => {
  env = useFreshDataDir();
  P = portfolioRepo.create({ name: "P" }).id;
  Q = portfolioRepo.create({ name: "Q" }).id;
});
afterAll(() => env.restore());

describe("suggestionRepo rows", () => {
  it("newSuggestionId has the sg_ format and is unique", () => {
    const a = suggestionRepo.newSuggestionId();
    const b = suggestionRepo.newSuggestionId();
    expect(a).toMatch(/^sg_\d+_[0-9a-f]{8}$/);
    expect(b).toMatch(/^sg_\d+_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("round-trips nested objects and leaves optional fields undefined", () => {
    const input = suggestion({ id: "s1", portfolioId: P });
    suggestionRepo.upsert(input);
    const s = suggestionRepo.findById(P, "s1")!;
    expect(s.validity).toEqual(input.validity);
    expect(s.fundedBy).toEqual(input.fundedBy);
    expect(s.statusReason).toBeUndefined();
    expect(s.dismissedAtWeight).toBeUndefined();
    expect(s.resolvedAt).toBeUndefined();
  });

  it("findById is scoped to the portfolio", () => {
    expect(suggestionRepo.findById(Q, "s1")).toBeNull();
  });

  it("orders by priority, then createdAt", () => {
    suggestionRepo.upsert(suggestion({ id: "s2", portfolioId: P, priority: 1, createdAt: "2026-01-02T00:00:00.000Z" }));
    suggestionRepo.upsert(suggestion({ id: "s3", portfolioId: P, priority: 1, createdAt: "2026-01-01T00:00:00.000Z" }));
    expect(suggestionRepo.findByPortfolio(P).map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
  });

  it("a conflicting upsert keeps the identity fields", () => {
    suggestionRepo.upsert(
      suggestion({ id: "s1", portfolioId: P, symbol: "ZZZ", key: "close:ZZZ", action: "close", createdAt: "2030-01-01T00:00:00.000Z", title: "New" }),
    );
    const s = suggestionRepo.findById(P, "s1")!;
    expect(s.title).toBe("New");
    expect(s.symbol).toBe("AAA");
    expect(s.key).toBe("increase:AAA");
    expect(s.action).toBe("increase");
    expect(s.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("suggestionRepo.setStatus", () => {
  it("records a dismissal with its extras", () => {
    const s = suggestionRepo.setStatus(P, "s1", "dismissed", { statusReason: "user", dismissedAtWeight: 4.2 })!;
    expect(s.status).toBe("dismissed");
    expect(s.statusReason).toBe("user");
    expect(s.dismissedAtWeight).toBe(4.2);
    expect(s.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(s.resolvedAt).toBe(s.updatedAt);
  });

  it("going back to active clears the extras", () => {
    const s = suggestionRepo.setStatus(P, "s1", "active")!;
    expect(s.status).toBe("active");
    expect(s.resolvedAt).toBeUndefined();
    expect(s.statusReason).toBeUndefined();
    expect(s.dismissedAtWeight).toBeUndefined();
  });

  it("is scoped to the portfolio", () => {
    const before = suggestionRepo.findById(P, "s1")!.status;
    expect(suggestionRepo.setStatus(Q, "s1", "done")).toBeNull();
    expect(suggestionRepo.findById(P, "s1")!.status).toBe(before);
  });
});

describe("suggestionRepo.pruneHistory", () => {
  it("keeps active rows and the newest 200 others", () => {
    const R = portfolioRepo.create({ name: "R" }).id;
    for (let i = 0; i < 203; i++) {
      suggestionRepo.upsert(
        suggestion({ id: `h${i}`, portfolioId: R, status: "done", updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }),
      );
    }
    suggestionRepo.upsert(suggestion({ id: "act1", portfolioId: R, status: "active", updatedAt: "2000-01-01T00:00:00.000Z" }));
    suggestionRepo.upsert(suggestion({ id: "act2", portfolioId: R, status: "active", updatedAt: "2000-01-01T00:00:00.000Z" }));
    suggestionRepo.upsert(suggestion({ id: "q-done", portfolioId: Q, status: "done" }));

    suggestionRepo.pruneHistory(R);

    const ids = new Set(suggestionRepo.findByPortfolio(R).map((s) => s.id));
    expect(ids.size).toBe(202);
    for (const gone of ["h0", "h1", "h2"]) expect(ids.has(gone)).toBe(false);
    for (const kept of ["h3", "h202", "act1", "act2"]) expect(ids.has(kept)).toBe(true);
    expect(suggestionRepo.findById(Q, "q-done")).not.toBeNull();
  });
});

describe("suggestionRepo runs", () => {
  it("saveRun stores one row per portfolio and replaces it", () => {
    expect(suggestionRepo.findRun(P)).toBeNull();
    suggestionRepo.saveRun({ portfolioId: P, generatedAt: "2026-01-01T00:00:00.000Z", txFingerprint: "abc", summary: "S", notes: ["a", "b"], provider: "x", model: "y" });
    expect(suggestionRepo.findRun(P)).toEqual({
      portfolioId: P,
      generatedAt: "2026-01-01T00:00:00.000Z",
      txFingerprint: "abc",
      summary: "S",
      notes: '["a","b"]',
      provider: "x",
      model: "y",
    } as never);
    suggestionRepo.saveRun({ portfolioId: P, generatedAt: "2026-02-01T00:00:00.000Z", txFingerprint: "def", summary: null, notes: [], provider: null, model: null });
    expect(suggestionRepo.findRun(P)).toEqual({
      portfolioId: P,
      generatedAt: "2026-02-01T00:00:00.000Z",
      txFingerprint: "def",
      summary: null,
      notes: "[]",
      provider: null,
      model: null,
    } as never);
    const n = (getDatabase().query("SELECT COUNT(*) AS n FROM suggestion_runs WHERE portfolioId = ?").get(P) as { n: number }).n;
    expect(n).toBe(1);
  });
});

describe("suggestionRepo.transactionFingerprint", () => {
  it("is a fixed value for no transactions", () => {
    const empty = portfolioRepo.create({ name: "Empty" }).id;
    expect(sha32("0||0.000000|0.0000")).toBe("4e919a976b4013c012d091b53c9dd6e2");
    expect(suggestionRepo.transactionFingerprint(empty)).toBe("4e919a976b4013c012d091b53c9dd6e2");
    expect(suggestionRepo.transactionFingerprint("unknown-id")).toBe("4e919a976b4013c012d091b53c9dd6e2");
  });

  it("hashes count, latest updatedAt, share sum and amount sum", () => {
    const F = portfolioRepo.create({ name: "F" }).id;
    const a = txRepo.create({ portfolioId: F, date: "2025-01-01", type: "BUY", symbol: "AAA", shares: 1.5, amount: -100 });
    const b = txRepo.create({ portfolioId: F, date: "2025-01-02", type: "DIVIDEND", symbol: "AAA", shares: null, amount: 50.25 });
    const db = getDatabase();
    db.run("UPDATE transactions SET updatedAt = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", a.id]);
    db.run("UPDATE transactions SET updatedAt = ? WHERE id = ?", ["2026-02-01T00:00:00.000Z", b.id]);
    expect(sha32("2|2026-02-01T00:00:00.000Z|1.500000|-49.7500")).toBe("a20ffa7fb0dd1578e993b6ecd3bb776e");
    expect(suggestionRepo.transactionFingerprint(F)).toBe("a20ffa7fb0dd1578e993b6ecd3bb776e");
  });

  it("changes only with this portfolio's transactions", () => {
    const G = portfolioRepo.create({ name: "G" }).id;
    const t = txRepo.create({ portfolioId: G, date: "2025-01-01", type: "BUY", symbol: "AAA", shares: 1, amount: -10 });
    getDatabase().run("UPDATE transactions SET updatedAt = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", t.id]);
    const base = suggestionRepo.transactionFingerprint(G);

    marketCache.set("quote:AAA", { p: 1 }, 1000);
    expect(suggestionRepo.transactionFingerprint(G)).toBe(base);
    txRepo.create({ portfolioId: Q, date: "2025-01-01", type: "BUY", symbol: "AAA", shares: 1, amount: -10 });
    expect(suggestionRepo.transactionFingerprint(G)).toBe(base);

    txRepo.update(t.id, { shares: 2 });
    const updated = suggestionRepo.transactionFingerprint(G);
    expect(updated).not.toBe(base);

    txRepo.deleteById(t.id);
    expect(suggestionRepo.transactionFingerprint(G)).not.toBe(updated);
  });
});
