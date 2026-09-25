/**
 * The switches the desktop shell needs at run time, mirrored from the
 * settings table into `<data dir>/desktop-settings.json`: the shell has no
 * database and no session. The shell reads the file when the window closes
 * (modules/desktop/src/bun/index.ts). Written at start-up and after a change.
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "../config";
import { appLogger } from "../logger";
import { getDesktopSettingsFile } from "../paths";

export interface DesktopSettingsFile {
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean;
}

/** Writes the switches the desktop shell reads. */
export function writeDesktopSettingsFile(): void {
  const content: DesktopSettingsFile = { closeToTray: loadConfig().closeToTray !== false };
  const file = getDesktopSettingsFile();
  try {
    writeFileSync(file, JSON.stringify(content, null, 2) + "\n", "utf8");
  } catch (err) {
    appLogger.logStep("warning", "main", "desktop-settings", `Could not write ${file}: ${err instanceof Error ? err.message : err}`);
  }
}
