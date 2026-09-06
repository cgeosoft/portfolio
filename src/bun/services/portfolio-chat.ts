/**
 * Portfolio Chat Service
 * Synthesizes a comprehensive system prompt from live portfolio metrics, holdings,
 * technical indicators, and transaction history, and orchestrates conversational turns
 * with the configured LLM provider.
 */

import { loadConfig } from "../config.js";
import type { LlmService, LlmMessage } from "./llm.js";
import type { PortfolioService } from "./portfolio.js";
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as conversationRepo from "../db/conversation.repo.js";
import type {
  PortfolioItem,
  FinancialPortfolioData,
  PortfolioHolding,
  PortfolioTransaction,
} from "../../types/portfolio.js";
import type { PortfolioChatMessage, AssistantConversation } from "../../shared/rpc-types.js";

export function buildPortfolioSystemPrompt(
  portfolio: PortfolioItem,
  data: FinancialPortfolioData,
): string {
  const summary = data.summary;
  const holdings: PortfolioHolding[] = data.holdings || [];
  const transactions: PortfolioTransaction[] = data.transactions || [];

  const unrealizedPnLPercentStr = `${(summary?.totalGainLossPercent ?? 0) >= 0 ? "+" : ""}${(summary?.totalGainLossPercent ?? 0).toFixed(2)}%`;
  const dayGainLossPercentStr = `${(summary?.dayGainLossPercent ?? 0) >= 0 ? "+" : ""}${(summary?.dayGainLossPercent ?? 0).toFixed(2)}%`;
  const cashWeightStr = `${(summary?.cashWeightPercent ?? 0).toFixed(2)}%`;

  // Holdings ledger
  let holdingsLedger = "No active holdings.";
  if (holdings.length > 0) {
    holdingsLedger = holdings
      .map((h) => {
        const dayChangeFormatted = `${h.dayChangePercent >= 0 ? "+" : ""}${h.dayChangePercent.toFixed(2)}%`;
        const totalGainFormatted = `${h.totalGainLossPercent >= 0 ? "+" : ""}${h.totalGainLossPercent.toFixed(2)}%`;
        const rsiFormatted = h.rsi !== undefined && !isNaN(h.rsi) ? h.rsi.toFixed(1) : "N/A";
        const sma50Formatted = h.sma50 !== undefined && !isNaN(h.sma50) ? h.sma50.toFixed(2) : "N/A";
        const sma200Formatted = h.sma200 !== undefined && !isNaN(h.sma200) ? h.sma200.toFixed(2) : "N/A";
        return `- **${h.symbol}** (${h.name}, Type: ${h.assetType}):
  - Portfolio Weight: ${h.weightPercent.toFixed(2)}%
  - Day Change: ${dayChangeFormatted} | Total Return: ${totalGainFormatted}
  - Technical Indicators: RSI(14): ${rsiFormatted}, SMA50: ${sma50Formatted}, SMA200: ${sma200Formatted}`;
      })
      .join("\n");
  }

  // Recent transactions (up to 10 latest)
  let recentTxText = "No transaction history recorded.";
  if (transactions.length > 0) {
    const recent = transactions.slice(0, 10);
    recentTxText = recent
      .map((tx) => {
        const dateStr = tx.date ? tx.date.slice(0, 10) : "Unknown date";
        const sharesText = tx.shares ? `${tx.shares} ` : "";
        return `- ${dateStr} [${tx.type}] ${sharesText}${tx.symbol || ""}`.trim();
      })
      .join("\n");
  }

  return `You are a quantitative investment portfolio analyst and tactical financial assistant.
You possess real-time, comprehensive context for the user's active portfolio.
Use ASD-STE100 Simplified English whenever possible.
Do not use long dashes in your output.
Answer questions objectively, clearly, and concisely. Ground your answers strictly in the verified portfolio data below.

=== CURRENT PORTFOLIO PROFILE ===
Portfolio Name: ${portfolio.name}
${portfolio.description ? `Description: ${portfolio.description}` : ""}
Cash Allocation: ${cashWeightStr} of total portfolio
Lifetime Unrealized Return: ${unrealizedPnLPercentStr}
Today's Return: ${dayGainLossPercentStr}

=== ASSET ALLOCATION BREAKDOWN ===
- Stocks: ${(summary?.stockWeightPercent ?? 0).toFixed(2)}%
- ETFs & Funds: ${(summary?.etfWeightPercent ?? 0).toFixed(2)}%
- Crypto: ${(summary?.cryptoWeightPercent ?? 0).toFixed(2)}%
- Cash: ${(summary?.cashWeightPercent ?? 0).toFixed(2)}%

=== FULL HOLDINGS LEDGER ===
${holdingsLedger}

=== RECENT TRANSACTIONS ===
${recentTxText}

=== INSTRUCTIONS FOR ASSISTANT ===
1. Analyze holdings, performance, risk concentration, technical indicators, and asset allocation based on the ledger.
2. If asked about an asset not present in the portfolio, state that it is not currently in this portfolio.
3. When providing tactical recommendations, rebalancing advice, or risk assessments, explain the quantitative reasoning using the numbers above.
4. Format responses using clean Markdown with bold labels and lists.`;
}

export class PortfolioChatService {
  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
  ) {}

  public getConversations(portfolioId: string): AssistantConversation[] {
    const rows = conversationRepo.findByPortfolio(portfolioId);
    return rows.map((r) => {
      let parsedMessages: PortfolioChatMessage[] = [];
      try {
        parsedMessages = JSON.parse(r.messages) as PortfolioChatMessage[];
      } catch {
        parsedMessages = [];
      }
      return {
        id: r.id,
        portfolioId: r.portfolioId,
        title: r.title,
        messages: parsedMessages,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  public deleteConversation(portfolioId: string, conversationId: string): boolean {
    return conversationRepo.deleteById(conversationId, portfolioId);
  }

  public async chat(
    portfolioId: string,
    messages: PortfolioChatMessage[],
    options: {
      conversationId?: string;
      title?: string;
      provider?: string;
      model?: string;
    } = {},
  ): Promise<{
    message: PortfolioChatMessage;
    conversationId: string;
    title: string;
    provider: string;
    model: string;
  }> {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio with ID "${portfolioId}" not found`);
    }

    const config = loadConfig();
    const provider = (options.provider || config.llmProvider || "llamacpp-server").toLowerCase().trim();

    const defaultModel =
      provider === "groq"
        ? "llama-3.3-70b-versatile"
        : provider === "openai"
          ? "gpt-4o-mini"
          : provider === "anthropic"
            ? "claude-3-5-sonnet-20241022"
            : provider === "openrouter"
              ? "meta-llama/llama-3.3-70b-instruct"
              : provider === "deepseek"
                ? "deepseek-chat"
                : provider === "gemini"
                  ? "gemini-2.5-flash"
                  : provider === "ollama"
                    ? "llama3.2:latest"
                    : "qwen3-abliterated-14b-q4_k_m";

    const model = options.model || config.llmModel || defaultModel;
    const apiKey = config.llmApiKeys?.[provider] || config.llmApiKey;
    const configuredBaseUrl =
      config.llmBaseUrls?.[provider] ||
      config.llmBaseUrl ||
      (provider === "llamacpp-server" || provider === "llamacpp" ? config.llamacppServerUrl : undefined);
    const baseUrl = configuredBaseUrl;

    // Validate cloud provider API keys before network call
    const cloudProviders = ["groq", "openai", "anthropic", "openrouter", "deepseek", "gemini"];
    if (cloudProviders.includes(provider) && !apiKey?.trim()) {
      const capitalized = provider.charAt(0).toUpperCase() + provider.slice(1);
      throw new Error(
        `${capitalized} API key is not configured. Please open Settings > Assistant and configure your API key.`,
      );
    }

    // Fetch latest portfolio state
    const baseCurrency = portfolio.baseCurrency || config.baseCurrency || "EUR";
    const data = await this.portfolioService.getPortfolioData(portfolio.id, baseCurrency);

    // Build the dynamic system prompt
    const systemPrompt = buildPortfolioSystemPrompt(portfolio, data);

    // Filter and sanitize conversation messages
    const formattedMessages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const replyContent = await this.llm.chat(formattedMessages, {
      provider,
      model,
      apiKey,
      baseUrl,
      isReport: false,
    });

    const assistantMsg: PortfolioChatMessage = {
      role: "assistant",
      content: replyContent,
    };

    // Determine conversation ID & title
    const conversationId = options.conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let title = options.title;
    if (!title) {
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (firstUserMsg && firstUserMsg.content.trim()) {
        title = firstUserMsg.content.trim().slice(0, 42);
        if (firstUserMsg.content.trim().length > 42) title += "...";
      } else {
        title = "Chat Session";
      }
    }

    // Persist conversation
    const fullHistory = [...messages, assistantMsg];
    conversationRepo.upsert({
      id: conversationId,
      portfolioId,
      title,
      messages: JSON.stringify(fullHistory),
    });

    return {
      message: assistantMsg,
      conversationId,
      title,
      provider,
      model,
    };
  }
}
