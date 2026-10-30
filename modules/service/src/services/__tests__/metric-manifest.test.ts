/**
 * Edge cases of the metric manifest validator: check order, field rules,
 * normalisation (trimming, dedup, lower-cased digests) and the YAML guard.
 */

import { describe, expect, it } from "bun:test";
import { validateMetricManifest } from "portfolio-shared/metric-manifest";
import { MAX_MANIFEST_BYTES, parseManifestYaml } from "../metrics/manifest.js";

const base = (): Record<string, unknown> => ({
  schema: 1,
  abi: 2,
  id: "acme-metric",
  name: "Acme",
  version: "1.0.0",
  developer: { name: "Acme" },
  license: "MIT",
  category: "Testing",
  icon: "gauge",
  accent: "pink",
  summary: "S",
  description: "D",
  importance: "I",
  scopes: ["portfolio.summary"],
  display: { defaultSize: "compact", valueFormat: "currency" },
  source: { entry: "assembly/index.ts" },
});

const with_ = (overrides: Record<string, unknown>) => ({ ...base(), ...overrides });

function without(...keys: string[]): Record<string, unknown> {
  const out = base();
  for (const key of keys) delete out[key];
  return out;
}

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

const validate = (input: unknown) => validateMetricManifest(input) as unknown as Record<string, unknown>;

describe("validateMetricManifest", () => {
  it("returns the manifest with runtime defaults and no optional keys", () => {
    expect(validateMetricManifest(base())).toStrictEqual({ ...base(), runtime: { memoryPages: 16, timeoutMs: 50 } } as never);
  });

  it("rejects a root that is not a mapping", () => {
    for (const input of [null, [], "x"]) {
      expect(errorOf(() => validateMetricManifest(input))).toBe("manifest  must be a mapping");
    }
  });

  it("checks schema", () => {
    expect(errorOf(() => validateMetricManifest(without("schema")))).toBe("manifest schema is required");
    expect(errorOf(() => validateMetricManifest(with_({ schema: 2 })))).toBe("manifest schema must be 1");
    expect(errorOf(() => validateMetricManifest(with_({ schema: "1" })))).toBe("manifest schema must be a non-negative integer");
  });

  it("checks abi and the scopes each abi supports", () => {
    expect(errorOf(() => validateMetricManifest(with_({ abi: 3 })))).toBe("manifest abi must be one of 1, 2");
    expect(validateMetricManifest(with_({ abi: 1 })).abi).toBe(1);
    expect(errorOf(() => validateMetricManifest(with_({ abi: 1, scopes: ["market.fundamentals"] })))).toBe(
      "manifest scopes market.fundamentals needs abi 2 or later",
    );
  });

  it("reports schema before abi", () => {
    expect(errorOf(() => validateMetricManifest(with_({ schema: 2, abi: 9 })))).toBe("manifest schema must be 1");
  });

  it("checks the id", () => {
    for (const id of ["ab", "Acme-x", "a--b", "-ab"]) {
      expect(errorOf(() => validateMetricManifest(with_({ id })))).toBe(
        "manifest id must be kebab-case (letters, digits, single hyphens), 3 to 64 characters",
      );
    }
    expect(errorOf(() => validateMetricManifest(with_({ id: "a".repeat(65) })))).toBe("manifest id must be at most 64 characters");
    expect(validateMetricManifest(with_({ id: "  acme-metric  " })).id).toBe("acme-metric");
  });

  it("checks the version", () => {
    for (const version of ["1.0", "1.0.0+build"]) {
      expect(errorOf(() => validateMetricManifest(with_({ version })))).toBe("manifest version must be semver (for example 1.0.0)");
    }
    expect(validateMetricManifest(with_({ version: "1.0.0-beta.1" })).version).toBe("1.0.0-beta.1");
  });

  it("checks the developer", () => {
    expect(errorOf(() => validateMetricManifest(without("developer")))).toBe("manifest developer must be a mapping");
    expect(errorOf(() => validateMetricManifest(with_({ developer: { name: "" } })))).toBe(
      "manifest developer.name must be a non-empty string",
    );
    expect(errorOf(() => validateMetricManifest(with_({ developer: { name: "Acme", url: "ftp://x.org" } })))).toBe(
      "manifest developer.url must use http or https",
    );
    expect(errorOf(() => validateMetricManifest(with_({ developer: { name: "Acme", url: "not a url" } })))).toBe(
      "manifest developer.url must be a valid URL",
    );
    expect(validateMetricManifest(with_({ developer: { name: "Acme", url: "https://example.com" } })).developer.url).toBe(
      "https://example.com/",
    );
    const nullUrl = validateMetricManifest(with_({ developer: { name: "Acme", url: null } })).developer;
    expect("url" in nullUrl).toBe(false);
  });

  it("checks icon and accent", () => {
    expect(errorOf(() => validateMetricManifest(with_({ icon: "Gauge" })))).toBe("manifest icon must be a kebab-case lucide icon name");
    expect(errorOf(() => validateMetricManifest(with_({ accent: "red" })))).toBe(
      "manifest accent must be one of pink, mint, cream, blue, navy, slate",
    );
  });

  it("checks scopes and drops duplicates", () => {
    for (const scopes of [[], "portfolio.summary"]) {
      expect(errorOf(() => validateMetricManifest(with_({ scopes })))).toBe("manifest scopes must be a non-empty list");
    }
    expect(validateMetricManifest(with_({ scopes: ["portfolio.summary", "portfolio.summary", "portfolio.holdings"] })).scopes).toEqual([
      "portfolio.summary",
      "portfolio.holdings",
    ]);
  });

  it("checks display", () => {
    expect(errorOf(() => validateMetricManifest(with_({ display: { defaultSize: "medium", valueFormat: "currency" } })))).toBe(
      "manifest display.defaultSize must be large or compact",
    );
    expect(errorOf(() => validateMetricManifest(with_({ display: { defaultSize: "compact", valueFormat: "none" } })))).toBe(
      "manifest display.valueFormat must be currency, percent, or number",
    );
    expect(errorOf(() => validateMetricManifest(without("display")))).toBe("manifest display must be a mapping");
  });

  it("checks runtime limits", () => {
    expect(errorOf(() => validateMetricManifest(with_({ runtime: "x" })))).toBe("manifest runtime must be a mapping");
    expect(errorOf(() => validateMetricManifest(with_({ runtime: { memoryPages: 0 } })))).toBe("manifest runtime.memoryPages must be at least 1");
    expect(errorOf(() => validateMetricManifest(with_({ runtime: { timeoutMs: 0 } })))).toBe("manifest runtime.timeoutMs must be at least 1");
    for (const memoryPages of [1.5, -1]) {
      expect(errorOf(() => validateMetricManifest(with_({ runtime: { memoryPages } })))).toBe(
        "manifest runtime.memoryPages must be a non-negative integer",
      );
    }
    // The validator has no upper bound; the engine clamps and the repository test enforces the caps.
    expect(validateMetricManifest(with_({ runtime: { memoryPages: 1000, timeoutMs: 99999 } })).runtime).toEqual({
      memoryPages: 1000,
      timeoutMs: 99999,
    });
  });

  it("checks text lengths and trims", () => {
    const cases: [string, number, number][] = [
      ["name", 61, 60],
      ["summary", 161, 160],
      ["description", 601, 600],
      ["category", 33, 32],
      ["license", 41, 40],
      ["shortName", 41, 40],
    ];
    for (const [key, length, max] of cases) {
      expect(errorOf(() => validateMetricManifest(with_({ [key]: "x".repeat(length) })))).toBe(
        `manifest ${key} must be at most ${max} characters`,
      );
    }
    expect(validateMetricManifest(with_({ name: "  Acme  " })).name).toBe("Acme");
  });

  it("checks info and keeps shortName", () => {
    expect(errorOf(() => validateMetricManifest(with_({ info: "" })))).toBe("manifest info must be a non-empty string");
    expect(validate(with_({ info: "valuation" })).info).toBe("valuation");
    expect(validate(with_({ shortName: "Fees" })).shortName).toBe("Fees");
  });

  it("requires a source or a module", () => {
    expect(errorOf(() => validateMetricManifest(without("source")))).toBe("manifest source|module one of them is required");
    expect(errorOf(() => validateMetricManifest(with_({ source: { entry: "" } })))).toBe("manifest source.entry must be a non-empty string");
  });

  it("checks the module block", () => {
    const module = (overrides: Record<string, unknown>) => ({ ...without("source"), module: { url: "module.wasm", sha256: "A".repeat(64), size: 10, ...overrides } });
    const parsed = validate(module({}));
    const mod = parsed.module as { url: string; sha256: string; size: number };
    expect(mod.sha256).toBe("a".repeat(64));
    expect(mod.url).toBe("module.wasm");
    for (const sha256 of ["a".repeat(63), "g".repeat(64)]) {
      expect(errorOf(() => validateMetricManifest(module({ sha256 })))).toBe("manifest module.sha256 must be a 64 character hex digest");
    }
    expect(errorOf(() => validateMetricManifest(module({ size: undefined })))).toBe("manifest module.size is required");
    expect(errorOf(() => validateMetricManifest(module({ size: -1 })))).toBe("manifest module.size must be a non-negative integer");
  });
});

describe("parseManifestYaml", () => {
  it("rejects a manifest over the size limit", () => {
    expect(errorOf(() => parseManifestYaml("x".repeat(MAX_MANIFEST_BYTES + 1)))).toBe("manifest exceeds 64 KiB");
  });

  it("rejects invalid YAML", () => {
    expect(errorOf(() => parseManifestYaml("a: ["))).toStartWith("manifest is not valid YAML: ");
  });

  it("rejects a document that is not a mapping", () => {
    expect(errorOf(() => parseManifestYaml("hello"))).toBe("manifest  must be a mapping");
  });

  it("rejects a document with too many values even without aliases", () => {
    const list = Array.from({ length: 5001 }, (_, i) => i).join(", ");
    expect(errorOf(() => parseManifestYaml(`l: [${list}]\n`))).toBe("manifest holds more than 5000 values");
  });
});
