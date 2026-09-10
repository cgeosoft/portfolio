/**
 * Evaluate metric modules against portfolio data. Builds one payload per
 * distinct scope set, runs each module in the sandbox, validates the JSON it
 * returns, and caches results by module hash and payload hash so a re-render
 * costs nothing.
 */

import type { FinancialPortfolioData } from "../../../types/portfolio.js";
import type { MetricScope } from "../../../shared/metric-abi.js";
import { parseMetricOutput, type MetricOutput } from "../../../shared/metric-output.js";
import type { MetricEvaluation } from "../../../shared/rpc-types.js";
import { appLogger } from "../../logger.js";
import { encodeMetricPayload } from "./payload.js";
import type { MetricRegistry } from "./registry.js";
import { MetricQuarantinedError, MetricRuntime } from "./runtime.js";

const CACHE_LIMIT = 256;

function sha256Hex(input: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex");
}

export class MetricEvaluator {
  private cache = new Map<string, MetricOutput>();

  constructor(
    private readonly runtime: MetricRuntime,
    private readonly registry: MetricRegistry,
  ) {}

  /** Evaluate the given metric ids. Missing, failing, and quarantined modules are reported, never thrown. */
  async evaluate(data: FinancialPortfolioData, ids: readonly string[]): Promise<MetricEvaluation[]> {
    const payloads = new Map<string, { bytes: Uint8Array; hash: string }>();
    const payloadFor = (scopes: readonly MetricScope[]) => {
      const key = [...scopes].sort().join(",");
      let entry = payloads.get(key);
      if (!entry) {
        const bytes = encodeMetricPayload(data, scopes);
        entry = { bytes, hash: sha256Hex(bytes) };
        payloads.set(key, entry);
      }
      return entry;
    };

    const results: MetricEvaluation[] = [];
    for (const id of ids) {
      const record = this.registry.get(id);
      if (!record) {
        results.push({ id, status: "missing", error: "Metric is not installed" });
        continue;
      }
      if (this.runtime.isQuarantined(id)) {
        results.push({ id, status: "quarantined", error: this.runtime.getQuarantine().get(id) ?? "stopped" });
        continue;
      }

      let payload: { bytes: Uint8Array; hash: string };
      try {
        payload = payloadFor(record.scopesGranted);
      } catch (err) {
        results.push({ id, status: "error", error: err instanceof Error ? err.message : String(err) });
        continue;
      }

      const cacheKey = `${id}:${record.sha256}:${record.manifest.abi}:${payload.hash}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        results.push({ id, status: "ok", output: cached, elapsedMs: 0, cached: true });
        continue;
      }

      try {
        const run = await this.runtime.run(id, record.bytes(), payload.bytes, {
          timeoutMs: record.manifest.runtime.timeoutMs,
          memoryPages: record.manifest.runtime.memoryPages,
        });
        const output = parseMetricOutput(run.output);
        this.remember(cacheKey, output);
        results.push({ id, status: "ok", output, elapsedMs: run.elapsedMs, cached: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err instanceof MetricQuarantinedError || this.runtime.isQuarantined(id) ? "quarantined" : "error";
        appLogger.logStep("warning", "metrics", "module_failed", "Metric module did not produce a result", undefined, {
          id,
          status,
          error: message,
        });
        results.push({ id, status, error: message });
      }
    }
    return results;
  }

  /** Drop cached results of a module, for example after a reinstall. */
  forget(id: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${id}:`)) this.cache.delete(key);
    }
  }

  private remember(key: string, output: MetricOutput): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, output);
  }
}
