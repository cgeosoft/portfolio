/**
 * Small HTTP router on top of Bun.serve. Routes are `METHOD /path/:param`
 * patterns; handlers receive a request context and return JSON (plain
 * objects), a `Response`, or throw an `HttpError`. Every request gets an id
 * for log correlation (X-Request-Id).
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

export function json(data: unknown, status = 200, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data ?? null), { status, headers: h });
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
      params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")]));
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
      for (const mw of this.middlewares) await mw(ctx);
      const result = await matched.handler(ctx);
      if (result instanceof Response) {
        for (const [k, v] of ctx.responseHeaders) if (!result.headers.has(k)) result.headers.set(k, v);
        return result;
      }
      return json(result ?? { success: true }, 200, ctx.responseHeaders);
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
