import { describe, it, expect } from "bun:test";
import { briefFingerprint, isBriefEmpty, normalizeBrief } from "portfolio-shared/brief";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { BriefAmountError, PortfolioBriefService, answerTexts, briefAmounts, briefFromAnswers, formatBriefForPrompt, readBrief } from "../portfolio-brief.js";
import type { LlmService } from "../llm.js";
import type { PortfolioService } from "../portfolio.js";

describe("normalizeBrief", () => {
  it("keeps known fields, clamps numbers and drops the rest", () => {
    const brief = normalizeBrief({
      purpose: "  retirement ",
      riskTolerance: { score: 9, maxDropPercent: -5 },
      incomeNeed: { required: true, targetYieldPercent: "3.456" },
      targetBands: [
        { assetClass: "equity", minPercent: 80, maxPercent: 60 },
        { assetClass: "Equity", minPercent: 1, maxPercent: 2 },
        { assetClass: "", minPercent: 1, maxPercent: 2 },
      ],
      constraints: ["no_crypto", "no_crypto", "", 4],
      unknown: "dropped",
    });
    expect(brief).toEqual({
      purpose: "retirement",
      riskTolerance: { score: 5, maxDropPercent: 0 },
      incomeNeed: { required: true, targetYieldPercent: 3.46 },
      targetBands: [{ assetClass: "equity", minPercent: 60, maxPercent: 80 }],
      constraints: ["no_crypto"],
    });
  });

  it("treats a brief without content as empty", () => {
    expect(isBriefEmpty({})).toBe(true);
    expect(isBriefEmpty({ purpose: "  " })).toBe(true);
    expect(isBriefEmpty({ horizon: "gt15" })).toBe(false);
  });

  it("gives the same fingerprint regardless of key order", () => {
    expect(briefFingerprint({ purpose: "growth", horizon: "gt15" })).toBe(briefFingerprint({ horizon: "gt15", purpose: "growth" }));
    expect(briefFingerprint({ purpose: "growth" })).not.toBe(briefFingerprint({ purpose: "income" }));
  });
});

describe("brief from wizard answers", () => {
  it("builds the structured fields without a model", () => {
    const brief = briefFromAnswers({
      purpose: { choice: "retirement" },
      horizon: { choice: "gt15", text: "until 2050" },
      riskTolerance: { score: 3, maxDropPercent: 25 },
      incomeNeed: { choice: "no" },
      cashFlowPattern: { choice: "contributions" },
      targetBands: [{ assetClass: "equity", minPercent: 60, maxPercent: 80 }],
      constraints: { choices: ["no_crypto"], text: "no tobacco; ESG" },
      successInOwnWords: "Retire at 60 without selling in a crash",
    });
    expect(brief.purpose).toBe("retirement");
    expect(brief.horizon).toBe("until 2050");
    expect(brief.riskTolerance).toEqual({ score: 3, maxDropPercent: 25 });
    expect(brief.incomeNeed).toEqual({ required: false });
    expect(brief.constraints).toEqual(["no_crypto", "no tobacco", "ESG"]);
  });

  it("collects every typed text for the amount scan", () => {
    expect(answerTexts({ a: { text: "x" }, b: ["y"] }, { f1: { question: "q", answer: "z" } })).toEqual(["x", "y", "q", "z"]);
  });
});

describe("brief prompt text", () => {
  it("writes option ids as English and keeps percentages", () => {
    const text = formatBriefForPrompt({ purpose: "preservation", horizon: "3to7", riskTolerance: { score: 2, maxDropPercent: 10 }, targetBands: [{ assetClass: "bonds", minPercent: 20, maxPercent: 40 }] });
    expect(text).toContain("Purpose: capital preservation");
    expect(text).toContain("Horizon: 3 to 7 years");
    expect(text).toContain("largest accepted drop 10%");
    expect(text).toContain("bonds 20 to 40%");
  });

  it("is empty without a brief", () => {
    expect(formatBriefForPrompt(null)).toBe("");
    expect(formatBriefForPrompt({})).toBe("");
  });
});

describe("amounts in the brief", () => {
  it("finds money amounts in free text", () => {
    expect(briefAmounts({ prose: "I hold 80k in ETFs and add €500 a month." }).length).toBeGreaterThan(0);
    expect(briefAmounts({ prose: "Keep equity between 60% and 80% until 2045." })).toEqual([]);
  });

  it("refuses to save a brief that names an amount, and saves a clean one", () => {
    const row = portfolioRepo.create({ name: "Brief test" });
    const service = new PortfolioBriefService({} as LlmService, { clearPortfolioCache: () => {} } as unknown as PortfolioService);
    expect(() => service.saveBrief(row.id, { prose: "I have $250,000 saved." })).toThrow(BriefAmountError);

    const saved = service.saveBrief(row.id, { purpose: "growth", prose: "Grow the money over 20 years." });
    expect(saved.brief).toEqual({ purpose: "growth", prose: "Grow the money over 20 years." });
    const stored = portfolioRepo.findById(row.id)!;
    expect(stored.description).toBe("Grow the money over 20 years.");
    expect(JSON.parse(stored.briefJson!)).toEqual({ purpose: "growth" });
    expect(readBrief(stored)).toEqual(saved.brief);
    portfolioRepo.deleteById(row.id);
  });
});
