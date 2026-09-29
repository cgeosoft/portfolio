/**
 * Small HTTP router on top of Bun.serve. Routes are `METHOD /path/:param`
 * patterns; handlers receive a request context and return JSON (plain
 * objects), a `Response`, or throw an `HttpError`. Every request gets an id
 * for log correlation (X-Request-Id).
 *
 * Two transport checks run before any route: a request that changes state
 * (POST, PUT, PATCH, DELETE) must come from the app's own origin, and API
 * responses are never cached by the browser. Large JSON bodies are gzipped
 * for clients that accept it (a phone on the LAN loads the portfolio data
 * several times faster).
 */
import { randomUUID } from "node:crypto";
import { appLogger } from "../logger";

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
  /** Parsed JSON body; `{}` when the request has none. */
  body<T = Record<string, unknown>>(): Promise<T>;
  /** Set-Cookie and other headers merged into the JSON response. */
  responseHeaders: Headers;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;
export type Middleware = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const MAX_BODY_BYTES = 30 * 1024 * 1024;
/** JSON bodies at least this long are gzipped when the client accepts it. */
const COMPRESS_MIN_BYTES = 4 * 1024;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
 * carries one must name this app: the host of the request itself, or a
 * loopback name for the desktop window and the Vite dev server (which proxy
 * `/api` from another loopback port). A request without `Origin` comes from
 * the app's own scripts or a non-browser client. This closes cross-site
 * request forgery from a web page against the loopback and LAN listeners.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (!originHost) return false;
  if (isLoopbackHostname(originHost)) return true;
  return originHost === hostnameOf(req.headers.get("host"));
}

/** JSON response. API answers carry no-store so a shared browser never keeps balances. */
export function json(data: unknown, status = 200, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data ?? null), { status, headers: h });
}

function acceptsGzip(req: Request): boolean {
  const accept = req.headers.get("accept-encoding") || "";
  return /(^|,)\s*gzip\s*(;|,|$)/i.test(accept);
}

/** Like `json()`, gzipped when the body is large and the client accepts it. */
export function jsonFor(req: Request, data: unknown, status = 200, headers?: Headers): Response {
  const body = JSON.stringify(data ?? null);
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  if (body.length < COMPRESS_MIN_BYTES || req.method === "HEAD" || !acceptsGzip(req)) {
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
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
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

  /** Returns null when no route matches (the caller serves static files). */
  async handle(req: Request, ip: string): Promise<Response | null> {
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
      isLocal: isLoopbackAddress(ip),
      sessionId: null,
      requestId,
      responseHeaders: new Headers({ "X-Request-Id": requestId }),
      body: async <T,>() => {
        if (parsedBody !== undefined) return parsedBody as T;
        const length = Number(req.headers.get("content-length") || 0);
        if (length > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
        const text = await req.text();
        if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
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
      return jsonFor(req, result ?? { success: true }, 200, ctx.responseHeaders);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Math.round(performance.now() - started);
      if (status >= 500) {
        appLogger.logStep("error", "http", requestId, `${method} ${url.pathname} -> ${status} ${message}`, durationMs, {
          stack: err instanceof Error ? err.stack?.split("\n").slice(1, 4).join(" | ") : undefined,
        });
      } else if (status !== 401 && status !== 404) {
        appLogger.logStep("warning", "http", requestId, `${method} ${url.pathname} -> ${status} ${message}`, durationMs);
      }
      return json({ statusCode: status, message, requestId }, status, ctx.responseHeaders);
    }
  }
}
