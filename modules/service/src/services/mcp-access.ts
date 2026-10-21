/**
 * The "MCP server" switch, port and access token (Settings, Privacy &
 * Security). While the switch is on, a listener on `127.0.0.1:<mcp port>`
 * serves `/mcp` and nothing else (mcp-server.ts). It never listens on the
 * network: only programs on this computer reach it, and only with the token.
 *
 * The token is random (256 bits) and shown once, in the response that
 * creates it; the `kv_entries` table keeps its SHA-256 only, like the
 * session ids (auth.ts). A new token replaces the old one at once.
 *
 * The switch and the port are the `mcpEnabled` and `mcpPort` rows of the
 * `settings` table. Only a loopback client may change them or the token
 * (`/api/host/mcp`), and `PATCH /api/config` ignores them.
 */
import * as crypto from "node:crypto";
import type { McpAccessInfo } from "portfolio-shared/api-types";
import { DEFAULT_MCP_PORT } from "portfolio-shared/config-types";
import { loadConfig, updateConfig } from "../config";
import { getDatabase } from "../db/database";
import { HttpError } from "../http/router";
import { appLogger } from "../logger";
import { handleMcpHttp } from "./mcp-server";
import type { McpToolDeps } from "./mcp-tools";

const LOOPBACK_HOST = "127.0.0.1";
const TOKEN_KEY = "mcp:tokenHash";
/** Path of the endpoint on the MCP listener. */
export const MCP_PATH = "/mcp";

/** A running listener, as `Bun.serve` returns it. */
export interface Listener {
  stop(closeActiveConnections?: boolean): void;
}

/** Starts a listener on `127.0.0.1:port` with the given fetch handler. Throws when the port is taken. */
export type McpServeFn = (port: number, fetch: (req: Request) => Promise<Response>) => Listener;

let serve: McpServeFn | null = null;
let deps: McpToolDeps | null = null;
let listener: Listener | null = null;
let listenerPort = 0;
let bindError: string | undefined;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function storedTokenHash(): string | null {
  const row = getDatabase().query("SELECT value FROM kv_entries WHERE key = ?").get(TOKEN_KEY) as { value: string } | null;
  return row?.value ?? null;
}

export function hasMcpToken(): boolean {
  return storedTokenHash() !== null;
}

/** True when `token` is the current access token. Constant time. */
export function isValidMcpToken(token: string | null | undefined): boolean {
  const stored = storedTokenHash();
  if (!token || !stored) return false;
  const a = Buffer.from(tokenHash(token), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Creates a new access token, replacing the old one, and returns it. It cannot be read back later. */
export function createMcpToken(): string {
  const token = `pmcp_${crypto.randomBytes(32).toString("base64url")}`;
  getDatabase().run(
    "INSERT INTO kv_entries (key, value, expiresAt) VALUES (?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expiresAt = NULL",
    [TOKEN_KEY, tokenHash(token)],
  );
  appLogger.logStep("info", "mcp", "token", "New MCP access token created");
  return token;
}

function deleteMcpToken(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key = ?", [TOKEN_KEY]);
}

/** The port the MCP listener uses (or would use). */
export function mcpPort(): number {
  return loadConfig().mcpPort || DEFAULT_MCP_PORT;
}

export function isMcpEnabled(): boolean {
  return loadConfig().mcpEnabled === true;
}

/** The fetch handler of the MCP listener: `/mcp` only. */
async function fetchMcp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== MCP_PATH && url.pathname !== `${MCP_PATH}/`) return new Response("Not found", { status: 404 });
  if (!deps) return new Response("Service is starting", { status: 503 });
  return handleMcpHttp(req, deps, isValidMcpToken);
}

/** Starts, stops or rebinds the MCP listener to match the settings. Throws when the port cannot be bound. */
function apply(): void {
  const want = isMcpEnabled() && hasMcpToken() ? mcpPort() : 0;
  if (want === listenerPort) return;
  if (want === 0) {
    listener?.stop(true);
    listener = null;
    listenerPort = 0;
    bindError = undefined;
    appLogger.logStep("info", "mcp", "listen", "MCP server off");
    return;
  }
  if (!serve) return;
  let next: Listener;
  try {
    next = serve(want, fetchMcp);
  } catch (err) {
    bindError = `Could not listen on port ${want}: ${errorText(err)}`;
    throw new Error(bindError);
  }
  // Bind the new port first, so a failure keeps the old listener running.
  listener?.stop(true);
  listener = next;
  listenerPort = want;
  bindError = undefined;
  appLogger.logStep("info", "mcp", "listen", `MCP server on http://${LOOPBACK_HOST}:${want}${MCP_PATH}`);
}

/**
 * `main.ts` hands over the services and the function that starts a listener.
 * Starts the MCP listener when the switch is on; a port in use is logged and
 * shown in Settings, the service keeps running.
 */
export function startMcpAccess(serveFn: McpServeFn, toolDeps: McpToolDeps): void {
  serve = serveFn;
  deps = toolDeps;
  try {
    apply();
  } catch (err) {
    appLogger.logStep("warning", "mcp", "listen", errorText(err));
  }
}

/** Stops the MCP listener (shutdown). */
export function stopMcpAccess(): void {
  listener?.stop(true);
  listener = null;
  listenerPort = 0;
}

export function mcpAccessInfo(token?: string): McpAccessInfo {
  const enabled = isMcpEnabled();
  const port = mcpPort();
  return {
    enabled,
    port,
    url: `http://${LOOPBACK_HOST}:${port}${MCP_PATH}`,
    listening: listener !== null,
    hasToken: hasMcpToken(),
    ...(token ? { token } : {}),
    ...(enabled && bindError ? { error: bindError } : {}),
  };
}

/**
 * Stores the switch and the port, then applies them. Turning the server on
 * without a token creates one; the response then carries it, once. Turning it
 * off deletes the token, so a client configured earlier stops working. A port
 * that cannot be bound is not stored: the caller gets 409.
 */
export function setMcpAccess(update: { enabled?: boolean; port?: number }): McpAccessInfo {
  const cfg = loadConfig();
  const previous = { mcpEnabled: cfg.mcpEnabled, mcpPort: cfg.mcpPort };
  const enabled = update.enabled ?? cfg.mcpEnabled;
  const port = update.port ?? cfg.mcpPort;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new HttpError(400, "The port must be a whole number from 1024 to 65535");
  if (enabled && port === cfg.remotePort && cfg.allowRemoteConnections) throw new HttpError(400, "The MCP port must differ from the port for other devices");

  const token = enabled && !hasMcpToken() ? createMcpToken() : undefined;
  updateConfig({ mcpEnabled: enabled, mcpPort: port });
  try {
    apply();
  } catch (err) {
    updateConfig(previous);
    if (token) deleteMcpToken();
    throw new HttpError(409, errorText(err));
  }
  if (!enabled) deleteMcpToken();
  return mcpAccessInfo(token);
}

/** Replaces the access token while the server is on. The response carries the new one, once. */
export function rotateMcpToken(): McpAccessInfo {
  if (!isMcpEnabled()) throw new HttpError(400, "Turn on the MCP server first");
  const token = createMcpToken();
  try {
    apply();
  } catch (err) {
    appLogger.logStep("warning", "mcp", "listen", errorText(err));
  }
  return mcpAccessInfo(token);
}
