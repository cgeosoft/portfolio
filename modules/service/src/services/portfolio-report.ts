/** Stored reports. Guided Analysis writes one with each run. */

import { sanitizeLlmResponse } from "./llm.js";
import * as reportRepo from "../db/report.repo.js";
import type { ReportMetrics } from "../db/report.repo.js";
import type { PortfolioReport } from "portfolio-shared/portfolio";

export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year}-w${String(weekNo).padStart(2, "0")}`;
}

export class PortfolioReportService {
  public getReports(portfolioId: string): { reports: PortfolioReport[]; latestReport?: PortfolioReport } {
    const reports = reportRepo.findByPortfolio(portfolioId).map((r) => ({
      ...r,
      content: sanitizeLlmResponse(r.content),
      prompt: r.prompt ?? null,
      error: r.error ?? undefined,
      metrics: JSON.parse(r.metrics) as ReportMetrics,
      isFallback: Boolean(r.isFallback),
    }));

    return {
      reports,
      latestReport: reports[0],
    };
  }
}
