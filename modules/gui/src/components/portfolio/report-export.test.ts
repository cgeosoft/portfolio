import { describe, it, expect } from "bun:test";
import {
  ENGLISH_REPORT_EXPORT_TEXT,
  generateReportMarkdown,
  generateReportPdf,
  getDefaultReportFilename,
} from "./report-export";
import type { PortfolioReport } from "portfolio-shared/portfolio";

describe("Report Export Utilities", () => {
  const mockReport: PortfolioReport = {
    id: "test-report-1",
    createdAt: "2026-09-07T08:00:00.000Z",
    period: "2026-W36",
    weekKey: "2026-W36",
    weekStartDate: "2026-08-31",
    weekEndDate: "2026-09-06",
    title: "Weekly Tactical Portfolio Briefing",
    summary: "Portfolio showed resilient growth with tech equities leading gains.",
    content: "## Overview\nPortfolio assets maintained strong momentum.\n- Asset A gained +5.2%\n- Asset B remained flat",
    model: "llama-3.3-70b",
    provider: "groq",
    metrics: {
      totalPortfolioValue: 125400.5,
      cashBalance: 14200.0,
      periodGainLossDollar: 3200.5,
      periodGainLossPercent: 2.62,
      holdingsCount: 8,
      baseCurrency: "EUR",
    },
  };

  it("generates formatted report filename with correct extensions", () => {
    const mdName = getDefaultReportFilename(mockReport, "markdown", "Main Growth");
    expect(mdName).toBe("main-growth-report-2026-w36.md");

    const pdfName = getDefaultReportFilename(mockReport, "pdf", "Main Growth");
    expect(pdfName).toBe("main-growth-report-2026-w36.pdf");
  });

  it("generates markdown with YAML frontmatter, title, summary, and content", () => {
    const md = generateReportMarkdown(mockReport, "Main Growth", false);
    expect(md).toContain("---");
    expect(md).toContain('portfolio: "Main Growth"');
    expect(md).toContain('report_id: "test-report-1"');
    expect(md).toContain("# Weekly Tactical Portfolio Briefing");
    expect(md).toContain("> **Executive Summary:**");
    expect(md).toContain("Portfolio showed resilient growth");
    expect(md).toContain("Asset A gained +5.2%");
  });

  it("masks financial values in markdown export when hideValues is true", () => {
    const md = generateReportMarkdown(mockReport, "Main Growth", true);
    expect(md).toContain('portfolio_valuation: "******"');
  });

  it("generates a valid PDF blob", async () => {
    const blob = await generateReportPdf(mockReport, "Main Growth", false);
    expect(blob).toBeDefined();
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toBe("application/pdf");
  });
});

describe("report export fallbacks", () => {
  const bare: PortfolioReport = {
    id: "r1",
    createdAt: "2026-09-07T08:00:00.000Z",
    period: "",
    weekStartDate: "",
    weekEndDate: "",
    title: "",
    summary: "",
    content: "<think>hidden</think>Body $1,234",
    model: "",
    provider: "",
    metrics: { totalPortfolioValue: 0, cashBalance: 0, baseCurrency: "", holdingsCount: 0 },
  };

  it("falls back to the created date, period or week key in filenames", () => {
    expect(getDefaultReportFilename(bare, "pdf")).toBe("portfolio-report-2026-09-07.pdf");
    expect(getDefaultReportFilename({ ...bare, period: "Q3 2026" }, "markdown", "My  Portfolio_1")).toBe("my-portfolio_1-report-q3-2026.md");
    expect(getDefaultReportFilename({ ...bare, weekKey: "2026-W01" }, "markdown", "Ünïcode Fund!!")).toBe("n-code-fund-report-2026-w01.md");
  });

  it("falls back to the report id in the title and leaves out empty fields", () => {
    const md = generateReportMarkdown(bare, undefined as any, false);
    expect(md).toContain("# Portfolio Tactical Briefing (r1)");
    expect(md).not.toContain("Executive Summary");
    expect(md).toContain('status: "success"');
    expect(md).toContain("portfolio_valuation: 0");
    expect(md).toContain("holdings_count: 0");
    expect(md).not.toContain("base_currency");
    expect(md).not.toMatch(/^portfolio:/m);
  });

  it("leaves out metric lines without metrics", () => {
    const md = generateReportMarkdown({ ...bare, metrics: undefined as any }, undefined as any, false);
    expect(md).not.toContain("portfolio_valuation");
    expect(md).not.toContain("holdings_count");
  });

  it("masks the summary when values are hidden", () => {
    expect(generateReportMarkdown({ ...bare, summary: "Cash is $1,234.56" }, "P", true)).toContain("> Cash is $••••");
  });

  it("uses a custom text bundle", () => {
    const text = { ...ENGLISH_REPORT_EXPORT_TEXT, markdownTitle: (p: string) => `T(${p})`, markdownSummary: "Sum:" };
    const md = (generateReportMarkdown as any)({ ...bare, summary: "S" }, undefined, false, text);
    expect(md).toContain("# T(r1)");
    expect(md).toContain("> **Sum:**");
  });

  it("quotes the portfolio name as JSON", () => {
    expect(generateReportMarkdown(bare, 'He said "hi"', false)).toContain('portfolio: "He said \\"hi\\""');
  });

  it("closes the frontmatter on its own line", () => {
    const md = generateReportMarkdown(bare, undefined as any, false);
    expect(md.startsWith("---\nreport_id:")).toBe(true);
    expect(md).toContain("\n---\n# Portfolio Tactical Briefing (r1)\n");
  });

  it("removes think blocks and keeps the rest", () => {
    const md = generateReportMarkdown(bare, undefined as any, false);
    expect(md).toContain("Body $1,234");
    expect(md).not.toContain("hidden");
  });
});
