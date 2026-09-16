/**
 * Where the service keeps its files. Resolved once from the environment the
 * desktop shell (or a developer) passes in:
 *
 *   PORTFOLIO_DATA_DIR   data directory; default is the per-user config dir
 *                        (~/.config/portfolio, %APPDATA%\portfolio, ...)
 *   PORTFOLIO_LOG_DIR    log directory; default is the per-user log dir
 *
 * Everything else the service needs (LLM providers, API keys, preferences)
 * lives in the `config` table of the SQLite database, never in a .env file.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "portfolio";

function envDir(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Per-user data directory of the app (settings database, market cache). */
export function getStorageDir(): string {
  const override = envDir("PORTFOLIO_DATA_DIR");
  if (override) return override;
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

/** Per-user log directory (`service.log` and its rotated copy). */
export function getLogDir(): string {
  const override = envDir("PORTFOLIO_LOG_DIR");
  if (override) return override;
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
