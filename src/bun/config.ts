import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export interface DesktopConfig {
  /** Whether the first-launch setup wizard has been completed */
  setupCompleted: boolean;
  /** Whether anonymous PostHog telemetry is enabled */
  telemetryEnabled: boolean;
  /** Random device identifier (no PII) */
  deviceId: string;
  /** Base display currency for portfolio valuations */
  baseCurrency: string;
  /** Privacy mode: mask monetary values in the UI */
  hideCurrencyValues: boolean;
  /** Active LLM provider key (groq, openai, anthropic, etc.) */
  llmProvider: string;
  /** LLM model identifier */
  llmModel: string;
  /** LLM API key */
  llmApiKey: string;
  /** LLM custom base URL */
  llmBaseUrl: string;
  /** LLM sampling temperature */
  llmTemperature: number;
  /** Local llama.cpp server URL */
  llamacppServerUrl: string;
  /** Per-provider API keys */
  llmApiKeys: Record<string, string>;
  /** Per-provider base URLs */
  llmBaseUrls: Record<string, string>;
  /** Last opened directory for CSV import file picker */
  lastImportDirectory?: string;
}

/** Returns the standard configuration directory */
export function getStorageDir(): string {
  const home = homedir() || process.env["HOME"] || "~";
  if (process.platform === "win32") {
    return process.env["APPDATA"]
      ? join(process.env["APPDATA"], "portfolio")
      : join(home, "AppData", "Roaming", "portfolio");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "portfolio");
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  return xdgConfig ? join(xdgConfig, "portfolio") : join(home, ".config", "portfolio");
}

const CONFIG_DIR = getStorageDir();
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: DesktopConfig = {
  setupCompleted: false,
  telemetryEnabled: false,
  deviceId: randomUUID(),
  baseCurrency: "EUR",
  hideCurrencyValues: false,
  llmProvider: "",
  llmModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmTemperature: 0.3,
  llamacppServerUrl: "",
  llmApiKeys: {},
  llmBaseUrls: {},
  lastImportDirectory: "",
};

/** Load configuration from disk, creating defaults if not found */
export function loadConfig(): DesktopConfig {
  mkdirSync(CONFIG_DIR, { recursive: true });

  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save configuration to disk */
export function saveConfig(config: DesktopConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** Merge partial updates into the current config */
export function updateConfig(updates: Partial<DesktopConfig>): DesktopConfig {
  const current = loadConfig();
  const updated = { ...current, ...updates };
  saveConfig(updated);
  return updated;
}
