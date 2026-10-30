/** IncomeService: projected and received dividends in the base currency, yields, upcoming events and assistant text. */
import { describe, it, expect, beforeAll, afterAll, mock, setSystemTime } from "bun:test";
import { IncomeService, describeIncomeForAssistant, describeEventsForAssistant, MAX_EVENT_DAYS } from "../income";
import * as portfolioRepo from "../../db/portfolio.repo";
import type { TransactionRow } from "../../db/transaction.repo";
import type { PortfolioService } from "../portfolio";
import type { MarketDataCoordinator } from "../market-data";
import type { CalendarService } from "../intel/calendar";

const H = (symbol: string, assetType: string) => ({
  symbol,
  name: symbol === "ZQDIV" ? "Div Co" : symbol,
  assetType,
  shares: 100,
  totalCost: 1000,
  currentValue: 1250,
  currentPrice: 12.5,
  nativeCurrency: "USD",
  buyPrice: 10,
  previousClose: 0,
  dayChangeDollar: 0,
  dayChangePercent: 0,
  totalGainLossDollar: 0,
  totalGainLossPercent: 0,
  weightPercent: 0,
  currency: "EUR",
});

let seq = 0;
const tx = (f: Partial<TransactionRow> & { type: string; date: string }): TransactionRow => ({
  id: `zqinc${++seq}`,
  portfolioId: "p",
  datetime: null,
  assetClass: null,
  name: null,
  symbol: "ZQDIV",
  isin: null,
  shares: null,
  price: null,
  amount: null,
  fee: null,
  tax: null,
  currency: "USD",
  createdAt: "",
  updatedAt: "",
  ...f,
});

const DATA = {
  summary: { totalCost: 1000, totalValue: 1250 },
  holdings: [H("ZQDIV", "Stock"), H("BTC-USD", "Crypto")],
  transactions: [
    tx({ type: "DIVIDEND", date: "2025-11-28", amount: 40 }),
    tx({ type: "DIVIDEND", date: "2026-02-27", amount: -45 }),
    tx({ type: "DIVIDEND", date: "2025-01-10", amount: 30 }),
    tx({ type: "BUY", date: "2025-06-01", shares: 100, price: 10, amount: -1000 }),
  ],
};

const CALENDAR = {
  symbol: "ZQDIV",
  dividends: {
    history: [
      { exDate: "2025-11-14", payDate: "2025-11-28", amount: 0.5 },
      { exDate: "2026-02-13", payDate: "2026-02-27", amount: 0.5 },
      { exDate: "2026-05-13", payDate: "2026-05-27", amount: 0.55 },
    ],
    upcoming: [],
    frequency: "quarterly",
    source: "fmp",
  },
  splits: { history: [], upcoming: [{ date: "2026-06-01", numerator: 2, denominator: 1 }], source: "fmp" },
  earnings: { upcoming: { date: "2026-04-28", epsEstimate: 1.2, time: "amc" }, source: "finnhub" },
};

function build(rates: () => Promise<Map<string, number>> = async () => new Map([["USD", 0.8]])) {
  const portfolioService = { getPortfolioData: mock(async (_row: unknown, _base?: string) => DATA) };
  const calendar = {
    getCalendars: mock(async (symbols: string[], _opts: (s: string) => { earnings?: boolean }) => new Map(symbols.filter((s) => s === "ZQDIV").map((s) => [s, CALENDAR]))),
  };
  const marketData = { getExchangeRates: mock(async (_base: string, _targets: string[]) => rates()) };
  const service = new IncomeService(
    portfolioService as unknown as PortfolioService,
    marketData as unknown as MarketDataCoordinator,
    calendar as unknown as CalendarService,
  );
  return { service, portfolioService, calendar, marketData };
}

let portfolio: portfolioRepo.PortfolioRow;

beforeAll(() => {
  setSystemTime(new Date("2026-03-15T12:00:00"));
  portfolio = portfolioRepo.create({ name: "Income test", baseCurrency: "EUR" });
});

afterAll(() => {
  setSystemTime();
  portfolioRepo.deleteById(portfolio.id);
});

describe("income summary", () => {
  it("asks the calendar for income holdings only and FX for their currencies", async () => {
    const { service, calendar, marketData } = build();
    await service.getIncomeSummary(portfolio.id);
    expect(calendar.getCalendars.mock.calls[0]![0]).toEqual(["ZQDIV"]);
    expect(calendar.getCalendars.mock.calls[0]![1]("ZQDIV")).toEqual({ earnings: true });
    expect(marketData.getExchangeRates.mock.calls[0]).toEqual(["EUR", ["USD"]]);
  });

  it("projects twelve months of declared and estimated income", async () => {
    const summary = await build().service.getIncomeSummary(portfolio.id);
    expect(summary.projected12m.total).toBeCloseTo(176, 6);
    const months = summary.projected12m.months;
    expect(months.map((m) => m.month)).toEqual([
      "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
    const nonZero = Object.fromEntries(months.filter((m) => m.declared || m.estimated).map((m) => [m.month, { declared: m.declared, estimated: m.estimated }]));
    expect(nonZero).toEqual({
      "2026-05": { declared: 44, estimated: 0 },
      "2026-08": { declared: 0, estimated: 44 },
      "2026-11": { declared: 0, estimated: 44 },
      "2027-02": { declared: 0, estimated: 44 },
    });
  });

  it("counts received dividends of the last year in the base currency", async () => {
    const summary = await build().service.getIncomeSummary(portfolio.id);
    expect(summary.received12m).toEqual({ total: 68, count: 2 });
  });

  it("computes portfolio yields and lists sources", async () => {
    const summary = await build().service.getIncomeSummary(portfolio.id);
    expect(summary.yieldOnCostPercent).toBeCloseTo(17.6, 6);
    expect(summary.currentYieldPercent).toBeCloseTo(14.08, 6);
    expect(summary.sources).toEqual(["fmp"]);
    expect(summary.splitWarnings).toEqual([]);
  });

  it("describes each income holding", async () => {
    const summary = await build().service.getIncomeSummary(portfolio.id);
    expect(summary.holdings[0]).toMatchObject({
      symbol: "ZQDIV",
      name: "Div Co",
      currency: "USD",
      frequency: "quarterly",
      forwardDividendPerShare: 2.2,
      trailingDividendPerShare: 1,
      projectedIncome12m: 176,
      receivedIncome12m: 68,
      yieldOnCostPercent: 17.6,
      currentYieldPercent: 14.08,
      nextExDate: "2026-05-13",
      nextPayDate: "2026-05-27",
      estimated: true,
      source: "fmp",
    });
    expect((summary.holdings[0] as { fxMissing?: boolean }).fxMissing).toBeUndefined();
  });

  const expectNoFx = (summary: Awaited<ReturnType<IncomeService["getIncomeSummary"]>>) => {
    expect(summary.projected12m.total).toBe(0);
    for (const m of summary.projected12m.months) {
      expect(m.declared).toBe(0);
      expect(m.estimated).toBe(0);
    }
    expect(summary.received12m).toEqual({ total: 0, count: 0 });
    expect(summary.yieldOnCostPercent).toBe(0);
    expect(summary.currentYieldPercent).toBe(0);
    const h = summary.holdings[0] as unknown as Record<string, unknown>;
    expect(h.fxMissing).toBe(true);
    expect(h.projectedIncome12m).toBe(0);
    expect(h.yieldOnCostPercent).toBeUndefined();
    expect(h.currentYieldPercent).toBeUndefined();
  };

  it("leaves amounts at zero and flags the holding without a rate", async () => {
    expectNoFx(await build(async () => new Map()).service.getIncomeSummary(portfolio.id));
  });

  it("survives a rejected rate request", async () => {
    const summary = await build(async () => {
      throw new Error("fx down");
    }).service.getIncomeSummary(portfolio.id);
    expectNoFx(summary);
  });

  it("describes the summary for the assistant", async () => {
    const summary = await build().service.getIncomeSummary(portfolio.id);
    expect(describeIncomeForAssistant(summary)).toBe(
      [
        "Dividend income (sources: fmp)",
        "- Portfolio yield on cost: 17.6%",
        "- Portfolio current yield: 14.08%",
        "- ZQDIV (Div Co): quarterly, yield on cost 17.6%, current yield 14.08%, next ex-date 2026-05-13, next pay date 2026-05-27, partly estimated",
      ].join("\n"),
    );
  });

  it("rejects an unknown portfolio", async () => {
    await expect(build().service.getIncomeSummary("zq-no-such-portfolio")).rejects.toThrow("Portfolio not found");
  });
});

describe("upcoming events", () => {
  it("lists earnings, dividends and splits in date order", async () => {
    const res = await build().service.getUpcomingEvents(portfolio.id, 90);
    expect(res).toMatchObject({ days: 90, from: "2026-03-15", to: "2026-06-13", sources: ["fmp", "finnhub"] });
    expect(res.events.map((e) => [e.date, e.kind])).toEqual([
      ["2026-04-28", "earnings"],
      ["2026-05-13", "exDividend"],
      ["2026-05-27", "dividendPayment"],
      ["2026-06-01", "split"],
    ]);
    for (const e of res.events) expect(e).toMatchObject({ symbol: "ZQDIV", name: "Div Co" });
    expect(res.events[0]).toMatchObject({ epsEstimate: 1.2, time: "amc", source: "finnhub" });
    const dividend = { amountPerShare: 0.55, currency: "USD", expectedIncome: 44, source: "fmp" };
    expect(res.events[1]).toMatchObject(dividend);
    expect(res.events[2]).toMatchObject(dividend);
    expect(res.events[3]).toMatchObject({ numerator: 2, denominator: 1 });
  });

  it("clamps the number of days", async () => {
    const { service } = build();
    expect((await service.getUpcomingEvents(portfolio.id, 0)).days).toBe(1);
    expect((await service.getUpcomingEvents(portfolio.id, 5000)).days).toBe(365);
    expect(MAX_EVENT_DAYS).toBe(365);
    expect((await service.getUpcomingEvents(portfolio.id, Number.NaN)).days).toBe(30);
    expect((await service.getUpcomingEvents(portfolio.id, 2.6)).days).toBe(3);
  });

  it("describes the events for the assistant", async () => {
    const res = await build().service.getUpcomingEvents(portfolio.id, 90);
    expect(describeEventsForAssistant(res)).toBe(
      [
        "Upcoming events 2026-03-15 to 2026-06-13 (sources: fmp, finnhub)",
        "- 2026-04-28 ZQDIV (Div Co) earnings report EPS estimate 1.2",
        "- 2026-05-13 ZQDIV (Div Co) ex-dividend 0.55 USD per share",
        "- 2026-05-27 ZQDIV (Div Co) dividend payment 0.55 USD per share",
        "- 2026-06-01 ZQDIV (Div Co) stock split 2-for-1",
      ].join("\n"),
    );
    expect(describeEventsForAssistant({ ...res, events: [] }).split("\n")[1]).toBe("- None");
  });
});
