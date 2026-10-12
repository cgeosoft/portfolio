/**
 * Checks at the edges of the metric sandbox that need no compiled module:
 * manifest parsing of untrusted YAML, the scope boundary of the payload, the
 * privacy mask of module output, and the ids an evaluation request may name.
 */

import { describe, expect, it } from "bun:test";
import type { FinancialPortfolioData, PortfolioSummary } from "portfolio-shared/portfolio";
import { FUNDAMENTAL_FIELDS, FUNDAMENTAL_RECORD_PREFIX_BYTES } from "portfolio-shared/metric-abi";
import { validateMetricManifest } from "portfolio-shared/metric-manifest";
import { renderMetricOutput, type MetricOutput } from "portfolio-shared/metric-output";
import { MAX_METRIC_IDS_PER_REQUEST, readMetricIds } from "portfolio-shared/metrics";
import { parseManifestYaml } from "../metrics/manifest.js";
import { encodeMetricPayload } from "../metrics/payload.js";

const manifestYaml = (scopes: string, before = "") => `${before}schema: 1
abi: 2
id: acme-fixture
name: Acme Fixture
version: 1.2.3
developer:
  name: Acme
license: MIT
category: Testing
icon: gauge
accent: pink
summary: Test fixture.
description: Returns the total fees.
importance: None.
scopes: ${scopes}
display:
  defaultSize: compact
  valueFormat: currency
module:
  url: module.wasm
  sha256: "${"a".repeat(64)}"
  size: 100
`;

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

describe("Metric manifest", () => {
  it("parses a valid manifest", () => {
    expect(parseManifestYaml(manifestYaml("[portfolio.summary]")).scopes).toEqual(["portfolio.summary"]);
  });

  it("rejects an alias bomb before anything expands it", () => {
    // Seven levels of nine aliases: about 4.8 million values from a few hundred bytes. Bun parses it.
    let anchors = `l0: &l0 [${Array(9).fill('"x"').join(", ")}]\n`;
    for (let i = 1; i < 7; i++) anchors += `l${i}: &l${i} [${Array(9).fill(`*l${i - 1}`).join(", ")}]\n`;
    const started = performance.now();
    expect(() => parseManifestYaml(manifestYaml("[*l6]", anchors))).toThrow(/more than 5000 values/);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("names an unknown scope without serializing it", () => {
    const base = parseManifestYaml(manifestYaml("[portfolio.summary]"));
    expect(errorOf(() => validateMetricManifest({ ...base, scopes: [["portfolio.summary"]] }))).toBe("manifest scopes contains unknown scope a list");
    expect(errorOf(() => validateMetricManifest({ ...base, scopes: [{ a: 1 }] }))).toBe("manifest scopes contains unknown scope a mapping");
    expect(errorOf(() => validateMetricManifest({ ...base, scopes: [7] }))).toBe("manifest scopes contains unknown scope 7");
    const long = errorOf(() => validateMetricManifest({ ...base, scopes: ["y".repeat(5000)] }));
    expect(long).toStartWith('manifest scopes contains unknown scope "yyy');
    expect(long.length).toBeLessThan(100);
  });
});

describe("Metric payload", () => {
  const data: FinancialPortfolioData = {
    summary: undefined as unknown as PortfolioSummary,
    holdings: [],
    chartHistory: [],
    individualCharts: {},
    transactions: [],
  };

  /** Symbols of the fundamentals block, in payload order. */
  function fundamentalSymbols(payload: Uint8Array): string[] {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const offset = view.getUint32(32, true);
    const count = view.getUint32(offset, true);
    const record = FUNDAMENTAL_RECORD_PREFIX_BYTES + FUNDAMENTAL_FIELDS.length * 8;
    return Array.from({ length: count }, (_, i) => {
      const base = offset + 8 + i * record;
      const start = view.getUint32(base, true);
      return new TextDecoder().decode(payload.subarray(start, start + view.getUint32(base + 4, true)));
    });
  }

  it("orders fundamentals by symbol, not by position size", () => {
    // Rows arrive in holdings order, largest position first.
    const rows = ["MSFT", "AAPL", "NVDA"].map((symbol) => ({ symbol, isFund: false, values: { beta: 1 } }));
    const payload = encodeMetricPayload(data, ["market.fundamentals"], { fundamentals: rows });
    expect(fundamentalSymbols(payload)).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(rows.map((row) => row.symbol)).toEqual(["MSFT", "AAPL", "NVDA"]);
  });
});

describe("Metric output", () => {
  const output: MetricOutput = {
    value: { amount: 123456.78, format: "number" },
    sub: [
      { text: "AAPL 120 sh, ١٢٣ " },
      { amount: 5, format: "percent" },
      { text: " " },
      { amount: 7, format: "none" },
      { text: " " },
      { amount: 9, format: "currency" },
    ],
  };
  const fmt = {
    currency: (amount: number | undefined) => (amount === undefined ? "€0.00" : "€••••"),
    percent: (value: number | undefined) => `+${(value ?? 0).toFixed(2)}%`,
  };

  it("hides every figure when asked, digits of any script included", () => {
    const rendered = renderMetricOutput(output, { ...fmt, hideFigures: true });
    expect(rendered.value).toBe("••••");
    expect(rendered.sub).toBe("AAPL ••• sh, ••• ••••% •••• €••••");
  });

  it("keeps figures that the currency mask does not cover otherwise", () => {
    const rendered = renderMetricOutput(output, fmt);
    expect(rendered.value).toBe("123456.78");
    expect(rendered.sub).toBe("AAPL 120 sh, ١٢٣ +5.00% 7 €••••");
  });
});

describe("Metric evaluation request", () => {
  it("keeps valid ids once and caps the list", () => {
    expect(readMetricIds(["broker-fees", "broker-fees", "../etc", 7, "Bad Id", "day-gain-loss"])).toEqual(["broker-fees", "day-gain-loss"]);
    expect(readMetricIds(Array.from({ length: 500 }, (_, i) => `metric-${i}`))).toHaveLength(MAX_METRIC_IDS_PER_REQUEST);
    expect(readMetricIds("broker-fees")).toBeUndefined();
    expect(readMetricIds(undefined)).toBeUndefined();
  });
});
