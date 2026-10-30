/** Benchmark history and comparison, risk-free rate and the yield curve, with FMP and Yahoo stubs. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock, setSystemTime } from "bun:test";
import {
  normalizeBenchmarkRange,
  normalizeBenchmarkSymbol,
  benchmarkLabel,
  configuredBenchmark,
  getBenchmarkHistory,
  getBenchmarkComparison,
} from "../intel/benchmark";
import { getYieldCurve, getRiskFreeRate, DEFAULT_RISK_FREE_RATE } from "../intel/macro";
import { loadConfig, saveConfig } from "../../config";
import * as portfolioRepo from "../../db/portfolio.repo";
import type { YahooChartData } from "../yahoo-finance";

const candle = (date: string, close: number) => ({ timestamp: Date.parse(`${date}T00:00:00Z`), date, open: close, high: close, low: close, close, volume: 0 });

function chart(symbol: string, closes: [string, number][]): YahooChartData {
  const candles = closes.map(([d, c]) => candle(d, c));
  return { symbol, currency: "USD", regularMarketPrice: candles.at(-1)?.close ?? 0, candles };
}

function yahooStub(closes: [string, number][]) {
  return { getChart: mock(async (symbol: string, _range?: string, _interval?: string, _fresh?: boolean) => chart(symbol, closes)) };
}

const fmpOff = { isConfigured: () => false, getEodChart: mock(async () => null), get: mock(async () => null) };

/** Deps typed loosely: the benchmark and macro helpers only read the methods stubbed here. */
const deps = (d: Record<string, unknown>) => d as never;

beforeEach(() => {
  setSystemTime(new Date("2026-03-15T12:00:00Z"));
});
afterEach(() => {
  setSystemTime();
});

describe("benchmark", () => {
  const original = loadConfig();
  let portfolio: portfolioRepo.PortfolioRow;

  beforeAll(() => {
    portfolio = portfolioRepo.create({ name: "Benchmark test", baseCurrency: "EUR" });
  });
  afterAll(() => {
    saveConfig(original);
    portfolioRepo.deleteById(portfolio.id);
  });

  it("normalizes ranges, symbols and labels", () => {
    expect(normalizeBenchmarkRange(" 6MO ")).toBe("6mo");
    expect(normalizeBenchmarkRange("ytd")).toBe("ytd");
    expect(normalizeBenchmarkRange("max")).toBe("max");
    expect(normalizeBenchmarkRange("2w")).toBe("1y");
    expect(normalizeBenchmarkRange("100d")).toBe("1y");
    expect(normalizeBenchmarkRange(null as never)).toBe("1y");
    expect(normalizeBenchmarkSymbol(" ^gspc ")).toBe("^GSPC");
    expect(normalizeBenchmarkSymbol("EURUSD=X")).toBe("EURUSD=X");
    expect(normalizeBenchmarkSymbol("spy!")).toBeNull();
    expect(normalizeBenchmarkSymbol("A".repeat(21))).toBeNull();
    expect(normalizeBenchmarkSymbol("")).toBeNull();
    expect(benchmarkLabel("^GSPC")).toBe("S&P 500");
    expect(benchmarkLabel("URTH")).toBe("MSCI World (URTH)");
    expect(benchmarkLabel("ZZZ")).toBe("ZZZ");
  });

  it("reads the configured benchmark", () => {
    saveConfig({ ...original, benchmarkSymbol: "none" } as never);
    expect(configuredBenchmark()).toBeNull();
    saveConfig({ ...original, benchmarkSymbol: " ^ndx " } as never);
    expect(configuredBenchmark()).toBe("^NDX");
    saveConfig({ ...original, benchmarkSymbol: "bad!" } as never);
    expect(configuredBenchmark()).toBeNull();
    saveConfig(original);
  });

  it("compares the portfolio with the benchmark over the overlapping dates", async () => {
    const data = {
      id: portfolio.id,
      name: portfolio.name,
      baseCurrency: "EUR",
      summary: {},
      holdings: [],
      transactions: [],
      individualCharts: {},
      chartHistory: [
        { date: "2026-02-16", timestamp: Date.parse("2026-02-16T00:00:00Z"), totalValue: 100, totalCost: 100, totalGainLoss: 0 },
        { date: "2026-03-02", timestamp: Date.parse("2026-03-02T00:00:00Z"), totalValue: 110, totalCost: 100, totalGainLoss: 10 },
        { date: "2026-03-13", timestamp: Date.parse("2026-03-13T00:00:00Z"), totalValue: 121, totalCost: 100, totalGainLoss: 21 },
      ],
    };
    // Whatever method the comparison uses to load the portfolio, it gets this data.
    const portfolioService = new Proxy({}, { get: () => async () => data });
    const yahoo = yahooStub([
      ["2026-02-16", 50],
      ["2026-03-02", 55],
      ["2026-03-13", 50],
    ]);
    const res = await getBenchmarkComparison(deps({ fmp: fmpOff, yahoo, portfolioService }), portfolio.id, "1mo", "^GSPC");
    expect(res).toMatchObject({
      symbol: "^GSPC",
      label: "S&P 500",
      range: "1mo",
      from: "2026-02-16",
      to: "2026-03-13",
      source: "yahoo",
    });
    expect(res!.portfolioReturnPercent).toBeCloseTo(21, 6);
    expect(res!.benchmarkReturnPercent).toBeCloseTo(0, 6);
    expect(res!.excessReturnPercent).toBeCloseTo(21, 6);
    expect(res!.series[1]!.date).toBe("2026-03-02");
    expect(res!.series[1]!.portfolio).toBeCloseTo(10, 6);
    expect(res!.series[1]!.benchmark).toBeCloseTo(10, 6);

    const single = yahooStub([["2026-03-13", 50]]);
    expect(await getBenchmarkComparison(deps({ fmp: fmpOff, yahoo: single, portfolioService }), portfolio.id, "3mo", "^GSPC")).toBeNull();
  });

  it("reads FMP end-of-day bars when FMP is configured", async () => {
    const getEodChart = mock(async (_s: string, _o: { from: string; forceFresh?: boolean }) => [
      { date: "2026-03-12", open: 1, high: 1, low: 1, close: 10, volume: 0 },
      { date: "2026-03-13", open: 1, high: 1, low: 1, close: 11, volume: 0 },
    ]);
    const fmp = { isConfigured: () => true, getEodChart };
    const yahoo = yahooStub([["2026-03-13", 99]]);
    const res = await getBenchmarkHistory(deps({ fmp, yahoo }), "^GSPC", "1y");
    expect(getEodChart.mock.calls[0]).toEqual(["^GSPC", { from: "2025-03-15", forceFresh: false }]);
    expect(res.source).toBe("fmp");
    expect(res.points).toEqual([
      { date: "2026-03-12", close: 10 },
      { date: "2026-03-13", close: 11 },
    ]);
    await getBenchmarkHistory(deps({ fmp, yahoo }), "^GSPC", "max", true);
    expect(getEodChart.mock.calls[1]![1].from).toBe("1996-01-01");
    expect(yahoo.getChart.mock.calls.length).toBe(0);

    const emptyFmp = { isConfigured: () => true, getEodChart: mock(async () => []) };
    const fallback = await getBenchmarkHistory(deps({ fmp: emptyFmp, yahoo }), "^GSPC", "6mo", true);
    expect(fallback.source).toBe("yahoo");
    expect(yahoo.getChart.mock.calls.length).toBe(1);
  });

  it("filters Yahoo closes by range and drops non-positive closes", async () => {
    const yahoo = yahooStub([
      ["2026-02-10", 100],
      ["2026-02-16", 101],
      ["2026-03-13", 0],
      ["2026-03-13", 102],
    ]);
    const month = await getBenchmarkHistory(deps({ fmp: fmpOff, yahoo }), "^GSPC", "1mo", true);
    expect(month).toMatchObject({ symbol: "^GSPC", label: "S&P 500", range: "1mo", source: "yahoo" });
    expect(month.points).toEqual([
      { date: "2026-02-16", close: 101 },
      { date: "2026-03-13", close: 102 },
    ]);
    const week = await getBenchmarkHistory(deps({ fmp: fmpOff, yahoo }), "^GSPC", "5d", true);
    expect(week.points).toEqual([{ date: "2026-03-13", close: 102 }]);
    const ytd = await getBenchmarkHistory(deps({ fmp: fmpOff, yahoo }), "^GSPC", "ytd", true);
    expect(ytd.points.map((p) => p.date)).toEqual(["2026-02-10", "2026-02-16", "2026-03-13"]);
    const max = await getBenchmarkHistory(deps({ fmp: fmpOff, yahoo }), "^GSPC", "max", true);
    expect(max.points.map((p) => p.date)).toEqual(["2026-02-10", "2026-02-16", "2026-03-13"]);
  });

  it("falls back to the S&P 500 for an invalid symbol", async () => {
    const yahoo = yahooStub([["2026-03-13", 5]]);
    const res = await getBenchmarkHistory(deps({ fmp: fmpOff, yahoo }), "bad!", "5d", true);
    expect(res.symbol).toBe("^GSPC");
    expect(yahoo.getChart.mock.calls[0]![0]).toBe("^GSPC");
  });
});

describe("risk-free rate and yield curve", () => {
  const point = (tenor: string, label: string, years: number, y: number) => ({ tenor, label, years, yield: y });
  const curve = (points: ReturnType<typeof point>[]) => ({ date: "2026-03-13", points, history: [], source: "fmp" });
  const offline = deps({
    fmp: fmpOff,
    yahoo: {
      getChart: async () => {
        throw new Error("offline");
      },
    },
  });

  it("uses the 3M yield, then 6M, else the default", async () => {
    expect(await getRiskFreeRate(offline, curve([point("month3", "3M", 0.25, 4.2)]) as never)).toEqual({ rate: 0.042, source: "fmp" } as never);
    expect((await getRiskFreeRate(offline, curve([point("month6", "6M", 0.5, 5)]) as never)).rate).toBeCloseTo(0.05, 9);
    expect(await getRiskFreeRate(offline, null as never)).toEqual({ rate: DEFAULT_RISK_FREE_RATE, source: "default" } as never);
    expect(DEFAULT_RISK_FREE_RATE).toBe(0.03);
    expect(await getRiskFreeRate(offline, curve([point("month3", "3M", 0.25, 60)]) as never)).toEqual({ rate: DEFAULT_RISK_FREE_RATE, source: "default" } as never);
  });

  it("builds the curve from Yahoo when FMP is off", async () => {
    const closes: Record<string, [string, number]> = {
      "^IRX": ["2026-03-12", 45],
      "^TNX": ["2026-03-13", 4.2],
      "^TYX": ["2026-03-13", 4.6],
    };
    const yahoo = {
      getChart: mock(async (symbol: string) => {
        const c = closes[symbol];
        if (!c) throw new Error("no data");
        return chart(symbol, [c]);
      }),
    };
    const res = (await getYieldCurve(deps({ fmp: fmpOff, yahoo })))!;
    expect(res.source).toBe("yahoo");
    expect(res.date).toBe("2026-03-13");
    expect(res.points.map((p) => [p.tenor, p.label])).toEqual([
      ["month3", "3M"],
      ["year10", "10Y"],
      ["year30", "30Y"],
    ]);
    expect(res.points[0]!.yield).toBeCloseTo(4.5, 9);
    expect(res.points[1]!.yield).toBeCloseTo(4.2, 9);
    expect(res.points[2]!.yield).toBeCloseTo(4.6, 9);
  });

  it("reads FMP treasury rates when FMP is configured", async () => {
    const fmp = {
      isConfigured: () => true,
      get: mock(async (path: string) =>
        path === "/treasury-rates"
          ? [
              { date: "2026-03-13", month3: 4.3, year2: 3.9, year10: 4.1 },
              { date: "2026-03-06", month3: 4.4 },
            ]
          : null,
      ),
      getEodChart: mock(async () => null),
    };
    const res = (await getYieldCurve(deps({ fmp, yahoo: yahooStub([]) })))!;
    expect(res.source).toBe("fmp");
    expect(res.date).toBe("2026-03-13");
    expect(res.points.map((p) => [p.label, p.yield])).toEqual([
      ["3M", 4.3],
      ["2Y", 3.9],
      ["10Y", 4.1],
    ]);
  });
});
