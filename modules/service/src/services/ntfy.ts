/**
 * ntfy push notifications (Settings, Integrations). The service publishes a
 * message as JSON to the root of the ntfy server (https://ntfy.sh or a
 * self-hosted one), which keeps titles with any character intact. On the
 * public server the topic name is the only protection, so the GUI asks for a
 * hard-to-guess one; a protected topic takes an access token.
 */
import { loadConfig } from "../config";
import { appLogger } from "../logger";
import type { SendNotificationResponse } from "portfolio-shared/api-types";
import type { PushMessage } from "./notify";

const REQUEST_TIMEOUT_MS = 15_000;

export interface NtfyTarget {
  url?: string;
  topic?: string;
  token?: string;
  priority?: number;
}

/** The publish endpoint of a server URL: its root, with or without a trailing slash. */
export function ntfyPublishUrl(rawUrl: string): string {
  return `${rawUrl.trim().replace(/\/+$/, "")}/`;
}

/** A topic ntfy accepts: letters, digits, `-` and `_`, up to 64 characters. */
export function isValidNtfyTopic(topic: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(topic);
}

/** Whether a topic is stored. The server URL always has a value (ntfy.sh by default). */
export function isNtfyConfigured(): boolean {
  return Boolean(loadConfig().ntfyTopic.trim());
}

/**
 * Publishes one message. The target falls back to the stored settings, so the
 * Test button can try a topic before it is saved.
 */
export async function sendNtfy(msg: PushMessage, target: NtfyTarget = {}): Promise<SendNotificationResponse> {
  const cfg = loadConfig();
  const url = (target.url?.trim() || cfg.ntfyUrl).trim();
  const topic = (target.topic?.trim() || cfg.ntfyTopic).trim();
  const token = (target.token?.trim() || cfg.ntfyToken).trim();
  if (!topic) return { success: false, error: "Set the ntfy topic first." };
  if (!isValidNtfyTopic(topic)) return { success: false, error: "An ntfy topic has only letters, digits, - and _ (up to 64 characters)." };
  if (!/^https?:\/\//i.test(url)) return { success: false, error: "The ntfy server URL must start with http:// or https://." };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const started = Date.now();
  try {
    const res = await fetch(ntfyPublishUrl(url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        topic,
        title: msg.title,
        message: msg.message,
        priority: target.priority ?? cfg.ntfyPriority,
        markdown: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = `${detail}: ${body.error}`;
      } catch {
        // keep the status
      }
      appLogger.logStep("warning", "ntfy", "send", `ntfy rejected the message (${detail})`);
      return { success: false, latencyMs, error: `The ntfy server rejected the message (${detail}).` };
    }
    appLogger.logStep("success", "ntfy", "send", `ntfy message delivered in ${latencyMs} ms`);
    return { success: true, latencyMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appLogger.logStep("warning", "ntfy", "send", `ntfy is not reachable: ${message}`);
    return { success: false, error: `Could not reach the ntfy server: ${message}` };
  }
}
