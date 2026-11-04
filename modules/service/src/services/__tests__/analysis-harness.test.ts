/**
 * Guided Analysis: the harness with a scripted model, the two model port
 * adapters, number grounding, the graph privacy check and the calc math.
 */
import { describe, it, expect } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding } from "portfolio-shared/portfolio";
import * as analysisRepo from "../../db/analysis.repo.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import * as reportRepo from "../../db/report.repo.js";
import * as suggestionRepo from "../../db/suggestion.repo.js";
import { RunGraph, cutSummary } from "../analysis/graph.js";
import { graphContext } from "../analysis/context.js";
import { seedCore } from "../analysis/seed.js";
import { checkProposals } from "../analysis/suggestion-checks.js";
import { RunHarness, newRunState } from "../analysis/harness.js";
import { createModelPort, type ModelPort, type PortRequest, type PortTurn } from "../analysis/model-port.js";
import { dropUngroundedSentences, nodeNumbers, numbersIn, ungroundedNumbers } from "../analysis/grounding.js";
import { alignSeries, beta, concentration, correlation, maxDrawdown, riskContributions } from "../analysis/math.js";
import { compareRuns } from "../analysis/compare.js";
import { calcConcentration } from "../analysis/tools/calc.js";
import type { AnalysisDeps } from "../analysis/types.js";
import { PortfolioSuggestionService, type SuggestionProposal } from "../portfolio-suggestions.js";
import { PrivacyError, toPromptSafe } from "../llm-privacy.js";
import type { LlmService } from "../llm.js";
import type { PortfolioService } from "../portfolio.js";
import type { AnalysisNode } from "portfolio-shared/api-types";

/** A total with distinctive digits: it must never reach a prompt. */
const CANARY_TOTAL = 7_654_321.09;

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
    currentValue: (CANARY_TOTAL * weight) / 100,
    dayChangeDollar: 0,
    dayChangePercent: 1,
    totalGainLossDollar: 0,
    totalGainLossPercent: 10,
    weightPercent: weight,
    currency: "EUR",
    nativePrice: 200,
    nativeCurrency: "EUR",
    rsi: 71,
    sma50: 190,
    sma200: 160,
    ...extra,
  };
}

const data = {
  summary: { totalValue: CANARY_TOTAL * 0.8, totalPortfolioValue: CANARY_TOTAL, cashWeightPercent: 20, stockWeightPercent: 80, etfWeightPercent: 0, cryptoWeightPercent: 0, otherWeightPercent: 0, totalGainLossPercent: 12, dayGainLossPercent: 0.4, baseCurrency: "EUR" },
  holdings: [holding("AAA", 60), holding("BBB", 20), holding("CASH", 20, { assetType: "Cash", shares: 1000 })],
} as unknown as FinancialPortfolioData;

function candles(seed: number) {
  const out = [];
  let price = 100;
  for (let i = 0; i < 260; i++) {
    price *= 1 + Math.sin(i * seed) * 0.01;
    const date = new Date(Date.UTC(2025, 9, 1) + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ timestamp: 0, date, open: price, high: price, low: price, close: price, volume: 0 });
  }
  return out;
}

const deps = {
  marketData: {
    getChart: async (symbol: string) => {
      if (symbol === "ZZZ") throw new Error("unknown");
      return { symbol, currency: "EUR", regularMarketPrice: 100, candles: candles(symbol.length + symbol.charCodeAt(0) / 50) };
    },
    getQuotes: async () => new Map(),
    getExchangeRates: async () => new Map(),
    getMarketNewsWithSource: async () => ({ data: [], source: null }),
  },
  fmp: { isConfigured: () => false },
  finnhub: { isConfigured: () => false },
  yahoo: {},
  portfolioService: {},
  income: {},
} as unknown as AnalysisDeps;

const ok = (output: Record<string, unknown>, calls: PortTurn["calls"] = []): PortTurn => ({ calls, output, done: false, note: "", errors: [] });

/** A model that follows a script per phase and records every request. */
class ScriptedPort implements ModelPort {
  readonly mode = "json" as const;
  readonly requests: PortRequest[] = [];
  constructor(private readonly graph: RunGraph) {}

  private idOf(createdBy: string): string {
    return this.graph.nodes.find((n) => n.createdBy === createdBy && n.status === "ready")?.id ?? "missing";
  }

  async step(req: PortRequest): Promise<PortTurn> {
    this.requests.push(req);
    const expandSteps = this.requests.filter((r) => r.output.name === "step result").length;
    switch (req.output.name) {
      case "questions":
        return ok({ questions: [{ title: "Is AAA too large for the risk the brief accepts?", briefField: "riskTolerance", why: "One stock drives the risk." }] });
      case "step result":
        if (expandSteps === 1) {
          return ok({ findings: [] }, [
            { id: "c1", name: "get_indicators", args: { symbol: "AAA" }, questionId: "Q1" },
            { id: "c2", name: "get_indicators", args: { symbol: "ZZZ" }, questionId: "Q1" },
          ]);
        }
        return ok({
          findings: [
            {
              questionId: "Q1",
              title: "AAA dominates the portfolio",
              summary: "AAA is 60% of the portfolio while the brief accepts a drop of 15%.",
              stance: "risk",
              severity: 3,
              briefField: "riskTolerance",
              supports: [this.idOf("calc_concentration"), "H1"],
              contradicts: [this.idOf("get_indicators")],
            },
            { questionId: "Q1", title: "AAA could fall 37%", summary: "It could fall 37% in a crash.", stance: "risk", severity: 2, supports: ["H1"] },
          ],
        });
      case "fixed findings":
        return ok({ findings: [] });
      case "synthesis":
        return ok({ themes: [{ title: "Single stock risk", summary: "One stock.", cites: ["H1"] }] });
      case "suggestions":
        return ok({
          summary: "Trim the largest position.",
          suggestions: [
            { action: "decrease", symbol: "AAA", fromWeight: 60, targetWeight: 40, priority: 1, title: "Trim AAA", why: "It dominates.", findings: ["F1"], evidence: [this.idOf("calc_concentration")], goal: "riskTolerance", validity: { days: 7 } },
            { action: "increase", symbol: "BBB", fromWeight: 20, targetWeight: 30, title: "Add BBB", why: "Balance.", findings: [] },
          ],
        });
      case "report":
        return ok({
          whereYouStand: "The portfolio leans on one stock: AAA is 60% of it.",
          matters: [{ findingId: "F1", text: "AAA could fall 99% in a crash." }],
          actions: [{ suggestionId: "S1", text: "Trim AAA to 40%." }],
        });
      default:
        throw new Error(`unexpected output ${req.output.name}`);
    }
  }
}

function startRun(portfolioId: string): analysisRepo.AnalysisRunRow {
  const now = new Date().toISOString();
  const row: analysisRepo.AnalysisRunRow = {
    id: analysisRepo.newRunId(),
    portfolioId,
    status: "running",
    phase: "seed",
    briefJson: "{}",
    briefFingerprint: "{}",
    txFingerprint: suggestionRepo.transactionFingerprint(portfolioId),
    baseCurrency: "EUR",
    provider: "claude-cli",
    model: null,
    toolMode: "json",
    trigger: "manual",
    stepCount: 0,
    toolCount: 0,
    nodeCount: 0,
    summary: null,
    notes: "[]",
    stateJson: null,
    startedAt: now,
    endedAt: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  analysisRepo.insertRun(row);
  return row;
}

describe("Guided Analysis harness with a scripted model", () => {
  it("runs every phase, validates the model and stores the outputs", async () => {
    const portfolio = portfolioRepo.create({ name: "Harness test" });
    const row = startRun(portfolio.id);
    const graph = new RunGraph(row.id);
    const port = new ScriptedPort(graph);
    const suggestions = new PortfolioSuggestionService({} as LlmService, {} as PortfolioService, deps.marketData);
    const harness = new RunHarness(
      {
        row,
        graph,
        state: newRunState(),
        port,
        data,
        brief: { purpose: "preservation", riskTolerance: { score: 2, maxDropPercent: 15 } },
        language: undefined,
        signal: new AbortController().signal,
        onLive: () => {},
      },
      {
        deps,
        suggestions,
        seedContext: async (ctx) => {
          await calcConcentration.run({}, { ...ctx, depth: 1 });
          return [];
        },
      },
    );
    await harness.execute();

    const stored = analysisRepo.findRunRow(row.id)!;
    expect(stored.phase).toBe("done");
    const nodes = analysisRepo.listNodes(row.id);
    const kinds = nodes.map((n) => n.kind);
    expect(kinds).toContain("brief");
    expect(kinds).toContain("allocation");
    expect(kinds).toContain("indicator");
    expect(kinds).not.toContain("theme"); // one citation is not enough

    // The grounded finding stays, the one with an invented number goes.
    const findings = nodes.filter((n) => n.kind === "finding");
    expect(findings.map((f) => f.title)).toEqual(["AAA dominates the portfolio"]);
    const edges = analysisRepo.listEdges(row.id);
    expect(edges.some((e) => e.type === "contradicts" && e.targetId === findings[0]!.id)).toBe(true);
    expect(nodes.find((n) => n.id === "Q1")?.facts.status).toBe("closed");

    // Only the suggestion that acts on a finding is kept, with its evidence.
    const saved = suggestionRepo.findByPortfolio(portfolio.id).filter((s) => s.status === "active");
    expect(saved.map((s) => s.key)).toEqual(["decrease:AAA"]);
    expect(saved[0]!.runId).toBe(row.id);
    expect(saved[0]!.evidence?.findings).toEqual(["F1"]);

    // The short report links to nodes and drops the sentence with an invented number.
    const report = reportRepo.findByRun(portfolio.id, row.id)!;
    expect(report.content).toContain("(#node/F1)");
    expect(report.content).toContain("Trim AAA to 40%.");
    expect(report.content).not.toContain("99%");

    const notes = JSON.parse(stored.notes) as string[];
    expect(notes.some((n) => n.includes("finding"))).toBe(true);
    expect(notes.some((n) => n.includes("acted on no finding"))).toBe(true);

    // No amount of the ledger reaches the model.
    const prompts = JSON.stringify(port.requests.map((r) => [r.system, r.user]));
    expect(prompts).not.toContain("7654321");
    expect(prompts).not.toContain("4592592"); // 60% of the canary total
    portfolioRepo.deleteById(portfolio.id);
  });
});

describe("model port adapters", () => {
  const tools = [calcConcentration];
  const output = { name: "step result", description: "d", schema: { type: "object" as const, properties: {} } };

  it("JSON actions: reads calls, output and note, and drops unknown tools", async () => {
    const llm = {
      chat: async () => `Sure: {"calls": [{"tool": "calc_concentration", "args": {}, "questionId": "Q1"}, {"tool": "rm_rf", "args": {}}], "output": {"findings": []}, "done": true, "note": "Checked."}`,
    } as unknown as LlmService;
    const turn = await createModelPort(llm, "json").step({ system: "s", user: "u", tools, output, signal: new AbortController().signal });
    expect(turn.calls).toEqual([{ id: "c1", name: "calc_concentration", args: {}, questionId: "Q1" }]);
    expect(turn.errors[0]).toContain("rm_rf");
    expect(turn.output).toEqual({ findings: [] });
    expect(turn.done).toBe(true);
    expect(turn.note).toBe("Checked.");
  });

  it("JSON actions: repairs one broken reply", async () => {
    let calls = 0;
    const llm = { chat: async () => (++calls === 1 ? "no json here" : `{"output": {"questions": []}}`) } as unknown as LlmService;
    const turn = await createModelPort(llm, "json").step({ system: "s", user: "u", tools: [], output, signal: new AbortController().signal });
    expect(calls).toBe(2);
    expect(turn.output).toEqual({ questions: [] });
  });

  it("native tools: splits data calls from the submit call", async () => {
    const llm = {
      chatWithTools: async () => ({
        text: "",
        toolCalls: [
          { id: "a", name: "calc_concentration", arguments: `{"question_id": "Q2"}` },
          { id: "b", name: "submit", arguments: `{"findings": [], "done": false, "note": "More data."}` },
        ],
      }),
    } as unknown as LlmService;
    const turn = await createModelPort(llm, "native").step({ system: "s", user: "u", tools, output, signal: new AbortController().signal });
    expect(turn.calls).toEqual([{ id: "c1", name: "calc_concentration", args: {}, questionId: "Q2" }]);
    expect(turn.output).toMatchObject({ findings: [] });
    expect(turn.note).toBe("More data.");
  });
});

describe("number grounding", () => {
  it("reads numbers and skips labels", () => {
    expect(numbersIn("AAA is 60.5% and SMA200 is above; 10Y yield 4.2%, Q3 1,250")).toEqual([60.5, 4.2, 1250]);
  });

  it("accepts rounded sources and free numbers, refuses invented ones", () => {
    expect(ungroundedNumbers("weight 34% over 5 years in 2030", [33.6])).toEqual([]);
    expect(ungroundedNumbers("could fall 37%", [33.6])).toEqual([37]);
  });

  it("drops only the sentences with invented numbers", () => {
    expect(dropUngroundedSentences("Weight is 4.2% now. It could fall 37%. Hold.", [4.2])).toBe("Weight is 4.2% now. Hold.");
  });
});

describe("graph privacy", () => {
  it("refuses a node whose facts carry an amount", () => {
    const graph = new RunGraph("r");
    expect(() => graph.addNode({ kind: "calc", title: "x", facts: { value: 1234.5 }, summary: "", createdBy: "t", depth: 1 })).toThrow(PrivacyError);
    expect(graph.addNode({ kind: "calc", title: "x", facts: { valuePercent: 12, beta: 1.1, text: "ok" }, summary: "", createdBy: "t", depth: 1 }).id).toBe("N1");
  });

  it("serialises node facts through the prompt gate", () => {
    const graph = new RunGraph("r");
    const n = graph.addNode({ kind: "holding", title: "AAA", facts: { weightPercent: 60 }, local: { value: CANARY_TOTAL }, summary: "AAA 60%", createdBy: "seed", depth: 1 });
    expect(String(toPromptSafe(n.facts))).not.toContain("7654321");
  });
});

describe("calc math", () => {
  it("measures drawdown, concentration and correlation", () => {
    expect(maxDrawdown([100, 120, 90, 130]).percent).toBe(25);
    expect(concentration([50, 25, 25])).toEqual({ largestPercent: 50, top5Percent: 100, effectiveHoldings: 2.7 });
    expect(correlation([0.01, 0.02, -0.01, 0.03], [0.02, 0.04, -0.02, 0.06])).toBe(1);
    expect(beta([0.02, 0.04, -0.02], [0.01, 0.02, -0.01])).toBe(2);
  });

  it("splits risk by holding and aligns series on shared dates", () => {
    const r = new Map([
      ["A", [0.01, -0.02, 0.03, -0.01]],
      ["B", [0.001, 0.002, -0.001, 0.0]],
    ]);
    const split = riskContributions(r, new Map([["A", 50], ["B", 50]]));
    expect(split.get("A")!).toBeGreaterThan(90);
    const aligned = alignSeries(new Map([["A", { dates: ["d1", "d2", "d3"], closes: [1, 2, 3] }], ["B", { dates: ["d2", "d3", "d4"], closes: [5, 6, 7] }]]), 2);
    expect(aligned.dates).toEqual(["d2", "d3"]);
    expect(aligned.closes.get("B")).toEqual([5, 6]);
  });
});

describe("run comparison", () => {
  const finding = (id: string, title: string, extra: Record<string, unknown> = {}): AnalysisNode => ({
    id, runId: "r", kind: "finding", title, facts: { briefField: "riskTolerance", stance: "risk", ...extra }, summary: "", createdBy: "m", depth: 2, relevance: 1, status: "ready", createdAt: "",
  });
  const weight = (symbol: string, w: number): AnalysisNode => ({
    id: symbol, runId: "r", kind: "holding", title: symbol, facts: { symbol, weightPercent: w }, summary: "", createdBy: "seed", depth: 1, relevance: 1, status: "ready", createdAt: "",
  });

  it("matches findings across runs and lists weight moves", () => {
    const res = compareRuns(
      "now",
      [finding("F1", "AAA dominates the portfolio"), finding("F2", "Yield below the income need", { briefField: "incomeNeed" }), weight("AAA", 50)],
      "before",
      [finding("F1", "AAA dominates the whole portfolio"), finding("F3", "Cash drag"), weight("AAA", 60)],
    );
    expect(res.keptFindings.map((f) => f.id)).toEqual(["F1"]);
    expect(res.newFindings.map((f) => f.id)).toEqual(["F2"]);
    expect(res.resolvedFindings.map((f) => f.id)).toEqual(["F3"]);
    expect(res.changedWeights).toEqual([{ symbol: "AAA", previousWeight: 60, currentWeight: 50, diff: -10 }]);
  });
});

describe("number grounding of real model text", () => {
  const fact = (facts: Record<string, unknown>) => nodeNumbers({ kind: "calc", facts, summary: "" } as unknown as AnalysisNode);

  it("needs a source for every percentage, round or not", () => {
    expect(ungroundedNumbers("AAA is 50% of it, fell 20% and yields 8%.", [99.9])).toEqual([50, 20, 8]);
    expect(ungroundedNumbers("The 50 day and 200 day averages over 5 years.", [])).toEqual([]);
    expect(ungroundedNumbers("All of it, 100%, and none of it, 0%.", [])).toEqual([]);
  });

  it("keeps the sign of a source", () => {
    const fall = fact({ changePercent: -12.5 });
    expect(ungroundedNumbers("AAA rose 12.5%.", fall)).toEqual([12.5]);
    expect(ungroundedNumbers("AAA +12.5%.", fall)).toEqual([12.5]);
    expect(ungroundedNumbers("AAA fell 12.5%.", fall)).toEqual([]);
    expect(ungroundedNumbers("AAA fell 12.5%.", fact({ changePercent: 12.5 }))).toEqual([12.5]);
    expect(ungroundedNumbers("AAA fell as much as 8.2%.", fact({ maxDrawdownPercent: 8.2 }))).toEqual([]);
  });

  it("keeps the unit of a source", () => {
    expect(ungroundedNumbers("AAA is 71% of the portfolio.", fact({ rsi: 71 }))).toEqual([71]);
    expect(ungroundedNumbers("RSI of 71.", fact({ rsi: 71 }))).toEqual([]);
    expect(ungroundedNumbers("Cut it by 37.3pp and 250bps.", [])).toEqual([37.3, 250]);
  });

  it("reads the number formats of every language", () => {
    expect(ungroundedNumbers("AAA ist 34,6 % des Portfolios", [34.6])).toEqual([]);
    expect(ungroundedNumbers("Rendite 1,5 %", [99.9])).toEqual([1.5]);
    expect(ungroundedNumbers("الوزن ٣٤٫٥٪", [34.5])).toEqual([]);
    expect(ungroundedNumbers("الوزن ٨٨٪", [34.5])).toEqual([88]);
    expect(ungroundedNumbers("占比34.6%。", [34.6])).toEqual([]);
    expect(ungroundedNumbers("占比88%。", [34.6])).toEqual([88]);
  });
});

describe("Guided Analysis failure handling and checks", () => {
  const fine = (name: string): PortTurn => {
    if (name === "questions") return ok({ questions: [{ title: "Too large?", briefField: "riskTolerance" }] });
    if (name === "step result") return { ...ok({ findings: [{ questionId: "Q1", title: "AAA dominates", summary: "AAA is 60% of the portfolio.", stance: "risk", severity: 3, supports: ["H1"] }] }), done: true };
    if (name === "synthesis") return ok({ themes: [] });
    if (name === "suggestions") return ok({ summary: "Trim.", suggestions: [{ action: "decrease", symbol: "AAA", fromWeight: 60, targetWeight: 40, title: "Trim AAA", why: "Too big.", findings: ["F1"], evidence: ["H1"] }] });
    if (name === "report") return ok({ whereYouStand: "AAA is 60% of it.", matters: [{ findingId: "F1", text: "AAA is large." }] });
    return ok({});
  };

  async function run(portfolioId: string, script: (name: string) => PortTurn, language?: string) {
    const row = startRun(portfolioId);
    const graph = new RunGraph(row.id);
    const port: ModelPort = { mode: "json", step: async (req) => script(req.output.name) };
    const suggestions = new PortfolioSuggestionService({} as LlmService, {} as PortfolioService, deps.marketData);
    const harness = new RunHarness(
      { row, graph, state: newRunState(), port, data, brief: { purpose: "growth" }, language, signal: new AbortController().signal, onLive: () => {} },
      { deps, suggestions, seedContext: async () => [] },
    );
    return { row, graph, done: harness.execute() };
  }
  const activeKeys = (id: string) => suggestionRepo.findByPortfolio(id).filter((s) => s.status === "active").map((s) => s.key);

  it("fails a run with no verified finding and keeps the open suggestions and report list", async () => {
    const portfolio = portfolioRepo.create({ name: "No findings" });
    await (await run(portfolio.id, fine)).done;
    expect(activeKeys(portfolio.id)).toEqual(["decrease:AAA"]);

    const refused = (name: string) => (name === "step result" || name === "fixed findings" ? { ...ok({ findings: [{ questionId: "Q1", title: "Crash", summary: "It could fall 37%.", stance: "risk", severity: 3, supports: ["H1"] }] }), done: true } : fine(name));
    const second = await run(portfolio.id, refused);
    await expect(second.done).rejects.toThrow("without a verified finding");
    expect(activeKeys(portfolio.id)).toEqual(["decrease:AAA"]);
    expect(reportRepo.findByRun(portfolio.id, second.row.id)).toBeFalsy();
    portfolioRepo.deleteById(portfolio.id);
  });

  it("counts answers it cannot read as failed steps", async () => {
    const portfolio = portfolioRepo.create({ name: "Bad shape" });
    await (await run(portfolio.id, fine)).done;
    const bad = await run(portfolio.id, () => ({ calls: [], output: null, done: false, note: "", errors: [] }));
    await expect(bad.done).rejects.toThrow("did not answer");
    expect(activeKeys(portfolio.id)).toEqual(["decrease:AAA"]);
    portfolioRepo.deleteById(portfolio.id);
  });

  it("keeps the open suggestions when the suggestion answer has no list", async () => {
    const portfolio = portfolioRepo.create({ name: "No list" });
    await (await run(portfolio.id, fine)).done;
    const noList = await run(portfolio.id, (name) => (name === "suggestions" ? ok({ summary: "Nothing." }) : fine(name)));
    await noList.done;
    expect(activeKeys(portfolio.id)).toEqual(["decrease:AAA"]);
    portfolioRepo.deleteById(portfolio.id);
  });

  it("accepts a finding written with a decimal comma", async () => {
    const portfolio = portfolioRepo.create({ name: "German" });
    const german = (name: string) => (name === "step result" ? { ...ok({ findings: [{ questionId: "Q1", title: "AAA dominiert", summary: "AAA macht 60,0 % des Portfolios aus.", stance: "risk", severity: 3, supports: ["H1"] }] }), done: true } : fine(name));
    const r = await run(portfolio.id, german, "de");
    await r.done;
    expect(r.graph.byKind("finding").map((f) => f.title)).toEqual(["AAA dominiert"]);
    portfolioRepo.deleteById(portfolio.id);
  });

  it("refuses a finding that cites only questions or other findings", async () => {
    const portfolio = portfolioRepo.create({ name: "No evidence" });
    const empty = (name: string) => (name === "step result" || name === "fixed findings" ? { ...ok({ findings: [{ questionId: "Q1", title: "A crash is coming", summary: "AAA will collapse.", stance: "risk", severity: 3, supports: ["Q1", "B"] }] }), done: true } : fine(name));
    const r = await run(portfolio.id, empty);
    await expect(r.done).rejects.toThrow("without a verified finding");
    expect(r.graph.byKind("finding")).toEqual([]);
    portfolioRepo.deleteById(portfolio.id);
  });

  it("removes invented numbers from a suggestion and refuses a title that has one", async () => {
    const portfolio = portfolioRepo.create({ name: "Invented" });
    const invented = (name: string) =>
      name === "suggestions"
        ? ok({
            summary: "Analysts expect 73.1% upside. Trim it.",
            suggestions: [
              { action: "decrease", symbol: "AAA", fromWeight: 60, targetWeight: 40, title: "Trim AAA to 40%", why: "It is 60% of the portfolio. It will fall 31.4% by March.", findings: ["F1"] },
              { action: "decrease", symbol: "BBB", fromWeight: 20, targetWeight: 10, title: "BBB falls 47.7%", why: "It is large.", findings: ["F1"] },
            ],
          })
        : fine(name);
    const r = await run(portfolio.id, invented);
    await r.done;
    const saved = suggestionRepo.findByPortfolio(portfolio.id).filter((s) => s.status === "active");
    expect(saved.map((s) => s.key)).toEqual(["decrease:AAA"]);
    expect(saved[0]!.why).toBe("It is 60% of the portfolio.");
    portfolioRepo.deleteById(portfolio.id);
  });

  it("drops buys that break a constraint or that the answer cannot pay for", () => {
    const proposal = (action: SuggestionProposal["action"], symbol: string, currentWeight: number, targetWeight: number, priority = 3): SuggestionProposal => ({ key: `${action}:${symbol}`, action, symbol, name: symbol, currentWeight, targetWeight, title: "t", why: "w", priority, validity: { expiresAt: "" }, fundedBy: [] });
    const portfolio = { summary: { cashWeightPercent: 5 }, holdings: [holding("AAA", 60), holding("BBB", 20)] } as unknown as FinancialPortfolioData;
    const crypto = checkProposals([proposal("open", "BTC-USD", 0, 3)], portfolio, { constraints: ["no_crypto"] });
    expect(crypto).toEqual({ proposals: [], dropped: 1 });

    const paid = checkProposals([proposal("decrease", "AAA", 60, 50), proposal("increase", "BBB", 20, 32, 1), proposal("open", "CCC", 0, 10, 2)], portfolio, {});
    expect(paid.proposals.map((p) => p.symbol)).toEqual(["AAA", "BBB"]);
    expect(paid.dropped).toBe(1);
  });

  it("shows the whole brief to the model and ends a long finding at a sentence", () => {
    const graph = new RunGraph("r");
    const success = "Retire comfortably and never sell during a crash.";
    seedCore(graph, data, {
      purpose: "retirement",
      horizon: "gt15",
      riskTolerance: { score: 2, maxDropPercent: 15 },
      incomeNeed: { required: true, targetYieldPercent: 3 },
      cashFlowPattern: "contributions",
      targetBands: [{ assetClass: "equity", minPercent: 60, maxPercent: 80 }, { assetClass: "bonds", minPercent: 10, maxPercent: 30 }],
      constraints: ["no_crypto", "esg", "home_bias", "tax_wrapper", "no_leverage"],
      successInOwnWords: success,
    });
    const prompt = graphContext(graph);
    expect(prompt).toContain("no leverage");
    expect(prompt).toContain(success);

    const long = `${"A first full sentence of the finding. ".repeat(24)}And the end.`;
    const cut = cutSummary(long, "finding");
    expect(cut.length).toBeLessThanOrEqual(700);
    expect(cut.endsWith("finding.")).toBe(true);
  });
});
