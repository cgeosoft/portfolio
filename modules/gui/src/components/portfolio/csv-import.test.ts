import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyTemplateToHeaders,
  buildTransactions,
  CSV_TEMPLATES,
  decodeCsvBytes,
  detectBestTemplate,
  findHeaderRow,
  findTemplate,
  ISIN_PATTERN,
  normalizeHeader,
  normalizeType,
  parseCsvContent,
  parseDate,
  parseDateTime,
  parseNumber,
  tableFromRecords,
  type CsvTable,
} from "./csv-import";
import { parseXlsx } from "./xlsx-import";

// The fixtures follow each broker's documented export layout. Every value in them is made up.
const FIXTURES = join(import.meta.dir, "__fixtures__", "brokers");

function importTable(table: CsvTable) {
  const template = detectBestTemplate(table.headers);
  const { mappings, defaultCurrency } = applyTemplateToHeaders(template, table.headers);
  const result = buildTransactions(table, mappings, { templateId: template, defaultCurrency: defaultCurrency ?? "EUR" });
  return { template, ...result };
}

const importText = (text: string) => importTable(parseCsvContent(text));

function importFixture(name: string) {
  return importTable(parseCsvContent(decodeCsvBytes(readFileSync(join(FIXTURES, name)))));
}

async function importWorkbook(name: string) {
  return importTable(await parseXlsx(new Uint8Array(readFileSync(join(FIXTURES, name)))));
}

describe("parseNumber", () => {
  it("reads both decimal conventions", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("120,5")).toBe(120.5);
    expect(parseNumber("1,000", ".")).toBe(1000);
    expect(parseNumber("-0,57", ",")).toBe(-0.57);
  });

  it("reads currency prefixes, brackets and trailing minus signs", () => {
    expect(parseNumber("USD 1,200", ".")).toBe(1200);
    expect(parseNumber("USD -0.01")).toBe(-0.01);
    expect(parseNumber("-$30.93")).toBe(-30.93);
    expect(parseNumber("(6.97)")).toBe(-6.97);
    expect(parseNumber("12.30-")).toBe(-12.3);
    expect(parseNumber("1.5E-7")).toBe(1.5e-7);
  });

  it("returns undefined for empty or text cells", () => {
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("-")).toBeUndefined();
    expect(parseNumber("Not available")).toBeUndefined();
  });
});

describe("parseDate", () => {
  it("reads the broker date layouts", () => {
    expect(parseDate("2025-01-15")).toBe("2025-01-15");
    expect(parseDate("2026-07-24 01:16:11+00:00")).toBe("2026-07-24");
    expect(parseDate("20250115")).toBe("2025-01-15");
    expect(parseDate("20250115;093512")).toBe("2025-01-15");
    expect(parseDate("15-01-2025")).toBe("2025-01-15");
    expect(parseDate("02.04.2025 09:30:02")).toBe("2025-04-02");
    expect(parseDate("03/01/2025 15:37:16")).toBe("2025-01-03");
    expect(parseDate("16-Dec-2024")).toBe("2024-12-16");
    expect(parseDate("16-mrt-2025")).toBe("2025-03-16");
    expect(parseDate("Jan 5, 2025")).toBe("2025-01-05");
  });

  it("returns undefined instead of today for an unreadable date", () => {
    expect(parseDate("Total")).toBeUndefined();
    expect(parseDate("")).toBeUndefined();
    expect(parseDate("31-31-2025")).toBeUndefined();
  });
});

describe("parseDateTime", () => {
  it("joins a time-only cell to the date", () => {
    expect(parseDateTime("10:31", "2025-01-15")).toBe("2025-01-15T10:31:00");
  });

  it("normalises spaced, comma and compact timestamps", () => {
    expect(parseDateTime("2025-03-06, 12:46:07", "2025-03-06")).toBe("2025-03-06T12:46:07");
    expect(parseDateTime("2026-07-24 01:16:11+00:00", "2026-07-24")).toBe("2026-07-24T01:16:11+00:00");
    expect(parseDateTime("20250115;093512", "2025-01-15")).toBe("2025-01-15T09:35:12");
    expect(parseDateTime("2025-01-02T08:15:00.000Z", "2025-01-02")).toBe("2025-01-02T08:15:00.000Z");
  });
});

describe("normalizeType", () => {
  it("maps broker wording to the portfolio types", () => {
    expect(normalizeType("Market buy")).toBe("BUY");
    expect(normalizeType("BUY - MARKET")).toBe("BUY");
    expect(normalizeType("Savings plan")).toBe("BUY");
    expect(normalizeType("Open Position")).toBe("BUY");
    expect(normalizeType("Position closed")).toBe("SELL");
    expect(normalizeType("Stocks/ETF sale")).toBe("SELL");
    expect(normalizeType("Dividend (Ordinary)")).toBe("DIVIDEND");
    expect(normalizeType("Distribution")).toBe("DIVIDEND");
    expect(normalizeType("Withholding tax")).toBe("TAX");
    expect(normalizeType("Free funds interests tax")).toBe("TAX");
    expect(normalizeType("Dividend (Tax exempted)")).toBe("DIVIDEND");
    expect(normalizeType("CUSTODY FEE")).toBe("FEE");
    expect(normalizeType("CASH TOP-UP")).toBe("CUSTOMER_INBOUND");
    expect(normalizeType("Withdraw Request")).toBe("CUSTOMER_OUTBOUND");
    expect(normalizeType("Deposits/Withdrawals", -500)).toBe("CUSTOMER_OUTBOUND");
    expect(normalizeType("Deposits/Withdrawals", 3000)).toBe("CUSTOMER_INBOUND");
    expect(normalizeType("Broker Interest Received")).toBe("INTEREST_PAYMENT");
  });

  it("keeps unknown and corporate-action types as written", () => {
    expect(normalizeType("STOCKPERK")).toBe("STOCKPERK");
    expect(normalizeType("Card transaction")).toBe("CARD_TRANSACTION");
    expect(normalizeType("Stock split open")).toBe("STOCK_SPLIT_OPEN");
  });
});

describe("decodeCsvBytes", () => {
  it("reads UTF-16 and Windows-1252 files", () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x2c, 0x00, 0x42, 0x00]);
    expect(decodeCsvBytes(utf16)).toBe("A,B");
    expect(decodeCsvBytes(new Uint8Array([0x50, 0x72, 0x6f, 0x64, 0x75, 0x6b, 0x74, 0x20, 0xe9]))).toBe("Produkt é");
  });
});

describe("Trade Republic", () => {
  const { template, transactions, skipped } = importFixture("trade-republic.csv");

  it("detects the native export", () => {
    expect(template).toBe("trade_republic");
    expect(skipped).toEqual([]);
  });

  it("keeps trades, taxes and ids", () => {
    expect(transactions[1]).toMatchObject({ id: "00000000-0000-4000-8000-000000000002", type: "BUY", symbol: "IE00B4L5Y983", shares: 2, amount: -200, fee: 1 });
    expect(transactions[2]).toMatchObject({ type: "SELL", shares: -1, amount: 200, fee: 1, tax: 5 });
    expect(transactions[3]).toMatchObject({ type: "DIVIDEND", amount: 2, tax: 0.3 });
  });

  it("books a negative interest row as a charge, not income", () => {
    expect(transactions[5]).toMatchObject({ type: "INTEREST_CHARGE", amount: -0.5 });
  });
});

describe("Trading 212", () => {
  it("reads the classic export", () => {
    const { template, transactions } = importFixture("trading212.csv");
    expect(template).toBe("trading212");
    expect(transactions.map((t) => t.type)).toEqual([
      "CUSTOMER_INBOUND", "BUY", "BUY", "BUY", "SELL", "DIVIDEND", "INTEREST_PAYMENT", "CUSTOMER_OUTBOUND",
    ]);
    // The date column holds the calendar date and the timestamp keeps the time.
    expect(transactions[1]).toMatchObject({ date: "2025-01-06", datetime: "2025-01-06T14:30:05.613", symbol: "AAPL", currency: "EUR", amount: 91.05 });
    // Total is in the account currency, so a USD or GBX price is left out.
    expect(transactions[1]!.price).toBeUndefined();
    expect(transactions[3]).toMatchObject({ symbol: "IE00B3XXRP09", amount: 202.38, currency: "EUR" });
    expect(transactions[3]!.price).toBeUndefined();
    // A bare non-US ticker goes to the service as its ISIN, which picks the listing.
    expect(transactions[2]).toMatchObject({ symbol: "IE00BK5BQT80", price: 120 });
    // Total is net of withholding tax, so the tax is not booked a second time.
    expect(transactions[5]).toMatchObject({ amount: 0.06 });
    expect(transactions[5]!.tax).toBeUndefined();
  });

  it("reads the 2026 export with a Time (UTC) column", () => {
    const { transactions } = importFixture("trading212-2026.csv");
    expect(transactions[0]).toMatchObject({ date: "2026-07-01", type: "CUSTOMER_INBOUND", amount: 250 });
    expect(transactions[1]).toMatchObject({ date: "2026-07-02", type: "BUY", symbol: "MSFT", amount: 87.09 });
    // Split rows carry no cash.
    const splits = transactions.filter((t) => t.type.startsWith("STOCK_SPLIT"));
    expect(splits).toHaveLength(2);
    for (const split of splits) expect(split.amount).toBeUndefined();
  });
});

describe("DEGIRO", () => {
  it("reads the English transactions export", () => {
    const { template, transactions } = importFixture("degiro-transactions-en.csv");
    expect(template).toBe("degiro");
    expect(transactions[0]).toMatchObject({ type: "SELL", shares: -1, amount: 229, fee: 1.57, currency: "EUR", date: "2025-03-20" });
    expect(transactions[0]!.price).toBeUndefined();
    expect(transactions[1]).toMatchObject({ type: "BUY", shares: 2, amount: -441.72, fee: 3.1 });
    expect(transactions[2]).toMatchObject({ price: 120.5 });
  });

  it("gives partial fills of one order their own ids", () => {
    const { transactions } = importFixture("degiro-transactions-en.csv");
    const ids = transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("a1b2c3d4-0000-4000-8000-000000000001#2");
  });

  it("reads the Dutch transactions export", () => {
    const { template, transactions } = importFixture("degiro-transactions-nl.csv");
    expect(template).toBe("degiro");
    expect(transactions[1]).toMatchObject({ type: "BUY", shares: 5, amount: -602.5, fee: 1, symbol: "IE00BK5BQT80" });
  });

  it("takes dividends, taxes, fees and deposits from the account statement", () => {
    const { template, transactions, skipped } = importFixture("degiro-account-en.csv");
    expect(template).toBe("degiro_account");
    expect(transactions.map((t) => t.type)).toEqual(["FEE", "TAX", "DIVIDEND", "CUSTOMER_INBOUND"]);
    expect(transactions[1]).toMatchObject({ tax: 0.08, currency: "USD" });
    expect(transactions[2]).toMatchObject({ amount: 0.5, currency: "USD", isin: "US0378331005" });
    expect(skipped.reduce((n, s) => n + s.count, 0)).toBe(4);
  });
});

describe("eToro", () => {
  it("reads the account activity sheet", () => {
    const { template, transactions, skipped } = importFixture("etoro-account-activity.csv");
    expect(template).toBe("etoro");
    expect(transactions[0]).toMatchObject({ type: "CUSTOMER_INBOUND", amount: 1000, currency: "USD", date: "2025-01-02" });
    expect(transactions[1]).toMatchObject({ type: "BUY", symbol: "AAPL", shares: 0.990099, amount: 200, assetClass: "STOCK" });
    expect(transactions[2]).toMatchObject({ symbol: "VWCE.DE", assetClass: "ETF" });
    expect(transactions[3]).toMatchObject({ symbol: "BTC", assetClass: "CRYPTO" });
    expect(transactions.find((t) => t.type === "SELL")).toMatchObject({ symbol: "AAPL", shares: 0.495049, amount: 105 });
    expect(transactions.find((t) => t.type === "TAX")).toMatchObject({ tax: 0.5 });
    expect(skipped).toEqual([{ reason: "CFD positions", count: 1 }]);
  });

  it("reads the .xlsx account statement", async () => {
    const { template, transactions } = await importWorkbook("etoro-account-statement.xlsx");
    expect(template).toBe("etoro");
    expect(transactions.map((t) => t.type)).toEqual(["CUSTOMER_INBOUND", "BUY", "DIVIDEND", "SELL", "CUSTOMER_OUTBOUND"]);
    expect(transactions[1]).toMatchObject({ date: "2025-01-03", datetime: "2025-01-03T15:37:16", symbol: "AAPL", amount: 200 });
  });
});

describe("Interactive Brokers", () => {
  it("reads a Flex query of trades", () => {
    const { template, transactions, skipped } = importFixture("ibkr-flex-trades.csv");
    expect(template).toBe("ibkr");
    expect(transactions[0]).toMatchObject({ id: "5001", date: "2025-01-15", datetime: "2025-01-15T09:35:12", type: "BUY", symbol: "AAPL", amount: -2005, fee: 1 });
    expect(transactions.map((t) => t.symbol)).toEqual(["AAPL", "VWCE.DE", "VWRA.L", "BRK-B", "AAPL"]);
    expect(transactions[4]).toMatchObject({ type: "SELL", shares: -4, amount: 840 });
    expect(skipped).toEqual([{ reason: "Currency conversions (FX trades)", count: 1 }]);
  });

  it("reads a Flex query of cash transactions", () => {
    const { template, transactions } = importFixture("ibkr-flex-cash.csv");
    expect(template).toBe("ibkr");
    expect(transactions.map((t) => t.type)).toEqual(["CUSTOMER_INBOUND", "DIVIDEND", "TAX", "CUSTOMER_OUTBOUND", "INTEREST_PAYMENT", "FEE"]);
    expect(transactions[0]).toMatchObject({ date: "2025-01-10", amount: 3000 });
    expect(transactions[2]).toMatchObject({ tax: 0.23, currency: "USD" });
    expect(transactions[3]).toMatchObject({ amount: -500 });
  });

  it("reads the default activity statement", () => {
    const { template, transactions, skipped } = importFixture("ibkr-activity-statement.csv");
    expect(template).toBe("ibkr_statement");
    expect(transactions.map((t) => t.type)).toEqual([
      "BUY", "BUY", "SELL", "CUSTOMER_INBOUND", "CUSTOMER_OUTBOUND", "DIVIDEND", "TAX", "INTEREST_PAYMENT", "FEE",
    ]);
    expect(transactions[0]).toMatchObject({ symbol: "VWCE.DE", isin: "IE00BK5BQT80", shares: 5, amount: -600, fee: 1.25 });
    expect(transactions[1]).toMatchObject({ symbol: "AAPL", shares: 1000, datetime: "2025-01-15T09:35:12" });
    expect(transactions[5]).toMatchObject({ symbol: "AAPL", amount: 1.5, currency: "USD" });
    // Total, SubTotal and "Total in EUR" rows never become transactions.
    expect(transactions).toHaveLength(9);
    expect(skipped).toEqual([{ reason: "Currency conversions (FX trades)", count: 1 }]);
  });
});

describe("Revolut", () => {
  it("reads amounts written with a currency code", () => {
    const { template, transactions } = importFixture("revolut.csv");
    expect(template).toBe("revolut");
    expect(transactions.map((t) => t.type)).toEqual(["CUSTOMER_INBOUND", "BUY", "DIVIDEND", "FEE", "SELL", "CUSTOMER_OUTBOUND", "STOCK_SPLIT"]);
    expect(transactions[0]).toMatchObject({ amount: 1200, currency: "USD", symbol: "CASH" });
    expect(transactions[1]).toMatchObject({ symbol: "AAPL", shares: 0.5, price: 200, amount: 100 });
    expect(transactions[3]).toMatchObject({ fee: 0.01 });
    expect(transactions[6]!.amount).toBeUndefined();
  });

  it("reads the older dollar-sign export", () => {
    const { transactions } = importFixture("revolut-legacy.csv");
    expect(transactions[0]).toMatchObject({ type: "BUY", symbol: "O", shares: 1.5, price: 52.07, amount: 78.11 });
    expect(transactions[1]).toMatchObject({ type: "CUSTOMER_INBOUND", amount: 500 });
  });
});

describe("Scalable Capital", () => {
  it("reads the new broker export and leaves out orders that did not execute", () => {
    const { template, transactions, skipped } = importFixture("scalable.csv");
    expect(template).toBe("scalable");
    expect(transactions.map((t) => t.type)).toEqual(["CUSTOMER_INBOUND", "BUY", "BUY", "DIVIDEND", "SELL", "TAX", "CUSTOMER_OUTBOUND"]);
    expect(transactions[0]).toMatchObject({ id: "WWEK00000001", amount: 1500 });
    expect(transactions[2]).toMatchObject({ shares: 0.5, amount: -60, symbol: "IE00BK5BQT80" });
    expect(transactions[3]).toMatchObject({ amount: 2, tax: 0.3 });
    expect(transactions[5]).toMatchObject({ tax: 0.5 });
    expect(skipped).toEqual([{ reason: "Orders not executed (cancelled, rejected or pending)", count: 1 }]);
  });
});

describe("XTB", () => {
  it("reads shares and prices from the comment", () => {
    const { template, transactions } = importFixture("xtb-cash-operations.csv");
    expect(template).toBe("xtb");
    expect(transactions[1]).toMatchObject({ type: "BUY", symbol: "SPYL.DE", shares: 35, price: 11.74, amount: -410.9 });
    expect(transactions[2]).toMatchObject({ symbol: "SXR8.DE", shares: 0.5 });
    expect(transactions[4]).toMatchObject({ symbol: "GOOGL", shares: 1, amount: -138.5 });
    expect(transactions[4]!.price).toBeUndefined();
    expect(transactions[5]).toMatchObject({ symbol: "CSPX.L" });
    expect(transactions[6]).toMatchObject({ type: "SELL", shares: 5, amount: 60 });
  });

  it("books withholding and interest tax as tax", () => {
    const { transactions } = importFixture("xtb-cash-operations.csv");
    expect(transactions[8]).toMatchObject({ type: "TAX", tax: 0.03 });
    expect(transactions[9]).toMatchObject({ type: "INTEREST_PAYMENT", amount: 1.2 });
    expect(transactions[10]).toMatchObject({ type: "TAX", tax: 0.23 });
  });

  it("reads the .xlsx report with title rows and a total row", async () => {
    const { template, transactions, skipped } = await importWorkbook("xtb-cash-operations.xlsx");
    expect(template).toBe("xtb");
    expect(transactions.map((t) => t.id)).toEqual(["900000001", "900000002", "900000007", "900000008"]);
    expect(transactions[1]).toMatchObject({ date: "2025-04-02", shares: 35, symbol: "SPYL.DE" });
    expect(skipped).toEqual([{ reason: "Total and summary rows", count: 1 }]);
  });
});

describe("Saxo", () => {
  it("reads trades from the event text", () => {
    const { template, transactions } = importFixture("saxo.csv");
    expect(template).toBe("saxo");
    expect(transactions.map((t) => t.type)).toEqual(["CUSTOMER_INBOUND", "BUY", "SELL", "FEE", "BUY", "DIVIDEND"]);
    expect(transactions[1]).toMatchObject({ date: "2024-12-17", symbol: "NVDA", shares: 3, amount: -388.1 });
    expect(transactions[2]).toMatchObject({ symbol: "VWRA.L", shares: 1, amount: 124.5 });
    expect(transactions[4]).toMatchObject({ date: "2025-01-16", symbol: "VUSA.AS", shares: 1.5, price: 110.01 });
    expect(transactions[3]).toMatchObject({ fee: 0.42 });
  });
});

describe("generic files", () => {
  it("never dates a row today when its date cannot be read", () => {
    const table = parseCsvContent("Date,Type,Symbol,Amount\nnot a date,Buy,AAPL,10\n2025-01-02,Buy,AAPL,10\n");
    const { transactions, skipped } = importTable(table);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.date).toBe("2025-01-02");
    expect(skipped).toEqual([{ reason: "Rows with a date that could not be read", count: 1 }]);
  });

  it("finds the header row below title lines", () => {
    const table = parseCsvContent("Account statement\nPeriod: 2025\n\nDate;Type;Symbol;Amount\n02.01.2025;Deposit;;100,50\n");
    expect(table.headers).toEqual(["Date", "Type", "Symbol", "Amount"]);
    const { transactions } = importTable(table);
    expect(transactions[0]).toMatchObject({ date: "2025-01-02", type: "CUSTOMER_INBOUND", amount: 100.5 });
  });
});

describe("parseNumber edge cases", () => {
  it("reads grouping styles, currency prefixes and brackets", () => {
    expect(parseNumber("1 757,95")).toBe(1757.95);
    expect(parseNumber("1'234.50")).toBe(1234.5);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("1,234,567")).toBe(1234567);
    expect(parseNumber("€ 1.234,56")).toBe(1234.56);
    expect(parseNumber("EUR -1.234,56")).toBe(-1234.56);
    expect(parseNumber("(1,234.56)")).toBe(-1234.56);
  });

  it("reads unicode minus, dashes and plus", () => {
    expect(parseNumber("−3,5")).toBe(-3.5);
    expect(parseNumber("–2")).toBe(-2);
    expect(parseNumber("+5")).toBe(5);
  });

  it("reads zero, padded and exponent values", () => {
    expect(parseNumber("0")).toBe(0);
    expect(parseNumber("0,00")).toBe(0);
    expect(parseNumber(" 12 ")).toBe(12);
    expect(parseNumber("1.5e3")).toBe(1500);
  });

  it("reads a lone separator with three digits as a decimal", () => {
    expect(parseNumber("12,345")).toBe(12.345);
    expect(parseNumber("1.234")).toBe(1.234);
  });

  it("honours a fixed decimal separator", () => {
    expect(parseNumber("1.234", ",")).toBe(1234);
    expect(parseNumber("12.345", ",")).toBe(12345);
    expect(parseNumber("1,5", ".")).toBe(15);
    expect(parseNumber("1.234,5", ".")).toBe(1.2345);
  });

  it("returns undefined for missing or blank cells", () => {
    expect(parseNumber(undefined as any)).toBeUndefined();
    expect(parseNumber("   ")).toBeUndefined();
  });
});

describe("parseDate edge cases", () => {
  it("reads separators, day-first dates, padding and timestamps", () => {
    expect(parseDate("2025/01/15")).toBe("2025-01-15");
    expect(parseDate("2025.1.5")).toBe("2025-01-05");
    expect(parseDate("5.1.2025")).toBe("2025-01-05");
    expect(parseDate("  2025-01-15  ")).toBe("2025-01-15");
    expect(parseDate("2025-01-15T10:00:00Z")).toBe("2025-01-15");
  });

  it("reads month names in several languages", () => {
    expect(parseDate("15. Mär. 2025")).toBe("2025-03-15");
    expect(parseDate("1 févr. 2025")).toBe("2025-02-01");
    expect(parseDate("3 dic 2024")).toBe("2024-12-03");
    expect(parseDate("Dec 31 2024")).toBe("2024-12-31");
    expect(parseDate("December 31, 2024")).toBe("2024-12-31");
  });

  it("rejects out-of-range and malformed dates", () => {
    for (const s of ["2025-13-01", "1899-01-01", "32/01/2025", "00/01/2025", "Foo 3, 2025", "2025011", "202501150"]) {
      expect(parseDate(s)).toBeUndefined();
    }
  });

  it("rejects impossible calendar days", () => {
    expect(parseDate("2025-02-31")).toBeUndefined();
    expect(parseDate("31.04.2025")).toBeUndefined();
    expect(parseDate("2025-02-29")).toBeUndefined();
  });

  it("keeps a leap day", () => {
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
  });

  it("reads the German full month name März", () => {
    expect(parseDate("15 März 2025")).toBe("2025-03-15");
  });
});

describe("parseDateTime edge cases", () => {
  it("pads short times", () => {
    expect(parseDateTime("9:05", "2025-01-01")).toBe("2025-01-01T09:05:00");
    expect(parseDateTime("09:05:07", "2025-01-01")).toBe("2025-01-01T09:05:07");
  });

  it("joins a day-first date with its time only on the same day", () => {
    expect(parseDateTime("15.01.2025 09:30", "2025-01-15")).toBe("2025-01-15T09:30:00");
    expect(parseDateTime("15.01.2025 09:30", "2025-01-16")).toBe("15.01.2025 09:30");
  });

  it("keeps milliseconds and the zone", () => {
    expect(parseDateTime("2025-01-15 10:31:00.123Z", "2025-01-15")).toBe("2025-01-15T10:31:00.123Z");
  });

  it("returns undefined without a time", () => {
    expect(parseDateTime("noon", "2025-01-15")).toBeUndefined();
    expect(parseDateTime("", "")).toBeUndefined();
  });
});

describe("normalizeType languages", () => {
  it("maps broker words in several languages", () => {
    const cases: [string, string][] = [
      ["Kauf", "BUY"],
      ["Verkauf", "SELL"],
      ["Achat", "BUY"],
      ["Vente", "SELL"],
      ["Compra", "BUY"],
      ["Venta", "SELL"],
      ["Dividende", "DIVIDEND"],
      ["Zinsen", "INTEREST_PAYMENT"],
      ["Einzahlung", "CUSTOMER_INBOUND"],
      ["Auszahlung", "CUSTOMER_OUTBOUND"],
      ["Gebühr", "FEE"],
      ["Αγορά", "BUY"],
      ["Πώληση", "SELL"],
      ["Μέρισμα", "DIVIDEND"],
      ["Commission", "FEE"],
      ["Tax refund", "TAX"],
      ["buy  limit", "BUY"],
    ];
    for (const [input, expected] of cases) expect([input, normalizeType(input)]).toEqual([input, expected]);
  });

  it("keeps unknown types as written", () => {
    expect(normalizeType("Storno Kauf")).toBe("STORNO_KAUF");
    expect(normalizeType("Stock distribution")).toBe("STOCK_DISTRIBUTION");
    expect(normalizeType("Transfer in")).toBe("TRANSFER_IN");
    expect(normalizeType("")).toBe("");
  });
});

describe("normalizeHeader", () => {
  it("folds case, umlauts, accents and punctuation", () => {
    expect(normalizeHeader("Datum/Zeit")).toBe("datumzeit");
    expect(normalizeHeader("Gebühr (EUR)")).toBe("gebuehreur");
    expect(normalizeHeader("Größe")).toBe("groesse");
    expect(normalizeHeader("Prix unitaire €")).toBe("prixunitaire");
    expect(normalizeHeader("Ημερομηνία")).toBe("ημερομηνια");
    expect(normalizeHeader("No. of shares")).toBe("noofshares");
  });
});

describe("reading CSV text", () => {
  const HEADERS = ["Date", "Type", "Symbol", "Amount"];

  it("strips a BOM and reads CRLF lines", () => {
    const table = parseCsvContent('﻿Date,Type,Symbol,Amount\r\n2025-01-02,Buy,AAPL,"1,234.50"\r\n');
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toEqual([["2025-01-02", "Buy", "AAPL", "1,234.50"]]);
  });

  it("honours a sep= line", () => {
    const table = parseCsvContent("sep=;\nDate;Type;Symbol;Amount\n2025-01-02;Buy;AAPL;1,5\n");
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toEqual([["2025-01-02", "Buy", "AAPL", "1,5"]]);
  });

  it("detects tab and pipe delimiters", () => {
    for (const d of ["\t", "|"]) {
      const table = parseCsvContent(`Date${d}Type${d}Symbol${d}Amount\n2025-01-02${d}Buy${d}AAPL${d}10\n`);
      expect(table.headers).toEqual(HEADERS);
      expect(table.rows).toEqual([["2025-01-02", "Buy", "AAPL", "10"]]);
    }
  });

  it("reads quoted line breaks and doubled quotes", () => {
    const table = parseCsvContent('Date,Type,Name,Amount\n2025-01-02,Buy,"Line one\nline ""two""",10\n');
    expect(table.rows).toEqual([["2025-01-02", "Buy", 'Line one\nline "two"', "10"]]);
  });

  it("pads short rows, drops empty rows and keeps long rows", () => {
    const table = parseCsvContent("Date,Type,Symbol,Amount\n2025-01-02,Buy,AAPL\n\n,,,\n2025-01-03,Sell,AAPL,5,extra\n");
    expect(table.rows).toEqual([
      ["2025-01-02", "Buy", "AAPL", ""],
      ["2025-01-03", "Sell", "AAPL", "5", "extra"],
    ]);
  });

  it("trims cells and drops one leading apostrophe", () => {
    const table = parseCsvContent("Date,Type,Symbol,Amount\n2025-01-02,Buy,'=SUM(A1),  10  ");
    expect(table.rows).toEqual([["2025-01-02", "Buy", "=SUM(A1)", "10"]]);
  });

  it("names empty headers after the previous one", () => {
    expect(parseCsvContent("Date,Type,,Amount,\n1,2,3,4,5").headers).toEqual(["Date", "Type", "Type (2)", "Amount", "Amount (2)"]);
  });

  it("returns an empty table for empty input", () => {
    expect(parseCsvContent("")).toEqual({ headers: [], rows: [] });
    expect(tableFromRecords([])).toEqual({ headers: [], rows: [] });
  });

  it("uses the first row when no known header is found", () => {
    expect(findHeaderRow([["a", "b"], ["c", "d"]])).toBe(0);
  });
});

describe("template detection and mapping", () => {
  it("falls back to auto for generic headers", () => {
    expect(detectBestTemplate(["Date", "Type", "Symbol"])).toBe("auto");
    expect(detectBestTemplate([])).toBe("auto");
  });

  it("needs the required headers of a template", () => {
    expect(detectBestTemplate(["Action", "Time", "No. of shares", "Price / share"])).toBe("trading212");
    expect(detectBestTemplate(["No. of shares", "Price / share"])).toBe("auto");
  });

  it("auto-maps known headers once", () => {
    const result = applyTemplateToHeaders("auto", ["Date", "Type", "Ticker", "Quantity", "Price", "Total", "Commission", "Currency", "ISIN", "Status", "Datum"]);
    expect(result).toEqual({ mappings: ["date", "type", "symbol", "shares", "price", "amount", "fee", "currency", "isin", "status", "none"] } as any);
    expect(result.defaultCurrency).toBeUndefined();
  });

  it("auto-detects for an unknown template id", () => {
    expect(applyTemplateToHeaders("nope", ["Date", "Date"]).mappings).toEqual(["date", "none"] as any);
  });

  it("finds templates by id", () => {
    expect(findTemplate("xtb")?.name).toBe("XTB");
    expect(findTemplate("nope")).toBeUndefined();
    expect(CSV_TEMPLATES.map((t) => t.id)).toEqual([
      "trade_republic",
      "trading212",
      "ibkr",
      "ibkr_statement",
      "degiro",
      "degiro_account",
      "etoro",
      "revolut",
      "xtb",
      "scalable",
      "scalable_baader",
      "saxo",
      "auto",
    ]);
  });

  it("matches upper-case ISINs with a valid layout", () => {
    expect(ISIN_PATTERN.test("US0378331005")).toBe(true);
    expect(ISIN_PATTERN.test("us0378331005")).toBe(false);
    expect(ISIN_PATTERN.test("US037833100X")).toBe(false);
  });
});

describe("building generic transactions", () => {
  it("upper-cases symbols and stores fees positive", () => {
    const { template, transactions } = importText(
      "Date,Type,Symbol,Shares,Price,Amount,Fee,Tax,Currency\n2025-01-02,Buy,aapl,2,100,-200,-1,,usd\n2025-01-03,Sell,AAPL,-1,110,110,1,,USD\n",
    );
    expect(template).toBe("auto");
    expect(transactions[0]).toMatchObject({ id: "tx_2025-01-02_BUY_AAPL_-200_2_0", type: "BUY", symbol: "AAPL", shares: 2, price: 100, amount: -200, fee: 1, currency: "USD" });
    expect(transactions[0].tax).toBeUndefined();
    expect(transactions[1]).toMatchObject({ id: "tx_2025-01-03_SELL_AAPL_110_-1_1", type: "SELL", shares: -1, amount: 110, fee: 1 });
  });

  it("uses the sign of shares without a type column", () => {
    const { transactions } = importText("Date,Symbol,Shares,Amount\n2025-01-02,AAPL,2,-200\n2025-01-03,AAPL,-1,110\n");
    expect(transactions.map((t) => t.type)).toEqual(["BUY", "SELL"] as any);
    expect(transactions[0].currency).toBe("EUR");
  });

  it("skips orders that did not execute", () => {
    const { transactions, skipped } = importText(
      "Date,Type,Symbol,Amount,Status\n2025-01-02,Buy,AAPL,10,Cancelled\n2025-01-02,Buy,AAPL,10,Executed\n2025-01-02,Buy,AAPL,10,\n",
    );
    expect(transactions.length).toBe(2);
    expect(skipped).toEqual([{ reason: "Orders not executed (cancelled, rejected or pending)", count: 1 }]);
  });

  it("skips empty and total rows", () => {
    const { transactions, skipped } = importText("Date,Type,Symbol,Amount\n2025-01-02,Buy,AAPL,0\n2025-01-02,Deposit,,100\nTotal,,,100\n");
    expect(transactions.length).toBe(1);
    expect(transactions[0]).toMatchObject({ type: "CUSTOMER_INBOUND", symbol: "CASH", amount: 100 });
    expect(skipped).toEqual([
      { reason: "Rows without an amount, shares, fee or tax", count: 1 },
      { reason: "Total and summary rows", count: 1 },
    ]);
  });

  it("flips tax signs when the file writes paid tax as negative", () => {
    const head = "Date,Type,Symbol,Amount,Tax\n";
    const file = (a: string, b: string) => `${head}2025-01-02,Dividend,AAPL,10,${a}\n2025-01-03,Dividend,AAPL,10,${b}\n`;
    expect(importText(file("-1.5", "0.5")).transactions.map((t) => t.tax)).toEqual([1.5, -0.5]);
    expect(importText(file("1.5", "-0.5")).transactions.map((t) => t.tax)).toEqual([-1.5, 0.5]);
    expect(importText(file("1.5", "0.5")).transactions.map((t) => t.tax)).toEqual([1.5, 0.5]);
  });

  it("applies the cash conventions", () => {
    const { transactions, skipped } = importText(
      "Date,Type,Symbol,Amount\n2025-01-02,Tax,AAPL,-3\n2025-01-02,Fee,,-2\n2025-01-02,Fee,,2\n2025-01-02,Dividend,AAPL,-1\n2025-01-02,Interest,,-1\n2025-01-02,Deposit,,-50\n2025-01-02,Stock split,AAPL,5\n",
    );
    expect(transactions.length).toBe(6);
    expect(transactions).toMatchObject([
      { type: "TAX", symbol: "AAPL", tax: 3 },
      { type: "FEE", symbol: "CASH", fee: 2 },
      { type: "FEE_REFUND", amount: 2 },
      { type: "DIVIDEND_CORRECTION", amount: -1 },
      { type: "INTEREST_CHARGE", amount: -1 },
      { type: "CUSTOMER_OUTBOUND", amount: -50 },
    ] as any);
    expect(transactions[0].amount).toBeUndefined();
    expect(transactions[1].amount).toBeUndefined();
    expect(skipped).toEqual([{ reason: "Rows without an amount, shares, fee or tax", count: 1 }]);
  });

  it("normalises symbols and ISINs", () => {
    const { transactions } = importText(
      "Date,Type,Symbol,ISIN,Amount,Currency\n2025-01-02,Buy,VWCE,IE00BK5BQT80,-100,EUR\n2025-01-02,Buy,BRK.B,US0846707026,-100,USD\n2025-01-02,Buy,BRK B,,-100,USD\n2025-01-02,Buy,,IE00BK5BQT80,-100,EUR\n2025-01-02,Buy,ie00bk5bqt80,,-100,EUR\n",
    );
    expect(transactions.map((t) => t.symbol)).toEqual(["IE00BK5BQT80", "BRK-B", "BRK-B", "IE00BK5BQT80", "IE00BK5BQT80"]);
    expect(transactions.map((t) => t.isin)).toEqual(["IE00BK5BQT80", "US0846707026", undefined, "IE00BK5BQT80", "IE00BK5BQT80"]);
  });

  it("numbers repeated broker ids", () => {
    const row = "2025-01-02,Buy,AAPL,10,X1\n";
    const { transactions } = importText("Date,Type,Symbol,Amount,ID\n" + row + row + row + "2025-01-02,Buy,AAPL,10,\n");
    expect(transactions.map((t) => t.id)).toEqual(["X1", "X1#2", "X1#3", "tx_2025-01-02_BUY_AAPL_10__3"]);
  });

  it("assigns asset classes", () => {
    const { transactions } = importText(
      "Date,Type,Symbol,Amount,Asset Class\n2025-01-02,Buy,,10,PRIVATE_FUND\n2025-01-02,Buy,BTC-EUR,10,\n2025-01-02,Buy,XYZ,10,Private Equity\n",
    );
    expect(transactions).toMatchObject([
      { symbol: "LU3176111881", assetClass: "PRIVATE_FUND" },
      { symbol: "BTC-EUR", assetClass: "CRYPTO" },
      { symbol: "XYZ", assetClass: "PRIVATE_FUND" },
    ] as any);
  });

  it("reads a German generic file", () => {
    const { transactions } = importText("Datum;Typ;Symbol;Betrag\n02.01.2025;Kauf;SAP;-1.234,56\n");
    expect(transactions[0]).toMatchObject({ date: "2025-01-02", type: "BUY", symbol: "SAP", amount: -1234.56, currency: "EUR" });
  });

  it("upper-cases the default currency option", () => {
    const table = parseCsvContent("Date,Type,Symbol,Amount\n2025-01-02,Buy,AAPL,10\n");
    const { mappings } = applyTemplateToHeaders("auto", table.headers);
    const { transactions } = buildTransactions(table, mappings, { templateId: "auto", defaultCurrency: "gbp" });
    expect(transactions[0].currency).toBe("GBP");
  });

  it("reads a time column and timestamps in the date column", () => {
    const { transactions } = importText("Date,Time,Type,Symbol,Amount\n2025-01-02,14:05,Buy,AAPL,10\n2025-01-02 09:01:02,,Buy,AAPL,10\n");
    expect(transactions.map((t) => t.datetime)).toEqual(["2025-01-02T14:05:00", "2025-01-02T09:01:02"]);
    expect(transactions.map((t) => t.date)).toEqual(["2025-01-02", "2025-01-02"]);
  });
});

describe("Interactive Brokers rules", () => {
  it("skips derivatives, cancelled trades, summaries and FX and maps exchanges", () => {
    const text =
      "ClientAccountID,CurrencyPrimary,AssetClass,Symbol,ISIN,ListingExchange,TradeDate,Quantity,TradePrice,Proceeds,IBCommission,Buy/Sell,TransactionID,LevelOfDetail\n" +
      [
        "U1,USD,OPT,AAPL 250117C00200000,,CBOE,20250115,1,2,-200,-1,BUY,1,EXECUTION",
        "U1,USD,FUT,ES,,CME,20250115,1,2,-200,-1,BUY,2,EXECUTION",
        "U1,USD,STK,AAPL,US0378331005,NASDAQ,20250115,1,200,-200,-1,BUY (Ca.),3,EXECUTION",
        "U1,USD,STK,AAPL,US0378331005,NASDAQ,20250115,1,200,-200,-1,BUY,4,ORDER",
        "U1,GBP,STK,VUSA,IE00B3XXRP09,LSE,20250115,1,70,-70,-1,BUY,5,EXECUTION",
        'U1,EUR,STK,SAP,DE0007164600,IBIS,20250115,1,1000,"-1,000",-1,BUY,6,EXECUTION',
        "U1,USD,STK,BRK B,US0846707026,NYSE,20250115,1,1000,-1000,-1,BUY,7,EXECUTION",
        "U1,USD,CASH,EUR.USD,,IDEALFX,20250115,1,1,-1,0,BUY,8,EXECUTION",
        "U1,CAD,STK,SHOP,CA82509L1076,TSE,20250115,1,1,-1,0,BUY,9,EXECUTION",
      ].join("\n") +
      "\n";
    const { template, transactions, skipped } = importText(text);
    expect(template).toBe("ibkr");
    expect(transactions.map((t) => t.id)).toEqual(["5", "6", "7", "9"]);
    expect(transactions.map((t) => t.symbol)).toEqual(["VUSA.L", "SAP.DE", "BRK-B", "SHOP.TO"]);
    expect(transactions.find((t) => t.id === "6")?.amount).toBe(-1000);
    expect(skipped).toEqual([
      { reason: "Options, futures, bonds and other derivatives", count: 2 },
      { reason: "Cancelled trades", count: 1 },
      { reason: "Order summaries and closed lots (the executions are imported)", count: 1 },
      { reason: "Currency conversions (FX trades)", count: 1 },
    ]);
  });
});
