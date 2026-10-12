import { describe, it, expect, mock } from "bun:test";
import { getMacroSnapshot, type MacroDeps } from "../intel/macro.js";
import type { YahooChartData } from "../yahoo-finance.js";

/** Macro deps without FMP: the yield curve comes from four Yahoo charts, every other piece is empty. */
function yahooOnlyDeps() {
  const chart: YahooChartData = {
    symbol: "^TNX",
    currency: "USD",
    regularMarketPrice: 4.2,
    candles: [{ timestamp: 1, date: "2026-10-09", open: 4.2, high: 4.2, low: 4.2, close: 4.2, volume: 0 }],
  };
  const getChart = mock(async () => chart);
  const deps = {
    fmp: { isConfigured: () => false },
    yahoo: { getChart },
    marketData: { getQuotesWithSource: async () => ({ data: new Map(), sources: new Map(), missing: [], tried: [] }) },
  } as unknown as MacroDeps;
  return { deps, getChart };
}

describe("macro snapshot cache", () => {
  it("keeps a snapshot per three-letter currency code", async () => {
    const { deps, getChart } = yahooOnlyDeps();
    await getMacroSnapshot(deps, { baseCurrency: "chf", forceFresh: true });
    const calls = getChart.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    const again = await getMacroSnapshot(deps, { baseCurrency: "CHF" });
    expect(again.baseCurrency).toBe("CHF");
    expect(getChart.mock.calls.length).toBe(calls);
  });

  it("does not cache any other base currency value", async () => {
    const { deps, getChart } = yahooOnlyDeps();
    await getMacroSnapshot(deps, { baseCurrency: "not-a-code" });
    const calls = getChart.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    await getMacroSnapshot(deps, { baseCurrency: "not-a-code" });
    expect(getChart.mock.calls.length).toBe(calls * 2);
  });
});
