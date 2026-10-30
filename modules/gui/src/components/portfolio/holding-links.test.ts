/** Holding links: the name index, running-text pattern, href parsing and the change key. */
import { describe, expect, it } from "bun:test";
import type { PortfolioHolding, PortfolioTransaction } from "portfolio-shared/portfolio";
import {
  buildHoldingIndex,
  findHoldingSymbol,
  hasCompanyIntel,
  holdingLinkKey,
  holdingSymbolFromHref,
  renderHoldingAnchor,
  OPEN_HOLDING_EVENT,
} from "./holding-links";

const H = (symbol: string, name: string, assetType = "Stock", extra = {}) => ({ symbol, name, assetType, ...extra }) as unknown as PortfolioHolding;

const holdings = [
  H("AAPL", "Apple Inc."),
  H("VWCE.DE", "Vanguard FTSE All-World UCITS ETF", "ETF"),
  H("BTC-USD", "Bitcoin USD", "Crypto"),
  H("CASH", "Cash", "Cash"),
  H("PRIV", "My Fund", "Other", { isPrivate: true }),
  H("V", "Visa Inc. Class A"),
  H("GOOGL", "Alphabet Inc. Class A"),
  H("GOOG", "Alphabet Inc. Class C"),
];
const txs = [
  { id: "1", date: "2025-01-01", type: "BUY", symbol: "VWCE.DE", isin: " ie00bk5bqt80 " },
  { id: "2", date: "2025-01-01", type: "BUY", symbol: "BTC-USD", isin: "XX0000000000" },
] as PortfolioTransaction[];
const index = buildHoldingIndex(holdings, txs);

describe("buildHoldingIndex", () => {
  it("knows which holdings have company intel", () => {
    expect(hasCompanyIntel(H("A", "A"))).toBe(true);
    expect(hasCompanyIntel(H("B", "B", "Crypto"))).toBe(false);
    expect(hasCompanyIntel(H("C", "C", "Cash"))).toBe(false);
    expect(hasCompanyIntel(H("D", "D", "Stock", { isPrivate: true }))).toBe(false);
  });

  it("indexes only holdings with company intel", () => {
    expect([...index.holdings.keys()]).toEqual(["AAPL", "VWCE.DE", "V", "GOOGL", "GOOG"]);
  });

  it("maps symbols, names, short names and ISINs to a symbol", () => {
    expect([...index.exact.entries()]).toEqual([
      ["aapl", "AAPL"],
      ["apple inc.", "AAPL"],
      ["apple", "AAPL"],
      ["vwce.de", "VWCE.DE"],
      ["vwce", "VWCE.DE"],
      ["ie00bk5bqt80", "VWCE.DE"],
      ["vanguard ftse all-world ucits etf", "VWCE.DE"],
      ["v", "V"],
      ["visa inc. class a", "V"],
      ["visa", "V"],
      ["googl", "GOOGL"],
      ["alphabet inc. class a", "GOOGL"],
      ["goog", "GOOG"],
      ["alphabet inc. class c", "GOOG"],
    ]);
  });

  it("keeps single letters out of the running-text terms", () => {
    expect([...index.terms.keys()]).toEqual([
      "AAPL",
      "Apple Inc.",
      "Apple",
      "VWCE.DE",
      "VWCE",
      "IE00BK5BQT80",
      "Vanguard FTSE All-World UCITS ETF",
      "Visa Inc. Class A",
      "Visa",
      "GOOGL",
      "Alphabet Inc. Class A",
      "GOOG",
      "Alphabet Inc. Class C",
    ]);
  });

  it("matches whole words case-sensitively", () => {
    expect(index.pattern!.flags).toBe("gu");
    const s = "Apple and VWCE rose; IE00BK5BQT80 too. Pineapple no. V is visa. Alphabet split. AAPLX no. aapl lower.";
    expect([...s.matchAll(index.pattern!)].map((m) => `${m[0]}@${m.index}`)).toEqual(["Apple@0", "VWCE@10", "IE00BK5BQT80@21"]);
  });

  it("finds a symbol by exact text", () => {
    expect(findHoldingSymbol(index, "  apple inc. ")).toBe("AAPL");
    expect(findHoldingSymbol(index, "vwce")).toBe("VWCE.DE");
    expect(findHoldingSymbol(index, "Alphabet")).toBeNull();
    expect(findHoldingSymbol(index, "btc-usd")).toBeNull();
    expect(findHoldingSymbol(index, "v")).toBe("V");
  });

  it("handles empty inputs", () => {
    expect(buildHoldingIndex([]).pattern).toBeNull();
    expect(buildHoldingIndex([H("C", "Cash", "Cash")]).exact.size).toBe(0);
  });
});

describe("holding hrefs and keys", () => {
  it("reads the symbol from a holding href", () => {
    expect(holdingSymbolFromHref("#holding:BRK-B")).toBe("BRK-B");
    expect(holdingSymbolFromHref("#holding:A%20B%2FC")).toBe("A B/C");
    expect(holdingSymbolFromHref("#holding:%E0%A4%A")).toBeNull();
    expect(holdingSymbolFromHref("https://x")).toBeNull();
    expect(holdingSymbolFromHref(undefined)).toBeNull();
    expect(holdingSymbolFromHref("#holding:")).toBe("");
  });

  it("builds a sorted key with de-duplicated ISINs", () => {
    const key = holdingLinkKey([H("B", "Bee"), H("A", "Ay", "ETF", { isPrivate: true })], [
      { symbol: "A", isin: " ie1 " },
      { symbol: "A", isin: "IE1" },
    ] as any);
    expect(key).toBe("A\u0001Ay\u0001ETF\u00011\u0002B\u0001Bee\u0001Stock\u00010\u0003A\u0001IE1");
  });

  it("ignores price changes in the key", () => {
    const a = [H("A", "Ay", "Stock", { currentPrice: 1 })];
    const b = [H("A", "Ay", "Stock", { currentPrice: 2 })];
    expect(holdingLinkKey(a)).toBe(holdingLinkKey(b));
  });

  it("renders the fallback for other links", () => {
    expect(renderHoldingAnchor("https://x", "kid", () => "FALLBACK")).toBe("FALLBACK");
  });

  it("names the open-holding event", () => {
    expect(OPEN_HOLDING_EVENT).toBe("portfolio:open-holding");
  });
});
