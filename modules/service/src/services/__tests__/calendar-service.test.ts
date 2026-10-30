/** CalendarService: dividends, splits and earnings from FMP, then Yahoo and Finnhub, plus projection boundaries. */
import { describe, it, expect, beforeEach, afterEach, mock, setSystemTime } from "bun:test";
import { CalendarService, projectDividends, addDaysIso, daysBetween, isoDay } from "../intel/calendar";
import type { FmpService } from "../fmp";
import type { YahooFinanceService } from "../yahoo-finance";
import type { FinnhubService } from "../finnhub";

const unix = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

type Routes = Record<string, unknown[]>;

function fmpStub(routes: Routes | null) {
  return {
    isConfigured: () => routes !== null,
    get: mock(async (path: string, _params?: unknown, _ttl?: unknown) => routes?.[path] ?? []),
  };
}

function yahooStub(events: unknown = null, summary: unknown = null) {
  return {
    getCorporateEvents: mock(async (_s: string) => events),
    getQuoteSummary: mock(async (_s: string, _m: string[], _ttl?: number) => summary),
  };
}

function finnhubStub(rows: unknown[] | null = null) {
  return {
    isConfigured: () => rows !== null,
    getEarningsCalendar: mock(async (_s: string, _from: string, _to: string) => rows ?? []),
  };
}

function service(fmp: unknown, yahoo: unknown, finnhub: unknown): CalendarService {
  return new CalendarService(fmp as FmpService, yahoo as YahooFinanceService, finnhub as FinnhubService);
}

beforeEach(() => {
  setSystemTime(new Date("2026-03-15T12:00:00"));
});
afterEach(() => {
  setSystemTime();
});

describe("FMP rows", () => {
  it("reads dividends, prefers the adjusted amount and drops zero and bad rows", async () => {
    const fmp = fmpStub({
      "/dividends": [
        { date: "2025-11-14", paymentDate: "2025-11-28", adjDividend: 0.5, dividend: 1, frequency: "Quarterly" },
        { date: "2026-02-13", paymentDate: "2026-02-27", adjDividend: 0, dividend: 0.52, frequency: "Quarterly" },
        { date: "bad", dividend: 1 },
        { date: "2025-08-14", dividend: 0 },
      ],
    });
    const cal = await service(fmp, yahooStub(), finnhubStub()).getSymbolCalendar("ZQC1", { earnings: true });
    expect(cal.dividends.history.length).toBe(2);
    expect(cal.dividends.history[0]).toMatchObject({ exDate: "2025-11-14", payDate: "2025-11-28", amount: 0.5 });
    expect(cal.dividends.history[1]).toMatchObject({ exDate: "2026-02-13", payDate: "2026-02-27", amount: 0.52 });
    expect(cal.dividends.history[0]!.recordDate).toBeUndefined();
    expect(cal.dividends.history[0]!.declarationDate).toBeUndefined();
    expect(cal.dividends.upcoming).toEqual([]);
    expect(cal.dividends.frequency).toBe("quarterly");
    expect(cal.dividends.source).toBe("fmp");
    const divCall = fmp.get.mock.calls.find((c) => c[0] === "/dividends");
    expect(divCall?.[1]).toEqual({ symbol: "ZQC1", limit: 40 });
  });

  it("splits splits into history and upcoming and drops invalid ratios", async () => {
    const fmp = fmpStub({
      "/splits": [
        { date: "2020-08-31", numerator: 4, denominator: 1 },
        { date: "2026-06-01", numerator: 2, denominator: 1 },
        { date: "2025-01-01", numerator: 0, denominator: 1 },
      ],
    });
    const cal = await service(fmp, yahooStub(), finnhubStub()).getSymbolCalendar("ZQC2", { earnings: true });
    expect(cal.splits.history).toEqual([{ date: "2020-08-31", numerator: 4, denominator: 1 }]);
    expect(cal.splits.upcoming).toEqual([{ date: "2026-06-01", numerator: 2, denominator: 1 }]);
    expect(cal.splits.source).toBe("fmp");
  });

  it("picks the next and the last earnings report", async () => {
    const fmp = fmpStub({
      "/earnings": [
        { date: "2026-01-29", epsActual: 2.1, epsEstimated: 2 },
        { date: "2026-04-30", epsEstimated: 2.2, epsActual: null },
        { date: "2025-10-30", epsActual: null, epsEstimated: 1.9 },
      ],
    });
    const cal = await service(fmp, yahooStub(), finnhubStub()).getSymbolCalendar("ZQC3", { earnings: true });
    expect(cal.earnings.upcoming).toMatchObject({
      date: "2026-04-30",
      epsEstimate: 2.2,
      epsActual: null,
      surprisePercent: null,
      revenueEstimate: null,
      revenueActual: null,
    } as never);
    expect(cal.earnings.last?.date).toBe("2026-01-29");
    expect(cal.earnings.last?.surprisePercent).toBeCloseTo(5, 6);
    expect(cal.earnings.source).toBe("fmp");
  });

  it("skips earnings when not asked", async () => {
    const fmp = fmpStub({ "/earnings": [{ date: "2026-04-30", epsEstimated: 2.2 }] });
    const cal = await service(fmp, yahooStub(), finnhubStub()).getSymbolCalendar("ZQC4", { earnings: false });
    expect(cal.earnings).toEqual({ source: null });
    expect(fmp.get.mock.calls.some((c) => c[0] === "/earnings")).toBe(false);
  });
});

describe("Yahoo and Finnhub fallback", () => {
  const events = {
    symbol: "ZQY",
    currency: "USD",
    dividends: [
      { date: "2025-11-14", amount: 0.5 },
      { date: "2026-02-13", amount: 0.5 },
    ],
    splits: [
      { date: "2020-08-31", numerator: 4, denominator: 1 },
      { date: "2026-06-01", numerator: 2, denominator: 1 },
    ],
  };

  it("reads Yahoo events and the declared dividend and earnings dates", async () => {
    const yahoo = yahooStub(events, {
      calendarEvents: {
        exDividendDate: { raw: unix("2026-05-13") },
        dividendDate: unix("2026-05-27"),
        earnings: { earningsDate: [unix("2026-04-30"), unix("2026-04-28")], earningsAverage: { raw: 1.2 }, revenueAverage: 5e9 },
      },
    });
    const cal = await service(fmpStub(null), yahoo, finnhubStub()).getSymbolCalendar("ZQY1", { earnings: true });
    const declared = { exDate: "2026-05-13", payDate: "2026-05-27", amount: 0.5, estimated: true };
    expect(cal.dividends.history.at(-1)).toMatchObject(declared);
    expect(cal.dividends.upcoming.length).toBe(1);
    expect(cal.dividends.upcoming[0]).toMatchObject(declared);
    expect(cal.dividends.frequency).toBe("quarterly");
    expect(cal.dividends.source).toBe("yahoo");
    expect(cal.splits).toEqual({
      history: [{ date: "2020-08-31", numerator: 4, denominator: 1 }],
      upcoming: [{ date: "2026-06-01", numerator: 2, denominator: 1 }],
      source: "yahoo",
    });
    expect(cal.earnings.upcoming).toMatchObject({ date: "2026-04-28", epsEstimate: 1.2, revenueEstimate: 5e9 });
    expect(cal.earnings.source).toBe("yahoo");
    expect(yahoo.getCorporateEvents.mock.calls.length).toBe(1);
    expect(yahoo.getQuoteSummary.mock.calls.length).toBe(1);
  });

  it("adds only the pay date when the declared ex-date is already known", async () => {
    const yahoo = yahooStub(events, { calendarEvents: { exDividendDate: unix("2026-02-13"), dividendDate: unix("2026-02-27") } });
    const cal = await service(fmpStub(null), yahoo, finnhubStub()).getSymbolCalendar("ZQY2", { earnings: false });
    expect(cal.dividends.history.length).toBe(2);
    expect(cal.dividends.history[1]).toMatchObject({ exDate: "2026-02-13", payDate: "2026-02-27", amount: 0.5 });
  });

  it("ignores a declared pay date before the ex-date", async () => {
    const yahoo = yahooStub(events, { calendarEvents: { exDividendDate: unix("2026-05-13"), dividendDate: unix("2026-05-01") } });
    const cal = await service(fmpStub(null), yahoo, finnhubStub()).getSymbolCalendar("ZQY3", { earnings: false });
    const last = cal.dividends.history.at(-1)!;
    expect(last.exDate).toBe("2026-05-13");
    expect(last.payDate).toBeUndefined();
  });

  it("reads earnings from Finnhub when it is configured", async () => {
    const finnhub = finnhubStub([
      { date: "2026-01-29", epsActual: 2.1, epsEstimate: 2, hour: "amc" },
      { date: "2026-04-30", epsEstimate: 2.2, hour: "dmh" },
    ]);
    const cal = await service(fmpStub(null), yahooStub(events, null), finnhub).getSymbolCalendar("ZQSYM", { earnings: true });
    expect(finnhub.getEarningsCalendar.mock.calls[0]).toEqual(["ZQSYM", "2025-08-27", "2026-10-01"]);
    expect(cal.earnings.last).toMatchObject({ date: "2026-01-29", epsActual: 2.1, epsEstimate: 2, time: "amc" });
    expect(cal.earnings.last?.surprisePercent).toBeCloseTo(5, 6);
    expect(cal.earnings.upcoming).toMatchObject({ date: "2026-04-30", epsEstimate: 2.2 });
    expect(cal.earnings.upcoming?.time).toBeUndefined();
    expect(cal.earnings.source).toBe("finnhub");
  });

  it("drops a Yahoo earnings date in the past", async () => {
    const yahoo = yahooStub(events, { calendarEvents: { earnings: { earningsDate: [unix("2026-03-01")], earningsAverage: 1 } } });
    const cal = await service(fmpStub(null), yahoo, finnhubStub()).getSymbolCalendar("ZQY4", { earnings: true });
    expect(cal.earnings.upcoming).toBeUndefined();
    expect(cal.earnings.source).toBeNull();
  });

  it("dedupes symbols and returns an empty calendar for a symbol that throws", async () => {
    class Throwing extends CalendarService {
      override async getSymbolCalendar(symbol: string, options?: { earnings?: boolean }) {
        if (symbol === "B") throw new Error("boom");
        return super.getSymbolCalendar(symbol, options);
      }
    }
    const svc = new Throwing(fmpStub(null) as unknown as FmpService, yahooStub() as unknown as YahooFinanceService, finnhubStub() as unknown as FinnhubService);
    const map = await svc.getCalendars(["a", "A", "", "B"], () => ({}));
    expect([...map.keys()].sort()).toEqual(["A", "B", "a"]);
    expect(map.get("B")).toEqual({
      symbol: "B",
      dividends: { history: [], upcoming: [], source: null },
      splits: { history: [], upcoming: [], source: null },
      earnings: { source: null },
    } as never);
  });
});

describe("projection boundaries", () => {
  const history = [
    { exDate: "2025-11-14", payDate: "2025-11-28", amount: 0.5 },
    { exDate: "2026-02-13", payDate: "2026-02-27", amount: 0.5 },
  ];

  it("projects while the last ex-date is recent enough and keeps past projections", () => {
    expect(projectDividends(history, "quarterly", "2026-12-31", "2026-07-30")).toEqual([
      { exDate: "2026-05-13", payDate: "2026-05-27", amount: 0.5, estimated: true },
      { exDate: "2026-08-13", payDate: "2026-08-27", amount: 0.5, estimated: true },
      { exDate: "2026-11-13", payDate: "2026-11-27", amount: 0.5, estimated: true },
    ]);
    expect(projectDividends(history, "quarterly", "2026-12-31", "2026-07-31")).toEqual([]);
  });

  it("clamps month ends without drifting", () => {
    const out = projectDividends([{ exDate: "2025-11-30", amount: 1 }], "monthly", "2026-04-30", "2025-12-01");
    expect(out.map((e) => e.exDate)).toEqual(["2025-12-30", "2026-01-30", "2026-02-28", "2026-03-30", "2026-04-30"]);
    for (const e of out) expect(e.payDate).toBeUndefined();
  });

  it("ignores pay lags outside 0 to 120 days", () => {
    const out = projectDividends([{ exDate: "2025-11-14", payDate: addDaysIso("2025-11-14", 200), amount: 1 }], "quarterly", "2026-12-31", "2026-01-01");
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) expect(e.payDate).toBeUndefined();
  });

  it("does date math on calendar days", () => {
    expect(addDaysIso("2026-03-15", -200)).toBe("2025-08-27");
    expect(addDaysIso("2026-03-15", 200)).toBe("2026-10-01");
    expect(daysBetween("2026-03-29", "2026-03-30")).toBe(1);
    expect(isoDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
