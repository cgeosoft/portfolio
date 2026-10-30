/** ETF look-through from FMP and Yahoo, the security profile chain and the name normalizers. */
import { describe, it, expect } from "bun:test";
import { EtfIntelService, toNumber, normalizeSector, normalizeCountry, normalizeAssetClass } from "../intel/etf";
import type { FmpService } from "../fmp";
import type { YahooFinanceService } from "../yahoo-finance";
import type { FinnhubService } from "../finnhub";

type Table = Record<string, unknown>;

function fmpStub(opts: { configured: boolean; table?: Table; profile?: unknown; throws?: boolean }) {
  const calls: string[] = [];
  const profileCalls: string[] = [];
  const stub = {
    isConfigured: () => opts.configured,
    get: async (path: string, params: Record<string, unknown> = {}) => {
      calls.push(`${path}:${String(params.symbol ?? "")}`);
      if (opts.throws) throw new Error("fmp down");
      return (opts.table?.[path] ?? null) as unknown;
    },
    getProfile: async (s: string) => {
      profileCalls.push(s);
      return (opts.profile ?? null) as unknown;
    },
  };
  return { fmp: stub as unknown as FmpService, calls, profileCalls };
}

function yahooStub(summary: Record<string, unknown> | null) {
  const calls: { symbol: string; modules: string[] }[] = [];
  const stub = {
    getQuoteSummary: async (symbol: string, modules: string[]) => {
      calls.push({ symbol, modules });
      return summary;
    },
  };
  return { yahoo: stub as unknown as YahooFinanceService, calls };
}

function finnhubStub(configured: boolean, profile: unknown = null) {
  return {
    isConfigured: () => configured,
    getCompanyProfile: async () => profile,
  } as unknown as FinnhubService;
}

const fmpTable: Table = {
  "/etf/holdings": [
    { asset: "aapl", name: "Apple", isin: "us0378331005", weightPercentage: "6.5%" },
    { asset: "MSFT", weightPercentage: 5 },
    { asset: "", weightPercentage: 3 },
    { asset: "ZERO", weightPercentage: 0 },
  ],
  "/etf/sector-weightings": [
    { sector: "Information Technology", weightPercentage: "30%" },
    { sector: "Tech", weightPercentage: 10 },
    { sector: "Health Care", weightPercentage: 12 },
  ],
  "/etf/country-weightings": [
    { country: "US", weightPercentage: "60" },
    { country: "Japan", weightPercentage: 5 },
  ],
  "/etf/info": [{ name: "Fund", assetClass: "Equity", expenseRatio: 0.07, assetsUnderManagement: 1e9, navCurrency: "USD", holdingsCount: 3700 }],
};

const yahooSummary = {
  quoteType: { quoteType: "ETF" },
  topHoldings: {
    holdings: [
      { symbol: "AAPL", holdingName: "Apple", holdingPercent: 0.065 },
      { symbol: "MSFT", holdingName: "Microsoft", holdingPercent: { raw: 0.05 } },
    ],
    sectorWeightings: [{ technology: 0.3 }, { realestate: { raw: 0.02 } }, { financial_services: 0.15 }],
    stockPosition: 0.97,
    bondPosition: 0.01,
    cashPosition: 0.02,
    otherPosition: 0,
  },
  fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: 0.0022, totalNetAssets: 5e9 } },
  summaryDetail: { totalAssets: { raw: 6e9 } },
  price: { longName: "Some ETF", currency: "EUR" },
};

describe("fund look-through from FMP", () => {
  it("normalizes holdings, sectors, countries and facts", async () => {
    const { fmp } = fmpStub({ configured: true, table: fmpTable });
    const { yahoo } = yahooStub(null);
    const svc = new EtfIntelService(fmp, yahoo, finnhubStub(false));
    const r = await svc.getFundLookThrough(" vwce.de ");
    expect(r).toEqual({
      symbol: "VWCE.DE",
      name: "Fund",
      holdings: [
        { symbol: "AAPL", name: "Apple", isin: "US0378331005", weight: 6.5 },
        { symbol: "MSFT", weight: 5 },
      ],
      holdingsComplete: true,
      sectors: [
        { name: "Technology", weight: 40 },
        { name: "Healthcare", weight: 12 },
      ],
      countries: [
        { name: "United States", weight: 60 },
        { name: "Japan", weight: 5 },
      ],
      assetClasses: [{ name: "Equity", weight: 100 }],
      expenseRatio: 0.07,
      aum: 1e9,
      aumCurrency: "USD",
      holdingsCount: 3700,
      sources: { holdings: "fmp", sectors: "fmp", countries: "fmp", assetClasses: "fmp", info: "fmp" },
    } as any);
  });

  it("fetches /etf/info once and asks Yahoo once for asset classes", async () => {
    const { fmp, calls } = fmpStub({ configured: true, table: fmpTable });
    const { yahoo, calls: ycalls } = yahooStub(null);
    await new EtfIntelService(fmp, yahoo, finnhubStub(false)).getFundLookThrough("ZQ3A");
    expect(calls.filter((c) => c.startsWith("/etf/info")).length).toBe(1);
    expect(ycalls.length).toBe(1);
    expect(ycalls[0]?.modules).toEqual(["quoteType", "topHoldings", "fundProfile", "summaryDetail", "price"]);
  });

  it("scales sector weights that add up to more than 100", async () => {
    const table = {
      ...fmpTable,
      "/etf/sector-weightings": [
        { sector: "Technology", weightPercentage: 60 },
        { sector: "Healthcare", weightPercentage: 50 },
      ],
    };
    const { fmp } = fmpStub({ configured: true, table });
    const r = await new EtfIntelService(fmp, yahooStub(null).yahoo, finnhubStub(false)).getFundLookThrough("ZQ3B");
    expect(r.sectors.map((s) => s.name)).toEqual(["Technology", "Healthcare"]);
    expect(r.sectors[0]?.weight).toBeCloseTo(54.545, 3);
    expect(r.sectors[1]?.weight).toBeCloseTo(45.455, 3);
  });

  it("falls back to the info sector list", async () => {
    const table = {
      "/etf/holdings": [],
      "/etf/sector-weightings": [],
      "/etf/country-weightings": [],
      "/etf/info": [
        {
          sectorsList: [
            { industry: "Energy", exposure: "10.5" },
            { industry: "Utilities", exposure: 4 },
          ],
        },
      ],
    };
    const { fmp } = fmpStub({ configured: true, table });
    const r = await new EtfIntelService(fmp, yahooStub(null).yahoo, finnhubStub(false)).getFundLookThrough("ZQ3C");
    expect(r.sectors).toEqual([
      { name: "Energy", weight: 10.5 },
      { name: "Utilities", weight: 4 },
    ]);
    expect(r.sources.sectors).toBe("fmp");
    expect(r.holdings).toEqual([]);
    expect(r.countries).toEqual([]);
    expect(r.assetClasses).toEqual([]);
    expect(r.sources.holdings).toBeNull();
    expect(r.sources.countries).toBeNull();
    expect(r.sources.assetClasses).toBeNull();
  });
});

describe("fund look-through from Yahoo", () => {
  it("reads top holdings, sectors, positions and fees", async () => {
    const { fmp } = fmpStub({ configured: false });
    const r = await new EtfIntelService(fmp, yahooStub(yahooSummary).yahoo, finnhubStub(false)).getFundLookThrough("ZQ3Y");
    expect(r.holdings.map((h) => [h.symbol, h.name])).toEqual([
      ["AAPL", "Apple"],
      ["MSFT", "Microsoft"],
    ]);
    expect(r.holdings[0]?.weight).toBeCloseTo(6.5, 6);
    expect(r.holdings[1]?.weight).toBeCloseTo(5, 6);
    expect(r.holdingsComplete).toBe(false);
    expect(r.sectors.map((s) => s.name)).toEqual(["Technology", "Financial Services", "Real Estate"]);
    expect(r.sectors[0]?.weight).toBeCloseTo(30, 6);
    expect(r.sectors[1]?.weight).toBeCloseTo(15, 6);
    expect(r.sectors[2]?.weight).toBeCloseTo(2, 6);
    expect(r.countries).toEqual([]);
    expect(r.assetClasses.map((a) => a.name)).toEqual(["Equity", "Cash", "Fixed Income"]);
    expect(r.assetClasses[0]?.weight).toBeCloseTo(97, 6);
    expect(r.assetClasses[1]?.weight).toBeCloseTo(2, 6);
    expect(r.assetClasses[2]?.weight).toBeCloseTo(1, 6);
    expect(r.expenseRatio).toBeCloseTo(0.22, 6);
    expect(r.aum).toBe(6e9);
    expect(r.aumCurrency).toBe("EUR");
    expect(r.holdingsCount).toBeUndefined();
    expect(r.sources).toEqual({ holdings: "yahoo", sectors: "yahoo", countries: null, assetClasses: "yahoo", info: "yahoo" } as any);
  });
});

describe("security profile chain", () => {
  it("uses the FMP profile first", async () => {
    const { fmp } = fmpStub({
      configured: true,
      profile: { companyName: "iShares Core", isEtf: true, sector: "Financials", country: "IE", isin: "IE00B4L5Y983" },
    });
    const r = await new EtfIntelService(fmp, yahooStub(null).yahoo, finnhubStub(false)).getSecurityProfile("eunl.de");
    expect(r).toEqual({
      symbol: "EUNL.DE",
      name: "iShares Core",
      kind: "fund",
      sector: "Financial Services",
      country: "Ireland",
      isin: "IE00B4L5Y983",
      source: "fmp",
    } as any);
    expect(r.industry).toBeUndefined();
  });

  it("falls back to Finnhub", async () => {
    const { fmp } = fmpStub({ configured: false });
    const r = await new EtfIntelService(fmp, yahooStub(null).yahoo, finnhubStub(true, { name: "Bank", finnhubIndustry: "Banking", country: "US" })).getSecurityProfile("bnk");
    expect(r).toEqual({
      symbol: "BNK",
      name: "Bank",
      kind: "stock",
      sector: "Financial Services",
      industry: "Banking",
      country: "United States",
      source: "finnhub",
    } as any);
  });

  it("falls back to Yahoo", async () => {
    const { fmp } = fmpStub({ configured: false });
    const r = await new EtfIntelService(fmp, yahooStub({ quoteType: { quoteType: "ETF" }, price: { longName: "Some ETF" } }).yahoo, finnhubStub(false)).getSecurityProfile("zq3etf");
    expect(r).toMatchObject({ symbol: "ZQ3ETF", name: "Some ETF", kind: "fund", source: "yahoo" });
  });

  it("returns an unknown profile when nobody knows the symbol", async () => {
    const { fmp } = fmpStub({ configured: false });
    const r = await new EtfIntelService(fmp, yahooStub(null).yahoo, finnhubStub(false)).getSecurityProfile("none");
    expect(r).toEqual({ symbol: "NONE", kind: "unknown", source: null } as any);
  });

  it("uses Yahoo data when every FMP request throws", async () => {
    const { fmp } = fmpStub({ configured: true, throws: true });
    const r = await new EtfIntelService(fmp, yahooStub(yahooSummary).yahoo, finnhubStub(false)).getFundLookThrough("ZQ3T");
    expect(r.holdings.map((h) => h.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(r.sources.holdings).toBe("yahoo");
  });
});

describe("normalizers", () => {
  it("toNumber parses percents, separators and raw wrappers", () => {
    expect(toNumber("12.5%")).toBe(12.5);
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(toNumber({ raw: 3 })).toBe(3);
    expect(toNumber({ raw: "4%" })).toBe(4);
    for (const v of [NaN, Infinity, "abc", null]) expect(toNumber(v)).toBeUndefined();
  });

  it("normalizeSector maps known names", () => {
    expect(normalizeSector("Information Technology")).toBe("Technology");
    expect(normalizeSector("Widgets")).toBe("Widgets");
    expect(normalizeSector("CASH & OTHERS")).toBe("Cash & Other");
    expect(normalizeSector("  ")).toBeUndefined();
  });

  it("normalizeCountry maps codes to names", () => {
    expect(normalizeCountry("us")).toBe("United States");
    expect(normalizeCountry("DE")).toBe("Germany");
    expect(normalizeCountry("United Kingdom")).toBe("United Kingdom");
    expect(normalizeCountry("")).toBeUndefined();
    expect(normalizeCountry(null as any)).toBeUndefined();
  });

  it("normalizeAssetClass folds synonyms", () => {
    const cases: [string, string][] = [
      ["Equity", "Equity"],
      ["Bond", "Fixed Income"],
      ["Debt", "Fixed Income"],
      ["Stocks", "Equity"],
      ["Commodities", "Commodity"],
      ["Money Market", "Cash"],
      ["Digital Currency", "Currency"],
      ["Crypto", "Crypto"],
      ["Real Estate", "Real Estate"],
      ["Alternative", "Alternative"],
      ["", "Other"],
    ];
    for (const [input, out] of cases) expect([input, normalizeAssetClass(input)]).toEqual([input, out]);
  });
});
