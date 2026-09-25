import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json";
import { APP } from "./src/bun/app";

/**
 * Lists every file below `stage/<dir>` as a `build.copy` entry so the staged service bundle and
 * the GUI land in `Resources/app/<dir>/`. `bun run stage` runs before `electrobun build` (the
 * `build` script). `bun start` runs `electrobun dev` without a stage: the shell then runs the
 * service and Vite from the checkout, so a missing `stage/` is not an error.
 */
function copyTree(dir: string, into: Record<string, string> = {}): Record<string, string> {
  const root = resolve(import.meta.dir, "stage", dir);
  const walk = (abs: string, rel: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(abs, entry.name), childRel);
      else if (entry.isFile()) into[`stage/${dir}/${childRel}`] = `${dir}/${childRel}`;
    }
  };
  walk(root, "");
  return into;
}

/** One staged file, when it exists. */
function copyFile(from: string, to: string): Record<string, string> {
  return existsSync(resolve(import.meta.dir, from)) ? { [from]: to } : {};
}

/** The sized icons the shell installs into the user's icon theme (Linux app grid, dock) and uses for the tray. */
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const iconCopies = Object.fromEntries([
  ...ICON_SIZES.map((size) => [`assets/app-icon-${size}x${size}.png`, `icons/app-icon-${size}x${size}.png`]),
  ["assets/app-icon.svg", "icons/app-icon.svg"],
  ["assets/app-icon.png", "app-icon.png"],
]);

// ---- per app -----------------------------------------------------------------------------

/** Staged files outside `stage/service` and `stage/gui`. */
const extraCopies: Record<string, string> = {};

/** Linux, Windows and macOS. */
const platforms = {
  mac: {
    bundleCEF: false,
    createDmg: true,
    icons: "assets/AppIcon.iconset",
  },
  win: {
    bundleCEF: false,
    icon: "assets/app-icon-256x256.png",
  },
  linux: {
    bundleCEF: false,
    icon: "assets/app-icon.png",
  },
};

// ---- shared ------------------------------------------------------------------------------

export default {
  app: {
    name: APP.bundleName,
    identifier: APP.identifier,
    version: packageJson.version,
    description: APP.description,
  },
  build: {
    cottontail: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      ...copyTree("service"),
      ...copyTree("gui"),
      ...extraCopies,
      ...iconCopies,
    },
    watch: ["stage"],
    ...platforms,
  },
  runtime: {
    // The window hides into the tray on close (Settings > Close to tray); the tray menu and
    // File > Quit exit.
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
