import { describe, it, expect } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding, PortfolioItem } from "portfolio-shared/portfolio";
import {
  PromptPrivacyError,
  assertNoLedgerAmounts,
  assertPercentOnly,
  containsLedgerAmount,
  ledgerFingerprint,
  readNumberToken,
  scanForAmounts,
  toPromptSafe,
} from "../llm-privacy.js";
import { McpPrivacyError } from "../mcp-tools.js";
import { buildPortfolioSystemPrompt } from "../portfolio-chat.js";
import { buildSuggestionPrompt } from "../portfolio-suggestions.js";
import { buildDailyBriefPrompt } from "../daily-brief.js";

// Canary portfolio: every amount and quantity has digits no prompt should ever print.
function holding(symbol: string, extra: Partial<PortfolioHolding>): PortfolioHolding {
  return {
    symbol,
    name: `${symbol} Corp`,
    assetType: "Stock",
    shares: 0,
    buyPrice: 101.11,
    currentPrice: 202.22,
    previousClose: 199.99,
    totalCost: 0,
    currentValue: 0,
    dayChangeDollar: 0,
    dayChangePercent: 1.25,
    totalGainLossDollar: 0,
    totalGainLossPercent: 12.5,
    weightPercent: 0,
    currency: "EUR",
    sma50: 190.5,
    sma200: 175.25,
    rsi: 55,
    ...extra,
  };
}

const canary = {
  summary: {
    totalValue: 7_654_321.09,
    totalPortfolioValue: 8_765_432.1,
    totalCost: 6_543_210.98,
    totalGainLossDollar: 1_111_110.11,
    totalGainLossPercent: 16.98,
    dayGainLossDollar: 43_210.87,
    dayGainLossPercent: 0.57,
    totalGainSinceStartDollar: 2_222_221.22,
    totalGainSinceStartPercent: 30.1,
    totalCashInjected: 6_000_123.45,
    cashBalance: 1_111_111.01,
    realizedPnL: 98_765.43,
    totalDividends: 12_345.67,
    totalInterest: 3_456.78,
    totalFees: 987.65,
    totalTaxes: 876.54,
    stockWeightPercent: 60,
    etfWeightPercent: 27.3,
    cryptoWeightPercent: 0,
    otherWeightPercent: 0,
    cashWeightPercent: 12.7,
    baseCurrency: "EUR",
    lastUpdated: "2026-11-04T10:00:00Z",
    bestPerformer: { symbol: "NVDA", changePercent: 3.2 },
  },
  holdings: [
    holding("NVDA", { shares: 13_579.2468, totalCost: 2_468_013.57, currentValue: 3_141_592.65, dayChangeDollar: 24_680.13, totalGainLossDollar: 673_579.08, weightPercent: 35.8, dayChangePercent: 3.2 }),
    holding("VWCE.DE", { assetType: "ETF", shares: 24_681, totalCost: 1_975_310.86, currentValue: 2_396_457.12, dayChangeDollar: -8_642.97, totalGainLossDollar: 421_146.26, weightPercent: 27.3, dayChangePercent: -0.36 }),
    holding("CASH", { assetType: "Cash", shares: 1_111_111.01, currentValue: 1_111_111.01, weightPercent: 12.7 }),
  ],
  chartHistory: [{ date: "2026-11-03", timestamp: 0, totalValue: 7_600_001.23, totalCost: 6_543_210.98, totalGainLoss: 1_056_790.25 }],
  individualCharts: {},
  transactions: [
    { id: "t1", date: "2026-11-02", type: "BUY", symbol: "NVDA", shares: 135.791, price: 181.82, amount: 24_690.48, fee: 4.95 },
    { id: "t2", date: "2026-11-03", type: "DEPOSIT", symbol: "", amount: 250_000.5 },
  ],
} as unknown as FinancialPortfolioData;

const portfolio: PortfolioItem = { id: "p1", name: "Canary", description: "Long-term growth, 15 years.", baseCurrency: "EUR" };

describe("assertPercentOnly", () => {
  it("allows percentages and named counts, refuses other numbers", () => {
    expect(() => assertPercentOnly({ weightPercent: 3, nested: { percent: 1, rsi: 40, days: 7 } })).not.toThrow();
    expect(() => assertPercentOnly({ value: 12 })).toThrow(PromptPrivacyError);
    expect(() => assertPercentOnly({ list: [1] })).toThrow(PromptPrivacyError);
  });

  it("is the same error the MCP server catches", () => {
    expect(() => assertPercentOnly({ totalValue: 1 })).toThrow(McpPrivacyError);
  });

  it("toPromptSafe returns the value as JSON when it passes", () => {
    const value = { weightPercent: 4 };
    expect(String(toPromptSafe(value))).toBe(JSON.stringify(value));
    expect(() => toPromptSafe({ shares: 4 })).toThrow(PromptPrivacyError);
  });
});

describe("readNumberToken", () => {
  it("reads both decimal marks", () => {
    expect(readNumberToken("12,345.67").map((r) => r.value)).toContain(12345.67);
    expect(readNumberToken("12.345,67").map((r) => r.value)).toContain(12345.67);
    expect(readNumberToken("12 345").map((r) => r.value)).toContain(12345);
  });

  it("never reads two decimals as a thousands group", () => {
    expect(readNumberToken("80.00").map((r) => r.value)).toEqual([80]);
    expect(readNumberToken("80,00").map((r) => r.value)).toEqual([80]);
  });
});

describe("ledger amounts in prompt text", () => {
  const fp = ledgerFingerprint(canary);

  it("finds an amount in any common format", () => {
    for (const text of ["Value 7654321.09 EUR", "Value 7,654,321.09", "Wert 7.654.321,09 €", "about 7654321 in total", "7 654 321", "cash 1111111.01", "deposit of 250000.50"]) {
      expect(containsLedgerAmount(text, fp)).toBe(true);
    }
  });

  it("finds an amount in every locale format Intl writes", () => {
    const locales = ["en-US", "en-GB", "de-DE", "de-CH", "fr-FR", "fr-CH", "it-IT", "es-ES", "nl-NL", "pt-BR", "pl-PL", "sv-SE", "ru-RU", "el-GR", "tr-TR", "cs-CZ", "en-IN", "hi-IN", "ja-JP", "zh-CN", "ar-EG", "fa-IR", "bn-BD"];
    for (const locale of locales) {
      for (const options of [{ minimumFractionDigits: 2 }, { style: "currency", currency: "EUR" }, { maximumFractionDigits: 0 }] as Intl.NumberFormatOptions[]) {
        const text = canary.summary.totalValue.toLocaleString(locale, options);
        expect({ locale, text, found: containsLedgerAmount(text, fp) }).toEqual({ locale, text, found: true });
      }
    }
  });

  it("finds an amount written with a typographic apostrophe or rounded to one decimal", () => {
    expect(containsLedgerAmount("7\u2019654\u2019321.09", fp)).toBe(true);
    expect(containsLedgerAmount("Total 7,654,321.1 EUR", fp)).toBe(true);
  });

  it("finds a telling quantity", () => {
    expect(containsLedgerAmount("You hold 13579.2468 shares", fp)).toBe(true);
    expect(containsLedgerAmount("24681 units", fp)).toBe(true);
  });

  it("lets weights, returns, public prices, indicators and years pass", () => {
    const text = "NVDA 35.8% weight, +3.2% today, +12.5% total. Price 202.22, previous 199.99, SMA50 190.50, SMA200 175.25, RSI 55. Week 2026-w45, year 2026.";
    expect(containsLedgerAmount(text, fp)).toBe(false);
  });

  it("assertNoLedgerAmounts names the message, not the value", () => {
    let error: unknown;
    try {
      assertNoLedgerAmounts([{ role: "system", content: "ok" }, { role: "user", content: "Total 7,654,321.09" }], canary, "test");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PromptPrivacyError);
    expect((error as Error).message).toContain("test, message 2 (user)");
    expect((error as Error).message).not.toContain("7,654,321");
  });
});

// The canary: the real prompt builders must never print an amount or quantity of the ledger.
describe("prompt builders keep the ledger out", () => {
  it("assistant system prompt", () => {
    expect(() => assertNoLedgerAmounts(buildPortfolioSystemPrompt(portfolio, canary, "", "en"), canary)).not.toThrow();
  });

  it("suggestion prompt", () => {
    const messages = buildSuggestionPrompt(canary, { baseCurrency: "EUR", intelText: "", openKeys: [], dismissedKeys: [], today: "2026-11-04", language: "en" });
    expect(() => assertNoLedgerAmounts(messages, canary)).not.toThrow();
  });

  it("daily brief prompt", () => {
    const messages = buildDailyBriefPrompt({ portfolio, data: canary, since: "2026-11-01", today: "2026-11-04", news: [], language: "en" });
    expect(() => assertNoLedgerAmounts(messages, canary)).not.toThrow();
  });
});

describe("scanForAmounts", () => {
  it("finds money in free text", () => {
    const found = scanForAmounts("I hold €50,000 in ETFs, add 500 EUR a month and keep 80k in cash. Goal: 2 million dollars.");
    expect(found.matches).toEqual(["€50,000", "500 EUR", "80k", "2 million"]);
  });

  it("lets percentages, years and counts pass", () => {
    expect(scanForAmounts("Retire in 2045, 15 years away. Keep 60% equity, 3 ETFs, max drawdown 25%.")).toEqual({ hasAmounts: false, matches: [] });
  });
});
