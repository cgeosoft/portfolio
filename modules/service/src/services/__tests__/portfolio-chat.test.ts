import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { buildPortfolioSystemPrompt, PortfolioChatService } from "../portfolio-chat.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { updateConfig } from "../../config.js";
import type { LlmService } from "../llm.js";
import type { PortfolioService } from "../portfolio.js";
import type { PortfolioItem, FinancialPortfolioData } from "portfolio-shared/portfolio";

const dummyPortfolio: PortfolioItem = {
  id: "port-123",
  name: "Tactical Alpha Fund",
  description: "High growth tech and crypto",
  baseCurrency: "USD",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

const dummyData: FinancialPortfolioData = {
  summary: {
    totalValue: 125000,
    totalCost: 100000,
    totalGainLossDollar: 25000,
    totalGainLossPercent: 25.0,
    dayGainLossDollar: 1250,
    dayGainLossPercent: 1.01,
    totalGainSinceStartDollar: 25000,
    totalGainSinceStartPercent: 25.0,
    totalCashInjected: 100000,
    cashBalance: 15000,
    totalPortfolioValue: 140000,
    realizedPnL: 5000,
    totalDividends: 1200,
    totalInterest: 100,
    totalFees: 50,
    totalTaxes: 120,
    stockWeightPercent: 65,
    etfWeightPercent: 20,
    cryptoWeightPercent: 5,
    cashWeightPercent: 10,
    baseCurrency: "USD",
    lastUpdated: "2026-09-05T08:00:00Z",
  },
  holdings: [
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      assetType: "Stock",
      shares: 100,
      buyPrice: 150,
      currentPrice: 220,
      previousClose: 216.75,
      totalCost: 15000,
      currentValue: 22000,
      dayChangeDollar: 325,
      currency: "USD",
      dayChangePercent: 1.5,
      totalGainLossPercent: 46.67,
      totalGainLossDollar: 7000,
      weightPercent: 15.71,
      sma50: 210.5,
      sma200: 195.2,
      rsi: 62.4,
    },
  ],
  transactions: [
    {
      id: "tx-1",
      portfolioId: "port-123",
      type: "BUY",
      symbol: "AAPL",
      shares: 100,
      price: 150,
      amount: 15000,
      currency: "USD",
      date: "2026-02-01T10:00:00Z",
    },
  ],
  chartHistory: [],
  individualCharts: {},
};

describe("PortfolioChatService & prompt builder", () => {
  it("constructs comprehensive system prompt without monetary values", () => {
    const prompt = buildPortfolioSystemPrompt(dummyPortfolio, dummyData);

    expect(prompt).toContain("Tactical Alpha Fund");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("Apple Inc.");
    expect(prompt).toContain("Portfolio Weight: 15.71%");
    expect(prompt).toContain("Day Change: +1.50%");
    expect(prompt).toContain("Total Return: +46.67%");
    expect(prompt).toContain("RSI(14): 62.4");
    expect(prompt).toContain("SMA50: 210.50");
    expect(prompt).toContain("SMA200: 195.20");
    expect(prompt).toContain("Cash Allocation: 10.00%");
    expect(prompt).toContain("Stocks: 65.00%");
    expect(prompt).toContain("[BUY] AAPL");
    expect(prompt).not.toContain("[BUY] 100");

    // Verify absence of monetary values and currencies
    expect(prompt).not.toContain("140,000");
    expect(prompt).not.toContain("125,000");
    expect(prompt).not.toContain("22,000");
    expect(prompt).not.toContain("15,000");
    expect(prompt).not.toContain("USD");
    expect(prompt).not.toContain("$");
    expect(prompt).not.toContain("avg buy");
    expect(prompt).not.toContain("Market Price");
    expect(prompt).not.toContain("Position Value");

    // Ensure no long dashes are used per CLAUDE.md rule
    expect(prompt.includes("\u2014")).toBe(false);
  });

  it("handles empty holdings and transactions without throwing", () => {
    const emptyData: FinancialPortfolioData = {
      summary: {
        totalValue: 0,
        totalCost: 0,
        totalGainLossDollar: 0,
        totalGainLossPercent: 0,
        dayGainLossDollar: 0,
        dayGainLossPercent: 0,
        totalGainSinceStartDollar: 0,
        totalGainSinceStartPercent: 0,
        totalCashInjected: 0,
        cashBalance: 0,
        totalPortfolioValue: 0,
        realizedPnL: 0,
        totalDividends: 0,
        totalInterest: 0,
        totalFees: 0,
        totalTaxes: 0,
        stockWeightPercent: 0,
        etfWeightPercent: 0,
        cryptoWeightPercent: 0,
        cashWeightPercent: 0,
        baseCurrency: "EUR",
        lastUpdated: "2026-09-05T08:00:00Z",
      },
      holdings: [],
      transactions: [],
      chartHistory: [],
      individualCharts: {},
    };

    const prompt = buildPortfolioSystemPrompt({ ...dummyPortfolio, baseCurrency: "EUR" }, emptyData);
    expect(prompt).toContain("No active holdings");
    expect(prompt).toContain("No transaction history recorded");
  });
});

describe("PortfolioChatService", () => {
  type Seen = { h: { role: string; content: string }[]; t: unknown };
  const seen: Seen[] = [];
  const realFetch = globalThis.fetch;
  let id = "";
  let service: PortfolioChatService;
  const question = "What is my largest position and why does it matter so much?";

  beforeAll(() => {
    // No real network: any provider call the service makes on its own fails fast.
    globalThis.fetch = (async () => {
      throw new Error("network disabled in tests");
    }) as unknown as typeof fetch;
    updateConfig({ language: "en" });
    id = portfolioRepo.create({ name: "Chat Test", baseCurrency: "EUR" }).id;
    const llm = {
      resolve: (o: { model?: string } = {}) => ({
        provider: "openai-compatible",
        name: "OpenAI-compatible",
        model: o.model || "m1",
        apiKey: "",
        baseUrl: "http://x",
        temperature: 0.3,
      }),
      chat: async (h: Seen["h"], t: unknown) => {
        seen.push({ h, t });
        return "Reply";
      },
    } as unknown as LlmService;
    const portfolioService = { getPortfolioData: async () => dummyData } as unknown as PortfolioService;
    service = new PortfolioChatService(llm, portfolioService);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    updateConfig({ language: "en" });
    portfolioRepo.deleteById(id);
  });

  let convId = "";

  it("answers, names the conversation and reports the provider", async () => {
    const res = await service.chat(id, [{ role: "user", content: question }]);
    convId = res.conversationId;
    expect(res.message).toEqual({ role: "assistant", content: "Reply" });
    expect(res.conversationId).toMatch(/^conv_\d+_[a-z0-9]{1,5}$/);
    // The spec states "first 42 chars + ..."; its literal example showed 43 characters.
    expect(res.title).toBe(question.slice(0, 42) + "...");
    expect(res.provider).toBe("openai-compatible");
    expect(res.model).toBe("m1");
  });

  it("sends the system prompt first, then the user message", () => {
    const { h } = seen[0]!;
    expect(h[0]!.role).toBe("system");
    expect(h[0]!.content).toContain("Portfolio Name: Chat Test");
    expect(h[1]).toEqual({ role: "user", content: question });
  });

  it("stores the conversation for its portfolio only", async () => {
    const conv = await service.getConversation(id, convId);
    expect(conv!.messages).toEqual([
      { role: "user", content: question },
      { role: "assistant", content: "Reply" },
    ]);
    expect(await service.getConversation("other-portfolio", convId)).toBeNull();
    const list = await service.getConversations(id);
    expect(list[0]!.messageCount).toBe(2);
    expect((list[0] as unknown as { messages?: unknown }).messages).toBeUndefined();
  });

  it("continues a conversation with the given title", async () => {
    const res = await service.chat(
      id,
      [
        { role: "user", content: question },
        { role: "assistant", content: "Reply" },
        { role: "user", content: "And the second?" },
      ],
      { conversationId: convId, title: "Kept" },
    );
    expect(res.conversationId).toBe(convId);
    expect(res.title).toBe("Kept");
    expect((await service.getConversation(id, convId))!.messages.length).toBe(4);
  });

  it("keeps a short first message as the title and names a chat without one", async () => {
    const exact = "x".repeat(42);
    expect((await service.chat(id, [{ role: "user", content: exact }])).title).toBe(exact);
    expect((await service.chat(id, [{ role: "assistant", content: "Hello" }])).title).toBe("Chat Session");
  });

  it("rejects an unknown portfolio", async () => {
    await expect(service.chat("nope", [{ role: "user", content: "Hi" }])).rejects.toThrow('Portfolio with ID "nope" not found');
  });

  it("adds the output language rule to the system prompt", async () => {
    updateConfig({ language: "de" });
    try {
      const prompt = await service.getSystemPrompt(id);
      expect(
        prompt.endsWith(
          "Write your whole answer in German, headings included. Keep tickers, ISINs, currency codes, numbers and product names unchanged.",
        ),
      ).toBe(true);
    } finally {
      updateConfig({ language: "en" });
    }
  });

  it("keeps plain amounts and quantities out of the prompt", () => {
    const prompt = buildPortfolioSystemPrompt(dummyPortfolio, dummyData);
    for (const amount of ["140000", "125000", "22000", "15000", "100 shares", "Shares: 100"]) {
      expect(prompt).not.toContain(amount);
    }
  });

  it("deletes a conversation", async () => {
    expect(await service.deleteConversation(id, convId)).toBe(true);
    expect(await service.getConversation(id, convId)).toBeNull();
  });
});
