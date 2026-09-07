import { describe, it, expect } from "bun:test";
import {
  generateReportMarkdown,
  generateReportPdf,
  getDefaultReportFilename,
} from "../../../views/src/components/portfolio/report-export";
import type { PortfolioReport } from "../../../types/portfolio";

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
