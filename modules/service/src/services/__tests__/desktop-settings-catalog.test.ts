/**
 * desktop-settings.json for the shell and the settings catalog the assistant
 * and MCP tools read. Each case runs on its own empty database.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDesktopSettingsFile } from "../desktop-settings";
import { SETTING_DEFINITIONS, listSettings } from "../settings-catalog";
import { CONFIG_KEYS, saveConfig, updateConfig, type DesktopConfig } from "../../config";
import { appLogger } from "../../logger";
import { DATA_DIR, getDesktopSettingsFile, setDataDirForTests } from "../../paths";
import { closeDatabase } from "../../db/database";

/** Points the service at an empty data dir; `restore()` goes back to the shared one. */
function useFreshDataDir(prefix = "portfolio-iso-"): { dir: string; restore: () => void } {
  const previous = DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  setDataDirForTests(dir);
  closeDatabase();
  saveConfig({} as DesktopConfig);
  return {
    dir,
    restore: () => {
      closeDatabase();
      setDataDirForTests(previous);
      saveConfig({} as DesktopConfig);
    },
  };
}

let env: ReturnType<typeof useFreshDataDir>;
beforeEach(() => {
  env = useFreshDataDir();
});
afterEach(() => env.restore());

describe("writeDesktopSettingsFile", () => {
  it("writes closeToTray true on a fresh database", () => {
    writeDesktopSettingsFile();
    expect(readFileSync(getDesktopSettingsFile(), "utf8")).toBe('{\n  "closeToTray": true\n}\n');
  });

  it("follows the closeToTray setting", () => {
    updateConfig({ closeToTray: false });
    writeDesktopSettingsFile();
    expect(readFileSync(getDesktopSettingsFile(), "utf8")).toBe('{\n  "closeToTray": false\n}\n');
  });

  it("logs a warning instead of throwing when the write fails", () => {
    mkdirSync(getDesktopSettingsFile());
    const spy = spyOn(appLogger, "logStep").mockImplementation(() => {});
    try {
      expect(() => writeDesktopSettingsFile()).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0] as unknown[];
      expect(args.slice(0, 3)).toEqual(["warning", "main", "desktop-settings"]);
      expect(args[3]).toMatch(/^Could not write .*desktop-settings\.json: /);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("settings catalog", () => {
  it("defines five known settings", () => {
    expect(SETTING_DEFINITIONS.map((d) => d.key)).toEqual(["marketQuotesInterval", "startWithBoot", "closeToTray", "telemetryEnabled", "checkForUpdates"]);
    for (const d of SETTING_DEFINITIONS) {
      expect(CONFIG_KEYS.has(d.key)).toBe(true);
      if (d.kind === "choice") expect(d.options?.length ?? 0).toBeGreaterThan(0);
    }
    const interval = SETTING_DEFINITIONS.find((d) => d.key === "marketQuotesInterval")!;
    expect(interval.options!.map((o) => o.value)).toEqual([0, 5, 15, 30, 60, 240]);
  });

  it("lists defaults on a fresh database", () => {
    const views = listSettings();
    expect(views.map((v) => [v.key, v.value, v.isSet])).toEqual([
      ["marketQuotesInterval", 15, true],
      ["startWithBoot", false, true],
      ["closeToTray", true, true],
      ["telemetryEnabled", false, true],
      ["checkForUpdates", true, true],
    ]);
    expect(views.map((v) => v.section)).toEqual(["market", "app", "app", "security", "app"]);
    views.forEach((v, i) => {
      expect(v.label).toBe(SETTING_DEFINITIONS[i].label);
      expect(v.description).toBe(SETTING_DEFINITIONS[i].description);
    });
  });

  it("reflects updated values", () => {
    updateConfig({ marketQuotesInterval: 60, telemetryEnabled: true });
    const byKey = Object.fromEntries(listSettings().map((v) => [v.key, v.value]));
    expect(byKey.marketQuotesInterval).toBe(60);
    expect(byKey.telemetryEnabled).toBe(true);
  });
});
