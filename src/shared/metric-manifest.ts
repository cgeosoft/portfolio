/**
 * Manifest of a metric module (`manifest.yml`). The YAML is parsed by the main
 * process; this module validates the parsed object and is shared with the
 * webview, which renders manifests in the Metrics tab.
 */

import { METRIC_ABI_VERSION, isMetricScope, type MetricScope } from "./metric-abi.js";
import { isMetricId, type MetricSlot } from "./metrics.js";

export const METRIC_MANIFEST_SCHEMA_VERSION = 1;

export const METRIC_ACCENTS = ["pink", "mint", "cream", "blue", "navy", "slate"] as const;
export type MetricAccent = (typeof METRIC_ACCENTS)[number];

export type MetricValueFormatHint = "currency" | "percent" | "number";

export interface MetricDeveloper {
  name: string;
  url?: string;
}

export interface MetricManifest {
  schema: number;
  abi: number;
  id: string;
  name: string;
  /** Shorter label for the compact tile. Defaults to `name`. */
  shortName?: string;
  version: string;
  developer: MetricDeveloper;
  license: string;
  category: string;
  /** Lucide icon name, mapped host-side. */
  icon: string;
  accent: MetricAccent;
  summary: string;
  description: string;
  importance: string;
  scopes: MetricScope[];
  display: {
    defaultSize: MetricSlot;
    valueFormat: MetricValueFormatHint;
  };
  /** Key of the built-in explanation modal, when one exists for this metric. */
  info?: string;
  /** In-repo build source. Present on repository metrics. */
  source?: {
    entry: string;
  };
  /** Downloadable module. Present on metrics installed from a URL. */
  module?: {
    url: string;
    sha256: string;
    size: number;
  };
  runtime: {
    memoryPages: number;
    timeoutMs: number;
  };
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_MAX = 32;
const TEXT_MAX = 600;

function fail(path: string, expectation: string): never {
  throw new Error(`manifest ${path} ${expectation}`);
}

function readString(obj: Record<string, unknown>, key: string, path: string, max = TEXT_MAX): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) fail(`${path}${key}`, "must be a non-empty string");
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${path}${key}`, `must be at most ${max} characters`);
  return trimmed;
}

function readOptionalString(obj: Record<string, unknown>, key: string, path: string, max = TEXT_MAX): string | undefined {
  return obj[key] === undefined || obj[key] === null ? undefined : readString(obj, key, path, max);
}

function readObject(obj: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const value = obj[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path}${key}`, "must be a mapping");
  return value as Record<string, unknown>;
}

function readInteger(obj: Record<string, unknown>, key: string, path: string, fallback?: number): number {
  const value = obj[key];
  if (value === undefined || value === null) {
    if (fallback === undefined) fail(`${path}${key}`, "is required");
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(`${path}${key}`, "must be a non-negative integer");
  return value;
}

function readHttpUrl(value: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(path, "must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") fail(path, "must use http or https");
  return parsed.toString();
}

/**
 * Validate a parsed manifest object. Throws with a path-qualified message on
 * the first problem, so a contributor sees exactly what to fix.
 */
export function validateMetricManifest(input: unknown): MetricManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("", "must be a mapping");
  const obj = input as Record<string, unknown>;

  const schema = readInteger(obj, "schema", "");
  if (schema !== METRIC_MANIFEST_SCHEMA_VERSION) fail("schema", `must be ${METRIC_MANIFEST_SCHEMA_VERSION}`);
  const abi = readInteger(obj, "abi", "");
  if (abi !== METRIC_ABI_VERSION) fail("abi", `must be ${METRIC_ABI_VERSION}`);

  const id = readString(obj, "id", "", 64);
  if (!isMetricId(id)) fail("id", "must be kebab-case (letters, digits, single hyphens), 3 to 64 characters");

  const version = readString(obj, "version", "", 32);
  if (!SEMVER.test(version)) fail("version", "must be semver (for example 1.0.0)");

  const developerObj = readObject(obj, "developer", "");
  const developer: MetricDeveloper = { name: readString(developerObj, "name", "developer.", 80) };
  const developerUrl = readOptionalString(developerObj, "url", "developer.", 200);
  if (developerUrl) developer.url = readHttpUrl(developerUrl, "developer.url");

  const icon = readString(obj, "icon", "", 48);
  if (!ICON_NAME.test(icon)) fail("icon", "must be a kebab-case lucide icon name");

  const accent = readString(obj, "accent", "", 16);
  if (!(METRIC_ACCENTS as readonly string[]).includes(accent)) fail("accent", `must be one of ${METRIC_ACCENTS.join(", ")}`);

  const scopesRaw = obj["scopes"];
  if (!Array.isArray(scopesRaw) || scopesRaw.length === 0) fail("scopes", "must be a non-empty list");
  const scopes: MetricScope[] = [];
  for (const scope of scopesRaw) {
    if (!isMetricScope(scope)) fail("scopes", `contains unknown scope ${JSON.stringify(scope)}`);
    if (!scopes.includes(scope)) scopes.push(scope);
  }

  const displayObj = readObject(obj, "display", "");
  const defaultSize = readString(displayObj, "defaultSize", "display.", 16);
  if (defaultSize !== "large" && defaultSize !== "compact") fail("display.defaultSize", "must be large or compact");
  const valueFormat = readString(displayObj, "valueFormat", "display.", 16);
  if (valueFormat !== "currency" && valueFormat !== "percent" && valueFormat !== "number") {
    fail("display.valueFormat", "must be currency, percent, or number");
  }

  const runtimeObj = obj["runtime"] === undefined ? {} : readObject(obj, "runtime", "");
  const memoryPages = readInteger(runtimeObj, "memoryPages", "runtime.", 16);
  if (memoryPages < 1) fail("runtime.memoryPages", "must be at least 1");
  const timeoutMs = readInteger(runtimeObj, "timeoutMs", "runtime.", 50);
  if (timeoutMs < 1) fail("runtime.timeoutMs", "must be at least 1");

  const manifest: MetricManifest = {
    schema,
    abi,
    id,
    name: readString(obj, "name", "", 60),
    version,
    developer,
    license: readString(obj, "license", "", 40),
    category: readString(obj, "category", "", CATEGORY_MAX),
    icon,
    accent: accent as MetricAccent,
    summary: readString(obj, "summary", "", 160),
    description: readString(obj, "description", ""),
    importance: readString(obj, "importance", ""),
    scopes,
    display: { defaultSize: defaultSize as MetricSlot, valueFormat: valueFormat as MetricValueFormatHint },
    runtime: { memoryPages, timeoutMs },
  };

  const shortName = readOptionalString(obj, "shortName", "", 40);
  if (shortName) manifest.shortName = shortName;
  const info = readOptionalString(obj, "info", "", 40);
  if (info) manifest.info = info;

  if (obj["source"] !== undefined) {
    const sourceObj = readObject(obj, "source", "");
    manifest.source = { entry: readString(sourceObj, "entry", "source.", 200) };
  }

  if (obj["module"] !== undefined) {
    const moduleObj = readObject(obj, "module", "");
    const url = readString(moduleObj, "url", "module.", 500);
    const sha256 = readString(moduleObj, "sha256", "module.", 64).toLowerCase();
    if (!SHA256.test(sha256)) fail("module.sha256", "must be a 64 character hex digest");
    manifest.module = { url, sha256, size: readInteger(moduleObj, "size", "module.") };
  }

  if (!manifest.source && !manifest.module) fail("source|module", "one of them is required");

  return manifest;
}
