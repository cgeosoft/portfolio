import { describe, it, expect } from "bun:test";
import { isEnglishOutput, languageInstruction, plainStyle, withLanguageInstruction } from "../output-language.js";
import { buildSuggestionPrompt } from "../portfolio-suggestions.js";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";

describe("languageInstruction", () => {
  it("is empty for English, a missing code and an unknown code", () => {
    expect(languageInstruction("en")).toBe("");
    expect(languageInstruction(undefined)).toBe("");
    expect(languageInstruction("xx")).toBe("");
    expect(isEnglishOutput("xx")).toBe(true);
  });

  it("names the language by its English name and keeps tickers and numbers", () => {
    const line = languageInstruction("el");
    expect(line).toContain("Write your whole answer in Greek");
    expect(line).toContain("Keep tickers, ISINs, currency codes, numbers and product names unchanged.");
    expect(isEnglishOutput("el")).toBe(false);
  });

  it("names only the text fields of a JSON answer and keeps the structure in English", () => {
    const line = languageInstruction("de", { jsonFields: ["summary", "title", "why"] });
    expect(line).toContain('Write the "summary", "title" and "why" values in German.');
    expect(line).toContain("Keep the JSON keys and all other values");
    expect(line).not.toContain("whole answer");
    expect(languageInstruction("de", { jsonFields: ["reason"] })).toContain('Write the "reason" value in German.');
  });

  it("appends the instruction as the last paragraph, and leaves English prompts unchanged", () => {
    expect(withLanguageInstruction("Prompt.", "en")).toBe("Prompt.");
    expect(withLanguageInstruction("Prompt.", "fr")).toBe(`Prompt.\n\n${languageInstruction("fr")}`);
  });

  it("asks for Simplified English only when the output is English", () => {
    expect(plainStyle("en")).toBe("ASD-STE100 Simplified English");
    expect(plainStyle("ja")).toBe("short, simple sentences");
  });
});

describe("prompts with a language", () => {
  const data: FinancialPortfolioData = { holdings: [], transactions: [] } as unknown as FinancialPortfolioData;
  const ctx = { baseCurrency: "EUR", intelText: "", openKeys: [], dismissedKeys: [], today: "2026-10-13" };

  it("keeps the English suggestion prompt free of a language instruction", () => {
    const [system] = buildSuggestionPrompt(data, ctx);
    expect(system!.content).toContain("Use ASD-STE100 Simplified English.");
    expect(system!.content).not.toContain("Keep the JSON keys");
  });

  it("asks for the text fields of the suggestions in the language", () => {
    const [system] = buildSuggestionPrompt(data, { ...ctx, language: "es" });
    expect(system!.content).not.toContain("ASD-STE100");
    expect(system!.content.endsWith(languageInstruction("es", { jsonFields: ["summary", "title", "why"] }))).toBe(true);
  });
});
