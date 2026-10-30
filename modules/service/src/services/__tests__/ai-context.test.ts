import { describe, it, expect } from "bun:test";
import {
  buildReportIntelSections,
  comparisonForWindow,
  EMPTY_REPORT_INTEL,
  formatEventsForPrompt,
  formatMacroForPrompt,
  weeklyYieldChange,
  formatBenchmarkForPrompt,
  formatExposureCompact,
  formatIncomeForPrompt,
  settleWithin,
} from "../ai-context.js";
import type { PortfolioExposureSummary } from "../exposure.js";
import type { BenchmarkComparison, MacroSnapshot, PortfolioEventsResponse } from "portfolio-shared/api-types";

const comparison: BenchmarkComparison = {
  symbol: "^GSPC",
  label: "S&P 500",
  range: "1y",
  from: "2026-10-01",
  to: "2026-10-09",
  portfolioReturnPercent: 10,
  benchmarkReturnPercent: 5,
  excessReturnPercent: 5,
  series: [
    { date: "2026-10-01", portfolio: 0, benchmark: 0 },
    { date: "2026-10-02", portfolio: 0, benchmark: 0 },
    { date: "2026-10-05", portfolio: 10, benchmark: 5 },
    { date: "2026-10-09", portfolio: 21, benchmark: 5 },
  ],
  source: "yahoo",
};

describe("ai-context", () => {
  it("rebases a cumulative comparison to one week", () => {
    const w = comparisonForWindow(comparison, "2026-10-05", "2026-10-11");
    expect(w).not.toBeNull();
    expect(w!.from).toBe("2026-10-02");
    expect(w!.to).toBe("2026-10-09");
    expect(w!.portfolioReturnPercent).toBe(21);
    expect(w!.benchmarkReturnPercent).toBe(5);
    expect(w!.excessReturnPercent).toBe(16);
  });

  it("returns null when the series does not cover the week", () => {
    expect(comparisonForWindow(comparison, "2026-09-01", "2026-09-07")).toBeNull();
  });

  it("computes the weekly yield change in percentage points", () => {
    const history = [
      { date: "2026-09-25", year10: 4.1 },
      { date: "2026-10-02", year10: 4.2 },
      { date: "2026-10-09", year10: 4.05 },
    ];
    expect(weeklyYieldChange(history, "year10")).toBe(-0.15);
    expect(weeklyYieldChange(history, "year2")).toBeUndefined();
  });

  it("leaves out empty macro pieces", () => {
    const empty: MacroSnapshot = {
      asOf: "2026-10-10T00:00:00Z",
      baseCurrency: "EUR",
      yieldCurve: null,
      indicators: null,
      calendar: null,
      riskPremium: null,
      sectors: null,
      riskFreeRate: { rate: 0.03, source: "default" },
    };
    expect(formatMacroForPrompt(empty)).toBe("");
    expect(formatMacroForPrompt(null)).toBe("");
  });

  it("filters events by kind and date and shows no money amounts beyond per-share dividends", () => {
    const res: PortfolioEventsResponse = {
      portfolioId: "p",
      baseCurrency: "EUR",
      days: 2,
      from: "2026-10-10",
      to: "2026-10-12",
      sources: ["fmp"],
      events: [
        { date: "2026-10-10", kind: "earnings", symbol: "AAA", name: "A", time: "amc", epsEstimate: 1.2, source: "fmp" },
        { date: "2026-10-11", kind: "exDividend", symbol: "BBB", name: "B", amountPerShare: 0.5, currency: "USD", expectedIncome: 123, source: "fmp" },
        { date: "2026-10-11", kind: "dividendPayment", symbol: "BBB", name: "B", amountPerShare: 0.5, currency: "USD", expectedIncome: 123, source: "fmp" },
        { date: "2026-10-12", kind: "earnings", symbol: "CCC", name: "C", source: "fmp" },
      ],
    };
    const text = formatEventsForPrompt(res, { kinds: ["earnings", "exDividend"], from: "2026-10-10", to: "2026-10-11" });
    expect(text).toContain("AAA (A): earnings report, after the close, EPS estimate 1.2");
    expect(text).toContain("BBB (B): ex-dividend date, 0.5 USD per share");
    expect(text).not.toContain("dividend payment");
    expect(text).not.toContain("CCC");
    expect(text).not.toContain("123");
    expect(formatEventsForPrompt({ ...res, events: [] })).toBe("");
  });

  it("builds no report section without data", () => {
    const res = buildReportIntelSections(EMPTY_REPORT_INTEL, { from: "2026-10-05", to: "2026-10-11" });
    expect(res.text).toBe("");
    expect(res.sections).toEqual([]);
    expect(res.newsCount).toBe(0);
  });
});

const full: MacroSnapshot = {
  asOf: "2026-10-10T00:00:00Z",
  baseCurrency: "EUR",
  yieldCurve: {
    date: "2026-10-09",
    source: "fmp",
    points: [
      { tenor: "month3", label: "3M", years: 0.25, yield: 4.1 },
      { tenor: "year2", label: "2Y", years: 2, yield: 4.3 },
      { tenor: "year10", label: "10Y", years: 10, yield: 4.05 },
      { tenor: "year30", label: "30Y", years: 30, yield: 4.4 },
    ],
    history: [
      { date: "2026-10-02", year2: 4.2, year10: 4.2 },
      { date: "2026-10-09", year2: 4.3, year10: 4.05 },
    ],
  },
  indicators: {
    source: "fmp",
    items: [
      { id: "inflationRate", name: "Inflation rate", unit: "%", value: 2.9, date: "2026-09-30", previous: 3.1 },
      { id: "gdp", name: "GDP", unit: "bn USD", value: 29000, date: "2026-06-30" },
    ],
  },
  calendar: {
    from: "2026-10-10",
    to: "2026-10-17",
    source: "fmp",
    events: [
      { date: "2026-10-10 12:30:00", country: "US", currency: "USD", event: "CPI", impact: "High", estimate: 0.3, previous: 0.4 },
      { date: "2026-10-11 08:00:00", country: "DE", currency: "EUR", event: "ZEW", impact: "Medium" },
    ],
  },
  riskPremium: null,
  sectors: {
    date: "2026-10-09",
    source: "fmp",
    items: [
      { sector: "Tech", changePercent: 1.5, pe: 30 },
      { sector: "Energy", changePercent: 0.5 },
      { sector: "Health", changePercent: 0 },
      { sector: "Utilities", changePercent: -0.75 },
    ],
  },
  riskFreeRate: { rate: 0.041, source: "fmp" },
} as unknown as MacroSnapshot;

describe("formatMacroForPrompt", () => {
  it("formats every macro piece", () => {
    expect(formatMacroForPrompt(full)).toBe(
      [
        "- US Treasury yields on 2026-10-09 [fmp]: 3M 4.10%, 2Y 4.30%, 10Y 4.05%, 30Y 4.40%; 10Y minus 2Y -0.25 pts (inverted). Change over the last week: 2Y +0.10 pts, 10Y -0.15 pts.",
        "- US indicators [fmp]: Inflation rate 2.9% (2026-09-30, previous 3.1%); GDP 29000 bn USD (2026-06-30).",
        "- Next high-impact releases [fmp]: 2026-10-10 12:30 UTC USD CPI (estimate 0.3, previous 0.4).",
        "- Sector moves on 2026-10-09 [fmp]: best Tech +1.50% (P/E 30), Energy +0.50%, Health +0.00%; worst Utilities -0.75%, Health +0.00%, Energy +0.50%.",
        "- Risk-free rate (3-month T-bill): 4.10%.",
      ].join("\n"),
    );
  });

  it("shortens the text in compact mode", () => {
    expect(formatMacroForPrompt(full, { compact: true })).toBe(
      [
        "- US Treasury yields on 2026-10-09 [fmp]: 3M 4.10%, 2Y 4.30%, 10Y 4.05%, 30Y 4.40%; 10Y minus 2Y -0.25 pts (inverted).",
        "- US indicators [fmp]: Inflation rate 2.9% (2026-09-30, previous 3.1%).",
        "- Next high-impact releases [fmp]: 2026-10-10 12:30 UTC USD CPI (estimate 0.3, previous 0.4).",
      ].join("\n"),
    );
  });

  it("leaves out releases and sectors on request", () => {
    expect(formatMacroForPrompt(full, { maxEvents: 0 }).split("\n").some((l) => l.includes("releases"))).toBe(false);
    expect(formatMacroForPrompt(full, { sectors: false }).split("\n").some((l) => l.includes("Sector moves"))).toBe(false);
  });

  it("lists other releases when none is high impact", () => {
    const macro = { ...full, calendar: { ...full.calendar!, events: [full.calendar!.events[1]!] } } as MacroSnapshot;
    expect(formatMacroForPrompt(macro).split("\n")).toContain("- Next releases [fmp]: 2026-10-11 08:00 UTC EUR ZEW.");
  });

  it("prints nothing when only the risk-free rate is known", () => {
    const macro = { ...full, yieldCurve: null, indicators: null, calendar: null, riskPremium: null, sectors: null } as MacroSnapshot;
    expect(formatMacroForPrompt(macro)).toBe("");
  });

  it("shows a positive spread without the inverted note", () => {
    const points = [
      { tenor: "year2", label: "2Y", years: 2, yield: 4.3 },
      { tenor: "year10", label: "10Y", years: 10, yield: 4.5 },
    ];
    const macro = { ...full, yieldCurve: { ...full.yieldCurve!, points } } as unknown as MacroSnapshot;
    const text = formatMacroForPrompt(macro);
    expect(text).toContain("10Y minus 2Y +0.20 pts.");
    expect(text).not.toContain("(inverted)");
  });

  it("shows only the points when key tenors and history are missing", () => {
    const yieldCurve = { date: "2026-10-09", source: "fmp", points: [{ tenor: "month1", label: "1M", years: 0.08, yield: 4.5 }], history: [] };
    const macro = { ...full, yieldCurve } as unknown as MacroSnapshot;
    expect(formatMacroForPrompt(macro).split("\n")).toContain("- US Treasury yields on 2026-10-09 [fmp]: 1M 4.50%.");
  });
});

describe("formatBenchmarkForPrompt", () => {
  const head = "- Benchmark: S&P 500 (^GSPC) [yahoo]. Time-weighted return of the invested holdings.";
  const range = "- Range 1y (2026-10-01 to 2026-10-09): portfolio +10.00%, benchmark +5.00%, difference +5.00 pts.";

  it("formats the week and the full range", () => {
    expect(formatBenchmarkForPrompt(comparison, { from: "2026-10-05", to: "2026-10-11" })).toBe(
      [head, "- Week (2026-10-02 to 2026-10-09): portfolio +21.00%, benchmark +5.00%, difference +16.00 pts.", range].join("\n"),
    );
  });

  it("leaves out the week line without a week or outside the series", () => {
    expect(formatBenchmarkForPrompt(comparison)).toBe([head, range].join("\n"));
    expect(formatBenchmarkForPrompt(comparison, { from: "2026-09-01", to: "2026-09-07" })).toBe([head, range].join("\n"));
  });

  it("names no source when there is none, and prints nothing without data", () => {
    const noSource = { ...comparison, source: null } as unknown as BenchmarkComparison;
    expect(formatBenchmarkForPrompt(noSource).split("\n")[0]).toBe(
      "- Benchmark: S&P 500 (^GSPC). Time-weighted return of the invested holdings.",
    );
    expect(formatBenchmarkForPrompt(null)).toBe("");
  });
});

describe("formatExposureCompact", () => {
  const exposure = {
    baseCurrency: "EUR",
    coverage: { directPercent: 60, lookedThroughPercent: 35.2, unknownPercent: 4.7, holdingsKnownPercent: 90 },
    sectors: [
      { name: "Technology", percent: 41.234 },
      { name: "Health", percent: 12 },
      { name: "Energy", percent: 5 },
      { name: "Financials", percent: 4 },
      { name: "Utilities", percent: 1 },
    ],
    countries: [{ name: "United States", percent: 70 }],
    assetClasses: [],
    unknownSectorPercent: 2.5,
    unknownCountryPercent: 0,
    topStocks: [{ symbol: "AAPL", name: "Apple Inc", percent: 8.04, viaFundsPercent: 3 }],
    overlaps: [],
    warnings: ["W1.", "W2.", "W3.", "W4.", "W5."],
    sources: ["fmp"],
  } as unknown as PortfolioExposureSummary;

  it("formats coverage, top sectors, countries, stocks and warnings", () => {
    expect(formatExposureCompact(exposure)).toBe(
      [
        "- Coverage: 35.2% looked through in funds, 4.7% unknown.",
        "- Sectors: Technology 41.2%, Health 12.0%, Energy 5.0%, Financials 4.0%; unknown 2.5%.",
        "- Countries: United States 70.0%.",
        "- Largest underlying stocks: AAPL (Apple Inc) 8.0%.",
        "- Warnings: W1. W2. W3. W4.",
      ].join("\n"),
    );
  });

  it("leaves out an unknown share of zero", () => {
    const text = formatExposureCompact({ ...exposure, unknownSectorPercent: 0 } as PortfolioExposureSummary);
    expect(text.split("\n").find((l) => l.startsWith("- Sectors:"))!.endsWith("Financials 4.0%.")).toBe(true);
  });

  it("prints nothing without lists or data", () => {
    const empty = { ...exposure, sectors: [], countries: [], topStocks: [], warnings: [] } as unknown as PortfolioExposureSummary;
    expect(formatExposureCompact(empty)).toBe("");
    expect(formatExposureCompact(null)).toBe("");
  });
});

describe("formatIncomeForPrompt", () => {
  it("prints nothing without income data", () => {
    expect(formatIncomeForPrompt(null)).toBe("");
    const empty = { holdings: [], splitWarnings: [], yieldOnCostPercent: undefined, currentYieldPercent: undefined };
    expect(formatIncomeForPrompt(empty as unknown as Parameters<typeof formatIncomeForPrompt>[0])).toBe("");
  });
});

describe("buildReportIntelSections: sections and sources", () => {
  const week = { from: "2026-10-05", to: "2026-10-11" };
  const events: PortfolioEventsResponse = {
    portfolioId: "p",
    baseCurrency: "EUR",
    days: 7,
    from: "2026-10-12",
    to: "2026-10-19",
    sources: ["fmp"],
    events: [{ date: "2026-10-13", kind: "exDividend", symbol: "KO", name: "Coca-Cola", amountPerShare: 0.51, currency: "USD", expectedIncome: 321.09, source: "fmp" }],
  } as PortfolioEventsResponse;
  const transcript = (symbol: string) => ({
    symbol,
    name: "Apple Inc",
    fiscalYear: 2026,
    quarter: 4,
    date: "2026-10-30",
    summary: "x".repeat(800),
    generatedAt: "",
    cached: true,
    trimmed: false,
  });
  const intel = {
    ...EMPTY_REPORT_INTEL,
    marketNews: {
      source: "finnhub",
      items: [
        { headline: "Headline A", summary: "Summary A", source: "Reuters", datetime: 1 },
        { headline: "Headline B", summary: "", source: "AP", datetime: 2 },
      ],
    },
    benchmark: comparison,
    events,
    transcripts: [transcript("AAPL")],
  } as unknown as typeof EMPTY_REPORT_INTEL;

  it("lists the sections and the sources in first-seen order", () => {
    const res = buildReportIntelSections(intel, week);
    expect(res.sections).toEqual([
      "Financial Market & Macroeconomic News [finnhub]",
      "Benchmark Comparison",
      "Income & Upcoming Events",
      "Earnings Call Summaries (cached)",
    ]);
    expect(res.sources).toEqual(["finnhub", "yahoo", "fmp"]);
    expect(res.newsCount).toBe(2);
  });

  it("writes the header and the news bullets", () => {
    const { text } = buildReportIntelSections(intel, week);
    expect(
      text.startsWith(
        "\n## Real-Time Market Intelligence\nEach line names its data provider in brackets. Use only this data; do not invent figures.\n\n### Financial Market & Macroeconomic News [finnhub]\n- **Headline A** (Reuters): Summary A\n- **Headline B** (AP)\n\n### Benchmark Comparison\n",
      ),
    ).toBe(true);
  });

  it("lists upcoming events without expected income", () => {
    const { text } = buildReportIntelSections(intel, week);
    expect(text).toContain(
      "Upcoming events of the next 7 days (2026-10-12 to 2026-10-19):\n- 2026-10-13 KO (Coca-Cola): ex-dividend date, 0.51 USD per share",
    );
    expect(text).not.toContain("321");
  });

  it("trims a long transcript summary", () => {
    const { text } = buildReportIntelSections(intel, week);
    expect(text).toContain("#### AAPL (Apple Inc) Q4 FY2026 (2026-10-30)\n" + "x".repeat(697) + "...");
  });

  it("keeps at most five news items and trims long headlines", () => {
    const long = "H".repeat(200);
    const items = Array.from({ length: 7 }, (_, i) => ({ headline: i === 0 ? long : `News ${i}`, summary: "", source: "AP", datetime: i }));
    const res = buildReportIntelSections({ ...intel, marketNews: { source: "finnhub", items } } as unknown as typeof EMPTY_REPORT_INTEL, week);
    expect(res.newsCount).toBe(5);
    const section = res.text.split("### Benchmark Comparison")[0]!;
    expect(section.split("\n").filter((l) => l.startsWith("- **")).length).toBe(5);
    expect(res.text).toContain("**" + long.slice(0, 157) + "...**");
  });

  it("keeps at most three transcripts", () => {
    const res = buildReportIntelSections(
      { ...intel, transcripts: ["A", "B", "C", "D"].map(transcript) } as unknown as typeof EMPTY_REPORT_INTEL,
      week,
    );
    const section = res.text.slice(res.text.indexOf("Earnings Call Summaries"));
    expect(section.split("\n").filter((l) => l.startsWith("#### ")).length).toBe(3);
  });
});

describe("settleWithin", () => {
  it("returns the value of a fast call", async () => {
    expect(await settleWithin("t", 1000, async () => 42)).toBe(42);
  });

  it("returns null when the call fails", async () => {
    expect(await settleWithin("t", 1000, () => Promise.reject(new Error("x")))).toBeNull();
    expect(
      await settleWithin("t", 1000, async () => {
        throw new Error("y");
      }),
    ).toBeNull();
  });

  it("returns null after the time limit without waiting for the call", async () => {
    const started = Date.now();
    expect(await settleWithin("t", 20, () => new Promise<number>((r) => setTimeout(() => r(1), 500)))).toBeNull();
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("returns null when the call resolves null", async () => {
    expect(await settleWithin("t", 1000, async () => null)).toBeNull();
  });
});
