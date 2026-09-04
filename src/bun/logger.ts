import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Returns the standard user data log directory */
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

/** Returns the project workspace logs directory */
export function getProjectLogDir(): string {
  // Try walking up from process.cwd() or import.meta.dir to find project root package.json
  const searchRoots = [process.cwd(), import.meta.dir];
  for (const startDir of searchRoots) {
    let cur = startDir;
    for (let i = 0; i < 8; i++) {
      const pkg = join(cur, "package.json");
      if (existsSync(pkg)) {
        try {
          const content = readFileSync(pkg, "utf-8");
          if (content.includes('"name": "portfolio"')) {
            return join(cur, "logs");
          }
        } catch {}
      }
      const parent = resolve(cur, "..");
      if (parent === cur) break;
      cur = parent;
    }
  }
  return join(process.cwd(), "logs");
}

export interface LogEntry {
  timestamp: string;
  type: "info" | "success" | "warning" | "error" | "debug";
  message: string;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: "info" | "success" | "warning" | "error" | "debug";
  source: string;
  step?: string;
  message: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export class AppLogger {
  private logDir: string;
  private projectLogDir: string;
  private logFilePath: string;
  private sessionLogFilePaths: string[] = [];
  private sessionTimestamp: string;

  constructor(customLogDir?: string) {
    this.logDir = customLogDir ?? getLogDir();
    this.projectLogDir = getProjectLogDir();
    this.logFilePath = join(this.logDir, "portfolio.log");

    const now = new Date();
    // YYYY-MM-DD_HH-mm-ss-SSS
    this.sessionTimestamp = now.toISOString().replace(/[:.]/g, "-");
    const jsonlName = `load_${this.sessionTimestamp}.jsonl`;

    this.sessionLogFilePaths = [
      join(this.projectLogDir, jsonlName),
      join(this.logDir, jsonlName),
    ];

    this.ensureDirs();
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }

  public getSessionLogPaths(): string[] {
    return [...this.sessionLogFilePaths];
  }

  private ensureDirs(): void {
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {}
    try {
      mkdirSync(this.projectLogDir, { recursive: true });
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

  /** Append a structured log entry as JSONL */
  public appendJsonl(record: StructuredLogRecord): void {
    try {
      this.ensureDirs();
      const line = JSON.stringify(record) + "\n";
      for (const filePath of this.sessionLogFilePaths) {
        try {
          appendFileSync(filePath, line, "utf-8");
        } catch {
          // ignore per-file write error
        }
      }
    } catch (err) {
      console.error("[Logger] Failed to write JSONL log:", err);
    }
  }

  /** Append a plain text log entry to disk */
  public append(entry: LogEntry): void {
    try {
      this.ensureDirs();
      this.rotateLogsIfNeeded();
      const line = `[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}\n`;
      appendFileSync(this.logFilePath, line, "utf-8");
    } catch (err) {
      console.error("[Logger] Failed to write log to disk:", err);
    }
  }

  /** Write a log entry to stdout, plain log file, and session JSONL */
  public log(type: LogEntry["type"], message: string): LogEntry {
    const timestamp = new Date().toISOString();
    const entry: LogEntry = {
      timestamp,
      type,
      message,
    };
    console.log(`[Portfolio:${type.toUpperCase()}] ${message}`);
    this.append(entry);
    this.appendJsonl({
      timestamp,
      level: type,
      source: "main",
      message,
    });
    return entry;
  }

  /** Rich structured log recording step, duration, and metadata */
  public logStep(
    level: StructuredLogRecord["level"],
    source: string,
    step: string,
    message: string,
    durationMs?: number,
    data?: Record<string, unknown>,
  ): void {
    const timestamp = new Date().toISOString();
    const durStr = durationMs !== undefined ? ` (${durationMs}ms)` : "";
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    console.log(`[${source.toUpperCase()}:${step}] [${level.toUpperCase()}] ${message}${durStr}${dataStr}`);

    // Also write to traditional log if not debug
    if (level !== "debug") {
      this.append({
        timestamp,
        type: level,
        message: `[${source}:${step}] ${message}${durStr}${dataStr}`,
      });
    }

    this.appendJsonl({
      timestamp,
      level,
      source,
      step,
      message,
      durationMs,
      data,
    });
  }

  /** Helper to measure and log duration of an operation */
  public startTimer(source: string, step: string, startMessage?: string) {
    const startTime = performance.now();
    const startIso = new Date().toISOString();
    if (startMessage) {
      this.logStep("info", source, `${step}:start`, startMessage);
    }
    return {
      end: (level: StructuredLogRecord["level"] = "info", endMessage = "completed", data?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime);
        this.logStep(level, source, step, `${endMessage} in ${durationMs}ms`, durationMs, data);
        return durationMs;
      },
      fail: (error: unknown, failMessage = "failed", data?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime);
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logStep("error", source, step, `${failMessage}: ${errMsg} (after ${durationMs}ms)`, durationMs, {
          ...data,
          error: errMsg,
        });
        return durationMs;
      },
    };
  }
}

export const appLogger = new AppLogger();

