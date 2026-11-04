/**
 * Privacy gate for everything the app sends to a language model or an MCP
 * client. No money amount, quantity or balance leaves the app, and code
 * enforces it, not prompt convention:
 *
 * - `assertPercentOnly()` checks structured values: a number may sit only
 *   under a `percent` or `...Percent` key or a key in `ALLOWED_NUMBER_KEYS`.
 * - `rememberPrivateValues()` records the amounts, quantities and private
 *   prices of every portfolio the service builds; `redactPrivateAmounts()`
 *   removes them from prompt text.
 * - `toPromptSafe()` runs both checks and is the only source of the
 *   `PromptSafe` type, which is all `LlmMessage` accepts.
 * - `assertNoLedgerAmounts()` reads every number in a prompt built from one
 *   portfolio and refuses it when one equals an amount or quantity of that
 *   ledger (`ledgerFingerprint()`). It reads more number formats than the
 *   redaction and stops the send instead of editing the text.
 * - `scanForAmounts()` finds amounts in the user's own free text, such as the
 *   portfolio brief, so the GUI can ask for percentages before saving.
 */

import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import { appLogger } from "../logger";

declare const promptSafe: unique symbol;

/** Prompt content that passed `toPromptSafe()`. `LlmMessage` accepts nothing else. */
export type PromptSafe = string & { readonly [promptSafe]: true };

/**
 * Numbers that are not portfolio money: counts, an index from 0 to 100, day
 * spans, public instrument data, and the unitless ratios and scales of the
 * Guided Analysis graph (beta, correlation, effective number of holdings,
 * the 1 to 5 risk score of the brief (`riskScore`), the 1 to 3 severity of a finding).
 */
export const ALLOWED_NUMBER_KEYS: ReadonlySet<string> = new Set([
  "rsi",
  "holdingsCount",
  "commonHoldings",
  "days",
  "publicPrice",
  "peRatio",
  "dividendPerShare",
  "beta",
  "correlation",
  "effectiveHoldings",
  "riskScore",
  "severity",
  "count",
]);

const isAllowedNumberKey = (key: string) => /^percent$|Percent$/.test(key) || ALLOWED_NUMBER_KEYS.has(key);

/** Thrown when a value would carry a number that is not a percentage. */
export class PrivacyError extends Error {
  constructor(path: string) {
    super(`Refused to send a non-percentage number (${path})`);
    this.name = "PrivacyError";
  }
}

/** The names the MCP server and the prompt checks use. */
export { PrivacyError as McpPrivacyError, PrivacyError as PromptPrivacyError };

/**
 * Throws `PrivacyError` when `value` holds a number under a key that is
 * neither `percent`, a `...Percent` key nor in `ALLOWED_NUMBER_KEYS`, or a
 * number in an array. Strings, booleans and null pass.
 */
export function assertPercentOnly(value: unknown, path = "$", key = ""): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" || typeof value === "bigint") {
    if (!isAllowedNumberKey(key)) throw new PrivacyError(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (typeof item === "number" || typeof item === "bigint") throw new PrivacyError(`${path}[${i}]`);
      assertPercentOnly(item, `${path}[${i}]`, key);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertPercentOnly(v, `${path}.${k}`, k);
  }
}

// ── private values in prompt text ───────────────────────────────────────────

/**
 * Smallest values the text check looks for. Whole numbers under 1,000 and
 * values under 100 match too much unrelated prompt text (word limits, RSI
 * readings, years, counts), so the percent-only prompt builders and the
 * canary test cover those. From 10,000 a value also counts when rounded to
 * a whole number.
 */
const MIN_CENTS_VALUE = 100;
const MIN_WHOLE_VALUE = 1_000;
const MIN_ROUNDED_VALUE = 10_000;

/** Holding fields with public market data whenever they are set. */
const MARKET_FIELDS = new Set(["fxRate", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "sma50", "sma200"]);
/** Holding price fields: public with a live quote, private when they come from a manual price, the buy price or a private asset. */
const QUOTE_FIELDS = new Set(["currentPrice", "previousClose", "nativePrice"]);

/** Private values of one built portfolio as prompt text could show them: `1234.56` and, for large ones, `1235`. */
interface PrivateForms {
  source: FinancialPortfolioData;
  cents: Set<string>;
  whole: Set<string>;
}

/** Keyed by portfolio and currency; a rebuild replaces its entry. */
const privateForms = new Map<string, PrivateForms>();

const centsOf = (n: number) => Math.abs(n).toFixed(2);

/**
 * Records the amounts, quantities and private prices of a built portfolio so
 * `redactPrivateAmounts()` can find them in prompt text. Every number counts
 * except percentages, the allowed keys and public market data, so a field
 * added later is private by default. The value history is left out: no
 * prompt uses it, and its latest point equals the summary.
 */
export function rememberPrivateValues(key: string, data: FinancialPortfolioData): void {
  if (privateForms.get(key)?.source === data) return; // a cache hit returns the same object
  const privateNumbers: number[] = [];
  const publicCents = new Set<string>();
  const collect = (record: object, isPublic: (field: string) => boolean = () => false) => {
    for (const [field, value] of Object.entries(record)) {
      if (typeof value !== "number" || !Number.isFinite(value) || isAllowedNumberKey(field)) continue;
      if (isPublic(field)) publicCents.add(centsOf(value));
      else privateNumbers.push(value);
    }
  };

  collect(data.summary ?? {});
  for (const h of data.holdings ?? []) {
    const quoted = !h.isPrivate && !h.quoteMissing && !h.manualPrice;
    collect(h, (field) => MARKET_FIELDS.has(field) || (quoted && QUOTE_FIELDS.has(field)));
    if (h.manualPrice) privateNumbers.push(h.manualPrice.price);
  }
  for (const tx of data.transactions ?? []) collect(tx);

  const forms: PrivateForms = { source: data, cents: new Set(), whole: new Set() };
  for (const n of privateNumbers) {
    const abs = Math.abs(n);
    const cents = centsOf(abs);
    // A value equal to a public price says nothing about the portfolio.
    if (publicCents.has(cents)) continue;
    if (abs >= MIN_WHOLE_VALUE || (abs >= MIN_CENTS_VALUE && !cents.endsWith(".00"))) forms.cents.add(cents);
    if (abs >= MIN_ROUNDED_VALUE) forms.whole.add(String(Math.round(abs)));
  }
  privateForms.set(key, forms);
}

/** Forgets every recorded portfolio. For tests. */
export function forgetPrivateValues(): void {
  privateForms.clear();
}

/** What replaces a private value in prompt text. */
export const REDACTED_AMOUNT = "[amount removed]";

/** A number as text may show it: digits with `,` or `.` as thousands or decimal separators. */
const NUMBER_TOKEN = /\d[\d.,]*/g;

/** The values `token` can stand for: `1,234.56` (English) and `1.234,56` (European). */
function readingsOf(token: string): number[] {
  const english = Number(token.replace(/,/g, ""));
  const european = Number(token.replace(/\./g, "").replace(",", "."));
  return [english, european].filter((n) => Number.isFinite(n));
}

function isPrivateNumber(token: string): boolean {
  for (const n of readingsOf(token)) {
    const cents = n.toFixed(2);
    const whole = String(Math.round(n));
    for (const forms of privateForms.values()) {
      if (forms.cents.has(cents) || forms.whole.has(whole)) return true;
    }
  }
  return false;
}

/**
 * Replaces every amount, quantity and private price of the recorded
 * portfolios in `text` with `REDACTED_AMOUNT`. Numbers followed by `%` stay.
 */
export function redactPrivateAmounts(text: string): { text: string; removed: number } {
  if (privateForms.size === 0) return { text, removed: 0 };
  let removed = 0;
  const out = text.replace(NUMBER_TOKEN, (raw: string, offset: number) => {
    const token = raw.replace(/[.,]+$/, ""); // a full stop or comma after the number is punctuation
    const end = offset + token.length;
    if (/^\s?%/.test(text.slice(end, end + 2)) || !isPrivateNumber(token)) return raw;
    removed++;
    return REDACTED_AMOUNT + raw.slice(token.length);
  });
  return { text: out, removed };
}

/**
 * The only way to make `PromptSafe` content. Text loses every amount,
 * quantity and private price of the portfolios this service has built. A
 * structured value must pass `assertPercentOnly()` and becomes JSON with its
 * strings cleaned the same way. A removal is logged with its count only.
 */
export function toPromptSafe(value: string | object): PromptSafe {
  let removed = 0;
  const clean = (text: string) => {
    const result = redactPrivateAmounts(text);
    removed += result.removed;
    return result.text;
  };
  let safe: string;
  if (typeof value === "string") {
    safe = clean(value);
  } else {
    assertPercentOnly(value);
    safe = JSON.stringify(value, (_key, v: unknown) => (typeof v === "string" ? clean(v) : v));
  }
  if (removed > 0) appLogger.logStep("warning", "privacy", "prompt_redacted", `Removed ${removed} portfolio amount(s) from a prompt`);
  return safe as PromptSafe;
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
const LEDGER_NUMBER_TOKEN = /\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?|\d{1,3}(?:[,.'\u2019\u02bc\u00a0\u202f\u2009 ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

/** Other digit scripts and the Arabic separators, as ASCII digits and marks, so "٧٬٦٥٤٬٣٢١٫٠٩" reads as 7,654,321.09. */
export function ledgerDigits(text: string): string {
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
  for (const match of ledgerDigits(text).matchAll(LEDGER_NUMBER_TOKEN)) {
    for (const reading of readNumberToken(match[0])) {
      if (reading.decimals === 0 ? fp.wholes.has(reading.value) : fp.cents.has(Math.round(reading.value * 100))) return true;
      if (reading.decimals === 1 && fp.tenths.has(Math.round(reading.value * 10))) return true;
      if (fp.quantities.has(String(reading.value))) return true;
    }
  }
  return false;
}

/**
 * Throws `PrivacyError` when a message holds a money amount or
 * quantity of `data`. `label` names the prompt in the error, for the log.
 */
export function assertNoLedgerAmounts(messages: readonly { role: string; content: string }[] | string, data: FinancialPortfolioData, label = "prompt"): void {
  const fp = ledgerFingerprint(data);
  const list = typeof messages === "string" ? [{ role: "user", content: messages }] : messages;
  list.forEach((m, i) => {
    if (containsLedgerAmount(m.content, fp)) throw new PrivacyError(`${label}, message ${i + 1} (${m.role})`);
  });
}

// ── amounts in the user's own text ──────────────────────────────────────────

export interface AmountScanResult {
  hasAmounts: boolean;
  matches: string[];
}

const SYMBOLS = "$€£¥₹₽₩₪₺₫₱฿₴₦₸₼₾₡₲₵円元圆원";
const CODES = "usd|eur|gbp|chf|jpy|cny|rmb|cad|aud|nzd|sek|nok|dkk|isk|pln|czk|huf|ron|bgn|rsd|try|uah|rub|inr|idr|krw|thb|vnd|php|ils|aed|sar|irr|bdt|ngn|kes|tzs|zar|brl|mxn|hkd|sgd";

/** Currency names and words for thousand, million and billion in the interface languages. */
const UNIT_WORDS = [
  // currency names
  "dollars?", "euros?", "pounds?", "bucks", "francs?", "franken", "yen", "yuan", "rupees?", "rupiah", "baht", "đồng", "naira", "shilingi", "riyals?", "dinars?", "dirhams?",
  "ευρώ", "δολάρια", "евро", "долларов", "долара", "рублей", "гривень", "гривні", "лева", "динара",
  "złotych", "zł", "kč", "korun", "forint", "lei", "kr", "kronor", "kroner", "krónur", "lira", "lire", "reais", "pesos", "rand",
  "ريال", "درهم", "ریال", "تومان", "שקל", "שקלים", "रुपये", "रुपए", "টাকা",
  // thousand, million, billion and their short forms
  "k", "m", "b", "mn", "mm", "bn", "thousands?", "millions?", "billions?", "grand", "lakhs?", "crores?",
  "tsd", "tausend", "mio", "millionen", "mrd", "milliarden?", "mille", "milliers", "milliards?", "md", "mds",
  "mil", "millones", "millón", "milhões", "milhão", "bilhões", "mila", "milioni", "miliardi", "mln", "mld", "mlrd", "mia",
  "duizend", "miljoen", "miljard", "tusind", "tusen", "millioner", "milliarder", "tuhatta", "miljoonaa", "miljardia", "milj",
  "tys", "tysięcy", "tysiące", "miliony", "milionów", "miliardów", "tis", "tisíc", "milionů", "miliónov", "tisoč", "milijonov", "tisuća", "milijuna", "milijardi",
  "ezer", "millió", "milliárd", "mii", "milioane", "miliarde", "tuhat", "tūkst", "tūkstančių", "milijonų", "tūkstoši", "miljoni", "miljardi",
  "хиляди", "хил", "милиона", "милиарда", "тысяч", "тысячи", "тыс", "миллионов", "миллиона", "млн", "млрд", "тисяч", "тис", "мільйонів", "хиљада",
  "χιλιάδες", "χιλιάδων", "χιλ", "εκατομμύρια", "εκατομμυρίων", "εκατ", "δισεκατομμύρια", "δισ",
  "bin", "milyon", "milyar", "ribu", "rb", "juta", "jt", "miliar", "nghìn", "ngàn", "triệu", "tỷ", "tỉ", "libo", "milyong", "elfu",
  "ألف", "آلاف", "مليون", "مليار", "هزار", "میلیون", "میلیارد", "אלף", "אלפים", "מיליון", "מיליארד",
  "हज़ार", "हजार", "लाख", "करोड़", "হাজার", "লাখ", "কোটি",
];
/** Scale characters that follow a number with no space or word break. */
const SCALE_CHARS = "千万萬億亿천만억";

/** A number with optional thousands groups (`120,000`, `1.234.567`, `15 000`) and decimals. */
const AMOUNT_NUMBER = /(?<![\d.,])(\d{1,3}(?:[.,\u00a0\u202f ]\d{3}(?!\d))+|\d+)(?:[.,]\d+)?/g;
const CURRENCY_BEFORE = new RegExp(`(?:[${SYMBOLS}]|(?<!\\p{L})(?:${CODES}))\\s*$`, "iu");
const UNIT_AFTER = new RegExp(`^\\s*(?:[${SYMBOLS}${SCALE_CHARS}]|(?:${CODES}|${UNIT_WORDS.join("|")})(?![\\p{L}\\p{N}]))`, "iu");
const PERCENT_AFTER = /^\s*(?:%|٪|‰|percent|per cent|pct\b|bps?\b)/i;
/** US retirement accounts such as a 401(k), named like an amount. */
const RETIREMENT_PLAN_AFTER = /^\(?[kb]\)?(?![\p{L}\p{N}])/iu;
const RETIREMENT_PLANS = new Set([401, 403, 457]);

/** Arabic-Indic, Persian, Devanagari, Bengali, Thai and full-width digits as ASCII; the length stays the same. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0e50, 0xff10];
function asciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u09e6-\u09ef\u0e50-\u0e59\uff10-\uff19]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code - DIGIT_ZEROS.find((zero) => code >= zero && code <= zero + 9)!);
  });
}

/**
 * Finds amounts in the user's own free text (portfolio brief, wizard
 * answers) before it is saved, so the GUI can ask for percentages instead.
 * A number counts as an amount when a currency or a word such as `k`,
 * `million` or `χιλιάδες` stands next to it, or when it is 1,000 or more and
 * not a year. Percentages, identifiers such as `SMA200` and a `401(k)` pass.
 */
export function scanForAmounts(text: string): AmountScanResult {
  if (typeof text !== "string" || !text) return { hasAmounts: false, matches: [] };
  const plain = asciiDigits(text);
  const matches = new Set<string>();
  for (const m of plain.matchAll(AMOUNT_NUMBER)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = plain.slice(Math.max(0, start - 8), start);
    const after = plain.slice(end, end + 40);
    if (PERCENT_AFTER.test(after)) continue;
    const whole = Number(m[1]!.replace(/\D/g, ""));
    if (RETIREMENT_PLANS.has(whole) && RETIREMENT_PLAN_AFTER.test(after)) continue;
    const currency = CURRENCY_BEFORE.exec(before);
    if (!currency && /[A-Za-z]$/.test(before)) continue; // part of a name such as SMA200 or Q3
    const unit = UNIT_AFTER.exec(after);
    const isYear = /^\d{4}$/.test(m[0]) && whole >= 1900 && whole <= 2199;
    if (currency || unit || (whole >= 1000 && !isYear)) {
      matches.add(text.slice(start - (currency?.[0].length ?? 0), end + (unit?.[0].length ?? 0)).trim());
    }
  }
  const list = [...matches];
  return { hasAmounts: list.length > 0, matches: list };
}
