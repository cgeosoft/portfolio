import { describe, it, expect, mock, afterEach } from "bun:test";
import { fillByKey, firstAvailable, providerOrder } from "../providers/chain.js";
import { isCusip, isIsin } from "../providers/identifiers.js";
import { toFmpSymbol } from "../fmp.js";
import { loadConfig, saveConfig, DEFAULT_DATA_PROVIDER_ROUTING } from "../../config.js";

describe("provider chain", () => {
  it("puts the preferred provider first, then the quality order", () => {
    expect(providerOrder({ category: "quotes", preferred: "finnhub" })).toEqual(["finnhub", "fmp", "yahoo"]);
    expect(providerOrder({ category: "news", preferred: "yahoo" })).toEqual(["yahoo", "fmp", "finnhub"]);
    expect(providerOrder({ category: "etfHoldings", preferred: null })).toEqual(["fmp", "yahoo"]);
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

describe("identifier edge cases", () => {
  it("accepts ISINs from several countries, in any case and with spaces", () => {
    for (const isin of ["DE0007164600", "US0231351067", "GB0002634946", "CA0679011084", "NL0010273215", "JP3633400001", "us0378331005", " US0378331005 "]) {
      expect(isIsin(isin)).toBe(true);
    }
  });

  it("rejects ISINs with the wrong length, shape or check digit", () => {
    for (const isin of ["US037833100", "US03783310050", "US0378331005X", "0000000000AA", "DE000716460A"]) {
      expect(isIsin(isin)).toBe(false);
    }
  });

  it("accepts and rejects CUSIPs", () => {
    for (const cusip of ["594918104", "023135106", "037833100 ", "38259p508"]) expect(isCusip(cusip)).toBe(true);
    for (const cusip of ["ABCDEFGH1", "12345678", "1234567890"]) expect(isCusip(cusip)).toBe(false);
  });

  it("maps crypto pairs and FX symbols, and leaves the rest alone", () => {
    expect(toFmpSymbol("eth-eur")).toBe("ETHEUR");
    expect(toFmpSymbol("BTC-USDT")).toBe("BTCUSDT");
    expect(toFmpSymbol("DOGE-XYZ")).toBe("DOGE-XYZ");
    expect(toFmpSymbol("usdjpy=x")).toBe("USDJPY");
    expect(toFmpSymbol("EURUSD=X ")).toBe("EURUSD");
    expect(toFmpSymbol("ABCDEFG=X")).toBe("ABCDEFG=X");
    expect(toFmpSymbol("BRK.B")).toBe("BRK.B");
  });
});

describe("provider order from the settings", () => {
  const original = loadConfig();

  afterEach(() => {
    saveConfig(original);
  });

  it("reads the preferred provider from the routing settings", () => {
    saveConfig({ ...original, dataProviderRouting: { ...DEFAULT_DATA_PROVIDER_ROUTING } });
    expect(providerOrder({ category: "charts" })).toEqual(["fmp", "yahoo", "finnhub"]);
    expect(providerOrder({ category: "etfAssetClasses" })).toEqual(["yahoo", "fmp"]);
    expect(providerOrder({ category: "treasury" } as never)).toEqual(["fmp", "yahoo", "finnhub"]);
    expect(providerOrder({ category: "news", order: ["yahoo"], preferred: null } as never)).toEqual(["yahoo"]);

    saveConfig({ ...original, dataProviderRouting: { ...DEFAULT_DATA_PROVIDER_ROUTING, charts: "yahoo" } });
    expect(providerOrder({ category: "charts" })).toEqual(["yahoo", "fmp", "finnhub"]);
  });

  it("sorts attempts by the order and keeps providers outside it at the end", async () => {
    const result = await firstAvailable<string[]>({
      category: "etfHoldings",
      preferred: null,
      attempts: [
        { provider: "finnhub", fetch: async () => ["f"] },
        { provider: "yahoo", fetch: async () => [] },
        { provider: "fmp", fetch: async () => null },
      ],
    });
    expect(result.tried).toEqual(["fmp", "yahoo", "finnhub"]);
    expect(result.data).toEqual(["f"]);
    expect(result.source).toBe("finnhub");
  });

  it("treats an availability check that throws as unavailable", async () => {
    const fmp = mock(async () => ["never"]);
    const result = await firstAvailable<string[]>({
      category: "news",
      preferred: null,
      attempts: [
        {
          provider: "fmp",
          isAvailable: () => {
            throw new Error("no key");
          },
          fetch: fmp,
        },
        { provider: "yahoo", fetch: async () => ["y"] },
      ],
    });
    expect(fmp.mock.calls.length).toBe(0);
    expect(result.tried).toEqual(["yahoo"]);
    expect(result.data).toEqual(["y"]);
  });

  it("fills invalid and missing keys, asks each key once and survives a throwing provider", async () => {
    const first = mock(async (_keys: string[]) => new Map([["A", 0], ["B", 2]]));
    const second = mock(async (_keys: string[]) => new Map([["A", 5]]));
    const result = await fillByKey<number>({
      category: "quotes",
      preferred: null,
      keys: ["A", "A", "B"],
      isValid: (v: number) => v > 0,
      attempts: [
        { provider: "fmp", fetch: first },
        { provider: "yahoo", fetch: second },
      ],
    } as never);
    expect(first.mock.calls[0]![0]).toEqual(["A", "B"]);
    expect(second.mock.calls[0]![0]).toEqual(["A"]);
    expect(Object.fromEntries(result.data)).toEqual({ A: 5, B: 2 });
    expect(result.sources.get("A")).toBe("yahoo");
    expect(result.sources.get("B")).toBe("fmp");

    const yahoo = mock(async (keys: string[]) => new Map(keys.filter((k) => k === "X").map((k) => [k, 1])));
    const failing = await fillByKey<number>({
      category: "quotes",
      preferred: null,
      keys: ["X", "Y"],
      attempts: [
        {
          provider: "fmp",
          fetch: async () => {
            throw new Error("down");
          },
        },
        { provider: "yahoo", fetch: yahoo },
      ],
    });
    expect(yahoo.mock.calls.length).toBe(1);
    expect(failing.error).toBeDefined();
    expect(failing.data.get("X")).toBe(1);
    expect(failing.missing).toEqual(["Y"]);
  });
});
