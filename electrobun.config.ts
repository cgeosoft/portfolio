import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json";

export default {
  app: {
    name: "Portfolio",
    identifier: "cgeosoft.portfolio.desktop",
    version: packageJson.version,
  },
  build: {
    views: {
      main: {
        entrypoint: "src/views/main.ts",
      },
    },
    copy: {
      "src/views/index.html": "views/main/index.html",
      "src/views/style.css": "views/main/style.css",
      "src/assets/app-icon.png": "views/assets/app-icon.png",
    },
    mac: {
      bundleCEF: false,
      createDmg: true,
      icons: "src/assets/AppIcon.iconset",
    },
    win: {
      bundleCEF: false,
      icon: "src/assets/app-icon.png",
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
