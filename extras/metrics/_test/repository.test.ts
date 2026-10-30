/**
 * The contract of the extras/metrics repository: repository.yml lists every
 * metric directory, each manifest parses and matches its entry, the defaults
 * lead the list, every metric has its own test, and the SDK stays in step with
 * the ABI tables in metric-abi.ts.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseManifestYaml } from "../../../modules/service/src/services/metrics/manifest.ts";
import {
  FUNDAMENTAL_FIELDS,
  HISTORY_FIELDS,
  HOLDING_FIELDS,
  MAX_METRIC_MEMORY_PAGES,
  MAX_METRIC_TIMEOUT_MS,
  METRIC_ABI_VERSION,
  METRIC_PAYLOAD_MAGIC,
  PAYLOAD_HEADER_BYTES,
  SUMMARY_FIELDS,
  TRANSACTION_FIELDS,
  HOLDING_ASSET_TYPES,
  TRANSACTION_KINDS,
  isMetricScope,
  metricScopeProviders,
} from "../../../modules/shared/src/metric-abi.ts";
import { BUILTIN_METRIC_IDS, isMetricId } from "../../../modules/shared/src/metrics.ts";
import { METRIC_ICON_NAMES } from "../../../modules/gui/src/components/portfolio/metrics-catalog.ts";
import { METRICS_DIR } from "./harness.ts";

interface RepositoryEntry {
  id: string;
  path: string;
  bundled: boolean;
}

const repository = Bun.YAML.parse(readFileSync(join(METRICS_DIR, "repository.yml"), "utf8")) as {
  schema: number;
  metrics: RepositoryEntry[];
};

const SUMMARY = ["portfolio.summary"];
const FUNDAMENTALS = ["portfolio.holdings", "market.fundamentals"];

const EXPECTED: { id: string; scopes: string[]; valueFormat: string; info?: string }[] = [
  { id: "total-portfolio-value", scopes: SUMMARY, valueFormat: "currency", info: "valuation" },
  { id: "day-gain-loss", scopes: SUMMARY, valueFormat: "currency", info: "todayReturn" },
  { id: "lifetime-gain", scopes: SUMMARY, valueFormat: "currency", info: "totalGain" },
  { id: "cash-liquidity", scopes: SUMMARY, valueFormat: "currency", info: "cashReserves" },
  { id: "invested-capital", scopes: SUMMARY, valueFormat: "currency", info: "capitalInjected" },
  { id: "holdings-cost", scopes: SUMMARY, valueFormat: "currency", info: "valuation" },
  { id: "realized-pnl", scopes: SUMMARY, valueFormat: "currency", info: "realizedIncome" },
  { id: "dividends-interest", scopes: SUMMARY, valueFormat: "currency", info: "dividends" },
  { id: "broker-fees", scopes: SUMMARY, valueFormat: "currency", info: "realizedIncome" },
  { id: "taxes-withheld", scopes: SUMMARY, valueFormat: "currency", info: "realizedIncome" },
  { id: "portfolio-beta", scopes: FUNDAMENTALS, valueFormat: "number" },
  { id: "portfolio-pe", scopes: FUNDAMENTALS, valueFormat: "number" },
  { id: "dividend-yield", scopes: FUNDAMENTALS, valueFormat: "percent" },
  { id: "analyst-upside", scopes: FUNDAMENTALS, valueFormat: "percent" },
  { id: "dcf-upside", scopes: FUNDAMENTALS, valueFormat: "percent" },
  { id: "quality-score", scopes: FUNDAMENTALS, valueFormat: "number" },
  { id: "distress-exposure", scopes: FUNDAMENTALS, valueFormat: "percent" },
];

// Copy of the unexported INFO_MODAL_KEYS in modules/gui/src/App.tsx; keep the two in step.
const INFO_MODAL_KEYS = [
  "totalGain",
  "valuation",
  "todayReturn",
  "realizedIncome",
  "cashReserves",
  "capitalInjected",
  "dividends",
  "topPerformer",
];

const readManifest = (dir: string) => parseManifestYaml(readFileSync(join(METRICS_DIR, dir, "manifest.yml"), "utf8"));

describe("repository.yml", () => {
  it("lists the 17 metrics in order", () => {
    expect(repository.schema).toBe(1);
    expect(repository.metrics.map((entry) => entry.id)).toEqual(EXPECTED.map((entry) => entry.id));
  });

  it("holds valid, unique, bundled entries whose path is the id", () => {
    const ids = repository.metrics.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of repository.metrics) {
      expect(isMetricId(entry.id)).toBe(true);
      expect(entry.path).toBe(entry.id);
      expect(entry.path).not.toContain("/");
      expect(entry.path).not.toContain("..");
      expect(entry.bundled).toBe(true);
    }
  });

  it("lists every metric directory", () => {
    const dirs = readdirSync(METRICS_DIR)
      .filter((name) => !name.startsWith("_") && statSync(join(METRICS_DIR, name)).isDirectory())
      .sort();
    expect(dirs).toEqual(repository.metrics.map((entry) => entry.id).sort());
  });

  it("puts the default metrics first, all bundled", () => {
    expect(repository.metrics.slice(0, 10).map((entry) => entry.id)).toEqual([...BUILTIN_METRIC_IDS]);
    for (const id of BUILTIN_METRIC_IDS) {
      expect(repository.metrics.find((entry) => entry.id === id)?.bundled).toBe(true);
    }
  });
});

describe("metric manifests", () => {
  for (const expected of EXPECTED) {
    it(`${expected.id} matches its entry`, () => {
      const dir = join(METRICS_DIR, expected.id);
      expect(existsSync(join(dir, "manifest.yml"))).toBe(true);
      const manifest = readManifest(expected.id);
      expect(manifest.id).toBe(expected.id);
      expect(manifest.abi).toBe(METRIC_ABI_VERSION);
      expect(manifest.module).toBeUndefined();
      const entry = manifest.source?.entry;
      expect(entry).toBeDefined();
      const rel = relative(dir, resolve(dir, entry!));
      expect(rel).not.toBe("");
      expect(isAbsolute(rel)).toBe(false);
      expect(rel.startsWith("..")).toBe(false);
      expect(existsSync(resolve(dir, entry!))).toBe(true);
      expect(manifest.scopes).toEqual(expected.scopes as typeof manifest.scopes);
      for (const scope of manifest.scopes) expect(isMetricScope(scope)).toBe(true);
      expect(manifest.display.valueFormat).toBe(expected.valueFormat as typeof manifest.display.valueFormat);
      expect(manifest.info).toBe(expected.info);
      if (manifest.info !== undefined) expect(INFO_MODAL_KEYS).toContain(manifest.info);
      expect(manifest.runtime.memoryPages).toBeGreaterThanOrEqual(1);
      expect(manifest.runtime.memoryPages).toBeLessThanOrEqual(MAX_METRIC_MEMORY_PAGES);
      expect(manifest.runtime.timeoutMs).toBeGreaterThanOrEqual(1);
      expect(manifest.runtime.timeoutMs).toBeLessThanOrEqual(MAX_METRIC_TIMEOUT_MS);
      expect(METRIC_ICON_NAMES).toContain(manifest.icon);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(metricScopeProviders(manifest.scopes)).toEqual(expected.scopes === FUNDAMENTALS ? ["fmp"] : []);
    });
  }

  it("each metric has its own test file", () => {
    for (const { id } of repository.metrics) {
      expect({ id, exists: existsSync(join(METRICS_DIR, id, `${id}.test.ts`)) }).toEqual({ id, exists: true });
    }
    expect(existsSync(join(METRICS_DIR, "_template", "my-metric.test.ts"))).toBe(true);
  });

  it("the template parses and stays out of the repository", () => {
    const manifest = readManifest("_template");
    expect(manifest.source?.entry).toBeDefined();
    expect(manifest.abi).toBe(2);
    expect(manifest.id).toBe("my-metric");
    expect(repository.metrics.map((entry) => entry.id)).not.toContain("my-metric");
  });
});

describe("SDK drift guard", () => {
  const sdk = readFileSync(join(METRICS_DIR, "_sdk", "portfolio.ts"), "utf8");

  it("carries the ABI constants", () => {
    expect(sdk).toContain(`export const ABI_VERSION: i32 = ${METRIC_ABI_VERSION};`);
    expect(sdk).toContain(`const MAGIC: u32 = ${METRIC_PAYLOAD_MAGIC};`);
    expect(sdk).toContain(`const HEADER_BYTES: usize = ${PAYLOAD_HEADER_BYTES};`);
    expect(METRIC_PAYLOAD_MAGIC).toBe(1413827920);
    expect(PAYLOAD_HEADER_BYTES).toBe(40);
  });

  it("has a getter per field at its index, in table order", () => {
    const getters = [...sdk.matchAll(/get (\w+)\(\): f64 \{ return this\.field\((\d+)\); \}/g)].map((m) => [m[1], Number(m[2])]);
    const groups = [SUMMARY_FIELDS, HOLDING_FIELDS, TRANSACTION_FIELDS, HISTORY_FIELDS, FUNDAMENTAL_FIELDS];
    expect(groups.map((group) => group.length)).toEqual([22, 16, 6, 6, 20]);
    const expected = groups.flatMap((group) => (group as readonly string[]).map((name, i) => [name, i]));
    expect(getters).toHaveLength(70);
    expect(getters).toEqual(expected);
  });

  it("numbers the asset type and transaction kind enums like the ABI", () => {
    const members = [...sdk.matchAll(/^  (\w+) = (\d+),$/gm)].map((m) => [m[1], Number(m[2])]);
    (HOLDING_ASSET_TYPES as readonly string[]).forEach((name, i) => expect(members).toContainEqual([name, i]));
    (TRANSACTION_KINDS as readonly string[]).forEach((name, i) => expect(members).toContainEqual([name, i]));
  });
});
