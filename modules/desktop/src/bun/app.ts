/**
 * Everything that makes this shell Portfolio. The other files in `src/bun/` are the same in
 * Portfolio and in FintechCrafts Management; only this file differs between the two apps.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const APP = {
  /** Electrobun `app.name`: the bundle name and the base of the window class. */
  bundleName: "Portfolio",
  identifier: "cgeosoft.portfolio.desktop",
  description: "Personal investment tracker",
  /** `name` of the root `package.json`; marks the checkout root for a development run. */
  rootPackageName: "portfolio",
  /** Folder of the user data directory. Same as `APP_DIR_NAME` in `modules/service/src/paths.ts`. */
  dirName: "portfolio",
  /** Base name of the icons and the `.desktop` files installed on Linux. */
  iconName: "portfolio",
  windowTitle: "Portfolio",
  window: { width: 1400, height: 900 },
  /** Size of the extra window an app link with target=_blank opens. */
  popup: { width: 960, height: 760 },
  desktopEntry: {
    name: "Portfolio",
    genericName: "Personal Investment Tracker",
    comment: "Offline-first personal investment portfolio tracker",
    categories: "Office;Finance;",
  },
  tray: {
    /** Title next to the tray icon in a development run, so it differs from an installed app. */
    devTitle: "Portfolio (dev)",
    show: "Show Portfolio",
    quit: "Quit",
  },
  pages: {
    documentTitle: "Portfolio",
    heading: "Portfolio",
    tagline: "Personal investment tracker",
    startingHint: "Opening the local database. This takes a few seconds.",
    failedHint: "Settings and API keys live in the database there; nothing is read from a .env file.",
    /** Brand mark from modules/gui/src/components/common/AppIcon.tsx: the trending-up line. */
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M22 7 13.5 15.5 8.5 10.5 2 17"/>
  <path d="M16 7h6v6"/>
</svg>`,
    theme: {
      font: `"Plus Jakarta Sans", Inter, system-ui, -apple-system, "Segoe UI", sans-serif`,
      background: "#07090e",
      text: "#e2e8f0",
      glow: "79, 70, 229, 0.22",
      extraGlows: [
        "radial-gradient(circle 340px at 25% 75%, rgba(147, 51, 234, 0.12), transparent 70%)",
        "radial-gradient(circle 300px at 85% 85%, rgba(6, 182, 212, 0.08), transparent 70%)",
      ],
      tileFrame: "linear-gradient(to top right, #DD3C73, #a855f7, #22d3ee)",
      tileFrameWidth: 1,
      tileFill: "#020617",
      tileShadow: "rgba(221, 60, 115, 0.35)",
      heading: "linear-gradient(to right, #fff, #e2e8f0, #f5abc5)",
      accent: "#e65f8e",
      accentSoft: "rgba(230, 95, 142, 0.25)",
      muted: "#94a3b8",
      hint: "#475569",
      surface: "rgba(15, 23, 42, 0.7)",
      surfaceBorder: "rgba(30, 41, 59, 0.8)",
      card: "rgba(15, 23, 42, 0.85)",
      cardBorder: "rgba(30, 41, 59, 0.9)",
      inset: "rgba(2, 6, 23, 0.7)",
    },
  },
} as const;

/**
 * The user data directory, the same in development and in the installed app. It holds
 * `window-state.json`, `desktop-settings.json` (written by the service) and `logs/`. Keep it in
 * step with the data directory rule in `modules/service/src/paths.ts`: Linux
 * `~/.local/share/<app>` (XDG_* ignored on purpose), macOS `~/Library/Application Support/<app>`,
 * Windows `%APPDATA%\<app>`.
 */
export function userDataDir(): string {
  const home = homedir();
  if (process.platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), APP.dirName);
  if (process.platform === "darwin") return join(home, "Library", "Application Support", APP.dirName);
  return join(home, ".local", "share", APP.dirName);
}
