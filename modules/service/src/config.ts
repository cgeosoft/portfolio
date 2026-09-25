/**
 * User settings, stored in the `settings` table of the SQLite database: one
 * row per DesktopConfig key, `key` and `value`. A string is stored as is;
 * numbers, booleans and records as JSON. `loadConfig()` returns the merged
 * view over the defaults; `updateConfig()` merges a partial update the same
 * way the old config.json did. A config.json from an earlier release is
 * imported once and renamed to config.json.migrated.
 */
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { DEFAULT_DATA_PROVIDER_ROUTING, DEFAULT_REMOTE_PORT, SECRET_MASK, type DesktopConfig, type DataProviderCategoryRouting } from "portfolio-shared/config-types";
import { getDatabase } from "./db/database";
import { DATA_DIR } from "./paths";

export type { DesktopConfig, DataProviderId, DataProviderCategoryRouting, WindowStateConfig } from "portfolio-shared/config-types";
export { DEFAULT_DATA_PROVIDER_ROUTING } from "portfolio-shared/config-types";

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
  theme: "dark",
  allowRemoteConnections: false,
  remotePort: DEFAULT_REMOTE_PORT,
};

/** Keys of the old config.json that are no longer settings of the service. */
const DROPPED_KEYS = new Set(["windowState", "lastImportDirectory", "webpageUrl"]);

/** Keys whose value is not a string, stored as JSON. Every other key is stored as plain text. */
const JSON_KEYS = new Set(
  Object.entries(DEFAULT_CONFIG)
    .filter(([, value]) => value !== undefined && typeof value !== "string")
    .map(([key]) => key),
);

let migrated = false;

function decode(key: string, value: string): unknown {
  return JSON_KEYS.has(key) ? JSON.parse(value) : value;
}

function encode(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function readRows(): Record<string, unknown> {
  const db = getDatabase();
  const rows = db.query("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.key] = decode(row.key, row.value);
    } catch {
      // A corrupt row falls back to the default.
    }
  }
  return out;
}

function writeRows(values: Record<string, unknown>): void {
  const db = getDatabase();
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const remove = db.prepare("DELETE FROM settings WHERE key = ?");
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (DROPPED_KEYS.has(key)) continue;
      if (value === undefined) remove.run(key);
      else upsert.run(key, encode(value));
    }
  });
  run();
}

/** One-time move of the `config` table (JSON value per key, releases before 0.6) into `settings`. */
function migrateConfigTable(): void {
  const db = getDatabase();
  const exists = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'config'").get();
  if (!exists) return;
  const rows = db.query("SELECT key, value FROM config").all() as { key: string; value: string }[];
  const values: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      values[row.key] = JSON.parse(row.value);
    } catch {
      // A corrupt row falls back to the default.
    }
  }
  db.transaction(() => {
    writeRows(values);
    db.run("DROP TABLE config");
  })();
}

/** One-time import of the config.json written by releases before 0.3. */
function migrateLegacyFile(): void {
  if (migrated) return;
  migrated = true;
  migrateConfigTable();
  const file = join(DATA_DIR, "config.json");
  if (!existsSync(file)) return;
  const db = getDatabase();
  const count = (db.query("SELECT COUNT(*) AS n FROM settings").get() as { n: number }).n;
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

/** Base URLs of the per-server and per-cloud providers that releases before 0.6 offered. */
const LEGACY_PROVIDER_URLS: Record<string, string> = {
  llamacpp: "http://127.0.0.1:8080",
  "llamacpp-server": "http://127.0.0.1:8080",
  ollama: "http://127.0.0.1:11434",
  nebius: "https://api.tokenfactory.nebius.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/**
 * Moves a provider from an earlier release onto the OpenAI-compatible
 * provider, keeping its URL, key and model. Every one of them speaks the
 * OpenAI chat completions protocol at the URLs above.
 */
function migrateLlmProvider(cfg: DesktopConfig, parsed: Record<string, unknown>): void {
  const legacy = cfg.llmProvider;
  const isLegacy = Object.hasOwn(LEGACY_PROVIDER_URLS, legacy);
  const hasLegacyUrl = typeof parsed.llamacppServerUrl === "string";
  if (!isLegacy && !hasLegacyUrl) return;
  const updates: Record<string, unknown> = { llamacppServerUrl: undefined };
  if (isLegacy) {
    const isLlama = legacy === "llamacpp" || legacy === "llamacpp-server";
    const pick = (map: Record<string, string> | undefined) => map?.[legacy]?.trim() || (isLlama ? map?.llamacpp?.trim() || map?.["llamacpp-server"]?.trim() : "") || "";
    const baseUrl =
      pick(cfg.llmBaseUrls) || cfg.llmBaseUrl?.trim() || (isLlama && hasLegacyUrl ? String(parsed.llamacppServerUrl) : "") || LEGACY_PROVIDER_URLS[legacy]!;
    const apiKey = pick(cfg.llmApiKeys) || cfg.llmApiKey?.trim() || "";
    const model = pick(cfg.llmModels) || cfg.llmModel?.trim() || "";
    Object.assign(updates, {
      llmProvider: "openai-compatible",
      llmBaseUrl: baseUrl,
      llmApiKey: apiKey,
      llmModel: model,
      llmBaseUrls: { ...cfg.llmBaseUrls, "openai-compatible": baseUrl },
      llmApiKeys: { ...cfg.llmApiKeys, "openai-compatible": apiKey },
      llmModels: { ...cfg.llmModels, "openai-compatible": model },
    });
  }
  writeRows(updates);
  Object.assign(cfg, updates);
  delete (cfg as unknown as Record<string, unknown>).llamacppServerUrl;
}

function normalize(parsed: Record<string, unknown>): DesktopConfig {
  const cfg = { ...DEFAULT_CONFIG, ...parsed } as DesktopConfig;
  cfg.dataProviderRouting = {
    ...DEFAULT_DATA_PROVIDER_ROUTING,
    ...((parsed.dataProviderRouting as Partial<DataProviderCategoryRouting> | undefined) || {}),
  };
  migrateLlmProvider(cfg, parsed);
  if (typeof cfg.zoomLevel !== "number" || !Number.isFinite(cfg.zoomLevel) || cfg.zoomLevel < 0.25 || cfg.zoomLevel > 5.0) {
    cfg.zoomLevel = 1.0;
  }
  if (!Number.isInteger(cfg.remotePort) || cfg.remotePort < 1024 || cfg.remotePort > 65535) {
    cfg.remotePort = DEFAULT_REMOTE_PORT;
  }
  if (cfg.theme !== "dark" && cfg.theme !== "light" && cfg.theme !== "system") {
    cfg.theme = "dark";
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
  return out;
}

const mask = (value: string | undefined): string => (value ? SECRET_MASK : "");

/** The config as the GUI sees it: every API key replaced by SECRET_MASK. */
export function maskSecrets(cfg: DesktopConfig): DesktopConfig {
  return {
    ...cfg,
    llmApiKey: mask(cfg.llmApiKey),
    finnhubApiKey: mask(cfg.finnhubApiKey),
    llmApiKeys: Object.fromEntries(Object.entries(cfg.llmApiKeys || {}).map(([id, key]) => [id, mask(key)])),
  };
}

/** A key from a request: SECRET_MASK stands for the stored key. */
export function unmaskSecret(value: string | undefined, stored: string | undefined): string | undefined {
  return value === SECRET_MASK ? stored : value;
}

/** The stored key of the OpenAI-compatible provider, for a request that carries SECRET_MASK. */
export function unmaskLlmKey(value: string | undefined): string | undefined {
  const cfg = loadConfig();
  return unmaskSecret(value, cfg.llmApiKeys?.["openai-compatible"] || cfg.llmApiKey);
}

/** An update from the GUI with every SECRET_MASK put back to the stored key. */
export function unmaskUpdates(updates: Partial<DesktopConfig>): Partial<DesktopConfig> {
  const cfg = loadConfig();
  const out = { ...updates };
  if (out.finnhubApiKey === SECRET_MASK) delete out.finnhubApiKey;
  if (out.llmApiKeys) {
    out.llmApiKeys = Object.fromEntries(Object.entries(out.llmApiKeys).map(([id, key]) => [id, unmaskSecret(key, cfg.llmApiKeys?.[id]) ?? ""]));
  }
  if (out.llmApiKey === SECRET_MASK) {
    const provider = out.llmProvider || cfg.llmProvider;
    out.llmApiKey = cfg.llmApiKeys?.[provider] || cfg.llmApiKey;
  }
  return out;
}

/**
 * The desktop launcher of the installed app. The desktop shell runs the
 * service with the runtime binary in the app's `bin/` directory, next to
 * `launcher`. From a checkout there is none.
 */
function desktopLauncher(): string | undefined {
  const launcher = join(dirname(process.execPath), "launcher");
  return existsSync(launcher) ? launcher : undefined;
}

/** Linux autostart entry (~/.config/autostart/portfolio.desktop). */
export function syncAutostart(enabled: boolean): void {
  if (process.platform !== "linux") return;
  try {
    const home = homedir();
    const autostartDir = join(home, ".config", "autostart");
    const desktopFilePath = join(autostartDir, "portfolio.desktop");
    if (enabled) {
      mkdirSync(autostartDir, { recursive: true });
      const execCommand = desktopLauncher() ?? "portfolio";
      writeFileSync(
        desktopFilePath,
        `[Desktop Entry]\nType=Application\nName=Portfolio\nComment=Personal Investment Tracker\nExec=${execCommand}\nIcon=portfolio\nTerminal=false\nCategories=Finance;Office;\nX-GNOME-Autostart-enabled=true\n`,
        "utf-8",
      );
    } else if (existsSync(desktopFilePath)) {
      unlinkSync(desktopFilePath);
    }
  } catch {
    // Best-effort Linux autostart management
  }
}
