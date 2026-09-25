/**
 * Live development (`bun start`, which is `electrobun dev` without a stage).
 *
 * An unpackaged shell that finds the checkout runs everything from source itself:
 *
 *   service     `<bun> --watch modules/service/src/main.ts`, restarted on every service change;
 *               each start prints `SERVICE_PORT=<port>` (a new random port every time)
 *   Vite        `<bun> modules/gui/scripts/dev-server.ts <servicePort>` with hot reload; it
 *               proxies `/api` to the service and prints `GUI_URL=<url>`
 *   window      on GUI_URL
 *
 * After a restart of the service the shell sends the new port to the dev server on its stdin,
 * so the window keeps its URL. `<bun>` is the runtime of this shell (`process.execPath`).
 * Changes to the shell itself (`src/bun/`) need a restart of `bun start`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP } from "./app";
import { logShellEvent } from "./service";

const GUI_URL_LINE = /^GUI_URL=(\S+)$/;
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * The checkout root: the nearest parent of `from` whose `package.json` is the workspace root.
 * Undefined for an installed app. `electrobun dev` runs the shell from a bundle under
 * `modules/desktop/build/`, so the walk goes up to twelve levels.
 */
export function findRepoRoot(from: string): string | undefined {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf-8")) as { name?: string }).name === APP.rootPackageName) return dir;
      } catch {
        // Keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** The service command of a development run: the checkout's `main.ts` under `bun --watch`. */
export function devServiceCommand(repoRoot: string): { command: string[]; cwd: string } {
  const serviceDir = join(repoRoot, "modules", "service");
  return { command: [process.execPath, "--watch", join(serviceDir, "src", "main.ts")], cwd: serviceDir };
}

/** The Vite dev server of a development run (`modules/gui/scripts/dev-server.ts`). */
export class DevGuiServer {
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private url: string | null = null;
  private exited = false;
  private readonly recent: string[] = [];

  constructor(
    private readonly repoRoot: string,
    private readonly logDir: string,
  ) {}

  /** Starts Vite with `/api` proxied to `servicePort`. */
  start(servicePort: number): void {
    const guiDir = join(this.repoRoot, "modules", "gui");
    this.proc = Bun.spawn([process.execPath, join(guiDir, "scripts", "dev-server.ts"), String(servicePort)], {
      cwd: guiDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.pump(this.proc.stdout, true);
    void this.pump(this.proc.stderr, false);
    void this.proc.exited.then((code) => {
      this.exited = true;
      logShellEvent(this.logDir, `Vite dev server exited with code ${code}`, true);
    });
  }

  /** Points the `/api` proxy at the service's new port after a `--watch` restart. */
  setServicePort(port: number): void {
    if (!this.proc || this.exited) return;
    try {
      this.proc.stdin.write(`SERVICE_PORT=${port}\n`);
      this.proc.stdin.flush();
    } catch {
      // The dev server is gone; its exit is logged.
    }
  }

  /** The URL Vite listens on, once it printed `GUI_URL=`; null when it exits first. */
  async waitForUrl(timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.url && !this.exited) await Bun.sleep(100);
    return this.url;
  }

  /** Last lines of output, for the failure page. */
  tail(lines = 40): string {
    return this.recent.slice(-lines).join("");
  }

  stop(): void {
    if (this.proc && !this.exited) this.proc.kill();
  }

  private async pump(stream: ReadableStream<Uint8Array>, readUrl: boolean): Promise<void> {
    const decoder = new TextDecoder();
    let partial = "";
    try {
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        process.stdout.write(text);
        const plain = text.replace(ANSI_PATTERN, "");
        this.recent.push(plain);
        if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
        if (!readUrl) continue;
        const lines = (partial + plain).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const match = GUI_URL_LINE.exec(line.trim());
          if (match) this.url = match[1].replace(/\/+$/, "");
        }
      }
    } catch {
      // Stream closed by kill or exit.
    }
  }
}
