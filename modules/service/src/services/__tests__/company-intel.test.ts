import { describe, it, expect, mock } from "bun:test";
import {
  applicableParts,
  formatCompanyIntelForPrompt,
  getCompanyIntel,
  getCompanyIntelBatch,
  isIntelEligible,
  parseIntelParts,
  trimTranscript,
  type CompanyIntelDeps,
} from "../intel/company.js";
import { COMPANY_INTEL_PARTS, describeAltmanZ, describePiotroski, consensusFromCounts, type CompanyIntel } from "portfolio-shared/company-intel";
import type { FmpService } from "../fmp.js";
import type { FinnhubService } from "../finnhub.js";

/** FMP without a key and a Finnhub stub, so every part falls back to Finnhub or stays empty. */
function finnhubOnlyDeps() {
  const finnhub = {
    isConfigured: () => true,
    getCompanyProfile: mock(async () => ({ name: "Example Corp", currency: "USD", marketCapitalization: 1500, finnhubIndustry: "Technology" })),
    getRecommendationTrends: mock(async () => ({ strongBuy: 2, buy: 5, hold: 3, sell: 0, strongSell: 0, period: "2026-10-01", symbol: "X" })),
    getBasicFinancials: mock(async () => ({ symbol: "X", metricType: "all", metric: { peTTM: 20, grossMarginTTM: 45, roeTTM: 18 } })),
    getInsiderTransactions: mock(async () => [
      { name: "A Person", change: -100, share: 900, transactionCode: "S", transactionDate: "2026-09-10", transactionPrice: 10 },
      { name: "B Person", change: 50, share: 50, transactionCode: "P", transactionDate: "2026-08-01", transactionPrice: 12 },
    ]),
    getCompanyNews: mock(async () => [{ headline: "Example Corp ships", summary: "Details", source: "Wire", datetime: 1_790_000_000, url: "https://example.com/a" }]),
    getPeers: mock(async () => ["PEER1", "PEER2"]),
  };
  const fmp = { isConfigured: () => false, getProfile: async () => null, get: async () => null, getStockNews: async () => null };
  const deps: CompanyIntelDeps = { fmp: fmp as unknown as FmpService, finnhub: finnhub as unknown as FinnhubService };
  return { deps, finnhub };
}

describe("company intel helpers", () => {
  it("skips assets without company data", () => {
    expect(isIntelEligible("AAPL", "Stock")).toBe(true);
    expect(isIntelEligible("VWCE.DE", "ETF")).toBe(true);
    expect(isIntelEligible("BTC-USD")).toBe(false);
    expect(isIntelEligible("AAPL", "Crypto")).toBe(false);
    expect(isIntelEligible("CASH", "Cash")).toBe(false);
    expect(isIntelEligible("EURUSD=X")).toBe(false);
    expect(isIntelEligible("^GSPC")).toBe(false);
    expect(isIntelEligible("HOUSE", "Other", true)).toBe(false);
  });

  it("parses the include query and limits funds to the parts that apply", () => {
    expect(parseIntelParts("")).toEqual([...COMPANY_INTEL_PARTS]);
    expect(parseIntelParts("profile, dcf,unknown")).toEqual(["profile", "dcf"]);
    expect(applicableParts(["profile", "dcf", "news"], true)).toEqual({ parts: ["profile", "news"], skipped: ["dcf"] });
    expect(applicableParts(["profile", "dcf"], false)).toEqual({ parts: ["profile", "dcf"], skipped: [] });
  });

  it("trims a transcript to the budget, keeping the start and the end", () => {
    const text = `${"opening remarks ".repeat(500)}${"closing answer ".repeat(500)}`;
    const out = trimTranscript(text, 2000);
    expect(out.trimmed).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(2000);
    expect(out.text.startsWith("opening remarks")).toBe(true);
    expect(out.text.endsWith("closing answer")).toBe(true);
    expect(out.text).toContain("omitted");
    expect(trimTranscript("short call", 2000)).toEqual({ text: "short call", trimmed: false });
  });

  it("explains scores and derives a consensus", () => {
    expect(describePiotroski(8).tone).toBe("good");
    expect(describePiotroski(5).tone).toBe("neutral");
    expect(describePiotroski(1).tone).toBe("bad");
    expect(describeAltmanZ(3.5).label).toBe("Safe zone");
    expect(describeAltmanZ(2).label).toBe("Grey zone");
    expect(describeAltmanZ(1).label).toBe("Distress zone");
    expect(consensusFromCounts({ strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 })).toBeUndefined();
    expect(consensusFromCounts({ strongBuy: 2, buy: 5, hold: 3, sell: 0, strongSell: 0 })).toBe("Buy");
  });
});

describe("getCompanyIntel", () => {
  it("falls back to Finnhub without an FMP key and normalizes units", async () => {
    const { deps } = finnhubOnlyDeps();
    const intel = await getCompanyIntel(deps, "xmpl", { assetType: "Stock" });
    expect(intel.symbol).toBe("XMPL");
    expect(intel.profile?.source).toBe("finnhub");
    expect(intel.profile?.data.marketCap).toBe(1.5e9);
    expect(intel.analyst?.data.recommendations?.consensus).toBe("Buy");
    expect(intel.metrics?.data.grossMargin).toBeCloseTo(0.45);
    expect(intel.insider?.data.trades[0]?.isSale).toBe(true);
    expect(intel.insider?.data.statistics.length).toBeGreaterThan(0);
    expect(intel.news?.source).toBe("finnhub");
    expect(intel.peers?.data.map((p) => p.symbol)).toEqual(["PEER1", "PEER2"]);
    // FMP-only parts stay empty.
    expect(intel.scores).toBeNull();
    expect(intel.dcf).toBeNull();
    expect(intel.transcript).toBeNull();

    const text = formatCompanyIntelForPrompt(intel);
    expect(text).toContain("### XMPL (Example Corp)");
    expect(text).toContain("[finnhub]");
  });

  it("asks only the fund parts for an ETF and nothing for crypto", async () => {
    const { deps, finnhub } = finnhubOnlyDeps();
    const etf: CompanyIntel = await getCompanyIntel(deps, "VTI", { assetType: "ETF" });
    expect(etf.included).toEqual(["profile", "news"]);
    expect(etf.skipped).toContain("insider");
    expect(finnhub.getInsiderTransactions).not.toHaveBeenCalled();

    const crypto = await getCompanyIntel(deps, "BTC-USD");
    expect(crypto.included).toEqual([]);
    expect(crypto.profile).toBeNull();
  });

  it("dedupes a batch and leaves out cash and crypto", async () => {
    const { deps } = finnhubOnlyDeps();
    const out = await getCompanyIntelBatch(
      deps,
      [
        { symbol: "AAA", assetType: "Stock" },
        { symbol: "aaa", assetType: "Stock" },
        { symbol: "CASH", assetType: "Cash" },
        { symbol: "ETH-USD", assetType: "Crypto" },
      ],
      { include: ["profile"] },
    );
    expect(Array.from(out.keys())).toEqual(["AAA"]);
  });
});
