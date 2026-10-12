/**
 * Service logger. Every record goes to stdout as one aligned line (coloured
 * when a terminal is attached or when running from a checkout). The service
 * opens no log file: the desktop shell appends the output, colour stripped,
 * to `<data dir>/logs/service-YYYY-MM-DD.log`. The line layout is defined in
 * portfolio-shared/log-format.ts.
 */
import type { ConsoleLogLevel, ConsoleLogRecord } from "portfolio-shared/log-format";
import { writeConsoleLog } from "./log-console";
import { isDev } from "./environment";

export { getLogDir } from "./paths";

/** Base name of the service log files the shell writes: `service-2026-09-17.log`. */
export const LOG_FILE_BASE = "service";

export type LogLevel = ConsoleLogLevel;

export interface LogEntry {
  timestamp: string;
  type: LogLevel;
  message: string;
}

export class AppLogger {
  /** Debug records are printed only when running from a checkout. */
  private debug = isDev();

  /** Print debug records too (or not). */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  private write(record: ConsoleLogRecord): void {
    if (record.level === "debug" && !this.debug) return;
    try {
      writeConsoleLog(record);
    } catch {
      // Logging must never take the service down.
    }
  }

  /** Plain message from the main source. */
  log(type: LogLevel, message: string): LogEntry {
    const timestamp = new Date().toISOString();
    this.write({ timestamp, level: type, source: "main", message });
    return { timestamp, type, message };
  }

  /** Structured record with source, step, duration and metadata. */
  logStep(level: LogLevel, source: string, step: string, message: string, durationMs?: number, data?: Record<string, unknown>): void {
    this.write({ timestamp: new Date().toISOString(), level, source, step, message, durationMs, data });
  }

  /** Measures an operation; `end` and `fail` log its duration. */
  startTimer(source: string, step: string, startMessage?: string) {
    const startTime = performance.now();
    if (startMessage) this.logStep("info", source, `${step}:start`, startMessage);
    return {
      end: (level: LogLevel = "info", endMessage = "completed", data?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime);
        this.logStep(level, source, step, endMessage, durationMs, data);
        return durationMs;
      },
      fail: (error: unknown, failMessage = "failed", data?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime);
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logStep("error", source, step, `${failMessage}: ${errMsg}`, durationMs, { ...data, error: errMsg });
        return durationMs;
      },
    };
  }
}

export const appLogger = new AppLogger();

const LEVELS = new Set<string>(["debug", "info", "success", "warning", "error"]);
/** C0 control characters and DEL except tab and newline: a GUI record cannot move the cursor or recolour a terminal. */
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;
const MAX_CLIENT_MESSAGE = 4000;
const MAX_CLIENT_DATA_KEYS = 8;

/** One short line: no newline in a source, step or data key can start a forged log line. */
function oneLine(value: unknown, fallback: string, max = 60): string {
  const text = typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]+/g, " ").trim() : "";
  return (text || fallback).slice(0, max);
}

/**
 * Logs a record the GUI sent (`POST /api/app/logs`). The fields come from a
 * client, so the level must be a known one, source, step and data keys stay
 * on one line, and the message is cut at 4,000 characters.
 */
export function logClientEvent(entry: Record<string, unknown>): void {
  const data = entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? (entry.data as Record<string, unknown>) : undefined;
  appLogger.logStep(
    LEVELS.has(entry.level as string) ? (entry.level as LogLevel) : "info",
    oneLine(entry.source, "gui"),
    oneLine(entry.step, "client_event"),
    String(entry.message ?? "").replace(CONTROL_CHARS, "").slice(0, MAX_CLIENT_MESSAGE),
    typeof entry.durationMs === "number" ? entry.durationMs : undefined,
    data && Object.fromEntries(Object.entries(data).slice(0, MAX_CLIENT_DATA_KEYS).map(([key, value]) => [oneLine(key, "key", 40), value])),
  );
}
