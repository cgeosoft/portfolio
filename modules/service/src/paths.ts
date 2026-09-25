/**
 * Where the service finds its files. Every path starts here. The service
 * derives them itself; nothing comes from the environment.
 *
 * The user data directory (`DATA_DIR`) holds everything the app writes, the
 * same in development and in the installed app:
 *
 *   <data>/portfolio.sqlite       the database: portfolios, settings, sessions
 *   <data>/metrics/               the metric engine script and its modules
 *   <data>/logs/                  service-YYYY-MM-DD.log and desktop-YYYY-MM-DD.log,
 *                                 written by the desktop shell from the service output
 *   <data>/desktop-settings.json  the switches the desktop shell reads (close to tray)
 *
 * The data directory is `~/.local/share/portfolio` on Linux,
 * `~/Library/Application Support/portfolio` on macOS and
 * `%APPDATA%\portfolio` on Windows. The desktop shell computes the same
 * directory in `modules/desktop/src/bun/app.ts`; keep the two in step.
 *
 * Bundled files (the built GUI, the sponsor pages, `version.txt`) sit next to
 * the service bundle. From a checkout the GUI is not served (Vite serves it)
 * and the sponsor pages come from `extras/website`.
 *
 * This module imports nothing from the project, so every other module can
 * import it.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT_PACKAGE_NAME = "portfolio";

/** Directory name under the per-user data directory. Shared with `modules/desktop/src/bun/app.ts`. */
export const APP_DIR_NAME = "portfolio";

/**
 * The repository root: the nearest parent directory whose `package.json` is
 * the workspace root. Undefined inside a bundle installed outside the
 * repository (the packaged desktop app).
 */
function findRepoRoot(): string | undefined {
  let dir = import.meta.dir;
  // Twelve levels: enough for a desktop bundle built inside the checkout,
  // which runs from `modules/desktop/build/<target>/<app>/Resources/app/service/`.
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (pkg.name === ROOT_PACKAGE_NAME) return dir;
      } catch {
        // Not a package manifest we can read; keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Absolute path to the repository root, when the service runs from a checkout. */
export const REPO_ROOT: string | undefined = findRepoRoot();

/**
 * The per-user data directory. On Linux `XDG_DATA_HOME` is ignored on
 * purpose: editors such as Zed set it for their child processes, and the app
 * must open the same data whether it starts from a terminal or the desktop.
 * On Windows `APPDATA` only locates the OS folder for roaming app data.
 */
export function defaultDataDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"]?.trim();
    return join(appData || join(home, "AppData", "Roaming"), APP_DIR_NAME);
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", APP_DIR_NAME);
  return join(home, ".local", "share", APP_DIR_NAME);
}

/**
 * Absolute path to the user data directory. A live binding: tests point it at
 * a scratch directory with `setDataDirForTests`.
 */
export let DATA_DIR: string = defaultDataDir();

/**
 * The directories that held the data before 0.6, for the one-time import in
 * `bootstrap.ts`: `~/.config/portfolio` on Linux, the data directory itself
 * on macOS and Windows (only the database file moved there).
 */
export let LEGACY_DATA_DIR: string | undefined =
  process.platform === "linux" ? join(homedir(), ".config", APP_DIR_NAME) : DATA_DIR;

/**
 * Test preload hook: every file goes to `dir`, and the one-time import of the
 * legacy directory is skipped so a test never reads the user's real data.
 */
export function setDataDirForTests(dir: string): void {
  DATA_DIR = resolve(dir);
  LEGACY_DATA_DIR = undefined;
}

/** SQLite database file. */
export function getDatabaseFile(): string {
  return join(DATA_DIR, "portfolio.sqlite");
}

/** Daily log files of the service and the desktop shell. */
export function getLogDir(): string {
  return join(DATA_DIR, "logs");
}

/** Metric engine script and metric modules. */
export function getMetricsDir(): string {
  return join(DATA_DIR, "metrics");
}

/** The switches the desktop shell reads at run time (see `services/desktop-settings.ts`). */
export function getDesktopSettingsFile(): string {
  return join(DATA_DIR, "desktop-settings.json");
}

/**
 * Directory of the built GUI (`index.html` and `assets/`) inside the desktop
 * bundle: `Resources/app/gui`, next to `Resources/app/service/main.js`.
 * Undefined from a checkout, where Vite serves the GUI.
 */
export function getGuiDir(): string | undefined {
  const dir = resolve(import.meta.dir, "..", "gui");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

/**
 * A file shipped with the service: next to the bundle in the desktop app
 * (`bundled`), else in the checkout (`repoPath`, relative to the repo root).
 */
export function findBundledFile(bundled: string, repoPath: string): string | undefined {
  const candidates = [join(import.meta.dir, bundled), ...(REPO_ROOT ? [join(REPO_ROOT, repoPath)] : [])];
  return candidates.find((file) => existsSync(file));
}
