import { describe, it, expect } from "bun:test";
import { addMonthsIso, inferFrequency, mapFrequency, pickEarnings, projectDividends } from "../intel/calendar.js";
import { detectSplitWarnings, nextTwelveMonths } from "../income.js";
import { alertWindowEnd, formatAlertMessage, isAlertDue, isAlertEvent } from "../event-alerts.js";
import type { SymbolCalendar } from "portfolio-shared/api-types";
import type { HoldingPerformance } from "portfolio-shared/portfolio";
import type { TransactionRow } from "../../db/transaction.repo.js";

const calendar = (overrides: Partial<SymbolCalendar> = {}): SymbolCalendar => ({
  symbol: "TEST",
  dividends: { history: [], upcoming: [], source: "fmp" },
  splits: { history: [], upcoming: [], source: "fmp" },
  earnings: { source: null },
  ...overrides,
});

const holding = (overrides: Partial<HoldingPerformance> = {}): HoldingPerformance => ({
  symbol: "TEST",
  name: "Test Inc",
  assetType: "Stock",
  shares: 40,
  buyPrice: 100,
  currentPrice: 25,
  previousClose: 25,
  totalCost: 4000,
  currentValue: 1000,
  dayChangeDollar: 0,
  dayChangePercent: 0,
  totalGainLossDollar: -3000,
  totalGainLossPercent: -75,
  weightPercent: 100,
  currency: "EUR",
  ...overrides,
});

const tx = (overrides: Partial<TransactionRow>): TransactionRow => ({
  id: "t",
  portfolioId: "p",
  date: "2024-01-10",
  datetime: null,
  type: "BUY",
  assetClass: null,
  name: null,
  symbol: "TEST",
  isin: null,
  shares: 40,
  price: 100,
  amount: 4000,
  fee: null,
  tax: null,
  currency: "EUR",
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

describe("dividend calendar math", () => {
  it("maps provider frequency labels", () => {
    expect(mapFrequency("Quarterly")).toBe("quarterly");
    expect(mapFrequency("Semi-Annual")).toBe("semiannual");
    expect(mapFrequency("Annual")).toBe("annual");
    expect(mapFrequency("Monthly")).toBe("monthly");
    expect(mapFrequency("")).toBeUndefined();
  });

  it("infers the frequency from the gaps between ex-dates", () => {
    expect(inferFrequency(["2025-02-10", "2025-05-12", "2025-08-11", "2025-11-10"])).toBe("quarterly");
    expect(inferFrequency(["2024-06-01", "2025-06-02"])).toBe("annual");
    expect(inferFrequency(["2025-06-01"])).toBeUndefined();
  });

  it("adds months and clamps the day", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("projects the next dividends with the last amount and pay lag", () => {
    const history = [
      { exDate: "2026-02-10", payDate: "2026-02-20", amount: 0.25 },
      { exDate: "2026-05-11", payDate: "2026-05-21", amount: 0.26 },
      { exDate: "2026-08-10", payDate: "2026-08-20", amount: 0.26 },
    ];
    const out = projectDividends(history, "quarterly", "2027-08-31", "2026-10-10");
    expect(out.map((d) => d.exDate)).toEqual(["2026-11-10", "2027-02-10", "2027-05-10", "2027-08-10"]);
    expect(out[0]).toEqual({ exDate: "2026-11-10", payDate: "2026-11-20", amount: 0.26, estimated: true });
  });

  it("projects nothing for suspended or irregular dividends", () => {
    const old = [{ exDate: "2024-01-10", amount: 1 }];
    expect(projectDividends(old, "quarterly", "2027-10-10", "2026-10-10")).toEqual([]);
    expect(projectDividends([{ exDate: "2026-09-01", amount: 1 }], "irregular", "2027-10-10", "2026-10-10")).toEqual([]);
  });

  it("picks the next and the last earnings report", () => {
    const picked = pickEarnings(
      [
        { date: "2026-07-30", epsActual: 1.5, epsEstimate: 1.4 },
        { date: "2026-10-29", epsActual: null, epsEstimate: 1.6 },
        { date: "2027-01-28", epsActual: null, epsEstimate: 1.7 },
      ],
      "2026-10-10",
    );
    expect(picked.upcoming?.date).toBe("2026-10-29");
    expect(picked.last?.date).toBe("2026-07-30");
  });

  it("lists 12 month keys from the current month", () => {
    const months = nextTwelveMonths("2026-10-10");
    expect(months[0]).toBe("2026-10");
    expect(months[11]).toBe("2027-09");
    expect(months).toHaveLength(12);
  });
});

describe("split warnings", () => {
  const split = calendar({ splits: { history: [{ date: "2025-06-02", numerator: 4, denominator: 1 }], upcoming: [], source: "fmp" } });

  it("warns when the average cost still matches the price before the split", () => {
    const warnings = detectSplitWarnings(holding(), split, [tx({})], "2026-10-10");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.numerator).toBe(4);
  });

  it("stays quiet when the quantities look adjusted", () => {
    const adjusted = holding({ shares: 160, totalCost: 4000, currentPrice: 25 });
    expect(detectSplitWarnings(adjusted, split, [tx({ shares: 160, price: 25 })], "2026-10-10")).toEqual([]);
  });

  it("stays quiet when a no-cost transaction records the split", () => {
    const txs = [tx({}), tx({ date: "2025-06-03", shares: 120, price: 0, amount: 0 })];
    expect(detectSplitWarnings(holding(), split, txs, "2026-10-10")).toEqual([]);
  });

  it("ignores splits before the first purchase", () => {
    expect(detectSplitWarnings(holding(), split, [tx({ date: "2025-07-01" })], "2026-10-10")).toEqual([]);
  });
});

describe("event alerts", () => {
  it("covers the weekend on a Friday and a Saturday", () => {
    expect(alertWindowEnd("2026-10-09")).toBe("2026-10-12"); // Friday -> Monday
    expect(alertWindowEnd("2026-10-10")).toBe("2026-10-12"); // Saturday -> Monday
    expect(alertWindowEnd("2026-10-12")).toBe("2026-10-13");
  });

  it("is due once a day after the set time", () => {
    const now = new Date(2026, 9, 10, 18, 30);
    expect(isAlertDue({ eventAlertsEnabled: true, eventAlertsTime: "18:00" }, now)).toBe(true);
    expect(isAlertDue({ eventAlertsEnabled: true, eventAlertsTime: "19:00" }, now)).toBe(false);
    expect(isAlertDue({ eventAlertsEnabled: true, eventAlertsTime: "18:00", eventAlertsLastRun: "2026-10-10" }, now)).toBe(false);
    expect(isAlertDue({ eventAlertsEnabled: false, eventAlertsTime: "18:00" }, now)).toBe(false);
  });

  it("alerts on declared ex-dates and earnings only, with tickers and dates", () => {
    expect(isAlertEvent({ date: "2026-10-12", kind: "exDividend", symbol: "A", name: "A", estimated: true, source: "fmp" })).toBe(false);
    expect(isAlertEvent({ date: "2026-10-12", kind: "dividendPayment", symbol: "A", name: "A", source: "fmp" })).toBe(false);
    const text = formatAlertMessage(
      [
        { date: "2026-10-12", kind: "exDividend", symbol: "AAA", name: "A", amountPerShare: 0.5, expectedIncome: 20, source: "fmp" },
        { date: "2026-10-12", kind: "earnings", symbol: "BBB", name: "B", time: "amc", source: "finnhub" },
      ],
      "2026-10-12",
    );
    expect(text).toContain("AAA: ex-dividend date Mon 2026-10-12");
    expect(text).toContain("BBB: earnings report Mon 2026-10-12, after the market closes");
    expect(text).not.toContain("0.5");
    expect(text).not.toContain("per share");
  });
});
