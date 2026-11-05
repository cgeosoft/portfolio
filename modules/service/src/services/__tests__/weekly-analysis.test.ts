/** Weekly analysis: schedule edges and the run flow with a stubbed Guided Analysis. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { lastSlot, isAnalysisDue, nextAnalysisRun, WeeklyAnalysisService } from "../weekly-analysis.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { loadConfig, updateConfig } from "../../config.js";
import type { AnalysisService } from "../analysis/run.js";

beforeAll(() => updateConfig({ language: "en" }));

describe("schedule edges", () => {
  const weekly = { weeklyAnalysisEnabled: true, weeklyAnalysisDay: 6, weeklyAnalysisTime: "09:00", weeklyAnalysisLastRun: undefined as string | undefined };

  it("finds the last slot", () => {
    expect(lastSlot(weekly, new Date("2026-09-12T08:59:00")).getTime()).toBe(new Date("2026-09-05T09:00:00").getTime());
    expect(lastSlot(weekly, new Date("2026-09-12T09:00:00")).getTime()).toBe(new Date("2026-09-12T09:00:00").getTime());
  });

  it("catches up for exactly 48 hours", () => {
    expect(isAnalysisDue(weekly, new Date("2026-09-14T09:00:00"))).toBe(true);
    expect(isAnalysisDue(weekly, new Date("2026-09-14T09:01:00"))).toBe(false);
  });

  it("runs once per slot", () => {
    expect(isAnalysisDue({ ...weekly, weeklyAnalysisLastRun: "2026-09-12" }, new Date("2026-09-13T10:00:00"))).toBe(false);
    expect(isAnalysisDue({ ...weekly, weeklyAnalysisLastRun: "2026-09-11" }, new Date("2026-09-13T10:00:00"))).toBe(true);
  });

  it("handles a Sunday evening slot", () => {
    const sunday = { ...weekly, weeklyAnalysisDay: 0, weeklyAnalysisTime: "20:30" };
    const before = new Date("2026-09-13T20:29:00");
    expect(isAnalysisDue(sunday, before)).toBe(false);
    expect(new Date(nextAnalysisRun(sunday, before)!).getTime()).toBe(new Date("2026-09-13T20:30:00").getTime());
    expect(isAnalysisDue(sunday, new Date("2026-09-13T20:30:00"))).toBe(true);
  });

  it("has no next run while switched off", () => {
    expect(nextAnalysisRun({ ...weekly, weeklyAnalysisEnabled: false }, new Date("2026-09-13T10:00:00"))).toBeUndefined();
  });
});

describe("WeeklyAnalysisService.run", () => {
  const KEYS = ["weeklyAnalysisPortfolioId", "weeklyAnalysisLastRun", "gotifyUrl", "gotifyToken", "ntfyTopic", "language"] as const;
  let saved: Record<string, unknown> = {};
  let row: { id: string };
  const originalFetch = globalThis.fetch;
  let fetchCalls: RequestInit[] = [];
  let reason: string | undefined;
  let status = "completed";
  let started: unknown[] = [];

  const analysis = {
    capability: async () => ({ reason }),
    start: async (portfolioId: string, opts: unknown) => {
      started.push({ portfolioId, opts });
      return { id: "run" };
    },
    waitFor: async () => {},
    get: () => ({ run: { status, summary: "On track against the brief.", error: status === "failed" ? "model gone" : undefined }, suggestions: [{ status: "active", title: "Trim NVDA" }] }),
  } as unknown as AnalysisService;

  beforeAll(() => {
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    saved = Object.fromEntries(KEYS.map((k) => [k, cfg[k]]));
    row = portfolioRepo.create({ name: "Growth", baseCurrency: "EUR" });
    updateConfig({ weeklyAnalysisPortfolioId: row.id, gotifyUrl: "https://gotify.example.com", gotifyToken: "t", ntfyTopic: "", language: "en" });
  });

  afterAll(() => {
    updateConfig(saved);
    portfolioRepo.deleteById(row.id);
  });

  beforeEach(() => {
    fetchCalls = [];
    started = [];
    reason = undefined;
    status = "completed";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      fetchCalls.push(init);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("runs a scheduled analysis and pushes its summary and actions", async () => {
    const res = await new WeeklyAnalysisService(analysis).run("manual");
    expect(res).toMatchObject({ success: true, portfolios: 1, delivered: 1 });
    expect(started).toEqual([{ portfolioId: row.id, opts: { baseCurrency: "EUR", trigger: "schedule" } }]);
    const message = String(JSON.parse(String(fetchCalls[0]!.body)).message);
    expect(message).toContain("On track against the brief.");
    expect(message).toContain("- Trim NVDA");
  });

  it("reports why the model cannot run an analysis", async () => {
    reason = "no_tool_calling";
    const res = await new WeeklyAnalysisService(analysis).run("manual");
    expect(res).toMatchObject({ success: false, portfolios: 0, delivered: 0 });
    expect(res.error).toContain("no_tool_calling");
    expect(fetchCalls).toEqual([]);
  });

  it("pushes nothing for a failed analysis", async () => {
    status = "failed";
    const res = await new WeeklyAnalysisService(analysis).run("manual");
    expect(res.error).toBe("Guided Analysis: model gone");
    expect(fetchCalls).toEqual([]);
  });

  it("marks the day only on a scheduled run", async () => {
    updateConfig({ weeklyAnalysisLastRun: "2026-10-01" });
    await new WeeklyAnalysisService(analysis).run("manual");
    expect(loadConfig().weeklyAnalysisLastRun).toBe("2026-10-01");
    await new WeeklyAnalysisService(analysis).run("schedule");
    expect(loadConfig().weeklyAnalysisLastRun).not.toBe("2026-10-01");
  });
});
