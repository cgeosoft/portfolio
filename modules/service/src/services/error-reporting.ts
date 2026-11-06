/**
 * Crash reports via PostHog. The client exists only while the user has the
 * option on.
 *
 * A report uses an allowlist. It holds the error type, a fixed capture code
 * and stack frames from the app's own bundle. It never holds the error message,
 * because a message can name a ticker, an amount, a path or a URL. Do not use
 * `anonymizeLogContent` here: it is a denylist for log files.
 */
import { createHash } from "node:crypto";
import type { PostHog } from "posthog-node";
import { loadConfig } from "../config.js";
import { getAppVersion, getEnvironmentName } from "../environment.js";
import { appLogger } from "../logger.js";
import { createPostHogClient } from "./posthog-client.js";
import { consentVersion } from "./privacy-consent.js";

export type ErrorCaptureCode = "service:uncaught" | "service:unhandled" | "gui:boundary" | "gui:window";

export interface StackFrame {
  fn: string;
  file: string;
  line: number;
  column: number;
}

export interface SafeReport {
  type: string;
  code: ErrorCaptureCode;
  frames: (StackFrame | "[external]")[];
  fingerprint: string;
}

const MAX_REPORTS_PER_RUN = 20;
const MAX_FRAMES = 30;
const SAFE_TYPE = /^[A-Za-z]{1,64}$/;
const SAFE_FUNCTION = /^[\w$.<>]{1,100}$/;
/** The event properties a report may carry. The SDK adds its own `$lib` fields after the send hook. */
const ALLOWED_PROPERTIES = new Set([
  "$exception_list",
  "$exception_level",
  "$exception_fingerprint",
  "$process_person_profile",
  "capture_code",
  "app_version",
  "channel",
  "os",
  "arch",
  "process",
  "consent_version",
]);
const ALLOWED_FRAME_KEYS = new Set(["platform", "filename", "function", "lineno", "colno", "in_app"]);

/** The bundle-relative file of a frame, or null when the file is not part of the app. */
function appFile(file: string): string | null {
  const service = file.match(/(?:^|[\\/])service[\\/](main\.js)$/);
  if (service) return `service/${service[1]}`;
  const gui = file.match(/^https?:\/\/[^/]+\/(assets\/[\w.-]+\.js)$/);
  return gui ? gui[1]! : null;
}

function parseFrame(line: string): { fn: string; location: string } | null {
  const trimmed = line.trim();
  // V8 and Bun: `at fn (file:1:2)` or `at file:1:2`.
  const v8 = trimmed.match(/^at (?:(?:async )?(.+?) \()?(.+?)\)?$/);
  if (v8) return { fn: v8[1] ?? "", location: v8[2]! };
  // WebKit and Firefox: `fn@file:1:2`.
  const webkit = trimmed.match(/^(.*?)@(.+)$/);
  return webkit ? { fn: webkit[1] ?? "", location: webkit[2]! } : null;
}

function safeFrames(stack: unknown): SafeReport["frames"] {
  if (typeof stack !== "string") return [];
  const frames: SafeReport["frames"] = [];
  for (const line of stack.split("\n")) {
    const parsed = parseFrame(line);
    if (!parsed) continue; // The first line of a V8 stack is the message.
    const position = parsed.location.match(/^(.+):(\d+):(\d+)$/);
    const file = position ? appFile(position[1]!) : null;
    if (!position || !file) {
      if (frames.at(-1) !== "[external]") frames.push("[external]");
    } else {
      frames.push({ fn: SAFE_FUNCTION.test(parsed.fn) ? parsed.fn : "<anonymous>", file, line: Number(position[2]), column: Number(position[3]) });
    }
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** Builds the report from an error. Nothing else from the error leaves this function. */
export function buildReport(error: unknown, code: ErrorCaptureCode): SafeReport {
  const raw = (typeof error === "object" && error !== null ? error : {}) as { name?: unknown; stack?: unknown };
  const type = typeof raw.name === "string" && SAFE_TYPE.test(raw.name) ? raw.name : "Error";
  const frames = safeFrames(raw.stack);
  const top = frames.find((frame) => frame !== "[external]");
  const key = [type, code, top ? `${top.fn}:${top.file}:${top.line}:${top.column}` : ""].join("|");
  return { type, code, frames, fingerprint: createHash("sha256").update(key).digest("hex").slice(0, 32) };
}

/** A new error from the safe fields. The original error never reaches the SDK. */
export function safeError(report: SafeReport): Error {
  const error = new Error(report.code);
  error.name = report.type;
  const lines = report.frames.map((frame) => (frame === "[external]" ? "    at [external] (external:0:0)" : `    at ${frame.fn} (${frame.file}:${frame.line}:${frame.column})`));
  error.stack = [`${report.type}: ${report.code}`, ...lines].join("\n");
  return error;
}

/** The last filter before an event leaves: the allowlist again, and no source lines. */
export function filterReportEvent<T extends { event: string; properties?: Record<string | number, unknown> }>(message: T): T | null {
  if (message.event !== "$exception") return null;
  const properties = Object.fromEntries(Object.entries(message.properties ?? {}).filter(([key]) => ALLOWED_PROPERTIES.has(key)));
  const list = properties.$exception_list;
  if (Array.isArray(list)) {
    properties.$exception_list = list.map((entry: { type?: unknown; value?: unknown; mechanism?: unknown; stacktrace?: { type?: unknown; frames?: Record<string, unknown>[] } }) => ({
      type: entry.type,
      value: entry.value,
      mechanism: entry.mechanism,
      stacktrace: entry.stacktrace && {
        type: entry.stacktrace.type,
        frames: entry.stacktrace.frames?.map((frame) => Object.fromEntries(Object.entries(frame).filter(([key]) => ALLOWED_FRAME_KEYS.has(key)))),
      },
    }));
  }
  return { ...message, properties };
}

export class ErrorReportingService {
  private client: PostHog | null = null;
  private readonly seen = new Set<string>();

  initialize(): void {
    if (loadConfig().errorReportingEnabled) {
      this.client = createPostHogClient({ before_send: filterReportEvent });
      if (this.client) appLogger.logStep("info", "telemetry", "initialize", "Error reporting enabled");
    }
  }

  /** Re-initialize after settings change (enable/disable) */
  reinitialize(): void {
    this.shutdown().catch(() => {});
    this.client = null;
    this.initialize();
  }

  /** Sends one report. No-ops if the option is off. A failure here never creates a new report. */
  report(error: unknown, code: ErrorCaptureCode): void {
    if (!this.client) return;
    try {
      const stack = (error as { stack?: unknown } | null)?.stack;
      if (typeof stack === "string" && /posthog|error-reporting/i.test(stack)) return;
      const report = buildReport(error, code);
      if (this.seen.has(report.fingerprint) || this.seen.size >= MAX_REPORTS_PER_RUN) return;
      this.seen.add(report.fingerprint);
      // No distinct ID: the SDK makes a one-off ID and creates no person profile.
      this.client.captureException(safeError(report), undefined, {
        $exception_fingerprint: report.fingerprint,
        capture_code: report.code,
        app_version: getAppVersion(),
        channel: getEnvironmentName(),
        os: process.platform,
        arch: process.arch,
        process: code.startsWith("gui:") ? "gui" : "service",
        consent_version: consentVersion(),
      });
    } catch {
      appLogger.logStep("warning", "telemetry", "error_report", "Could not build an error report");
    }
  }

  async shutdown(): Promise<void> {
    await this.client?.shutdown();
  }
}

export const errorReporting = new ErrorReportingService();
