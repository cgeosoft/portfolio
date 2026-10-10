import { describe, it, expect } from "bun:test";
import { maskFinancialValues } from "./utils";

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
});
