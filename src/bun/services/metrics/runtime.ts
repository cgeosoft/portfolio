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
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getStorageDir } from "../../config.js";
import { appLogger } from "../../logger.js";
import {
  DEFAULT_METRIC_TIMEOUT_MS,
  MAX_METRIC_MEMORY_PAGES,
  MAX_METRIC_TIMEOUT_MS,
  METRIC_ABI_VERSION,
} from "../../../shared/metric-abi.js";
import { METRIC_ENGINE_SOURCE } from "./engine-source.js";

/** Scheduling and IPC slack added to a module's own time budget before it is killed. */
const TIMEOUT_GRACE_MS = 250;
const LOAD_TIMEOUT_MS = 10_000;

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

export class MetricRuntime {
  private engine: EngineProcess | null = null;
  private nextId = 1;
  private readonly enginePath: string;
  private readonly executable: string;
  private readonly quarantined = new Map<string, string>();
  private spawnPromise: Promise<EngineProcess> | null = null;

  constructor(options: MetricRuntimeOptions = {}) {
    this.enginePath = join(options.engineDir ?? join(getStorageDir(), "metrics"), "engine.js");
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

  /** Compile and validate a module inside the engine. Resolves with the guest ABI version. */
  async load(moduleId: string, bytes: Uint8Array): Promise<number> {
    if (this.quarantined.has(moduleId)) throw new MetricQuarantinedError(moduleId, this.quarantined.get(moduleId)!);
    const engine = await this.ensureEngine();
    const res = await this.request(
      engine,
      { op: "load", moduleId, base64: Buffer.from(bytes).toString("base64") },
      LOAD_TIMEOUT_MS,
      moduleId,
    );
    const abi = Number(res["abi"]);
    if (abi !== METRIC_ABI_VERSION) {
      throw new Error(`Module targets ABI ${abi}, this application supports ABI ${METRIC_ABI_VERSION}`);
    }
    engine.loaded.add(moduleId);
    return abi;
  }

  /** Run a loaded module. Loads it first when the engine was respawned since. */
  async run(
    moduleId: string,
    bytes: Uint8Array,
    payload: Uint8Array,
    options: MetricRunOptions = {},
  ): Promise<MetricRunResult> {
    if (this.quarantined.has(moduleId)) throw new MetricQuarantinedError(moduleId, this.quarantined.get(moduleId)!);
    let engine = await this.ensureEngine();
    if (!engine.loaded.has(moduleId)) {
      await this.load(moduleId, bytes);
      engine = await this.ensureEngine();
    }
    const budgetMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_METRIC_TIMEOUT_MS, 1), MAX_METRIC_TIMEOUT_MS);
    const memoryPages = Math.min(Math.max(options.memoryPages ?? MAX_METRIC_MEMORY_PAGES, 1), MAX_METRIC_MEMORY_PAGES);
    const res = await this.request(
      engine,
      { op: "run", moduleId, base64: Buffer.from(payload).toString("base64"), memoryPages },
      budgetMs + TIMEOUT_GRACE_MS,
      moduleId,
      budgetMs,
    );
    return { output: String(res["output"] ?? ""), elapsedMs: Number(res["elapsedMs"] ?? 0) };
  }

  async unload(moduleId: string): Promise<void> {
    if (!this.engine?.alive || !this.engine.loaded.has(moduleId)) return;
    this.engine.loaded.delete(moduleId);
    await this.request(this.engine, { op: "unload", moduleId }, LOAD_TIMEOUT_MS).catch(() => undefined);
  }

  /** Stop the engine process. It restarts on the next request. */
  shutdown(): void {
    if (this.engine) this.killEngine(this.engine, "shutdown");
  }

  // ── Engine lifecycle ───────────────────────────────────────────────────────

  private ensureEngine(): Promise<EngineProcess> {
    if (this.engine?.alive) return Promise.resolve(this.engine);
    if (!this.spawnPromise) {
      this.spawnPromise = this.spawn().finally(() => {
        this.spawnPromise = null;
      });
    }
    return this.spawnPromise;
  }

  private async spawn(): Promise<EngineProcess> {
    mkdirSync(dirname(this.enginePath), { recursive: true });
    writeFileSync(this.enginePath, METRIC_ENGINE_SOURCE);

    const proc: EngineSubprocess = Bun.spawn([this.executable, this.enginePath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const engine: EngineProcess = { proc, loaded: new Set(), pending: new Map(), alive: true };
    this.engine = engine;

    void this.pumpStdout(engine);
    void this.pumpStderr(engine);
    void proc.exited.then((code) => {
      if (engine.alive) {
        engine.alive = false;
        appLogger.logStep("warning", "metrics", "engine_exit", "Metric engine exited unexpectedly", undefined, { code });
      }
      this.failPending(engine, new Error("Metric engine stopped"));
      if (this.engine === engine) this.engine = null;
    });

    const ping = await this.request(engine, { op: "ping" }, LOAD_TIMEOUT_MS);
    appLogger.logStep("info", "metrics", "engine_start", "Metric engine started", undefined, { pid: ping["pid"] });
    return engine;
  }

  private async pumpStdout(engine: EngineProcess): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of engine.proc.stdout as ReadableStream<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let message: EngineResponse;
          try {
            message = JSON.parse(line) as EngineResponse;
          } catch {
            continue;
          }
          const pending = engine.pending.get(message.id);
          if (!pending) continue;
          engine.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message);
          else pending.reject(new Error(message.error || "Metric engine error"));
        }
      }
    } catch {
      // Stream closed by kill or exit; pending requests fail through the exit handler.
    }
  }

  private async pumpStderr(engine: EngineProcess): Promise<void> {
    const decoder = new TextDecoder();
    let logged = 0;
    try {
      for await (const chunk of engine.proc.stderr as ReadableStream<Uint8Array>) {
        if (logged++ > 20) continue;
        const text = decoder.decode(chunk).trim().slice(0, 500);
        if (text) appLogger.logStep("warning", "metrics", "engine_stderr", "Metric engine wrote to stderr", undefined, { text });
      }
    } catch {
      // Stream closed.
    }
  }

  private request(
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
        if (moduleId && budgetMs !== undefined) {
          const reason = `exceeded its ${budgetMs} ms time budget`;
          this.quarantined.set(moduleId, reason);
          appLogger.logStep("warning", "metrics", "module_timeout", "Metric module stopped after timeout", undefined, {
            moduleId,
            budgetMs,
          });
          this.killEngine(engine, "timeout");
          reject(new MetricTimeoutError(moduleId, budgetMs));
        } else {
          this.killEngine(engine, "unresponsive");
          reject(new Error(moduleId ? `Metric ${moduleId} did not load in time` : "Metric engine is unresponsive"));
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
