/**
 * Broker export parsing for the CSV import page: read the file, recognise the
 * broker, map the columns and turn every row into a transaction. Pure
 * functions only, so the formats are tested without the page.
 *
 * The formats come from the brokers' current exports (late 2026): Trade
 * Republic, Trading 212, Interactive Brokers (activity statement and Flex
 * queries), DEGIRO (transactions and account statement), eToro, Revolut,
 * XTB, Scalable Capital and Saxo. Each template maps the columns and, where a
 * column mapping is not enough, adjusts the row (an XTB comment holds the
 * shares, a DEGIRO export has no type column, and so on).
 */
import type { PortfolioTransaction } from "portfolio-shared/portfolio";

/** Shape of an ISIN. The service checks the check digit and looks up the ticker on import. */
export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export type SystemFieldKey =
  | "none"
  | "transaction_id"
  | "date"
  | "datetime"
  | "type"
  | "status"
  | "symbol"
  | "isin"
  | "name"
  | "asset_class"
  | "category"
  | "shares"
  | "price"
  | "amount"
  | "fee"
  | "tax"
  | "currency";

export interface SystemFieldDef {
  key: SystemFieldKey;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const SYSTEM_FIELDS: SystemFieldDef[] = [
  {
    key: "none",
    label: "(Ignore / Skip Column)",
    aliases: [],
  },
  {
    key: "transaction_id",
    label: "Transaction ID / Ref",
    aliases: [
      "transaction_id",
      "transactionid",
      "tx_id",
      "txid",
      "order_id",
      "orderid",
      "external_id",
      "externalid",
      "id",
      "reference",
      "referenz",
      "auftragsnummer",
    ],
  },
  {
    key: "datetime",
    label: "Date & Time (ISO / Timestamp)",
    aliases: [
      "datetime",
      "date_time",
      "timestamp",
      "timestamp_utc",
      "date_and_time",
      "time",
      "time (utc)",
      "uhrzeit",
      "tijd",
      "ώρα",
    ],
  },
  {
    key: "date",
    label: "Date (YYYY-MM-DD)",
    required: true,
    aliases: [
      "date",
      "trade_date",
      "execution_date",
      "booking_date",
      "settlement_date",
      "datum",
      "valutadatum",
      "ημερομηνία",
    ],
  },
  {
    key: "type",
    label: "Transaction Type (BUY/SELL/...)",
    required: true,
    aliases: [
      "type",
      "transaction_type",
      "action",
      "order_type",
      "operation",
      "side",
      "direction",
      "typ",
      "transaktionsart",
      "τύπος",
    ],
  },
  {
    key: "status",
    label: "Status (only executed rows import)",
    aliases: ["status", "order_status", "state"],
  },
  {
    key: "symbol",
    label: "Symbol / Ticker / ISIN",
    required: true,
    aliases: [
      "symbol",
      "ticker",
      "instrument",
      "asset",
      "code",
      "asset_id",
      "security",
      "wertpapiersymbol",
      "σύμβολο",
    ],
  },
  {
    key: "isin",
    label: "ISIN Code",
    aliases: [
      "isin",
      "isin_code",
      "security_id",
      "sec_id",
      "wkn",
    ],
  },
  {
    key: "name",
    label: "Asset / Security Name",
    aliases: [
      "name",
      "security_name",
      "asset_name",
      "title",
      "product",
      "bezeichnung",
      "name des wertpapiers",
      "προϊόν",
    ],
  },
  {
    key: "asset_class",
    label: "Asset Class (Stock/Fund/Crypto)",
    aliases: [
      "asset_class",
      "assetclass",
      "security_type",
      "asset_type",
      "instrument_type",
      "gattung",
    ],
  },
  {
    key: "category",
    label: "Category / Sector",
    aliases: [
      "category",
      "sector",
      "group",
      "fund_category",
      "kategorie",
    ],
  },
  {
    key: "shares",
    label: "Shares / Quantity",
    aliases: [
      "shares",
      "quantity",
      "qty",
      "units",
      "amount_shares",
      "count",
      "number_of_shares",
      "no. of shares",
      "volume",
      "stueck",
      "anteile",
      "nominal",
      "aantal",
      "anzahl",
      "ποσότητα",
    ],
  },
  {
    key: "price",
    label: "Unit Price",
    aliases: [
      "price",
      "unit_price",
      "share_price",
      "price / share",
      "price per share",
      "rate",
      "cost_per_share",
      "execution_price",
      "exec_price",
      "kurs",
      "koers",
      "ausfuehrungskurs",
      "τιμή",
    ],
  },
  {
    key: "amount",
    label: "Total Amount / Net Value",
    aliases: [
      "amount",
      "total",
      "total_amount",
      "total (eur)",
      "total (usd)",
      "total (gbp)",
      "net_amount",
      "gross_amount",
      "value",
      "settlement_amount",
      "cost",
      "betrag",
      "gesamtbetrag",
      "ποσό",
    ],
  },
  {
    key: "fee",
    label: "Fee / Commission",
    aliases: [
      "fee",
      "fees",
      "charge amount (eur)",
      "commission",
      "commissions",
      "brokerage",
      "charges",
      "transaction_fee",
      "order_fee",
      "gebuehren",
      "spesen",
      "προμήθεια",
    ],
  },
  {
    key: "tax",
    label: "Tax / Withholding",
    aliases: [
      "tax",
      "taxes",
      "withholding tax (eur)",
      "withholding_tax",
      "vat",
      "steuern",
      "kapitalertragsteuer",
      "φόρος",
    ],
  },
  {
    key: "currency",
    label: "Currency (EUR, USD, ...)",
    aliases: [
      "currency",
      "currency (price / share)",
      "currency (total)",
      "curr",
      "ccy",
      "currency_code",
      "iso_currency",
      "waehrung",
      "νόμισμα",
    ],
  },
];

/** A parsed file: one header row and the data rows under it, every row as long as the header. */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** A transaction while it is built from a row. Templates adjust it before it is checked. */
export interface DraftTransaction {
  date: string;
  datetime?: string | undefined;
  /** Normalised type (BUY, SELL, DIVIDEND, ...). */
  type: string;
  /** The type text as exported, for rules that need more than the normalised type. */
  rawType: string;
  symbol: string;
  isin?: string | undefined;
  name?: string | undefined;
  assetClass?: string | undefined;
  shares?: number | undefined;
  price?: number | undefined;
  amount?: number | undefined;
  fee?: number | undefined;
  tax?: number | undefined;
  /** Currency of the amount, fee and tax. */
  currency: string;
  /** Currency the instrument trades in, when the export says so and it differs from `currency`. */
  listingCurrency?: string | undefined;
}

/**
 * Reads cells of the current row by header name. Names are normalised
 * (`normalizeHeader`); a name ending in `*` matches any header that starts with it.
 * Returns the first non-empty cell among the names.
 */
export type RowReader = (...names: string[]) => string;

export interface CsvTemplate {
  id: string;
  name: string;
  badge?: string;
  description: string;
  defaultCurrency?: string;
  /** Normalised headers. The template with the most present (two at least) is picked. */
  signatureHeaders: string[];
  /** Normalised headers that must all be present for the template to be picked. */
  requiredHeaders?: string[];
  /**
   * Normalised header (or a prefix ending in `*`) to field. Earlier entries
   * win when two headers map to the same field.
   */
  mappings: Record<string, SystemFieldKey>;
  /** The decimal separator the broker always uses. Without it each number is guessed. */
  decimal?: "." | ",";
  /** The template finds the type itself, so no Type column is needed. */
  infersType?: boolean;
  /** Called once per file, before the rows; its result reaches `adjust`. */
  prepare?: (table: CsvTable, column: (name: string) => number) => unknown;
  /** Broker rules the column mapping cannot express. Returns a reason to leave the row out. */
  adjust?: (tx: DraftTransaction, read: RowReader, context: unknown) => string | void;
}

/** Lower case, German umlauts spelled out, accents dropped, then letters and digits only. */
export function normalizeHeader(str: string): string {
  return str
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9α-ω]/g, "");
}

function headerMatches(normalized: string, key: string): boolean {
  return key.endsWith("*") ? normalized.startsWith(key.slice(0, -1)) : normalized === key;
}

// ── Numbers and dates ───────────────────────────────────────────────────────

/**
 * Parse a broker number: "1.234,56", "1,234.56", "USD 12.30", "-$30.93",
 * "(6.97)", "1 757,95", "1'234.50". `decimal` fixes the separator when the
 * broker always uses one; otherwise a lone comma is a decimal comma.
 */
export function parseNumber(val: string | undefined, decimal?: "." | ","): number | undefined {
  if (!val) return undefined;
  let str = val.trim();
  if (!str) return undefined;
  if (/^[-+]?\d+(\.\d+)?e[-+]?\d+$/i.test(str)) return Number(str);

  let negative = false;
  const paren = /^\((.*)\)$/.exec(str);
  if (paren) {
    negative = true;
    str = paren[1]!;
  }
  // A minus anywhere: "-12.30", "USD -12.30", "-$12.30", "12.30-".
  if (/[-−–]/.test(str)) negative = true;
  str = str.replace(/[^\d.,]/g, "");
  if (!/\d/.test(str)) return undefined;

  const commas = (str.match(/,/g) || []).length;
  const dots = (str.match(/\./g) || []).length;
  if (decimal === ".") {
    str = str.replace(/,/g, "");
  } else if (decimal === ",") {
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (commas > 0 && dots > 0) {
    str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  } else if (commas > 1) {
    str = str.replace(/,/g, "");
  } else if (commas === 1) {
    str = str.replace(",", ".");
  } else if (dots > 1) {
    str = str.replace(/\./g, "");
  }

  const parsed = parseFloat(str);
  if (isNaN(parsed)) return undefined;
  return negative ? -parsed : parsed;
}

/** Month abbreviations in English, Dutch, German, French, Spanish and Italian. */
const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, gen: 1, feb: 2, fev: 2, mar: 3, mrt: 3, maa: 3, maer: 3, maerz: 3, mrz: 3, apr: 4, avr: 4, abr: 4,
  may: 5, mai: 5, mei: 5, mag: 5, jun: 6, juin: 6, giu: 6, jul: 7, juil: 7, lug: 7, aug: 8, aou: 8, ago: 8,
  sep: 9, set: 9, oct: 10, okt: 10, ott: 10, nov: 11, dec: 12, dez: 12, dic: 12,
};

function isoDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(name: string): number | undefined {
  const key = normalizeHeader(name);
  return MONTHS[key] ?? MONTHS[key.slice(0, 3)];
}

/**
 * Calendar date of a broker date or timestamp, as YYYY-MM-DD, or undefined
 * when it cannot be read. Day-first for numeric dates, as European brokers
 * write them.
 */
export function parseDate(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const s = val.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/.exec(s);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{4})(\d{2})(\d{2})(?:$|[;,\sT])/.exec(s);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})(?![\d])/.exec(s);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?![\d])/.exec(s);
  if (m) return isoDate(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[\s./-]+([A-Za-zÀ-ÿ]{3,9})\.?[\s./-]+(\d{4})(?![\d])/.exec(s);
  if (m) {
    const month = monthNumber(m[2]!);
    return month ? isoDate(+m[3]!, month, +m[1]!) : undefined;
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?![\d])/.exec(s);
  if (m) {
    const month = monthNumber(m[1]!);
    return month ? isoDate(+m[3]!, month, +m[2]!) : undefined;
  }
  return undefined;
}

/**
 * Timestamp of a row as an ISO string. A time-only cell ("14:31") joins the
 * row's date. An ISO timestamp with a "T" is kept as exported.
 */
export function parseDateTime(val: string | undefined, date: string): string | undefined {
  if (!val) return undefined;
  const s = val.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return `${date}T${m[1]!.padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
  m = /^(\d{4}-\d{2}-\d{2}),?\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) return `${m[1]}T${m[2]}${m[3] ?? ""}`;
  m = /^(\d{4})(\d{2})(\d{2})[;\sT]?(\d{2}):?(\d{2}):?(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  m = /^\S+[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m && parseDate(s) === date) return `${date}T${m[1]!.padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
  return /\d{1,2}:\d{2}/.test(s) ? s : undefined;
}

function hasTime(val: string): boolean {
  return /\d{1,2}:\d{2}/.test(val);
}

// ── Transaction types ───────────────────────────────────────────────────────

/** Upper case, accents dropped, words separated by single spaces, padded with a space. */
function typeWords(raw: string): string {
  const words = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9Α-Ω]+/g, " ")
    .trim();
  return ` ${words} `;
}

const has = (words: string, terms: string[]) => terms.some((t) => words.includes(t));

const CANCEL_TERMS = ["CANCEL", "STORNO", "REVERSAL", "ANNUL"];
const SPLIT_TERMS = ["SPLIT"];
const TAX_TERMS = [" TAX", "TAXES", " WHT ", "STEUER", "BELASTING", "IMPOT", "IMPUEST", "RETENCION", " SDRT ", "STAMP DUTY", "ΦΟΡΟΣ", "ΠΑΡΑΚΡΑΤΗΣΗ"];
const FEE_TERMS = [" FEE", "FEES ", "COMMISSION", "GEBUHR", "GEBUEHR", "KOSTEN", "SPESEN", "FRAIS", "COMISION", "CUSTODY", "ΠΡΟΜΗΘΕΙΑ"];
const WITHDRAW_TERMS = ["WITHDRAW", "OUTBOUND", "AUSZAHLUNG", "TERUGSTORTING", "OPNAME", "RETRAIT", "PRELIEVO", "ΑΝΑΛΗΨΗ"];
const DEPOSIT_TERMS = ["DEPOSIT", "INBOUND", " TOP UP ", "TOPUP", "EINZAHLUNG", "STORTING", "VERSEMENT", "ΚΑΤΑΘΕΣΗ"];
const SELL_TERMS = ["SELL", " SALE ", "VERKAUF", "VERKOOP", "VENTE", "VENDITA", "VENTA", "VENDA", "VENDE ", "ΠΩΛΗΣΗ", "POSITION CLOSED", "CLOSE POSITION"];
const BUY_TERMS = ["BUY", "PURCHASE", "KAUF", "KOOP", "ACHAT", "ACQUISTO", "COMPRA", "ΑΓΟΡΑ", "OPEN POSITION", "SAVINGS PLAN", "SAVINGSPLAN", "SPARPLAN"];
const DIVIDEND_TERMS = ["DIVIDEND", "DIVIDENT", "DISTRIBUTION", "AUSSCHUTTUNG", "AUSSCHUETTUNG", "PAYMENT IN LIEU", "ΜΕΡΙΣΜΑ"];
const INTEREST_TERMS = ["INTEREST", "ZINS", " RENTE ", "INTERESSI", "INTERES", "INTERET", "ΤΟΚΟ"];

/**
 * Normalised type of an exported type text. Known kinds map to the types the
 * portfolio math reads; anything else is kept, upper case with underscores,
 * and its signed amount counts as cash.
 */
export function normalizeType(raw: string, amount?: number): string {
  const fallback = raw.toUpperCase().replace(/\s+/g, "_");
  const w = typeWords(raw);
  if (has(w, CANCEL_TERMS) || has(w, SPLIT_TERMS)) return fallback;
  if (has(w, TAX_TERMS) && !w.includes("EXEMPT")) return "TAX";
  if (has(w, FEE_TERMS)) return "FEE";
  const deposit = has(w, DEPOSIT_TERMS);
  const withdraw = has(w, WITHDRAW_TERMS);
  if (deposit && withdraw) return (amount ?? 0) < 0 ? "CUSTOMER_OUTBOUND" : "CUSTOMER_INBOUND";
  if (withdraw) return "CUSTOMER_OUTBOUND";
  if (has(w, SELL_TERMS)) return "SELL";
  if (has(w, BUY_TERMS)) return "BUY";
  if (has(w, DIVIDEND_TERMS) && !w.includes(" STOCK DISTRIBUTION ")) return "DIVIDEND";
  if (deposit) return "CUSTOMER_INBOUND";
  if (has(w, INTEREST_TERMS)) return "INTEREST_PAYMENT";
  return fallback;
}

/**
 * Fit a row's amounts to the conventions the portfolio math reads: a tax or
 * fee row books its cash in `tax` or `fee`, a negative dividend or interest is
 * a correction, and a negative deposit is a withdrawal.
 */
function applyCashConventions(tx: DraftTransaction): void {
  const amount = tx.amount;
  switch (tx.type) {
    case "TAX":
      if (amount !== undefined) {
        tx.tax = 0 - amount || 0;
        tx.amount = undefined;
      }
      break;
    case "FEE":
      if (amount !== undefined && amount < 0) {
        tx.fee = (tx.fee ?? 0) - amount;
        tx.amount = undefined;
      } else if (amount !== undefined && amount > 0) {
        tx.type = "FEE_REFUND";
      }
      break;
    case "DIVIDEND":
      if (amount !== undefined && amount < 0) tx.type = "DIVIDEND_CORRECTION";
      break;
    case "INTEREST_PAYMENT":
      if (amount !== undefined && amount < 0) tx.type = "INTEREST_CHARGE";
      break;
    case "CUSTOMER_INBOUND":
      if (amount !== undefined && amount < 0) tx.type = "CUSTOMER_OUTBOUND";
      break;
  }
  // A split moves shares, not cash.
  if (/SPLIT/.test(tx.type)) tx.amount = undefined;
}

// ── Symbols ─────────────────────────────────────────────────────────────────

/** Exchange suffix of a symbol written TICKER.SUFFIX by XTB, as Yahoo writes it. */
const XTB_SUFFIX: Record<string, string> = {
  US: "", UK: "L", DE: "DE", PL: "WA", FR: "PA", NL: "AS", ES: "MC", IT: "MI", PT: "LS",
  BE: "BR", CH: "SW", DK: "CO", SE: "ST", NO: "OL", FI: "HE", CZ: "PR",
};

/** Yahoo suffix of an Interactive Brokers listing exchange. */
const IBKR_EXCHANGE_SUFFIX: Record<string, string> = {
  NASDAQ: "", NYSE: "", ARCA: "", AMEX: "", BATS: "", IEX: "", PINK: "",
  LSE: "L", LSEETF: "L", IBIS: "DE", IBIS2: "DE", FWB: "F", FWB2: "F", AEB: "AS", SBF: "PA",
  "ENEXT.BE": "BR", BVME: "MI", "BVME.ETF": "MI", BM: "MC", EBS: "SW", VSE: "VI", SFB: "ST",
  TSE: "TO", SEHK: "HK", ASX: "AX", TSEJ: "T",
};

/** Yahoo suffix of a market identifier code (Saxo writes TICKER:mic). */
const MIC_SUFFIX: Record<string, string> = {
  XNAS: "", XNYS: "", ARCX: "", BATS: "", XASE: "", XAMS: "AS", XETR: "DE", XFRA: "F", XPAR: "PA",
  XLON: "L", XMIL: "MI", XMAD: "MC", XSWX: "SW", XVTX: "SW", XBRU: "BR", XLIS: "LS", XHEL: "HE",
  XSTO: "ST", XCSE: "CO", XOSL: "OL", XWBO: "VI", XTSE: "TO", XHKG: "HK", XASX: "AX", XDUB: "IR", XATH: "AT",
};

function withSuffix(ticker: string, suffix: string | undefined): string {
  if (suffix === undefined) return ticker;
  return suffix ? `${ticker}.${suffix}` : ticker;
}

/**
 * Final symbol of a row. Share classes become Yahoo's "BRK-B". A bare ticker
 * of a non-US security that trades outside USD (VWCE, SXR8) names no Yahoo
 * listing, so the ISIN goes to the service, which picks the listing.
 */
function finalizeSymbol(tx: DraftTransaction): void {
  let symbol = tx.symbol.trim().toUpperCase();
  const isin = tx.isin;
  const country = isin?.slice(0, 2);
  const listing = (tx.listingCurrency || tx.currency || "").toUpperCase();
  if (/^[A-Z]{1,5}[ /][A-Z]$/.test(symbol) && (listing === "USD" || country === "US")) symbol = symbol.replace(/[ /]/, "-");
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(symbol) && country === "US") symbol = symbol.replace(".", "-");
  if (isin && symbol !== isin && country !== "US" && listing && listing !== "USD" && /^[A-Z0-9]+$/.test(symbol)) symbol = isin;
  tx.symbol = symbol;
}

// ── Broker templates ────────────────────────────────────────────────────────

/** "OPEN BUY 0.5/1.5 @ 500.00": the fill (0.5 of an order of 1.5) and its price. */
const XTB_COMMENT = /\b(OPEN|CLOSE)\s+(BUY|SELL)\s+([\d.,]+)(?:\/[\d.,]+)?\s*@\s*([\d.,]+)/i;

/** "Buy 3 @ 134.85 USD", "Koop 1,5 @ 110,01 EUR". */
const SAXO_EVENT = /^\s*(buy|sell|koop|verkoop|kauf|verkauf|achat|vente)\s+([-\d.,]+)\s*@\s*([\d.,]+)\s*([A-Z]{3})?/i;

function ibkrContext(table: CsvTable, column: (name: string) => number): { keep: Set<string> } {
  const level = column("levelofdetail");
  const levels = new Set(level >= 0 ? table.rows.map((r) => (r[level] ?? "").toUpperCase()) : []);
  // A Flex query with every Trades option repeats each execution as an order, a closed lot and a summary.
  const keep = levels.has("EXECUTION") ? new Set(["EXECUTION", ""]) : new Set(["ORDER", ""]);
  return { keep };
}

function adjustIbkr(tx: DraftTransaction, read: RowReader, context: unknown): string | void {
  const { keep } = (context as { keep?: Set<string> }) ?? {};
  const level = read("levelofdetail").toUpperCase();
  if (level && keep && !keep.has(level)) return "Order summaries and closed lots (the executions are imported)";
  const assetClass = read("assetclass", "assetcategory").toUpperCase();
  if (assetClass === "CASH" || assetClass === "FOREX") return "Currency conversions (FX trades)";
  if (/^(OPT|FOP|FUT|WAR|BOND|BILL|CFD|IOPT)$|OPTION|FUTURE|BOND|WARRANT|BILL/.test(assetClass)) {
    return "Options, futures, bonds and other derivatives";
  }
  if (/\(CA\.?\)/i.test(tx.rawType)) return "Cancelled trades";
  if (/^corporate actions$|^transfers$/i.test(tx.rawType)) return "Corporate actions and transfers (add these by hand)";
  tx.assetClass = undefined;
  const exchange = read("listingexchange", "exchange").toUpperCase();
  const suffix = IBKR_EXCHANGE_SUFFIX[exchange];
  if (suffix !== undefined && tx.symbol && !ISIN_PATTERN.test(tx.symbol)) {
    tx.symbol = withSuffix(tx.symbol.replace(/[ /]/, "-"), suffix);
  }
}

const CSV_TEMPLATES_LIST: CsvTemplate[] = [
  {
    id: "trade_republic",
    name: "Trade Republic",
    badge: "TR",
    description: "Trade Republic transaction export (Profile, Account statements, Transaction export)",
    defaultCurrency: "EUR",
    signatureHeaders: ["datetime", "accounttype", "assetclass", "counterpartyiban", "mcccode", "paymentreference"],
    requiredHeaders: ["accounttype"],
    mappings: {
      datetime: "datetime",
      date: "date",
      type: "type",
      assetclass: "asset_class",
      name: "name",
      symbol: "symbol",
      shares: "shares",
      price: "price",
      amount: "amount",
      fee: "fee",
      tax: "tax",
      currency: "currency",
      transactionid: "transaction_id",
      category: "category",
    },
  },
  {
    id: "trading212",
    name: "Trading 212",
    badge: "T212",
    description: "Trading 212 history export (History, Export CSV)",
    signatureHeaders: ["action", "noofshares", "priceshare", "currencypriceshare", "currencytotal", "exchangerate"],
    requiredHeaders: ["action"],
    decimal: ".",
    mappings: {
      timeutc: "datetime",
      time: "datetime",
      action: "type",
      isin: "isin",
      ticker: "symbol",
      name: "name",
      noofshares: "shares",
      priceshare: "price",
      total: "amount",
      "total*": "amount",
      currencytotal: "currency",
      id: "transaction_id",
      // "Total" is the cash credited: net of the withholding tax and including the
      // currency conversion fee, so neither is mapped again.
    },
    adjust(tx, read) {
      const words = typeWords(tx.rawType);
      if (words.includes(" CURRENCY CONVERSION ")) return "Currency conversions";
      if (/ TRANSFER (IN|OUT) | STOCK DISTRIBUTION /.test(words)) tx.amount = undefined;
      const priceCurrency = read("currencypriceshare").toUpperCase();
      if (priceCurrency) tx.listingCurrency = priceCurrency;
    },
  },
  {
    id: "ibkr",
    name: "Interactive Brokers (IBKR) Flex query",
    badge: "IBKR",
    description: "Interactive Brokers Flex query CSV (Trades or Cash Transactions section)",
    defaultCurrency: "USD",
    signatureHeaders: ["tradedate", "ibcommission", "proceeds", "assetcategory", "currencyprimary", "buysell", "levelofdetail", "clientaccountid"],
    decimal: ".",
    mappings: {
      tradedate: "date",
      settledate: "date",
      reportdate: "date",
      date: "date",
      datetime: "datetime",
      timestamp: "datetime",
      symbol: "symbol",
      isin: "isin",
      description: "name",
      quantity: "shares",
      tradeprice: "price",
      price: "price",
      proceeds: "amount",
      amount: "amount",
      grossamount: "amount",
      netamount: "amount",
      ibcommission: "fee",
      commission: "fee",
      fee: "fee",
      withholdingtax: "tax",
      tax: "tax",
      currencyprimary: "currency",
      currency: "currency",
      buysell: "type",
      type: "type",
      transactionid: "transaction_id",
    },
    prepare: ibkrContext,
    adjust: adjustIbkr,
  },
  {
    id: "ibkr_statement",
    name: "Interactive Brokers (IBKR) activity statement",
    badge: "IBKR",
    description: "Interactive Brokers default activity statement, downloaded as CSV",
    defaultCurrency: "USD",
    signatureHeaders: ["ibkrsection", "assetcategory", "listingexchange"],
    requiredHeaders: ["ibkrsection"],
    decimal: ".",
    infersType: true,
    mappings: {
      datetime: "datetime",
      type: "type",
      symbol: "symbol",
      isin: "isin",
      description: "name",
      assetcategory: "asset_class",
      quantity: "shares",
      price: "price",
      amount: "amount",
      fee: "fee",
      currency: "currency",
    },
    adjust: adjustIbkr,
  },
  {
    id: "degiro",
    name: "DEGIRO transactions",
    badge: "DG",
    description: "DEGIRO Transactions export (Activity, Transactions, Export CSV), English, Dutch or German",
    defaultCurrency: "EUR",
    signatureHeaders: [
      "referenceexchange", "venue", "localvalue", "valueeur", "totaleur", "orderid",
      "beurs", "uitvoeringsplaats", "lokalewaarde", "waardeeur", "totaaleur",
      "referenzboerse", "ausfuehrungsort", "wertinlokalwaehrung", "werteur", "gesamteur",
      "produkt", "aantal", "autofx*",
    ],
    requiredHeaders: ["isin"],
    decimal: ",",
    infersType: true,
    mappings: {
      date: "date",
      datum: "date",
      time: "datetime",
      tijd: "datetime",
      uhrzeit: "datetime",
      product: "name",
      produkt: "name",
      isin: "isin",
      quantity: "shares",
      aantal: "shares",
      anzahl: "shares",
      price: "price",
      koers: "price",
      kurs: "price",
      valueeur: "amount",
      waardeeur: "amount",
      werteur: "amount",
      value: "amount",
      waarde: "amount",
      wert: "amount",
      "transactionandorthird*": "fee",
      "transactiekosten*": "fee",
      "transaktions*": "fee",
      "transactioncosts*": "fee",
      orderid: "transaction_id",
    },
    adjust(tx, read) {
      const autoFx = parseNumber(read("autofx*"), ",");
      if (autoFx) tx.fee = Math.round(((tx.fee ?? 0) + Math.abs(autoFx)) * 1e8) / 1e8;
      if (tx.amount === undefined) tx.amount = parseNumber(read("totaleur", "totaal", "total", "gesamt"), ",");
      // The unnamed column after the price holds its currency.
      tx.listingCurrency = read("price2", "koers2", "kurs2").toUpperCase() || undefined;
      const shares = tx.shares ?? 0;
      if (shares < 0) tx.type = "SELL";
      else if (shares > 0) tx.type = "BUY";
      else return "Rows without a quantity";
    },
  },
  {
    id: "degiro_account",
    name: "DEGIRO account statement",
    badge: "DG",
    description: "DEGIRO Account statement CSV (dividends, deposits, interest, fees); trades come from the Transactions export",
    defaultCurrency: "EUR",
    signatureHeaders: ["valuedate", "valutadatum", "description", "omschrijving", "beschreibung", "change", "mutatie", "aenderung", "balance", "saldo", "fx"],
    requiredHeaders: ["fx"],
    decimal: ",",
    mappings: {
      date: "date",
      datum: "date",
      time: "datetime",
      tijd: "datetime",
      uhrzeit: "datetime",
      product: "name",
      produkt: "name",
      isin: "isin",
      description: "type",
      omschrijving: "type",
      beschreibung: "type",
      change2: "amount",
      mutatie2: "amount",
      aenderung2: "amount",
      change: "currency",
      mutatie: "currency",
      aenderung: "currency",
      orderid: "transaction_id",
    },
    adjust(tx) {
      const d = tx.rawType.toLowerCase();
      if (/^(buy|sell|koop|verkoop|kauf|verkauf)\b/.test(d)) return "Trades (they come from the Transactions export)";
      if (/transaction and\/or third|transactiekosten|transaktionsgeb|transaktionskosten/.test(d)) {
        return "Trade fees (they come from the Transactions export)";
      }
      if (/^fx (credit|debit)|valuta (creditering|debitering)|w(ae|ä)hrungswechsel/.test(d)) return "Currency conversions";
      if (/cash sweep|overboeking|reservation|reservering|reservierung|geldmarktfonds|money market/.test(d)) {
        return "Internal cash transfers and reservations";
      }
    },
  },
  {
    id: "etoro",
    name: "eToro",
    badge: "ETORO",
    description: "eToro account statement, Account Activity sheet (.xlsx or saved as CSV)",
    defaultCurrency: "USD",
    signatureHeaders: ["details", "units", "realizedequitychange", "realizedequity", "positionid", "nwa"],
    requiredHeaders: ["details"],
    mappings: {
      date: "date",
      type: "type",
      details: "symbol",
      amount: "amount",
      units: "shares",
      assettype: "asset_class",
    },
    adjust(tx, read) {
      const assetType = read("assettype").toUpperCase();
      if (assetType === "CFD") return "CFD positions";
      const details = read("details");
      const pair = /^([A-Za-z0-9.\-]+)\/[A-Za-z]{3}$/.exec(details);
      tx.symbol = pair ? pair[1]! : tx.type === "BUY" || tx.type === "SELL" || tx.type === "DIVIDEND" ? details : "";
      tx.assetClass = assetType === "CRYPTO" ? "CRYPTO" : assetType === "ETF" ? "ETF" : assetType.startsWith("STOCK") ? "STOCK" : undefined;
    },
  },
  {
    id: "revolut",
    name: "Revolut",
    badge: "REV",
    description: "Revolut brokerage account statement (Invest, Documents, Account statement)",
    defaultCurrency: "USD",
    signatureHeaders: ["ticker", "type", "quantity", "pricepershare", "totalamount", "fxrate"],
    requiredHeaders: ["totalamount"],
    decimal: ".",
    mappings: {
      date: "date",
      ticker: "symbol",
      type: "type",
      quantity: "shares",
      pricepershare: "price",
      totalamount: "amount",
      currency: "currency",
    },
  },
  {
    id: "xtb",
    name: "XTB",
    badge: "XTB",
    description: "XTB cash operations report (Account history, Cash operations), CSV or .xlsx",
    signatureHeaders: ["comment", "symbol", "type", "time", "amount", "id"],
    requiredHeaders: ["comment"],
    infersType: true,
    mappings: {
      id: "transaction_id",
      type: "type",
      time: "datetime",
      symbol: "symbol",
      instrument: "symbol",
      amount: "amount",
    },
    adjust(tx, read) {
      const comment = XTB_COMMENT.exec(read("comment"));
      if (comment) {
        const [, side, direction, volume, price] = comment;
        tx.shares = parseNumber(volume, ".");
        tx.price = parseNumber(price, ".");
        if (tx.type !== "BUY" && tx.type !== "SELL") {
          const opensLong = side!.toUpperCase() === "OPEN" && direction!.toUpperCase() === "BUY";
          tx.type = opensLong ? "BUY" : "SELL";
        }
      }
      const m = /^([A-Z0-9\-]+)\.([A-Z]{2})$/i.exec(tx.symbol);
      if (m) {
        const market = m[2]!.toUpperCase();
        tx.symbol = withSuffix(m[1]!, XTB_SUFFIX[market] ?? market);
        if (market === "US") tx.listingCurrency = "USD";
      }
    },
  },
  {
    id: "scalable",
    name: "Scalable Capital",
    badge: "SC",
    description: "Scalable Capital broker transactions (Broker, Transactions, Export CSV)",
    defaultCurrency: "EUR",
    signatureHeaders: ["status", "reference", "description", "assettype", "isin", "shares"],
    requiredHeaders: ["status", "assettype"],
    decimal: ",",
    mappings: {
      date: "date",
      time: "datetime",
      status: "status",
      reference: "transaction_id",
      description: "name",
      assettype: "asset_class",
      type: "type",
      isin: "isin",
      shares: "shares",
      price: "price",
      amount: "amount",
      fee: "fee",
      tax: "tax",
      currency: "currency",
    },
    adjust(tx) {
      const assetClass = (tx.assetClass ?? "").toUpperCase();
      tx.assetClass = assetClass === "CRYPTO" ? "CRYPTO" : undefined;
    },
  },
  {
    id: "scalable_baader",
    name: "Scalable Capital (Baader, before Dec 2025)",
    badge: "SC",
    description: "Older Scalable Capital / Baader Bank transaction export CSV",
    defaultCurrency: "EUR",
    signatureHeaders: ["valutadatum", "buchungsdatum", "transaktionsart", "wertpapierbezeichnung", "ausfuehrungskurs"],
    decimal: ",",
    mappings: {
      valutadatum: "date",
      buchungsdatum: "date",
      datum: "date",
      date: "date",
      transaktionsart: "type",
      typ: "type",
      type: "type",
      isin: "isin",
      wertpapierbezeichnung: "name",
      name: "name",
      stueck: "shares",
      anzahl: "shares",
      shares: "shares",
      ausfuehrungskurs: "price",
      kurs: "price",
      price: "price",
      betrag: "amount",
      amount: "amount",
      gebuehren: "fee",
      spesen: "fee",
      fee: "fee",
      steuern: "tax",
      tax: "tax",
      waehrung: "currency",
      currency: "currency",
      referenz: "transaction_id",
      orderid: "transaction_id",
    },
  },
  {
    id: "saxo",
    name: "Saxo",
    badge: "SAXO",
    description: "Saxo transactions export (Transaction overview, Export, Excel)",
    signatureHeaders: ["instrumentisin", "instrumentsymbol", "event", "conversionrate", "instrumentcurrency", "tradedate"],
    requiredHeaders: ["event"],
    infersType: true,
    mappings: {
      tradedate: "date",
      valuedate: "date",
      event: "type",
      instrument: "name",
      instrumentisin: "isin",
      instrumentsymbol: "symbol",
      amount: "amount",
      orderid: "transaction_id",
    },
    adjust(tx, read) {
      const trade = SAXO_EVENT.exec(read("event"));
      if (trade) {
        const [, verb, quantity, price, currency] = trade;
        const sells = /^(sell|verkoop|verkauf|vente)$/i.test(verb!);
        tx.type = sells ? "SELL" : "BUY";
        tx.shares = Math.abs(parseNumber(quantity) ?? 0) || undefined;
        tx.price = parseNumber(price);
        if (currency) tx.listingCurrency = currency.toUpperCase();
      }
      const [ticker, mic] = read("instrumentsymbol").split(":");
      if (ticker) tx.symbol = withSuffix(ticker.toUpperCase(), MIC_SUFFIX[(mic ?? "").toUpperCase()]);
      if (!tx.listingCurrency) tx.listingCurrency = read("instrumentcurrency").toUpperCase() || undefined;
    },
  },
  {
    id: "auto",
    name: "Auto-Detect (Smart Generic)",
    badge: "AUTO",
    description: "Intelligent automatic heuristic column detection for any broker",
    signatureHeaders: [],
    mappings: {},
  },
];

export const CSV_TEMPLATES: CsvTemplate[] = CSV_TEMPLATES_LIST;

export function findTemplate(id: string): CsvTemplate | undefined {
  return CSV_TEMPLATES.find((t) => t.id === id);
}

// ── Reading the file ────────────────────────────────────────────────────────

/**
 * The delimiter with the most cells on one line of the first 30. Title lines
 * above the header ("Account statement") hold none, so the first line alone
 * can mislead.
 */
function detectDelimiter(text: string): string {
  const best: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  const lines = text.split(/\r\n|\n|\r/, 60).filter((l) => l.trim().length > 0).slice(0, 30);
  for (const line of lines) {
    const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in counts) counts[ch]!++;
    }
    for (const d in counts) best[d] = Math.max(best[d]!, counts[d]!);
  }
  let delimiter = ",";
  for (const d of [";", "\t", "|"]) if (best[d]! > best[delimiter]!) delimiter = d;
  return delimiter;
}

/** Split CSV text into records. Quoted cells may hold the delimiter, quotes ("") and line breaks. */
function tokenize(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records
    .map((r) => r.map((c) => c.replace(/[ \s]+$/g, "").replace(/^[ \s]+/g, "").replace(/^'/, "")))
    .filter((r) => r.some((c) => c.length > 0));
}

const KNOWN_HEADERS = new Set<string>([
  ...SYSTEM_FIELDS.flatMap((f) => f.aliases.map(normalizeHeader)),
  ...CSV_TEMPLATES_LIST.flatMap((t) => [...t.signatureHeaders, ...Object.keys(t.mappings)].filter((k) => !k.endsWith("*"))),
]);

/**
 * Index of the header row: of the opening rows, the first that names the most
 * known columns (two at least), so title lines above the table (XTB, some
 * Excel exports) are passed over. The first row when none qualifies.
 */
export function findHeaderRow(records: string[][]): number {
  const limit = Math.min(records.length, 30);
  let best = 0;
  let bestKnown = 1;
  for (let i = 0; i < limit; i++) {
    const known = records[i]!.filter((c) => KNOWN_HEADERS.has(normalizeHeader(c))).length;
    if (known > bestKnown) {
      best = i;
      bestKnown = known;
    }
  }
  return best;
}

/** Give each empty header the name of the column before it plus " (2)", as DEGIRO's currency columns. */
function nameEmptyHeaders(headers: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    const prev = out[i - 1];
    out.push(h || (prev ? `${prev.replace(/ \(2\)$/, "")} (2)` : ""));
  }
  return out;
}

/** Build a table from records: find the header, name empty headers, pad short rows. */
export function tableFromRecords(records: string[][]): CsvTable {
  if (records.length === 0) return { headers: [], rows: [] };
  if (isIbkrActivityStatement(records)) return flattenIbkrActivityStatement(records);
  const headerIndex = findHeaderRow(records);
  const headers = nameEmptyHeaders(records[headerIndex]!);
  const rows: string[][] = [];
  for (const record of records.slice(headerIndex + 1)) {
    const cols = [...record];
    while (cols.length < headers.length) cols.push("");
    rows.push(cols);
  }
  return { headers, rows };
}

/** Parse the text of a CSV export. */
/** Text of a CSV file: UTF-8, UTF-16 with a byte order mark, or Windows-1252 (older Excel saves). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function parseCsvContent(content: string): CsvTable {
  let text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  let delimiter: string | undefined;
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) {
    delimiter = sep[1]!;
    text = text.slice(sep[0].length);
  }
  return tableFromRecords(tokenize(text, delimiter ?? detectDelimiter(text)));
}

// ── Interactive Brokers activity statement ──────────────────────────────────

function isIbkrActivityStatement(records: string[][]): boolean {
  const first = records[0] ?? [];
  if (first[0] === "Statement" && first[1] === "Header") return true;
  return records.slice(0, 50).some((r) => r[0] === "Trades" && r[1] === "Header" && r.includes("DataDiscriminator"));
}

const IBKR_FLAT_HEADERS = [
  "IBKR Section", "Type", "Date/Time", "Symbol", "ISIN", "Description", "Asset Category",
  "Quantity", "Price", "Amount", "Fee", "Currency", "Listing Exchange",
] as const;

/** IBKR writes numbers with a dot decimal and comma thousands ("1,000"). */
function ibkrNumber(val: string | undefined): string {
  return (val ?? "").replace(/,/g, "");
}

/** "AAPL(US0378331005) Cash Dividend ...": the symbol and the ISIN in front of a cash line. */
const IBKR_CASH_SUBJECT = /^([A-Z0-9 .\-]+?)\s*\(([A-Z]{2}[A-Z0-9]{9}[0-9])\)/;

const IBKR_CASH_SECTIONS = new Set([
  "Dividends", "Withholding Tax", "Deposits & Withdrawals", "Interest", "Fees",
  "Payment In Lieu Of Dividends", "Other Fees", "Broker Interest Paid", "Broker Interest Received",
]);

/**
 * Turn the multi-section activity statement into one table: a row per trade
 * and per cash line (dividends, withholding tax, deposits, interest, fees).
 * The Financial Instrument Information section adds the ISIN and the listing
 * exchange to each symbol.
 */
function flattenIbkrActivityStatement(records: string[][]): CsvTable {
  const headers = new Map<string, string[]>();
  const instruments = new Map<string, { isin: string; name: string; exchange: string }>();
  for (const r of records) {
    if (r[0] !== "Financial Instrument Information") continue;
    if (r[1] === "Header") headers.set(r[0], r.slice(2));
    else if (r[1] === "Data") {
      const h = headers.get(r[0]) ?? [];
      const get = (name: string) => r[2 + h.indexOf(name)] ?? "";
      instruments.set(get("Symbol"), { isin: get("Security ID"), name: get("Description"), exchange: get("Listing Exch") });
    }
  }

  const rows: string[][] = [];
  headers.clear();
  for (const r of records) {
    const [section = "", kind = ""] = r;
    if (kind === "Header") {
      headers.set(section, r.slice(2));
      continue;
    }
    if (kind !== "Data") continue;
    const h = headers.get(section) ?? [];
    const get = (...names: string[]) => {
      for (const name of names) {
        const i = h.findIndex((x) => x === name || (name.endsWith("*") && x.startsWith(name.slice(0, -1))));
        if (i >= 0 && r[2 + i]) return r[2 + i]!;
      }
      return "";
    };
    if (/^total/i.test(r[2] ?? "")) continue;

    if (section === "Trades") {
      const discriminator = get("DataDiscriminator");
      if (discriminator && !/^(order|trade|execution)$/i.test(discriminator)) continue;
      const symbol = get("Symbol");
      const instrument = instruments.get(symbol);
      rows.push([
        section, "", get("Date/Time"), symbol, instrument?.isin ?? "", instrument?.name ?? "", get("Asset Category"),
        ibkrNumber(get("Quantity")), ibkrNumber(get("T. Price")), ibkrNumber(get("Proceeds")),
        ibkrNumber(get("Comm/Fee", "Comm in *")), get("Currency"), instrument?.exchange ?? "",
      ]);
    } else if (IBKR_CASH_SECTIONS.has(section)) {
      const description = get("Description");
      const subject = IBKR_CASH_SUBJECT.exec(description);
      const symbol = subject?.[1]?.trim() ?? "";
      rows.push([
        section, section, get("Date", "Settle Date"), symbol, subject?.[2] ?? "", description, "",
        "", "", ibkrNumber(get("Amount")), "", get("Currency"), instruments.get(symbol)?.exchange ?? "",
      ]);
    } else if (section === "Corporate Actions" || section === "Transfers") {
      rows.push([
        section, section, get("Date/Time", "Date"), get("Symbol"), "", get("Description"), get("Asset Category"),
        ibkrNumber(get("Quantity", "Qty")), "", "", "", get("Currency"), "",
      ]);
    }
  }
  return { headers: [...IBKR_FLAT_HEADERS], rows };
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function autoDetectAllFields(headers: string[]): SystemFieldKey[] {
  const assigned = new Set<SystemFieldKey>();
  const mappings: SystemFieldKey[] = new Array(headers.length).fill("none");

  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    if (!norm) return;

    for (const def of SYSTEM_FIELDS) {
      if (def.key === "none" || assigned.has(def.key)) continue;
      for (const alias of def.aliases) {
        if (norm === normalizeHeader(alias)) {
          mappings[idx] = def.key;
          assigned.add(def.key);
          return;
        }
      }
    }
  });

  return mappings;
}

/** The template whose signature headers the file has most of (two at least), else "auto". */
export function detectBestTemplate(headers: string[]): string {
  const normHeaders = headers.map((h) => normalizeHeader(h));
  const present = (key: string) => normHeaders.some((h) => headerMatches(h, key));
  let bestTemplateId = "auto";
  let maxMatches = 0;

  for (const template of CSV_TEMPLATES) {
    if (template.id === "auto" || template.signatureHeaders.length === 0) continue;
    if (template.requiredHeaders && !template.requiredHeaders.every(present)) continue;
    const matches = new Set(template.signatureHeaders.filter(present)).size;
    if (matches > maxMatches && matches >= 2) {
      maxMatches = matches;
      bestTemplateId = template.id;
    }
  }

  return bestTemplateId;
}

export function applyTemplateToHeaders(
  templateId: string,
  headers: string[]
): { mappings: SystemFieldKey[]; defaultCurrency?: string | undefined } {
  const template = findTemplate(templateId);
  if (!template || template.id === "auto") {
    return { mappings: autoDetectAllFields(headers) };
  }

  const normHeaders = headers.map((h) => normalizeHeader(h));
  const assigned = new Set<SystemFieldKey>();
  const mappings: SystemFieldKey[] = new Array(headers.length).fill("none");

  for (const [key, field] of Object.entries(template.mappings)) {
    if (field === "none" || assigned.has(field)) continue;
    const idx = normHeaders.findIndex((h, i) => h && mappings[i] === "none" && headerMatches(h, key));
    if (idx >= 0) {
      mappings[idx] = field;
      assigned.add(field);
    }
  }

  return { mappings, defaultCurrency: template.defaultCurrency };
}

// ── Building transactions ───────────────────────────────────────────────────

export interface SkippedRows {
  reason: string;
  count: number;
}

export interface BuildResult {
  transactions: PortfolioTransaction[];
  /** Rows left out, grouped by reason, in the order first met. */
  skipped: SkippedRows[];
}

export interface BuildOptions {
  /** The broker template whose rules apply; "auto" or "custom" for none. */
  templateId: string;
  /** Currency of rows without a currency column. */
  defaultCurrency: string;
}

const EXECUTED_STATUS = /^(executed|filled|completed|complete|done|settled|booked|ok|ausgefuehrt|uitgevoerd)$/i;

/** Turn the rows into transactions with the column mapping and the template's rules. */
export function buildTransactions(table: CsvTable, columnMappings: SystemFieldKey[], options: BuildOptions): BuildResult {
  const { headers, rows } = table;
  const template = findTemplate(options.templateId);
  const decimal = template?.decimal;
  const normHeaders = headers.map((h) => normalizeHeader(h));
  const column = (name: string) => normHeaders.findIndex((h) => h && headerMatches(h, name));
  const context = template?.prepare?.(table, column);

  const colIndexByField: Partial<Record<SystemFieldKey, number>> = {};
  columnMappings.forEach((f, idx) => {
    if (f !== "none" && colIndexByField[f] === undefined) {
      colIndexByField[f] = idx;
    }
  });

  const getVal = (rowCols: string[], field: SystemFieldKey): string => {
    const idx = colIndexByField[field];
    return idx !== undefined && idx >= 0 ? (rowCols[idx] ?? "").trim() : "";
  };
  const num = (rowCols: string[], field: SystemFieldKey) => parseNumber(getVal(rowCols, field), decimal);

  // Stored tax is a cost: positive when paid, negative when refunded. Exports
  // that write paid tax as a negative number (Trade Republic) also write a
  // refund as a positive one, so flip the sign for those instead of using abs.
  const taxPaidIsNegative = rows.some((rowCols) => (num(rowCols, "tax") ?? 0) < 0);

  const transactions: PortfolioTransaction[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const seenIds = new Map<string, number>();

  for (let r = 0; r < rows.length; r++) {
    const rowCols = rows[r]!;
    const read: RowReader = (...names) => {
      for (const name of names) {
        const idx = column(name);
        const val = idx >= 0 ? (rowCols[idx] ?? "").trim() : "";
        if (val) return val;
      }
      return "";
    };

    const status = getVal(rowCols, "status");
    if (status && !EXECUTED_STATUS.test(status)) {
      skip("Orders not executed (cancelled, rejected or pending)");
      continue;
    }

    const rawDatetime = getVal(rowCols, "datetime");
    const rawDate = getVal(rowCols, "date") || rawDatetime;
    const date = parseDate(rawDate);
    if (!date) {
      skip(rowCols.some((c) => /^(sub)?total\b/i.test(c)) ? "Total and summary rows" : "Rows with a date that could not be read");
      continue;
    }
    const datetime = rawDatetime ? parseDateTime(rawDatetime, date) : hasTime(rawDate) ? parseDateTime(rawDate, date) : undefined;

    const shares = num(rowCols, "shares");
    const amount = num(rowCols, "amount");
    const rawType = getVal(rowCols, "type");
    let type: string;
    if (rawType) type = normalizeType(rawType, amount);
    else if ((shares ?? 0) < 0) type = "SELL";
    else type = "BUY";

    const rawIsin = getVal(rowCols, "isin");
    const rawSymbol = getVal(rowCols, "symbol");
    const category = getVal(rowCols, "category");
    const rawAssetClass = getVal(rowCols, "asset_class");

    // Trade Republic puts the ISIN in its symbol column. The service swaps an
    // ISIN-only symbol for the ticker (stored ISIN map, then provider search).
    const isinCandidate = (rawIsin || rawSymbol).toUpperCase();
    const isin = ISIN_PATTERN.test(isinCandidate) ? isinCandidate : undefined;

    const fee = num(rowCols, "fee");
    const rawTax = num(rowCols, "tax");
    const tx: DraftTransaction = {
      date,
      datetime,
      type,
      rawType,
      symbol: rawSymbol,
      isin,
      name: getVal(rowCols, "name") || undefined,
      assetClass: rawAssetClass || undefined,
      shares,
      price: num(rowCols, "price"),
      amount,
      fee: fee === undefined ? undefined : Math.abs(fee),
      tax: rawTax === undefined ? undefined : taxPaidIsNegative ? 0 - rawTax || 0 : Math.abs(rawTax),
      currency: (getVal(rowCols, "currency") || options.defaultCurrency || "EUR").toUpperCase(),
    };

    const reason = template?.adjust?.(tx, read, context);
    if (reason) {
      skip(reason);
      continue;
    }
    applyCashConventions(tx);
    // The amount is in the account currency. A price in the listing currency
    // (USD, GBX) would read as one in the account currency, so it is left out.
    if (tx.price !== undefined && tx.amount !== undefined && tx.listingCurrency && tx.listingCurrency !== tx.currency) {
      tx.price = undefined;
    }

    const nothingToBook = !tx.amount && !tx.shares && !tx.fee && !tx.tax;
    if (nothingToBook) {
      skip("Rows without an amount, shares, fee or tax");
      continue;
    }

    if (!tx.symbol && tx.isin) {
      tx.symbol = tx.isin;
    } else if (!tx.symbol && (category === "PRIVATE_FUND" || rawAssetClass === "PRIVATE_FUND")) {
      tx.symbol = "LU3176111881";
    } else if (!tx.symbol) {
      tx.symbol = "CASH";
    }
    finalizeSymbol(tx);

    const isPrivate =
      category === "PRIVATE_FUND" ||
      rawAssetClass === "PRIVATE_FUND" ||
      tx.symbol === "LU3176111881" ||
      Boolean(rawAssetClass && rawAssetClass.toUpperCase().includes("PRIVATE"));
    const assetClass = isPrivate
      ? "PRIVATE_FUND"
      : tx.assetClass || (tx.type.includes("CRYPTO") || tx.symbol.includes("BTC") ? "CRYPTO" : undefined);

    // A broker id can repeat inside one file (partial fills of one DEGIRO order): number the repeats.
    const explicitTxId = getVal(rowCols, "transaction_id");
    let txId = explicitTxId || `tx_${date}_${tx.type}_${tx.symbol}_${tx.amount ?? ""}_${tx.shares ?? ""}_${r}`;
    const seen = (seenIds.get(txId) ?? 0) + 1;
    seenIds.set(txId, seen);
    if (seen > 1) txId = `${txId}#${seen}`;

    transactions.push({
      id: txId,
      date,
      datetime: tx.datetime,
      type: tx.type,
      assetClass,
      name: tx.name,
      symbol: tx.symbol,
      isin: tx.isin,
      shares: tx.shares,
      price: tx.price,
      amount: tx.amount,
      fee: tx.fee,
      tax: tx.tax,
      currency: tx.currency,
    });
  }

  return {
    transactions,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
  };
}
