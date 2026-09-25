/**
 * Linux desktop integration: the `.desktop` entry and the icons GNOME needs to show the app in
 * the app grid, the dock and the alt-tab switcher with its own icon.
 *
 * Electrobun writes a `<name>.desktop` next to the launcher, but never installs it, and its
 * `Exec=launcher` is relative, so GNOME never sees the packaged app. The shell therefore writes
 * the entry into `~/.local/share/applications/` itself on every start, with the absolute path of
 * the launcher and the icons copied into `~/.local/share/icons/hicolor/`. A development run
 * (`bun start`) gets a separate "(Development)" entry that starts the checkout.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dlopen, FFIType } from "bun:ffi";
import { APP } from "./app";

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

export interface DesktopEntryOptions {
  packaged: boolean;
  /** `Resources/app` of the bundle; holds `icons/` and `app-icon.png`. */
  appDir: string;
  /** The checkout root of a development run. */
  repoRoot: string | undefined;
}

/** The directory of the sized icons: the bundle's `icons/` first, else the checkout's assets. */
function iconsDir(options: DesktopEntryOptions): string | undefined {
  const candidates = [join(options.appDir, "icons"), ...(options.repoRoot ? [join(options.repoRoot, "modules", "desktop", "assets")] : [])];
  return candidates.find((dir) => existsSync(dir));
}

/** Absolute path of the packaged launcher (`<install>/bin/launcher`), or undefined when unknown. */
function launcherPath(options: DesktopEntryOptions): string | undefined {
  const candidates = [
    resolve(options.appDir, "..", "..", "bin", "launcher"),
    join(dirname(process.execPath), "launcher"),
    join(dirname(process.execPath), "..", "bin", "launcher"),
  ];
  return candidates.find((p) => existsSync(p));
}

/** Writes `file` only when its content changed, so the desktop database is not rebuilt for nothing. */
function writeIfChanged(file: string, content: string): boolean {
  try {
    if (existsSync(file) && readFileSync(file, "utf-8") === content) return false;
  } catch {
    // Rewrite.
  }
  writeFileSync(file, content, { encoding: "utf-8" });
  chmodSync(file, 0o644);
  return true;
}

/** Installs the icons and the desktop entry for this build (packaged or development). */
export function installDesktopEntry(options: DesktopEntryOptions): void {
  if (process.platform !== "linux") return;
  try {
    const icons = iconsDir(options);
    // Not `XDG_DATA_HOME`: editors such as Zed point it elsewhere, and GNOME reads ~/.local/share.
    const dataHome = join(homedir(), ".local/share");
    const userAppsDir = join(dataHome, "applications");
    const userIconsDir = join(dataHome, "icons/hicolor");
    mkdirSync(userAppsDir, { recursive: true });

    const iconName = options.packaged ? APP.iconName : `${APP.iconName}-dev`;
    let iconsChanged = false;
    if (icons) {
      for (const size of ICON_SIZES) {
        const src = join(icons, `app-icon-${size}x${size}.png`);
        if (!existsSync(src)) continue;
        const destDir = join(userIconsDir, `${size}x${size}/apps`);
        mkdirSync(destDir, { recursive: true });
        const dest = join(destDir, `${iconName}.png`);
        if (!existsSync(dest) || readFileSync(dest).compare(readFileSync(src)) !== 0) {
          copyFileSync(src, dest);
          iconsChanged = true;
        }
      }
      const svg = join(icons, "app-icon.svg");
      if (existsSync(svg)) {
        const scalableDir = join(userIconsDir, "scalable/apps");
        mkdirSync(scalableDir, { recursive: true });
        copyFileSync(svg, join(scalableDir, `${iconName}.svg`));
      }
    }

    const { desktopEntry } = APP;
    let exec: string;
    let name: string;
    let comment: string;
    if (options.packaged) {
      const launcher = launcherPath(options);
      if (!launcher) {
        console.warn("[desktop] launcher not found; desktop entry not written");
        return;
      }
      exec = `"${launcher}"`;
      name = desktopEntry.name;
      comment = desktopEntry.comment;
    } else {
      if (!options.repoRoot) {
        console.warn("[desktop] checkout root not found; desktop entry not written");
        return;
      }
      exec = `/usr/bin/env bash -c "cd '${options.repoRoot}' && bun start"`;
      name = `${desktopEntry.name} (Development)`;
      comment = `${desktopEntry.comment} (development checkout)`;
    }

    // Two entries per build: the window class differs between desktops (`<Name>` on most,
    // `<Name>-dev` for a development run, sometimes with `-dev` appended once more). The
    // second entry is hidden from the menu and only maps the window to the icon.
    const entry = (wmClass: string, hidden: boolean) => `[Desktop Entry]
Version=1.0
Type=Application
Name=${name}
GenericName=${desktopEntry.genericName}
Comment=${comment}
Exec=${exec}
Icon=${iconName}
Terminal=false
StartupNotify=true
StartupWMClass=${wmClass}
${hidden ? "NoDisplay=true\n" : ""}Categories=${desktopEntry.categories}
`;
    const base = APP.bundleName;
    const classes: [file: string, wmClass: string, hidden: boolean][] = options.packaged
      ? [
          [`${APP.iconName}.desktop`, base, false],
          [`${APP.iconName}-alt.desktop`, base.toLowerCase(), true],
        ]
      : [
          [`${APP.iconName}-dev.desktop`, `${base}-dev-dev`, false],
          [`${APP.iconName}-dev-alt.desktop`, `${base}-dev`, true],
        ];
    let entriesChanged = false;
    for (const [file, wmClass, hidden] of classes) {
      if (writeIfChanged(join(userAppsDir, file), entry(wmClass, hidden))) entriesChanged = true;
    }

    const refresh: [string, string[]][] = [];
    if (iconsChanged) refresh.push(["gtk-update-icon-cache", ["-q", "-f", "-t", userIconsDir]]);
    if (entriesChanged) refresh.push(["update-desktop-database", [userAppsDir]]);
    for (const [cmd, args] of refresh) {
      try {
        execFileSync(cmd, args, { stdio: "ignore" });
      } catch {
        // The tool is not installed; the desktop picks the files up later.
      }
    }
    if (iconsChanged || entriesChanged) console.log(`[desktop] desktop entry installed (${options.packaged ? "packaged" : "development"})`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[desktop] Could not configure Linux desktop integration: ${msg}`);
  }
}

type NativeLib = { symbols: { setWindowIcon: (ptr: unknown, iconPath: Uint8Array) => void } };
let nativeLib: NativeLib | null | undefined;

/** The Electrobun native wrapper library, which exposes `setWindowIcon` for GTK windows. */
function getNativeLib(): NativeLib | null {
  if (nativeLib !== undefined) return nativeLib;
  nativeLib = null;
  const candidates = [join(dirname(process.execPath), "libNativeWrapper.so"), join(dirname(process.execPath), "..", "bin", "libNativeWrapper.so")];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      nativeLib = dlopen(candidate, {
        setWindowIcon: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
      }) as unknown as NativeLib;
      return nativeLib;
    } catch {
      // Try the next candidate.
    }
  }
  return nativeLib;
}

/** Sets the icon of the GTK window behind `windowPtr`. Returns false when that is not possible. */
export function setNativeWindowIcon(windowPtr: unknown, appDir: string): boolean {
  if (process.platform !== "linux" || !windowPtr) return false;
  try {
    const lib = getNativeLib();
    if (!lib?.symbols?.setWindowIcon) return false;
    const iconPath = [join(appDir, "icons", "app-icon-256x256.png"), join(appDir, "app-icon.png"), join(appDir, "..", "appIcon.png")].find((candidate) =>
      existsSync(candidate),
    );
    if (!iconPath) return false;
    lib.symbols.setWindowIcon(windowPtr, Buffer.from(iconPath + "\0"));
    return true;
  } catch {
    return false;
  }
}
