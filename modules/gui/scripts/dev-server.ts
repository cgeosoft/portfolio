/**
 * Vite dev server of a development run (`bun start`). The desktop shell starts it with
 *
 *   <bun> modules/gui/scripts/dev-server.ts <servicePort>
 *
 * once the service reported its port. Vite takes a random free loopback port, proxies `/api` to
 * `http://127.0.0.1:<servicePort>` and prints one line, `GUI_URL=<url>`, which the shell opens in
 * the window. When the service restarts under `bun --watch` on a new port, the shell writes
 * `SERVICE_PORT=<port>` to this process's stdin and the proxy follows it without a reload.
 *
 * The same file lives in Portfolio and in FintechCrafts Management. The project's own
 * `vite.config.*` supplies the plugins; this script supplies the server settings.
 */
import { resolve } from "node:path";
import { createServer, type ProxyOptions } from "vite";

const PORT_LINE = /^SERVICE_PORT=(\d+)$/;

const firstPort = Number(process.argv[2]);
if (!Number.isInteger(firstPort) || firstPort <= 0) {
  console.error("usage: dev-server.ts <servicePort>");
  process.exit(2);
}

const target = (port: number) => `http://127.0.0.1:${port}`;

/** A free loopback port. Vite 5 treats port 0 as "use the default 5173", so ask the OS first. */
function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("no free port");
  return port;
}

// Vite hands the proxy its own copy of these options; `configure` gives us that copy, and
// http-proxy reads `target` from it on every request, so changing it moves the proxy.
let liveProxyOptions: ProxyOptions | null = null;
let servicePort = firstPort;

const root = resolve(import.meta.dir, "..");
const server = await createServer({
  root,
  server: {
    host: "127.0.0.1",
    port: freePort(),
    strictPort: false,
    proxy: {
      "/api": {
        target: target(servicePort),
        changeOrigin: true,
        configure: (_proxy, options) => {
          liveProxyOptions = options;
          options.target = target(servicePort);
        },
      },
    },
  },
});
await server.listen();

const address = server.httpServer?.address();
if (!address || typeof address === "string") {
  console.error("[dev-server] Vite did not report its address");
  process.exit(1);
}
console.log(`GUI_URL=http://127.0.0.1:${address.port}`);

async function readServicePorts(): Promise<void> {
  const decoder = new TextDecoder();
  let partial = "";
  for await (const chunk of Bun.stdin.stream()) {
    const lines = (partial + decoder.decode(chunk, { stream: true })).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      const match = PORT_LINE.exec(line.trim());
      if (!match) continue;
      servicePort = Number(match[1]);
      if (liveProxyOptions) liveProxyOptions.target = target(servicePort);
      console.log(`[dev-server] /api now proxied to ${target(servicePort)}`);
    }
  }
  // The shell closed our stdin: it is gone, so stop.
  await server.close();
  process.exit(0);
}

void readServicePorts();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
