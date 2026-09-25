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
 * The proxy is a middleware on `fetch`, not Vite's `server.proxy`: under the cottontail runtime
 * the shell runs this script with, http-proxy stalls on responses larger than about 190 KB
 * (the portfolio data is over 200 KB) and the request times out. The service has no streaming
 * or WebSocket routes, so each response is read whole and then sent.
 *
 * The same file lives in Portfolio and in FintechCrafts Management. The project's own
 * `vite.config.*` supplies the plugins; this script supplies the server settings.
 */
import { resolve } from "node:path";
import { createServer, type Plugin } from "vite";

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

/** Request and response headers that belong to one hop, not to the proxied message. */
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "host", "set-cookie"]);

let servicePort = firstPort;

/** Forwards `/api` to the current service port. */
const apiProxy: Plugin = {
  name: "api-proxy",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url ?? "";
      if (url !== "/api" && !url.startsWith("/api/") && !url.startsWith("/api?")) return next();
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (value === undefined || HOP_HEADERS.has(name)) continue;
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const upstream = await fetch(`${target(servicePort)}${url}`, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
          redirect: "manual",
          keepalive: false,
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        res.statusCode = upstream.status;
        upstream.headers.forEach((value, name) => {
          if (!HOP_HEADERS.has(name)) res.setHeader(name, value);
        });
        const cookies = upstream.headers.getSetCookie();
        if (cookies.length) res.setHeader("set-cookie", cookies);
        res.setHeader("content-length", body.length);
        res.end(body);
      } catch (err) {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ statusCode: 502, message: `Service unreachable: ${err instanceof Error ? err.message : err}` }));
      }
    });
  },
};

const root = resolve(import.meta.dir, "..");
const server = await createServer({
  root,
  plugins: [apiProxy],
  server: {
    host: "127.0.0.1",
    port: freePort(),
    strictPort: false,
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
