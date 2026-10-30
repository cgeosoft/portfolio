/**
 * Shared harness for the metric tests under extras/metrics. Compiles each
 * module in-process with the flags of scripts/build-metrics.ts, runs it in a
 * fresh memory the way the engine does, and parses the output with the same
 * parser the service uses.
 */

import { expect } from "bun:test";
import asc from "assemblyscript/asc";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeMetricPayload, type MetricFundamentalsRow } from "../../../modules/service/src/services/metrics/payload.ts";
import { parseManifestYaml } from "../../../modules/service/src/services/metrics/manifest.ts";
import { parseMetricOutput, type MetricOutput } from "../../../modules/shared/src/metric-output.ts";
import {
  MAX_METRIC_MEMORY_PAGES,
  METRIC_ABI_VERSION,
  MIN_METRIC_MEMORY_PAGES,
  type FundamentalField,
  type MetricScope,
} from "../../../modules/shared/src/metric-abi.ts";
import type { MetricManifest } from "../../../modules/shared/src/metric-manifest.ts";
import type {
  FinancialPortfolioData,
  PortfolioHistoricalPoint,
  PortfolioHolding,
  PortfolioSummary,
  PortfolioTransaction,
} from "../../../modules/shared/src/portfolio.ts";

export const ROOT = resolve(import.meta.dir, "../../..");
export const METRICS_DIR = join(ROOT, "extras", "metrics");
export const SDK_IMPORT = "../../../extras/metrics/_sdk/portfolio";

const FIXTURE_DIR = join(ROOT, "build", "metrics-test", "sdk-fixtures");

export interface LoadedMetric {
  dir: string;
  manifest: MetricManifest;
  bytes: Uint8Array;
  module: WebAssembly.Module;
}

function maxPages(manifest: MetricManifest): number {
  return Math.min(manifest.runtime.memoryPages, MAX_METRIC_MEMORY_PAGES);
}

async function compile(dir: string, entryFile: string, manifest: MetricManifest): Promise<LoadedMetric> {
  let wasm: Uint8Array | undefined;
  const options = {
    writeFile(name: string, contents: Uint8Array) {
      if (name.endsWith(".wasm")) wasm = contents;
    },
  };
  const { error, stderr } = await asc.main(
    [
      entryFile,
      "--outFile", `${dir}.wasm`,
      "--runtime", "stub",
      "--optimize",
      "--noAssert",
      "--importMemory",
      "--noExportMemory",
      "--initialMemory", String(MIN_METRIC_MEMORY_PAGES),
      "--maximumMemory", String(maxPages(manifest)),
      "--disable", "bulk-memory,threads,simd,reference-types",
    ],
    options as any,
  );
  if (error) throw new Error(`asc failed for ${dir}:\n${stderr.toString()}`);
  if (!wasm) throw new Error(`asc wrote no wasm for ${dir}`);
  const bytes = wasm;
  return { dir, manifest, bytes, module: new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>) };
}

const cache = new Map<string, Promise<LoadedMetric>>();

/** Parse <dir>/manifest.yml with parseManifestYaml, compile source.entry, cache the promise per dir. */
export function loadMetric(dir: string): Promise<LoadedMetric> {
  let pending = cache.get(dir);
  if (!pending) {
    pending = (async () => {
      const manifest = parseManifestYaml(readFileSync(join(METRICS_DIR, dir, "manifest.yml"), "utf8"));
      if (!manifest.source) throw new Error(`${dir}/manifest.yml has no source block`);
      return compile(dir, resolve(METRICS_DIR, dir, manifest.source.entry), manifest);
    })();
    cache.set(dir, pending);
  }
  return pending;
}

/** Compile an inline AssemblyScript source. Writes it to ROOT/build/metrics-test/sdk-fixtures/<name>.ts. */
export function compileSource(name: string, source: string, memoryPages = 16): Promise<LoadedMetric> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = join(FIXTURE_DIR, `${name}.ts`);
  writeFileSync(file, source);
  const manifest = {
    schema: 1,
    abi: METRIC_ABI_VERSION,
    id: name,
    scopes: ["portfolio.summary", "portfolio.holdings", "portfolio.transactions", "portfolio.history", "market.fundamentals"],
    runtime: { memoryPages, timeoutMs: 50 },
    source: { entry: `${name}.ts` },
  } as unknown as MetricManifest;
  return compile(name, file, manifest);
}

function abortMessage(memory: WebAssembly.Memory, msgPtr: number): string {
  if (msgPtr === 0) return "abort";
  const view = new DataView(memory.buffer);
  const len = Math.min(view.getUint32(msgPtr - 4, true), 400);
  const text = String.fromCharCode(...new Uint16Array(memory.buffer, msgPtr, len >> 1));
  return "abort: " + text;
}

interface MetricExports {
  metric_abi_version(): number;
  metric_alloc(len: number): number;
  metric_run(ptr: number, len: number): number;
}

function instantiate(metric: LoadedMetric): { memory: WebAssembly.Memory; exports: MetricExports } {
  const memory = new WebAssembly.Memory({ initial: MIN_METRIC_MEMORY_PAGES, maximum: maxPages(metric.manifest) });
  const instance = new WebAssembly.Instance(metric.module, {
    env: {
      memory,
      abort: (msgPtr: number) => {
        throw new Error(abortMessage(memory, msgPtr));
      },
      seed: () => 0,
      trace: () => {},
    },
  });
  return { memory, exports: instance.exports as unknown as MetricExports };
}

/** Fresh memory per call. Returns the raw JSON text. Throws Error("abort: <msg>") when the guest aborts. */
export function runRaw(metric: LoadedMetric, payload: Uint8Array): string {
  const { memory, exports } = instantiate(metric);
  const ptr = exports.metric_alloc(payload.length) >>> 0;
  if (ptr === 0) throw new Error("metric_alloc returned 0");
  new Uint8Array(memory.buffer, ptr, payload.length).set(payload);
  const out = exports.metric_run(ptr, payload.length) >>> 0;
  if (out === 0 || out + 4 > memory.buffer.byteLength) throw new Error("metric_run returned an invalid pointer");
  const len = new DataView(memory.buffer).getUint32(out, true);
  if (len > 4096) throw new Error("result exceeds 4096 bytes");
  return new TextDecoder().decode(new Uint8Array(memory.buffer, out + 4, len));
}

export interface MetricInput {
  summary?: Partial<PortfolioSummary>;
  holdings?: PortfolioHolding[];
  transactions?: PortfolioTransaction[];
  history?: PortfolioHistoricalPoint[];
  fundamentals?: MetricFundamentalsRow[];
  scopes?: MetricScope[];
  abi?: number;
}

/** encode -> runRaw -> parseMetricOutput. */
export function runMetric(metric: LoadedMetric, input: MetricInput = {}): MetricOutput {
  const data: FinancialPortfolioData = {
    summary: (input.summary ? emptySummary(input.summary) : undefined) as unknown as PortfolioSummary,
    holdings: input.holdings ?? [],
    chartHistory: input.history ?? [],
    individualCharts: {},
    transactions: input.transactions ?? [],
  };
  const payload = encodeMetricPayload(data, input.scopes ?? metric.manifest.scopes, {
    abi: input.abi ?? metric.manifest.abi,
    fundamentals: input.fundamentals,
  });
  return parseMetricOutput(runRaw(metric, payload));
}

function compare(actual: unknown, expected: unknown, digits: number, path: string): void {
  if (typeof expected === "number") {
    if (typeof actual !== "number") throw new Error(`${path}: expected number ${expected}, got ${JSON.stringify(actual)}`);
    expect(actual).toBeCloseTo(expected, digits);
    return;
  }
  if (expected === null || typeof expected !== "object") {
    expect({ path, value: actual }).toEqual({ path, value: expected });
    return;
  }
  if (Array.isArray(expected)) {
    expect({ path, isArray: Array.isArray(actual) }).toEqual({ path, isArray: true });
    const list = actual as unknown[];
    expect({ path, length: list.length }).toEqual({ path, length: expected.length });
    expected.forEach((item, i) => compare(list[i], item, digits, `${path}[${i}]`));
    return;
  }
  expect({ path, isObject: actual !== null && typeof actual === "object" && !Array.isArray(actual) }).toEqual({ path, isObject: true });
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  expect({ path, keys: Object.keys(a).sort() }).toEqual({ path, keys: Object.keys(e).sort() });
  for (const key of Object.keys(e)) compare(a[key], e[key], digits, `${path}.${key}`);
}

/** Deep compare: same keys (an absent key must stay absent), numbers with toBeCloseTo(digits), null === null. */
export function expectOutput(actual: MetricOutput, expected: MetricOutput, digits = 9): void {
  compare(actual, expected, digits, "output");
}

export interface ModuleContract {
  imports: string[];
  exports: string[];
  abi: number;
}

/** WebAssembly.Module.imports/exports names as "module.name" / "name", and metric_abi_version() of a fresh instance. */
export function moduleContract(metric: LoadedMetric): ModuleContract {
  const imports = WebAssembly.Module.imports(metric.module).map((i) => `${i.module}.${i.name}`);
  const exports = WebAssembly.Module.exports(metric.module).map((e) => e.name);
  const abi = instantiate(metric).exports.metric_abi_version();
  return { imports, exports, abi };
}

// Fixture builders

export function emptySummary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    totalValue: 0,
    totalCost: 0,
    totalGainLossDollar: 0,
    totalGainLossPercent: 0,
    dayGainLossDollar: 0,
    dayGainLossPercent: 0,
    totalGainSinceStartDollar: 0,
    totalGainSinceStartPercent: 0,
    totalCashInjected: 0,
    totalCashWithdrawn: 0,
    cashBalance: 0,
    totalPortfolioValue: 0,
    realizedPnL: 0,
    totalDividends: 0,
    totalInterest: 0,
    totalFees: 0,
    totalTaxes: 0,
    stockWeightPercent: 0,
    etfWeightPercent: 0,
    cryptoWeightPercent: 0,
    cashWeightPercent: 0,
    otherWeightPercent: 0,
    baseCurrency: "USD",
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export const TYPICAL_SUMMARY: PortfolioSummary = emptySummary({
  totalValue: 15234.5,
  totalCost: 12000,
  totalGainLossDollar: 3234.5,
  totalGainLossPercent: 26.954166,
  dayGainLossDollar: -123.45,
  dayGainLossPercent: -0.8104,
  totalGainSinceStartDollar: 4321.09,
  totalGainSinceStartPercent: 31.2,
  totalCashInjected: 13850,
  totalCashWithdrawn: 0,
  cashBalance: 1850.25,
  totalPortfolioValue: 17084.75,
  realizedPnL: 456.78,
  totalDividends: 210.5,
  totalInterest: 12.34,
  totalFees: 89.9,
  totalTaxes: 33.1,
  stockWeightPercent: 60,
  etfWeightPercent: 25,
  cryptoWeightPercent: 5,
  cashWeightPercent: 10,
  baseCurrency: "EUR",
  lastUpdated: "2026-09-11T00:00:00.000Z",
});

export const LOSING_SUMMARY: PortfolioSummary = {
  ...TYPICAL_SUMMARY,
  dayGainLossDollar: 250,
  dayGainLossPercent: 1.5,
  totalGainSinceStartDollar: -812.33,
  totalGainSinceStartPercent: -5.9,
  realizedPnL: -99.99,
  totalDividends: 0,
  totalInterest: 0,
  totalFees: 0,
  totalTaxes: 0,
  totalCost: 0,
  totalValue: 0,
  cashBalance: -50,
  cashWeightPercent: -2.5,
  totalCashInjected: -100,
  totalPortfolioValue: -1,
};

export function holding(
  symbol: string,
  currentValue: number,
  assetType: PortfolioHolding["assetType"] = "Stock",
  overrides: Partial<PortfolioHolding> = {},
): PortfolioHolding {
  return {
    symbol,
    name: symbol,
    assetType,
    shares: 0,
    buyPrice: 0,
    currentPrice: 0,
    previousClose: 0,
    totalCost: 0,
    currentValue,
    dayChangeDollar: 0,
    dayChangePercent: 0,
    totalGainLossDollar: 0,
    totalGainLossPercent: 0,
    weightPercent: 0,
    currency: "USD",
    ...overrides,
  };
}

export function fundamental(
  symbol: string,
  values: Partial<Record<FundamentalField, number>>,
  isFund = false,
): MetricFundamentalsRow {
  return { symbol, isFund, values };
}

export const STANDARD_HOLDINGS: PortfolioHolding[] = [holding("AAA", 6000), holding("BBB", 3000), holding("CCC", 1000)];
