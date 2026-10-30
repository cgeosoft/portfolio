/**
 * The metric registry against the temp database and data directory: built-in
 * records, installed rows and their granted scopes, rows it must skip, hash
 * checks on module files, refresh, listing status and the repository list.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as installedRepo from "../../db/installed-metrics.repo.js";
import { getBuiltinMetrics } from "../metrics/builtins.js";
import { MetricRegistry, getInstalledModulePath } from "../metrics/registry.js";

const ID = "acme-fixture";
const VERSION = "1.2.3";
const MODULE_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const MODULE_SHA = sha(MODULE_BYTES);

const manifestYaml = (id = ID) => `schema: 1
abi: 2
id: ${id}
name: Acme Fixture
version: ${VERSION}
developer:
  name: Acme
license: MIT
category: Testing
icon: gauge
accent: pink
summary: Test fixture.
description: Returns the total fees.
importance: None.
scopes: [portfolio.summary, portfolio.holdings]
display:
  defaultSize: compact
  valueFormat: currency
module:
  url: module.wasm
  sha256: "${MODULE_SHA}"
  size: ${MODULE_BYTES.length}
`;

const SOURCE_URL = "https://example.com/acme/manifest.yml";
const touched = new Set<string>();

function addRow(opts: { id?: string; scopesGranted?: string; manifest?: string } = {}) {
  const id = opts.id ?? ID;
  touched.add(id);
  installedRepo.upsert({
    id,
    version: VERSION,
    source: "url",
    sourceUrl: SOURCE_URL,
    sha256: MODULE_SHA,
    manifestYaml: opts.manifest ?? manifestYaml(id),
    scopesGranted: opts.scopesGranted ?? JSON.stringify(["portfolio.summary", "portfolio.holdings"]),
    verified: 0,
  } as Parameters<typeof installedRepo.upsert>[0]);
}

function writeModule(bytes: Uint8Array = MODULE_BYTES, id = ID) {
  const path = getInstalledModulePath(id, VERSION);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

afterEach(() => {
  for (const id of touched) {
    installedRepo.remove(id);
    rmSync(dirname(getInstalledModulePath(id, VERSION)), { recursive: true, force: true });
  }
  touched.clear();
});

describe("MetricRegistry", () => {
  it("lists the 17 built-ins", () => {
    const registry = new MetricRegistry();
    const builtins = getBuiltinMetrics();
    const records = registry.list();
    expect(records).toHaveLength(17);
    for (const b of builtins) {
      const record = registry.get(b.manifest.id)!;
      expect(record).toBeDefined();
      expect(record.source).toBe("builtin");
      expect(record.verified).toBe(true);
      expect(record.scopesGranted).toEqual(b.manifest.scopes);
      expect(record.bytes()).toEqual(b.bytes);
    }
    expect(registry.isBuiltin("broker-fees")).toBe(true);
  });

  it("loads an installed row with its granted scopes in manifest order", () => {
    addRow({ scopesGranted: JSON.stringify(["portfolio.holdings", "bogus"]) });
    writeModule();
    const record = new MetricRegistry().get(ID)!;
    expect(record).toBeDefined();
    expect(record.source).toBe("url");
    expect(record.verified).toBe(false);
    expect(record.sourceUrl).toBe(SOURCE_URL);
    expect(record.size).toBe(0);
    expect(record.scopesGranted).toEqual(["portfolio.holdings"]);
  });

  it("grants nothing when the stored scopes are not a JSON list", () => {
    for (const stored of ["not json", "{}"]) {
      addRow({ scopesGranted: stored });
      writeModule();
      expect(new MetricRegistry().get(ID)!.scopesGranted).toEqual([]);
    }
  });

  it("ignores a row that reuses a built-in id", () => {
    addRow({ id: "broker-fees" });
    writeModule(MODULE_BYTES, "broker-fees");
    const record = new MetricRegistry().get("broker-fees")!;
    expect(record.source).toBe("builtin");
    expect(record.verified).toBe(true);
  });

  it("skips a row with an invalid manifest or a missing module file", () => {
    addRow({ manifest: "a: [" });
    writeModule();
    expect(new MetricRegistry().get(ID)).toBeUndefined();

    addRow();
    rmSync(getInstalledModulePath(ID, VERSION), { force: true });
    expect(new MetricRegistry().get(ID)).toBeUndefined();
  });

  it("checks the module file against the recorded hash", () => {
    addRow();
    const path = writeModule();
    const tampered = new MetricRegistry().get(ID)!;
    writeFileSync(path, new Uint8Array([1, 2, 3]));
    expect(() => tampered.bytes()).toThrow(`Module file of ${ID} does not match its recorded hash`);

    writeModule();
    const record = new MetricRegistry().get(ID)!;
    const first = record.bytes();
    expect(first).toEqual(MODULE_BYTES);
    expect(record.bytes()).toBe(first);
  });

  it("loads rows once and picks up new rows on refresh", async () => {
    const registry = new MetricRegistry();
    expect(registry.list()).toHaveLength(17);
    addRow();
    writeModule();
    expect(registry.list().some((r) => r.id === ID)).toBe(false);
    await registry.refresh();
    expect(registry.list().some((r) => r.id === ID)).toBe(true);
  });

  it("derives the listing status", () => {
    const registry = new MetricRegistry();
    const record = registry.get("broker-fees")!;
    expect(registry.toListing(record, new Map([["broker-fees", "loop"]]), "Needs key")).toMatchObject({
      status: "quarantined",
      statusReason: "loop",
    });
    expect(registry.toListing(record, new Map(), "Needs key")).toMatchObject({ status: "unavailable", statusReason: "Needs key" });
    const ready = registry.toListing(record, new Map());
    expect(ready.status).toBe("ready");
    expect(ready.statusReason).toBeUndefined();
  });

  it("lists the repository in repository.yml order", () => {
    const yml = readFileSync(resolve(import.meta.dir, "../../../../../extras/metrics/repository.yml"), "utf8");
    const ids = [...yml.matchAll(/^\s*- id: (\S+)\s*$/gm)].map((m) => m[1]);
    const entries = new MetricRegistry().repository();
    expect(entries).toHaveLength(17);
    expect(entries.map((e) => e.id)).toEqual(ids);
    for (const e of entries) expect(e.bundled).toBe(true);
  });
});
