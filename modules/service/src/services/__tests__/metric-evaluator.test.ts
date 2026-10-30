/**
 * The metric evaluator with a stub runtime and registry: statuses, the result
 * cache and its cap, shared payloads per scope set and ABI, error mapping,
 * and that logs never carry the module's error text.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FinancialPortfolioData, PortfolioHolding, PortfolioSummary } from "portfolio-shared/portfolio";
import { MetricEvaluator } from "../metrics/evaluator.js";
import { MetricQuarantinedError, type MetricRuntime } from "../metrics/runtime.js";
import type { MetricRecord, MetricRegistry } from "../metrics/registry.js";
import { appLogger } from "../../logger.js";

type RunOpts = { timeoutMs?: number; memoryPages?: number };
const OK_OUTPUT = '{"value":{"amount":1,"format":"number"}}';

const quarantine = new Map<string, string>();
const records = new Map<string, MetricRecord>();
const run = mock(async (_id: string, _bytes: Uint8Array, _payload: Uint8Array, _opts: RunOpts) => ({ output: OK_OUTPUT, elapsedMs: 3 }));
const runtime = { run, isQuarantined: (id: string) => quarantine.has(id), getQuarantine: () => quarantine } as unknown as MetricRuntime;
const record = (id: string, abi = 2, scopes = ["portfolio.summary"]) =>
  ({
    id,
    sha256: `h-${id}`,
    scopesGranted: scopes,
    manifest: { abi, runtime: { timeoutMs: 40, memoryPages: 8 } },
    bytes: () => new Uint8Array([id.length]),
  }) as unknown as MetricRecord;
const registry = { get: (id: string) => records.get(id) } as unknown as MetricRegistry;

const data = (totalFees = 1, holdings: PortfolioHolding[] = []): FinancialPortfolioData => ({
  summary: { totalFees } as PortfolioSummary,
  holdings,
  chartHistory: [],
  individualCharts: {},
  transactions: [],
});

const add = (...list: MetricRecord[]) => list.forEach((r) => records.set(r.id, r));
const u32 = (p: Uint8Array, off: number) => new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(off, true);

let evaluator: MetricEvaluator;

beforeEach(() => {
  quarantine.clear();
  records.clear();
  run.mockReset();
  run.mockImplementation(async () => ({ output: OK_OUTPUT, elapsedMs: 3 }));
  evaluator = new MetricEvaluator(runtime, registry);
});

afterEach(() => {
  mock.restore();
});

describe("MetricEvaluator statuses", () => {
  it("reports an unknown id as missing", async () => {
    expect(await evaluator.evaluate(data(), ["nope"])).toEqual([{ id: "nope", status: "missing", error: "Metric is not installed" }]);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a quarantined id without running it", async () => {
    add(record("m"));
    quarantine.set("m", "x");
    expect(await evaluator.evaluate(data(), ["m"])).toEqual([{ id: "m", status: "quarantined", error: "x" }]);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports an unavailable provider, and quarantine wins over it", async () => {
    add(record("m"), record("q"));
    quarantine.set("q", "x");
    const results = await evaluator.evaluate(data(), ["m", "q"], { unavailable: () => "Needs a key" });
    expect(results[0]).toMatchObject({ id: "m", status: "unavailable", error: "Needs a key" });
    expect(results[1]).toMatchObject({ id: "q", status: "quarantined", error: "x" });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs a metric and parses its output", async () => {
    add(record("m"));
    const [result] = await evaluator.evaluate(data(), ["m"]);
    expect(result).toEqual({ id: "m", status: "ok", output: { value: { amount: 1, format: "number" } }, elapsedMs: 3, cached: false });
    expect(run).toHaveBeenCalledTimes(1);
    const [id, bytes, payload, opts] = run.mock.calls[0];
    expect(id).toBe("m");
    expect(bytes).toEqual(new Uint8Array([1]));
    expect(opts).toEqual({ timeoutMs: 40, memoryPages: 8 });
    expect(u32(payload, 4)).toBe(2);
  });

  it("returns results in the order of the ids", async () => {
    add(record("bb"), record("aa"));
    const results = await evaluator.evaluate(data(), ["bb", "zz", "aa"]);
    expect(results.map((r) => r.id)).toEqual(["bb", "zz", "aa"]);
  });
});

describe("MetricEvaluator cache", () => {
  it("serves the same data from the cache", async () => {
    add(record("m"));
    await evaluator.evaluate(data(), ["m"]);
    const [again] = await evaluator.evaluate(data(), ["m"]);
    expect(again).toMatchObject({ status: "ok", cached: true, elapsedMs: 0 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again when the data changes", async () => {
    add(record("m"));
    await evaluator.evaluate(data(1), ["m"]);
    await evaluator.evaluate(data(2), ["m"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("forgets one id without dropping an id that shares its prefix", async () => {
    add(record("a"), record("ab"));
    await evaluator.evaluate(data(), ["a", "ab"]);
    expect(run).toHaveBeenCalledTimes(2);
    evaluator.forget("a");
    const results = await evaluator.evaluate(data(), ["a", "ab"]);
    expect(results[0]).toMatchObject({ id: "a", cached: false });
    expect(results[1]).toMatchObject({ id: "ab", cached: true });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failure", async () => {
    add(record("m"));
    run.mockImplementation(async () => ({ output: "oops", elapsedMs: 3 }));
    const [first] = await evaluator.evaluate(data(), ["m"]);
    expect(first).toMatchObject({ id: "m", status: "error", error: "Result is not valid JSON" });
    await evaluator.evaluate(data(), ["m"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry past 256", async () => {
    const ids = Array.from({ length: 257 }, (_, i) => `metric-${i}`);
    for (const id of ids) add(record(id));
    for (const id of ids) await evaluator.evaluate(data(), [id]);
    expect(run).toHaveBeenCalledTimes(257);
    const [last] = await evaluator.evaluate(data(), [ids[256]]);
    expect(last).toMatchObject({ cached: true });
    expect(run).toHaveBeenCalledTimes(257);
    const [first] = await evaluator.evaluate(data(), [ids[0]]);
    expect(first).toMatchObject({ cached: false });
    expect(run).toHaveBeenCalledTimes(258);
  });

  it("serves the second copy of an id in one call from the cache", async () => {
    add(record("m"));
    const results = await evaluator.evaluate(data(), ["m", "m"]);
    expect(results[0]).toMatchObject({ id: "m", cached: false });
    expect(results[1]).toMatchObject({ id: "m", cached: true });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("MetricEvaluator payloads", () => {
  it("shares one payload per scope set and ABI", async () => {
    add(record("one"), record("two"), record("old", 1));
    await evaluator.evaluate(data(), ["one", "two", "old"]);
    const payloads = new Map(run.mock.calls.map(([id, , payload]) => [id, payload]));
    expect(payloads.get("one")).toBe(payloads.get("two")!);
    expect(u32(payloads.get("old")!, 4)).toBe(1);
  });

  it("reports a payload that is too large without running", async () => {
    add(record("big", 2, ["portfolio.holdings"]));
    const holdings = Array.from({ length: 60_000 }, () => ({ symbol: "", assetType: "Stock" }) as PortfolioHolding);
    const [result] = await evaluator.evaluate(data(1, holdings), ["big"]);
    expect(result).toMatchObject({ id: "big", status: "error", error: "Metric payload exceeds the size limit" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("MetricEvaluator errors", () => {
  it("maps a quarantine error", async () => {
    add(record("m"));
    run.mockImplementation(async () => {
      throw new MetricQuarantinedError("m", "loop");
    });
    const [result] = await evaluator.evaluate(data(), ["m"]);
    expect(result).toMatchObject({ status: "quarantined", error: "Metric m is disabled for this session: loop" });
  });

  it("reports quarantined when the run put the module in quarantine", async () => {
    add(record("m"));
    run.mockImplementation(async () => {
      quarantine.set("m", "loop");
      throw new Error("boom");
    });
    const [result] = await evaluator.evaluate(data(), ["m"]);
    expect(result.status).toBe("quarantined");
  });

  it("reports a plain failure as an error", async () => {
    add(record("m"));
    run.mockImplementation(async () => {
      throw new Error("boom");
    });
    const [result] = await evaluator.evaluate(data(), ["m"]);
    expect(result).toMatchObject({ status: "error", error: "boom" });
  });

  it("logs only the error kind, never the module's message", async () => {
    add(record("m"));
    const logStep = spyOn(appLogger, "logStep").mockImplementation(() => {});
    run.mockImplementation(async () => {
      throw new Error("abort: AAPL 123");
    });
    const [result] = await evaluator.evaluate(data(), ["m"]);
    expect(result).toMatchObject({ error: "abort: AAPL 123" });
    const logged = JSON.stringify(logStep.mock.calls);
    expect(logged).toContain('"error":"abort"');
    expect(logged).not.toContain("AAPL");
  });
});
