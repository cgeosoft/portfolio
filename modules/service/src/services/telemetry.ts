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
    this.client?.capture({
      distinctId: this.deviceId,
      event,
      properties: { ...properties, consent_version: consentVersion() },
    });
  }

  /** Flush pending events and shut down the PostHog client */
  async shutdown(): Promise<void> {
    await this.client?.shutdown();
  }
}

export const telemetry = new TelemetryService();
