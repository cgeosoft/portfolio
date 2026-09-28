/**
 * Push notifications of the automations: one message goes to every channel
 * of Settings, Integrations that is set up (Gotify, ntfy).
 */
import type { NotificationChannel } from "portfolio-shared/api-types";
import { isGotifyConfigured, sendGotify } from "./gotify";
import { isNtfyConfigured, sendNtfy } from "./ntfy";

export interface PushMessage {
  title: string;
  /** Markdown; both channels render it. */
  message: string;
}

const CHANNEL_NAMES: Record<NotificationChannel, string> = { gotify: "Gotify", ntfy: "ntfy" };

/** The channels that are set up, in a fixed order. */
export function configuredChannels(): NotificationChannel[] {
  const out: NotificationChannel[] = [];
  if (isGotifyConfigured()) out.push("gotify");
  if (isNtfyConfigured()) out.push("ntfy");
  return out;
}

/** "Gotify and ntfy", for status messages. */
export function channelNames(channels: NotificationChannel[]): string {
  return channels.map((c) => CHANNEL_NAMES[c]).join(" and ");
}

/** Sends to every set-up channel. `ok` is true when each of them accepted the message. */
export async function notifyAll(msg: PushMessage, channels = configuredChannels()): Promise<{ ok: boolean; errors: string[] }> {
  const results = await Promise.all(channels.map((c) => (c === "gotify" ? sendGotify(msg) : sendNtfy(msg))));
  const errors = results.filter((r) => !r.success).map((r) => r.error ?? "The notification failed.");
  return { ok: errors.length === 0, errors };
}
