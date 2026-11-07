/**
 * Usage analytics via PostHog: named events with a random install ID.
 * The client exists only while the user has the option on.
 * Events never carry money, tickers, names or free text.
 */

import type { PostHog } from "posthog-node";
import { CLI_PROVIDER_NAMES } from "portfolio-shared/llm-defaults";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import { createPostHogClient } from "./posthog-client.js";
import { consentVersion } from "./privacy-consent.js";

/** The provider as a fixed value: a custom server name or URL never reaches an event. */
export function analyticsProvider(provider: string): string {
  return provider in CLI_PROVIDER_NAMES ? provider : "openai-compatible";
}

/** All analytics events and their property keys. An event or a key that is not here is not sent. */
const ANALYTICS_EVENTS: Record<string, readonly string[]> = {
  app_launched: [],
  portfolio_created: [],
  portfolio_brief_saved: [],
  metric_installed: [],
  suggestions_generated: [],
  quotes_sync_completed: [],
  analysis_run_started: [],
  csv_imported: ["count"],
  assistant_chat_sent: ["provider"],
  analysis_run_completed: ["count"],
  analysis_run_failed: ["count"],
  analysis_run_cancelled: ["count"],
  setup_completed: ["demo"],
};

/** The allowlist at send time: counts, booleans and the fixed provider value only. */
export function allowedProperties(event: string, properties: Record<string, unknown> = {}): Record<string, number | boolean | string> | null {
  const keys = ANALYTICS_EVENTS[event];
  if (!keys) return null;
  const allowed: Record<string, number | boolean | string> = {};
  for (const key of keys) {
    const value = properties[key];
    if (key === "provider" && typeof value === "string") allowed[key] = analyticsProvider(value);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) allowed[key] = value;
  }
  return allowed;
}

export class TelemetryService {
  private client: PostHog | null = null;
  private deviceId = "";

  /** Initialize the PostHog client if usage analytics is on */
  initialize(): void {
    const config = loadConfig();
    this.deviceId = config.deviceId;

    if (config.analyticsEnabled) {
      this.client = createPostHogClient();
      if (this.client) appLogger.logStep("info", "telemetry", "initialize", "Usage analytics enabled");
    }
  }

  /** Re-initialize after settings change (enable/disable) */
  reinitialize(): void {
    this.shutdown().catch(() => {});
    this.client = null;
    this.initialize();
  }

  /** Capture a named event. No-ops if usage analytics is off. */
  capture(event: string, properties?: Record<string, unknown>): void {
    if (!this.client) return;
    const allowed = allowedProperties(event, properties);
    if (!allowed) return;
    this.client.capture({
      distinctId: this.deviceId,
      event,
      properties: { ...allowed, consent_version: consentVersion() },
    });
  }

  /** Flush pending events and shut down the PostHog client */
  async shutdown(): Promise<void> {
    await this.client?.shutdown();
  }
}

export const telemetry = new TelemetryService();
