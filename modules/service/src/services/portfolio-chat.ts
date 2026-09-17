/**
 * Portfolio chat: builds the system prompt from the live portfolio state
 * (weights, returns, indicators, recent transactions; never money amounts),
 * runs one turn through LlmService and stores the conversation.
 */

import { loadConfig } from "../config.js";
import type { LlmService, LlmMessage } from "./llm.js";
import type { PortfolioService } from "./portfolio.js";
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as conversationRepo from "../db/conversation.repo.js";
import type { PortfolioItem, FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { PortfolioChatMessage, AssistantConversation } from "portfolio-shared/api-types";

const TITLE_MAX_CHARS = 42;
const RECENT_TRANSACTIONS = 10;

const pct = (value = 0) => `${value.toFixed(2)}%`;
const signedPct = (value = 0) => `${value >= 0 ? "+" : ""}${pct(value)}`;
const indicator = (value: number | undefined, digits: number) => (value !== undefined && !isNaN(value) ? value.toFixed(digits) : "N/A");

export function buildPortfolioSystemPrompt(portfolio: PortfolioItem, data: FinancialPortfolioData): string {
  const summary = data.summary;

  const holdingsLedger =
    data.holdings
      ?.map(
        (h) => `- **${h.symbol}** (${h.name}, Type: ${h.assetType}):
  - Portfolio Weight: ${pct(h.weightPercent)}
  - Day Change: ${signedPct(h.dayChangePercent)} | Total Return: ${signedPct(h.totalGainLossPercent)}
  - Technical Indicators: RSI(14): ${indicator(h.rsi, 1)}, SMA50: ${indicator(h.sma50, 2)}, SMA200: ${indicator(h.sma200, 2)}`,
      )
      .join("\n") || "No active holdings.";

  const recentTransactions =
    data.transactions
      ?.slice(0, RECENT_TRANSACTIONS)
      .map((tx) => `- ${tx.date ? tx.date.slice(0, 10) : "Unknown date"} [${tx.type}] ${tx.shares ? `${tx.shares} ` : ""}${tx.symbol || ""}`.trim())
      .join("\n") || "No transaction history recorded.";

  return `You are a quantitative investment portfolio analyst and tactical financial assistant.
You possess real-time, comprehensive context for the user's active portfolio.
Use ASD-STE100 Simplified English whenever possible.
Do not use long dashes in your output.
Answer questions objectively, clearly, and concisely. Ground your answers strictly in the verified portfolio data below.

=== CURRENT PORTFOLIO PROFILE ===
Portfolio Name: ${portfolio.name}
${portfolio.description ? `Description: ${portfolio.description}` : ""}
Cash Allocation: ${pct(summary?.cashWeightPercent)} of total portfolio
Lifetime Unrealized Return: ${signedPct(summary?.totalGainLossPercent)}
Today's Return: ${signedPct(summary?.dayGainLossPercent)}

=== ASSET ALLOCATION BREAKDOWN ===
- Stocks: ${pct(summary?.stockWeightPercent)}
- ETFs & Funds: ${pct(summary?.etfWeightPercent)}
- Crypto: ${pct(summary?.cryptoWeightPercent)}
- Cash: ${pct(summary?.cashWeightPercent)}

=== FULL HOLDINGS LEDGER ===
${holdingsLedger}

=== RECENT TRANSACTIONS ===
${recentTransactions}

=== INSTRUCTIONS FOR ASSISTANT ===
1. Analyze holdings, performance, risk concentration, technical indicators, and asset allocation based on the ledger.
2. If asked about an asset not present in the portfolio, state that it is not currently in this portfolio.
3. When providing tactical recommendations, rebalancing advice, or risk assessments, explain the quantitative reasoning using the numbers above.
4. Format responses using clean Markdown with bold labels and lists.`;
}

/** First user message, shortened, or a generic title. */
function titleFor(messages: PortfolioChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content.trim();
  if (!first) return "Chat Session";
  return first.length > TITLE_MAX_CHARS ? `${first.slice(0, TITLE_MAX_CHARS)}...` : first;
}

function parseMessages(json: string): PortfolioChatMessage[] {
  try {
    return JSON.parse(json) as PortfolioChatMessage[];
  } catch {
    return [];
  }
}

export class PortfolioChatService {
  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
  ) {}

  /** The system prompt a new chat would receive, so the UI can show it. */
  public async getSystemPrompt(portfolioId: string): Promise<string> {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) throw new Error(`Portfolio with ID "${portfolioId}" not found`);
    const baseCurrency = portfolio.baseCurrency || loadConfig().baseCurrency || "EUR";
    const data = await this.portfolioService.getPortfolioData(portfolio.id, baseCurrency);
    return buildPortfolioSystemPrompt(portfolio, data);
  }

  public getConversations(portfolioId: string): AssistantConversation[] {
    return conversationRepo.findByPortfolio(portfolioId).map((row) => ({ ...row, messages: parseMessages(row.messages) }));
  }

  public deleteConversation(portfolioId: string, conversationId: string): boolean {
    return conversationRepo.deleteById(conversationId, portfolioId);
  }

  public async chat(
    portfolioId: string,
    messages: PortfolioChatMessage[],
    options: { conversationId?: string; title?: string; provider?: string; model?: string } = {},
  ): Promise<{ message: PortfolioChatMessage; conversationId: string; title: string; provider: string; model: string }> {
    const target = this.llm.resolve(options);
    const history: LlmMessage[] = [
      { role: "system", content: await this.getSystemPrompt(portfolioId) },
      ...messages.map(({ role, content }) => ({ role, content })),
    ];
    const reply: PortfolioChatMessage = { role: "assistant", content: await this.llm.chat(history, target) };

    const conversationId = options.conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = options.title || titleFor(messages);
    conversationRepo.upsert({ id: conversationId, portfolioId, title, messages: JSON.stringify([...messages, reply]) });

    return { message: reply, conversationId, title, provider: target.provider, model: target.model };
  }
}
