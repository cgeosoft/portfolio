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
    section: "market",
    kind: "choice",
    label: "Update prices every",
    description: "How often Portfolio fetches new prices and exchange rates in the background, so the values stay current.",
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
    key: "hideSponsorBanners",
    section: "appearance",
    kind: "toggle",
    label: "Hide sponsor banners",
    description: "Remove the sponsor banner from the overview page.",
  },
  {
    key: "startWithBoot",
    section: "app",
    kind: "toggle",
    label: "Start with the computer",
    description: "Open Portfolio in the background when your computer starts.",
  },
  {
    key: "closeToTray",
    section: "app",
    kind: "toggle",
    label: "Keep running when the window closes",
    description: "Closing the window leaves Portfolio running as an icon in the system tray, next to the clock, so scheduled briefs and alerts still go out. Quit from that icon.",
  },
  {
    key: "telemetryEnabled",
    section: "security",
    kind: "toggle",
    label: "Share anonymous usage statistics",
    description: "Tell the developers which features are used, to help improve Portfolio. Holdings, balances and transactions are never sent.",
  },
  {
    key: "checkForUpdates",
    section: "app",
    kind: "toggle",
    label: "Check for updates",
    description: "Look for a new version when Portfolio starts and every hour after that.",
  },
];

/** Every catalog setting with its current value. */
export function listSettings(): SettingView[] {
  const config = loadConfig() as unknown as Record<string, unknown>;
  return SETTING_DEFINITIONS.map((def) => {
    const raw = config[def.key];
    const value = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : "";
    // A secret never leaves the service; `isSet` tells the GUI one is stored.
    return { ...def, value: def.kind === "secret" ? "" : value, isSet: value !== "" };
  });
}
