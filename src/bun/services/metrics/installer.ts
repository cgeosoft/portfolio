/**
 * Install metric modules from a URL. The URL points at a manifest.yml whose
 * `module` block names the .wasm file and its SHA-256. The installer checks
 * the size and hash before the sandbox ever sees the bytes, loads the module
 * in the engine to validate its imports, exports, and ABI, and only then
 * writes it to disk and records it. Nothing installed this way is verified,
 * and the listing says so permanently.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as installedRepo from "../../db/installed-metrics.repo.js";
import { appLogger } from "../../logger.js";
import type { MetricManifest } from "../../../shared/metric-manifest.js";
import { isMetricScope, type MetricScope } from "../../../shared/metric-abi.js";
import type { PreviewMetricInstallResponse } from "../../../shared/rpc-types.js";
import { MAX_MANIFEST_BYTES, parseManifestYaml } from "./manifest.js";
import { getInstalledModulePath, getMetricsStorageDir, type MetricRegistry } from "./registry.js";
import type { MetricRuntime } from "./runtime.js";

/** Upper bound of a downloadable module. Built-ins are about 12 KiB each. */
export const MAX_MODULE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const PREVIEW_TTL_MS = 10 * 60 * 1000;

interface Fetched {
  url: string;
  manifestYaml: string;
  manifest: MetricManifest;
  bytes: Uint8Array;
  sha256: string;
  fetchedAt: number;
}

function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function parseHttpUrl(value: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${what} must use http or https`);
  return url;
}

async function fetchBounded(url: URL, limit: number, what: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`${what} download failed (${res.status})`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > limit) throw new Error(`${what} exceeds the ${Math.round(limit / 1024)} KiB limit`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`${what} download returned no body`);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error(`${what} exceeds the ${Math.round(limit / 1024)} KiB limit`);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error(`${what} download timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class MetricInstaller {
  private previews = new Map<string, Fetched>();

  constructor(
    private readonly runtime: MetricRuntime,
    private readonly registry: MetricRegistry,
    private readonly onChange: (id: string) => void,
  ) {}

  /** Download and validate everything without installing. The result is kept for a later install. */
  async preview(rawUrl: string): Promise<PreviewMetricInstallResponse> {
    const fetched = await this.fetchAndValidate(rawUrl);
    this.previews.set(fetched.url, fetched);

    const response: PreviewMetricInstallResponse = {
      url: fetched.url,
      manifest: fetched.manifest,
      sha256: fetched.sha256,
      size: fetched.bytes.length,
    };
    const existing = this.registry.get(fetched.manifest.id);
    if (existing?.source === "builtin") {
      response.conflict = "builtin";
    } else if (existing) {
      response.conflict = "installed";
      response.installedVersion = existing.manifest.version;
    }
    return response;
  }

  /** Install a previously previewed URL. Fetches again when the preview expired. */
  async install(rawUrl: string, grantedScopes: readonly MetricScope[]): Promise<string> {
    const url = parseHttpUrl(rawUrl, "Manifest URL").toString();
    let fetched = this.previews.get(url);
    if (!fetched || Date.now() - fetched.fetchedAt > PREVIEW_TTL_MS) {
      fetched = await this.fetchAndValidate(url);
    }
    const { manifest } = fetched;

    if (this.registry.get(manifest.id)?.source === "builtin") {
      throw new Error(`Metric id ${manifest.id} belongs to a built-in metric`);
    }
    const granted = grantedScopes.filter(isMetricScope);
    for (const scope of manifest.scopes) {
      if (!granted.includes(scope)) throw new Error(`Scope ${scope} was not granted`);
    }

    const path = getInstalledModulePath(manifest.id, manifest.version);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fetched.bytes);

    installedRepo.upsert({
      id: manifest.id,
      version: manifest.version,
      source: "url",
      sourceUrl: url,
      sha256: fetched.sha256,
      manifestYaml: fetched.manifestYaml,
      scopesGranted: JSON.stringify(manifest.scopes),
      verified: 0,
    });
    this.previews.delete(url);

    await this.runtime.unload(manifest.id);
    this.runtime.clearQuarantine(manifest.id);
    this.registry.refresh();
    this.onChange(manifest.id);
    appLogger.logStep("info", "metrics", "module_installed", "Metric module installed from URL", undefined, {
      id: manifest.id,
      version: manifest.version,
      scopes: manifest.scopes,
    });
    return manifest.id;
  }

  async uninstall(id: string): Promise<boolean> {
    const record = this.registry.get(id);
    if (!record || record.source !== "url") return false;
    installedRepo.remove(id);
    rmSync(join(getMetricsStorageDir(), "modules", id), { recursive: true, force: true });
    await this.runtime.unload(id);
    this.runtime.clearQuarantine(id);
    this.registry.refresh();
    this.onChange(id);
    appLogger.logStep("info", "metrics", "module_uninstalled", "Metric module removed", undefined, { id });
    return true;
  }

  private async fetchAndValidate(rawUrl: string): Promise<Fetched> {
    const manifestUrl = parseHttpUrl(rawUrl, "Manifest URL");
    const manifestBytes = await fetchBounded(manifestUrl, MAX_MANIFEST_BYTES, "Manifest");
    const manifestYaml = new TextDecoder().decode(manifestBytes);
    const manifest = parseManifestYaml(manifestYaml);
    if (!manifest.module) throw new Error("manifest has no module block (url, sha256, size)");

    const moduleUrl = parseHttpUrl(new URL(manifest.module.url, manifestUrl).toString(), "module.url");
    if (manifest.module.size > MAX_MODULE_BYTES) {
      throw new Error(`module.size exceeds the ${Math.round(MAX_MODULE_BYTES / 1024)} KiB limit`);
    }
    const bytes = await fetchBounded(moduleUrl, MAX_MODULE_BYTES, "Module");
    if (bytes.length !== manifest.module.size) {
      throw new Error(`Module is ${bytes.length} bytes, manifest declares ${manifest.module.size}`);
    }
    const sha256 = sha256Hex(bytes);
    if (sha256 !== manifest.module.sha256) {
      throw new Error("Module hash does not match manifest module.sha256");
    }

    // Compile in the sandbox: rejects forbidden imports, missing exports, and other ABI versions.
    const probeId = `preview:${manifest.id}:${sha256.slice(0, 12)}`;
    try {
      await this.runtime.load(probeId, bytes);
    } finally {
      await this.runtime.unload(probeId);
    }

    return { url: manifestUrl.toString(), manifestYaml, manifest, bytes, sha256, fetchedAt: Date.now() };
  }
}
