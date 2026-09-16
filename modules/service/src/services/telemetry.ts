/**
 * Anonymous telemetry via PostHog.
 * Only active when the user opts in during setup or via Settings.
 * No PII, no financial data, no portfolio values are collected.
 */

import { PostHog } from "posthog-node";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? "";
const POSTHOG_HOST = "https://eu.i.posthog.com";

export class TelemetryService {
  private client: PostHog | null = null;
  private deviceId = "";

  /** Initialize the PostHog client if telemetry is enabled */
  initialize(): void {
    const config = loadConfig();
    this.deviceId = config.deviceId;

    if (config.telemetryEnabled && POSTHOG_API_KEY) {
      this.client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
      appLogger.logStep("info", "telemetry", "initialize", "Anonymous analytics enabled");
    }
  }

  /** Re-initialize after settings change (enable/disable) */
  reinitialize(): void {
    this.shutdown().catch(() => {});
    this.client = null;
    this.initialize();
  }

  /** Capture an anonymous event. No-ops if telemetry is disabled. */
  capture(event: string, properties?: Record<string, unknown>): void {
    this.client?.capture({
      distinctId: this.deviceId,
      event,
      properties,
    });
  }

  /** Flush pending events and shut down the PostHog client */
  async shutdown(): Promise<void> {
    await this.client?.shutdown();
  }
}

export const telemetry = new TelemetryService();
