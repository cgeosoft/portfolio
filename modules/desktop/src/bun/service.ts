import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Removes ANSI escape codes (colours, cursor moves) from the service output. */
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** The one line the service prints once it listens on its random loopback port. */
const PORT_LINE = /^SERVICE_PORT=(\d+)$/;

/** `<prefix>-YYYY-MM-DD.log` for the current local day. */
export function dailyLogFileName(prefix: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.log`;
}

/** Appends a shell event to `<logDir>/desktop-YYYY-MM-DD.log` and echoes it in a development run. */
export function logShellEvent(logDir: string, message: string, echo: boolean): void {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, dailyLogFileName("desktop")), `${new Date().toISOString()}  INFO   desktop  ${message}\n`);
  } catch {
    // Logging must never take the app down.
  }
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
  private proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private readonly recent: string[] = [];
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
    const { command, cwd, logDir, echo } = this.options;
    mkdirSync(logDir, { recursive: true });
    this.proc = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    void this.pump(this.proc.stdout, echo, true);
    void this.pump(this.proc.stderr, echo, false);
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
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) return false;
      if (this.port !== null) {
        try {
          const res = await fetch(`http://127.0.0.1:${this.port}/api/health`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) return true;
        } catch {
          // Not listening yet, or restarting under --watch.
        }
      }
      await Bun.sleep(250);
    }
    return false;
  }

  /** Last lines of output, for the failure page. */
  tail(lines = 40): string {
    return this.recent.slice(-lines).join("");
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
    let partial = "";
    try {
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        const plain = text.replace(ANSI_PATTERN, "");
        this.recent.push(plain);
        if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
        try {
          appendFileSync(this.serviceLogFile, plain);
        } catch {
          // Best effort.
        }
        if (echo) process.stdout.write(text);
        if (!readPort) continue;
        const lines = (partial + plain).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const match = PORT_LINE.exec(line.trim());
          if (!match) continue;
          this.port = Number(match[1]);
          for (const listener of this.portListeners) listener(this.port);
        }
      }
    } catch {
      // Stream closed by kill or exit.
    }
  }
}
