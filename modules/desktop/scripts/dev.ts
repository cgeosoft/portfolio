/**
 * Live development of the desktop app: `bun start` at the repository root.
 *
 *   Vite dev server   modules/gui on http://127.0.0.1:5133, hot reload of every GUI change,
 *                     `/api` proxied to the service
 *   service           modules/service/src/main.ts under `bun --watch` on port 5132, restarted
 *                     on every service change (the desktop shell starts it)
 *   desktop shell     `electrobun dev`, one window on the Vite dev server
 *
 * No stage and no bundle: the service runs from the checkout as in `bun run dev`, so its data
 * goes to `<workspace>/.tmp`. The ports differ from `bun run dev` (5130, 5131) and from the
 * installed app (5130), so both can keep running. Changes to the shell itself (`src/bun/`)
 * need a restart.
 *
 * Override the ports with `PORTFOLIO_DEV_GUI_PORT` and `PORTFOLIO_DEV_SERVICE_PORT`.
 */
import { join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopDir, "../..");
const guiDir = join(repoRoot, "modules/gui");
const serviceDir = join(repoRoot, "modules/service");
const guiPort = Number(process.env.PORTFOLIO_DEV_GUI_PORT) || 5133;
const servicePort = Number(process.env.PORTFOLIO_DEV_SERVICE_PORT) || 5132;
const guiUrl = `http://127.0.0.1:${guiPort}`;

const children: Bun.Subprocess[] = [];
let stopping = false;

function stop(code: number): never {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(0));

function spawn(name: string, cmd: string[], cwd: string, env: Record<string, string>): Bun.Subprocess {
  console.log(`[dev] ${name}: ${cmd.join(" ")} (${cwd})`);
  const child = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  children.push(child);
  void child.exited.then((code) => {
    if (stopping) return;
    console.log(`[dev] ${name} exited with code ${code}`);
    stop(code ?? 1);
  });
  return child;
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await Bun.sleep(250);
    }
  }
  return false;
}

// vite.config.ts reads VITE_PORT for itself and PORTFOLIO_PORT for the /api proxy target.
spawn("gui", [process.execPath, "--bun", "vite", "--strictPort"], guiDir, {
  VITE_PORT: String(guiPort),
  PORTFOLIO_PORT: String(servicePort),
});
if (!(await waitFor(guiUrl, 30_000))) {
  console.error(`[dev] the Vite dev server did not answer on ${guiUrl}`);
  stop(1);
}

// Offline Hutch skips the release metadata lookups, which can stall `electrobun dev` for a
// minute; the toolchain is already installed. Set DASH_RELEASE_OFFLINE=0 to go online.
spawn("desktop", [process.execPath, "x", "electrobun", "dev"], desktopDir, {
  DASH_RELEASE_OFFLINE: process.env.DASH_RELEASE_OFFLINE ?? "1",
  PORTFOLIO_PORT: String(servicePort),
  PORTFOLIO_DEV_GUI_URL: guiUrl,
  PORTFOLIO_DEV_SERVICE_DIR: serviceDir,
  PORTFOLIO_DEV_BUN: process.execPath,
});
