import { describe, it, expect } from "bun:test";
import { relativePerformance } from "portfolio-shared/benchmark";
import { exchangeForSymbol, getMarketStatus, isMarketOpen, isTradingDay } from "../intel/market-hours.js";
import type { FmpService } from "../fmp.js";

/** No FMP key: every check runs on the built-in table. */
const noFmp = { isConfigured: () => false, get: async () => null } as unknown as FmpService;

describe("market hours (built-in table)", () => {
  it("maps symbols to exchanges", () => {
    expect(exchangeForSymbol("AAPL")).toBe("NYSE");
    expect(exchangeForSymbol("BRK.B")).toBe("NYSE");
    expect(exchangeForSymbol("VOD.L")).toBe("LSE");
    expect(exchangeForSymbol("VWCE.DE")).toBe("XETRA");
    expect(exchangeForSymbol("BTC-USD")).toBe("CRYPTO");
    expect(exchangeForSymbol("EURUSD=X")).toBe("FOREX");
    expect(exchangeForSymbol("^FTSE")).toBe("LSE");
    expect(exchangeForSymbol("CASH", "Cash")).toBeNull();
    expect(exchangeForSymbol("ABC.XYZ")).toBeNull();
  });

  it("knows NYSE weekends and holidays", async () => {
    expect(await isTradingDay("NYSE", "2026-10-10", noFmp)).toBe(false); // Saturday
    expect(await isTradingDay("NYSE", "2026-04-03", noFmp)).toBe(false); // Good Friday
    expect(await isTradingDay("NYSE", "2026-07-03", noFmp)).toBe(false); // Independence Day observed
    expect(await isTradingDay("NYSE", "2026-11-26", noFmp)).toBe(false); // Thanksgiving
    expect(await isTradingDay("NYSE", "2026-11-27", noFmp)).toBe(true);
    expect(await isTradingDay("LSE", "2026-04-06", noFmp)).toBe(false); // Easter Monday
    expect(await isTradingDay("CRYPTO", "2026-10-10", noFmp)).toBe(true);
  });

  it("checks the session in the exchange's time zone", async () => {
    expect(await isMarketOpen("NYSE", new Date("2026-10-12T14:00:00Z"), noFmp)).toBe(true); // 10:00 New York
    expect(await isMarketOpen("NYSE", new Date("2026-10-12T21:00:00Z"), noFmp)).toBe(false); // 17:00 New York
    expect(await isMarketOpen("NYSE", new Date("2026-10-12T21:00:00Z"), noFmp, { graceAfterMinutes: 90 })).toBe(true);
    expect(await isMarketOpen("FOREX", new Date("2026-10-10T12:00:00Z"), noFmp)).toBe(false); // Saturday
  });

  it("reports anyOpen across held markets", async () => {
    const saturday = new Date("2026-10-10T15:00:00Z");
    expect((await getMarketStatus([{ symbol: "AAPL" }, { symbol: "VOD.L" }], saturday, noFmp)).anyOpen).toBe(false);
    expect((await getMarketStatus([{ symbol: "AAPL" }, { symbol: "BTC-USD", assetType: "Crypto" }], saturday, noFmp)).anyOpen).toBe(true);
    expect((await getMarketStatus([], saturday, noFmp)).anyOpen).toBe(true);
  });
});

describe("relativePerformance", () => {
  it("treats a buy as a cash flow, not a gain", () => {
    const series = relativePerformance(
      [
        { date: "2026-01-02", totalValue: 100, totalCost: 100 },
        { date: "2026-01-03", totalValue: 110, totalCost: 100 },
        { date: "2026-01-04", totalValue: 160, totalCost: 150 },
      ],
      [
        { date: "2026-01-02", close: 50 },
        { date: "2026-01-03", close: 55 },
      ],
    );
    expect(series).toHaveLength(3);
    expect(series[0]).toEqual({ date: "2026-01-02", portfolio: 0, benchmark: 0 });
    expect(series[1]!.portfolio).toBeCloseTo(10, 6);
    expect(series[2]!.portfolio).toBeCloseTo(10, 6);
    expect(series[2]!.benchmark).toBeCloseTo(10, 6); // last close carried forward
  });

  it("starts at the first date with a benchmark close", () => {
    const series = relativePerformance(
      [
        { date: "2026-01-01", totalValue: 100, totalCost: 100 },
        { date: "2026-01-02", totalValue: 105, totalCost: 100 },
      ],
      [{ date: "2026-01-02", close: 10 }],
    );
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-01-02");
  });
});
