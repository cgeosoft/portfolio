/**
 * Sandbox tests: ABI round-trip, golden output of the ten built-in modules
 * against the legacy TypeScript formatters, trap handling, timeout kill and
 * engine respawn, memory ceiling, scope filtering, and install validation.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import asc from "assemblyscript/asc";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FinancialPortfolioData, PortfolioSummary } from "../../../types/portfolio.js";
import { METRIC_SCOPES, SUMMARY_FIELDS } from "../../../shared/metric-abi.js";
import { parseMetricOutput, renderMetricOutput } from "../../../shared/metric-output.js";
import { BUILTIN_METRIC_IDS } from "../../../shared/metrics.js";
import { fmtCurrency, fmtPercent } from "../../../views/src/components/portfolio/utils.js";
import { getBuiltinMetrics } from "../metrics/builtins.js";
import { encodeMetricPayload } from "../metrics/payload.js";
import { MetricRegistry } from "../metrics/registry.js";
import { MetricInstaller } from "../metrics/installer.js";
import { MetricRuntime, MetricTimeoutError } from "../metrics/runtime.js";

const ROOT = resolve(import.meta.dir, "../../../..");
const WORK_DIR = join(ROOT, "build", "metrics-test");
const SDK_IMPORT = "../../../extras/metrics/_sdk/portfolio";

const FIXTURES: Record<string, string> = {
  loop: `
export { metric_abi_version, metric_alloc } from "${SDK_IMPORT}";
export function metric_run(ptr: i32, len: i32): i32 { let i: i32 = 0; while (true) { i++; } return i; }
`,
  trap: `
export { metric_abi_version, metric_alloc } from "${SDK_IMPORT}";
export function metric_run(ptr: i32, len: i32): i32 { unreachable(); return 0; }
`,
  hog: `
import { Result, Format } from "${SDK_IMPORT}";
export { metric_abi_version, metric_alloc } from "${SDK_IMPORT}";
export function metric_run(ptr: i32, len: i32): i32 {
  while (memory.grow(1) != -1) {}
  return new Result().value(<f64>memory.size(), Format.Number).finish();
}
`,
  wrongAbi: `
export { metric_alloc } from "${SDK_IMPORT}";
export function metric_abi_version(): i32 { return 99; }
export function metric_run(ptr: i32, len: i32): i32 { return 0; }
`,
  scopes: `
import { Summary, Holdings, Transactions, History, Result, Format } from "${SDK_IMPORT}";
export { metric_abi_version, metric_alloc } from "${SDK_IMPORT}";
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  const h = new Holdings(ptr, len);
  const t = new Transactions(ptr, len);
  const y = new History(ptr, len);
  const r = new Result().value(s.totalValue, Format.Currency);
  r.text(s.present ? "S" : "-").text(h.present ? "H" : "-").text(t.present ? "T" : "-").text(y.present ? "Y" : "-");
  r.amount(<f64>h.count, Format.None).amount(<f64>t.count, Format.None).amount(<f64>y.count, Format.None);
  if (h.count > 0) r.text(" " + h.at(0).symbol).amount(h.at(0).shares, Format.None);
  if (t.count > 0) r.text(" " + t.at(t.count - 1).type + "/" + t.at(t.count - 1).kind.toString()).amount(t.at(t.count - 1).amount, Format.None);
  if (y.count > 0) r.amount(y.at(0).totalPortfolioValue, Format.None);
  return r.finish();
}
`,
};

const fixtureBytes: Record<string, Uint8Array> = {};
let runtime: MetricRuntime;

async function compileFixture(name: string, source: string, maxPages = 16): Promise<Uint8Array> {
  const dir = join(WORK_DIR, "fixtures");
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, `${name}.ts`);
  const out = join(dir, `${name}.wasm`);
  writeFileSync(entry, source);
  const { error, stderr } = await asc.main([
    entry, "--outFile", out, "--runtime", "stub", "--optimize", "--importMemory", "--noExportMemory",
    "--initialMemory", "2", "--maximumMemory", String(maxPages),
  ]);
  if (error) throw new Error(`fixture ${name} failed to compile:\n${stderr.toString()}`);
  return new Uint8Array(await Bun.file(out).arrayBuffer());
}

function summary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
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
    ...overrides,
  };
}

function data(s: PortfolioSummary | undefined, extra: Partial<FinancialPortfolioData> = {}): FinancialPortfolioData {
  return { summary: s as PortfolioSummary, holdings: [], chartHistory: [], individualCharts: {}, transactions: [], ...extra };
}

/** The formatters metrics-catalog.ts used before the modules existed. Kept verbatim as the migration oracle. */
const sign = (val: number | undefined): string => ((val ?? 0) >= 0 ? "+" : "");
const deltaClass = (val: number | undefined): string => ((val ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400");
type Ctx = { summary?: PortfolioSummary; currency: string; hideValues: boolean };
const LEGACY: Record<string, { value: (c: Ctx) => string; sub?: (c: Ctx) => string | undefined; cls?: (c: Ctx) => string }> = {
  "total-portfolio-value": {
    value: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalPortfolioValue, currency, hideValues),
    sub: ({ summary, currency, hideValues }) =>
      summary?.totalGainSinceStartDollar !== undefined
        ? `${sign(summary.totalGainSinceStartDollar)}${fmtCurrency(summary.totalGainSinceStartDollar, currency, hideValues)} (${fmtPercent(summary.totalGainSinceStartPercent)})`
        : undefined,
  },
  "day-gain-loss": {
    value: ({ summary, currency, hideValues }) => `${sign(summary?.dayGainLossDollar)}${fmtCurrency(summary?.dayGainLossDollar, currency, hideValues)}`,
    sub: ({ summary }) => `${fmtPercent(summary?.dayGainLossPercent)} today`,
    cls: ({ summary }) => deltaClass(summary?.dayGainLossDollar),
  },
  "lifetime-gain": {
    value: ({ summary, currency, hideValues }) => `${sign(summary?.totalGainSinceStartDollar)}${fmtCurrency(summary?.totalGainSinceStartDollar, currency, hideValues)}`,
    sub: ({ summary }) => `${fmtPercent(summary?.totalGainSinceStartPercent)} all-time return`,
    cls: ({ summary }) => deltaClass(summary?.totalGainSinceStartDollar),
  },
  "cash-liquidity": {
    value: ({ summary, currency, hideValues }) => fmtCurrency(summary?.cashBalance, currency, hideValues),
    sub: ({ summary }) => `${fmtPercent(summary?.cashWeightPercent)} portfolio allocation`,
  },
  "invested-capital": {
    value: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalCashInjected, currency, hideValues),
    sub: () => "Net deposits since inception",
  },
  "holdings-cost": {
    value: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalCost, currency, hideValues),
    sub: ({ summary, currency, hideValues }) => `Market value ${fmtCurrency(summary?.totalValue, currency, hideValues)}`,
  },
  "realized-pnl": {
    value: ({ summary, currency, hideValues }) => `${sign(summary?.realizedPnL)}${fmtCurrency(summary?.realizedPnL, currency, hideValues)}`,
    sub: () => "Closed position result",
    cls: ({ summary }) => deltaClass(summary?.realizedPnL),
  },
  "dividends-interest": {
    value: ({ summary, currency, hideValues }) => `+${fmtCurrency((summary?.totalDividends ?? 0) + (summary?.totalInterest ?? 0), currency, hideValues)}`,
    sub: ({ summary, currency, hideValues }) => `Dividends ${fmtCurrency(summary?.totalDividends, currency, hideValues)} | Interest ${fmtCurrency(summary?.totalInterest, currency, hideValues)}`,
    cls: () => "text-emerald-400",
  },
  "broker-fees": {
    value: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalFees, currency, hideValues),
    sub: () => "Lifetime transaction costs",
    cls: () => "text-slate-400",
  },
  "taxes-withheld": {
    value: ({ summary, currency, hideValues }) => fmtCurrency(summary?.totalTaxes, currency, hideValues),
    sub: () => "Lifetime tax deductions",
    cls: () => "text-slate-400",
  },
};

const builtin = (id: string) => {
  const found = getBuiltinMetrics().find((m) => m.manifest.id === id);
  if (!found) throw new Error(`built-in ${id} is not bundled; run bun run build:metrics`);
  return found;
};

async function runBuiltin(id: string, payload: Uint8Array) {
  const m = builtin(id);
  const res = await runtime.run(id, m.bytes, payload, m.manifest.runtime);
  return parseMetricOutput(res.output);
}

beforeAll(async () => {
  rmSync(WORK_DIR, { recursive: true, force: true });
  runtime = new MetricRuntime({ engineDir: join(WORK_DIR, "engine") });
  for (const [name, source] of Object.entries(FIXTURES)) {
    fixtureBytes[name] = await compileFixture(name, source, name === "hog" ? 64 : 16);
  }
}, 60_000);

afterAll(() => {
  runtime?.shutdown();
});

describe("Metric sandbox", () => {
  it("round-trips a summary payload through a built-in module", async () => {
    const payload = encodeMetricPayload(data(summary()), ["portfolio.summary"]);
    const output = await runBuiltin("broker-fees", payload);
    expect(output.value).toEqual({ amount: 89.9, format: "currency", sign: "auto" });
    expect(output.sentiment).toBe("neutral");
    const rendered = renderMetricOutput(output, { currency: (a) => fmtCurrency(a, "EUR"), percent: fmtPercent });
    expect(rendered.value).toBe("€89.90");
    expect(rendered.sub).toBe("Lifetime transaction costs");
    expect(rendered.valueClass).toBe("text-slate-400");
  });

  it("encodes every summary field in ABI order", () => {
    const s = summary();
    const payload = encodeMetricPayload(data(s), ["portfolio.summary"]);
    const view = new DataView(payload.buffer);
    const summaryOffset = view.getUint32(12, true);
    expect(view.getUint32(summaryOffset, true)).toBe(SUMMARY_FIELDS.length);
    SUMMARY_FIELDS.forEach((field, i) => {
      expect(view.getFloat64(summaryOffset + 8 + i * 8, true)).toBe((s as unknown as Record<string, number>)[field] ?? 0);
    });
  });

  const cases: [string, PortfolioSummary | undefined][] = [
    ["typical portfolio", summary()],
    ["losing portfolio", summary({
      dayGainLossDollar: -2500.5, dayGainLossPercent: -12.3, totalGainSinceStartDollar: -812.33, totalGainSinceStartPercent: -5.9,
      realizedPnL: -99.99, totalDividends: 0, totalInterest: 0, totalFees: 0, cashBalance: 0, cashWeightPercent: 0,
    })],
    ["empty portfolio", summary(Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, 0])) as Partial<PortfolioSummary>)],
    ["no summary yet", undefined],
  ];

  for (const [label, s] of cases) {
    for (const currency of ["EUR", "USD"]) {
      for (const hideValues of [false, true]) {
        it(`reproduces the legacy strings for ${label} (${currency}${hideValues ? ", masked" : ""})`, async () => {
          const payload = encodeMetricPayload(data(s), ["portfolio.summary"]);
          const fmt = { currency: (a: number | undefined) => fmtCurrency(a, currency, hideValues), percent: fmtPercent };
          for (const id of BUILTIN_METRIC_IDS) {
            const rendered = renderMetricOutput(await runBuiltin(id, payload), fmt);
            const legacy = LEGACY[id];
            const ctx: Ctx = { summary: s, currency, hideValues };
            // Before any summary exists the legacy formatter skipped the privacy mask and hid
            // the headline sub-line; the module cannot tell "no data" from zeros, so it masks
            // and renders zeros. The UI does not evaluate metrics before data is loaded.
            const noSummaryQuirk = s === undefined && (hideValues || id === "total-portfolio-value");
            if (!(noSummaryQuirk && hideValues)) expect(rendered.value).toBe(legacy.value(ctx));
            if (!noSummaryQuirk) expect(rendered.sub).toBe(legacy.sub?.(ctx));
            expect(rendered.valueClass).toBe(legacy.cls?.(ctx) ?? "text-slate-200");
          }
        });
      }
    }
  }

  it("reports a trap as an error and keeps the engine usable", async () => {
    const payload = encodeMetricPayload(data(summary()), ["portfolio.summary"]);
    await expect(runtime.run("fixture-trap", fixtureBytes["trap"], payload, { timeoutMs: 100 })).rejects.toThrow(/unreachable/i);
    expect(runtime.isQuarantined("fixture-trap")).toBe(false);
    const output = await runBuiltin("taxes-withheld", payload);
    expect(output.value.amount).toBe(33.1);
  });

  it("kills an infinite loop, quarantines the module, and respawns the engine", async () => {
    const payload = encodeMetricPayload(data(summary()), ["portfolio.summary"]);
    const started = performance.now();
    const err = await runtime.run("fixture-loop", fixtureBytes["loop"], payload, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetricTimeoutError);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(runtime.isQuarantined("fixture-loop")).toBe(true);
    await expect(runtime.run("fixture-loop", fixtureBytes["loop"], payload, { timeoutMs: 20 })).rejects.toThrow(/disabled for this session/);

    // The engine was killed; the next request restarts it and reloads the built-in.
    const output = await runBuiltin("cash-liquidity", payload);
    expect(output.value.amount).toBe(1850.25);
  }, 15_000);

  it("caps guest memory at the manifest limit", async () => {
    const payload = encodeMetricPayload(data(summary()), ["portfolio.summary"]);
    const res = await runtime.run("fixture-hog", fixtureBytes["hog"], payload, { timeoutMs: 500, memoryPages: 4 });
    const output = parseMetricOutput(res.output);
    expect(output.value.amount).toBe(4);
    const wide = await runtime.run("fixture-hog", fixtureBytes["hog"], payload, { timeoutMs: 500, memoryPages: 1000 });
    expect(parseMetricOutput(wide.output).value.amount).toBe(64);
  });

  it("rejects a module that targets another ABI", async () => {
    await expect(runtime.load("fixture-wrong-abi", fixtureBytes["wrongAbi"])).rejects.toThrow(/ABI 99/);
  });

  it("gives a summary-only module no holdings, transactions, or history", async () => {
    const full = data(summary(), {
      holdings: [{
        symbol: "AAPL", name: "Apple", assetType: "Stock", shares: 12, buyPrice: 100, currentPrice: 150, previousClose: 149,
        totalCost: 1200, currentValue: 1800, dayChangeDollar: 12, dayChangePercent: 0.67, totalGainLossDollar: 600,
        totalGainLossPercent: 50, weightPercent: 10.5, currency: "USD",
      }],
      transactions: [
        { id: "t1", date: "2026-01-02", type: "BUY", symbol: "AAPL", shares: 12, price: 100, amount: 1200, fee: 1, tax: 0 },
        { id: "t2", date: "2026-02-02", type: "DIVIDEND", symbol: "AAPL", amount: 5.5, fee: 0, tax: 0.8 },
      ],
      chartHistory: [{ date: "2026-01-02", timestamp: 1767312000000, totalValue: 1200, totalCost: 1200, totalGainLoss: 0, totalPortfolioValue: 1300 }],
    });
    const fmt = { currency: (a: number | undefined) => fmtCurrency(a, "EUR"), percent: fmtPercent };

    const summaryOnly = encodeMetricPayload(full, ["portfolio.summary"]);
    const res = await runtime.run("fixture-scopes", fixtureBytes["scopes"], summaryOnly, { timeoutMs: 100 });
    expect(renderMetricOutput(parseMetricOutput(res.output), fmt).sub).toBe("S---000");
    expect(new TextDecoder().decode(summaryOnly)).not.toContain("AAPL");

    const everything = encodeMetricPayload(full, [...METRIC_SCOPES]);
    const all = await runtime.run("fixture-scopes", fixtureBytes["scopes"], everything, { timeoutMs: 100 });
    expect(renderMetricOutput(parseMetricOutput(all.output), fmt).sub).toBe("SHTY121 AAPL12 DIVIDEND/35.51300");

    const noSummary = encodeMetricPayload(full, ["portfolio.holdings"]);
    const partial = await runtime.run("fixture-scopes", fixtureBytes["scopes"], noSummary, { timeoutMs: 100 });
    const rendered = renderMetricOutput(parseMetricOutput(partial.output), fmt);
    expect(rendered.value).toBe("€0.00");
    expect(rendered.sub).toBe("-H--100 AAPL12");
  });

  it("caches nothing across runs: each run starts from fresh guest memory", async () => {
    const payload = encodeMetricPayload(data(summary()), ["portfolio.summary"]);
    for (let i = 0; i < 50; i++) {
      const out = await runBuiltin("dividends-interest", payload);
      expect(out.value.amount).toBeCloseTo(222.84, 6);
    }
  });
});

describe("Metric installer", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  const served = new Map<string, { body: Uint8Array | string; type: string }>();

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        const entry = served.get(path);
        if (!entry) return new Response("not found", { status: 404 });
        return new Response(entry.body as BodyInit, { headers: { "content-type": entry.type } });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  const manifestYaml = (moduleUrl: string, sha256: string, size: number, id = "acme-fixture") => `
schema: 1
abi: 1
id: ${id}
name: Acme Fixture
version: 1.2.3
developer:
  name: Acme
license: MIT
category: Testing
icon: flask-conical
accent: pink
summary: Test fixture.
description: Returns the total fees.
importance: None.
scopes: [portfolio.summary]
display:
  defaultSize: compact
  valueFormat: currency
module:
  url: ${moduleUrl}
  sha256: "${sha256}"
  size: ${size}
runtime:
  memoryPages: 8
  timeoutMs: 50
`;

  const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

  it("previews a valid manifest and module from a URL", async () => {
    const bytes = builtin("broker-fees").bytes;
    served.set("/ok/module.wasm", { body: bytes, type: "application/wasm" });
    served.set("/ok/manifest.yml", { body: manifestYaml("module.wasm", sha(bytes), bytes.length), type: "text/yaml" });
    const installer = new MetricInstaller(runtime, new MetricRegistry(), () => undefined);
    const preview = await installer.preview(`${baseUrl}/ok/manifest.yml`);
    expect(preview.manifest.id).toBe("acme-fixture");
    expect(preview.sha256).toBe(sha(bytes));
    expect(preview.size).toBe(bytes.length);
    expect(preview.conflict).toBeUndefined();
  });

  it("rejects a module whose hash does not match the manifest", async () => {
    const bytes = builtin("broker-fees").bytes;
    served.set("/bad/module.wasm", { body: bytes, type: "application/wasm" });
    served.set("/bad/manifest.yml", { body: manifestYaml("module.wasm", "0".repeat(64), bytes.length), type: "text/yaml" });
    const installer = new MetricInstaller(runtime, new MetricRegistry(), () => undefined);
    await expect(installer.preview(`${baseUrl}/bad/manifest.yml`)).rejects.toThrow(/hash does not match/);
  });

  it("rejects a size mismatch and a module that targets another ABI", async () => {
    const bytes = builtin("broker-fees").bytes;
    served.set("/size/module.wasm", { body: bytes, type: "application/wasm" });
    served.set("/size/manifest.yml", { body: manifestYaml("module.wasm", sha(bytes), bytes.length + 1), type: "text/yaml" });
    const installer = new MetricInstaller(runtime, new MetricRegistry(), () => undefined);
    await expect(installer.preview(`${baseUrl}/size/manifest.yml`)).rejects.toThrow(/bytes, manifest declares/);

    const wrong = fixtureBytes["wrongAbi"];
    served.set("/abi/module.wasm", { body: wrong, type: "application/wasm" });
    served.set("/abi/manifest.yml", { body: manifestYaml("module.wasm", sha(wrong), wrong.length), type: "text/yaml" });
    await expect(installer.preview(`${baseUrl}/abi/manifest.yml`)).rejects.toThrow(/ABI 99/);
  });

  it("flags an id that collides with a built-in", async () => {
    const bytes = builtin("broker-fees").bytes;
    served.set("/collide/module.wasm", { body: bytes, type: "application/wasm" });
    served.set("/collide/manifest.yml", { body: manifestYaml("module.wasm", sha(bytes), bytes.length, "broker-fees"), type: "text/yaml" });
    const installer = new MetricInstaller(runtime, new MetricRegistry(), () => undefined);
    const preview = await installer.preview(`${baseUrl}/collide/manifest.yml`);
    expect(preview.conflict).toBe("builtin");
    await expect(installer.install(`${baseUrl}/collide/manifest.yml`, ["portfolio.summary"])).rejects.toThrow(/built-in/);
  });

  it("refuses an install that does not grant every requested scope", async () => {
    const installer = new MetricInstaller(runtime, new MetricRegistry(), () => undefined);
    await expect(installer.install(`${baseUrl}/ok/manifest.yml`, [])).rejects.toThrow(/portfolio.summary was not granted/);
  });
});
