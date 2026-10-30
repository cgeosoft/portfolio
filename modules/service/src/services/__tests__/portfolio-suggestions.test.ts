import { describe, it, expect, afterEach } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding } from "portfolio-shared/portfolio";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import * as suggestionRepo from "../../db/suggestion.repo.js";
import {
  evaluateSuggestion,
  marketForSymbol,
  projectTargetPortfolio,
  type PortfolioSuggestion,
  type SuggestionQuote,
} from "portfolio-shared/suggestions";
import { buildSuggestionPrompt, extractJsonObject, isStillDismissed, mergeSuggestions, parseSuggestionAnswer, type SuggestionProposal } from "../portfolio-suggestions.js";
import { PortfolioSuggestionService } from "../portfolio-suggestions.js";
import { EMPTY_REPORT_INTEL } from "../ai-context.js";

const NOW = new Date("2026-10-12T10:00:00Z");

function holding(symbol: string, weight: number, extra: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    symbol,
    name: `${symbol} Inc`,
    assetType: "Stock",
    shares: 10,
    buyPrice: 100,
    currentPrice: 200,
    previousClose: 198,
    totalCost: 1000,
    currentValue: weight * 100,
    dayChangeDollar: 0,
    dayChangePercent: 1,
    totalGainLossDollar: 0,
    totalGainLossPercent: 10,
    weightPercent: weight,
    currency: "EUR",
    nativePrice: 220,
    nativeCurrency: "USD",
    ...extra,
  };
}

// Total 10,000 EUR: NVDA 40%, SPY 30%, private 10%, cash 20%.
const data = {
  summary: {
    totalValue: 8000,
    totalPortfolioValue: 10000,
    cashWeightPercent: 20,
    stockWeightPercent: 80,
    etfWeightPercent: 0,
    cryptoWeightPercent: 0,
    otherWeightPercent: 0,
  },
  holdings: [
    holding("NVDA", 40, { shares: 18 }),
    holding("SPY", 30),
    holding("FARM", 10, { isPrivate: true, assetType: "Other" }),
    holding("CASH", 20, { assetType: "Cash", shares: 2000, nativePrice: undefined, nativeCurrency: undefined }),
  ],
} as unknown as FinancialPortfolioData;

const quotes: SuggestionQuote[] = [{ symbol: "VWCE.DE", name: "Vanguard FTSE All-World", price: 120, currency: "EUR", toBase: 1 }];

function suggestion(extra: Partial<PortfolioSuggestion> = {}): PortfolioSuggestion {
  return {
    id: "sg_1",
    portfolioId: "p1",
    key: "decrease:NVDA",
    action: "decrease",
    symbol: "NVDA",
    name: "NVDA Inc",
    fromWeight: 40,
    targetWeight: 30,
    title: "Trim",
    why: "",
    priority: 2,
    validity: { expiresAt: "2026-10-19T10:00:00Z" },
    fundedBy: [],
    status: "active",
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
    ...extra,
  };
}

describe("evaluateSuggestion", () => {
  const holdings = data.holdings;

  it("computes the amount and the whole shares to sell from live prices", () => {
    const ev = evaluateSuggestion(suggestion(), marketForSymbol("NVDA", holdings, []), 10000, NOW);
    expect(ev.status).toBe("active");
    expect(ev.deltaWeight).toBe(-10);
    expect(ev.deltaValue).toBe(-1000);
    // 220 USD at 200 EUR: 1000 / 200 = 5 shares.
    expect(ev.deltaShares).toBe(-5);
  });

  it("is done within the tolerance of the target", () => {
    const market = { ...marketForSymbol("NVDA", holdings, []), weight: 30.8 };
    expect(evaluateSuggestion(suggestion(), market, 10000, NOW).status).toBe("done");
  });

  it("reports partial progress", () => {
    const market = { ...marketForSymbol("NVDA", holdings, []), weight: 35 };
    const ev = evaluateSuggestion(suggestion(), market, 10000, NOW);
    expect(ev.status).toBe("active");
    expect(ev.progress).toBeCloseTo(0.5);
  });

  it("cancels on expiry, price range and weight range", () => {
    const market = marketForSymbol("NVDA", holdings, []);
    const later = new Date("2026-10-20T00:00:00Z");
    expect(evaluateSuggestion(suggestion(), market, 10000, later).status).toBe("cancelled");
    const price = suggestion({ validity: { expiresAt: "2026-10-19T10:00:00Z", price: { min: 230, currency: "USD" } } });
    expect(evaluateSuggestion(price, market, 10000, NOW).reason).toContain("Price");
    const weight = suggestion({ validity: { expiresAt: "2026-10-19T10:00:00Z", weight: { max: 35 } } });
    expect(evaluateSuggestion(weight, market, 10000, NOW).status).toBe("cancelled");
  });

  it("uses the quote for a symbol that is not held", () => {
    const open = suggestion({ action: "open", symbol: "VWCE.DE", key: "open:VWCE.DE", fromWeight: 0, targetWeight: 6 });
    const ev = evaluateSuggestion(open, marketForSymbol("VWCE.DE", holdings, quotes), 10000, NOW);
    expect(ev.deltaValue).toBe(600);
    expect(ev.deltaShares).toBe(5);
  });
});

describe("projectTargetPortfolio", () => {
  const rows = data.holdings.map((h) => ({ symbol: h.symbol, name: h.name, weight: h.weightPercent, isCash: h.assetType === "Cash" }));

  it("moves an unmatched sell into cash", () => {
    const t = projectTargetPortfolio(rows, [{ symbol: "NVDA", name: "NVDA", action: "decrease", targetWeight: 35 }]);
    expect(t.cash.targetWeight).toBe(25);
    expect(t.cash.deltaWeight).toBe(5);
    expect(t.sold).toBe(5);
  });

  it("balances a sell with a new position and warns on negative cash", () => {
    const balanced = projectTargetPortfolio(rows, [
      { symbol: "NVDA", name: "NVDA", action: "decrease", targetWeight: 35 },
      { symbol: "VWCE.DE", name: "All-World", action: "open", targetWeight: 5 },
    ]);
    expect(balanced.cash.deltaWeight).toBe(0);
    expect(balanced.rows.find((r) => r.symbol === "VWCE.DE")?.isNew).toBe(true);

    const over = projectTargetPortfolio(rows, [{ symbol: "SPY", name: "SPY", action: "increase", targetWeight: 60 }]);
    expect(over.cash.targetWeight).toBe(-10);
    expect(over.warnings.length).toBe(1);
  });

  it("marks a closed position", () => {
    const t = projectTargetPortfolio(rows, [{ symbol: "SPY", name: "SPY", action: "close", targetWeight: 0 }]);
    expect(t.rows.find((r) => r.symbol === "SPY")?.isClosed).toBe(true);
  });
});

describe("parseSuggestionAnswer", () => {
  it("reads JSON wrapped in text", () => {
    expect(extractJsonObject('Here:\n```json\n{"suggestions": []}\n```')).toEqual({ suggestions: [] });
    expect(() => extractJsonObject("no json")).toThrow();
  });

  it("keeps valid proposals and drops the rest with notes", () => {
    const raw = {
      summary: "Too much in one stock.",
      suggestions: [
        { action: "decrease", symbol: "nvda", fromWeight: 40, targetWeight: 30, priority: 1, title: "Trim NVDA", why: "Concentration — high.", validity: { days: 90, priceMin: 1, priceMax: 100 } },
        { action: "open", symbol: "VWCE.DE", targetWeight: 10, priority: 2, title: "Add world ETF", fundedBy: [{ key: "decrease:NVDA", weight: 10 }, { key: "close:XYZ", weight: 1 }] },
        { action: "open", symbol: "SPY", targetWeight: 35, title: "More SPY" },
        { action: "increase", symbol: "AAPL", targetWeight: 5, title: "Not held" },
        { action: "decrease", symbol: "FARM", targetWeight: 5, title: "Private" },
        { action: "decrease", symbol: "SPY", fromWeight: 10, targetWeight: 5, title: "Misread" },
        { action: "open", symbol: "ZZZZ", targetWeight: 2, title: "Unknown" },
        { action: "increase", symbol: "SPY", targetWeight: 20, title: "Wrong direction" },
      ],
    };
    const parsed = parseSuggestionAnswer(raw, data, quotes, NOW);
    expect(parsed.proposals.map((p) => p.key)).toEqual(["decrease:NVDA", "open:VWCE.DE", "increase:SPY"]);

    const nvda = parsed.proposals[0]!;
    expect(nvda.currentWeight).toBe(40);
    expect(nvda.why).not.toContain("—");
    // 90 days is capped; the price range that excludes the current price (220) loses its max only.
    expect(nvda.validity.expiresAt).toBe("2026-11-11T10:00:00.000Z");
    expect(nvda.validity.price).toEqual({ min: 1, max: undefined, currency: "USD" });

    expect(parsed.proposals[1]!.fundedBy).toEqual([{ key: "decrease:NVDA", weight: 10 }]);
    // "open" for a held symbol becomes "increase".
    expect(parsed.proposals[2]!.action).toBe("increase");
    expect(parsed.notes.length).toBe(5);
  });
});

describe("mergeSuggestions", () => {
  const market = (symbol: string) => marketForSymbol(symbol, data.holdings, quotes);
  const proposal = (extra: Partial<SuggestionProposal> = {}): SuggestionProposal => ({
    key: "decrease:NVDA",
    action: "decrease",
    symbol: "NVDA",
    name: "NVDA Inc",
    currentWeight: 40,
    targetWeight: 28,
    title: "Trim again",
    why: "",
    priority: 1,
    validity: { expiresAt: "2026-10-19T10:00:00Z" },
    fundedBy: [],
    ...extra,
  });

  it("updates an open suggestion with the same key and keeps its identity", () => {
    const res = mergeSuggestions("p1", [suggestion()], [proposal()], market, 10000, NOW);
    expect(res.suggestions.length).toBe(1);
    expect(res.suggestions[0]!.id).toBe("sg_1");
    expect(res.suggestions[0]!.targetWeight).toBe(28);
    expect(res.suggestions[0]!.fromWeight).toBe(40);
    expect(res.suggestions[0]!.createdAt).toBe("2026-10-10T10:00:00Z");
  });

  it("supersedes open suggestions the model did not repeat", () => {
    const res = mergeSuggestions("p1", [suggestion()], [], market, 10000, NOW);
    expect(res.suggestions[0]!.status).toBe("superseded");
  });

  it("skips a dismissed key until the weight moved", () => {
    const dismissed = suggestion({ id: "sg_2", status: "dismissed", dismissedAtWeight: 38 });
    expect(mergeSuggestions("p1", [dismissed], [proposal()], market, 10000, NOW).skippedDismissed).toBe(1);
    expect(isStillDismissed({ dismissedAtWeight: 30, fromWeight: 30 }, 40)).toBe(false);
  });

  it("closes a reached suggestion and starts a new one for the same key", () => {
    const reached = suggestion({ fromWeight: 50, targetWeight: 40 });
    const res = mergeSuggestions("p1", [reached], [proposal()], market, 10000, NOW);
    expect(res.suggestions.find((s) => s.id === "sg_1")?.status).toBe("done");
    expect(res.suggestions.filter((s) => s.status === "active").length).toBe(1);
  });
});

describe("suggestionRepo.saveGeneration", () => {
  const run = (portfolioId: string, summary: string) => ({
    portfolioId,
    generatedAt: NOW.toISOString(),
    txFingerprint: "fp",
    summary,
    notes: ["note"],
    provider: "test",
    model: null,
  });

  it("stores the rows and the run together, and neither when one row fails", () => {
    const portfolioId = portfolioRepo.create({ name: "Suggestion save", baseCurrency: "EUR" }).id;
    try {
      suggestionRepo.saveGeneration([suggestion({ id: "sg_save_1", portfolioId })], run(portfolioId, "first"));
      expect(suggestionRepo.findById(portfolioId, "sg_save_1")?.title).toBe("Trim");
      expect(suggestionRepo.findRun(portfolioId)?.summary).toBe("first");

      // A NOT NULL column without a value fails the second row: the first row and the run roll back.
      const broken = suggestion({ id: "sg_save_3", portfolioId, title: null as unknown as string });
      expect(() =>
        suggestionRepo.saveGeneration([suggestion({ id: "sg_save_2", portfolioId }), broken], run(portfolioId, "second")),
      ).toThrow();
      expect(suggestionRepo.findById(portfolioId, "sg_save_2")).toBeNull();
      expect(suggestionRepo.findRun(portfolioId)?.summary).toBe("first");
    } finally {
      portfolioRepo.deleteById(portfolioId);
    }
  });
});

describe("buildSuggestionPrompt", () => {
  it("carries weights and public prices but no amounts or quantities", () => {
    const [system, user] = buildSuggestionPrompt(data, { baseCurrency: "EUR", intelText: "", openKeys: ["decrease:NVDA"], dismissedKeys: [], today: "2026-10-12" });
    const text = `${system!.content}\n${user!.content}`;
    expect(text).toContain("NVDA");
    expect(text).toContain("weight 40.00%");
    expect(text).toContain("decrease:NVDA");
    expect(text).not.toContain("10000");
    expect(text).not.toContain("8000");
    expect(text).not.toContain("shares 18");
    expect(text).toContain("private asset");
  });
});

describe("parseSuggestionAnswer: edges", () => {
  const parse = (suggestions: unknown, extraQuotes: SuggestionQuote[] = []) =>
    parseSuggestionAnswer({ summary: "S", suggestions }, data, [...quotes, ...extraQuotes], NOW);
  const trim = (extra: Record<string, unknown> = {}) => ({ action: "decrease", symbol: "NVDA", fromWeight: 40, targetWeight: 30, title: "Trim NVDA", ...extra });

  it("closes at zero whatever target the model gave", () => {
    const [p] = parse([{ action: "close", symbol: "SPY", targetWeight: 99, title: "Exit SPY" }]).proposals;
    expect(p).toMatchObject({ key: "close:SPY", action: "close", targetWeight: 0, currentWeight: 30 });
  });

  it("clamps and rounds the priority", () => {
    expect(parse([trim({ priority: "0" })]).proposals[0]!.priority).toBe(1);
    expect(parse([trim({ priority: 9 })]).proposals[0]!.priority).toBe(5);
    expect(parse([trim()]).proposals[0]!.priority).toBe(3);
    expect(parse([trim({ priority: 2.6 })]).proposals[0]!.priority).toBe(3);
  });

  it("bounds the validity days", () => {
    expect(parse([trim()]).proposals[0]!.validity.expiresAt).toBe("2026-10-19T10:00:00.000Z");
    expect(parse([trim({ validity: { days: 0 } })]).proposals[0]!.validity.expiresAt).toBe("2026-10-13T10:00:00.000Z");
    expect(parse([trim({ validity: { days: "45" } })]).proposals[0]!.validity.expiresAt).toBe("2026-11-11T10:00:00.000Z");
  });

  it("keeps a weight range only when it contains the current weight", () => {
    expect(parse([trim({ validity: { weightMin: 35, weightMax: 45 } })]).proposals[0]!.validity.weight).toEqual({ min: 35, max: 45 });
    expect("weight" in parse([trim({ validity: { weightMin: 41, weightMax: 39 } })]).proposals[0]!.validity).toBe(false);
  });

  it("keeps a price range in the quote currency", () => {
    expect(parse([trim({ validity: { priceMin: 200, priceMax: 250 } })]).proposals[0]!.validity.price).toEqual({ min: 200, max: 250, currency: "USD" });
    expect("price" in parse([trim({ validity: { priceMin: 0 } })]).proposals[0]!.validity).toBe(false);
  });

  it("drops a change that is too small", () => {
    const small = parse([trim({ targetWeight: 39.5 })]);
    expect(small.proposals).toEqual([]);
    expect(small.notes.join(" ")).toContain("too small");
    expect(parse([trim({ targetWeight: 39 })]).proposals.length).toBe(1);
  });

  it("accepts numeric strings", () => {
    const [p] = parse([trim({ targetWeight: "30", fromWeight: "40" })]).proposals;
    expect(p!.targetWeight).toBe(30);
  });

  it("keeps at most eight proposals", () => {
    const qs: SuggestionQuote[] = Array.from({ length: 8 }, (_, i) => ({ symbol: `Q${i + 1}`, name: `Q${i + 1}`, price: 10, currency: "EUR", toBase: 1 }));
    const opens = qs.map((q) => ({ action: "open", symbol: q.symbol, targetWeight: 2, title: `Open ${q.symbol}` }));
    const res = parse([trim(), ...opens], qs);
    expect(res.proposals.length).toBe(8);
    expect(res.notes).toContain("1 suggestion was dropped: only 8 are kept.");
  });

  it("drops a repeated symbol", () => {
    const res = parse([trim(), { action: "increase", symbol: "NVDA", targetWeight: 50, title: "Add NVDA" }]);
    expect(res.proposals.map((p) => p.key)).toEqual(["decrease:NVDA"]);
    expect(res.notes).toContain("1 suggestion was dropped: it repeated a symbol.");
  });

  it("normalizes the action and drops incomplete items", () => {
    const res = parse([
      trim({ action: " Decrease " }),
      { action: "decrease", symbol: "CASH", targetWeight: 10, title: "Less cash" },
      { action: "decrease", symbol: "SPY", targetWeight: 20 },
      { action: "decrease", symbol: "SPY", targetWeight: 20, title: "<think>x</think>" },
      null,
    ]);
    expect(res.proposals.map((p) => p.key)).toEqual(["decrease:NVDA"]);
    expect(res.notes).toContain("4 suggestions were dropped: the answer was incomplete.");
  });

  it("returns nothing when suggestions is not a list, and trims a long summary", () => {
    const none = parseSuggestionAnswer({ summary: "S", suggestions: "nope" }, data, quotes, NOW);
    expect(none.proposals).toEqual([]);
    expect(none.notes).toEqual([]);
    const long = parseSuggestionAnswer({ summary: "x".repeat(700), suggestions: [] }, data, quotes, NOW) as { summary?: string };
    expect(long.summary).toBe("x".repeat(597) + "...");
  });

  it("keeps only valid funding sources, once each", () => {
    const res = parse([
      trim(),
      {
        action: "open",
        symbol: "VWCE.DE",
        targetWeight: 5,
        title: "Add world ETF",
        fundedBy: [
          { key: "cash", weight: 5 },
          { key: "CASH", weight: 3 },
          { key: "decrease:nvda", weight: "2.5" },
          { key: "decrease:NVDA", weight: 1 },
          { key: "x", weight: 1 },
          { key: "CASH", weight: -1 },
          { key: "close:SPY", weight: 2 },
        ],
      },
    ]);
    expect(res.proposals.find((p) => p.key === "open:VWCE.DE")!.fundedBy).toEqual([
      { key: "CASH", weight: 5 },
      { key: "decrease:NVDA", weight: 2.5 },
    ]);
  });
});

describe("extractJsonObject: edges", () => {
  it("rejects arrays, two objects and reversed braces, and reads nested JSON", () => {
    expect(() => extractJsonObject("[1,2]")).toThrow("The assistant did not return a JSON object");
    expect(() => extractJsonObject('{"a":1} and {"b":2}')).toThrow("The assistant returned JSON that is not valid");
    expect(() => extractJsonObject("}{")).toThrow("did not return");
    expect(extractJsonObject('{"a":[1,{"b":2}]}')).toEqual({ a: [1, { b: 2 }] });
  });
});

describe("PortfolioSuggestionService.generate", () => {
  type Call = { m: { role: string; content: string }[]; o: unknown };
  const VALID =
    '{"summary":"Trim.","suggestions":[{"action":"decrease","symbol":"NVDA","fromWeight":40,"targetWeight":30,"title":"Trim NVDA","why":"Too big."}]}';
  const created: string[] = [];
  afterEach(() => {
    for (const id of created.splice(0)) portfolioRepo.deleteById(id);
  });

  /**
   * One stub object serves as portfolio service, market data and LLM, so the
   * test does not depend on the order of the first three constructor arguments.
   */
  function setup(replies: string[]) {
    const id = portfolioRepo.create({ name: "Suggestion generate", baseCurrency: "EUR" }).id;
    created.push(id);
    const calls: Call[] = [];
    const stub = {
      getPortfolioData: async () => data,
      getQuotes: async () => new Map(),
      getExchangeRates: async () => new Map(),
      chat: async (m: Call["m"], o: unknown) => {
        calls.push({ m, o });
        return replies.shift()!;
      },
      resolve: () => ({ provider: "openai-compatible", model: "m" }),
    };
    type Ctor = new (...args: unknown[]) => PortfolioSuggestionService;
    const svc = new (PortfolioSuggestionService as unknown as Ctor)(stub, stub, stub, async () => EMPTY_REPORT_INTEL);
    return { id, calls, svc };
  }

  it("retries once with the parse error and stores the result", async () => {
    const { id, calls, svc } = setup(["not json", VALID]);
    await svc.generate(id, "EUR");
    expect(calls.length).toBe(2);
    expect(calls[0]!.o).toEqual({ temperature: 0.2 });
    expect(calls[1]!.o).toEqual({ temperature: 0.1 });
    expect(calls[1]!.m.length).toBe(4);
    expect(calls[1]!.m[2]).toEqual({ role: "assistant", content: "not json" });
    expect(calls[1]!.m[3]!.content).toBe("The assistant did not return a JSON object. Reply again with only the JSON object in the given shape.");

    const rows = suggestionRepo.findByPortfolio(id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ key: "decrease:NVDA", status: "active", fromWeight: 40, targetWeight: 30 });
    const run = suggestionRepo.findRun(id);
    expect(run?.summary).toBe("Trim.");
    expect(run?.provider).toBe("openai-compatible");
  });

  it("fails after two invalid answers and stores no run", async () => {
    const { id, svc } = setup(["not json", "still not json"]);
    await expect(svc.generate(id, "EUR")).rejects.toThrow("The assistant did not return a JSON object");
    expect(suggestionRepo.findRun(id)).toBeNull();
  });

  it("runs a generation in the background and reports its failure", async () => {
    const { id, svc } = setup(["not json", "still not json"]);
    const job = svc.startGeneration(id) as { status: string; startedAt?: string };
    expect(job.status).toBe("running");
    expect(typeof job.startedAt).toBe("string");
    expect(svc.startGeneration(id) as unknown).toBe(job);

    const end = Date.now() + 2000;
    let generation: unknown;
    while (Date.now() < end) {
      generation = (await svc.getSuggestions(id)).generation;
      if ((generation as { status?: string } | undefined)?.status !== "running") break;
      await Bun.sleep(5);
    }
    expect(generation).toEqual({ status: "fail", error: "The assistant did not return a JSON object" });
  });

  it("sends no amounts or quantities to the model", async () => {
    const { id, calls, svc } = setup([VALID]);
    await svc.generate(id, "EUR");
    const text = calls[0]!.m.map((m) => m.content).join("\n");
    expect(text).not.toContain("10000");
    expect(text).not.toContain("8000");
    expect(text).not.toContain("shares 18");
  });
});
