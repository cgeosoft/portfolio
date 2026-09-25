/**
 * The settings Settings draws from data: each entry names a DesktopConfig key,
 * the section it shows in, and how to draw it. A new entry here shows up in
 * the GUI without a GUI change. Settings with their own flow (theme, LLM
 * provider and model, data provider routing) stay hand-built.
 */
import type { SettingKind, SettingSection, SettingView } from "portfolio-shared/api-types";
import type { DesktopConfig } from "portfolio-shared/config-types";
import { loadConfig } from "../config";

export interface SettingDefinition {
  key: keyof DesktopConfig & string;
  section: SettingSection;
  kind: SettingKind;
  label: string;
  description: string;
  placeholder?: string;
  options?: { value: string | number; label: string }[];
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "marketQuotesInterval",
    section: "general",
    kind: "choice",
    label: "Market quotes auto-fetch interval",
    description: "Pulls live quotes and FX rates in the background to update portfolio valuations.",
    options: [
      { value: 0, label: "Off" },
      { value: 5, label: "5 min" },
      { value: 15, label: "15 min" },
      { value: 30, label: "30 min" },
      { value: 60, label: "1 h" },
      { value: 240, label: "4 h" },
    ],
  },
  {
    key: "startWithBoot",
    section: "general",
    kind: "toggle",
    label: "Start at system boot",
    description: "Launch Portfolio in the background when your computer starts.",
  },
  {
    key: "telemetryEnabled",
    section: "general",
    kind: "toggle",
    label: "Anonymous analytics",
    description: "Share privacy-preserving usage events. Holdings, balances and transactions are never collected.",
  },
  {
    key: "checkForUpdates",
    section: "general",
    kind: "toggle",
    label: "Check for updates",
    description: "Check GitHub releases on startup and every hour for a new version.",
  },
];

/** Every catalog setting with its current value. */
export function listSettings(): SettingView[] {
  const config = loadConfig() as unknown as Record<string, unknown>;
  return SETTING_DEFINITIONS.map((def) => {
    const raw = config[def.key];
    const value = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : "";
    return { ...def, value, isSet: value !== "" };
  });
}
