/** Money and percent formatting: symbols, masking, rounding and the number format cache. */
import { describe, expect, it } from "bun:test";
import { fmtCurrency, fmtPercent, formatMoney, numberFormat } from "../format";

describe("fmtCurrency", () => {
  it("prints zero with the currency symbol for a missing amount", () => {
    expect(fmtCurrency(undefined, "USD")).toBe("$0.00");
    expect(fmtCurrency(NaN, "CHF")).toBe("Fr 0.00");
    expect(fmtCurrency(undefined, "GBP")).toBe("£0.00");
    expect(fmtCurrency(undefined)).toBe("€0.00");
  });

  it("defaults to the euro", () => {
    expect(fmtCurrency(5)).toBe("€5.00");
  });

  it("falls back to the euro sign for an unknown currency", () => {
    expect(fmtCurrency(5, "JPY")).toBe("€5.00");
  });

  it("rounds half up at 2 decimals", () => {
    expect(fmtCurrency(0.005)).toBe("€0.01");
  });

  it("masks the amount when values are hidden", () => {
    expect(fmtCurrency(1234.5, "CHF", true)).toBe("Fr ••••");
    expect(fmtCurrency(1, "USD", true)).toBe("$••••");
  });

  it("does not mask a missing amount", () => {
    expect(fmtCurrency(undefined, "USD", true)).toBe("$0.00");
  });

  it("groups thousands", () => {
    expect(fmtCurrency(1234567.891, "USD")).toBe("$1,234,567.89");
  });
});

describe("formatMoney", () => {
  it("keeps up to maxDecimals", () => {
    expect(formatMoney(1234.5678, "EUR", 4)).toBe("€1,234.5678");
  });

  it("keeps at least 2 decimals", () => {
    expect(formatMoney(1, "GBP", 4)).toBe("£1.00");
  });

  it("uses maxDecimals as the minimum when it is below 2", () => {
    expect(formatMoney(1.5, "GBP", 1)).toBe("£1.5");
  });

  it("masks through fmtCurrency", () => {
    expect(formatMoney(5, "USD", 2, true)).toBe("$••••");
  });

  it("prints euro zero for a missing euro amount", () => {
    expect(formatMoney(undefined, "EUR")).toBe("€0.00");
  });

  // Suspected bug: modules/shared/src/format.ts:31 formatMoney ignores the currency for a missing amount
  it.failing("prints zero with the currency's own symbol for a missing amount", () => {
    expect(formatMoney(undefined, "USD")).toBe("$0.00");
    expect(formatMoney(NaN, "GBP")).toBe("£0.00");
  });
});

describe("fmtPercent", () => {
  it("signs positives and rounds to 2 decimals", () => {
    expect(fmtPercent(1.234)).toBe("+1.23%");
    expect(fmtPercent(-1.235)).toBe("-1.24%");
    expect(fmtPercent(0)).toBe("0.00%");
  });

  it("prints zero for a missing value", () => {
    expect(fmtPercent(undefined)).toBe("0.00%");
    expect(fmtPercent(NaN)).toBe("0.00%");
  });

  it("keeps the plus on a tiny positive", () => {
    expect(fmtPercent(0.004)).toBe("+0.00%");
  });
});

describe("numberFormat", () => {
  it("honours the locale", () => {
    expect(numberFormat("de-DE", 2, 2).format(1234.5)).toBe("1.234,50");
  });

  it("caches one instance per locale and digits", () => {
    expect(numberFormat("de-DE", 2, 2)).not.toBe(numberFormat("en-US", 2, 2));
    expect(numberFormat("de-DE", 2, 2)).toBe(numberFormat("de-DE", 2, 2));
  });
});
