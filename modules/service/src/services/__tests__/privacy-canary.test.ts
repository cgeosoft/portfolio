/**
 * Privacy gate and canary run. A portfolio with distinctive amounts goes
 * through every feature that prompts a model, against a stubbed
 * OpenAI-compatible server that records each request. No amount, quantity
 * or private price may reach it, and no prompt builder may need the gate to
 * remove one.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { join } from "node:path";
import * as portfolioRepo from "../../db/portfolio.repo";
import { loadConfig, updateConfig } from "../../config";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";
import { LlmService } from "../llm";
import { PortfolioReportService } from "../portfolio-report";
import { PortfolioSuggestionService } from "../portfolio-suggestions";
import { PortfolioChatService } from "../portfolio-chat";
import { WeeklyAnalysisService } from "../weekly-analysis";
import { buildDailyBriefPrompt, localDate } from "../daily-brief";
import { EMPTY_REPORT_INTEL } from "../ai-context";
import type { MarketDataCoordinator } from "../market-data";
import {
  assertPercentOnly,
  PrivacyError,
  REDACTED_AMOUNT,
  redactPrivateAmounts,
  rememberPrivateValues,
  scanForAmounts,
  toPromptSafe,
} from "../llm-privacy";
import type { FinancialPortfolioData, PortfolioItem } from "portfolio-shared/portfolio";

const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

// Distinctive digits: the deposit, the share count and the buy price, which
// is also the price of the holding while it has no quote.
const CANARY_AMOUNT = 7654321.09;
const CANARY_SHARES = 7654.321;
const CANARY_PRICE = 999.99;
const CANARY_STRINGS = ["7654321", "7,654,321", "7654.32", "7,654.32", "999.99"];

/** Canary digits or a gate removal in any recorded prompt. */
function leaksIn(prompts: string[]): string[] {
  return prompts.flatMap((p) => [...CANARY_STRINGS.filter((s) => p.includes(s)), ...(p.includes(REDACTED_AMOUNT) ? [REDACTED_AMOUNT] : [])]);
}

describe("scanForAmounts", () => {
  it("flags currency amounts and k, M, B figures", () => {
    for (const text of [
      "I have $50,000 in savings",
      "Target budget is €1000",
      "Holding £50.25 in cash",
      "I hold 80k in ETFs",
      "Net worth is around 1.5M",
      "Allocating 500k to growth",
      "Deposited 10000 USD yesterday",
      "Need 500 euros monthly",
      "€80K in bonds",
    ]) {
      expect(scanForAmounts(text).hasAmounts).toBe(true);
    }
  });

  it("flags plain numbers from 1,000 that are not years", () => {
    expect(scanForAmounts("My portfolio is worth 120,000").matches).toEqual(["120,000"]);
    expect(scanForAmounts("I have 250000 invested").matches).toEqual(["250000"]);
    expect(scanForAmounts("Je place 15 000 par an").matches).toEqual(["15 000"]);
    expect(scanForAmounts("Ich lege 1.234.567,89 an").matches).toEqual(["1.234.567,89"]);
  });

  it("flags amounts written in other languages and scripts", () => {
    expect(scanForAmounts("Έχω 80 χιλιάδες ευρώ").hasAmounts).toBe(true);
    expect(scanForAmounts("80 Tsd. Euro").hasAmounts).toBe(true);
    expect(scanForAmounts("1 lakh rupees").hasAmounts).toBe(true);
    expect(scanForAmounts("贷款80万元").hasAmounts).toBe(true);
    expect(scanForAmounts("٨٠٠٠ دولار").hasAmounts).toBe(true);
  });

  it("passes percentages, years, durations, scores and names", () => {
    for (const text of [
      "15 years horizon, 60% equities, 40% bonds",
      "Target dividend yield is 4.5%",
      "Risk tolerance score is 4 out of 5",
      "Capital preservation with maximum 15% drawdown",
      "SMA50 and SMA200 technical momentum indicators",
      "Retire in 2045, maximise my 401k and 403(b)",
      "Hold 10 bonds and 5 funds",
    ]) {
      expect(scanForAmounts(text)).toEqual({ hasAmounts: false, matches: [] });
    }
  });
});

describe("assertPercentOnly", () => {
  it("allows percent keys and the listed number keys", () => {
    const valid = { weightPercent: 42.5, totalReturnPercent: -3.2, rsi: 55, holdingsCount: 12, days: 30, publicPrice: 150.25, peRatio: 22.4, dividendPerShare: 1.8, beta: 1.1, correlation: 0.8, effectiveHoldings: 6.2, riskScore: 3, severity: 2, count: 4 };
    expect(() => assertPercentOnly(valid)).not.toThrow();
    expect<string>(toPromptSafe(valid)).toBe(JSON.stringify(valid));
  });

  it("rejects amounts, quantities and keys outside the list", () => {
    for (const key of ["balance", "shares", "totalValue", "price", "score", "priority", "relevance", "durationMs"]) {
      expect(() => assertPercentOnly({ [key]: 1 })).toThrow(PrivacyError);
    }
    expect(() => assertPercentOnly([10, 20, 30])).toThrow(PrivacyError);
    expect(() => toPromptSafe({ totalValue: CANARY_AMOUNT })).toThrow(PrivacyError);
  });
});

describe("redactPrivateAmounts", () => {
  const data = {
    summary: { totalValue: 123456.78, cashBalance: 2500, stockWeightPercent: 80, baseCurrency: "EUR" },
    holdings: [
      { symbol: "LIVE", shares: 12, buyPrice: 150.25, currentPrice: 150.25, nativePrice: 150.25, totalCost: 1803, currentValue: 1803, weightPercent: 50, rsi: 61 },
      { symbol: "MANUAL", shares: 3, buyPrice: 412.5, nativePrice: 433.17, currentPrice: 433.17, manualPrice: { price: 433.17, currency: "EUR", setAt: "" }, weightPercent: 50 },
    ],
  } as unknown as FinancialPortfolioData;

  // The test preload forgets recorded values before every test, so each test records them itself.
  const remember = () => rememberPrivateValues("redact-test", data);

  it("removes amounts in the forms prompt text uses", () => {
    remember();
    const { text, removed } = redactPrivateAmounts("Value 123,456.78 EUR, about 123457. Cash 2500.00, 2,500 and 2.500. Manual price 433.17.");
    expect(removed).toBe(6);
    expect(text).not.toMatch(/123|2,?\.?500|433/);
  });

  it("keeps percentages, small numbers and public prices", () => {
    remember();
    const text = "Weight 50.00%, RSI 61, 12 holdings, price 150.25 EUR, total 2500% in 2026.";
    expect(redactPrivateAmounts(text)).toEqual({ text, removed: 0 });
  });

  it("cleans the strings of a structured value", () => {
    remember();
    expect<string>(toPromptSafe({ weightPercent: 50, note: "worth 123456.78" })).toBe(JSON.stringify({ weightPercent: 50, note: `worth ${REDACTED_AMOUNT}` }));
  });
});

describe("PromptSafe", () => {
  it("is made only in llm-privacy.ts", async () => {
    const root = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];
    for await (const file of new Bun.Glob("**/*.ts").scan(root)) {
      if (file.includes("__tests__") || file.endsWith("llm-privacy.ts")) continue;
      if (/as\s+PromptSafe\b|<PromptSafe>/.test(await Bun.file(join(root, file)).text())) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("canary run through every prompting feature", () => {
  const KEYS = ["llmProvider", "llmBaseUrl", "llmModel", "language", "weeklyAnalysisPortfolioId", "gotifyUrl", "gotifyToken", "ntfyTopic"] as const;
  let saved: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  let prompts: string[] = [];

  let service: PortfolioService;
  let llm: LlmService;
  let portfolioId = "";
  let portfolioItem: PortfolioItem;

  beforeAll(async () => {
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    saved = Object.fromEntries(KEYS.map((k) => [k, cfg[k]]));
    service = new PortfolioService(offline);
    llm = new LlmService();
    const row = portfolioRepo.create({ name: "Canary Fund", description: "Long term capital preservation", baseCurrency: "EUR" });
    portfolioId = row.id;
    portfolioItem = { id: row.id, name: row.name, description: row.description, baseCurrency: row.baseCurrency };
    updateConfig({
      llmProvider: "openai-compatible",
      llmBaseUrl: "http://127.0.0.1:19403",
      llmModel: "canary-model",
      language: "en",
      weeklyAnalysisPortfolioId: row.id,
      gotifyUrl: "https://gotify.example.com",
      gotifyToken: "t",
      ntfyTopic: "",
    });

    await service.manageTransactions(portfolioId, {
      action: "batch_add",
      transactions: [
        { id: "canary-tx-1", date: "2025-01-01", type: "CUSTOMER_INBOUND", symbol: "", amount: CANARY_AMOUNT, currency: "EUR" },
        {
          id: "canary-tx-2",
          date: "2025-01-02",
          type: "BUY",
          symbol: "CANARY.STOCK",
          shares: CANARY_SHARES,
          price: CANARY_PRICE,
          amount: -(CANARY_SHARES * CANARY_PRICE),
          currency: "EUR",
        },
      ],
    } as unknown as Parameters<PortfolioService["manageTransactions"]>[1]);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    portfolioRepo.deleteById(portfolioId);
    updateConfig(saved as Parameters<typeof updateConfig>[0]);
  });

  // The model server records every message; the push notification server answers OK.
  beforeAll(() => {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (!String(input).endsWith("/chat/completions")) return new Response("{}", { status: 200 });
      const messages = (JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages;
      prompts.push(...messages.map((m) => m.content));
      const content = messages[0]!.content.includes("You are a portfolio analyst")
        ? JSON.stringify({ summary: "No change is needed.", suggestions: [] })
        : "## Overview\n\nA steady week.";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    prompts = [];
  });

  it("the weekly report and its push summary", async () => {
    const weekly = new WeeklyAnalysisService(llm, service, new PortfolioReportService(llm, service));
    const result = await weekly.run("manual");
    expect(result.portfolios).toBe(1);
    expect(prompts.length).toBe(4); // report system and user, summary system and user
    expect(leaksIn(prompts)).toEqual([]);
  });

  it("suggestions", async () => {
    const marketData = { getQuotes: async () => new Map(), getExchangeRates: async () => new Map() } as unknown as MarketDataCoordinator;
    await new PortfolioSuggestionService(llm, service, marketData, async () => EMPTY_REPORT_INTEL).generate(portfolioId, "EUR");
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(leaksIn(prompts)).toEqual([]);
  });

  it("assistant chat", async () => {
    await new PortfolioChatService(llm, service).chat(portfolioId, [{ role: "user", content: "Is my portfolio concentrated?" }]);
    expect(prompts.length).toBe(2);
    expect(leaksIn(prompts)).toEqual([]);
  });

  it("daily brief", async () => {
    const data = await service.getPortfolioData(portfolioId, "EUR");
    await llm.chat(buildDailyBriefPrompt({ portfolio: portfolioItem, data, since: "2025-01-01", today: localDate(new Date()), news: [], language: "en" }), llm.resolve());
    expect(prompts.length).toBe(2);
    expect(leaksIn(prompts)).toEqual([]);
  });

  it("removes an amount that a prompt builder lets through", async () => {
    await service.getPortfolioData(portfolioId, "EUR");
    await llm.chat([{ role: "user", content: toPromptSafe("Total 7,654,321.09 EUR: 7654.321 shares bought at 999.99.") }], llm.resolve());
    expect(prompts).toEqual([`Total ${REDACTED_AMOUNT} EUR: ${REDACTED_AMOUNT} shares bought at ${REDACTED_AMOUNT}.`]);
  });
});
