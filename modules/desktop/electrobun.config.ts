import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json";

/**
 * Lists every file below `stage/<dir>` as a `build.copy` entry so the staged
 * service bundle and GUI land in `Resources/app/<dir>/`. `bun run stage` must
 * run before this config is loaded (it is part of `dev` and `build`).
 * `bun start` (scripts/dev.ts) skips the stage: the shell then runs the
 * service from source, so a missing `stage/` is not an error.
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

export default {
  app: {
    name: "Portfolio",
    identifier: "cgeosoft.portfolio.desktop",
    version: packageJson.version,
    description: "Personal investment tracker",
  },
  build: {
    cottontail: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      ...copyTree("service"),
      ...copyTree("gui"),
      ...copyFile("stage/service/sponsor.html", "sponsor.html"),
      ...copyFile("stage/service/sponsor-light.html", "sponsor-light.html"),
      "assets/app-icon.png": "app-icon.png",
    },
    watch: ["stage"],
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
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
