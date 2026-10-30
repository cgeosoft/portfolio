/** Settings navigation: sections, notification pages and hash aliases. */
import { describe, expect, it } from "bun:test";
import {
  AUTOMATIONS,
  DEFAULT_SETTINGS_SECTION,
  NOTIFICATION_PAGES,
  SECTIONS,
  isNotificationPage,
  resolveSettingsSection,
  sectionOf,
} from "./settings-nav";
import { SETUP_STEP_AFTER_TERMS } from "../common/setup-steps";

describe("settings navigation", () => {
  it("lists the sections in order with nav labels", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["appearance", "security", "metrics", "assistant", "notifications", "market-data", "data", "about"] as any);
    for (const s of SECTIONS) expect(s.labelKey.startsWith("settings.nav.")).toBe(true);
  });

  it("lists the notification pages and automations", () => {
    expect(NOTIFICATION_PAGES.map((p) => p.id)).toEqual(["phone", "daily-brief", "weekly-analysis", "event-alerts"] as any);
    expect(AUTOMATIONS.map((p) => p.id)).toEqual(["daily-brief", "weekly-analysis", "event-alerts"] as any);
  });

  it("opens appearance by default", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe("appearance");
  });

  it("resolves ids and aliases", () => {
    const cases: [string | undefined, string | null][] = [
      ["General", "appearance"],
      ["integrations", "assistant"],
      ["providers", "market-data"],
      ["data-providers", "market-data"],
      ["gotify", "phone"],
      ["ntfy", "phone"],
      ["automation", "daily-brief"],
      ["PHONE", "phone"],
      ["weekly-analysis", "weekly-analysis"],
      ["market-data", "market-data"],
      ["notifications", null],
      ["", null],
      [undefined, null],
      ["nope", null],
    ];
    for (const [input, expected] of cases) expect([input, resolveSettingsSection(input as any)]).toEqual([input, expected]);
  });

  it("does not resolve prototype keys", () => {
    expect(resolveSettingsSection("constructor")).toBeNull();
    expect(resolveSettingsSection("__proto__")).toBeNull();
    expect(resolveSettingsSection("hasOwnProperty")).toBeNull();
  });

  it("maps a page to its section", () => {
    expect(sectionOf("phone" as any)).toBe("notifications");
    expect(sectionOf("daily-brief" as any)).toBe("notifications");
    expect(sectionOf("about" as any)).toBe("about");
  });

  it("knows notification pages", () => {
    expect(isNotificationPage("notifications" as any)).toBe(false);
    expect(isNotificationPage("event-alerts" as any)).toBe(true);
  });

  it("starts setup after the terms step", () => {
    expect(SETUP_STEP_AFTER_TERMS).toBe(3);
  });
});
