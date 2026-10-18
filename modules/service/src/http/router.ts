/**
 * Small HTTP router on top of Bun.serve. Routes are `METHOD /path/:param`
 * patterns; handlers receive a request context and return JSON (plain
 * objects), a `Response`, or throw an `HttpError`. Every request gets an id
 * for log correlation (X-Request-Id).
 *
 * Two transport checks run before any route: a request that changes state
 * (POST, PUT, PATCH, DELETE) must come from the app's own origin, and API
 * responses are never cached by the browser. Large JSON bodies are gzipped
 * for remote clients that accept it (a phone on the LAN loads the portfolio
 * data several times faster); the desktop window on loopback gets them as
 * they are, since compressing costs more than the transfer saves.
 */
import { randomUUID } from "node:crypto";
import { appLogger } from "../logger";
import { isDev } from "../environment";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestContext {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Client socket address, `127.0.0.1` for the desktop window. */
  ip: string;
  /** True when the client is on this machine (loopback). */
  isLocal: boolean;
  /** Session id of a logged-in client, set by the auth middleware. */
  sessionId: string | null;
  requestId: string;
  /** Parsed JSON body; `{}` when the request has none. A body over `maxBytes` (default `MAX_BODY_BYTES`) is refused with 413. */
  body<T = Record<string, unknown>>(maxBytes?: number): Promise<T>;
  /** Set-Cookie and other headers merged into the JSON response. */
  responseHeaders: Headers;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;
export type Middleware = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  /** The pattern as registered, such as `/api/symbols/:symbol/intel`. Logs carry it instead of the real path, which can name a ticker or an ISIN. */
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** Largest request body a route reads; `Bun.serve` refuses a longer one before it is buffered (main.ts). */
export const MAX_BODY_BYTES = 30 * 1024 * 1024;
/** JSON bodies at least this long are gzipped when the client accepts it. */
const COMPRESS_MIN_BYTES = 4 * 1024;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Longest error message a response or a log line carries. */
const MAX_ERROR_MESSAGE = 1000;

/** The message of an error, cut to `MAX_ERROR_MESSAGE`: it can carry text a client, a module or a remote server chose. */
export function boundedErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MAX_ERROR_MESSAGE ? `${raw.slice(0, MAX_ERROR_MESSAGE - 1)}…` : raw;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const ip = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return ip === "::1" || ip.startsWith("127.");
}

/** Host part of a `Host` or `Origin` value without the port: `127.0.0.1:5130` -> `127.0.0.1`, `[::1]:80` -> `::1`. */
export function hostnameOf(hostHeader: string | null | undefined): string {
  const value = (hostHeader || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : "";
  }
  const colon = value.lastIndexOf(":");
  return colon > 0 ? value.slice(0, colon) : value;
}

/** True for `localhost`, `127.x.x.x` and `::1`: the names the desktop window and the dev server use. */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || isLoopbackAddress(hostname);
}

/**
 * True when a request that changes state may proceed. Browsers send `Origin`
 * on every cross-site request and on same-site POSTs, so a request that
 * carries one must name this app: the host and port of the request itself.
 * The port counts because cookies ignore it: a page served by another program
 * on this machine (`http://127.0.0.1:3000`) is same-site with the app and its
 * requests carry the session cookie. A development run also accepts the other
 * loopback origins, for the Vite dev server that proxies `/api` from its own
 * port. A request without `Origin` comes from the app's own scripts or a
 * non-browser client. This closes cross-site request forgery from a web page
 * against the loopback and LAN listeners.
 */
export function isAllowedOrigin(req: Request, allowLoopbackOrigins: boolean = isDev()): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (!parsed.host) return false;
  if (parsed.host === (req.headers.get("host") || "").trim().toLowerCase()) return true;
  return allowLoopbackOrigins && isLoopbackHostname(parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

/** JSON response. API answers carry no-store so a shared browser never keeps balances. */
export function json(data: unknown, status = 200, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data ?? null), { status, headers: h });
}

/**
 * The request body as text, at most `limit` bytes. A declared length over the
 * limit is refused before anything is read; a chunked body without one is
 * counted while it arrives and refused once it passes the limit, so it is
 * never buffered whole first.
 */
async function readBodyText(req: Request, limit: number): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (Number(declared) > limit) throw new HttpError(413, "Request body is too large");
    return req.text();
  }
  if (!req.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function acceptsGzip(req: Request): boolean {
  const accept = req.headers.get("accept-encoding") || "";
  return /(^|,)\s*gzip\s*(;|,|$)/i.test(accept);
}

/**
 * Like `json()`, gzipped when the body is large and the client accepts it.
 * `compress` is false for a loopback client: the copy costs nothing there
 * and gzip would block the event loop for nothing.
 */
export function jsonFor(req: Request, data: unknown, status = 200, headers?: Headers, compress = true): Response {
  const body = JSON.stringify(data ?? null);
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  if (!compress || body.length < COMPRESS_MIN_BYTES || req.method === "HEAD" || !acceptsGzip(req)) {
    return new Response(body, { status, headers: h });
  }
  h.set("Content-Encoding", "gzip");
  h.set("Vary", "Accept-Encoding");
  return new Response(Bun.gzipSync(Buffer.from(body, "utf-8")), { status, headers: h });
}

export class Router {
  private readonly routes: Route[] = [];
  private readonly middlewares: Middleware[] = [];

  /** Runs before every matched route (auth, remote-access gate). */
  use(mw: Middleware): void {
    this.middlewares.push(mw);
  }

  add(method: string, path: string, handler: Handler): void {
    const { pattern, keys } = compile(path);
    this.routes.push({ method: method.toUpperCase(), path, pattern, keys, handler });
  }

  get(path: string, handler: Handler): void {
    this.add("GET", path, handler);
  }
  post(path: string, handler: Handler): void {
    this.add("POST", path, handler);
  }
  put(path: string, handler: Handler): void {
    this.add("PUT", path, handler);
  }
  patch(path: string, handler: Handler): void {
    this.add("PATCH", path, handler);
  }
  delete(path: string, handler: Handler): void {
    this.add("DELETE", path, handler);
  }

  /**
   * Returns null when no route matches (the caller serves static files).
   * `isLocal` defaults to a loopback client address; main.ts passes false
   * for every request on the LAN listener.
   */
  async handle(req: Request, ip: string, isLocal: boolean = isLoopbackAddress(ip)): Promise<Response | null> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    let matched: Route | null = null;
    let params: Record<string, string> = {};
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      matched = route;
      try {
        params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")]));
      } catch {
        return json({ statusCode: 400, message: "Malformed path parameter" }, 400);
      }
      break;
    }
    if (!matched) {
      if (pathMatched) return json({ statusCode: 405, message: `Method ${method} not allowed` }, 405);
      return null;
    }

    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && incoming.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(incoming) ? incoming : randomUUID().slice(0, 8);
    let parsedBody: unknown = undefined;
    const ctx: RequestContext = {
      req,
      url,
      params,
      ip,
      isLocal,
      sessionId: null,
      requestId,
      responseHeaders: new Headers({ "X-Request-Id": requestId }),
      body: async <T,>(maxBytes = MAX_BODY_BYTES) => {
        if (parsedBody !== undefined) return parsedBody as T;
        const text = await readBodyText(req, Math.min(maxBytes, MAX_BODY_BYTES));
        if (!text.trim()) {
          parsedBody = {};
          return parsedBody as T;
        }
        try {
          parsedBody = JSON.parse(text);
        } catch {
          throw new HttpError(400, "Request body is not valid JSON");
        }
        return parsedBody as T;
      },
    };

    const started = performance.now();
    try {
      if (UNSAFE_METHODS.has(method) && !isAllowedOrigin(req)) {
        throw new HttpError(403, "Cross-origin requests are not allowed");
      }
      for (const mw of this.middlewares) await mw(ctx);
      const result = await matched.handler(ctx);
      if (result instanceof Response) {
        for (const [k, v] of ctx.responseHeaders) if (!result.headers.has(k)) result.headers.set(k, v);
        if (!result.headers.has("Cache-Control")) result.headers.set("Cache-Control", "no-store");
        return result;
      }
      return jsonFor(req, result ?? { success: true }, 200, ctx.responseHeaders, !isLoopbackAddress(ip));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = boundedErrorMessage(err);
      const durationMs = Math.round(performance.now() - started);
      if (status >= 500) {
        appLogger.logStep("error", "http", requestId, `${method} ${matched.path} -> ${status} ${message}`, durationMs, {
          stack: err instanceof Error ? err.stack?.split("\n").slice(1, 4).join(" | ") : undefined,
        });
      } else if (status !== 401 && status !== 404) {
        // Without a session anyone who reaches the port could fill the log file: only a debug record then.
        appLogger.logStep(ctx.sessionId ? "warning" : "debug", "http", requestId, `${method} ${matched.path} -> ${status} ${message}`, durationMs);
      }
      return json({ statusCode: status, message, requestId }, status, ctx.responseHeaders);
    }
  }
}
