/**
 * The "allow remote connections" switch. The HTTP server binds to loopback
 * until the switch is on; toggling it restarts the listener on the new
 * address without restarting the process. The setting is a small JSON file
 * next to the database (`host-settings.json`) so it is read before the
 * server starts. Remote access requires a PIN (financial data on the LAN).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appLogger } from "../logger";
import { getStorageDir } from "../paths";

export interface HostSettings {
  allowRemoteConnections: boolean;
}

export interface RemoteAccessInfo {
  enabled: boolean;
  port: number;
  urls: string[];
  /** A PIN must be set before remote access can be enabled. */
  pinRequired: boolean;
}

export class HostSettingsService {
  private readonly file = process.env["PORTFOLIO_HOST_SETTINGS_FILE"]?.trim() || path.join(getStorageDir(), "host-settings.json");
  private settings: HostSettings = this.read();
  private port = 0;
  private rebind: ((host: string) => Promise<void>) | null = null;

  get allowRemoteConnections(): boolean {
    return this.settings.allowRemoteConnections;
  }

  /** Address the HTTP server binds to for the current setting. */
  listenHost(): string {
    const forced = process.env["PORTFOLIO_HOST"]?.trim();
    if (forced) return forced;
    return this.settings.allowRemoteConnections ? "0.0.0.0" : "127.0.0.1";
  }

  /** Called once the server listens so a later toggle can rebind it. */
  attach(port: number, rebind: (host: string) => Promise<void>): void {
    this.port = port;
    this.rebind = rebind;
  }

  get listenPort(): number {
    return this.port;
  }

  async setAllowRemoteConnections(enabled: boolean): Promise<void> {
    if (enabled === this.settings.allowRemoteConnections) return;
    this.settings = { ...this.settings, allowRemoteConnections: enabled };
    this.write();
    if (this.rebind) await this.rebind(this.listenHost());
    appLogger.logStep("info", "host", "remote-access", `Remote connections ${enabled ? "allowed" : "blocked"}; listening on ${this.listenHost()}:${this.port}`);
  }

  /** URLs a phone on the same network can open, one per IPv4 interface. */
  lanUrls(): string[] {
    const urls: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos || []) {
        if (info.family !== "IPv4" || info.internal) continue;
        urls.push(`http://${info.address}:${this.port}`);
      }
    }
    return urls;
  }

  private read(): HostSettings {
    if (!fs.existsSync(this.file)) return { allowRemoteConnections: false };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { allowRemoteConnections: raw?.allowRemoteConnections === true };
    } catch (err) {
      appLogger.logStep("warning", "host", "settings", `Could not read ${this.file}: ${err}; using defaults`);
      return { allowRemoteConnections: false };
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2) + "\n");
  }
}

export const hostSettings = new HostSettingsService();
