/**
 * User settings of the application. Stored by the service in the `config`
 * table of the SQLite database (see modules/service/src/config.ts) and edited
 * through Settings in the GUI.
 */

export type DataProviderId = "yahoo" | "finnhub";

export interface DataProviderCategoryRouting {
  quotes: DataProviderId;
  news: DataProviderId;
  charts: DataProviderId;
  fx: DataProviderId;
  fundamentals: DataProviderId;
  search: DataProviderId;
}

export const DEFAULT_DATA_PROVIDER_ROUTING: DataProviderCategoryRouting = {
  quotes: "yahoo",
  news: "finnhub",
  charts: "yahoo",
  fx: "yahoo",
  fundamentals: "finnhub",
  search: "yahoo",
};

/** Window geometry persisted by the desktop shell (not part of DesktopConfig). */
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
  /** Per-provider selected models */
  llmModels?: Record<string, string>;
  /** Optional Finnhub API key for market intelligence in AI reports */
  finnhubApiKey?: string;
  /** Provider assignments for each data category */
  dataProviderRouting: DataProviderCategoryRouting;
  /** ISO timestamp of the last market quotes synchronization */
  lastQuotesSync?: string;
  /** Interval in minutes for automatically refreshing market quotes (0 = manual only) */
  marketQuotesInterval: number;
  /** Whether to start Portfolio on system boot */
  startWithBoot: boolean;
  /** Whether to skip the introduction step in the report wizard */
  skipReportIntro?: boolean;
  /** Whether to automatically check for new application versions on startup and periodically */
  checkForUpdates: boolean;
  /** ISO timestamp of the last check for updates */
  lastUpdateCheck?: string;
  /** Version string dismissed by user to avoid repetitive alerts */
  dismissedUpdateVersion?: string;
  /** UI zoom scaling factor (1.0 = 100%) */
  zoomLevel?: number;
  /** UI theme mode: "dark" | "light" | "system" */
  theme?: AppTheme;
}

export type AppTheme = "dark" | "light" | "system";
