import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// Dev: Vite serves the GUI on VITE_PORT and proxies /api to the service.
// Production: `vite build` writes dist/, which the service serves on "/".
export default defineConfig(() => {
  const servicePort = process.env.PORTFOLIO_PORT || "5130";
  const vitePort = parseInt(process.env.VITE_PORT || "5131", 10);
  const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"));

  return {
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    plugins: [react()],
    server: {
      host: true,
      port: vitePort,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${servicePort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
