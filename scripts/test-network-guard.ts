/**
 * Test preload (bunfig.toml `[test] preload`): no test may reach the network.
 *
 * `fetch`, `WebSocket` and `node:http`/`node:https` requests to any host but
 * loopback throw, and the test that sent one fails in `afterEach`, even when
 * the code under test caught the error (the FMP client, for one, turns a
 * failed fetch into null). Tests stub `globalThis.fetch` with a mock and put
 * back the value they saved, which is this guard. `data:`, `blob:` and
 * `file:` URLs stay allowed (the metric compiler fetches its WASM from a
 * data URL), and so do local servers a test starts itself.
 */
import { afterEach } from "bun:test";
import http from "node:http";
import https from "node:https";

const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

const blocked: string[] = [];

/** The blocked requests since the last call, and clears them. For the guard's own test. */
export function takeBlockedRequests(): string[] {
  return blocked.splice(0);
}

function toUrl(input: unknown): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === "string") return new URL(input);
    if (input instanceof Request) return new URL(input.url);
    if (input && typeof input === "object") {
      // node:http options: { protocol, hostname | host, port, path }
      const o = input as { protocol?: string; hostname?: string; host?: string; path?: string; href?: string };
      if (typeof o.href === "string") return new URL(o.href);
      const host = o.hostname ?? o.host;
      if (host) return new URL(`${o.protocol ?? "http:"}//${host}${o.path ?? "/"}`);
    }
  } catch {
    // Not a URL; the real call reports it.
  }
  return null;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Throws for a request to the network. The path goes in the message, the query does not. */
function guard(input: unknown, via: string): void {
  const url = toUrl(input);
  if (!url || !NETWORK_PROTOCOLS.has(url.protocol) || isLoopback(url.hostname)) return;
  const target = `${url.protocol}//${url.host}${url.pathname}`;
  blocked.push(`${via} ${target}`);
  throw new Error(`Network request blocked in tests (${via} ${target}). Stub it: assign a mock to globalThis.fetch and restore it after the test.`);
}

const realFetch = globalThis.fetch;
const guardedFetch = ((input: string | URL | Request, init?: RequestInit) => {
  try {
    guard(input, "fetch");
  } catch (err) {
    return Promise.reject(err);
  }
  return realFetch(input, init);
}) as typeof fetch;
globalThis.fetch = Object.assign(guardedFetch, realFetch);

const RealWebSocket = globalThis.WebSocket;
if (RealWebSocket) {
  globalThis.WebSocket = class GuardedWebSocket extends RealWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      guard(url, "WebSocket");
      super(url, protocols);
    }
  } as typeof WebSocket;
}

for (const [name, mod] of [
  ["http", http],
  ["https", https],
] as const) {
  const realRequest = mod.request;
  const realGet = mod.get;
  (mod as { request: unknown }).request = (...args: unknown[]) => {
    guard(args[0], `${name}.request`);
    return (realRequest as (...a: unknown[]) => unknown)(...args);
  };
  (mod as { get: unknown }).get = (...args: unknown[]) => {
    guard(args[0], `${name}.get`);
    return (realGet as (...a: unknown[]) => unknown)(...args);
  };
}

afterEach(() => {
  const attempts = takeBlockedRequests();
  if (attempts.length > 0) {
    throw new Error(`The test tried to reach the network ${attempts.length} time(s):\n  ${attempts.join("\n  ")}`);
  }
});
