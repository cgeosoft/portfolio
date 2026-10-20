/**
 * Which servers a client on another device may make the service call. The
 * LLM, Gotify, ntfy and metric routes fetch a URL the request names and
 * return part of the reply (a test message, model ids, an error). From the
 * desktop window that is the user setting up. From a phone it would let any
 * PIN holder probe this computer and the local network through the service,
 * so a remote client may name a public server, or a server already saved in
 * Settings, but not a new loopback, private or link-local address.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DEFAULT_OPENAI_COMPATIBLE_URL } from "portfolio-shared/llm-defaults";
import { isSameServer, loadConfig } from "../config";

function isInternalIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 || // this network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast and unspecified addresses. */
export function isInternalAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) return isInternalIPv4(ip);
  if (isIP(ip) !== 6) return false;
  if (ip.startsWith("::ffff:")) {
    // An IPv4-mapped address, dotted (::ffff:127.0.0.1) or as WHATWG URL writes it (::ffff:7f00:1).
    const rest = ip.slice("::ffff:".length);
    if (isIP(rest) === 4) return isInternalIPv4(rest);
    const [hi = "", lo = ""] = rest.split(":");
    const n = (parseInt(hi, 16) << 16) | parseInt(lo, 16);
    return isInternalIPv4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }
  return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff");
}

/**
 * True when a URL's host is, or resolves to, an internal address. A name
 * that does not resolve counts as public: the fetch then fails on its own.
 */
export async function isInternalTarget(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (!host) return false;
  if (isIP(host)) return isInternalAddress(host);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.some((a) => isInternalAddress(a.address));
  } catch {
    return false;
  }
}

/** Every server URL saved in Settings, plus the default OpenAI-compatible server the LLM uses when none is saved. */
function savedServerUrls(): string[] {
  const cfg = loadConfig();
  return [DEFAULT_OPENAI_COMPATIBLE_URL, cfg.llmBaseUrl, ...Object.values(cfg.llmBaseUrls ?? {}), cfg.gotifyUrl, cfg.ntfyUrl].filter(Boolean);
}

/**
 * The URLs among `urls` a remote client may not point the service at: new
 * internal targets. Empty values are skipped (the stored server applies).
 */
export async function blockedRemoteTargets(urls: unknown[]): Promise<string[]> {
  const saved = savedServerUrls();
  const blocked: string[] = [];
  for (const url of urls) {
    if (typeof url !== "string" || !url.trim()) continue;
    if (saved.some((s) => isSameServer(url, s))) continue;
    if (await isInternalTarget(url)) blocked.push(url);
  }
  return blocked;
}

const MAX_REDIRECTS = 5;
/** Headers that carry no credential and may follow a redirect to another origin. */
const CROSS_ORIGIN_HEADERS = new Set(["accept", "content-type", "user-agent"]);

/**
 * `fetch` for a URL a client may name (LLM, Gotify, ntfy, metrics). It
 * follows redirects itself and refuses one from a public server to a
 * loopback, private or link-local address, so a redirect cannot get past
 * `blockedRemoteTargets`. A redirect to another origin keeps no key or
 * token header. 303, and 301 or 302 after a POST, continue as a GET without
 * a body, as `fetch` does.
 */
export async function fetchWithCheckedRedirects(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let current = String(input);
  let request: RequestInit = { ...init, redirect: "manual" };
  let startsInternal: boolean | undefined;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, request);
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const next = new URL(location, current);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error("Refusing a redirect to a non-HTTP address");
    startsInternal ??= await isInternalTarget(current);
    if (!startsInternal && (await isInternalTarget(next.toString()))) {
      throw new Error("Refusing a redirect from a public server to this computer or the local network");
    }
    const method = (request.method ?? "GET").toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      request = { ...request, method: "GET", body: undefined };
    }
    if (next.origin !== new URL(current).origin) {
      const headers = new Headers();
      new Headers(request.headers).forEach((value, key) => {
        if (CROSS_ORIGIN_HEADERS.has(key.toLowerCase())) headers.set(key, value);
      });
      request = { ...request, headers };
    }
    current = next.toString();
  }
}
