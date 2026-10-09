import { describe, it, expect } from "bun:test";
import {
  buildReportIntelSections,
  comparisonForWindow,
  EMPTY_REPORT_INTEL,
  formatEventsForPrompt,
  formatMacroForPrompt,
  weeklyYieldChange,
} from "../ai-context.js";
import type { BenchmarkComparison, MacroSnapshot, PortfolioEventsResponse } from "portfolio-shared/api-types";

const comparison: BenchmarkComparison = {
  symbol: "^GSPC",
  label: "S&P 500",
  range: "1y",
  from: "2026-10-01",
  to: "2026-10-09",
  portfolioReturnPercent: 10,
  benchmarkReturnPercent: 5,
  excessReturnPercent: 5,
  series: [
    { date: "2026-10-01", portfolio: 0, benchmark: 0 },
    { date: "2026-10-02", portfolio: 0, benchmark: 0 },
    { date: "2026-10-05", portfolio: 10, benchmark: 5 },
    { date: "2026-10-09", portfolio: 21, benchmark: 5 },
  ],
  source: "yahoo",
};

describe("ai-context", () => {
  it("rebases a cumulative comparison to one week", () => {
    const w = comparisonForWindow(comparison, "2026-10-05", "2026-10-11");
    expect(w).not.toBeNull();
    expect(w!.from).toBe("2026-10-02");
    expect(w!.to).toBe("2026-10-09");
    expect(w!.portfolioReturnPercent).toBe(21);
    expect(w!.benchmarkReturnPercent).toBe(5);
    expect(w!.excessReturnPercent).toBe(16);
  });

  it("returns null when the series does not cover the week", () => {
    expect(comparisonForWindow(comparison, "2026-09-01", "2026-09-07")).toBeNull();
  });

  it("computes the weekly yield change in percentage points", () => {
    const history = [
      { date: "2026-09-25", year10: 4.1 },
      { date: "2026-10-02", year10: 4.2 },
      { date: "2026-10-09", year10: 4.05 },
    ];
    expect(weeklyYieldChange(history, "year10")).toBe(-0.15);
    expect(weeklyYieldChange(history, "year2")).toBeUndefined();
  });

  it("leaves out empty macro pieces", () => {
    const empty: MacroSnapshot = {
      asOf: "2026-10-10T00:00:00Z",
      baseCurrency: "EUR",
      yieldCurve: null,
      indicators: null,
      calendar: null,
      riskPremium: null,
      sectors: null,
      riskFreeRate: { rate: 0.03, source: "default" },
    };
    expect(formatMacroForPrompt(empty)).toBe("");
    expect(formatMacroForPrompt(null)).toBe("");
  });

  it("filters events by kind and date and shows no money amounts beyond per-share dividends", () => {
    const res: PortfolioEventsResponse = {
      portfolioId: "p",
      baseCurrency: "EUR",
      days: 2,
      from: "2026-10-10",
      to: "2026-10-12",
      sources: ["fmp"],
      events: [
        { date: "2026-10-10", kind: "earnings", symbol: "AAA", name: "A", time: "amc", epsEstimate: 1.2, source: "fmp" },
        { date: "2026-10-11", kind: "exDividend", symbol: "BBB", name: "B", amountPerShare: 0.5, currency: "USD", expectedIncome: 123, source: "fmp" },
        { date: "2026-10-11", kind: "dividendPayment", symbol: "BBB", name: "B", amountPerShare: 0.5, currency: "USD", expectedIncome: 123, source: "fmp" },
        { date: "2026-10-12", kind: "earnings", symbol: "CCC", name: "C", source: "fmp" },
      ],
    };
    const text = formatEventsForPrompt(res, { kinds: ["earnings", "exDividend"], from: "2026-10-10", to: "2026-10-11" });
    expect(text).toContain("AAA: earnings report, after the close, EPS estimate 1.2");
    expect(text).toContain("BBB: ex-dividend date, 0.5 USD per share");
    expect(text).not.toContain("dividend payment");
    expect(text).not.toContain("CCC");
    expect(text).not.toContain("123");
    expect(formatEventsForPrompt({ ...res, events: [] })).toBe("");
  });

  it("builds no report section without data", () => {
    const res = buildReportIntelSections(EMPTY_REPORT_INTEL, { from: "2026-10-05", to: "2026-10-11" });
    expect(res.text).toBe("");
    expect(res.sections).toEqual([]);
    expect(res.newsCount).toBe(0);
  });
});
