import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Returns the standard log directory */
export function getLogDir(): string {
  const home = homedir() || process.env["HOME"] || "~";
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    return localAppData ? join(localAppData, "portfolio", "logs") : join(home, "AppData", "Local", "portfolio", "logs");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Logs", "portfolio");
  }
  const xdgState = process.env["XDG_STATE_HOME"];
  if (xdgState) {
    return join(xdgState, "portfolio", "logs");
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  return xdgConfig ? join(xdgConfig, "portfolio", "logs") : join(home, ".config", "portfolio", "logs");
}

export interface LogEntry {
  timestamp: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
}

export class AppLogger {
  private logDir: string;
  private logFilePath: string;

  constructor(customLogDir?: string) {
    this.logDir = customLogDir ?? getLogDir();
    this.logFilePath = join(this.logDir, "portfolio.log");
    this.ensureDir();
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }

  private ensureDir(): void {
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {}
  }

  private rotateLogsIfNeeded(): void {
    try {
      if (!existsSync(this.logFilePath)) return;
      const stats = statSync(this.logFilePath);
      if (stats.size >= MAX_LOG_SIZE_BYTES) {
        const backupPath = `${this.logFilePath}.1`;
        if (existsSync(backupPath)) {
          unlinkSync(backupPath);
        }
        renameSync(this.logFilePath, backupPath);
      }
    } catch (err) {
      console.error("[Logger] Error rotating logs:", err);
    }
  }

  /** Append a log entry to disk */
  public append(entry: LogEntry): void {
    try {
      this.ensureDir();
      this.rotateLogsIfNeeded();
      const line = `[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}\n`;
      appendFileSync(this.logFilePath, line, "utf-8");
    } catch (err) {
      console.error("[Logger] Failed to write log to disk:", err);
    }
  }

  /** Write a log entry to stdout and append to the log file */
  public log(type: LogEntry["type"], message: string): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
    };
    console.log(`[Portfolio:${type.toUpperCase()}] ${message}`);
    this.append(entry);
    return entry;
  }
}

export const appLogger = new AppLogger();
