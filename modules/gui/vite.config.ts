import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// Production: `vite build` writes dist/, which the service serves on "/".
// Development: `scripts/dev-server.ts` starts Vite with this config and adds the server
// settings (random loopback port, `/api` proxied to the service).
export default defineConfig(() => {
  const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"));

  return {
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          // The libraries change less often than the app code, so they get their own files.
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
            if (/[\\/]node_modules[\\/](chart\.js|@kurkle[\\/]color)[\\/]/.test(id)) return "vendor-chart";
            return undefined;
          },
        },
      },
    },
  };
});
