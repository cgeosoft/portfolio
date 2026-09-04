/**
 * Portfolio report generation service.
 * Ported from the NestJS service, removing DI decorators.
 */

import { loadConfig } from "../config.js";
import { sanitizeLlmResponse, type LlmService } from "./llm.js";
import type { PortfolioService } from "./portfolio.js";
import * as reportRepo from "../db/report.repo.js";
import type { ReportMetrics } from "../db/report.repo.js";
import type { PortfolioItem, FinancialPortfolioData } from "../../types/portfolio.js";

function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year}-w${String(weekNo).padStart(2, "0")}`;
}

function formatDateRange(startDate: Date, endDate: Date): string {
  const startStr = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} - ${endStr}`;
}

export class PortfolioReportService {
  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
  ) {}

  public getReports(portfolioId: string) {
    const reports = reportRepo.findByPortfolio(portfolioId).map((r) => ({
      ...r,
      content: sanitizeLlmResponse(r.content),
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

  public async generateReport(
    portfolio: PortfolioItem,
    options: {
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      portfolioData?: FinancialPortfolioData;
    } = {},
  ) {
    const config = loadConfig();

    const provider = options.provider || config.llmProvider || "llamacpp-server";

    const defaultModel =
      provider === "groq" ? "llama-3.3-70b-versatile"
        : provider === "openai" ? "gpt-4o-mini"
        : provider === "anthropic" ? "claude-3-5-sonnet-20241022"
        : provider === "openrouter" ? "meta-llama/llama-3.3-70b-instruct"
        : provider === "deepseek" ? "deepseek-chat"
        : provider === "gemini" ? "gemini-2.5-flash"
        : provider === "ollama" ? "llama3.2:latest"
        : "qwen3-abliterated-14b-q4_k_m";

    const model = options.model || config.llmModel || defaultModel;
    const apiKey = options.apiKey || config.llmApiKeys?.[provider] || config.llmApiKey;
    const configuredBaseUrl = options.baseUrl || config.llmBaseUrls?.[provider] || config.llmBaseUrl;
    const baseUrl = provider === "llamacpp-server" ? undefined : configuredBaseUrl;

    const baseCurrency = portfolio.baseCurrency || config.baseCurrency || "EUR";
    const data = options.portfolioData || (await this.portfolioService.getPortfolioData(portfolio.id, baseCurrency));

    const now = new Date();
    const weekKey = getIsoWeekKey(now);
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

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
          `- **${h.symbol}** (${h.name}, ${h.assetType}): ${h.shares} units @ ${h.buyPrice} ${h.currency} | Current: ${h.currentPrice} ${h.currency} | Val: ${baseCurrency}${h.currentValue} (${h.weightPercent}% weight) | Day: ${h.dayChangePercent > 0 ? "+" : ""}${h.dayChangePercent}% | Total Gain: ${h.totalGainLossPercent > 0 ? "+" : ""}${h.totalGainLossPercent}% | SMA50: ${h.sma50 ?? "N/A"} | SMA200: ${h.sma200 ?? "N/A"} | RSI: ${h.rsi ?? "N/A"}`,
      )
      .join("\n");

    const systemPrompt =
      "You are a sophisticated, analytical quantitative investment portfolio analyst. You provide objective, concise, actionable commentary on portfolio performance, asset allocation, technical market trends, risk concentrations, and strategic rebalancing recommendations in clean markdown format. Maintain a professional, cyberpunk-tactical yet measured tone.";

    const userPrompt = `
Analyze the following investment portfolio state for portfolio **"${portfolio.name}"** for period **${period}** (${weekKey}):

## Portfolio Metrics
- **Total Portfolio Value**: ${baseCurrency}${summary.totalPortfolioValue?.toLocaleString() ?? summary.totalValue.toLocaleString()}
- **Cash Liquidity**: ${baseCurrency}${summary.cashBalance?.toLocaleString() ?? "0"} (${summary.cashWeightPercent}%)
- **Total Invested Capital**: ${baseCurrency}${summary.totalCashInjected?.toLocaleString() ?? summary.totalCost.toLocaleString()}
- **Lifetime Unrealized Gain**: ${summary.totalGainLossPercent >= 0 ? "+" : ""}${summary.totalGainLossPercent}% (${baseCurrency}${summary.totalGainLossDollar?.toLocaleString()})
- **Day Change**: ${summary.dayGainLossPercent >= 0 ? "+" : ""}${summary.dayGainLossPercent}% (${baseCurrency}${summary.dayGainLossDollar?.toLocaleString()})
- **Asset Breakdown**: Stocks ${summary.stockWeightPercent}%, ETFs ${summary.etfWeightPercent}%, Crypto ${summary.cryptoWeightPercent}%, Cash ${summary.cashWeightPercent}%

## Holdings Ledger
${holdingsContext}

Please structure your report as follows:
1. **Executive Summary & Macro Overview** (2-3 concise paragraphs)
2. **Key Asset Performance Highlights** (Winners, laggards, technical status with SMAs/RSI)
3. **Risk Exposure & Allocation Assessment** (Sector/asset concentration, cash buffer)
4. **Tactical Action Items & Strategic Rebalancing** (Clear, bulleted recommendations)

## General Rules
1. Use ASD-STE100 simplified english text
2. Do not use emojis or special characters
3. Do not split section with lines ---
4. Do not use long dash characters
`;

    let content = "";
    let reportStatus: "success" | "fallback" | "error" = "success";
    let isFallback = false;
    let errorMessage: string | undefined;

    try {
      content = await this.llm.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { provider, model, apiKey, baseUrl },
      );
      content = sanitizeLlmResponse(content);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[PortfolioReport] Failed to generate LLM report: ${errMsg}`);
      reportStatus = "fallback";
      isFallback = true;
      errorMessage = errMsg;
      content = `### Automated Portfolio Briefing (${period})\n\n**Market Overview**: Total portfolio valuation stands at ${baseCurrency}${(summary.totalPortfolioValue || summary.totalValue).toLocaleString()} with ${summary.totalGainLossPercent >= 0 ? "+" : ""}${summary.totalGainLossPercent}% overall return.\n\n*Note: Detailed LLM report model was temporarily unreachable (${errMsg}). Technical metrics and ledger values remain verified.*`;
    }

    const reportId = `${portfolio.id}_${weekKey}`;

    const metrics: ReportMetrics = {
      totalPortfolioValue: summary.totalPortfolioValue || summary.totalValue,
      weeklyGainLossDollar: summary.dayGainLossDollar,
      weeklyGainLossPercent: summary.dayGainLossPercent,
      cashBalance: summary.cashBalance || 0,
      baseCurrency,
      holdingsCount: holdings.length,
      topWinner,
      topLoser,
    };

    const report = reportRepo.upsert({
      id: reportId,
      portfolioId: portfolio.id,
      period,
      weekStartDate,
      weekEndDate,
      weekKey,
      title: `${portfolio.name} - Weekly Briefing (${period})`,
      summary: `Valuation ${baseCurrency}${(summary.totalPortfolioValue || summary.totalValue).toLocaleString()} with ${summary.totalGainLossPercent >= 0 ? "+" : ""}${summary.totalGainLossPercent}% cumulative return across ${holdings.length} assets.`,
      content,
      metrics,
      model,
      provider,
      status: reportStatus,
      error: errorMessage,
      isFallback,
    });

    return {
      ...report,
      metrics: JSON.parse(report.metrics) as ReportMetrics,
      isFallback: Boolean(report.isFallback),
    };
  }
}
