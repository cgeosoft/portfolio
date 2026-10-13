/**
 * "Connect OpenRouter": the OAuth PKCE flow that gives the app an OpenRouter
 * API key tied to the user's own account and credits, without the user
 * copying a key.
 *
 * The desktop window asks for a sign-in URL and opens it in the system
 * browser. OpenRouter sends the browser back to this service on loopback
 * with a one-time code; the service trades it, with the PKCE verifier only it
 * holds, for a key and stores the key as the OpenAI-compatible provider's.
 * The browser has no session cookie, so the callback route is public and
 * accepts only a pending `state` it issued in the last ten minutes, once.
 */

import { createHash, randomBytes } from "node:crypto";
import type { OpenRouterConnectStatusResponse, StartOpenRouterConnectResponse } from "portfolio-shared/api-types";
import { loadConfig, updateConfig } from "../config.js";
import { appLogger } from "../logger.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const AUTH_URL = "https://openrouter.ai/auth";
const KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
/** OpenRouter's router picks a model per request; used when no model was chosen for OpenRouter yet. */
const DEFAULT_MODEL = "openrouter/auto";
/** The callback path; the state follows it. Public in routes.ts. */
export const OPENROUTER_CALLBACK_PATH = "/api/llm/openrouter/callback/";

const PENDING_TTL_MS = 10 * 60_000;
const PROVIDER = "openai-compatible";

interface Pending {
  verifier: string;
  createdAt: number;
  status: OpenRouterConnectStatusResponse["status"];
  message?: string;
}

const pending = new Map<string, Pending>();

const base64url = (buf: Buffer) => buf.toString("base64url");

function prune(): void {
  const now = Date.now();
  for (const [state, entry] of pending) {
    if (now - entry.createdAt > PENDING_TTL_MS * 2) pending.delete(state);
    else if (entry.status === "pending" && now - entry.createdAt > PENDING_TTL_MS) entry.status = "expired";
  }
}

/**
 * A sign-in URL whose callback reaches this service on `port`, the port the
 * window talks to. The host is `localhost`: OpenRouter documents localhost
 * callbacks on any port, and the loopback listener answers to that name.
 */
export function startOpenRouterConnect(port: string): StartOpenRouterConnectResponse {
  prune();
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  pending.set(state, { verifier, createdAt: Date.now(), status: "pending" });
  const params = new URLSearchParams({
    callback_url: `http://localhost:${port}${OPENROUTER_CALLBACK_PATH}${state}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authUrl: `${AUTH_URL}?${params}`, state };
}

export function openRouterConnectStatus(state: string): OpenRouterConnectStatusResponse {
  prune();
  const entry = pending.get(state);
  if (!entry) return { status: "expired", message: "This sign-in is no longer valid. Start it again." };
  return { status: entry.status, message: entry.message };
}

/**
 * Trades the code from OpenRouter for a key and stores it. Returns the
 * message for the browser tab. Never logs the code or the key.
 */
export async function completeOpenRouterConnect(state: string, code: string | null): Promise<{ ok: boolean; message: string }> {
  prune();
  const entry = pending.get(state);
  if (!entry || entry.status !== "pending") return { ok: false, message: "This sign-in is no longer valid. Start it again from Settings in Portfolio." };
  const fail = (message: string) => {
    entry.status = "failed";
    entry.message = message;
    appLogger.logStep("warning", "llm", "openrouter_connect", message);
    return { ok: false, message };
  };
  if (!code) return fail("OpenRouter did not return an authorization code.");

  let key = "";
  try {
    const res = await fetch(KEY_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: entry.verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fail(`OpenRouter refused the sign-in (status ${res.status}).`);
    key = String(((await res.json()) as { key?: unknown }).key ?? "").trim();
  } catch (err) {
    return fail(`Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!key) return fail("OpenRouter returned no API key.");

  const config = loadConfig();
  const previousUrl = config.llmBaseUrls?.[PROVIDER] || "";
  const previousModel = config.llmModels?.[PROVIDER]?.trim() || "";
  const model = previousUrl.replace(/\/+$/, "") === OPENROUTER_BASE_URL && previousModel ? previousModel : DEFAULT_MODEL;
  updateConfig({
    llmProvider: PROVIDER,
    llmBaseUrl: OPENROUTER_BASE_URL,
    llmApiKey: key,
    llmModel: model,
    llmBaseUrls: { [PROVIDER]: OPENROUTER_BASE_URL },
    llmApiKeys: { [PROVIDER]: key },
    llmModels: { [PROVIDER]: model },
  });
  entry.status = "connected";
  entry.message = "Connected to OpenRouter.";
  appLogger.logStep("success", "llm", "openrouter_connect", "Connected to OpenRouter");
  return { ok: true, message: "Portfolio is connected to OpenRouter. You can close this tab and return to the app." };
}

/** The small page the browser shows after the callback. */
export function callbackPage(ok: boolean, message: string): string {
  const escaped = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font:15px/1.5 system-ui,sans-serif}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem;color:${ok ? "#34d399" : "#fb7185"}}</style></head>
<body><main><h1>${ok ? "Connected" : "Sign-in failed"}</h1><p>${escaped}</p></main></body></html>`;
}
