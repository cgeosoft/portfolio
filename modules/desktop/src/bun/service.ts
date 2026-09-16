import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ServiceOptions {
  /** Directory holding `main.js`; also the child's cwd. */
  serviceDir: string;
  env: Record<string, string | undefined>;
  port: number;
  /** Shell log; the service keeps its own `service.log` in the same directory. */
  logFile: string;
  /** Also echo the child's output to this process's stdout (dev). */
  echo: boolean;
}

/**
 * The service as a child process of the same runtime binary that runs this
 * main process. Its stdout/stderr are kept in memory (last lines) so a
 * startup failure can be shown in the window. Same shape as Assistant.
 */
export class ServiceProcess {
  private proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private readonly recent: string[] = [];
  exited = false;
  exitCode: number | null = null;

  constructor(private readonly options: ServiceOptions) {}

  get healthUrl(): string {
    return `http://127.0.0.1:${this.options.port}/api/health`;
  }

  start(onExit?: (code: number | null) => void): void {
    const { serviceDir, env, logFile, echo } = this.options;
    mkdirSync(dirname(logFile), { recursive: true });
    const childEnv: Record<string, string> = { NO_COLOR: "1" };
    for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;
    this.proc = Bun.spawn([process.execPath, `${serviceDir}/main.js`], {
      cwd: serviceDir,
      env: childEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.pump(this.proc.stdout, echo);
    void this.pump(this.proc.stderr, echo);
    void this.proc.exited.then((code) => {
      this.exited = true;
      this.exitCode = code;
      this.log(`service exited with code ${code}`);
      onExit?.(code);
    });
  }

  /** Polls /api/health until the service answers or exits; false on failure. */
  async waitUntilReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) return false;
      try {
        const res = await fetch(this.healthUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return true;
      } catch {
        // Not listening yet.
      }
      await Bun.sleep(500);
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

  /** Shell-side event, written to desktop.log. */
  log(message: string): void {
    const line = `${new Date().toISOString()}  INFO   desktop  ${message}\n`;
    try {
      appendFileSync(this.options.logFile, line);
    } catch {
      // Logging must never take the app down.
    }
    if (this.options.echo) process.stdout.write(`[desktop] ${message}\n`);
  }

  private async pump(stream: ReadableStream<Uint8Array>, echo: boolean): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        this.recent.push(text);
        if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
        if (echo) process.stdout.write(text);
      }
    } catch {
      // Stream closed by kill or exit.
    }
  }
}
