/**
 * Sandboxed execution of metric modules.
 *
 * Modules run in a separate engine process (see engine-source.ts), never in
 * the main process and never in the webview. The process is spawned from the
 * application's own runtime binary and talks newline-delimited JSON over
 * stdio. It is a process rather than a Worker because a WebAssembly loop is
 * not interruptible in-thread: `Worker.terminate()` leaves it spinning, while
 * a process can always be killed. On a timeout the runtime kills the engine,
 * quarantines the offending module for the rest of the session, and lazily
 * respawns the engine for the next request.
 *
 * The engine serves one request at a time, so the runtime sends one at a
 * time too. A time budget starts only when the engine is idle, and a timeout
 * or a crash always belongs to the module whose request was in flight.
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMetricsDir } from "../../paths.js";
import { appLogger } from "../../logger.js";
import {
  DEFAULT_METRIC_TIMEOUT_MS,
  MAX_METRIC_MEMORY_PAGES,
  MAX_METRIC_TIMEOUT_MS,
  SUPPORTED_METRIC_ABI_VERSIONS,
  isSupportedMetricAbi,
} from "portfolio-shared/metric-abi";
import { METRIC_ENGINE_SOURCE } from "./engine-source.js";

/** Scheduling and IPC slack added to a module's own time budget before it is killed. */
const TIMEOUT_GRACE_MS = 250;
/** Budget of the requests that run no guest code: start-up ping, compile, unload. */
const CONTROL_TIMEOUT_MS = 10_000;
/** Longest error text taken from the engine. */
const MAX_ERROR_LENGTH = 300;
/** The engine takes no configuration; it keeps only what a process needs to start on each OS. */
const ENGINE_ENV_KEYS = ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"];
/** Named by content, so two builds that share a data directory never replace each other's engine. */
const ENGINE_FILE_NAME = `engine-${new Bun.CryptoHasher("sha256").update(METRIC_ENGINE_SOURCE).digest("hex").slice(0, 16)}.js`;

export interface MetricRunOptions {
  timeoutMs?: number;
  memoryPages?: number;
}

export interface MetricRunResult {
  output: string;
  elapsedMs: number;
}

export class MetricTimeoutError extends Error {
  constructor(moduleId: string, budgetMs: number) {
    super(`Metric ${moduleId} exceeded its ${budgetMs} ms time budget and was stopped`);
    this.name = "MetricTimeoutError";
  }
}

export class MetricQuarantinedError extends Error {
  constructor(moduleId: string, reason: string) {
    super(`Metric ${moduleId} is disabled for this session: ${reason}`);
    this.name = "MetricQuarantinedError";
  }
}

interface EngineResponse {
  id: number;
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface Pending {
  resolve: (value: EngineResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  moduleId?: string;
}

type EngineSubprocess = Bun.Subprocess<"pipe", "pipe", "pipe">;

interface EngineProcess {
  proc: EngineSubprocess;
  loaded: Set<string>;
  pending: Map<number, Pending>;
  alive: boolean;
}

export interface MetricRuntimeOptions {
  /** Directory that receives the engine script. Defaults to the app storage dir. */
  engineDir?: string;
  /** Executable used for the engine. Defaults to the current runtime binary. */
  executable?: string;
}

/** Colour codes the runtime may add to an error on stderr. */
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

function budgetOf(options: MetricRunOptions): number {
  return Math.min(Math.max(options.timeoutMs ?? DEFAULT_METRIC_TIMEOUT_MS, 1), MAX_METRIC_TIMEOUT_MS);
}

function engineEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENGINE_ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export class MetricRuntime {
  private engine: EngineProcess | null = null;
  private nextId = 1;
  private readonly engineDir: string;
  private readonly enginePath: string;
  private readonly executable: string;
  private readonly quarantined = new Map<string, string>();
  /** Last operation in the queue; see `exclusive()`. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: MetricRuntimeOptions = {}) {
    this.engineDir = options.engineDir ?? getMetricsDir();
    this.enginePath = join(this.engineDir, ENGINE_FILE_NAME);
    this.executable = options.executable ?? process.execPath;
  }

  /** Modules stopped during this session, with the reason. */
  getQuarantine(): ReadonlyMap<string, string> {
    return this.quarantined;
  }

  isQuarantined(moduleId: string): boolean {
    return this.quarantined.has(moduleId);
  }

  clearQuarantine(moduleId: string): void {
    this.quarantined.delete(moduleId);
  }

  /**
   * Compile, validate and probe a module inside the engine. Resolves with the
   * guest ABI version. The probe runs guest code, so it gets the run budget.
   */
  load(moduleId: string, bytes: Uint8Array, options: MetricRunOptions = {}): Promise<number> {
    return this.exclusive(() => this.loadNow(moduleId, bytes, options));
  }

  /** Run a loaded module. Loads it first when the engine was respawned since. */
  run(moduleId: string, bytes: Uint8Array, payload: Uint8Array, options: MetricRunOptions = {}): Promise<MetricRunResult> {
    return this.exclusive(async () => {
      this.assertRunnable(moduleId);
      let engine = await this.ensureEngine();
      if (!engine.loaded.has(moduleId)) {
        await this.loadNow(moduleId, bytes, options);
        engine = await this.ensureEngine();
      }
      const budgetMs = budgetOf(options);
      const memoryPages = Math.min(Math.max(options.memoryPages ?? MAX_METRIC_MEMORY_PAGES, 1), MAX_METRIC_MEMORY_PAGES);
      const res = await this.send(
        engine,
        { op: "run", moduleId, base64: Buffer.from(payload).toString("base64"), memoryPages },
        budgetMs + TIMEOUT_GRACE_MS,
        moduleId,
        budgetMs,
      );
      return { output: String(res["output"] ?? ""), elapsedMs: Number(res["elapsedMs"] ?? 0) };
    });
  }

  /** Drop a module from the engine. `force` asks the engine even when the runtime does not track it as loaded. */
  unload(moduleId: string, force = false): Promise<void> {
    return this.exclusive(() => this.unloadNow(moduleId, force));
  }

  /** Stop the engine process. It restarts on the next request. */
  shutdown(): void {
    if (this.engine) this.killEngine(this.engine, "shutdown");
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  /**
   * Run one engine operation at a time. The engine handles requests in order:
   * without the queue, a request sent while another one runs would wait
   * behind it, and its time budget would run out before it started.
   */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private assertRunnable(moduleId: string): void {
    const reason = this.quarantined.get(moduleId);
    if (reason !== undefined) throw new MetricQuarantinedError(moduleId, reason);
  }

  private async loadNow(moduleId: string, bytes: Uint8Array, options: MetricRunOptions): Promise<number> {
    this.assertRunnable(moduleId);
    const engine = await this.ensureEngine();
    engine.loaded.delete(moduleId);
    await this.send(engine, { op: "compile", moduleId, base64: Buffer.from(bytes).toString("base64") }, CONTROL_TIMEOUT_MS, moduleId);
    const budgetMs = budgetOf(options);
    const res = await this.send(engine, { op: "probe", moduleId }, budgetMs + TIMEOUT_GRACE_MS, moduleId, budgetMs);
    engine.loaded.add(moduleId);
    const abi = Number(res["abi"]);
    if (!isSupportedMetricAbi(abi)) {
      await this.unloadNow(moduleId);
      throw new Error(`Module targets ABI ${abi}, this application supports ABI ${SUPPORTED_METRIC_ABI_VERSIONS.join(" and ")}`);
    }
    return abi;
  }

  private async unloadNow(moduleId: string, force = false): Promise<void> {
    const engine = this.engine;
    if (!engine?.alive || (!force && !engine.loaded.has(moduleId))) return;
    engine.loaded.delete(moduleId);
    await this.send(engine, { op: "unload", moduleId }, CONTROL_TIMEOUT_MS).catch(() => undefined);
  }

  private quarantine(moduleId: string, reason: string): void {
    this.quarantined.set(moduleId, reason);
    appLogger.logStep("warning", "metrics", "module_stopped", "Metric module stopped for this session", undefined, { moduleId, reason });
  }

  // ── Engine lifecycle ───────────────────────────────────────────────────────

  private async ensureEngine(): Promise<EngineProcess> {
    if (this.engine?.alive) return this.engine;
    return this.spawn();
  }

  private async spawn(): Promise<EngineProcess> {
    this.writeEngineFile();

    const proc: EngineSubprocess = Bun.spawn([this.executable, this.enginePath], {
      cwd: this.engineDir,
      env: engineEnv(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const engine: EngineProcess = { proc, loaded: new Set(), pending: new Map(), alive: true };
    this.engine = engine;

    void this.pumpStdout(engine);
    void this.pumpStderr(engine);
    void proc.exited.then((code) => {
      if (engine.alive) {
        engine.alive = false;
        appLogger.logStep("warning", "metrics", "engine_exit", "Metric engine exited unexpectedly", undefined, { code });
        // At most one request is in flight: its module took the engine down (a crash or the OOM killer).
        for (const pending of engine.pending.values()) {
          if (pending.moduleId) this.quarantine(pending.moduleId, "stopped the metric engine");
        }
      }
      this.failPending(engine, new Error("Metric engine stopped"));
      if (this.engine === engine) this.engine = null;
    });

    const ping = await this.send(engine, { op: "ping" }, CONTROL_TIMEOUT_MS);
    appLogger.logStep("info", "metrics", "engine_start", "Metric engine started", undefined, { pid: ping["pid"] });
    return engine;
  }

  /** Write the engine once per content hash. The rename is atomic, so a starting engine never reads a partial file. */
  private writeEngineFile(): void {
    if (existsSync(this.enginePath)) return;
    mkdirSync(this.engineDir, { recursive: true });
    const temp = `${this.enginePath}.${process.pid}.tmp`;
    writeFileSync(temp, METRIC_ENGINE_SOURCE);
    try {
      renameSync(temp, this.enginePath);
    } catch (err) {
      rmSync(temp, { force: true });
      // Another instance wrote the same file first.
      if (!existsSync(this.enginePath)) throw err;
    }
  }

  private async pumpStdout(engine: EngineProcess): Promise<void> {
    const decoder = new TextDecoder();
    // Text of the current line from earlier chunks; each chunk is scanned once.
    const parts: string[] = [];
    try {
      for await (const chunk of engine.proc.stdout as ReadableStream<Uint8Array>) {
        let text = decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = text.indexOf("\n")) >= 0) {
          parts.push(text.slice(0, newline));
          text = text.slice(newline + 1);
          const line = parts.join("");
          parts.length = 0;
          this.receive(engine, line);
        }
        if (text) parts.push(text);
      }
    } catch {
      // Stream closed by kill or exit; pending requests fail through the exit handler.
    }
  }

  private receive(engine: EngineProcess, line: string): void {
    if (!line.trim()) return;
    let message: EngineResponse | null;
    try {
      message = JSON.parse(line) as EngineResponse | null;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const pending = engine.pending.get(message.id);
    if (!pending) return;
    engine.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message);
    else pending.reject(new Error(String(message.error || "Metric engine error").slice(0, MAX_ERROR_LENGTH)));
  }

  private async pumpStderr(engine: EngineProcess): Promise<void> {
    const decoder = new TextDecoder();
    let logged = 0;
    try {
      for await (const chunk of engine.proc.stderr as ReadableStream<Uint8Array>) {
        if (logged++ > 20) continue;
        const text = decoder.decode(chunk).replace(ANSI_ESCAPE, "").trim().slice(0, 500);
        if (text) appLogger.logStep("warning", "metrics", "engine_stderr", "Metric engine wrote to stderr", undefined, { text });
      }
    } catch {
      // Stream closed.
    }
  }

  /**
   * Send one request. Callers hold the queue (see `exclusive()`), so the engine
   * is idle and the timer measures this request only. A timeout of a request
   * that names a module quarantines that module.
   */
  private send(
    engine: EngineProcess,
    message: Record<string, unknown>,
    timeoutMs: number,
    moduleId?: string,
    budgetMs?: number,
  ): Promise<EngineResponse> {
    return new Promise<EngineResponse>((resolve, reject) => {
      if (!engine.alive) {
        reject(new Error("Metric engine is not running"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        engine.pending.delete(id);
        if (moduleId) {
          const reason = budgetMs === undefined ? "did not compile in time" : `exceeded its ${budgetMs} ms time budget`;
          this.quarantine(moduleId, reason);
          this.killEngine(engine, "timeout");
          reject(budgetMs === undefined ? new Error(`Metric ${moduleId} ${reason}`) : new MetricTimeoutError(moduleId, budgetMs));
        } else {
          this.killEngine(engine, "unresponsive");
          reject(new Error("Metric engine is unresponsive"));
        }
      }, timeoutMs);
      engine.pending.set(id, { resolve, reject, timer, moduleId });
      try {
        engine.proc.stdin.write(JSON.stringify({ id, ...message }) + "\n");
        engine.proc.stdin.flush();
      } catch (err) {
        clearTimeout(timer);
        engine.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private killEngine(engine: EngineProcess, reason: string): void {
    if (!engine.alive) return;
    engine.alive = false;
    engine.loaded.clear();
    try {
      engine.proc.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    this.failPending(engine, new Error(`Metric engine stopped (${reason})`));
    if (this.engine === engine) this.engine = null;
  }

  private failPending(engine: EngineProcess, error: Error): void {
    for (const [id, pending] of engine.pending) {
      clearTimeout(pending.timer);
      engine.pending.delete(id);
      pending.reject(error);
    }
  }
}
