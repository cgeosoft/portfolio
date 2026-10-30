/** Market hours across time zones and DST, built-in holiday rules, FMP hours and symbol-to-exchange mapping. */
import { describe, it, expect } from "bun:test";
import { isTradingDay, isMarketOpen, getExchangeStatus, getMarketStatus, exchangeForSymbol, knownExchanges, shouldAutoSync } from "../intel/market-hours";
import type { FmpService } from "../fmp";

const noFmp = { isConfigured: () => false, get: async () => null } as unknown as FmpService;

const open = (ex: string, iso: string, opts?: { graceBeforeMinutes?: number; graceAfterMinutes?: number }) =>
  isMarketOpen(ex, new Date(iso), noFmp, opts);

describe("sessions across time zones and DST", () => {
  it("NYSE in winter (EST)", async () => {
    expect(await open("NYSE", "2026-01-12T14:29:00Z")).toBe(false);
    expect(await open("NYSE", "2026-01-12T14:30:00Z")).toBe(true);
    expect(await open("NYSE", "2026-01-12T20:59:00Z")).toBe(true);
    expect(await open("NYSE", "2026-01-12T21:00:00Z")).toBe(false);
  });

  it("NYSE after the US switch but before the EU switch", async () => {
    expect(await open("NYSE", "2026-03-16T13:29:00Z")).toBe(false);
    expect(await open("NYSE", "2026-03-16T13:30:00Z")).toBe(true);
  });

  it("LSE in summer (BST)", async () => {
    expect(await open("LSE", "2026-07-13T06:59:00Z")).toBe(false);
    expect(await open("LSE", "2026-07-13T07:00:00Z")).toBe(true);
    expect(await open("LSE", "2026-07-13T15:29:00Z")).toBe(true);
    expect(await open("LSE", "2026-07-13T15:30:00Z")).toBe(false);
  });

  it("LSE around the UK switch", async () => {
    expect(await open("LSE", "2026-03-27T07:00:00Z")).toBe(false);
    expect(await open("LSE", "2026-03-30T07:00:00Z")).toBe(true);
    expect(await open("LSE", "2026-03-16T08:00:00Z")).toBe(true);
  });

  it("JPX has no DST", async () => {
    expect(await open("JPX", "2026-10-12T00:00:00Z")).toBe(true);
    expect(await open("JPX", "2026-10-12T06:29:00Z")).toBe(true);
    expect(await open("JPX", "2026-10-12T06:30:00Z")).toBe(false);
  });

  it("ASX in AEDT opens on the previous UTC day", async () => {
    expect(await open("ASX", "2026-10-12T22:59:00Z")).toBe(false);
    expect(await open("ASX", "2026-10-12T23:00:00Z")).toBe(true);
  });

  it("FOREX opens Sunday 17:00 New York and closes Friday 17:00", async () => {
    expect(await open("FOREX", "2026-10-11T20:59:00Z")).toBe(false);
    expect(await open("FOREX", "2026-10-11T21:00:00Z")).toBe(true);
    expect(await open("FOREX", "2026-10-16T20:59:00Z")).toBe(true);
    expect(await open("FOREX", "2026-10-16T21:00:00Z")).toBe(false);
    expect(await open("FOREX", "2026-10-11T20:45:00Z", { graceBeforeMinutes: 15 })).toBe(true);
  });

  it("applies the grace before the NYSE open", async () => {
    expect(await open("NYSE", "2026-01-12T14:15:00Z", { graceBeforeMinutes: 15 })).toBe(true);
    expect(await open("NYSE", "2026-01-12T14:14:00Z", { graceBeforeMinutes: 15 })).toBe(false);
  });

  it("treats an unknown exchange as open on weekdays", async () => {
    expect(await open("UNKNOWN", "2026-10-12T03:00:00Z")).toBe(true);
    expect(await open("UNKNOWN", "2026-10-10T12:00:00Z")).toBe(false);
    expect(await getExchangeStatus("UNKNOWN", new Date("2026-10-12T03:00:00Z"), noFmp)).toBeNull();
  });

  it("converts a Date to the exchange's local day", async () => {
    const instant = new Date("2026-10-11T23:30:00Z");
    expect(await isTradingDay("JPX", instant, noFmp)).toBe(true);
    expect(await isTradingDay("NYSE", instant, noFmp)).toBe(false);
  });
});

describe("built-in holiday rules", () => {
  const day = (ex: string, d: string) => isTradingDay(ex, d, noFmp);

  it("closes NYSE on federal and observed holidays", async () => {
    for (const d of ["2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2027-06-18", "2026-09-07", "2026-12-25", "2022-12-26", "2027-03-26", "2027-12-24"]) {
      expect([d, await day("NYSE", d)]).toEqual([d, false]);
    }
  });

  it("keeps NYSE open where no holiday applies", async () => {
    for (const d of ["2021-12-31", "2027-12-31", "2021-06-18"]) {
      expect([d, await day("NYSE", d)]).toEqual([d, true]);
    }
  });

  it("applies LSE and XETRA rules", async () => {
    expect(await day("LSE", "2027-03-29")).toBe(false);
    expect(await day("LSE", "2025-12-26")).toBe(false);
    expect(await day("XETRA", "2026-12-24")).toBe(true);
  });

  it("applies JPX, NSE, FOREX, CRYPTO and unknown rules", async () => {
    expect(await day("JPX", "2026-01-01")).toBe(false);
    expect(await day("JPX", "2026-01-02")).toBe(true);
    expect(await day("NSE", "2026-01-01")).toBe(true);
    expect(await day("FOREX", "2026-12-25")).toBe(true);
    expect(await day("CRYPTO", "2026-12-25")).toBe(true);
    expect(await day("UNKNOWN", "2026-10-10")).toBe(false);
    expect(await day("UNKNOWN", "2026-10-12")).toBe(true);
  });
});

describe("FMP hours and holidays", () => {
  const fmp = {
    isConfigured: () => true,
    get: async (path: string, params: Record<string, unknown> = {}) => {
      if (path === "/all-exchange-market-hours") {
        return [{ exchange: "NYSE", openingHour: "09:30 AM -05:00", closingHour: "04:00 PM -05:00", timezone: "America/New_York" }];
      }
      if (path === "/holidays-by-exchange") {
        return params.exchange === "NYSE"
          ? [
              { date: "2026-11-27", isClosed: true, adjCloseTime: "1:00 PM" },
              { date: "2026-12-25", isClosed: true },
            ]
          : [];
      }
      return null;
    },
  } as unknown as FmpService;

  it("honours an early close", async () => {
    expect(await getExchangeStatus("NYSE", new Date("2026-11-27T17:59:00Z"), fmp)).toEqual({
      exchange: "NYSE",
      name: "NYSE / Nasdaq",
      timezone: "America/New_York",
      tradingDay: true,
      open: true,
      source: "fmp",
    } as any);
    expect((await getExchangeStatus("NYSE", new Date("2026-11-27T18:00:00Z"), fmp))?.open).toBe(false);
  });

  it("replaces the built-in holidays with the FMP list", async () => {
    expect(await isTradingDay("NYSE", "2026-11-26", fmp)).toBe(true);
    expect(await isTradingDay("NYSE", "2026-12-25", fmp)).toBe(false);
  });

  it("falls back to built-in rules for an exchange FMP does not list", async () => {
    const s = await getExchangeStatus("LSE", new Date("2026-04-06T10:00:00Z"), fmp);
    expect(s).toMatchObject({ tradingDay: false, open: false, source: "builtin" });
  });

  it("falls back to built-in rules when FMP throws", async () => {
    const broken = {
      isConfigured: () => true,
      get: async () => {
        throw new Error("fmp down");
      },
    } as unknown as FmpService;
    const s = await getExchangeStatus("NYSE", new Date("2026-01-12T15:00:00Z"), broken);
    expect(s).toMatchObject({ open: true, source: "builtin" });
  });
});

describe("symbols to exchanges", () => {
  it("maps suffixes, indices, futures and crypto", () => {
    expect(exchangeForSymbol("SHOP.TO")).toBe("TSX");
    expect(exchangeForSymbol("7203.T")).toBe("JPX");
    expect(exchangeForSymbol("^GSPC")).toBe("NYSE");
    expect(exchangeForSymbol("^N225")).toBe("JPX");
    expect(exchangeForSymbol("GC=F")).toBe("FOREX");
    expect(exchangeForSymbol("ETH-EUR")).toBe("CRYPTO");
    expect(exchangeForSymbol("BTC", "Crypto")).toBe("CRYPTO");
    expect(exchangeForSymbol("abc.l")).toBe("LSE");
    expect(exchangeForSymbol("ZZZ.Q")).toBe("NYSE");
    expect(exchangeForSymbol("SAP.XETRA")).toBeNull();
    expect(exchangeForSymbol("")).toBeNull();
  });

  it("knows 28 exchanges", () => {
    const list = knownExchanges() as unknown[];
    const codes = list.map((e) => (typeof e === "string" ? e : (e as { exchange?: string; code?: string }).exchange ?? (e as { code?: string }).code));
    for (const c of ["NYSE", "LSE", "CRYPTO", "FOREX"]) expect(codes).toContain(c);
    expect(list.length).toBe(28);
  });

  it("folds NASDAQ into one NYSE market", async () => {
    const sat = new Date("2026-10-10T12:00:00Z");
    const status = await getMarketStatus([{ symbol: "MSFT" }, { symbol: "QQQ" }] as any, sat, noFmp);
    const exchanges = status.markets.map((m: { exchange: string }) => m.exchange);
    expect(exchanges).toEqual(["NYSE"]);
  });

  it("sorts markets by exchange code", async () => {
    const sat = new Date("2026-10-10T12:00:00Z");
    const status = await getMarketStatus([{ symbol: "VOD.L" }, { symbol: "MSFT" }, { symbol: "7203.T" }] as any, sat, noFmp);
    const exchanges = status.markets.map((m: { exchange: string }) => m.exchange);
    expect(exchanges).toEqual([...exchanges].sort());
  });

  it("shouldAutoSync never blocks a refresh on an error", async () => {
    const svc = {
      ledgerVersion() {
        throw new Error("x");
      },
    } as any;
    expect(await shouldAutoSync(svc, new Date(), noFmp)).toBe(true);
  });
});
