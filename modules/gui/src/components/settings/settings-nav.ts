/**
 * The pages of Settings and the names `#settings/<page>` links use. App
 * imports this eagerly, so it stays free of component code (Settings itself
 * loads lazily).
 */
import { Bell, Bot, CalendarClock, CalendarRange, Database, Gauge, HardDrive, Info, Newspaper, Palette, ShieldCheck, Smartphone } from "lucide-react";
import type { SidebarSection } from "./SettingsPrimitives";

/** The top-level sections of the Settings sidebar, in the order they show. */
export type SettingsSectionId = "appearance" | "security" | "metrics" | "assistant" | "notifications" | "market-data" | "data" | "about";

export type AutomationId = "daily-brief" | "weekly-analysis" | "event-alerts";

/** The scheduled assistant tasks, listed under Notifications. Labels are i18n keys, translated where the sidebar renders. */
export const AUTOMATIONS: (SidebarSection & { id: AutomationId })[] = [
  { id: "daily-brief", labelKey: "settings.nav.dailyBrief", icon: Newspaper },
  { id: "weekly-analysis", labelKey: "settings.nav.weeklyReport", icon: CalendarRange },
  { id: "event-alerts", labelKey: "settings.nav.eventAlerts", icon: CalendarClock },
];

/** The pages of the Notifications submenu: the phone apps first, since every automation sends through them. */
export type NotificationPageId = "phone" | AutomationId;

/** A Settings page: a section, or a Notifications page opened directly. */
export type SettingsSection = Exclude<SettingsSectionId, "notifications"> | NotificationPageId;

/** The page Settings opens on, and the one `#settings` names. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "appearance";

export const SECTIONS: (SidebarSection & { id: SettingsSectionId })[] = [
  { id: "appearance", labelKey: "settings.nav.appearance", icon: Palette },
  { id: "security", labelKey: "settings.nav.security", icon: ShieldCheck },
  { id: "metrics", labelKey: "settings.nav.metrics", icon: Gauge },
  { id: "assistant", labelKey: "settings.nav.assistant", icon: Bot },
  { id: "notifications", labelKey: "settings.nav.notifications", icon: Bell },
  { id: "market-data", labelKey: "settings.nav.marketData", icon: Database },
  { id: "data", labelKey: "settings.nav.data", icon: HardDrive },
  { id: "about", labelKey: "settings.nav.about", icon: Info },
];

export const NOTIFICATION_PAGES: (SidebarSection & { id: NotificationPageId })[] = [{ id: "phone", labelKey: "settings.nav.phone", icon: Smartphone }, ...AUTOMATIONS];

/** Pages of earlier releases, so old links and bookmarks still open the right place. */
const ALIASES: Record<string, SettingsSection> = {
  general: "appearance",
  integrations: "assistant",
  providers: "market-data",
  "data-providers": "market-data",
  gotify: "phone",
  ntfy: "phone",
  automation: "daily-brief",
};

export const isNotificationPage = (section: string): section is NotificationPageId => NOTIFICATION_PAGES.some((page) => page.id === section);

/** The top-level section a page belongs to. */
export const sectionOf = (section: SettingsSection): SettingsSectionId => (isNotificationPage(section) ? "notifications" : section);

/** The page a `#settings/<name>` link names, or null for an unknown name. */
export function resolveSettingsSection(raw: string | undefined): SettingsSection | null {
  if (!raw) return null;
  const name = raw.toLowerCase();
  const alias = ALIASES[name];
  if (alias) return alias;
  if (isNotificationPage(name)) return name;
  if (name !== "notifications" && SECTIONS.some((section) => section.id === name)) return name as SettingsSection;
  return null;
}
