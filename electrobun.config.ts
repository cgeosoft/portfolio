import { readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json";

/**
 * The electrobun CLI starts under node, which does not read .env the way bun
 * does, so the config loads the file itself. Values already present in the
 * environment win, keeping CI secrets ahead of anything on disk, and a missing
 * file is fine because CI supplies the vars directly.
 */
function loadDotEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(new URL(".env", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, name, rawValue] = match;
    if (process.env[name] !== undefined) {
      continue;
    }
    process.env[name] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
  }
}

loadDotEnv();

/**
 * The application reads three required env vars: WEBPAGE_URL, WEBPAGE_EMAIL,
 * and POSTHOG_API_KEY. They are provided by .env locally and by GitHub secrets
 * in CI. A missing value fails the build instead of silently substituting a
 * default.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`Missing required environment variable ${name}`);
}

const isBuild = process.argv.includes("build") || process.argv.some((a) => a.includes("build"));
const buildEnv = process.env.NODE_ENV || (isBuild ? "production" : "development");

// Bake the required env vars into the bundles as constants.
const WEBPAGE_URL = requiredEnv("WEBPAGE_URL");
const WEBPAGE_EMAIL = requiredEnv("WEBPAGE_EMAIL");
const POSTHOG_API_KEY = requiredEnv("POSTHOG_API_KEY");

const appEnv = {
  "process.env.WEBPAGE_URL": JSON.stringify(WEBPAGE_URL),
  "process.env.WEBPAGE_EMAIL": JSON.stringify(WEBPAGE_EMAIL),
  "process.env.POSTHOG_API_KEY": JSON.stringify(POSTHOG_API_KEY),
  "process.env.NODE_ENV": JSON.stringify(buildEnv),
};

export default {
  app: {
    name: "Portfolio",
    identifier: "cgeosoft.portfolio.desktop",
    version: packageJson.version,
  },
  build: {
    bun: {
      define: appEnv,
    },
    cottontail: {
      define: appEnv,
    },
    views: {
      main: {
        entrypoint: "src/views/main.ts",
      },
    },
    copy: {
      "src/views/index.html": "views/main/index.html",
      "src/views/style.css": "views/main/style.css",
      "src/assets/app-icon.png": "views/assets/app-icon.png",
      "extras/website/sponsor/index.html": "views/sponsor/index.html",
    },
    mac: {
      bundleCEF: false,
      createDmg: true,
      icons: "src/assets/AppIcon.iconset",
    },
    win: {
      bundleCEF: false,
      icon: "src/assets/app-icon-256x256.png",
    },
    linux: {
      bundleCEF: false,
      icon: "src/assets/app-icon.png",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
