import { describe, it, expect } from "bun:test";
import { buildPortfolioSystemPrompt } from "../portfolio-chat.js";
import type { PortfolioItem, FinancialPortfolioData } from "../../../types/portfolio.js";

describe("PortfolioChatService & prompt builder", () => {
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
    expect(prompt).toContain("[BUY] 100 AAPL");

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

    // Ensure no long dashes are used per AGENTS.md rule
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
