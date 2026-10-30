/**
 * Snapshot, report and assistant conversation repositories: upsert identity, ordering and scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, setDataDirForTests } from "../../paths";
import { getDatabase, closeDatabase } from "../../db/database";
import { saveConfig, type DesktopConfig } from "../../config";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as snapshotRepo from "../../db/snapshot.repo";
import * as reportRepo from "../../db/report.repo";
import type { ReportMetrics } from "../../db/report.repo";
import * as conversationRepo from "../../db/conversation.repo";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let env: ReturnType<typeof useFreshDataDir>;
let P: string;
let Q: string;
beforeAll(() => {
  env = useFreshDataDir();
  P = portfolioRepo.create({ name: "P" }).id;
  Q = portfolioRepo.create({ name: "Q" }).id;
});
afterAll(() => env.restore());

const snap = (portfolioId: string, date: string, extra: { totalValue?: number; holdingsJson?: string | null } = {}) =>
  snapshotRepo.upsert({ portfolioId, date, timestamp: 1735689600000, totalValue: 1, totalCost: 1, totalGainLoss: 0, cashBalance: 0, totalPortfolioValue: 1, ...extra });

describe("snapshotRepo", () => {
  it("first upsert creates a row", () => {
    const s = snap(P, "2025-01-01");
    expect(s.id).toMatch(UUID);
    expect(s.portfolioId).toBe(P);
    expect(s.date).toBe("2025-01-01");
    expect(s.timestamp).toBe(1735689600000);
    expect(s.totalValue).toBe(1);
    expect(s.totalCost).toBe(1);
    expect(s.totalGainLoss).toBe(0);
    expect(s.cashBalance).toBe(0);
    expect(s.totalPortfolioValue).toBe(1);
    expect(s.holdingsJson).toBeNull();
  });

  it("a second upsert on the same day keeps id and createdAt", () => {
    const first = snapshotRepo.findByPortfolio(P).find((r) => r.date === "2025-01-01")!;
    const second = snap(P, "2025-01-01", { totalValue: 2, holdingsJson: '[{"s":"A"}]' });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.totalValue).toBe(2);
    expect(second.holdingsJson).toBe('[{"s":"A"}]');
    const third = snap(P, "2025-01-01");
    expect(third.holdingsJson).toBeNull();
    expect(snapshotRepo.findByPortfolio(P).filter((r) => r.date === "2025-01-01").length).toBe(1);
  });

  it("the same date in another portfolio is a separate row", () => {
    snap(Q, "2025-01-01");
    expect(snapshotRepo.findByPortfolio(Q).length).toBe(1);
  });

  it("findByPortfolio orders by date ascending", () => {
    snap(P, "2025-01-03");
    snap(P, "2025-01-02");
    expect(snapshotRepo.findByPortfolio(P).map((r) => r.date)).toEqual(["2025-01-01", "2025-01-02", "2025-01-03"]);
  });

  it("findByPortfolio of an unknown portfolio is empty", () => {
    expect(snapshotRepo.findByPortfolio("missing")).toEqual([]);
  });
});

const M: ReportMetrics = { totalPortfolioValue: 1000, cashBalance: 50, baseCurrency: "EUR", holdingsCount: 3, topWinner: { symbol: "AAA", changePercent: 4.5 } } as ReportMetrics;

const report = (o: Partial<Parameters<typeof reportRepo.upsert>[0]> & { id: string; portfolioId: string }) =>
  reportRepo.upsert({
    period: "weekly",
    weekStartDate: "2025-01-06",
    weekEndDate: "2025-01-12",
    weekKey: "2025-W02",
    title: "t",
    summary: "s",
    content: "c",
    metrics: M,
    model: "m",
    provider: "p",
    ...o,
  });

describe("reportRepo", () => {
  it("applies defaults", () => {
    const r = report({ id: "rd", portfolioId: P });
    expect(r.status).toBe("success");
    expect(r.error).toBeNull();
    expect(r.isFallback).toBe(0);
    expect(r.prompt).toBeNull();
    expect(JSON.parse(r.metrics)).toEqual(M);
  });

  it("stores fallback status", () => {
    const r = report({ id: "rf", portfolioId: P, isFallback: true, status: "fallback", error: "timeout" });
    expect(r.isFallback).toBe(1);
    expect(r.status).toBe("fallback");
    expect(r.error).toBe("timeout");
  });

  it("re-upsert updates content but keeps the period identity", () => {
    const first = reportRepo.findById("rd")!;
    const r = report({ id: "rd", portfolioId: P, title: "New title", content: "New content", weekKey: "2099-W01", weekStartDate: "2099-01-01", period: "monthly" });
    expect(r.title).toBe("New title");
    expect(r.content).toBe("New content");
    expect(r.createdAt).toBe(first.createdAt);
    expect(r.weekKey).toBe("2025-W02");
    expect(r.weekStartDate).toBe("2025-01-06");
    expect(r.weekEndDate).toBe("2025-01-12");
    expect(r.period).toBe("weekly");
  });

  describe("ordering and delete", () => {
    let R: string;
    beforeAll(() => {
      R = portfolioRepo.create({ name: "R" }).id;
      report({ id: "r1", portfolioId: R, weekStartDate: "2025-01-06" });
      report({ id: "r2", portfolioId: R, weekStartDate: "2025-01-13" });
      report({ id: "r3", portfolioId: R, weekStartDate: "2025-01-13" });
      const db = getDatabase();
      db.run("UPDATE reports SET createdAt = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", "r2"]);
      db.run("UPDATE reports SET createdAt = ? WHERE id = ?", ["2026-01-02T00:00:00.000Z", "r3"]);
    });

    it("lists newest week first, then newest createdAt, without the prompt", () => {
      const rows = reportRepo.findByPortfolio(R);
      expect(rows.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
      expect(reportRepo.findByPortfolio(R, 1).length).toBe(1);
      for (const row of rows) expect("prompt" in row).toBe(false);
    });

    it("deleteById is scoped to the portfolio", () => {
      expect(reportRepo.deleteById("r1", Q)).toBe(false);
      expect(reportRepo.findById("r1")).not.toBeNull();
      expect(reportRepo.deleteById("r1", R)).toBe(true);
    });
  });
});

describe("conversationRepo", () => {
  const SQLITE_NOW = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  it("a new conversation has equal SQLite timestamps", () => {
    const c = conversationRepo.upsert({ id: "c1", portfolioId: P, title: "T1", messages: "[]" });
    expect(c.createdAt).toBe(c.updatedAt);
    expect(c.createdAt).toMatch(SQLITE_NOW);
  });

  it("an update keeps createdAt and bumps updatedAt", () => {
    getDatabase().run("UPDATE assistant_conversations SET createdAt = ?, updatedAt = ? WHERE id = ?", ["2020-01-01 00:00:00", "2020-01-01 00:00:00", "c1"]);
    const c = conversationRepo.upsert({ id: "c1", portfolioId: P, title: "T2", messages: "[]" });
    expect(c.title).toBe("T2");
    expect(c.createdAt).toBe("2020-01-01 00:00:00");
    expect(c.updatedAt).not.toBe("2020-01-01 00:00:00");
  });

  it("the same id under another portfolio is rejected", () => {
    expect(() => conversationRepo.upsert({ id: "c1", portfolioId: Q, title: "Hijack", messages: "[]" })).toThrow(
      /UNIQUE constraint failed: assistant_conversations.id/,
    );
    const c = conversationRepo.findById("c1")!;
    expect(c.portfolioId).toBe(P);
    expect(c.title).toBe("T2");
  });

  it("findById is scoped when a portfolio is given", () => {
    expect(conversationRepo.findById("c1", Q)).toBeNull();
    expect(conversationRepo.findById("c1")).not.toBeNull();
  });

  it("messageCount counts only JSON arrays", () => {
    conversationRepo.upsert({ id: "c-obj", portfolioId: P, title: "o", messages: '{"a":1}' });
    conversationRepo.upsert({ id: "c-arr", portfolioId: P, title: "a", messages: "[1,2,3]" });
    conversationRepo.upsert({ id: "c-empty", portfolioId: P, title: "e", messages: "" });
    const byId = new Map(conversationRepo.listByPortfolio(P).map((r) => [r.id, r.messageCount]));
    expect(byId.get("c-obj")).toBe(0);
    expect(byId.get("c-arr")).toBe(3);
    expect(byId.get("c-empty")).toBe(0);
  });

  it("listByPortfolio honours the limit and deleteById is scoped", () => {
    expect(conversationRepo.listByPortfolio(P, 1).length).toBe(1);
    expect(conversationRepo.deleteById("c1", Q)).toBe(false);
    expect(conversationRepo.deleteById("c1", P)).toBe(true);
  });
});
