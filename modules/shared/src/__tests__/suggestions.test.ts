/** Suggestion helpers not covered by the service tests: amounts, status edges, validity texts, market lookup and projection extras. */
import { describe, expect, it } from "bun:test";
import {
  SUGGESTION_ACTIONS,
  SUGGESTION_DEFAULT_TTL_DAYS,
  SUGGESTION_MAX_TTL_DAYS,
  compareSuggestions,
  countActiveSuggestions,
  evaluateSuggestion,
  failedValidity,
  marketForSymbol,
  projectTargetPortfolio,
  suggestionKey,
  suggestionTolerance,
  type PortfolioSuggestion,
  type SuggestionHoldingInput,
  type SuggestionMarket,
  type SuggestionQuote,
} from "../suggestions";

type EvalInput = Parameters<typeof evaluateSuggestion>[0];
type Validity = Parameters<typeof failedValidity>[0];

const NOW = new Date("2026-10-30T00:00:00Z");
const base = {
  action: "increase",
  symbol: "AAA",
  fromWeight: 10,
  targetWeight: 20,
  validity: { expiresAt: "2026-11-01T00:00:00Z" },
  status: "active",
} as const;
const mk = (o: Partial<SuggestionMarket> = {}): SuggestionMarket => ({
  weight: 10,
  price: 50,
  currency: "USD",
  toBase: 0.5,
  shares: 100,
  fractional: false,
  ...o,
});
const ev = (s: Partial<EvalInput> & object, market: SuggestionMarket, total: number | undefined, now = NOW) =>
  evaluateSuggestion({ ...base, ...s } as EvalInput, market, total, now);

describe("small helpers", () => {
  it("builds the key from action and upper-cased trimmed symbol", () => {
    expect(suggestionKey("open", " vwce.de ")).toBe("open:VWCE.DE");
    expect(suggestionKey("close", "αβγ")).toBe("close:ΑΒΓ");
  });

  it("computes the tolerance", () => {
    expect(suggestionTolerance(40, 30)).toBe(1);
    expect(suggestionTolerance(0, 2)).toBe(0.5);
    expect(suggestionTolerance(10, 10)).toBe(0.5);
    expect(suggestionTolerance(0, 20)).toBe(2);
  });

  it("orders by priority then creation time", () => {
    expect(compareSuggestions({ priority: 1, createdAt: "b" }, { priority: 2, createdAt: "a" })).toBe(-1);
    expect(compareSuggestions({ priority: 1, createdAt: "2026-01-02" }, { priority: 1, createdAt: "2026-01-01" })).toBe(1);
    expect(compareSuggestions({ priority: 1, createdAt: "2026-01-01" }, { priority: 1, createdAt: "2026-01-01" })).toBe(0);
    const list = [
      { id: "p2-old", priority: 2, createdAt: "2026-01-02" },
      { id: "p1-new", priority: 1, createdAt: "2026-01-05" },
      { id: "p2-older", priority: 2, createdAt: "2026-01-01" },
    ];
    expect([...list].sort(compareSuggestions).map((s) => s.id)).toEqual(["p1-new", "p2-older", "p2-old"]);
  });

  it("exposes the action list and TTL limits", () => {
    expect(SUGGESTION_ACTIONS).toEqual(["increase", "decrease", "open", "close"]);
    expect(SUGGESTION_DEFAULT_TTL_DAYS).toBe(7);
    expect(SUGGESTION_MAX_TTL_DAYS).toBe(30);
    expect(SUGGESTION_DEFAULT_TTL_DAYS).toBeLessThanOrEqual(SUGGESTION_MAX_TTL_DAYS);
  });
});

describe("evaluateSuggestion amounts", () => {
  it("converts the weight gap to value and whole shares", () => {
    const r = ev({}, mk(), 10000);
    expect(r).toMatchObject({ currentWeight: 10, deltaWeight: 10, deltaValue: 1000, deltaShares: 40, progress: 0, status: "active" });
  });

  it("keeps 4 decimals for fractional shares", () => {
    expect(ev({}, mk({ fractional: true, price: 30, toBase: 1 }), 10000).deltaShares).toBe(33.3333);
  });

  it("truncates a whole-share sell toward zero", () => {
    const r = ev({ action: "decrease", fromWeight: 20, targetWeight: 10 }, mk({ weight: 20, price: 30, toBase: 1 }), 10000);
    expect(r.deltaShares).toBe(-33);
    expect(r.deltaValue).toBe(-1000);
  });

  it("sells every held share on close", () => {
    const r = ev({ action: "close", fromWeight: 20, targetWeight: 0 }, mk({ weight: 20, shares: 7.5 }), 10000);
    expect(r.deltaShares).toBe(-7.5);
    expect(r.deltaWeight).toBe(-20);
    expect(r.deltaValue).toBe(-2000);
  });

  it("leaves amounts out without a total value", () => {
    for (const total of [undefined, 0, NaN]) {
      const r = ev({}, mk(), total);
      expect(r.deltaValue).toBeUndefined();
      expect(r.deltaShares).toBeUndefined();
    }
  });

  it("leaves shares out without a price", () => {
    const r = ev({}, mk({ price: undefined }), 10000);
    expect(r.deltaValue).toBe(1000);
    expect(r.deltaShares).toBeUndefined();
  });

  it("never returns negative zero shares", () => {
    const r = ev({ action: "decrease", fromWeight: 10, targetWeight: 9.5 }, mk({ weight: 10.1, price: 1000, toBase: 1 }), 10000);
    expect(r.status).toBe("active");
    expect(r.deltaValue).toBeCloseTo(-60, 6);
    expect(Object.is(r.deltaShares, 0)).toBe(true);
  });

  it("returns a stored non-active status with its reason", () => {
    const r = ev({ status: "dismissed", statusReason: "x" }, mk({ weight: 20 }), 10000);
    expect(r.status).toBe("dismissed");
    expect(r.reason).toBe("x");
    expect(r.deltaWeight).toBe(0);
    expect(r.progress).toBe(1);
  });
});

describe("evaluateSuggestion status", () => {
  it("counts an overshoot as done", () => {
    const r = ev({}, mk({ weight: 25 }), 10000);
    expect(r.status).toBe("done");
    expect(r.reason).toBe("Target weight reached");
    expect(r.progress).toBe(1);
    expect(r.deltaWeight).toBe(-5);
  });

  it("is done within the tolerance", () => {
    expect(ev({}, mk({ weight: 19 }), 10000).status).toBe("done");
    expect(ev({}, mk({ weight: 18.99 }), 10000).status).toBe("active");
  });

  it("clamps progress at 0 when moving the wrong way", () => {
    expect(ev({}, mk({ weight: 5 }), 10000).progress).toBe(0);
  });

  it("reports done before an expired validity", () => {
    expect(ev({}, mk({ weight: 20 }), 10000, new Date("2027-01-01T00:00:00Z")).status).toBe("done");
  });
});

describe("failedValidity", () => {
  const v = (validityExtra: Partial<Validity> = {}, marketExtra: Partial<SuggestionMarket> = {}, now = NOW) =>
    failedValidity({ expiresAt: "2026-11-01T00:00:00Z", ...validityExtra }, mk(marketExtra), now);

  it("passes a valid suggestion", () => {
    expect(v()).toBeUndefined();
  });

  it("expires strictly after expiresAt", () => {
    expect(v({}, {}, new Date("2026-11-01T00:00:00Z"))).toBeUndefined();
    expect(v({}, {}, new Date("2026-11-01T00:00:01Z"))).toBe("Expired on 2026-11-01");
  });

  it("never expires with an unparsable date", () => {
    expect(v({ expiresAt: "garbage" })).toBeUndefined();
  });

  it("reports the price range", () => {
    expect(v({ price: { min: 60, currency: "usd" } })).toBe("Price left the range above 60 usd");
    expect(v({ price: { max: 40, currency: "USD" } })).toBe("Price left the range below 40 USD");
    expect(v({ price: { min: 40, max: 45, currency: "USD" } })).toBe("Price left the range 40 to 45 USD");
    expect(v({ price: { min: 50, max: 50, currency: "USD" } })).toBeUndefined();
  });

  it("applies the price rule only in a matching or unknown currency", () => {
    expect(v({ price: { min: 60, currency: "EUR" } })).toBeUndefined();
    expect(v({ price: { min: 60, currency: "EUR" } }, { currency: undefined })).toBe("Price left the range above 60 EUR");
    expect(v({ price: { min: 60, currency: "USD" } }, { price: undefined })).toBeUndefined();
  });

  it("reports the weight range", () => {
    expect(v({ weight: { min: 15 } })).toBe("Weight left the range above 15%");
    expect(v({ weight: { max: 5 } })).toBe("Weight left the range below 5%");
    expect(v({ weight: { min: 1, max: 5 } })).toBe("Weight left the range 1 to 5%");
  });

  it("reports expiry first", () => {
    expect(v({ expiresAt: "2026-10-01T00:00:00Z", weight: { max: 5 } })).toBe("Expired on 2026-10-01");
  });
});

const H: SuggestionHoldingInput[] = [
  { symbol: "aaa", name: "A", assetType: "Stock", shares: 10, weightPercent: 12.5, currentPrice: 90, nativePrice: 100, nativeCurrency: "USD", currency: "EUR" },
  { symbol: "CASH", name: "Cash", assetType: "Cash", shares: 1, weightPercent: 5, currentPrice: 1, currency: "EUR" },
  { symbol: "BTC-USD", name: "Bitcoin", assetType: "Crypto", shares: 2, weightPercent: 30, currentPrice: 50000, currency: "EUR" },
  { symbol: "FRAC", name: "F", assetType: "ETF", shares: 2.5, weightPercent: 3, currentPrice: 0, nativePrice: 0, currency: "EUR" },
];
const Q: SuggestionQuote[] = [{ symbol: "NEW", price: 20, currency: "GBP", toBase: 1.2, fractional: true }];

describe("marketForSymbol", () => {
  it("matches a holding ignoring case and whitespace", () => {
    const m = marketForSymbol(" AAA ", H, Q);
    expect(m).toMatchObject({ weight: 12.5, price: 100, currency: "USD", shares: 10, fractional: false });
    expect(m.toBase).toBeCloseTo(0.9, 10);
  });

  it("never matches a cash row", () => {
    expect(marketForSymbol("cash", H, Q)).toEqual({
      weight: 0,
      price: undefined,
      currency: undefined,
      toBase: undefined,
      shares: 0,
      fractional: false,
    });
  });

  it("treats crypto as fractional", () => {
    expect(marketForSymbol("btc-usd", H, Q)).toEqual({ weight: 30, price: 50000, currency: "EUR", toBase: 1, shares: 2, fractional: true });
  });

  it("drops zero prices", () => {
    expect(marketForSymbol("FRAC", H, Q)).toMatchObject({ price: undefined, toBase: 1, currency: "EUR", fractional: true });
  });

  it("uses the quote for an unheld symbol", () => {
    expect(marketForSymbol("new", H, Q)).toEqual({ weight: 0, price: 20, currency: "GBP", toBase: 1.2, shares: 0, fractional: true });
    expect(marketForSymbol("NONE", H, Q)).toEqual({
      weight: 0,
      price: undefined,
      currency: undefined,
      toBase: undefined,
      shares: 0,
      fractional: false,
    });
  });
});

describe("countActiveSuggestions", () => {
  const sug = (o: Partial<PortfolioSuggestion> = {}): PortfolioSuggestion => ({
    id: "s",
    portfolioId: "p",
    key: "increase:AAA",
    action: "increase",
    symbol: "AAA",
    name: "A",
    fromWeight: 12.5,
    targetWeight: 20,
    title: "t",
    why: "w",
    priority: 1,
    validity: { expiresAt: "2099-01-01T00:00:00Z" },
    fundedBy: [],
    status: "active",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...o,
  });

  it("counts only suggestions still active", () => {
    const list = [
      sug(),
      sug({ status: "dismissed" }),
      sug({ fromWeight: 5, targetWeight: 12.5 }),
      sug({ symbol: "NEW", action: "open", fromWeight: 0, targetWeight: 5 }),
    ];
    expect(countActiveSuggestions(list, H, Q, 10000)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(countActiveSuggestions([], H, Q, 10000)).toBe(0);
  });
});

describe("projectTargetPortfolio extras", () => {
  const PH = [
    { symbol: "A", name: "A", weight: 50 },
    { symbol: "b", name: "B", weight: 30 },
    { symbol: "CASH", name: "Cash", weight: 20, isCash: true },
  ];
  type S = Parameters<typeof projectTargetPortfolio>[1][number];
  const s = (symbol: string, action: S["action"], targetWeight: number, name = symbol): S => ({ symbol, name, targetWeight, action });

  it("keeps everything without suggestions", () => {
    const r = projectTargetPortfolio(PH, []);
    expect(r.rows).toEqual([
      { symbol: "A", name: "A", currentWeight: 50, targetWeight: 50, deltaWeight: 0, isNew: false, isClosed: false },
      { symbol: "b", name: "B", currentWeight: 30, targetWeight: 30, deltaWeight: 0, isNew: false, isClosed: false },
    ]);
    expect(r.cash).toEqual({ currentWeight: 20, targetWeight: 20, deltaWeight: 0 });
    expect(r.sold).toBe(0);
    expect(r.bought).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("matches case-insensitively and clamps a negative target", () => {
    const r = projectTargetPortfolio(PH, [s("B", "decrease", -5, "B2"), s("a", "increase", 60, "A")]);
    expect(r.rows.map((x) => x.symbol)).toEqual(["A", "b"]);
    expect(r.rows[1]).toMatchObject({ symbol: "b", name: "B", targetWeight: 0, isClosed: true });
    expect(r.rows[0]).toMatchObject({ targetWeight: 60, deltaWeight: 10 });
    expect(r.cash).toEqual({ currentWeight: 20, targetWeight: 40, deltaWeight: 20 });
    expect(r.sold).toBe(30);
    expect(r.bought).toBe(10);
    expect(r.warnings).toEqual(["After the sells, 40% of the portfolio stays in cash."]);
  });

  it("ignores the target weight of a close", () => {
    const r = projectTargetPortfolio(PH, [s("A", "close", 25)]);
    expect(r.rows.map((x) => x.symbol)).toEqual(["b", "A"]);
    expect(r.rows[1]).toMatchObject({ targetWeight: 0, deltaWeight: -50, isClosed: true });
  });

  it("nets a repeated symbol but counts both legs", () => {
    const r = projectTargetPortfolio(PH, [s("A", "decrease", 40), s("A", "increase", 45)]);
    expect(r.rows.find((x) => x.symbol === "A")?.targetWeight).toBe(45);
    expect(r.sold).toBe(10);
    expect(r.bought).toBe(5);
    expect(r.cash.targetWeight).toBe(25);
    expect(r.warnings).toEqual(["After the sells, 25% of the portfolio stays in cash."]);
  });

  it("warns about negative cash only below -0.05", () => {
    const r = projectTargetPortfolio(PH, [s("A", "increase", 70.04)]);
    expect(r.cash.targetWeight).toBeCloseTo(-0.04, 10);
    expect(r.warnings).toEqual([]);
  });

  it("rounds to 2 decimals", () => {
    const r = projectTargetPortfolio(
      [
        { symbol: "A", name: "A", weight: 33.333 },
        { symbol: "C", name: "C", weight: 66.667, isCash: true },
      ],
      [s("A", "increase", 40.005)],
    );
    expect(r.rows[0]).toMatchObject({ currentWeight: 33.333, targetWeight: 40.01, deltaWeight: 6.68 });
    expect(r.cash).toEqual({ currentWeight: 66.67, targetWeight: 60, deltaWeight: -6.67 });
    expect(r.bought).toBe(6.67);
  });
});
