/**
 * Service logger. Every record goes to the console (aligned, coloured when a
 * terminal is attached or in development) and to one file per local day in
 * the log directory, `service-YYYY-MM-DD.log`. Every start on the same day
 * appends to that day's file; a new file begins at midnight. The file layout
 * is defined in portfolio-shared/log-format.ts (`renderFileLogLine`).
 */
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { dailyLogFileName, renderFileLogLine, type ConsoleLogLevel, type ConsoleLogRecord } from "portfolio-shared/log-format";
import { writeConsoleLog } from "./log-console";
import { getLogDir } from "./paths";

export { getLogDir } from "./paths";

/** Base name of the service log files: `service-2026-09-17.log`. */
export const LOG_FILE_BASE = "service";

export type LogLevel = ConsoleLogLevel;

export interface LogEntry {
  timestamp: string;
  type: LogLevel;
  message: string;
}

export class AppLogger {
  private readonly logDir: string;
  /** Records below this level are shown on the console only. */
  private fileLevel: LogLevel = "info";

  constructor(customLogDir?: string) {
    this.logDir = customLogDir ?? getLogDir();
  }

  /** File of the current day; changes at midnight. */
  getLogFilePath(date = new Date()): string {
    return join(this.logDir, dailyLogFileName(LOG_FILE_BASE, date));
  }

  getLogDir(): string {
    return this.logDir;
  }

  /** Include debug records in the file too (development). */
  setFileLevel(level: LogLevel): void {
    this.fileLevel = level;
  }

  private write(record: ConsoleLogRecord): void {
    writeConsoleLog(record);
    if (record.level === "debug" && this.fileLevel !== "debug") return;
    try {
      mkdirSync(this.logDir, { recursive: true });
      appendFileSync(this.getLogFilePath(), renderFileLogLine(record) + "\n", "utf-8");
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
