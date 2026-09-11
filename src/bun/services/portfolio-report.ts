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
import { FinnhubService, type FinnhubReportIntelligence } from "./finnhub.js";
import type { YahooFinanceService } from "./yahoo-finance.js";
import type { PortfolioItem, FinancialPortfolioData, PortfolioReport } from "../../types/portfolio.js";
import type {
  PrepareReportPromptResponse,
  StartReportStreamRequest,
  StartReportStreamResponse,
  PollReportStreamResponse,
  CancelReportStreamResponse,
} from "../../shared/rpc-types.js";
import {
  DEFAULT_NEBIUS_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_URL,
} from "../../shared/llm-defaults.js";

function getIsoWeekKey(date: Date): string {
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

export class PortfolioReportService {
  private readonly streamSessions = new Map<string, ReportStreamSession>();

  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
    private readonly finnhub: FinnhubService = new FinnhubService(),
    private readonly yahoo?: YahooFinanceService,
  ) {
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
    const provider = options.provider || config.llmProvider || "llamacpp-server";

    const defaultModel =
      provider === "groq" ? "llama-3.3-70b-versatile"
        : provider === "openai" ? "gpt-4o-mini"
        : provider === "anthropic" ? "claude-3-5-sonnet-20241022"
        : provider === "openrouter" ? "meta-llama/llama-3.3-70b-instruct"
        : provider === "deepseek" ? "deepseek-chat"
        : provider === "gemini" ? "gemini-2.5-flash"
        : provider === "nebius" ? "meta-llama/Llama-3.3-70B-Instruct"
        : provider === "ollama" ? DEFAULT_OLLAMA_MODEL
        // llama.cpp and custom openai-compatible have no fixed default.
        : "";

    const model = options.model || config.llmModel || defaultModel;
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
          `- **${h.symbol}** (${h.name}, ${h.assetType}): ${h.weightPercent}% weight | Day: ${h.dayChangePercent > 0 ? "+" : ""}${h.dayChangePercent}% | Total Gain: ${h.totalGainLossPercent > 0 ? "+" : ""}${h.totalGainLossPercent}% | SMA50: ${h.sma50 ?? "N/A"} | SMA200: ${h.sma200 ?? "N/A"} | RSI: ${h.rsi ?? "N/A"}`,
      )
      .join("\n");

    // Retrieve real-time market news and holding intelligence from Finnhub if configured
    const isFinnhubConfigured = this.finnhub.isConfigured();
    let finnhubIntelligence: FinnhubReportIntelligence | null = null;

    if (isFinnhubConfigured) {
      const targetSymbols = nonCashHoldings
        .slice()
        .sort((a, b) => b.weightPercent - a.weightPercent)
        .map((h) => h.symbol);

      try {
        finnhubIntelligence = await this.finnhub.getReportMarketIntelligence({
          symbols: targetSymbols,
          fromDate: weekStartDate,
          toDate: weekEndDate,
          maxSymbols: 5,
        });
      } catch (finnhubErr) {
        appLogger.logStep("warning", "report", "finnhub_enrichment_failed", "Failed to enrich report with Finnhub data", undefined, {
          error: finnhubErr instanceof Error ? finnhubErr.message : String(finnhubErr),
        });
      }
    }

    let finnhubContext = "";
    const sections: string[] = [];
    const routing = config.dataProviderRouting;

    // Check if Yahoo market news is requested or needed as fallback
    if ((routing?.news === "yahoo" || !finnhubIntelligence?.marketNews?.length) && this.yahoo) {
      try {
        const yahooNews = await this.yahoo.getMarketNews(4);
        if (yahooNews.length > 0) {
          const newsLines = yahooNews
            .map((n) => `- **${n.headline}** (${n.source}): ${n.summary}`)
            .join("\n");
          sections.push(`### Financial Market & Macroeconomic News (Yahoo Finance)\n${newsLines}`);
        }
      } catch {
        // Safe fallback, one provider does not affect the other
      }
    }

    if (finnhubIntelligence && finnhubIntelligence.configured) {
      if ((!routing || routing.news === "finnhub" || sections.length === 0) && finnhubIntelligence.marketNews.length > 0) {
        const newsLines = finnhubIntelligence.marketNews
          .map((n) => `- **${n.headline}** (${n.source}): ${n.summary}`)
          .join("\n");
        sections.push(`### Financial Market & Macroeconomic News (Finnhub API)\n${newsLines}`);
      }

      if (!routing || routing.fundamentals === "finnhub") {
        const holdingSymbols = Object.keys(finnhubIntelligence.holdings);
        if (holdingSymbols.length > 0) {
          const holdingLines: string[] = [];
          for (const sym of holdingSymbols) {
            const intel = finnhubIntelligence.holdings[sym]!;
            const parts: string[] = [];
            if (intel.profile?.name && intel.profile?.industry) {
              parts.push(`${intel.profile.name} (${intel.profile.industry})`);
            }
            if (intel.recommendation) {
              const r = intel.recommendation;
              parts.push(
                `Analyst Consensus: ${r.strongBuy} Strong Buy, ${r.buy} Buy, ${r.hold} Hold, ${r.sell} Sell, ${r.strongSell} Strong Sell`,
              );
            }
            if (intel.metrics) {
              const m = intel.metrics;
              const metricList: string[] = [];
              if (m.peRatio !== undefined) metricList.push(`P/E: ${m.peRatio}`);
              if (m.beta !== undefined) metricList.push(`Beta: ${m.beta}`);
              if (m.fiftyTwoWeekHigh !== undefined && m.fiftyTwoWeekLow !== undefined) {
                metricList.push(`52W: ${m.fiftyTwoWeekLow} - ${m.fiftyTwoWeekHigh}`);
              }
              if (m.dividendYield !== undefined) metricList.push(`Div Yield: ${m.dividendYield}%`);
              if (metricList.length > 0) parts.push(metricList.join(" | "));
            }
            if (intel.news.length > 0) {
              const newsList = intel.news.map((n) => `  * "${n.headline}" (${n.source})`).join("\n");
              parts.push(`Recent Headlines:\n${newsList}`);
            }

            holdingLines.push(`- **${sym}**:\n  ${parts.join("\n  ")}`);
          }
          sections.push(`### Key Asset Intelligence & Analyst Consensus (Finnhub API)\n${holdingLines.join("\n")}`);
        }
      }
    }

    if (sections.length > 0) {
      finnhubContext = `\n## Real-Time Market Intelligence\n${sections.join("\n\n")}\n`;
    }

    const structureInstructions = finnhubIntelligence?.configured
      ? `Please structure your report as follows:
1. **Executive Summary & Macro Overview** (2-3 concise paragraphs. Synthesize portfolio movement with the provided macroeconomic and financial market news.)
2. **Key Asset Performance Highlights** (Winners, laggards, technical status with SMAs/RSI, incorporating relevant company headlines and analyst recommendations)
3. **Risk Exposure & Allocation Assessment** (Sector/asset concentration, valuation multiples/beta, and cash buffer)
4. **Tactical Action Items & Strategic Rebalancing** (Clear, bulleted recommendations)`
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
- **Asset Breakdown**: Stocks ${summary.stockWeightPercent}%, ETFs ${summary.etfWeightPercent}%, Crypto ${summary.cryptoWeightPercent}%, Cash ${summary.cashWeightPercent}%

## Holdings Ledger
${holdingsContext}
${finnhubContext}
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
      finnhubEnriched: Boolean(finnhubIntelligence && finnhubIntelligence.configured),
      finnhubNewsCount: finnhubIntelligence ? finnhubIntelligence.summaryStats.totalNewsArticles : 0,
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
      finnhubIntelligence,
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
      finnhubConfigured: Boolean(ctx.finnhubIntelligence?.configured),
      finnhubNewsCount: ctx.finnhubIntelligence ? ctx.finnhubIntelligence.summaryStats.totalNewsArticles : 0,
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

        const config = loadConfig();
        const provider = params.provider || ctx.provider;
        const model = params.model || ctx.model;
        const apiKey = params.apiKey || config.llmApiKeys?.[provider] || config.llmApiKey;
        const baseUrl =
          params.baseUrl ||
          config.llmBaseUrls?.[provider] ||
          config.llmBaseUrl ||
          (provider === "nebius" ? DEFAULT_NEBIUS_URL : undefined) ||
          (provider === "openai-compatible" ? DEFAULT_OPENAI_COMPATIBLE_URL : undefined) ||
          (provider === "llamacpp-server" || provider === "llamacpp" ? config.llamacppServerUrl : undefined);

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
    const config = loadConfig();
    const provider = options.provider || ctx.provider;
    const model = options.model || ctx.model;
    const apiKey = options.apiKey || config.llmApiKeys?.[provider] || config.llmApiKey;
    const baseUrl =
      options.baseUrl ||
      config.llmBaseUrls?.[provider] ||
      config.llmBaseUrl ||
      (provider === "llamacpp-server" || provider === "llamacpp" ? config.llamacppServerUrl : undefined);

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
