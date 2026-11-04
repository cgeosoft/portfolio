/**
 * The privacy gate of everything the app sends to a model or to another LLM
 * client: percentages, dates, names and public market data may leave the
 * app, money amounts, quantities and balances never do (CLAUDE.md rule 3).
 *
 * Three checks, one per kind of content:
 *
 * - `assertPercentOnly()` for structured data (MCP answers, and the tool
 *   results of the guided analysis): a number may sit only under a key that
 *   is `percent`, ends in `Percent` or is in `ALLOWED_NUMBER_KEYS`. A field
 *   added to a domain type therefore never leaves by accident.
 * - `assertNoLedgerAmounts()` for prompt text built from portfolio data: it
 *   reads every number in the text and refuses the prompt when one equals a
 *   money amount or quantity of the ledger (`ledgerFingerprint()`). Prompt
 *   builders already leave amounts out; this catches the day one does not.
 * - `scanForAmounts()` for free text the user writes and the app sends, such
 *   as a portfolio description: it finds currency amounts so the GUI can ask
 *   for percentages instead.
 *
 * Errors name the place of the problem, never the value.
 */
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";

/** Thrown when content would carry a money amount, a quantity or another non-percentage number. Nothing is sent. */
export class PromptPrivacyError extends Error {
  constructor(path: string) {
    super(`Refused to send a non-percentage number (${path})`);
    this.name = "PromptPrivacyError";
  }
}

// ── structured data ─────────────────────────────────────────────────────────

/** Numbers that are not money: counts, an index from 0 to 100 and day spans. */
const ALLOWED_NUMBER_KEYS = new Set(["rsi", "holdingsCount", "commonHoldings", "days"]);

/**
 * Throws `PromptPrivacyError` when `value` holds a number under a key that is
 * neither `percent`, a `...Percent` key nor in `ALLOWED_NUMBER_KEYS`, or a
 * number in an array. Strings, booleans and null pass.
 */
export function assertPercentOnly(value: unknown, path = "$", key = ""): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" || typeof value === "bigint") {
    if (!/^percent$|Percent$/.test(key) && !ALLOWED_NUMBER_KEYS.has(key)) throw new PromptPrivacyError(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (typeof item === "number") throw new PromptPrivacyError(`${path}[${i}]`);
      assertPercentOnly(item, `${path}[${i}]`, key);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertPercentOnly(v, `${path}.${k}`, k);
  }
}

declare const promptSafeBrand: unique symbol;
/** A value that passed `assertPercentOnly()`. Only `toPromptSafe()` makes one. */
export type PromptSafe<T> = T & { readonly [promptSafeBrand]: true };

/** Checks `value` with `assertPercentOnly()` and marks it safe to send. */
export function toPromptSafe<T>(value: T): PromptSafe<T> {
  assertPercentOnly(value);
  return value as PromptSafe<T>;
}

// ── prompt text against the ledger ──────────────────────────────────────────

/** Money amounts below this are not checked: they are too close to prices, weights and indicator values to tell apart. */
export const MIN_CHECKED_AMOUNT = 100;
/** Quantities are checked from this many significant digits, or as whole numbers from 1,000. */
export const MIN_QUANTITY_DIGITS = 5;

/** The amounts and quantities of one portfolio, in the forms `assertNoLedgerAmounts()` compares. */
export interface LedgerFingerprint {
  /** Money amounts in cents. */
  cents: Set<number>;
  /** Money amounts in tenths, for text that rounds to one decimal ("7,654,321.1"). */
  tenths: Set<number>;
  /** Money amounts of 1,000 or more, rounded and cut to whole units, for text that leaves the cents out. */
  wholes: Set<number>;
  /** Quantities with enough digits to be telling, as written by `String()`. */
  quantities: Set<string>;
}

const HOLDING_AMOUNT_KEYS = ["totalCost", "currentValue", "dayChangeDollar", "totalGainLossDollar"] as const;
const HOLDING_PUBLIC_KEYS = ["currentPrice", "previousClose", "nativePrice", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "sma50", "sma200"] as const;
const SUMMARY_AMOUNT_KEYS = [
  "totalValue",
  "totalCost",
  "totalGainLossDollar",
  "dayGainLossDollar",
  "totalGainSinceStartDollar",
  "totalCashInjected",
  "totalCashWithdrawn",
  "cashBalance",
  "totalPortfolioValue",
  "realizedPnL",
  "totalDividends",
  "totalInterest",
  "totalFees",
  "totalTaxes",
] as const;

const isYear = (n: number) => n >= 1900 && n <= 2100;

function significantDigits(n: number): number {
  return String(Math.abs(n)).replace(/^0\.0*|\./g, "").replace(/e.*$/, "").length;
}

/** Collects the amounts and quantities of `data` that a prompt must never contain. */
export function ledgerFingerprint(data: FinancialPortfolioData): LedgerFingerprint {
  const fp: LedgerFingerprint = { cents: new Set(), tenths: new Set(), wholes: new Set(), quantities: new Set() };
  // A public price can equal a position value (one share): those stay allowed, the price is public anyway.
  const publicCents = new Set<number>();
  for (const h of data.holdings ?? []) {
    for (const key of HOLDING_PUBLIC_KEYS) {
      const v = h[key];
      if (typeof v === "number" && Number.isFinite(v)) publicCents.add(Math.round(Math.abs(v) * 100));
    }
  }

  const addAmount = (v: unknown) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const abs = Math.abs(v);
    if (abs < MIN_CHECKED_AMOUNT) return;
    const cents = Math.round(abs * 100);
    if (publicCents.has(cents)) return;
    fp.cents.add(cents);
    fp.tenths.add(Math.round(abs * 10));
    if (abs >= 1000) {
      for (const whole of [Math.round(abs), Math.floor(abs)]) if (!isYear(whole)) fp.wholes.add(whole);
    }
  };
  const addQuantity = (v: unknown) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return;
    const abs = Math.abs(v);
    if (Number.isInteger(abs) ? abs >= 1000 && !isYear(abs) : significantDigits(abs) >= MIN_QUANTITY_DIGITS) fp.quantities.add(String(abs));
  };

  const summary = data.summary as unknown as Record<string, unknown> | undefined;
  if (summary) for (const key of SUMMARY_AMOUNT_KEYS) addAmount(summary[key]);
  for (const h of data.holdings ?? []) {
    for (const key of HOLDING_AMOUNT_KEYS) addAmount(h[key]);
    if (h.assetType === "Cash") addAmount(h.shares);
    else addQuantity(h.shares);
  }
  for (const tx of data.transactions ?? []) {
    addAmount(tx.amount);
    addAmount(tx.fee);
    addAmount(tx.tax);
    addQuantity(tx.shares);
  }
  const last = data.chartHistory?.[data.chartHistory.length - 1];
  if (last) {
    addAmount(last.totalValue);
    addAmount(last.totalCost);
    addAmount(last.totalGainLoss);
    addAmount(last.cashBalance);
    addAmount(last.totalPortfolioValue);
  }
  return fp;
}

/** Numbers as people and models write them: 12345.67, 12,345.67, 12.345,67, 12 345, 12'345, 12’345, 1,23,456 (Indian grouping). */
const NUMBER_TOKEN = /\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?|\d{1,3}(?:[,.'\u2019\u02bc\u00a0\u202f\u2009 ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

/** Other digit scripts and the Arabic separators, as ASCII digits and marks, so "٧٬٦٥٤٬٣٢١٫٠٩" reads as 7,654,321.09. */
function asciiDigits(text: string): string {
  return text
    .replace(/\p{Nd}/gu, (d) => {
      if (d >= "0" && d <= "9") return d;
      // Unicode lays out every decimal digit script as runs of ten code points from zero.
      const code = d.codePointAt(0)!;
      let start = code;
      while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
      return String((code - start) % 10);
    })
    .replace(/\u066c/g, ",")
    .replace(/\u066b/g, ".");
}

/** The readings of one number token: with "," or "." as the decimal mark, as the separators allow. */
export function readNumberToken(token: string): { value: number; decimals: number; text: string }[] {
  const out: { value: number; decimals: number; text: string }[] = [];
  const push = (text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const decimals = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
    if (!out.some((o) => o.text === text)) out.push({ value, decimals, text });
  };
  const plain = token.replace(/['\u2019\u02bc\u00a0\u202f\u2009 ]/g, "");
  // "." decimal with "," thousands (12,345.67), and "," decimal with "." thousands (12.345,67).
  // A thousands mark is always followed by three digits, so "80.00" is never read as 8000.
  if (/^\d+(?:\.\d+)?$|^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?$/.test(plain)) push(plain.replace(/,/g, ""));
  if (/^\d+(?:,\d+)?$|^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(plain)) push(plain.replace(/\./g, "").replace(",", "."));
  return out;
}

/** True when `text` holds a number that equals an amount or quantity of the fingerprint. */
export function containsLedgerAmount(text: string, fp: LedgerFingerprint): boolean {
  if (fp.cents.size === 0 && fp.wholes.size === 0 && fp.quantities.size === 0) return false;
  for (const match of asciiDigits(text).matchAll(NUMBER_TOKEN)) {
    for (const reading of readNumberToken(match[0])) {
      if (reading.decimals === 0 ? fp.wholes.has(reading.value) : fp.cents.has(Math.round(reading.value * 100))) return true;
      if (reading.decimals === 1 && fp.tenths.has(Math.round(reading.value * 10))) return true;
      if (fp.quantities.has(String(reading.value))) return true;
    }
  }
  return false;
}

/**
 * Throws `PromptPrivacyError` when a message holds a money amount or
 * quantity of `data`. `label` names the prompt in the error, for the log.
 */
export function assertNoLedgerAmounts(messages: readonly { role: string; content: string }[] | string, data: FinancialPortfolioData, label = "prompt"): void {
  const fp = ledgerFingerprint(data);
  const list = typeof messages === "string" ? [{ role: "user", content: messages }] : messages;
  list.forEach((m, i) => {
    if (containsLedgerAmount(m.content, fp)) throw new PromptPrivacyError(`${label}, message ${i + 1} (${m.role})`);
  });
}

// ── free text the user writes ───────────────────────────────────────────────

const CURRENCY_WORD = "(?:eur|euros?|usd|dollars?|gbp|pounds?|chf|francs?|jpy|yen|cad|aud|nzd|sek|nok|dkk|pln|czk|huf|ron|bgn|try|inr|cny|hkd|sgd|bucks)";
const AMOUNT_PATTERNS: RegExp[] = [
  // €50,000 · $ 2.3M · £10k
  /[€$£¥₹₩₽₺]\s?\d[\d.,'\s]*(?:\s?(?:k|m|mn|bn|million|billion|thousand)\b)?/gi,
  // 50,000 € · 10k EUR · 2.5 million dollars
  new RegExp(`\\b\\d[\\d.,']*\\s?(?:k|m|mn|bn|million|billion|thousand)?\\s?(?:[€$£¥₹₩₽₺]|${CURRENCY_WORD}\\b)`, "gi"),
  // 80k, 1.5M, 2 million (no currency named, still an amount)
  /\b\d+(?:[.,]\d+)?\s?(?:k|mn|bn|million|billion|thousand)\b/gi,
];

/** One amount found in free text: what it says and where, so the GUI can mark it. */
export interface AmountMatch {
  text: string;
  index: number;
}

/**
 * Money amounts in free text, such as "I hold 80k in ETFs" or "€500 a
 * month". Percentages, years and plain small numbers ("5 years", "3 ETFs")
 * pass. Overlapping matches are merged.
 */
export function scanForAmounts(text: string): AmountMatch[] {
  const found: AmountMatch[] = [];
  for (const pattern of AMOUNT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const raw = m[0].trim();
      if (!/\d/.test(raw)) continue;
      // "5 years" or "20 EUR ETFs" are words after a number only when the word is a currency: checked by the pattern.
      const start = m.index ?? 0;
      if (found.some((f) => start < f.index + f.text.length && f.index < start + raw.length)) continue;
      found.push({ text: raw, index: start });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}
