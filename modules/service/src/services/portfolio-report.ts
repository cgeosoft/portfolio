/**
 * Portfolio report generation service.
 * Handles report preparation, LLM streaming, and report persistence.
 */

import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import { sanitizeLlmResponse, type LlmService } from "./llm.js";
import type { PortfolioService } from "./portfolio.js";
import * as reportRepo from "../db/report.repo.js";
import * as portfolioRepo from "../db/portfolio.repo.js";
import type { ReportMetrics } from "../db/report.repo.js";
import { buildReportIntelSections, collectReportIntel, EMPTY_REPORT_INTEL, type AiContextDeps, type ReportIntel, type ReportIntelRequest } from "./ai-context.js";
import type { PortfolioItem, FinancialPortfolioData, PortfolioReport } from "portfolio-shared/portfolio";
import type {
  PrepareReportPromptResponse,
  StartReportStreamRequest,
  StartReportStreamResponse,
  PollReportStreamResponse,
  CancelReportStreamResponse,
} from "portfolio-shared/api-types";

export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year}-w${String(weekNo).padStart(2, "0")}`;
}

function parseIsoWeekKey(weekKey: string): { monday: Date; sunday: Date; weekKey: string } | null {
  const match = weekKey.trim().match(/^(\d{4})-[wW](\d{1,2})$/);
  if (!match) return null;
  const year = parseInt(match[1]!, 10);
  const weekNo = parseInt(match[2]!, 10);
  if (weekNo < 1 || weekNo > 53) return null;

  const jan4 = new Date(year, 0, 4, 12, 0, 0);
  const dayNum = jan4.getDay() || 7;
  const monday = new Date(year, 0, 4 - (dayNum - 1) + (weekNo - 1) * 7, 12, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const normalizedKey = `${year}-w${String(weekNo).padStart(2, "0")}`;
  return { monday, sunday, weekKey: normalizedKey };
}

function formatDateRange(startDate: Date, endDate: Date): string {
  const startStr = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} - ${endStr}`;
}

function extractLastWords(text: string, count = 50): string {
  if (!text) return "";
  const cleaned = sanitizeLlmResponse(text);
  const words = cleaned.trim().split(/\s+/).filter(Boolean);
  if (words.length <= count) return words.join(" ");
  return words.slice(-count).join(" ");
}

interface ReportStreamSession {
  sessionId: string;
  portfolioId: string;
  abortController: AbortController;
  status: "running" | "success" | "fail" | "cancelled";
  accumulatedText: string;
  lastWords: string;
  chunkCount: number;
  report?: PortfolioReport;
  error?: string;
  createdAt: number;
}

/** Collects the market context of a report. Tests pass a stub; without one a report has the ledger only. */
export type ReportIntelLoader = (req: ReportIntelRequest) => Promise<ReportIntel>;

/** A report week counts as current while it has not ended more than this many days ago. */
const CURRENT_WEEK_GRACE_DAYS = 3;

export class PortfolioReportService {
  private readonly streamSessions = new Map<string, ReportStreamSession>();
  private readonly loadIntel: ReportIntelLoader;

  /**
   * `intel` is the service set of container.ts (provider chain: FMP, then
   * Finnhub or Yahoo) or a loader function for tests.
   */
  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
    intel?: AiContextDeps | ReportIntelLoader,
  ) {
    if (typeof intel === "function") {
      this.loadIntel = intel;
    } else if (intel) {
      const deps = intel;
      this.loadIntel = (req) => collectReportIntel(deps, req);
    } else {
      this.loadIntel = async () => EMPTY_REPORT_INTEL;
    }
    // Periodically clean up stale sessions (older than 15 minutes)
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.streamSessions.entries()) {
        if (now - session.createdAt > 15 * 60 * 1000) {
          this.streamSessions.delete(id);
        }
      }
    }, 5 * 60 * 1000).unref?.();
  }

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

  public deleteReport(portfolioId: string, id: string): boolean {
    return reportRepo.deleteById(id, portfolioId);
  }

  /**
   * Internal helper to build prompts and context from portfolio data.
   */
  public async buildReportContext(
    portfolioId: string,
    options: {
      provider?: string;
      model?: string;
      portfolioData?: FinancialPortfolioData;
      weekKey?: string;
    } = {},
  ) {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) throw new Error("Portfolio not found");

    const config = loadConfig();
    // An empty model lets the server or the Claude CLI pick its default.
    const provider = options.provider || config.llmProvider || "openai-compatible";
    const model = options.model || config.llmModel || "";
    const baseCurrency = portfolio.baseCurrency || config.baseCurrency || "EUR";
    const data = options.portfolioData || (await this.portfolioService.getPortfolioData(portfolio.id, baseCurrency));

    let weekKey: string;
    let monday: Date;
    let sunday: Date;

    const parsed = options.weekKey ? parseIsoWeekKey(options.weekKey) : null;
    if (parsed) {
      weekKey = parsed.weekKey;
      monday = parsed.monday;
      sunday = parsed.sunday;
    } else {
      const now = new Date();
      weekKey = getIsoWeekKey(now);
      const dayOfWeek = now.getDay();
      const diffToMonday = (dayOfWeek + 6) % 7;
      monday = new Date(now);
      monday.setDate(now.getDate() - diffToMonday);
      sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
    }

    const weekStartDate = monday.toISOString().split("T")[0]!;
    const weekEndDate = sunday.toISOString().split("T")[0]!;
    const period = formatDateRange(monday, sunday);

    const summary = data.summary;
    const holdings = data.holdings || [];

    const nonCashHoldings = holdings.filter((h) => h.assetType !== "Cash");
    const sorted = [...nonCashHoldings].sort((a, b) => b.dayChangePercent - a.dayChangePercent);
    const topWinner = sorted[0] ? { symbol: sorted[0].symbol, changePercent: sorted[0].dayChangePercent } : undefined;
    const topLoser = sorted.length > 1
      ? { symbol: sorted[sorted.length - 1]!.symbol, changePercent: sorted[sorted.length - 1]!.dayChangePercent }
      : undefined;

    const holdingsContext = holdings
      .map(
        (h) =>
          `- **${h.symbol}** (${h.name}, ${h.assetType}): ${h.weightPercent}% weight | Day: ${h.dayChangePercent > 0 ? "+" : ""}${h.dayChangePercent}% | Total Gain: ${h.totalGainLossPercent > 0 ? "+" : ""}${h.totalGainLossPercent}% | SMA50: ${h.sma50 ?? "N/A"} | SMA200: ${h.sma200 ?? "N/A"} | RSI: ${h.rsi ?? "N/A"}${h.isPrivate ? " | Private asset, no market price" : h.quoteMissing ? " | No market quote, valued at buy price" : ""}`,
      )
      .join("\n");

    // Market context through the provider chain (FMP first, then Finnhub or Yahoo). Every piece may be missing.
    const today = new Date().toISOString().slice(0, 10);
    const graceEnd = new Date(`${weekEndDate}T12:00:00Z`);
    graceEnd.setUTCDate(graceEnd.getUTCDate() + CURRENT_WEEK_GRACE_DAYS);
    const current = today >= weekStartDate && today <= graceEnd.toISOString().slice(0, 10);
    let intelSections = buildReportIntelSections(EMPTY_REPORT_INTEL, { from: weekStartDate, to: weekEndDate });
    try {
      const intel = await this.loadIntel({ portfolioId: portfolio.id, holdings, baseCurrency, current });
      intelSections = buildReportIntelSections(intel, { from: weekStartDate, to: weekEndDate });
    } catch (err) {
      appLogger.logStep("warning", "report", "intel_failed", `Report market context failed (${err instanceof Error ? err.name : typeof err})`);
    }
    const intelContext = intelSections.text;

    const structureInstructions = intelSections.sections.length > 0
      ? `Please structure your report as follows:
1. **Executive Summary & Macro Overview** (2-3 concise paragraphs. Synthesize portfolio movement with the provided market news, macro snapshot and benchmark comparison when given.)
2. **Key Asset Performance Highlights** (Winners, laggards, technical status with SMAs/RSI, incorporating relevant company headlines, analyst views and earnings call summaries when given)
3. **Risk Exposure & Allocation Assessment** (Sector, country and single-stock concentration after ETF look-through when given, valuation multiples, cash buffer)
4. **Income & Week Ahead** (Dividend yield and the upcoming earnings, ex-dividend dates and economic releases when given; leave this section out when no such data is given)
5. **Tactical Action Items & Strategic Rebalancing** (Clear, bulleted recommendations)`
      : `Please structure your report as follows:
1. **Executive Summary & Macro Overview** (2-3 concise paragraphs)
2. **Key Asset Performance Highlights** (Winners, laggards, technical status with SMAs/RSI)
3. **Risk Exposure & Allocation Assessment** (Sector/asset concentration, cash buffer)
4. **Tactical Action Items & Strategic Rebalancing** (Clear, bulleted recommendations)`;

    const systemPrompt =
      "You are a sophisticated, analytical quantitative investment portfolio analyst. You provide objective, concise, actionable commentary on portfolio performance, asset allocation, technical market trends, risk concentrations, and strategic rebalancing recommendations in clean markdown format. Maintain a professional, cyberpunk-tactical yet measured tone.";

    const userPrompt = `
Analyze the following investment portfolio state for portfolio **"${portfolio.name}"** for period **${period}** (${weekKey}):

## Portfolio Metrics
- **Cash Liquidity**: ${summary.cashWeightPercent}%
- **Lifetime Unrealized Gain**: ${summary.totalGainLossPercent >= 0 ? "+" : ""}${summary.totalGainLossPercent}%
- **Day Change**: ${summary.dayGainLossPercent >= 0 ? "+" : ""}${summary.dayGainLossPercent}%
- **Asset Breakdown**: Stocks ${summary.stockWeightPercent}%, ETFs ${summary.etfWeightPercent}%, Crypto ${summary.cryptoWeightPercent}%, Private & Other ${summary.otherWeightPercent ?? 0}%, Cash ${summary.cashWeightPercent}%

## Holdings Ledger
${holdingsContext}
${intelContext}
${structureInstructions}

## General Rules
1. Use ASD-STE100 simplified english text
2. Do not use emojis or special characters
3. Do not split section with lines ---
4. Do not use long dash characters
`;

    const metrics: ReportMetrics = {
      totalPortfolioValue: summary.totalPortfolioValue || summary.totalValue,
      weeklyGainLossDollar: summary.dayGainLossDollar,
      weeklyGainLossPercent: summary.dayGainLossPercent,
      cashBalance: summary.cashBalance || 0,
      baseCurrency,
      holdingsCount: holdings.length,
      topWinner,
      topLoser,
      finnhubEnriched: intelSections.sources.includes("finnhub"),
      finnhubNewsCount: intelSections.newsCount,
      intelSources: intelSections.sources,
    };

    return {
      portfolio,
      provider,
      model,
      baseCurrency,
      period,
      weekKey,
      weekStartDate,
      weekEndDate,
      summary,
      holdings,
      systemPrompt,
      userPrompt,
      fullPrompt: `### System Prompt\n${systemPrompt}\n\n### User Prompt\n${userPrompt.trim()}`,
      metrics,
      intelSections,
    };
  }

  /**
   * Prepare report context and return the exact prompt payload for user inspection.
   */
  public async prepareReportPrompt(
    portfolioId: string,
    options: { provider?: string; model?: string; weekKey?: string } = {},
  ): Promise<PrepareReportPromptResponse> {
    const ctx = await this.buildReportContext(portfolioId, options);
    return {
      portfolioId: ctx.portfolio.id,
      portfolioName: ctx.portfolio.name,
      baseCurrency: ctx.baseCurrency,
      period: ctx.period,
      weekKey: ctx.weekKey,
      weekStartDate: ctx.weekStartDate,
      weekEndDate: ctx.weekEndDate,
      systemPrompt: ctx.systemPrompt,
      userPrompt: ctx.userPrompt,
      fullPrompt: ctx.fullPrompt,
      provider: ctx.provider,
      model: ctx.model,
      holdingsCount: ctx.holdings.length,
      metrics: ctx.metrics,
      finnhubConfigured: ctx.intelSections.sources.includes("finnhub"),
      finnhubNewsCount: ctx.intelSections.newsCount,
      contextSources: ctx.intelSections.sources,
      contextSections: ctx.intelSections.sections,
      newsCount: ctx.intelSections.newsCount,
    };
  }

  /**
   * Start streaming report generation in the background.
   */
  public async startReportStream(
    params: StartReportStreamRequest,
  ): Promise<StartReportStreamResponse> {
    const sessionId = randomUUID();
    const abortController = new AbortController();

    const session: ReportStreamSession = {
      sessionId,
      portfolioId: params.portfolioId,
      abortController,
      status: "running",
      accumulatedText: "",
      lastWords: "",
      chunkCount: 0,
      createdAt: Date.now(),
    };

    this.streamSessions.set(sessionId, session);

    // Asynchronously execute generation
    (async () => {
      try {
        const ctx = await this.buildReportContext(params.portfolioId, {
          provider: params.provider,
          model: params.model,
          weekKey: params.weekKey,
        });

        // LlmService.resolve() fills the key and URL from the settings when these are empty.
        const provider = params.provider || ctx.provider;
        const model = params.model || ctx.model;
        const { apiKey, baseUrl } = params;

        let content = "";
        try {
          content = await this.llm.chatStream(
            [
              { role: "system", content: ctx.systemPrompt },
              { role: "user", content: ctx.userPrompt },
            ],
            (chunk) => {
              if (session.status !== "running") return;
              session.accumulatedText += chunk;
              session.chunkCount++;
              session.lastWords = extractLastWords(session.accumulatedText, 50);
            },
            {
              provider,
              model,
              apiKey,
              baseUrl,
              isReport: true,
              signal: abortController.signal,
            },
          );
        } catch (err: unknown) {
          if (abortController.signal.aborted) {
            session.status = "cancelled";
            return;
          }
          throw err;
        }

        if (abortController.signal.aborted) {
          session.status = "cancelled";
          return;
        }

        const reportId = `${ctx.portfolio.id}_${ctx.weekKey}`;
        const savedReport = reportRepo.upsert({
          id: reportId,
          portfolioId: ctx.portfolio.id,
          period: ctx.period,
          weekStartDate: ctx.weekStartDate,
          weekEndDate: ctx.weekEndDate,
          weekKey: ctx.weekKey,
          title: `${ctx.portfolio.name} - Weekly Briefing (${ctx.period})`,
          summary: `Valuation ${ctx.baseCurrency}${(ctx.summary.totalPortfolioValue || ctx.summary.totalValue).toLocaleString()} with ${ctx.summary.totalGainLossPercent >= 0 ? "+" : ""}${ctx.summary.totalGainLossPercent}% cumulative return across ${ctx.holdings.length} assets.`,
          content,
          prompt: ctx.fullPrompt,
          metrics: ctx.metrics,
          model,
          provider,
          status: "success",
          isFallback: false,
        });

        session.report = {
          ...savedReport,
          prompt: savedReport.prompt ?? null,
          error: savedReport.error ?? undefined,
          metrics: JSON.parse(savedReport.metrics) as ReportMetrics,
          isFallback: Boolean(savedReport.isFallback),
        };
        session.status = "success";
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          session.status = "cancelled";
        } else {
          const errMsg = err instanceof Error ? err.message : String(err);
          session.status = "fail";
          session.error = errMsg;
        }
      }
    })();

    return { sessionId };
  }

  /**
   * Poll active stream session for latest chunks and status.
   */
  public pollReportStream(sessionId: string): PollReportStreamResponse {
    const session = this.streamSessions.get(sessionId);
    if (!session) {
      return {
        sessionId,
        status: "fail",
        lastWords: "",
        chunkCount: 0,
        error: "Session expired or not found",
      };
    }

    return {
      sessionId,
      status: session.status,
      lastWords: session.lastWords,
      chunkCount: session.chunkCount,
      report: session.report,
      error: session.error,
    };
  }

  /**
   * Cancel an active streaming session.
   */
  public cancelReportStream(sessionId: string): CancelReportStreamResponse {
    const session = this.streamSessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      session.status = "cancelled";
      return { success: true };
    }
    return { success: false };
  }

  public async generateReport(
    portfolio: PortfolioItem,
    options: {
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      portfolioData?: FinancialPortfolioData;
      weekKey?: string;
    } = {},
  ) {
    const ctx = await this.buildReportContext(portfolio.id, options);
    // LlmService.resolve() fills the key and URL from the settings when these are empty.
    const provider = options.provider || ctx.provider;
    const model = options.model || ctx.model;
    const { apiKey, baseUrl } = options;

    let content = "";
    let reportStatus: "success" | "fallback" | "error" = "success";
    let isFallback = false;
    let errorMessage: string | undefined;

    try {
      content = await this.llm.chat(
        [
          { role: "system", content: ctx.systemPrompt },
          { role: "user", content: ctx.userPrompt },
        ],
        { provider, model, apiKey, baseUrl, isReport: true },
      );
      content = sanitizeLlmResponse(content, true);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appLogger.logStep("error", "report", "generate_llm_report", `Failed to generate LLM report: ${errMsg}`);
      reportStatus = "fallback";
      isFallback = true;
      errorMessage = errMsg;
      content = `### Automated Portfolio Briefing (${ctx.period})\n\n**Market Overview**: Total portfolio valuation stands at ${ctx.baseCurrency}${(ctx.summary.totalPortfolioValue || ctx.summary.totalValue).toLocaleString()} with ${ctx.summary.totalGainLossPercent >= 0 ? "+" : ""}${ctx.summary.totalGainLossPercent}% overall return.\n\n*Note: Detailed LLM report model was temporarily unreachable (${errMsg}). Technical metrics and ledger values remain verified.*`;
    }

    const reportId = `${portfolio.id}_${ctx.weekKey}`;
    const report = reportRepo.upsert({
      id: reportId,
      portfolioId: portfolio.id,
      period: ctx.period,
      weekStartDate: ctx.weekStartDate,
      weekEndDate: ctx.weekEndDate,
      weekKey: ctx.weekKey,
      title: `${portfolio.name} - Weekly Briefing (${ctx.period})`,
      summary: `Valuation ${ctx.baseCurrency}${(ctx.summary.totalPortfolioValue || ctx.summary.totalValue).toLocaleString()} with ${ctx.summary.totalGainLossPercent >= 0 ? "+" : ""}${ctx.summary.totalGainLossPercent}% cumulative return across ${ctx.holdings.length} assets.`,
      content,
      prompt: ctx.fullPrompt,
      metrics: ctx.metrics,
      model,
      provider,
      status: reportStatus,
      error: errorMessage,
      isFallback,
    });

    return {
      ...report,
      prompt: report.prompt ?? null,
      error: report.error ?? undefined,
      metrics: JSON.parse(report.metrics) as ReportMetrics,
      isFallback: Boolean(report.isFallback),
    };
  }
}
