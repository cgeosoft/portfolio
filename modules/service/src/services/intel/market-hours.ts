/**
 * Exchange hours and holidays: is a market trading today, is it open now.
 *
 * Sources, in order:
 * - FMP `/all-exchange-market-hours` (time zone and session hours, 24 h cache)
 *   and `/holidays-by-exchange` (closures and early closes, 7 day cache);
 * - the built-in table below: session hours per exchange, weekdays only, the
 *   NYSE/Nasdaq holiday rules and a few fixed European closures.
 *
 * Symbols map to exchanges by their Yahoo-style suffix (`VOD.L` → LSE, no
 * suffix → US), crypto trades every day and FX from Sunday 17:00 to Friday
 * 17:00 New York time.
 *
 * `getHeldMarketStatus()` answers whether any market of the held symbols is
 * open; the GUI skips the automatic quotes refresh when none is. A manual
 * refresh never asks.
 *
 * Nothing here logs a symbol (AGENTS.md rule 3).
 */
import * as portfolioRepo from "../../db/portfolio.repo.js";
import * as txRepo from "../../db/transaction.repo.js";
import { FMP_TTL, FmpService } from "../fmp.js";
import type { PortfolioService } from "../portfolio.js";
import type { ExchangeStatus, MarketStatusResponse } from "portfolio-shared/api-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLIDAY_TTL_MS = 7 * DAY_MS;

/** Minutes around a session the automatic refresh still runs: before the open and after the close (closing prices). */
export const AUTO_SYNC_GRACE = { beforeOpenMinutes: 15, afterCloseMinutes: 45 } as const;

type HolidayRule = "us" | "europe" | "newyear" | null;
type Schedule = "session" | "always" | "forex";

interface ExchangeDef {
  code: string;
  name: string;
  timezone: string;
  /** Local session, "HH:MM". */
  open: string;
  close: string;
  /** FMP exchange code, when FMP covers it. */
  fmp?: string;
  holidays: HolidayRule;
  schedule: Schedule;
}

const EXCHANGES: Record<string, ExchangeDef> = {
  NYSE: { code: "NYSE", name: "NYSE / Nasdaq", timezone: "America/New_York", open: "09:30", close: "16:00", fmp: "NYSE", holidays: "us", schedule: "session" },
  NASDAQ: { code: "NASDAQ", name: "Nasdaq", timezone: "America/New_York", open: "09:30", close: "16:00", fmp: "NASDAQ", holidays: "us", schedule: "session" },
  AMEX: { code: "AMEX", name: "NYSE American", timezone: "America/New_York", open: "09:30", close: "16:00", fmp: "AMEX", holidays: "us", schedule: "session" },
  TSX: { code: "TSX", name: "Toronto Stock Exchange", timezone: "America/Toronto", open: "09:30", close: "16:00", fmp: "TSX", holidays: "newyear", schedule: "session" },
  SAO: { code: "SAO", name: "B3 São Paulo", timezone: "America/Sao_Paulo", open: "10:00", close: "17:00", fmp: "SAO", holidays: "newyear", schedule: "session" },
  LSE: { code: "LSE", name: "London Stock Exchange", timezone: "Europe/London", open: "08:00", close: "16:30", fmp: "LSE", holidays: "europe", schedule: "session" },
  ISE: { code: "ISE", name: "Euronext Dublin", timezone: "Europe/Dublin", open: "08:00", close: "16:30", fmp: "ISE", holidays: "europe", schedule: "session" },
  XETRA: { code: "XETRA", name: "Xetra", timezone: "Europe/Berlin", open: "09:00", close: "17:30", fmp: "XETRA", holidays: "europe", schedule: "session" },
  EURONEXT: { code: "EURONEXT", name: "Euronext", timezone: "Europe/Paris", open: "09:00", close: "17:30", fmp: "EURONEXT", holidays: "europe", schedule: "session" },
  SIX: { code: "SIX", name: "SIX Swiss Exchange", timezone: "Europe/Zurich", open: "09:00", close: "17:30", fmp: "SIX", holidays: "europe", schedule: "session" },
  BME: { code: "BME", name: "Bolsa de Madrid", timezone: "Europe/Madrid", open: "09:00", close: "17:30", fmp: "BME", holidays: "europe", schedule: "session" },
  MIL: { code: "MIL", name: "Borsa Italiana", timezone: "Europe/Rome", open: "09:00", close: "17:30", fmp: "MIL", holidays: "europe", schedule: "session" },
  VIE: { code: "VIE", name: "Wiener Börse", timezone: "Europe/Vienna", open: "09:00", close: "17:30", fmp: "VIE", holidays: "europe", schedule: "session" },
  STO: { code: "STO", name: "Nasdaq Stockholm", timezone: "Europe/Stockholm", open: "09:00", close: "17:30", fmp: "STO", holidays: "europe", schedule: "session" },
  CPH: { code: "CPH", name: "Nasdaq Copenhagen", timezone: "Europe/Copenhagen", open: "09:00", close: "17:00", fmp: "CPH", holidays: "europe", schedule: "session" },
  HEL: { code: "HEL", name: "Nasdaq Helsinki", timezone: "Europe/Helsinki", open: "10:00", close: "18:30", fmp: "HEL", holidays: "europe", schedule: "session" },
  OSL: { code: "OSL", name: "Oslo Børs", timezone: "Europe/Oslo", open: "09:00", close: "16:20", fmp: "OSL", holidays: "europe", schedule: "session" },
  ATHEX: { code: "ATHEX", name: "Athens Stock Exchange", timezone: "Europe/Athens", open: "10:00", close: "17:20", fmp: "ATH", holidays: "newyear", schedule: "session" },
  JPX: { code: "JPX", name: "Tokyo Stock Exchange", timezone: "Asia/Tokyo", open: "09:00", close: "15:30", fmp: "JPX", holidays: "newyear", schedule: "session" },
  HKSE: { code: "HKSE", name: "Hong Kong Stock Exchange", timezone: "Asia/Hong_Kong", open: "09:30", close: "16:00", fmp: "HKSE", holidays: "newyear", schedule: "session" },
  SHH: { code: "SHH", name: "Shanghai Stock Exchange", timezone: "Asia/Shanghai", open: "09:30", close: "15:00", fmp: "SHH", holidays: "newyear", schedule: "session" },
  SHZ: { code: "SHZ", name: "Shenzhen Stock Exchange", timezone: "Asia/Shanghai", open: "09:30", close: "15:00", fmp: "SHZ", holidays: "newyear", schedule: "session" },
  NSE: { code: "NSE", name: "National Stock Exchange of India", timezone: "Asia/Kolkata", open: "09:15", close: "15:30", fmp: "NSE", holidays: null, schedule: "session" },
  BSE: { code: "BSE", name: "Bombay Stock Exchange", timezone: "Asia/Kolkata", open: "09:15", close: "15:30", fmp: "BSE", holidays: null, schedule: "session" },
  KSC: { code: "KSC", name: "Korea Exchange", timezone: "Asia/Seoul", open: "09:00", close: "15:30", fmp: "KSC", holidays: "newyear", schedule: "session" },
  ASX: { code: "ASX", name: "Australian Securities Exchange", timezone: "Australia/Sydney", open: "10:00", close: "16:00", fmp: "ASX", holidays: "newyear", schedule: "session" },
  CRYPTO: { code: "CRYPTO", name: "Crypto", timezone: "UTC", open: "00:00", close: "24:00", holidays: null, schedule: "always" },
  FOREX: { code: "FOREX", name: "Forex", timezone: "America/New_York", open: "17:00", close: "17:00", holidays: null, schedule: "forex" },
};

/** Yahoo symbol suffix → exchange code. */
const SUFFIX_EXCHANGE: Record<string, string> = {
  TO: "TSX", V: "TSX", NE: "TSX", SA: "SAO",
  L: "LSE", IL: "LSE", IR: "ISE",
  DE: "XETRA", F: "XETRA", BE: "XETRA", DU: "XETRA", HM: "XETRA", MU: "XETRA", SG: "XETRA",
  PA: "EURONEXT", AS: "EURONEXT", BR: "EURONEXT", LS: "EURONEXT",
  SW: "SIX", MC: "BME", MI: "MIL", VI: "VIE", ST: "STO", CO: "CPH", HE: "HEL", OL: "OSL", AT: "ATHEX",
  T: "JPX", HK: "HKSE", SS: "SHH", SZ: "SHZ", NS: "NSE", BO: "BSE", KS: "KSC", KQ: "KSC", AX: "ASX",
};

/** Index symbols outside the US. Every other "^" symbol counts as US. */
const INDEX_EXCHANGE: Record<string, string> = {
  "^FTSE": "LSE", "^GDAXI": "XETRA", "^STOXX50E": "XETRA", "^FCHI": "EURONEXT", "^AEX": "EURONEXT",
  "^IBEX": "BME", "^SSMI": "SIX", "^N225": "JPX", "^HSI": "HKSE", "^AXJO": "ASX", "^GSPTSE": "TSX",
};

const CRYPTO_QUOTES = /-(USD|USDT|USDC|EUR|GBP|BTC|ETH|JPY|CAD|AUD|CHF)$/;

/** Every exchange code the built-in table knows. */
export function knownExchanges(): string[] {
  return Object.keys(EXCHANGES);
}

/**
 * The exchange a symbol trades on, from its Yahoo-style form: suffix, index,
 * crypto or FX pair; a plain symbol is a US listing. Null for cash, private
 * holdings and suffixes the table does not know.
 */
export function exchangeForSymbol(symbol: string, assetType?: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (!s || assetType === "Cash") return null;
  if (assetType === "Crypto" || CRYPTO_QUOTES.test(s)) return "CRYPTO";
  if (s.endsWith("=X")) return "FOREX";
  if (s.endsWith("=F")) return "FOREX"; // futures trade close to the FX week
  if (s.startsWith("^")) return INDEX_EXCHANGE[s] ?? "NYSE";
  const dot = s.lastIndexOf(".");
  if (dot > 0) {
    const suffix = s.slice(dot + 1);
    if (SUFFIX_EXCHANGE[suffix]) return SUFFIX_EXCHANGE[suffix]!;
    // Class shares such as "BRK.B" have a one-letter suffix that is no exchange.
    if (suffix.length === 1 && !SUFFIX_EXCHANGE[suffix]) return "NYSE";
    return null;
  }
  return "NYSE";
}

// ── calendar helpers ───────────────────────────────────────────────────────

interface ZonedNow {
  ymd: string;
  /** 0 = Sunday. */
  weekday: number;
  minutes: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function zoned(date: Date, timeZone: string): ZonedNow {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    formatters.set(timeZone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday ?? ""), minutes: hour * 60 + Number(parts.minute) };
}

function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "09:30", "9:30 AM", "04:00 PM -04:00" → minutes after midnight. */
function parseClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(value);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** The n-th (1-based) weekday of a month, or the last one for n = -1. Month 1-12. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return ymdOf(year, month, day);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return ymdOf(year, month, lastDay - ((last - weekday + 7) % 7));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** A fixed-date US holiday moved to Friday (Saturday) or Monday (Sunday). */
function observed(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  const wd = d.getUTCDay();
  if (wd === 6) return month === 1 && day === 1 ? null : shiftDays(d, -1); // NYSE does not close on Dec 31 for a Saturday New Year
  if (wd === 0) return shiftDays(d, 1);
  return ymdOf(year, month, day);
}

const builtinHolidayCache = new Map<string, Set<string>>();

/** Full-day closures of the built-in rules for one year. */
function builtinHolidays(rule: HolidayRule, year: number): Set<string> {
  const key = `${rule}:${year}`;
  const cached = builtinHolidayCache.get(key);
  if (cached) return cached;
  const out = new Set<string>();
  const easter = easterSunday(year);
  if (rule === "us") {
    for (const d of [
      observed(year, 1, 1),
      nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
      nthWeekday(year, 2, 1, 3), // Washington's Birthday
      shiftDays(easter, -2), // Good Friday
      nthWeekday(year, 5, 1, -1), // Memorial Day
      year >= 2022 ? observed(year, 6, 19) : null, // Juneteenth
      observed(year, 7, 4),
      nthWeekday(year, 9, 1, 1), // Labor Day
      nthWeekday(year, 11, 4, 4), // Thanksgiving
      observed(year, 12, 25),
    ]) {
      if (d) out.add(d);
    }
  } else if (rule === "europe") {
    out.add(ymdOf(year, 1, 1));
    out.add(shiftDays(easter, -2)); // Good Friday
    out.add(shiftDays(easter, 1)); // Easter Monday
    out.add(ymdOf(year, 12, 25));
    out.add(ymdOf(year, 12, 26));
  } else if (rule === "newyear") {
    out.add(ymdOf(year, 1, 1));
  }
  builtinHolidayCache.set(key, out);
  return out;
}

// ── FMP data ───────────────────────────────────────────────────────────────

interface FmpExchangeHoursRow {
  exchange: string;
  name?: string;
  openingHour?: string;
  closingHour?: string;
  timezone?: string;
}

interface FmpHolidayRow {
  exchange?: string;
  date: string;
  name?: string;
  isClosed?: boolean;
  adjOpenTime?: string | null;
  adjCloseTime?: string | null;
}

interface HolidayInfo {
  closed: boolean;
  /** Minutes after midnight of an early open or close. */
  open?: number;
  close?: number;
}

let sharedFmp: FmpService | null = null;

/** The FMP client used when a caller passes none. FMP keeps its throttle and cache static, so a second instance shares them. */
function defaultFmp(): FmpService {
  sharedFmp ??= new FmpService();
  return sharedFmp;
}

async function fmpHours(fmp: FmpService): Promise<Map<string, FmpExchangeHoursRow> | null> {
  if (!fmp.isConfigured()) return null;
  const rows = await fmp.get<FmpExchangeHoursRow[]>("/all-exchange-market-hours", {}, FMP_TTL.profile);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = new Map<string, FmpExchangeHoursRow>();
  for (const r of rows) if (r && typeof r.exchange === "string") out.set(r.exchange.toUpperCase(), r);
  return out;
}

/** FMP closures of one exchange and year; null when FMP has none (an exchange always has at least one). */
async function fmpHolidays(fmp: FmpService, fmpCode: string, year: number): Promise<Map<string, HolidayInfo> | null> {
  if (!fmp.isConfigured()) return null;
  const rows = await fmp.get<FmpHolidayRow[]>("/holidays-by-exchange", { exchange: fmpCode, from: `${year}-01-01`, to: `${year}-12-31` }, HOLIDAY_TTL_MS);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = new Map<string, HolidayInfo>();
  for (const r of rows) {
    if (!r || typeof r.date !== "string") continue;
    const open = parseClock(r.adjOpenTime);
    const close = parseClock(r.adjCloseTime);
    out.set(r.date.slice(0, 10), { closed: r.isClosed !== false, open: open ?? undefined, close: close ?? undefined });
  }
  return out;
}

interface ResolvedExchange {
  def: ExchangeDef;
  timezone: string;
  open: number;
  close: number;
  hoursSource: "fmp" | "builtin";
}

async function resolveExchange(code: string, fmp: FmpService): Promise<ResolvedExchange | null> {
  const def = EXCHANGES[code.trim().toUpperCase()];
  if (!def) return null;
  const base: ResolvedExchange = { def, timezone: def.timezone, open: parseClock(def.open) ?? 0, close: def.close === "24:00" ? 24 * 60 : parseClock(def.close) ?? 0, hoursSource: "builtin" };
  if (def.schedule !== "session" || !def.fmp) return base;
  try {
    const row = (await fmpHours(fmp))?.get(def.fmp);
    const open = parseClock(row?.openingHour);
    const close = parseClock(row?.closingHour);
    if (row && open !== null && close !== null && close > open) {
      return { def, timezone: row.timezone || def.timezone, open, close, hoursSource: "fmp" };
    }
  } catch {
    // Built-in hours.
  }
  return base;
}

async function holidayFor(ex: ResolvedExchange, ymd: string, fmp: FmpService): Promise<{ info: HolidayInfo | null; source: "fmp" | "builtin" }> {
  const year = Number(ymd.slice(0, 4));
  if (ex.def.fmp) {
    try {
      const map = await fmpHolidays(fmp, ex.def.fmp, year);
      if (map) return { info: map.get(ymd) ?? null, source: "fmp" };
    } catch {
      // Built-in rules.
    }
  }
  return { info: builtinHolidays(ex.def.holidays, year).has(ymd) ? { closed: true } : null, source: "builtin" };
}

function toYmd(date: Date | string, timezone: string): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return zoned(typeof date === "string" ? new Date(date) : date, timezone).ymd;
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Whether `exchange` trades on `date`: a weekday that is no full-day holiday.
 * A "YYYY-MM-DD" string is that exchange-local date; a Date is converted to
 * the exchange's time zone. Crypto trades every day, FX Monday to Friday.
 * An unknown exchange falls back to the weekday rule.
 */
export async function isTradingDay(exchange: string, date: Date | string = new Date(), fmp: FmpService = defaultFmp()): Promise<boolean> {
  const ex = await resolveExchange(exchange, fmp);
  if (!ex) {
    const wd = weekdayOf(toYmd(date, "UTC"));
    return wd >= 1 && wd <= 5;
  }
  return (await tradingDayInfo(ex, toYmd(date, ex.timezone), fmp)).tradingDay;
}

async function tradingDayInfo(ex: ResolvedExchange, ymd: string, fmp: FmpService): Promise<{ tradingDay: boolean; holiday: HolidayInfo | null; source: "fmp" | "builtin" }> {
  if (ex.def.schedule === "always") return { tradingDay: true, holiday: null, source: "builtin" };
  const wd = weekdayOf(ymd);
  if (wd === 0 || wd === 6) return { tradingDay: false, holiday: null, source: "builtin" };
  if (ex.def.schedule === "forex") return { tradingDay: true, holiday: null, source: "builtin" };
  const { info, source } = await holidayFor(ex, ymd, fmp);
  const fullClose = Boolean(info?.closed) && info?.close === undefined;
  return { tradingDay: !fullClose, holiday: info, source };
}

export interface MarketOpenOptions {
  /** Count the minutes before the open as open. */
  graceBeforeMinutes?: number;
  /** Count the minutes after the close as open. */
  graceAfterMinutes?: number;
}

/** Trading state of one exchange at `now`. Null for an exchange the table does not know. */
export async function getExchangeStatus(exchange: string, now: Date = new Date(), fmp: FmpService = defaultFmp(), options: MarketOpenOptions = {}): Promise<ExchangeStatus | null> {
  const ex = await resolveExchange(exchange, fmp);
  if (!ex) return null;
  const local = zoned(now, ex.timezone);
  const before = Math.max(0, options.graceBeforeMinutes ?? 0);
  const after = Math.max(0, options.graceAfterMinutes ?? 0);

  let tradingDay: boolean;
  let open: boolean;
  let source: "fmp" | "builtin" = ex.hoursSource;

  if (ex.def.schedule === "always") {
    tradingDay = true;
    open = true;
  } else if (ex.def.schedule === "forex") {
    // Sunday 17:00 to Friday 17:00, New York time.
    const fivePm = 17 * 60;
    tradingDay = local.weekday >= 1 && local.weekday <= 5;
    open =
      (local.weekday >= 1 && local.weekday <= 4) ||
      (local.weekday === 5 && local.minutes < fivePm + after) ||
      (local.weekday === 0 && local.minutes >= fivePm - before);
  } else {
    const info = await tradingDayInfo(ex, local.ymd, fmp);
    tradingDay = info.tradingDay;
    if (info.source === "fmp") source = "fmp";
    const openAt = info.holiday?.open ?? ex.open;
    const closeAt = info.holiday?.close ?? ex.close;
    open = tradingDay && local.minutes >= openAt - before && local.minutes < closeAt + after;
  }

  return { exchange: ex.def.code, name: ex.def.name, timezone: ex.timezone, tradingDay, open, source };
}

/** Whether `exchange` is in session at `now` (early closes included). An unknown exchange counts as open on weekdays. */
export async function isMarketOpen(exchange: string, now: Date = new Date(), fmp: FmpService = defaultFmp(), options: MarketOpenOptions = {}): Promise<boolean> {
  const status = await getExchangeStatus(exchange, now, fmp, options);
  if (status) return status.open;
  const wd = now.getUTCDay();
  return wd >= 1 && wd <= 5;
}

/**
 * Trading state of the exchanges of `symbols`. `anyOpen` is true when one is
 * open, or when no symbol maps to a known exchange (nothing to decide on).
 */
export async function getMarketStatus(
  symbols: Array<{ symbol: string; assetType?: string }>,
  now: Date = new Date(),
  fmp: FmpService = defaultFmp(),
  options: MarketOpenOptions = {},
): Promise<MarketStatusResponse> {
  const codes = new Set<string>();
  for (const s of symbols) {
    const code = exchangeForSymbol(s.symbol, s.assetType);
    if (code) codes.add(code === "NASDAQ" || code === "AMEX" ? "NYSE" : code);
  }
  const markets: ExchangeStatus[] = [];
  for (const code of codes) {
    const status = await getExchangeStatus(code, now, fmp, options);
    if (status) markets.push(status);
  }
  markets.sort((a, b) => a.exchange.localeCompare(b.exchange));
  return { now: now.toISOString(), anyOpen: markets.length === 0 || markets.some((m) => m.open), markets };
}

/** Symbols and asset types held across every portfolio (private holdings and cash left out). */
export function heldSymbols(portfolioService: PortfolioService): Array<{ symbol: string; assetType?: string }> {
  const out = new Map<string, { symbol: string; assetType?: string }>();
  for (const portfolio of portfolioRepo.findAll()) {
    const holdings = portfolioService.computeHoldingsFromTransactions(txRepo.findByPortfolio(portfolio.id));
    for (const h of holdings) {
      if (h.isPrivate || h.assetType === "Cash" || !(h.shares > 0)) continue;
      out.set(h.symbol.toUpperCase(), { symbol: h.symbol, assetType: h.assetType });
    }
  }
  return [...out.values()];
}

/**
 * Trading state of the markets of every held symbol, with the automatic sync
 * grace window (`AUTO_SYNC_GRACE`). The GUI skips its timed quotes refresh
 * when `anyOpen` is false; a manual refresh never checks.
 */
export async function getHeldMarketStatus(portfolioService: PortfolioService, now: Date = new Date(), fmp: FmpService = defaultFmp()): Promise<MarketStatusResponse> {
  return getMarketStatus(heldSymbols(portfolioService), now, fmp, {
    graceBeforeMinutes: AUTO_SYNC_GRACE.beforeOpenMinutes,
    graceAfterMinutes: AUTO_SYNC_GRACE.afterCloseMinutes,
  });
}

/** Whether a timed (automatic) refresh is worth running now. */
export async function shouldAutoSync(portfolioService: PortfolioService, now: Date = new Date(), fmp: FmpService = defaultFmp()): Promise<boolean> {
  try {
    return (await getHeldMarketStatus(portfolioService, now, fmp)).anyOpen;
  } catch {
    return true;
  }
}
