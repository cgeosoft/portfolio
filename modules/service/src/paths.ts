/**
 * Where the service keeps its files. Resolved once from the environment the
 * desktop shell (or a developer) passes in:
 *
 *   PORTFOLIO_DATA_DIR   data directory; default is `<workspace>/.tmp` in
 *                        development and the per-user config dir in production
 *                        (~/.config/portfolio, %APPDATA%\portfolio, ...)
 *   PORTFOLIO_LOG_DIR    log directory; default is `<workspace>/logs` in
 *                        development and the per-user log dir in production
 *                        (~/.local/state/portfolio/logs, ~/Library/Logs/portfolio,
 *                        %LOCALAPPDATA%\portfolio\logs)
 *
 * Everything else the service needs (LLM providers, API keys, preferences)
 * lives in the `settings` table of the SQLite database, never in a .env file.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { getWorkspaceRoot, isProduction } from "./environment";

const APP_DIR_NAME = "portfolio";

function envDir(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Data directory of the app (settings database, host settings, metric
 * modules). A developer gets `<workspace>/.tmp` (ignored by git) so `bun dev`
 * never touches the data of the installed app; production uses the per-user
 * config directory.
 */
export function getStorageDir(): string {
  const override = envDir("PORTFOLIO_DATA_DIR");
  if (override) return override;
  if (!isProduction()) {
    const root = getWorkspaceRoot();
    if (root) return join(root, ".tmp");
  }
  const home = homedir() || process.env["HOME"] || "~";
  if (process.platform === "win32") {
    return process.env["APPDATA"] ? join(process.env["APPDATA"], APP_DIR_NAME) : join(home, "AppData", "Roaming", APP_DIR_NAME);
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", APP_DIR_NAME);
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  return xdgConfig ? join(xdgConfig, APP_DIR_NAME) : join(home, ".config", APP_DIR_NAME);
}

/** SQLite database file: `<data dir>/data/portfolio.sqlite`. */
export function getDatabaseFile(): string {
  return join(getStorageDir(), "data", "portfolio.sqlite");
}

/**
 * Log directory (`service-YYYY-MM-DD.log`, `desktop-YYYY-MM-DD.log`). The
 * desktop shell passes `PORTFOLIO_LOG_DIR`; a developer gets `<workspace>/logs`
 * (ignored by git); a bare production process the per-user log directory.
 */
export function getLogDir(): string {
  const override = envDir("PORTFOLIO_LOG_DIR");
  if (override) return override;
  if (!isProduction()) {
    const root = getWorkspaceRoot();
    if (root) return join(root, "logs");
  }
  const dataOverride = envDir("PORTFOLIO_DATA_DIR");
  if (dataOverride) return join(dataOverride, "logs");
  const home = homedir() || process.env["HOME"] || "~";
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    return localAppData ? join(localAppData, APP_DIR_NAME, "logs") : join(home, "AppData", "Local", APP_DIR_NAME, "logs");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Logs", APP_DIR_NAME);
  }
  const xdgState = process.env["XDG_STATE_HOME"];
  if (xdgState) return join(xdgState, APP_DIR_NAME, "logs");
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  return xdgConfig ? join(xdgConfig, APP_DIR_NAME, "logs") : join(home, ".config", APP_DIR_NAME, "logs");
}
