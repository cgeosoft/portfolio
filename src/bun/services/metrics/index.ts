/**
 * Facade of the metrics subsystem for the RPC layer: catalog listings,
 * sandboxed evaluation of a portfolio's metrics, and URL installs.
 */

import * as portfolioRepo from "../../db/portfolio.repo.js";
import { appLogger } from "../../logger.js";
import type { MetricScope } from "../../../shared/metric-abi.js";
import {
  normalizeMetricPreferences,
  serializeMetricPreferences,
  type PortfolioMetricPreference,
} from "../../../shared/metrics.js";
import type {
  EvaluatePortfolioMetricsRequest,
  GetMetricCatalogResponse,
  MetricEvaluation,
  MetricListing,
  PreviewMetricInstallResponse,
} from "../../../shared/rpc-types.js";
import type { PortfolioService } from "../portfolio.js";
import { getPortfolioMetrics } from "../portfolio-metrics.js";
import { MetricEvaluator } from "./evaluator.js";
import { MetricInstaller } from "./installer.js";
import { MetricRegistry } from "./registry.js";
import { MetricRuntime } from "./runtime.js";

export class MetricsService {
  readonly runtime: MetricRuntime;
  readonly registry: MetricRegistry;
  readonly evaluator: MetricEvaluator;
  readonly installer: MetricInstaller;

  constructor(private readonly portfolioService: PortfolioService, runtime = new MetricRuntime()) {
    this.runtime = runtime;
    this.registry = new MetricRegistry();
    this.evaluator = new MetricEvaluator(this.runtime, this.registry);
    this.installer = new MetricInstaller(this.runtime, this.registry, (id) => this.evaluator.forget(id));
  }

  /** Start the engine and compile the built-ins ahead of the first request. Never throws. */
  async warmUp(): Promise<void> {
    const timer = appLogger.startTimer("metrics", "warm_up", "Loading metric modules");
    try {
      let loaded = 0;
      for (const record of this.registry.list()) {
        try {
          await this.runtime.load(record.id, record.bytes());
          loaded += 1;
        } catch (err) {
          appLogger.logStep("warning", "metrics", "module_load_failed", "Metric module failed to load", undefined, {
            id: record.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      timer.end("info", `Loaded ${loaded} metric module(s)`, { loaded });
    } catch (err) {
      timer.fail(err, "Metric engine failed to start");
    }
  }

  getCatalog(): GetMetricCatalogResponse {
    const quarantine = this.runtime.getQuarantine();
    return {
      installed: this.registry.list().map((record) => this.registry.toListing(record, quarantine)),
      repository: this.registry.repository().map((entry) => ({ id: entry.id, bundled: entry.bundled, manifest: entry.manifest })),
    };
  }

  getListing(id: string): MetricListing | null {
    const record = this.registry.get(id);
    return record ? this.registry.toListing(record, this.runtime.getQuarantine()) : null;
  }

  async evaluateForPortfolio(params: EvaluatePortfolioMetricsRequest): Promise<MetricEvaluation[]> {
    for (const id of params.retry ?? []) this.runtime.clearQuarantine(id);
    const prefs = getPortfolioMetrics(params.portfolioId);
    const added = prefs.filter((pref) => pref.added).map((pref) => pref.id);
    const ids = params.ids ? params.ids.filter((id) => added.includes(id)) : added;
    if (ids.length === 0) return [];
    const data = await this.portfolioService.getPortfolioData(params.portfolioId, params.baseCurrency, false);
    return this.evaluator.evaluate(data, ids);
  }

  previewInstall(url: string): Promise<PreviewMetricInstallResponse> {
    return this.installer.preview(url);
  }

  async install(url: string, grantedScopes: MetricScope[]): Promise<MetricListing> {
    const id = await this.installer.install(url, grantedScopes);
    return this.getListing(id)!;
  }

  async uninstall(id: string): Promise<boolean> {
    const removed = await this.installer.uninstall(id);
    if (removed) this.removeFromAllPortfolios(id);
    return removed;
  }

  /** Drop a metric from every portfolio's selection, for example after an uninstall. */
  private removeFromAllPortfolios(id: string): void {
    for (const row of portfolioRepo.findAll()) {
      const json = portfolioRepo.findMetricsJson(row.id);
      if (!json || !json.includes(id)) continue;
      const prefs = normalizeMetricPreferences(JSON.parse(json) as unknown).filter((pref: PortfolioMetricPreference) => pref.id !== id);
      portfolioRepo.updateMetricsJson(row.id, serializeMetricPreferences(prefs));
    }
  }

  shutdown(): void {
    this.runtime.shutdown();
  }
}
