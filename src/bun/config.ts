import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export interface WindowStateConfig {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
}

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
  /** ISO timestamp of the last market quotes synchronization with Yahoo Finance */
  lastQuotesSync?: string;
  /** Base webpage URL for terms and external site */
  webpageUrl?: string;
  /** Interval in minutes for automatically refreshing market quotes (0 = manual only) */
  marketQuotesInterval: number;
  /** Whether to start Portfolio Desktop on system boot */
  startWithBoot: boolean;
  /** Whether to skip the introduction step in the report wizard */
  skipReportIntro?: boolean;
  /** Whether to automatically check for new application versions on startup and periodically */
  checkForUpdates: boolean;
  /** ISO timestamp of the last check for updates */
  lastUpdateCheck?: string;
  /** Version string dismissed by user to avoid repetitive alerts */
  dismissedUpdateVersion?: string;
  /** Stored window position, dimensions, and state */
  windowState?: WindowStateConfig;
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
  llamacppServerUrl: "http://127.0.0.1:9100",
  llmApiKeys: {},
  llmBaseUrls: {},
  lastImportDirectory: "",
  lastQuotesSync: undefined,
  webpageUrl: process.env["WEBPAGE_URL"] || "http://localhost:3000",
  marketQuotesInterval: 15,
  startWithBoot: false,
  skipReportIntro: false,
  checkForUpdates: true,
  lastUpdateCheck: undefined,
  dismissedUpdateVersion: undefined,
  windowState: undefined,
};

/** Synchronize Linux autostart desktop entry */
export function syncAutostart(enabled: boolean): void {
  if (process.platform !== "linux") return;
  try {
    const home = homedir() || process.env["HOME"] || "~";
    const autostartDir = join(home, ".config", "autostart");
    const desktopFilePath = join(autostartDir, "portfolio.desktop");
    if (enabled) {
      mkdirSync(autostartDir, { recursive: true });
      const execCommand = process.env["APPIMAGE"] || process.execPath || "portfolio";
      const content = `[Desktop Entry]
Type=Application
Name=Portfolio Desktop
Comment=Personal Investment Portfolio Tracker
Exec=${execCommand}
Icon=portfolio
Terminal=false
Categories=Finance;Office;
X-GNOME-Autostart-enabled=true
`;
      writeFileSync(desktopFilePath, content, "utf-8");
    } else {
      if (existsSync(desktopFilePath)) {
        unlinkSync(desktopFilePath);
      }
    }
  } catch {
    // Best-effort Linux autostart management
  }
}

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
    const cfg = { ...DEFAULT_CONFIG, ...parsed };
    if (!cfg.llamacppServerUrl && cfg.llmBaseUrl && (!cfg.llmProvider || cfg.llmProvider === "llamacpp-server" || cfg.llmProvider === "llamacpp")) {
      cfg.llamacppServerUrl = cfg.llmBaseUrl;
    }
    if (process.env["WEBPAGE_URL"]) {
      cfg.webpageUrl = process.env["WEBPAGE_URL"];
    }
    return cfg;
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
  if (
    updates.llmBaseUrl !== undefined &&
    (!updated.llamacppServerUrl || updated.llmProvider === "llamacpp-server" || updated.llmProvider === "llamacpp")
  ) {
    updated.llamacppServerUrl = updates.llmBaseUrl;
  }
  if (updates.llamacppServerUrl !== undefined && !updated.llmBaseUrl) {
    updated.llmBaseUrl = updates.llamacppServerUrl;
  }
  saveConfig(updated);
  if (typeof updates.startWithBoot === "boolean") {
    syncAutostart(updates.startWithBoot);
  }
  return updated;
}

