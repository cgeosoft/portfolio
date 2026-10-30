/** Exposure after ETF and fund look-through: sectors, countries, asset classes, top stocks, overlaps and caching. */
import { describe, it, expect } from "bun:test";
import { ExposureService, summarizeExposure, formatExposureForPrompt, EXPOSURE_LIMITS, getPortfolioExposureSummary } from "../exposure";
import type { EtfIntelService, FundLookThrough, SecurityProfile } from "../intel/etf";
import type { PortfolioService } from "../portfolio";

type Holding = { symbol: string; name?: string; assetType: string; currentValue: number; isPrivate?: boolean };

function holding(h: Holding) {
  return {
    name: `${h.symbol} name`,
    shares: 0,
    buyPrice: 0,
    currentPrice: 0,
    previousClose: 0,
    totalCost: 0,
    dayChangeDollar: 0,
    dayChangePercent: 0,
    totalGainLossDollar: 0,
    totalGainLossPercent: 0,
    weightPercent: 0,
    currency: "EUR",
    ...h,
  };
}

const empty = (s: string): FundLookThrough => ({
  symbol: s,
  holdings: [],
  holdingsComplete: false,
  sectors: [],
  countries: [],
  assetClasses: [],
  sources: { holdings: null, sectors: null, countries: null, assetClasses: null, info: null },
});

const unknownProfile = (s: string): SecurityProfile => ({ symbol: s, kind: "unknown", source: null });

interface Setup {
  holdings: Holding[];
  cashBalance?: number;
  profiles?: Record<string, Omit<SecurityProfile, "symbol">>;
  funds?: Record<string, Partial<FundLookThrough>>;
  profileThrows?: string[];
}

function makeService(setup: Setup) {
  const calls = { profile: [] as string[], fund: [] as string[], data: 0 };
  const state = { lastUpdated: "v1", reject: false };
  const portfolioService = {
    getPortfolioData: async () => {
      calls.data++;
      if (state.reject) throw new Error("no portfolio");
      return {
        summary: { baseCurrency: "EUR", cashBalance: setup.cashBalance ?? 0, lastUpdated: state.lastUpdated },
        holdings: setup.holdings.map(holding),
      };
    },
  } as unknown as PortfolioService;
  const etf = {
    getSecurityProfile: async (s: string): Promise<SecurityProfile> => {
      calls.profile.push(s);
      if (setup.profileThrows?.includes(s)) throw new Error("profile down");
      const p = setup.profiles?.[s];
      return p ? ({ symbol: s, ...p } as SecurityProfile) : unknownProfile(s);
    },
    getFundLookThrough: async (s: string): Promise<FundLookThrough> => {
      calls.fund.push(s);
      return { ...empty(s), ...(setup.funds?.[s] ?? {}) } as FundLookThrough;
    },
  } as unknown as EtfIntelService;
  return { svc: new ExposureService(portfolioService, etf), calls, state };
}

describe("look-through of one ETF next to a direct stock and cash", () => {
  const setup: Setup = {
    holdings: [
      { symbol: "AAPL", assetType: "Stock", currentValue: 3000 },
      { symbol: "VWCE.DE", assetType: "ETF", currentValue: 6000 },
      { symbol: "CASH", name: "CASH name", assetType: "Cash", currentValue: 1000 },
    ],
    profiles: {
      AAPL: { name: "Apple Inc.", kind: "stock", sector: "Technology", country: "United States", isin: "US0378331005", source: "fmp" },
    },
    funds: {
      "VWCE.DE": {
        name: "Vanguard FTSE All-World",
        holdings: [
          { symbol: "AAPL", isin: "US0378331005", name: "Apple", weight: 5 },
          { symbol: "MSFT", weight: 4 },
          { symbol: "TINY", weight: 0.004 },
        ],
        holdingsComplete: true,
        sectors: [
          { name: "Technology", weight: 25 },
          { name: "Financial Services", weight: 15 },
          { name: "Cash & Other", weight: 2 },
        ],
        countries: [
          { name: "United States", weight: 60 },
          { name: "Japan", weight: 6 },
        ],
        assetClasses: [
          { name: "Equity", weight: 98 },
          { name: "Cash", weight: 2 },
        ],
        expenseRatio: 0.22,
        sources: { holdings: "fmp", sectors: "fmp", countries: "fmp", assetClasses: "yahoo", info: "fmp" },
      },
    },
  };
  const get = () => makeService(setup).svc.getExposure("zq4-exp-1", { baseCurrency: "EUR" });

  it("totals the portfolio and lists the sources", async () => {
    const r = await get();
    expect(r.totalValue).toBe(10000);
    expect(r.baseCurrency).toBe("EUR");
    expect(r.sources).toEqual(["fmp", "yahoo"]);
  });

  it("splits sectors, countries and asset classes", async () => {
    const r = await get();
    expect(r.sectors).toEqual({
      items: [
        { name: "Technology", value: 4500, percent: 45 },
        { name: "Financial Services", value: 900, percent: 9 },
      ],
      unknownPercent: 34.8,
      notApplicablePercent: 11.2,
    } as any);
    expect(r.countries).toEqual({
      items: [
        { name: "United States", value: 6600, percent: 66 },
        { name: "Japan", value: 360, percent: 3.6 },
      ],
      unknownPercent: 19.2,
      notApplicablePercent: 11.2,
    } as any);
    expect(r.assetClasses).toEqual({
      items: [
        { name: "Equity", value: 8880, percent: 88.8 },
        { name: "Cash", value: 1120, percent: 11.2 },
      ],
      unknownPercent: 0,
      notApplicablePercent: 0,
    } as any);
  });

  it("merges direct and fund stock exposure", async () => {
    const r = await get();
    expect(r.topStocks[0]).toEqual({
      symbol: "AAPL",
      name: "Apple Inc.",
      isin: "US0378331005",
      value: 3300,
      percent: 33,
      directPercent: 30,
      viaFundsPercent: 3,
      breakdown: [
        { via: "direct", value: 3000, percent: 30 },
        { via: "VWCE.DE", value: 300, percent: 3 },
      ],
    } as any);
    expect(r.topStocks[1]).toMatchObject({ symbol: "MSFT", value: 240, percent: 2.4, directPercent: 0, viaFundsPercent: 2.4 });
    expect(r.topStocks.some((s) => s.symbol === "TINY")).toBe(false);
  });

  it("lists funds, overlaps, expense ratio and coverage", async () => {
    const r = await get();
    expect(r.funds).toEqual([
      {
        symbol: "VWCE.DE",
        name: "Vanguard FTSE All-World",
        percent: 60,
        value: 6000,
        expenseRatio: 0.22,
        holdingsComplete: true,
        holdingsKnownPercent: 9,
        sources: { holdings: "fmp", sectors: "fmp", countries: "fmp", assetClasses: "yahoo", info: "fmp" },
      },
    ] as any);
    expect(r.overlaps).toEqual([]);
    expect(r.weightedExpenseRatio).toEqual({ percent: 0.22, coveragePercent: 100 } as any);
    expect(r.coverage).toEqual({ directPercent: 40, lookedThroughPercent: 60, unknownPercent: 0, holdingsKnownPercent: 35.4 } as any);
  });

  it("warns about sector and stock concentration", async () => {
    const r = await get();
    expect(r.warnings).toEqual([
      { kind: "sector", name: "Technology", percent: 45, limit: 35, message: "Technology is 45.0% of the portfolio. Limit: 35%." },
      { kind: "stock", name: "AAPL", percent: 33, limit: 10, message: "AAPL (Apple Inc.) is 33.0% of the portfolio, 3.0% through funds. Limit: 10%." },
    ] as any);
    expect(r.limits).toEqual(EXPOSURE_LIMITS);
    expect(EXPOSURE_LIMITS).toEqual({ stockPercent: 10, sectorPercent: 35, countryPercent: 80, overlapPercent: 50 } as any);
  });

  it("formats a prompt with percentages only", async () => {
    const text = formatExposureForPrompt(summarizeExposure(await get()));
    expect(text).toBe(
      [
        "Exposure after ETF and fund look-through (percent of portfolio value, base EUR):",
        "- Coverage: 40.0% held directly, 60.0% looked through in funds, 0.0% unknown.",
        "- Sectors: Technology 45.0%, Financial Services 9.0%; unknown 34.8%.",
        "- Countries: United States 66.0%, Japan 3.6%; unknown 19.2%.",
        "- Asset classes: Equity 88.8%, Cash 11.2%.",
        "- Largest underlying stocks: AAPL (Apple Inc.) 33.0% (3.0% via funds), MSFT 2.4% (2.4% via funds).",
        "- Weighted fund expense ratio: 0.22%.",
        "- Warnings: Technology is 45.0% of the portfolio. Limit: 35%. AAPL (Apple Inc.) is 33.0% of the portfolio, 3.0% through funds. Limit: 10%.",
        "- Data: fmp, yahoo.",
      ].join("\n"),
    );
    expect(text).not.toContain("4500");
    expect(text).not.toContain("3300");
  });
});

describe("reclassification, ISIN merge and unknown data", () => {
  const setup: Setup = {
    holdings: [
      { symbol: "SAP.DE", assetType: "Stock", currentValue: 2000 },
      { symbol: "ISHR", assetType: "Stock", currentValue: 2000 },
      { symbol: "MYST", assetType: "ETF", currentValue: 1000 },
      { symbol: "NOFUND", assetType: "ETF", currentValue: 1000 },
      { symbol: "BTC-EUR", assetType: "Crypto", currentValue: 500 },
      { symbol: "pe", assetType: "Other", currentValue: 500, isPrivate: true },
      { symbol: "ZERO", assetType: "Stock", currentValue: 0 },
    ],
    profiles: {
      "SAP.DE": { name: "SAP SE", kind: "stock", sector: "Technology", country: "Germany", isin: "DE0007164600", source: "fmp" },
      ISHR: { kind: "fund", source: "fmp" },
      MYST: { kind: "stock", sector: "Energy", country: "Norway", source: "yahoo" },
    },
    funds: {
      ISHR: {
        holdings: [{ symbol: "SAP", isin: "DE0007164600", weight: 50 }],
        sources: { holdings: "yahoo", sectors: null, countries: null, assetClasses: null, info: null },
      },
    },
  };

  it("looks up only the positions that can have data", async () => {
    const { svc, calls } = makeService(setup);
    await svc.getExposure("zq4-exp-2", { baseCurrency: "EUR" });
    expect(new Set(calls.profile)).toEqual(new Set(["SAP.DE", "ISHR", "MYST", "NOFUND"]));
    expect(new Set(calls.fund)).toEqual(new Set(["ISHR", "MYST", "NOFUND"]));
  });

  it("splits sectors, countries and asset classes with unknown and n/a parts", async () => {
    const r = await makeService(setup).svc.getExposure("zq4-exp-2", { baseCurrency: "EUR" });
    expect(r.totalValue).toBe(7000);
    expect(r.sectors).toEqual({
      items: [
        { name: "Technology", value: 2000, percent: 28.57 },
        { name: "Energy", value: 1000, percent: 14.29 },
      ],
      unknownPercent: 42.86,
      notApplicablePercent: 14.29,
    } as any);
    expect(r.countries.items.map((i) => [i.name, i.percent])).toEqual([
      ["Germany", 28.57],
      ["Norway", 14.29],
    ]);
    expect(r.countries.unknownPercent).toBe(42.86);
    expect(r.countries.notApplicablePercent).toBe(14.29);
    expect(r.assetClasses.items).toEqual([
      { name: "Equity", value: 3000, percent: 42.86 },
      { name: "Crypto", value: 500, percent: 7.14 },
      { name: "Other", value: 500, percent: 7.14 },
    ] as any);
    expect(r.assetClasses.unknownPercent).toBe(42.86);
  });

  it("merges a fund holding into the direct stock by ISIN", async () => {
    const r = await makeService(setup).svc.getExposure("zq4-exp-2", { baseCurrency: "EUR" });
    expect(r.topStocks[0]).toMatchObject({
      symbol: "SAP.DE",
      name: "SAP SE",
      value: 3000,
      percent: 42.86,
      directPercent: 28.57,
      viaFundsPercent: 14.29,
      breakdown: [
        { via: "direct", value: 2000, percent: 28.57 },
        { via: "ISHR", value: 1000, percent: 14.29 },
      ],
    });
    expect(r.topStocks[1]).toMatchObject({ symbol: "MYST", name: "MYST name", percent: 14.29, directPercent: 14.29 });
  });

  it("lists funds and coverage", async () => {
    const r = await makeService(setup).svc.getExposure("zq4-exp-2", { baseCurrency: "EUR" });
    expect(r.funds.map((f) => ({ symbol: f.symbol, value: f.value, percent: f.percent, holdingsComplete: f.holdingsComplete, holdingsKnownPercent: f.holdingsKnownPercent }))).toEqual([
      { symbol: "ISHR", value: 2000, percent: 28.57, holdingsComplete: false, holdingsKnownPercent: 50 },
      { symbol: "NOFUND", value: 1000, percent: 14.29, holdingsComplete: false, holdingsKnownPercent: 0 },
    ]);
    expect(r.weightedExpenseRatio).toBeUndefined();
    expect(r.coverage).toEqual({ directPercent: 57.14, lookedThroughPercent: 28.57, unknownPercent: 14.29, holdingsKnownPercent: 57.14 } as any);
  });

  it("warns per stock and lists the sources", async () => {
    const r = await makeService(setup).svc.getExposure("zq4-exp-2", { baseCurrency: "EUR" });
    expect(r.warnings.map((w) => w.message)).toEqual([
      "SAP.DE (SAP SE) is 42.9% of the portfolio, 14.3% through funds. Limit: 10%.",
      "MYST (MYST name) is 14.3% of the portfolio. Limit: 10%.",
    ]);
    expect(r.sources).toEqual(["fmp", "yahoo"]);
  });
});

describe("fund overlap", () => {
  const setup = (bComplete: boolean): Setup => ({
    holdings: [
      { symbol: "A", assetType: "ETF", currentValue: 5000 },
      { symbol: "B", assetType: "ETF", currentValue: 5000 },
    ],
    funds: {
      A: {
        holdings: [
          { symbol: "X", weight: 40 },
          { symbol: "Y", weight: 30 },
          { symbol: "Z", weight: 5 },
        ],
        holdingsComplete: true,
        expenseRatio: 0.2,
        sources: { holdings: "fmp", sectors: null, countries: null, assetClasses: null, info: null },
      },
      B: {
        holdings: [
          { symbol: "X", weight: 35 },
          { symbol: "Y", weight: 30 },
        ],
        holdingsComplete: bComplete,
        sources: { holdings: "fmp", sectors: null, countries: null, assetClasses: null, info: null },
      },
    },
  });

  it("reports a partial overlap", async () => {
    const r = await makeService(setup(false)).svc.getExposure("zq4-exp-3");
    expect(r.overlaps).toEqual([{ a: "A", b: "B", overlapPercent: 65, commonHoldings: 2, partial: true }] as any);
  });

  it("sorts warnings by percent", async () => {
    const r = await makeService(setup(false)).svc.getExposure("zq4-exp-3");
    expect(r.warnings.map((w) => [w.kind, w.name, w.percent, w.message])).toEqual([
      ["overlap", "A / B", 65, "A and B overlap by 65.0% or more. Limit: 50%."],
      ["stock", "X", 37.5, "X is 37.5% of the portfolio, 37.5% through funds. Limit: 10%."],
      ["stock", "Y", 30, "Y is 30.0% of the portfolio, 30.0% through funds. Limit: 10%."],
    ]);
  });

  it("weights the expense ratio by the funds that report one", async () => {
    const r = await makeService(setup(false)).svc.getExposure("zq4-exp-3");
    expect(r.weightedExpenseRatio).toEqual({ percent: 0.2, coveragePercent: 50 } as any);
  });

  it("drops 'or more' when both funds are complete", async () => {
    const r = await makeService(setup(true)).svc.getExposure("zq4-exp-3");
    expect(r.overlaps[0]?.partial).toBe(false);
    expect(r.warnings[0]?.message).toBe("A and B overlap by 65.0%. Limit: 50%.");
  });
});

describe("edge cases and caching", () => {
  it("folds symbols that differ in case into one position", async () => {
    const { svc, calls } = makeService({
      holdings: [
        { symbol: "abc", assetType: "Stock", currentValue: 100 },
        { symbol: "ABC", assetType: "Stock", currentValue: 50 },
      ],
    });
    const r = await svc.getExposure("zq4-exp-4");
    expect(r.totalValue).toBe(150);
    expect(calls.profile).toEqual(["ABC"]);
  });

  it("adds the cash balance when there is no cash holding", async () => {
    const r = await makeService({
      holdings: [{ symbol: "ZQ4S", assetType: "Stock", currentValue: 750 }],
      cashBalance: 250,
      profiles: { ZQ4S: { kind: "stock", sector: "Energy", country: "Germany", source: "fmp" } },
    }).svc.getExposure("zq4-exp-5");
    expect(r.totalValue).toBe(1000);
    expect(r.assetClasses.items.find((i) => i.name === "Cash")).toMatchObject({ value: 250, percent: 25 });
    expect(r.coverage.directPercent).toBe(100);
  });

  it("returns zeros when nothing has value", async () => {
    const r = await makeService({
      holdings: [
        { symbol: "ZQ4N", assetType: "Stock", currentValue: 0 },
        { symbol: "ZQ4M", assetType: "ETF", currentValue: -5 },
      ],
    }).svc.getExposure("zq4-exp-6");
    expect(r.totalValue).toBe(0);
    expect(r.sectors.items).toEqual([]);
    expect(r.countries.items).toEqual([]);
    expect(r.assetClasses.items).toEqual([]);
    expect(r.sectors.unknownPercent).toBe(0);
    expect(r.coverage).toEqual({ directPercent: 0, lookedThroughPercent: 0, unknownPercent: 0, holdingsKnownPercent: 0 } as any);
    expect(r.warnings).toEqual([]);
  });

  it("counts a stock as unknown when its profile lookup throws", async () => {
    const r = await makeService({
      holdings: [{ symbol: "ZQ4T", assetType: "Stock", currentValue: 100 }],
      profileThrows: ["ZQ4T"],
    }).svc.getExposure("zq4-exp-7");
    expect(r.totalValue).toBe(100);
    expect(r.sectors.unknownPercent).toBe(100);
  });

  it("memoizes per portfolio until the data changes", async () => {
    const { svc, calls, state } = makeService({ holdings: [{ symbol: "ZQ4C", assetType: "Stock", currentValue: 100 }] });
    await svc.getExposure("pX");
    await svc.getExposure("pX");
    expect(calls.profile.length).toBe(1);
    await svc.getExposure("pX", { refresh: true });
    expect(calls.profile.length).toBe(2);
    state.lastUpdated = "v2";
    await svc.getExposure("pX");
    expect(calls.profile.length).toBe(3);
    svc.clear("pX");
    await svc.getExposure("pX");
    expect(calls.profile.length).toBe(4);
  });

  it("shares one build between concurrent calls", async () => {
    const { svc, calls } = makeService({ holdings: [{ symbol: "ZQ4P", assetType: "Stock", currentValue: 100 }] });
    await Promise.all([svc.getExposure("pY"), svc.getExposure("pY")]);
    expect(calls.profile.length).toBe(1);
  });

  it("getPortfolioExposureSummary returns null when the portfolio cannot load", async () => {
    const { state } = makeService({ holdings: [] });
    state.reject = true;
    expect(await getPortfolioExposureSummary("zq4-exp-missing")).toBeNull();
  });
});
