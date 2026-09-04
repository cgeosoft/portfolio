import { existsSync, mkdirSync, copyFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { dlopen, FFIType } from "bun:ffi";
import { appLogger } from "../logger.js";

/**
 * Configure Linux desktop integration.
 * Installs icons and desktop entries to ensure GNOME dock and other desktop environments
 * display the application icon correctly during development.
 */
export function setupLinuxDesktop(projectRoot?: string): void {
  if (process.platform !== "linux") {
    return;
  }

  try {
    const root = projectRoot || resolve(dirname(import.meta.dir), "../..");
    const assetsDir = join(root, "src/assets");
    if (!existsSync(assetsDir)) {
      return;
    }

    const home = homedir();
    const userAppsDir = process.env.XDG_DATA_HOME
      ? join(process.env.XDG_DATA_HOME, "applications")
      : join(home, ".local/share/applications");
    const userIconsDir = process.env.XDG_DATA_HOME
      ? join(process.env.XDG_DATA_HOME, "icons/hicolor")
      : join(home, ".local/share/icons/hicolor");
    const userPixmapsDir = process.env.XDG_DATA_HOME
      ? join(process.env.XDG_DATA_HOME, "pixmaps")
      : join(home, ".local/share/pixmaps");

    mkdirSync(userAppsDir, { recursive: true });
    mkdirSync(userPixmapsDir, { recursive: true });

    // Install resolution-specific icons
    const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512];
    for (const size of iconSizes) {
      const src = join(assetsDir, `app-icon-${size}x${size}.png`);
      if (existsSync(src)) {
        const destDir = join(userIconsDir, `${size}x${size}/apps`);
        mkdirSync(destDir, { recursive: true });
        copyFileSync(src, join(destDir, "portfolio-dev.png"));
        copyFileSync(src, join(destDir, "portfolio.png"));
      }
    }

    // Scalable SVG icon
    const svgSrc = join(assetsDir, "app-icon.svg");
    if (existsSync(svgSrc)) {
      const scalableDir = join(userIconsDir, "scalable/apps");
      mkdirSync(scalableDir, { recursive: true });
      copyFileSync(svgSrc, join(scalableDir, "portfolio-dev.svg"));
      copyFileSync(svgSrc, join(scalableDir, "portfolio.svg"));
    }

    // Default pixmaps icon
    const pixmapSrc = join(assetsDir, "app-icon-256x256.png");
    const fallbackSrc = join(assetsDir, "app-icon.png");
    const selectedPixmap = existsSync(pixmapSrc) ? pixmapSrc : existsSync(fallbackSrc) ? fallbackSrc : null;
    if (selectedPixmap) {
      copyFileSync(selectedPixmap, join(userPixmapsDir, "portfolio-dev.png"));
      copyFileSync(selectedPixmap, join(userPixmapsDir, "portfolio.png"));
    }

    // Desktop entry for development (matches runtime WM_CLASS: Portfolio-dev-dev)
    const devDesktop = `[Desktop Entry]
Version=1.0
Type=Application
Name=Portfolio (Development)
GenericName=Portfolio Tracker
Comment=Offline-first personal investment portfolio tracker (Development)
Exec=/usr/bin/env bash -c "cd '${root}' && bun run dev"
Icon=portfolio-dev
Terminal=false
StartupWMClass=Portfolio-dev-dev
Categories=Office;Finance;Development;
`;
    const devDesktopPath = join(userAppsDir, "portfolio-dev.desktop");
    writeFileSync(devDesktopPath, devDesktop, { encoding: "utf-8" });
    chmodSync(devDesktopPath, 0o644);

    // Fallback desktop entry (matches alternative WM_CLASS: Portfolio-dev)
    const devAltDesktop = `[Desktop Entry]
Version=1.0
Type=Application
Name=Portfolio (Development)
GenericName=Portfolio Tracker
Comment=Offline-first personal investment portfolio tracker (Development)
Exec=/usr/bin/env bash -c "cd '${root}' && bun run dev"
Icon=portfolio-dev
Terminal=false
StartupWMClass=Portfolio-dev
NoDisplay=true
Categories=Office;Finance;Development;
`;
    const devAltDesktopPath = join(userAppsDir, "portfolio-dev-alt.desktop");
    writeFileSync(devAltDesktopPath, devAltDesktop, { encoding: "utf-8" });
    chmodSync(devAltDesktopPath, 0o644);

    // Refresh icon cache and desktop database if utilities are available
    try {
      execFileSync("gtk-update-icon-cache", ["-q", "-f", "-t", userIconsDir], { stdio: "ignore" });
    } catch {
      // Ignore if tool is not installed
    }
    try {
      execFileSync("update-desktop-database", [userAppsDir], { stdio: "ignore" });
    } catch {
      // Ignore if tool is not installed
    }

    appLogger.log("info", "Linux desktop development integration configured");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    appLogger.log("warning", `Could not configure Linux desktop integration: ${msg}`);
  }
}

/**
 * Native wrapper FFI binding cache.
 */
let nativeLib: {
  symbols: {
    setWindowIcon: (ptr: any, iconPath: string | Uint8Array) => void;
  };
} | null = null;

function getNativeLib(): typeof nativeLib {
  if (nativeLib !== null) {
    return nativeLib;
  }

  const candidatePaths = [
    join(dirname(process.execPath), "libNativeWrapper.so"),
    join(dirname(process.execPath), "..", "bin", "libNativeWrapper.so"),
    resolve("build/dev-linux-x64/Portfolio-dev/bin/libNativeWrapper.so"),
    "/opt/portfolio/bin/libNativeWrapper.so",
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      try {
        nativeLib = dlopen(candidate, {
          setWindowIcon: {
            args: [FFIType.ptr, FFIType.cstring],
            returns: FFIType.void,
          },
        }) as any;
        return nativeLib;
      } catch (err) {
        // Candidate failed, continue to next
      }
    }
  }

  return null;
}

/**
 * Set the native window icon on the GTK window pointer.
 */
export function setNativeWindowIcon(windowPtr: any, projectRoot?: string): boolean {
  if (process.platform !== "linux" || !windowPtr) {
    return false;
  }

  try {
    const lib = getNativeLib();
    if (!lib?.symbols?.setWindowIcon) {
      return false;
    }

    const root = projectRoot || resolve(dirname(import.meta.dir), "../..");
    const candidateIcons = [
      join(root, "src/assets/app-icon-256x256.png"),
      join(root, "src/assets/app-icon.png"),
      join(dirname(process.execPath), "../Resources/appIcon.png"),
    ];

    let iconPath: string | null = null;
    for (const candidate of candidateIcons) {
      if (existsSync(candidate)) {
        iconPath = candidate;
        break;
      }
    }

    if (!iconPath) {
      return false;
    }

    // Pass null-terminated C string
    const cstr = Buffer.from(iconPath + "\0");
    lib.symbols.setWindowIcon(windowPtr, cstr);
    appLogger.log("info", `Set native window icon: ${iconPath}`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    appLogger.log("warning", `Failed to set native window icon: ${msg}`);
    return false;
  }
}
