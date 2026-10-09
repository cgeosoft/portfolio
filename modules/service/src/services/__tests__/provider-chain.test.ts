import { describe, it, expect, mock } from "bun:test";
import { fillByKey, firstAvailable, providerOrder } from "../providers/chain.js";
import { isCusip, isIsin } from "../providers/identifiers.js";
import { toFmpSymbol } from "../fmp.js";

describe("provider chain", () => {
  it("puts the preferred provider first, then the quality order", () => {
    expect(providerOrder({ category: "quotes", preferred: "finnhub" })).toEqual(["finnhub", "fmp", "yahoo"]);
    expect(providerOrder({ category: "news", preferred: "yahoo" })).toEqual(["yahoo", "fmp", "finnhub"]);
    expect(providerOrder({ category: "etfHoldings", preferred: null })).toEqual(["fmp", "yahoo", "finnhub"]);
  });

  it("skips unavailable providers and treats throw and empty as a miss", async () => {
    const fmp = mock(async () => ["never"]);
    const yahoo = mock(async () => {
      throw new Error("down");
    });
    const finnhub = mock(async () => [] as string[]);
    const result = await firstAvailable<string[]>({
      category: "search",
      preferred: "yahoo",
      attempts: [
        { provider: "fmp", isAvailable: () => false, fetch: fmp },
        { provider: "yahoo", fetch: yahoo },
        { provider: "finnhub", fetch: finnhub },
      ],
    });
    expect(fmp.mock.calls.length).toBe(0);
    expect(result.tried).toEqual(["yahoo", "finnhub"]);
    // Every provider came back empty: the empty answer is still returned.
    expect(result.data).toEqual([]);
    expect(result.source).toBe("finnhub");
  });

  it("returns the first non-empty value with its source", async () => {
    const result = await firstAvailable<string[]>({
      category: "news",
      preferred: null,
      attempts: [
        { provider: "yahoo", fetch: async () => ["yahoo"] },
        { provider: "fmp", fetch: async () => null },
        { provider: "finnhub", fetch: async () => ["finnhub"] },
      ],
    });
    expect(result.data).toEqual(["finnhub"]);
    expect(result.source).toBe("finnhub");
    expect(result.tried).toEqual(["fmp", "finnhub"]);
  });

  it("fills only the missing keys from the next provider", async () => {
    const yahooFetch = mock(async (keys: string[]) => new Map(keys.map((k) => [k, `yahoo:${k}`])));
    const result = await fillByKey<string>({
      category: "quotes",
      preferred: null,
      keys: ["A", "B", "C"],
      attempts: [
        { provider: "yahoo", fetch: yahooFetch },
        { provider: "fmp", fetch: async () => new Map([["A", "fmp:A"], ["X", "fmp:X"]]) },
      ],
    });
    expect(yahooFetch.mock.calls[0]![0]).toEqual(["B", "C"]);
    expect(result.data.get("A")).toBe("fmp:A");
    expect(result.data.get("B")).toBe("yahoo:B");
    expect(result.data.has("X")).toBe(false);
    expect(result.sources.get("A")).toBe("fmp");
    expect(result.sources.get("C")).toBe("yahoo");
    expect(result.missing).toEqual([]);
  });
});

describe("identifiers", () => {
  it("validates ISIN and CUSIP check digits", () => {
    expect(isIsin("US0378331005")).toBe(true);
    expect(isIsin("IE00B4L5Y983")).toBe(true);
    expect(isIsin("US0378331006")).toBe(false);
    expect(isCusip("037833100")).toBe(true);
    expect(isCusip("38259P508")).toBe(true);
    expect(isCusip("037833101")).toBe(false);
    expect(isCusip("MICROSOFT")).toBe(false);
  });

  it("maps app symbols to FMP symbols", () => {
    expect(toFmpSymbol("btc-usd")).toBe("BTCUSD");
    expect(toFmpSymbol("EURUSD=X")).toBe("EURUSD");
    expect(toFmpSymbol("BRK-B")).toBe("BRK-B");
    expect(toFmpSymbol("VOD.L")).toBe("VOD.L");
    expect(toFmpSymbol("^GSPC")).toBe("^GSPC");
  });
});
