import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyTemplateToHeaders,
  buildTransactions,
  decodeCsvBytes,
  detectBestTemplate,
  normalizeType,
  parseCsvContent,
  parseDate,
  parseDateTime,
  parseNumber,
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
