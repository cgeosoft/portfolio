import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json";

const isBuild = process.argv.includes("build") || process.argv.some((a) => a.includes("build"));
const buildEnv = process.env.NODE_ENV || (isBuild ? "production" : "development");
const defaultWebpageUrl =
  process.env.WEBPAGE_URL ||
  (buildEnv === "production" ? "https://portfolio.cgeosoft.com" : "http://localhost:3000");

export default {
  app: {
    name: "Portfolio",
    identifier: "cgeosoft.portfolio.desktop",
    version: packageJson.version,
  },
  build: {
    bun: {
      define: {
        "process.env.POSTHOG_API_KEY": JSON.stringify(process.env.POSTHOG_API_KEY || ""),
        "process.env.NODE_ENV": JSON.stringify(buildEnv),
        "process.env.DEFAULT_WEBPAGE_URL": JSON.stringify(defaultWebpageUrl),
      },
    },
    cottontail: {
      define: {
        "process.env.POSTHOG_API_KEY": JSON.stringify(process.env.POSTHOG_API_KEY || ""),
        "process.env.NODE_ENV": JSON.stringify(buildEnv),
        "process.env.DEFAULT_WEBPAGE_URL": JSON.stringify(defaultWebpageUrl),
      },
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
