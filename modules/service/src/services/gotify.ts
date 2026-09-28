/**
 * Gotify push notifications (Settings, Integrations). The service posts a
 * message to `<server>/message` with the application token of the user's own
 * Gotify server; the Gotify apps show it on the phone and the desktop.
 * Messages carry Markdown, which the Gotify clients render.
 */
import { loadConfig } from "../config";
import { appLogger } from "../logger";
import type { SendNotificationResponse } from "portfolio-shared/api-types";
import type { PushMessage } from "./notify";

const REQUEST_TIMEOUT_MS = 15_000;


export interface GotifyTarget {
  url?: string;
  token?: string;
  priority?: number;
}

/** The message endpoint of a server URL, with or without a trailing slash or `/message`. */
export function gotifyMessageUrl(rawUrl: string): string {
  return `${rawUrl.trim().replace(/\/+$/, "").replace(/\/message$/, "")}/message`;
}

/** Whether a Gotify server and token are stored. */
export function isGotifyConfigured(): boolean {
  const cfg = loadConfig();
  return Boolean(cfg.gotifyUrl.trim() && cfg.gotifyToken.trim());
}

/**
 * Sends one message. The target falls back to the stored settings, so the
 * Test button can try a URL and token before they are saved.
 */
export async function sendGotify(msg: PushMessage, target: GotifyTarget = {}): Promise<SendNotificationResponse> {
  const cfg = loadConfig();
  const url = (target.url?.trim() || cfg.gotifyUrl).trim();
  const token = (target.token?.trim() || cfg.gotifyToken).trim();
  if (!url || !token) return { success: false, error: "Set the Gotify server URL and application token first." };
  if (!/^https?:\/\//i.test(url)) return { success: false, error: "The Gotify server URL must start with http:// or https://." };

  const started = Date.now();
  try {
    const res = await fetch(gotifyMessageUrl(url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gotify-Key": token },
      body: JSON.stringify({
        title: msg.title,
        message: msg.message,
        priority: target.priority ?? cfg.gotifyPriority,
        extras: { "client::display": { contentType: "text/markdown" } },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; errorDescription?: string };
        detail = [detail, body.errorDescription || body.error].filter(Boolean).join(": ");
      } catch {
        // keep the status
      }
      appLogger.logStep("warning", "gotify", "send", `Gotify rejected the message (${detail})`);
      return { success: false, latencyMs, error: `The Gotify server rejected the message (${detail}).` };
    }
    appLogger.logStep("success", "gotify", "send", `Gotify message delivered in ${latencyMs} ms`);
    return { success: true, latencyMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appLogger.logStep("warning", "gotify", "send", `Gotify is not reachable: ${message}`);
    return { success: false, error: `Could not reach the Gotify server: ${message}` };
  }
}
