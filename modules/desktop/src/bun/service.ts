import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Removes ANSI escape codes (colours, cursor moves) from the service output. */
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** The one line the service prints once it listens on its random loopback port. */
const PORT_LINE = /^SERVICE_PORT=(\d+)$/;

/** Owner-only modes for the data the shell writes; other local users store API keys there. */
const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;

/** One day's log file stops growing here, so a noisy service cannot fill the disk. */
const LOG_SIZE_CAP_BYTES = 20 * 1024 * 1024;

/** Daily log files older than this are removed at start-up (support tickets only read 24 h). */
const LOG_RETENTION_DAYS = 14;

/** `<prefix>-YYYY-MM-DD.log` for the current local day. */
export function dailyLogFileName(prefix: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.log`;
}

/** A daily log file name, capturing its parts so old days can be pruned. */
const DAILY_LOG_NAME = /^(?:desktop|service)-(\d{4})-(\d{2})-(\d{2})\.log$/;

/**
 * Appends to `<logDir>/<prefix>-YYYY-MM-DD.log` through one handle, opened
 * `0600`. It reopens when the day rolls over and stops after
 * `LOG_SIZE_CAP_BYTES`, writing one "log capped" line so the cap is visible.
 */
export class DailyLogWriter {
  private fd: number | null = null;
  private day = "";
  private bytes = 0;
  private capped = false;

  constructor(
    private readonly logDir: string,
    private readonly prefix: string,
    private readonly capBytes = LOG_SIZE_CAP_BYTES,
  ) {}

  write(text: string): void {
    try {
      const name = dailyLogFileName(this.prefix);
      if (name !== this.day) this.rotate(name);
      if (this.fd === null || this.capped) return;
      const chunk = Buffer.from(text);
      if (this.bytes + chunk.length > this.capBytes) {
        writeSync(this.fd, `${new Date().toISOString()}  WARN   ${this.prefix}  log capped for today at ${this.capBytes} bytes\n`);
        this.capped = true;
        return;
      }
      writeSync(this.fd, chunk);
      this.bytes += chunk.length;
    } catch {
      // Logging must never take the app down.
    }
  }

  private rotate(name: string): void {
    try {
      if (this.fd !== null) closeSync(this.fd);
    } catch {
      // Already gone.
    }
    this.fd = null;
    this.capped = false;
    this.bytes = 0;
    this.day = name;
    try {
      mkdirSync(this.logDir, { recursive: true, mode: LOG_DIR_MODE });
      const file = join(this.logDir, name);
      this.fd = openSync(file, "a", LOG_FILE_MODE);
      this.bytes = statSync(file).size;
    } catch {
      this.fd = null;
    }
  }
}

/** One writer per log directory and prefix, so both log files share a single handle each. */
const writers = new Map<string, DailyLogWriter>();
function writerFor(logDir: string, prefix: string): DailyLogWriter {
  const key = `${logDir}\u0000${prefix}`;
  let writer = writers.get(key);
  if (!writer) {
    writer = new DailyLogWriter(logDir, prefix);
    writers.set(key, writer);
  }
  return writer;
}

/** Deletes `desktop-*.log` and `service-*.log` files older than `retentionDays`. */
export function pruneDailyLogs(logDir: string, retentionDays = LOG_RETENTION_DAYS, now = new Date()): void {
  let names: string[];
  try {
    names = readdirSync(logDir);
  } catch {
    return;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of names) {
    const match = DAILY_LOG_NAME.exec(name);
    if (!match) continue;
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    if (day < cutoff) {
      try {
        unlinkSync(join(logDir, name));
      } catch {
        // Best effort.
      }
    }
  }
}

/** The port of a `SERVICE_PORT=` line, or null. A continuation log line is indented, so `^` rejects it. */
export function parseServicePort(line: string): number | null {
  const match = PORT_LINE.exec(line.replace(/\r$/, ""));
  return match ? Number(match[1]) : null;
}

/** Appends a shell event to `<logDir>/desktop-YYYY-MM-DD.log` and echoes it in a development run. */
export function logShellEvent(logDir: string, message: string, echo: boolean): void {
  writerFor(logDir, "desktop").write(`${new Date().toISOString()}  INFO   desktop  ${message}\n`);
  if (echo) process.stdout.write(`[desktop] ${message}\n`);
}

export interface ServiceOptions {
  /** Command line of the child: the bundled `main.js`, or `--watch src/main.ts` of the checkout. */
  command: string[];
  /** Working directory of the child. */
  cwd: string;
  /** `<data>/logs`. The child's output is appended to `service-YYYY-MM-DD.log` there. */
  logDir: string;
  /** Also echo the child's output to this process's stdout (development). */
  echo: boolean;
  /** A packaged run reports its port once; ignore any later `SERVICE_PORT=` line (only `--watch` rebinds). */
  singlePort?: boolean;
}

/**
 * The service as a child process. The child inherits the environment of the shell and gets no
 * variables of its own: it derives its paths itself and binds a random loopback port, which it
 * reports with one `SERVICE_PORT=<port>` line on stdout. Under `bun --watch` that line comes
 * again after every restart, with a new port.
 *
 * The output is appended to the service log of the day (ANSI stripped); the service itself
 * never opens a log file. The last lines stay in memory for the failure page.
 */
export class ServiceProcess {
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  /** Last complete output lines, without their newline. */
  private readonly recent: string[] = [];
  /** The unfinished last line of each open stream. */
  private readonly openLines = new Set<{ text: string }>();
  private readonly portListeners: ((port: number) => void)[] = [];
  /** The port of the last `SERVICE_PORT=` line, or null before the first one. */
  port: number | null = null;
  exited = false;
  exitCode: number | null = null;

  constructor(private readonly options: ServiceOptions) {}

  /** Calls `listener` for every `SERVICE_PORT=` line (once per start or restart). */
  onPort(listener: (port: number) => void): void {
    this.portListeners.push(listener);
  }

  start(onExit?: (code: number | null) => void): void {
    const { command, cwd, logDir } = this.options;
    mkdirSync(logDir, { recursive: true, mode: LOG_DIR_MODE });
    this.proc = Bun.spawn(command, { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    void this.pump(this.proc.stdout, this.options.echo, true);
    void this.pump(this.proc.stderr, this.options.echo, false);
    void this.proc.exited.then((code) => {
      this.exited = true;
      this.exitCode = code;
      this.log(`service exited with code ${code}`);
      onExit?.(code);
    });
  }

  /**
   * Waits for the port line, then polls `/api/health` until it answers 200. False when the
   * child exits or the time runs out.
   */
  async waitUntilReady(timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) return false;
      if (this.port !== null) {
        try {
          const res = await fetch(`http://127.0.0.1:${this.port}/api/health`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            this.log(`service healthy after ${Date.now() - startedAt} ms`);
            return true;
          }
        } catch {
          // Not listening yet, or restarting under --watch.
        }
      }
      await Bun.sleep(250);
    }
    return false;
  }

  /** Writes one line to the child's stdin (development: `GUI_URL=<vite url>`). */
  send(line: string): void {
    if (!this.proc || this.exited) return;
    try {
      this.proc.stdin.write(`${line}\n`);
      this.proc.stdin.flush();
    } catch {
      // The child is gone; its exit is logged.
    }
  }

  /** Last lines of output, for the failure page. */
  tail(lines = 40): string {
    const unfinished = [...this.openLines].map((line) => line.text).filter(Boolean);
    const last = [...this.recent, ...unfinished].slice(-lines);
    return last.length ? `${last.join("\n")}\n` : "";
  }

  private remember(line: string): void {
    this.recent.push(line);
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
  }

  stop(): void {
    if (!this.proc || this.exited) return;
    this.proc.kill();
  }

  /** Service log of the current local day, `service-YYYY-MM-DD.log`. */
  get serviceLogFile(): string {
    return join(this.options.logDir, dailyLogFileName("service"));
  }

  /** Shell-side event, appended to the shell log of the day. */
  log(message: string): void {
    logShellEvent(this.options.logDir, message, this.options.echo);
  }

  private async pump(stream: ReadableStream<Uint8Array>, echo: boolean, readPort: boolean): Promise<void> {
    const decoder = new TextDecoder();
    const serviceLog = writerFor(this.options.logDir, "service");
    const open = { text: "" };
    this.openLines.add(open);
    try {
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        const plain = text.replace(ANSI_PATTERN, "");
        const lines = (open.text + plain).split("\n");
        open.text = lines.pop() ?? "";
        for (const line of lines) this.remember(line);
        serviceLog.write(plain);
        if (echo) process.stdout.write(text);
        if (!readPort) continue;
        for (const line of lines) {
          const port = parseServicePort(line);
          if (port === null) continue;
          if (this.port !== null && this.options.singlePort) continue;
          this.port = port;
          for (const listener of this.portListeners) listener(this.port);
        }
      }
    } catch {
      // Stream closed by kill or exit.
    }
    this.openLines.delete(open);
    if (open.text) this.remember(open.text);
  }
}
