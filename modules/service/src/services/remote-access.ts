/**
 * The "remote connections" switch and port (Settings, General). The service
 * always listens on `127.0.0.1` on a random port for the desktop window.
 * While the switch is on and a PIN is set, a second listener on
 * `0.0.0.0:<remote port>` lets phones and other devices on the local network
 * open the same app. A change starts, stops or rebinds that listener without
 * a restart; a port already in use comes back to the GUI as an error.
 *
 * The switch and the port are the `allowRemoteConnections` and `remotePort`
 * rows of the `settings` table. Only a loopback client may change them
 * (`/api/host/remote-access`), and `PATCH /api/config` ignores them. Remote
 * clients go through the same session cookie check as the desktop window.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { RemoteAccessInfo } from "portfolio-shared/api-types";
import { DEFAULT_REMOTE_PORT } from "portfolio-shared/config-types";
import { loadConfig, updateConfig } from "../config";
import { HttpError } from "../http/router";
import { appLogger } from "../logger";
import { DATA_DIR } from "../paths";
import { authService } from "./auth";

const ANY_HOST = "0.0.0.0";

/** A running listener, as `Bun.serve` returns it. */
export interface Listener {
  stop(closeActiveConnections?: boolean): void;
}

/** Starts a listener on `hostname:port` with the app's fetch handler. Throws when the port is taken. */
export type ServeFn = (hostname: string, port: number) => Listener;

let serve: ServeFn | null = null;
let listener: Listener | null = null;
let listenerPort = 0;
let bindError: string | undefined;

/** True when the switch is on and a PIN is set. */
export function isRemoteAccessAllowed(): boolean {
  return loadConfig().allowRemoteConnections === true && authService.isPinEnabled();
}

/** True while the LAN listener runs. The request gate uses it: no settings read per request. */
export function isRemoteListening(): boolean {
  return listener !== null;
}

/** The port the LAN listener uses (or would use). */
export function remotePort(): number {
  return loadConfig().remotePort || DEFAULT_REMOTE_PORT;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Starts, stops or rebinds the LAN listener to match the settings. Throws when the port cannot be bound. */
function apply(): void {
  const want = isRemoteAccessAllowed() ? remotePort() : 0;
  if (want === listenerPort) return;
  if (want === 0) {
    listener?.stop(true);
    listener = null;
    listenerPort = 0;
    bindError = undefined;
    appLogger.logStep("info", "host", "remote-access", "Remote connections off");
    return;
  }
  if (!serve) return;
  let next: Listener;
  try {
    next = serve(ANY_HOST, want);
  } catch (err) {
    bindError = `Could not listen on port ${want}: ${errorText(err)}`;
    throw new Error(bindError);
  }
  // Bind the new port first, so a failure keeps the old listener running.
  listener?.stop(true);
  listener = next;
  listenerPort = want;
  bindError = undefined;
  appLogger.logStep("info", "host", "remote-access", `Remote connections allowed; listening on ${ANY_HOST}:${want}`);
}

/** Imports the `host-settings.json` of releases before 0.6 into the settings table, once. */
function importHostSettingsFile(): void {
  const file = join(DATA_DIR, "host-settings.json");
  if (!existsSync(file)) return;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { allowRemoteConnections?: unknown };
    if (raw?.allowRemoteConnections === true) updateConfig({ allowRemoteConnections: true });
    renameSync(file, `${file}.migrated`);
  } catch (err) {
    appLogger.logStep("warning", "host", "settings", `Could not import ${file}: ${errorText(err)}`);
  }
}

/**
 * `main.ts` hands over the function that starts a listener once the loopback
 * listener runs. Starts the LAN listener when the switch is on; a port in use
 * is logged and shown in Settings, the service keeps running.
 */
export function startRemoteAccess(serveFn: ServeFn): void {
  serve = serveFn;
  importHostSettingsFile();
  try {
    apply();
  } catch (err) {
    appLogger.logStep("warning", "host", "remote-access", errorText(err));
  }
}

/** Stops the LAN listener (shutdown). */
export function stopRemoteAccess(): void {
  listener?.stop(true);
  listener = null;
  listenerPort = 0;
}

/**
 * Stores the switch and the port, then applies them. A value that cannot be
 * bound is not stored: the previous listener keeps running and the caller gets 409.
 */
export function setRemoteAccess(update: { enabled?: boolean; port?: number }): RemoteAccessInfo {
  const cfg = loadConfig();
  const previous = { allowRemoteConnections: cfg.allowRemoteConnections, remotePort: cfg.remotePort };
  const enabled = update.enabled ?? cfg.allowRemoteConnections;
  const port = update.port ?? cfg.remotePort;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new HttpError(400, "The port must be a whole number from 1024 to 65535");
  if (enabled && !authService.isPinEnabled()) throw new HttpError(400, "Set a PIN before allowing remote connections");

  updateConfig({ allowRemoteConnections: enabled, remotePort: port });
  try {
    apply();
  } catch (err) {
    updateConfig(previous);
    throw new HttpError(409, errorText(err));
  }
  return remoteAccessInfo();
}

/** Turns remote access off after the PIN is removed. */
export function disableRemoteAccess(): void {
  if (loadConfig().allowRemoteConnections) updateConfig({ allowRemoteConnections: false });
  apply();
}

/** URLs a device on the same network can open, one per IPv4 interface. */
export function lanUrls(port = remotePort()): string[] {
  const urls: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

export function remoteAccessInfo(): RemoteAccessInfo {
  const enabled = isRemoteAccessAllowed();
  const port = remotePort();
  return {
    enabled,
    port,
    urls: enabled && listener ? lanUrls(port) : [],
    pinRequired: !authService.isPinEnabled(),
    listening: listener !== null,
    ...(enabled && bindError ? { error: bindError } : {}),
  };
}
