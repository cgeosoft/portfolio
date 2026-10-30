/**
 * Binary layout of the metric payload: header slots, record sizes, string
 * deduplication, the ABI 1 layout, non-finite values, truncation, the size
 * limit, and the ABI helpers in metric-abi.
 */

import { describe, expect, it } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding, PortfolioSummary, PortfolioTransaction } from "portfolio-shared/portfolio";
import {
  FUNDAMENTAL_FIELDS,
  METRIC_PAYLOAD_MAGIC,
  METRIC_SCOPES,
  classifyTransactionType,
  isMetricScope,
  isSupportedMetricAbi,
  metricScopeProviders,
  payloadHeaderBytes,
} from "portfolio-shared/metric-abi";
import { MAX_PAYLOAD_BYTES, encodeMetricPayload } from "../metrics/payload.js";

const view = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);
const u32 = (p: Uint8Array, off: number) => view(p).getUint32(off, true);
const f64 = (p: Uint8Array, off: number) => view(p).getFloat64(off, true);
const u32s = (p: Uint8Array, off: number, n: number) => Array.from({ length: n }, (_, i) => u32(p, off + i * 4));
const f64s = (p: Uint8Array, off: number, n: number) => Array.from({ length: n }, (_, i) => f64(p, off + i * 8));
const text = (p: Uint8Array) => new TextDecoder().decode(p);

const TRANSACTION_BYTES = 72;

function holding(overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    symbol: "AAPL", name: "AAPL", assetType: "Stock", shares: 12, buyPrice: 100, currentPrice: 150, previousClose: 149,
    totalCost: 1200, currentValue: 1800, dayChangeDollar: 12, dayChangePercent: 0.67, totalGainLossDollar: 600,
    totalGainLossPercent: 50, weightPercent: 10.5, currency: "USD",
    ...overrides,
  };
}

function data(extra: Partial<FinancialPortfolioData> = {}): FinancialPortfolioData {
  return { summary: undefined as unknown as PortfolioSummary, holdings: [], chartHistory: [], individualCharts: {}, transactions: [], ...extra };
}

const full = data({
  holdings: [holding()],
  chartHistory: [{ date: "2026-01-02", timestamp: 1767312000000, totalValue: 1200, totalCost: 1200, totalGainLoss: 0, totalPortfolioValue: 1300 }],
  transactions: [
    { id: "t1", date: "2026-01-02", datetime: "2026-01-02T10:00:00Z", type: "BUY", symbol: "AAPL", shares: 12, price: 100, amount: 1200, fee: 1, tax: 0 },
    { id: "t2", date: "2026-02-02", type: "DIVIDEND", symbol: "AAPL", amount: 5.5, fee: 0, tax: 0.8 },
  ],
});
const fundamentals = [{ symbol: "AAPL", isFund: true, values: { beta: 1.1, peRatio: Infinity, marketCap: 0 } }];
const encodeFull = () => encodeMetricPayload(full, [...METRIC_SCOPES], { abi: 2, fundamentals });

describe("Metric payload layout (ABI 2)", () => {
  it("writes the header, the regions and deduplicated strings", () => {
    const p = encodeFull();
    expect(p.length).toBe(784);
    expect(u32s(p, 0, 10)).toEqual([1413827920, 2, 31, 40, 224, 376, 528, 768, 584, 0]);
    expect(u32(p, 0)).toBe(METRIC_PAYLOAD_MAGIC);
    expect(text(p.subarray(0, 4))).toBe("PMET");
    expect(text(p.subarray(768, 784))).toBe("AAPLBUYDIVIDEND\0");
    for (const offset of u32s(p, 12, 6)) {
      if (offset !== 0) expect(offset % 8).toBe(0);
    }
  });

  it("writes a holding record", () => {
    const p = encodeFull();
    const base = 224 + 8;
    expect(u32s(p, base, 3)).toEqual([768, 4, 1]);
    expect(f64s(p, base + 16, 16)).toEqual([12, 100, 150, 149, 1200, 1800, 12, 0.67, 600, 50, 10.5, 0, 0, 0, 0, 0]);
  });

  it("writes transaction records", () => {
    const p = encodeFull();
    expect(u32s(p, 376, 2)).toEqual([2, 6]);
    const r0 = 384;
    expect(u32s(p, r0, 5)).toEqual([768, 4, 772, 3, 1]);
    expect(f64s(p, r0 + 24, 6)).toEqual([1767348000000, 12, 100, 1200, 1, 0]);
    const r1 = r0 + TRANSACTION_BYTES;
    expect(u32s(p, r1, 5)).toEqual([768, 4, 775, 8, 3]);
    expect(f64s(p, r1 + 24, 6)).toEqual([1769990400000, 0, 0, 5.5, 0, 0.8]);
  });

  it("writes history records", () => {
    const p = encodeFull();
    expect(u32s(p, 528, 2)).toEqual([1, 6]);
    expect(f64s(p, 536, 6)).toEqual([1767312000000, 1200, 1200, 0, 0, 1300]);
  });

  it("writes fundamentals records with NaN for unknown values", () => {
    const p = encodeFull();
    expect(u32s(p, 584, 2)).toEqual([1, 20]);
    const base = 592;
    expect(u32(p, base + 8)).toBe(1);
    const values = f64s(p, base + 16, 20);
    FUNDAMENTAL_FIELDS.forEach((field, i) => {
      if (field === "beta") expect(values[i]).toBe(1.1);
      else if (field === "marketCap") expect(values[i]).toBe(0);
      else expect(values[i]).toBeNaN();
    });
  });

  it("writes only the header for no scopes", () => {
    const p = encodeMetricPayload(full, []);
    expect(p.length).toBe(40);
    expect(u32s(p, 0, 10)).toEqual([METRIC_PAYLOAD_MAGIC, 2, 0, 0, 0, 0, 0, 40, 0, 0]);
  });

  it("defaults to ABI 2", () => {
    expect(u32(encodeMetricPayload(full, ["portfolio.summary"]), 4)).toBe(2);
  });
});

describe("Metric payload layout (ABI 1)", () => {
  it("has no fundamentals slot and carries no fundamentals", () => {
    const p = encodeMetricPayload(full, [...METRIC_SCOPES], {
      abi: 1,
      fundamentals: [{ symbol: "ZZZ", isFund: false, values: { beta: 1 } }],
    });
    expect(p.length).toBe(592);
    expect(u32s(p, 0, 8)).toEqual([METRIC_PAYLOAD_MAGIC, 1, 15, 32, 216, 368, 520, 576]);
    expect(u32(p, 32)).toBe(22);
    expect(text(p)).not.toContain("ZZZ");
  });
});

describe("Metric payload values", () => {
  const holdingAssetType = (h: PortfolioHolding) => u32(encodeMetricPayload(data({ holdings: [h] }), ["portfolio.holdings"]), 40 + 8 + 8);

  it("maps asset types", () => {
    expect(holdingAssetType(holding({ assetType: "Cash" }))).toBe(5);
    expect(holdingAssetType(holding({ assetType: "MutualFund" }))).toBe(3);
    expect(holdingAssetType(holding({ assetType: "Crypto" }))).toBe(4);
    expect(holdingAssetType(holding({ assetType: "Bond" as PortfolioHolding["assetType"] }))).toBe(0);
  });

  it("maps transaction kinds and bad dates", () => {
    const tx = (overrides: Partial<PortfolioTransaction>) => {
      const p = encodeMetricPayload(
        data({ transactions: [{ id: "x", date: "2026-01-02", type: "BUY", symbol: "XMPL", amount: 1, ...overrides }] }),
        ["portfolio.transactions"],
      );
      const r = u32(p, 20) + 8;
      return { typeLength: u32(p, r + 12), kind: u32(p, r + 16), timestamp: f64(p, r + 24) };
    };
    expect(tx({ type: "interest_payment" }).kind).toBe(4);
    expect(tx({ type: "STOCKPERK" }).kind).toBe(1);
    expect(tx({ type: "TRANSFER_OUTBOUND" }).kind).toBe(6);
    expect(tx({ type: "SWAP" }).kind).toBe(0);
    const empty = tx({ type: "" });
    expect(empty.kind).toBe(0);
    expect(empty.typeLength).toBe(0);
    expect(tx({ date: "bad" }).timestamp).toBe(0);
    expect(classifyTransactionType(null as unknown as string)).toBe("Other");
    expect(classifyTransactionType("customer_inbound")).toBe("Deposit");
  });

  it("writes non-finite summary values as 0", () => {
    const s = { totalFees: NaN, totalTaxes: Infinity } as unknown as PortfolioSummary;
    const p = encodeMetricPayload(data({ summary: s }), ["portfolio.summary"]);
    const off = u32(p, 12);
    expect(f64(p, off + 8 + 15 * 8)).toBe(0);
    expect(f64(p, off + 8 + 16 * 8)).toBe(0);
  });

  it("keeps the newest 50,000 transactions and 20,000 history points", () => {
    const transactions = Array.from({ length: 50_001 }, (_, i) => ({ id: `t${i}`, date: "2026-01-02", type: "BUY", symbol: "", amount: i }));
    const p = encodeMetricPayload(data({ transactions }), ["portfolio.transactions"]);
    const off = u32(p, 20);
    expect(u32(p, off)).toBe(50_000);
    expect(f64(p, off + 8 + 24 + 3 * 8)).toBe(1);
    expect(f64(p, off + 8 + 49_999 * TRANSACTION_BYTES + 24 + 3 * 8)).toBe(50_000);

    const chartHistory = Array.from({ length: 20_001 }, (_, i) => ({
      date: "2026-01-02", timestamp: i, totalValue: i, totalCost: 0, totalGainLoss: 0,
    }));
    const h = encodeMetricPayload(data({ chartHistory }), ["portfolio.history"]);
    expect(u32(h, u32(h, 24))).toBe(20_000);
  });

  it("refuses a payload over the size limit", () => {
    expect(MAX_PAYLOAD_BYTES).toBe(8 * 1024 * 1024);
    const holdings = Array.from({ length: 60_000 }, () => holding({ symbol: "" }));
    expect(() => encodeMetricPayload(data({ holdings }), ["portfolio.holdings"])).toThrow("Metric payload exceeds the size limit");
  });

  it("stores string lengths in UTF-8 bytes", () => {
    const p = encodeMetricPayload(data({ holdings: [holding({ symbol: "ÄÖ" })] }), ["portfolio.holdings"]);
    expect(u32(p, u32(p, 16) + 8 + 4)).toBe(4);
  });

  it("does not mutate its input", () => {
    const holdings = [holding({ symbol: "BBB" }), holding({ symbol: "AAA" })];
    const before = structuredClone(holdings);
    encodeMetricPayload(data({ holdings }), [...METRIC_SCOPES]);
    expect(holdings).toEqual(before);
  });
});

describe("Metric ABI helpers", () => {
  it("answers the ABI and scope questions", () => {
    expect(isSupportedMetricAbi(1)).toBe(true);
    expect(isSupportedMetricAbi(2)).toBe(true);
    expect(isSupportedMetricAbi(3)).toBe(false);
    expect(payloadHeaderBytes(1)).toBe(32);
    expect(payloadHeaderBytes(2)).toBe(40);
    expect(payloadHeaderBytes(5)).toBe(40);
    expect(metricScopeProviders(["market.fundamentals", "market.fundamentals", "portfolio.summary"])).toEqual(["fmp"]);
    expect(isMetricScope("portfolio.Summary")).toBe(false);
  });
});
