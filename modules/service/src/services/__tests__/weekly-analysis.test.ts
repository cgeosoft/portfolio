/** Weekly analysis: the push fallback, schedule edges and the run flow with stubbed report and model. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, setSystemTime } from "bun:test";
import { fallbackSummary, lastSlot, isAnalysisDue, nextAnalysisRun, analysisWeekKey, WeeklyAnalysisService } from "../weekly-analysis.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { loadConfig, updateConfig } from "../../config.js";
import type { LlmService } from "../llm.js";
import type { PortfolioService } from "../portfolio.js";
import type { PortfolioReportService } from "../portfolio-report.js";
import type { PortfolioReport } from "portfolio-shared/portfolio";

const report = {
  id: "r",
  createdAt: "",
  period: "Oct 26 - Nov 1, 2026",
  weekStartDate: "2026-10-26",
  weekEndDate: "2026-11-01",
  title: "t",
  summary: "s",
  content: "## Report\nNVDA led.",
  model: "m",
  provider: "p",
  isFallback: false,
  metrics: {
    totalPortfolioValue: 98765.43,
    cashBalance: 13579.24,
    baseCurrency: "EUR",
    holdingsCount: 3,
    weeklyGainLossPercent: 2.5,
    topWinner: { symbol: "NVDA", changePercent: 4 },
    topLoser: { symbol: "AAPL", changePercent: -1.5 },
  },
} as unknown as PortfolioReport;

beforeAll(() => updateConfig({ language: "en" }));

describe("fallbackSummary", () => {
  it("shows the week in numbers", () => {
    expect(fallbackSummary(report)).toBe(
      "**Weekly analysis Oct 26 - Nov 1, 2026**\n- Return of the week: +2.50%\n- Top gainer: NVDA +4.00%\n- Top decliner: AAPL -1.50%\n\n_Open Portfolio, Reports for the full analysis._",
    );
  });

  it("adds fact lines after the decliner", () => {
    const fact = "- Week vs S&P 500: +1.00% vs +0.50% (+0.50 pts)";
    expect(fallbackSummary(report, { lines: [fact] })).toContain(`- Top decliner: AAPL -1.50%\n${fact}\n\n`);
  });

  it("falls back to the period return, or leaves it out", () => {
    const period = { ...report, metrics: { ...report.metrics, weeklyGainLossPercent: undefined, periodGainLossPercent: -0.256 } } as PortfolioReport;
    expect(fallbackSummary(period)).toContain("- Return of the week: -0.26%");
    const none = { ...report, metrics: { ...report.metrics, weeklyGainLossPercent: undefined, periodGainLossPercent: undefined } } as PortfolioReport;
    expect(fallbackSummary(none)).not.toContain("Return of the week");
  });

  it("never contains balances", () => {
    const text = fallbackSummary(report);
    expect(text).not.toContain("98765");
    expect(text).not.toContain("13579");
  });
});

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

  it("keys ISO weeks", () => {
    expect(analysisWeekKey(new Date("2026-09-14T09:00:00"))).toBe("2026-w37");
    expect(analysisWeekKey(new Date("2026-10-31T10:00:00"))).toBe("2026-w44");
    expect(analysisWeekKey(new Date("2027-01-04T09:00:00"))).toBe("2026-w53");
  });
});

describe("WeeklyAnalysisService.run", () => {
  const KEYS = ["weeklyAnalysisPortfolioId", "weeklyAnalysisLastRun", "gotifyUrl", "gotifyToken", "ntfyTopic", "language"] as const;
  let saved: Record<string, unknown> = {};
  let row: { id: string; name: string; description?: string | null; baseCurrency?: string };
  const originalFetch = globalThis.fetch;
  let fetchCalls: { url: string; init: RequestInit }[] = [];

  const calls: { portfolio: unknown; opts: { weekKey?: string; portfolioData?: unknown } }[] = [];
  let currentReport: PortfolioReport = report;
  let reportError: Error | null = null;
  const reportService = {
    generateReport: async (portfolio: unknown, opts: { weekKey?: string; portfolioData?: unknown }) => {
      calls.push({ portfolio, opts });
      if (reportError) throw reportError;
      return currentReport;
    },
  } as unknown as PortfolioReportService;
  const portfolioService = { getPortfolioData: async () => ({ summary: {}, holdings: [] }) } as unknown as PortfolioService;
  const captured: { role: string; content: string }[][] = [];
  let summaryReply: () => Promise<string> = async () => "**Week +2.50%**\n- a\n- b\n- c";
  const llm = {
    chat: async (m: { role: string; content: string }[]) => {
      captured.push(m);
      return summaryReply();
    },
    resolve: () => ({}),
  } as unknown as LlmService;

  const newService = () => new WeeklyAnalysisService(llm, portfolioService, reportService);
  const pushed = () => String(JSON.parse(String(fetchCalls[0]!.init.body)).message);

  beforeAll(() => {
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    saved = Object.fromEntries(KEYS.map((k) => [k, cfg[k]]));
    row = portfolioRepo.create({ name: "Growth", baseCurrency: "EUR" });
    updateConfig({ weeklyAnalysisPortfolioId: row.id, gotifyUrl: "https://gotify.example.com", gotifyToken: "t", ntfyTopic: "", language: "en" });
  });

  afterAll(() => {
    portfolioRepo.deleteById(row.id);
    updateConfig(saved as Parameters<typeof updateConfig>[0]);
  });

  beforeEach(() => {
    setSystemTime(new Date("2026-10-31T10:00:00"));
    calls.length = 0;
    captured.length = 0;
    currentReport = report;
    reportError = null;
    summaryReply = async () => "**Week +2.50%**\n- a\n- b\n- c";
    fetchCalls = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init: init ?? {} });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    setSystemTime();
    globalThis.fetch = originalFetch;
  });

  it("writes the report and pushes a summary", async () => {
    const res = await newService().run("manual");
    expect(res).toMatchObject({ success: true, portfolios: 1, delivered: 1, message: "Wrote 1 weekly report(s) and delivered 1 summary(ies) through Gotify." });
    expect(calls[0]!.opts.weekKey).toBe("2026-w44");
    expect(calls[0]!.opts.portfolioData).toBeDefined();
    expect(calls[0]!.portfolio).toEqual({ id: row.id, name: "Growth", description: row.description, baseCurrency: "EUR" });
    const body = JSON.parse(String(fetchCalls[0]!.init.body));
    expect(body.title).toBe("Growth: weekly analysis");
    expect(body.message).toBe("**Week +2.50%**\n- a\n- b\n- c\n\n_Open Portfolio, Reports for the full analysis._");
    expect(captured[0]![0]!.content).toContain("Never write money amounts, balances or position values");
    expect(captured[0]![1]!.content).toBe("## Report\nNVDA led.");
  });

  it("pushes the fallback for a fallback report without asking the model", async () => {
    currentReport = { ...report, isFallback: true, error: "down" } as PortfolioReport;
    const res = await newService().run("manual");
    expect(captured.length).toBe(0);
    expect(pushed()).toBe(fallbackSummary(report));
    expect(res.error).toBe("Assistant: down");
    expect(pushed()).not.toContain("98765");
  });

  it("pushes the fallback when the summary fails", async () => {
    summaryReply = async () => {
      throw new Error("x");
    };
    const res = await newService().run("manual");
    expect(pushed()).toBe(fallbackSummary(report));
    expect(res.error).toBe("Assistant summary: x");
    expect(res.delivered).toBe(1);
  });

  it("pushes the fallback for an empty summary", async () => {
    summaryReply = async () => "  ";
    const res = await newService().run("manual");
    expect(pushed()).toBe(fallbackSummary(report));
    expect(res.error).toBeUndefined();
  });

  it("writes only the report without channels", async () => {
    updateConfig({ gotifyUrl: "" });
    try {
      const res = await newService().run("manual");
      expect(fetchCalls.length).toBe(0);
      expect(captured.length).toBe(0);
      expect(res).toMatchObject({
        success: true,
        delivered: 0,
        message: "Wrote 1 weekly report(s) to Reports. Set up a phone app under Settings, Notifications to receive a summary as a push notification.",
      });
    } finally {
      updateConfig({ gotifyUrl: "https://gotify.example.com" });
    }
  });

  it("reports a failing portfolio by name", async () => {
    reportError = new Error("Portfolio not found");
    const res = await newService().run("manual");
    expect(res).toMatchObject({ success: false, portfolios: 0, error: "Growth: Portfolio not found" });
  });

  it("marks the day only on a scheduled run", async () => {
    updateConfig({ weeklyAnalysisLastRun: "2026-10-01" });
    await newService().run("manual");
    expect(loadConfig().weeklyAnalysisLastRun).toBe("2026-10-01");
    await newService().run("schedule");
    expect(loadConfig().weeklyAnalysisLastRun).toBe("2026-10-31");
  });

  it("refuses an overlapping run", async () => {
    const svc = newService();
    const a = svc.run("manual");
    const b = await svc.run("manual");
    expect(b.success).toBe(false);
    expect(b.error).toBe("A weekly analysis is already running.");
    await a;
  });
});
