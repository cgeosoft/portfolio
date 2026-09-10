/**
 * Every metric the application can run: built-in modules embedded in the
 * bundle plus modules installed from a URL, whose bytes live under the app
 * storage directory. The registry hands module bytes to the evaluator and
 * listings to the webview.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getStorageDir } from "../../config.js";
import { appLogger } from "../../logger.js";
import * as installedRepo from "../../db/installed-metrics.repo.js";
import type { MetricManifest } from "../../../shared/metric-manifest.js";
import { isMetricScope, type MetricScope } from "../../../shared/metric-abi.js";
import type { MetricListing } from "../../../shared/rpc-types.js";
import { getBuiltinMetrics, getMetricRepository, type MetricRepositoryEntry } from "./builtins.js";
import { parseManifestYaml } from "./manifest.js";

export interface MetricRecord {
  id: string;
  manifest: MetricManifest;
  source: "builtin" | "url";
  sourceUrl?: string;
  sha256: string;
  size: number;
  verified: boolean;
  installedAt?: string;
  scopesGranted: MetricScope[];
  /** Module bytes. Read lazily for URL installs. */
  bytes: () => Uint8Array;
}

export function getMetricsStorageDir(): string {
  return join(getStorageDir(), "metrics");
}

export function getInstalledModulePath(id: string, version: string): string {
  return join(getMetricsStorageDir(), "modules", id, version, "module.wasm");
}

function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export class MetricRegistry {
  private records = new Map<string, MetricRecord>();
  private loaded = false;

  /** Re-read the installed modules table. Built-ins never change at runtime. */
  refresh(): void {
    const next = new Map<string, MetricRecord>();

    for (const builtin of getBuiltinMetrics()) {
      next.set(builtin.manifest.id, {
        id: builtin.manifest.id,
        manifest: builtin.manifest,
        source: "builtin",
        sha256: builtin.sha256,
        size: builtin.size,
        verified: true,
        scopesGranted: [...builtin.manifest.scopes],
        bytes: () => builtin.bytes,
      });
    }

    for (const row of installedRepo.findAll()) {
      if (next.has(row.id)) {
        appLogger.logStep("warning", "metrics", "registry_shadowed", "Installed metric id collides with a built-in and is ignored", undefined, {
          id: row.id,
        });
        continue;
      }
      let manifest: MetricManifest;
      try {
        manifest = parseManifestYaml(row.manifestYaml);
      } catch (err) {
        appLogger.logStep("warning", "metrics", "registry_invalid_manifest", "Stored manifest failed validation", undefined, {
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const path = getInstalledModulePath(row.id, row.version);
      if (!existsSync(path)) {
        appLogger.logStep("warning", "metrics", "registry_missing_module", "Installed module file is missing", undefined, { id: row.id });
        continue;
      }
      let scopesGranted: MetricScope[] = [];
      try {
        const parsed = JSON.parse(row.scopesGranted) as unknown;
        if (Array.isArray(parsed)) scopesGranted = parsed.filter(isMetricScope);
      } catch {
        scopesGranted = [];
      }
      let cached: Uint8Array | null = null;
      next.set(row.id, {
        id: row.id,
        manifest,
        source: "url",
        sourceUrl: row.sourceUrl ?? undefined,
        sha256: row.sha256,
        size: 0,
        verified: row.verified === 1,
        installedAt: row.installedAt,
        scopesGranted: manifest.scopes.filter((scope) => scopesGranted.includes(scope)),
        bytes: () => {
          if (!cached) {
            const bytes = new Uint8Array(readFileSync(path));
            // Re-check integrity on every cold read so a tampered file never runs.
            if (sha256Hex(bytes) !== row.sha256) throw new Error(`Module file of ${row.id} does not match its recorded hash`);
            cached = bytes;
          }
          return cached;
        },
      });
    }

    this.records = next;
    this.loaded = true;
  }

  private ensure(): void {
    if (!this.loaded) this.refresh();
  }

  list(): MetricRecord[] {
    this.ensure();
    return [...this.records.values()];
  }

  get(id: string): MetricRecord | undefined {
    this.ensure();
    return this.records.get(id);
  }

  has(id: string): boolean {
    this.ensure();
    return this.records.has(id);
  }

  isBuiltin(id: string): boolean {
    return this.get(id)?.source === "builtin";
  }

  repository(): readonly MetricRepositoryEntry[] {
    return getMetricRepository();
  }

  toListing(record: MetricRecord, quarantine: ReadonlyMap<string, string>): MetricListing {
    const reason = quarantine.get(record.id);
    return {
      id: record.id,
      manifest: record.manifest,
      source: record.source,
      sourceUrl: record.sourceUrl,
      sha256: record.sha256,
      verified: record.verified,
      installedAt: record.installedAt,
      scopesGranted: record.scopesGranted,
      status: reason ? "quarantined" : "ready",
      statusReason: reason,
    };
  }
}
