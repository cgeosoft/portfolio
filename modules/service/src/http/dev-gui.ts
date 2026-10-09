/**
 * The GUI of a development run (`bun start`) for other devices. The desktop
 * window loads the Vite dev server directly, but Vite listens on loopback
 * only, so a phone on the LAN listener reaches just the service. Once the
 * shell writes `GUI_URL=<vite url>` to the service's stdin (again after every
 * `bun --watch` restart), each non-API request and the Vite HMR WebSocket are
 * forwarded to Vite. `/api` stays with the service and its PIN check.
 *
 * Only from a checkout: an installed app serves the built GUI (static.ts).
 */
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { appLogger } from "../logger";
import { REPO_ROOT } from "../paths";

const URL_LINE = /^GUI_URL=(http:\/\/\S+)$/;

/** Headers that belong to one hop, not to the forwarded message. */
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "host", "upgrade"]);

/** What an upgraded socket carries: where to connect upstream and the buffered first messages. */
export interface SocketData {
  target: string;
  protocol: string | null;
  upstream?: WebSocket;
  pending: (string | Buffer)[];
}

/** A listener of the service, typed for the HMR sockets it may hold. */
export type DevGuiServer = Server<SocketData>;

let viteUrl: string | null = null;

/** Reads `GUI_URL=` lines from stdin, from a checkout only. */
export function startDevGuiLink(): void {
  if (!REPO_ROOT) return;
  void (async () => {
    const decoder = new TextDecoder();
    let partial = "";
    try {
      for await (const chunk of Bun.stdin.stream()) {
        const lines = (partial + decoder.decode(chunk, { stream: true })).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const match = URL_LINE.exec(line.trim());
          if (!match || match[1] === viteUrl) continue;
          viteUrl = match[1].replace(/\/+$/, "");
          appLogger.logStep("info", "http", "dev-gui", `GUI forwarded to the Vite dev server at ${viteUrl}`);
        }
      }
    } catch {
      // No stdin (started outside the shell): nothing to forward to.
    }
  })();
}

function forwardHeaders(source: Headers, host: string): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    if (!HOP_HEADERS.has(name)) headers.set(name, value);
  });
  headers.set("host", host);
  return headers;
}

/**
 * Forwards a non-API request to Vite. Null when no dev server is known, so
 * the caller falls back to the built GUI. A WebSocket upgrade is answered by
 * `srv.upgrade` and returns `undefined`, as Bun expects.
 */
export async function serveDevGui(req: Request, url: URL, srv: DevGuiServer): Promise<Response | undefined | null> {
  if (!viteUrl) return null;
  const target = new URL(url.pathname + url.search, viteUrl);

  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    target.protocol = "ws:";
    const protocol = req.headers.get("sec-websocket-protocol")?.split(",")[0]?.trim() || null;
    const data: SocketData = { target: target.href, protocol, pending: [] };
    const upgraded = srv.upgrade(req, { data, headers: protocol ? { "Sec-WebSocket-Protocol": protocol } : undefined });
    return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders(req.headers, target.host),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
    const headers = new Headers();
    upstream.headers.forEach((value, name) => {
      if (!HOP_HEADERS.has(name)) headers.set(name, value);
    });
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch (err) {
    return new Response(`Vite dev server unreachable: ${err instanceof Error ? err.message : err}`, { status: 502 });
  }
}

/** Pipes the browser's HMR socket to Vite's, both ways. */
export const devGuiWebSocket: WebSocketHandler<SocketData> = {
  open(ws: ServerWebSocket<SocketData>) {
    const { target, protocol } = ws.data;
    const upstream = protocol ? new WebSocket(target, protocol) : new WebSocket(target);
    upstream.binaryType = "arraybuffer";
    ws.data.upstream = upstream;
    upstream.onopen = () => {
      for (const message of ws.data.pending) upstream.send(message);
      ws.data.pending = [];
    };
    upstream.onmessage = (event) => {
      ws.send(typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer));
    };
    upstream.onclose = () => ws.close();
    upstream.onerror = () => ws.close();
  },
  message(ws, message) {
    const upstream = ws.data.upstream;
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
    else ws.data.pending.push(message);
  },
  close(ws) {
    ws.data.upstream?.close();
  },
};
