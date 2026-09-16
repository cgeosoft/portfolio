/**
 * User settings, stored as JSON values in the `config` table of the SQLite
 * database (one row per DesktopConfig key). `loadConfig()` returns the merged
 * view over the defaults; `updateConfig()` merges a partial update the same
 * way the old config.json did. A config.json from an earlier release is
 * imported once and renamed to config.json.migrated.
 */
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { DEFAULT_LLAMACPP_URL } from "portfolio-shared/llm-defaults";
import { DEFAULT_DATA_PROVIDER_ROUTING, type DesktopConfig, type DataProviderCategoryRouting } from "portfolio-shared/config-types";
import { getDatabase } from "./db/database";
import { getStorageDir } from "./paths";

export type { DesktopConfig, DataProviderId, DataProviderCategoryRouting, WindowStateConfig } from "portfolio-shared/config-types";
export { DEFAULT_DATA_PROVIDER_ROUTING } from "portfolio-shared/config-types";
export { getStorageDir } from "./paths";

const DEFAULT_CONFIG: Omit<DesktopConfig, "deviceId"> = {
  setupCompleted: false,
  telemetryEnabled: false,
  baseCurrency: "EUR",
  hideCurrencyValues: false,
  llmProvider: "",
  llmModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmTemperature: 0.3,
  llamacppServerUrl: DEFAULT_LLAMACPP_URL,
  llmApiKeys: {},
  llmBaseUrls: {},
  llmModels: {},
  finnhubApiKey: "",
  dataProviderRouting: { ...DEFAULT_DATA_PROVIDER_ROUTING },
  lastQuotesSync: undefined,
  marketQuotesInterval: 15,
  startWithBoot: false,
  skipReportIntro: false,
  checkForUpdates: true,
  lastUpdateCheck: undefined,
  dismissedUpdateVersion: undefined,
  zoomLevel: 1.0,
};

/** Keys of the old config.json that are no longer settings of the service. */
const DROPPED_KEYS = new Set(["windowState", "lastImportDirectory", "webpageUrl"]);

let migrated = false;

function readRows(): Record<string, unknown> {
  const db = getDatabase();
  const rows = db.query("SELECT key, value FROM config").all() as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // A corrupt row falls back to the default.
    }
  }
  return out;
}

function writeRows(values: Record<string, unknown>): void {
  const db = getDatabase();
  const upsert = db.prepare(
    "INSERT INTO config (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
  );
  const remove = db.prepare("DELETE FROM config WHERE key = ?");
  const now = new Date().toISOString();
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (DROPPED_KEYS.has(key)) continue;
      if (value === undefined) remove.run(key);
      else upsert.run(key, JSON.stringify(value), now);
    }
  });
  run();
}

/** One-time import of the config.json written by releases before 0.3. */
function migrateLegacyFile(): void {
  if (migrated) return;
  migrated = true;
  const file = join(getStorageDir(), "config.json");
  if (!existsSync(file)) return;
  const db = getDatabase();
  const count = (db.query("SELECT COUNT(*) AS n FROM config").get() as { n: number }).n;
  try {
    if (count === 0) {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
      writeRows(parsed);
    }
    renameSync(file, `${file}.migrated`);
  } catch {
    // An unreadable file is left in place; defaults apply.
  }
}

function normalize(parsed: Record<string, unknown>): DesktopConfig {
  const cfg = { ...DEFAULT_CONFIG, ...parsed } as DesktopConfig;
  cfg.dataProviderRouting = {
    ...DEFAULT_DATA_PROVIDER_ROUTING,
    ...((parsed.dataProviderRouting as Partial<DataProviderCategoryRouting> | undefined) || {}),
  };
  if (!cfg.llamacppServerUrl && cfg.llmBaseUrl && (!cfg.llmProvider || cfg.llmProvider === "llamacpp-server" || cfg.llmProvider === "llamacpp")) {
    cfg.llamacppServerUrl = cfg.llmBaseUrl;
  }
  if (typeof cfg.zoomLevel !== "number" || !Number.isFinite(cfg.zoomLevel) || cfg.zoomLevel < 0.25 || cfg.zoomLevel > 5.0) {
    cfg.zoomLevel = 1.0;
  }
  if (typeof cfg.deviceId !== "string" || !cfg.deviceId) {
    cfg.deviceId = randomUUID();
    writeRows({ deviceId: cfg.deviceId });
  }
  return cfg;
}

/** Current settings, merged over the defaults. */
export function loadConfig(): DesktopConfig {
  migrateLegacyFile();
  return normalize(readRows());
}

/** Replaces every stored key with the given config. */
export function saveConfig(config: DesktopConfig): void {
  migrateLegacyFile();
  writeRows({ ...config });
}

/** Merges partial updates into the current config and stores the result. */
export function updateConfig(updates: Partial<DesktopConfig>): DesktopConfig {
  const current = loadConfig();
  const updated: DesktopConfig = { ...current, ...updates };
  if (updates.dataProviderRouting) {
    updated.dataProviderRouting = { ...current.dataProviderRouting, ...updates.dataProviderRouting };
  }
  if (updates.llmApiKeys) updated.llmApiKeys = { ...(current.llmApiKeys || {}), ...updates.llmApiKeys };
  if (updates.llmBaseUrls) updated.llmBaseUrls = { ...(current.llmBaseUrls || {}), ...updates.llmBaseUrls };
  if (updates.llmModels) updated.llmModels = { ...(current.llmModels || {}), ...updates.llmModels };
  if (
    updates.llmBaseUrl !== undefined &&
    (!updated.llamacppServerUrl || updated.llmProvider === "llamacpp-server" || updated.llmProvider === "llamacpp")
  ) {
    updated.llamacppServerUrl = updates.llmBaseUrl;
  }
  if (updates.llamacppServerUrl !== undefined && !updated.llmBaseUrl) {
    updated.llmBaseUrl = updates.llamacppServerUrl;
  }
  writeRows({ ...updates, ...pickMerged(updated, updates) });
  if (typeof updates.startWithBoot === "boolean") syncAutostart(updates.startWithBoot);
  return updated;
}

/** The record-valued keys are written back merged, not as the partial that came in. */
function pickMerged(updated: DesktopConfig, updates: Partial<DesktopConfig>): Partial<DesktopConfig> {
  const out: Partial<DesktopConfig> = {};
  if (updates.dataProviderRouting) out.dataProviderRouting = updated.dataProviderRouting;
  if (updates.llmApiKeys) out.llmApiKeys = updated.llmApiKeys;
  if (updates.llmBaseUrls) out.llmBaseUrls = updated.llmBaseUrls;
  if (updates.llmModels) out.llmModels = updated.llmModels;
  if (updates.llmBaseUrl !== undefined || updates.llamacppServerUrl !== undefined) {
    out.llamacppServerUrl = updated.llamacppServerUrl;
    out.llmBaseUrl = updated.llmBaseUrl;
  }
  return out;
}

/** Linux autostart entry (~/.config/autostart/portfolio.desktop). */
export function syncAutostart(enabled: boolean): void {
  if (process.platform !== "linux") return;
  try {
    const home = homedir() || process.env["HOME"] || "~";
    const autostartDir = join(home, ".config", "autostart");
    const desktopFilePath = join(autostartDir, "portfolio.desktop");
    if (enabled) {
      mkdirSync(autostartDir, { recursive: true });
      // The desktop shell passes its own launcher path; a bare service has none.
      const execCommand = process.env["PORTFOLIO_LAUNCHER"] || "portfolio";
      writeFileSync(
        desktopFilePath,
        `[Desktop Entry]\nType=Application\nName=Portfolio\nComment=Personal Investment Portfolio Tracker\nExec=${execCommand}\nIcon=portfolio\nTerminal=false\nCategories=Finance;Office;\nX-GNOME-Autostart-enabled=true\n`,
        "utf-8",
      );
    } else if (existsSync(desktopFilePath)) {
      unlinkSync(desktopFilePath);
    }
  } catch {
    // Best-effort Linux autostart management
  }
}
