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
  /** Only the desktop window may change it. */
  localOnly?: boolean;
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
    key: "analyticsEnabled",
    section: "security",
    kind: "toggle",
    localOnly: true,
    label: "Usage analytics",
    description: "Send feature events, such as app started, with a random install ID. This shows us which features people use.",
  },
  {
    key: "errorReportingEnabled",
    section: "security",
    kind: "toggle",
    localOnly: true,
    label: "Error reporting",
    description: "Send a crash report when the app fails. A report holds the error type, the code location, the app version and your operating system. It holds no install ID and no error message.",
  },
  {
    key: "checkForUpdates",
    section: "app",
    kind: "toggle",
    label: "Check for updates",
    description: "Look for a new version when Portfolio starts and every hour after that.",
  },
  {
    key: "llmToolMode",
    section: "assistant",
    kind: "choice",
    label: "Guided Analysis tool calling",
    description: "How Guided Analysis asks the model for data. Automatic tests the model once. Native sends real tools; JSON actions work with any model that follows instructions. Off hides the Run button for this setup.",
    options: [
      { value: "auto", label: "Automatic" },
      { value: "native", label: "Native tools" },
      { value: "json", label: "JSON actions" },
      { value: "off", label: "Off" },
    ],
  },
];

/** Every catalog setting with its current value, as this client may use it. */
export function listSettings(isLocal = true): SettingView[] {
  const config = loadConfig() as unknown as Record<string, unknown>;
  return SETTING_DEFINITIONS.map(({ localOnly, ...def }) => {
    const raw = config[def.key];
    const value = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : "";
    // A secret never leaves the service; `isSet` tells the GUI one is stored.
    return { ...def, value: def.kind === "secret" ? "" : value, isSet: value !== "", readOnly: Boolean(localOnly) && !isLocal };
  });
}
