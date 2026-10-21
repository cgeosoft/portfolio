/**
 * MCP server (Model Context Protocol) for other LLM clients on this computer,
 * such as Claude Desktop, Claude Code or Cursor. It speaks the Streamable
 * HTTP transport in its stateless form: every JSON-RPC message is one POST to
 * `/mcp` and gets a JSON answer, with no session and no server-sent events.
 * The listener, the switch and the access token are in mcp-access.ts; the
 * tools and the percent-only rule in mcp-tools.ts.
 *
 * Checks before any message runs: a request that carries an `Origin` must
 * name this listener (a web page cannot call it), and the `Authorization`
 * header must carry the access token. The Terms of Use must be accepted.
 */
import { appLogger } from "../logger";
import { getAppVersion } from "../environment";
import { hostnameOf, isLoopbackHostname } from "../http/router";
import { authService } from "./auth";
import { MCP_TOOLS, McpPrivacyError, McpToolInputError, callMcpTool, type McpToolDeps } from "./mcp-tools";

/** Protocol revisions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
/** Largest JSON-RPC body; a tool call needs a few hundred bytes. */
const MAX_MCP_BODY_BYTES = 256 * 1024;

const SERVER_INSTRUCTIONS =
  "Read-only access to the user's investment portfolios in the Portfolio app. " +
  "Every number is a percentage (weights, returns, exposure, yields) or a count. " +
  "The app never shares money amounts, prices, quantities, cost or balances, so do not ask for them or try to work them out. " +
  "Start with list_portfolios.";

type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function httpJson(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text of a tool result: the answer as JSON for clients that read only `content`. */
function toolResult(data: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false };
}

function toolError(message: string): unknown {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function callTool(deps: McpToolDeps, params: Record<string, unknown>): Promise<unknown> {
  const name = typeof params.name === "string" ? params.name : "";
  const args = isRecord(params.arguments) ? params.arguments : {};
  const started = performance.now();
  try {
    const data = await callMcpTool(deps, name, args);
    appLogger.logStep("info", "mcp", "tool", `Tool ${name} answered`, Math.round(performance.now() - started));
    return toolResult(data);
  } catch (err) {
    if (err instanceof McpToolInputError) return toolError(err.message);
    if (err instanceof McpPrivacyError) {
      appLogger.logStep("error", "mcp", "privacy", `Tool ${name} was stopped: ${err.message}`);
      return toolError("The answer was withheld because it would have included a value that is not a percentage.");
    }
    // A provider error can carry anything: the client gets a fixed text, the log the error class.
    appLogger.logStep("warning", "mcp", "tool", `Tool ${name} failed (${err instanceof Error ? err.name : typeof err})`, Math.round(performance.now() - started));
    return toolError(`The tool ${name} failed. Try again later.`);
  }
}

/** Answers one JSON-RPC message. Null for a notification or a response, which get no answer. */
export async function handleMcpMessage(deps: McpToolDeps, msg: unknown): Promise<JsonRpcResponse | null> {
  if (!isRecord(msg)) return rpcError(null, INVALID_REQUEST, "Invalid request");
  const m = msg as JsonRpcMessage;
  const hasId = "id" in m && (typeof m.id === "string" || typeof m.id === "number");
  const id: JsonRpcId = hasId ? (m.id as string | number) : null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    // A response from the client (to a request this server never sends) needs no answer.
    if (m.jsonrpc === "2.0" && hasId && ("result" in m || "error" in m)) return null;
    return rpcError(id, INVALID_REQUEST, "Invalid request");
  }
  if (!hasId) return null; // notifications: initialized, cancelled, ...
  const params = isRecord(m.params) ? m.params : {};

  switch (m.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "portfolio", title: "Portfolio", version: getAppVersion() },
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
    case "tools/call": {
      if (typeof params.name !== "string") return rpcError(id, INVALID_PARAMS, "params.name is required");
      if (!MCP_TOOLS.some((t) => t.name === params.name)) return rpcError(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
      return { jsonrpc: "2.0", id, result: await callTool(deps, params) };
    }
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${m.method}`);
  }
}

/** The bearer token of a request, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1]! : null;
}

/**
 * True when the request carries no `Origin` (an MCP client is not a browser)
 * or one that names a loopback host on this listener's port. Closes DNS
 * rebinding and cross-site requests from web pages.
 */
export function mcpOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return isLoopbackHostname(hostnameOf(parsed.host)) && parsed.host === (req.headers.get("host") || "").trim().toLowerCase();
  } catch {
    return false;
  }
}

async function readBody(req: Request): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_MCP_BODY_BYTES) return null;
  const text = await req.text();
  return Buffer.byteLength(text, "utf-8") > MAX_MCP_BODY_BYTES ? null : text;
}

/**
 * The `/mcp` endpoint. `tokenValid` checks the access token (mcp-access.ts).
 * GET and DELETE get 405: the server opens no event stream and keeps no session.
 */
export async function handleMcpHttp(req: Request, deps: McpToolDeps, tokenValid: (token: string | null) => boolean): Promise<Response> {
  if (!isLoopbackHostname(hostnameOf(req.headers.get("host")))) return httpJson({ error: "Invalid Host header" }, 403);
  if (!mcpOriginAllowed(req)) return httpJson({ error: "Origin not allowed" }, 403);
  if (!tokenValid(bearerToken(req))) {
    return httpJson({ error: "A valid access token is required (Settings, Privacy & Security, MCP server)" }, 401, { "WWW-Authenticate": 'Bearer realm="portfolio-mcp"' });
  }
  if (req.method !== "POST") return httpJson({ error: `Method ${req.method} not allowed` }, 405, { Allow: "POST" });
  if (!authService.hasAcceptedTerms()) return httpJson({ error: "Open Portfolio and accept the Terms of Use first" }, 403);
  const version = req.headers.get("mcp-protocol-version");
  if (version !== null && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return httpJson(rpcError(null, INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${version.slice(0, 32)}`), 400);
  }

  const text = await readBody(req);
  if (text === null) return httpJson(rpcError(null, INVALID_REQUEST, "Request body is too large"), 413);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return httpJson(rpcError(null, PARSE_ERROR, "Parse error"), 400);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) return httpJson(rpcError(null, INVALID_REQUEST, "Empty batch"), 400);
    const answers: JsonRpcResponse[] = [];
    for (const msg of payload) {
      const answer = await handleMcpMessage(deps, msg);
      if (answer) answers.push(answer);
    }
    return answers.length ? httpJson(answers) : new Response(null, { status: 202 });
  }
  const answer = await handleMcpMessage(deps, payload);
  return answer ? httpJson(answer) : new Response(null, { status: 202 });
}
