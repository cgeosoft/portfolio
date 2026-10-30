/**
 * LAN listener switch (remote-access.ts) with a fake serve function, and how the router gates
 * requests from other devices: the remote switch, sessions, desktop-only routes and internal targets.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REMOTE_PORT } from "portfolio-shared/config-types";
import { DATA_DIR } from "../../paths";
import { HttpError, Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { authService, sessionCookieName } from "../auth";
import { disableRemoteAccess, isRemoteAccessAllowed, isRemoteListening, lanUrls, remoteAccessInfo, remotePort, setRemoteAccess, startRemoteAccess, stopRemoteAccess, type ServeFn } from "../remote-access";
import { loadConfig, saveConfig, updateConfig } from "../../config";
import { getDatabase } from "../../db/database";
import type { AppServices } from "../container";

const PIN = "246810";
const WRONG = "135791";
const PORT_MESSAGE = "The port must be a whole number from 1024 to 65535";
const LAN_URL = /^http:\/\/\d+\.\d+\.\d+\.\d+:5230$/;

const original = loadConfig();
const binds: { host: string; port: number }[] = [];
const stops: number[] = [];
let failPort = -1;
const fakeServe: ServeFn = (host, port) => {
  if (port === failPort) throw new Error("EADDRINUSE");
  binds.push({ host, port });
  return { stop: () => void stops.push(port) };
};

function resetPin(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:pinHash' OR key LIKE 'rate-limit:pin%'");
}

function statusOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return [(e as HttpError).status, (e as Error).message] as const;
  }
  return null;
}

function reset(): void {
  stopRemoteAccess();
  updateConfig({ allowRemoteConnections: false, remotePort: DEFAULT_REMOTE_PORT });
  resetPin();
  binds.length = 0;
  stops.length = 0;
  failPort = -1;
}

const hostFile = () => join(DATA_DIR, "host-settings.json");

afterAll(() => {
  stopRemoteAccess();
  saveConfig({ ...original });
  resetPin();
  for (const f of [hostFile(), hostFile() + ".migrated"]) rmSync(f, { force: true });
});

describe("remote access switch", () => {
  beforeEach(() => {
    reset();
    startRemoteAccess(fakeServe);
  });

  it("needs a PIN before turning on", () => {
    expect(statusOf(() => setRemoteAccess({ enabled: true }))).toEqual([400, "Set a PIN before allowing remote connections"]);
    expect(loadConfig().allowRemoteConnections).toBe(false);
    expect(binds).toEqual([]);
  });

  it("checks the port range", () => {
    for (const port of [1023, 65536, 5000.5, NaN]) {
      expect(statusOf(() => setRemoteAccess({ port }))).toEqual([400, PORT_MESSAGE]);
    }
    expect(statusOf(() => setRemoteAccess({ port: 1024 }))).toBeNull();
    expect(statusOf(() => setRemoteAccess({ port: 65535 }))).toBeNull();
    expect(binds).toEqual([]);
  });

  it("binds on all interfaces once a PIN is set", () => {
    authService.setPin(PIN);
    const info = setRemoteAccess({ enabled: true, port: 5230 });
    expect(binds).toEqual([{ host: "0.0.0.0", port: 5230 }]);
    expect(info).toMatchObject({ enabled: true, port: 5230, pinRequired: false, listening: true });
    for (const url of info.urls) expect(url).toMatch(LAN_URL);
    expect(isRemoteListening()).toBe(true);
    expect(isRemoteAccessAllowed()).toBe(true);
    expect(remotePort()).toBe(5230);
    expect(loadConfig().allowRemoteConnections).toBe(true);

    setRemoteAccess({ enabled: true, port: 5230 });
    expect(binds.length).toBe(1);
  });

  it("binds the new port before stopping the old one", () => {
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5230 });
    setRemoteAccess({ port: 5231 });
    expect(binds[1]).toEqual({ host: "0.0.0.0", port: 5231 });
    expect(stops).toEqual([5230]);
  });

  it("keeps the old listener when the new port is taken", () => {
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5231 });
    failPort = 5232;
    expect(statusOf(() => setRemoteAccess({ port: 5232 }))).toEqual([409, "Could not listen on port 5232: EADDRINUSE"]);
    expect(loadConfig().remotePort).toBe(5231);
    expect(stops).not.toContain(5231);
    expect(isRemoteListening()).toBe(true);
  });

  // Suspected bug: modules/service/src/services/remote-access.ts:66-74 bindError stays set after a failed port change
  it.failing("reports no error while the configured port is listening after a failed change", () => {
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5231 });
    failPort = 5232;
    statusOf(() => setRemoteAccess({ port: 5232 }));
    expect(remoteAccessInfo().error).toBeUndefined();
  });

  it("stops the listener when turned off", () => {
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5233 });
    const info = setRemoteAccess({ enabled: false });
    expect(stops).toContain(5233);
    expect(info.listening).toBe(false);
    expect(info.urls).toEqual([]);
    expect(isRemoteListening()).toBe(false);
  });

  it("disableRemoteAccess turns the stored switch off and stops the listener", () => {
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5234 });
    disableRemoteAccess();
    expect(loadConfig().allowRemoteConnections).toBe(false);
    expect(stops).toContain(5234);
    expect(isRemoteListening()).toBe(false);
  });

  it("treats a stored switch without a PIN as off", () => {
    updateConfig({ allowRemoteConnections: true });
    expect(isRemoteAccessAllowed()).toBe(false);
    expect(remoteAccessInfo()).toMatchObject({ enabled: false, pinRequired: true, urls: [] });
  });

  it("imports the old host-settings.json at start-up", () => {
    stopRemoteAccess();
    writeFileSync(hostFile(), JSON.stringify({ allowRemoteConnections: true }));
    authService.setPin(PIN);
    startRemoteAccess(fakeServe);
    expect(loadConfig().allowRemoteConnections).toBe(true);
    expect(existsSync(hostFile())).toBe(false);
    expect(existsSync(hostFile() + ".migrated")).toBe(true);
    expect(binds).toEqual([{ host: "0.0.0.0", port: remotePort() }]);
    rmSync(hostFile() + ".migrated", { force: true });
  });

  it("keeps an unreadable host-settings.json without throwing", () => {
    stopRemoteAccess();
    writeFileSync(hostFile(), "{not json");
    try {
      expect(() => startRemoteAccess(fakeServe)).not.toThrow();
      expect(existsSync(hostFile())).toBe(true);
    } finally {
      rmSync(hostFile(), { force: true });
    }
  });

  it("reports a taken port at start-up without throwing", () => {
    authService.setPin(PIN);
    updateConfig({ allowRemoteConnections: true, remotePort: 5240 });
    failPort = 5240;
    stopRemoteAccess();
    expect(() => startRemoteAccess(fakeServe)).not.toThrow();
    expect(remoteAccessInfo()).toMatchObject({ enabled: true, listening: false, error: "Could not listen on port 5240: EADDRINUSE" });
  });

  it("lists LAN addresses without loopback", () => {
    for (const url of lanUrls(7000)) {
      expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:7000$/);
      expect(url.startsWith("http://127.")).toBe(false);
    }
  });
});

describe("remote clients through the router", () => {
  const router = new Router();
  let quits = 0;
  registerRoutes(router, {} as AppServices, () => void quits++);
  let rcookie = "";

  beforeEach(() => {
    reset();
    startRemoteAccess(fakeServe);
    authService.acceptTerms();
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5250 });
    rcookie = `${sessionCookieName()}=${authService.login(PIN, "remote")}`;
  });

  afterEach(() => {
    reset();
  });

  type Opts = { cookie?: string | null; local?: boolean; ip?: string; host?: string };

  async function call(method: string, path: string, body?: unknown, o: Opts = {}) {
    const host = o.host ?? (o.local ? "127.0.0.1:4000" : "192.168.1.10:5250");
    const headers: Record<string, string> = { host };
    const c = o.cookie === undefined ? rcookie : o.cookie;
    if (c) headers.cookie = c;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = o.local
      ? await router.handle(new Request(`http://${host}${path}`, init), "127.0.0.1")
      : await router.handle(new Request(`http://${host}${path}`, init), o.ip ?? "192.168.1.20", false);
    expect(res).not.toBeNull();
    const text = await res!.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res!.status, body: (text ? JSON.parse(text) : null) as any, res: res! };
  }

  it("refuses every remote request while the listener is off", async () => {
    stopRemoteAccess();
    const res = await call("GET", "/api/health", undefined, { cookie: null });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Remote connections are disabled on this Portfolio");
  });

  it("needs a session for remote requests once the listener is on", async () => {
    expect((await call("GET", "/api/health", undefined, { cookie: null })).status).toBe(200);
    const anon = await call("GET", "/api/portfolios", undefined, { cookie: null });
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe("Session cookie is missing");
    expect((await call("GET", "/api/portfolios")).status).toBe(200);
  });

  it("logs in remotely with a one-day cookie and locks after five wrong PINs", async () => {
    try {
      const ok = await call("POST", "/api/auth/login", { pin: PIN }, { cookie: null });
      expect(ok.status).toBe(200);
      expect(ok.res.headers.getSetCookie()[0]).toContain("Max-Age=86400");
      for (let i = 0; i < 5; i++) {
        const wrong = await call("POST", "/api/auth/login", { pin: WRONG }, { cookie: null });
        expect(wrong.status).toBe(401);
        expect(wrong.body.message).toBe("Wrong PIN");
      }
      const locked = await call("POST", "/api/auth/login", { pin: PIN }, { cookie: null });
      expect(locked.status).toBe(401);
      expect(String(locked.body.message).startsWith("Too many attempts")).toBe(true);
      expect(() => authService.login(PIN, "local")).not.toThrow();
    } finally {
      getDatabase().run("DELETE FROM kv_entries WHERE key LIKE 'rate-limit:pin%'");
    }
  });

  it("keeps desktop-only routes away from remote sessions", async () => {
    const cases: [string, string, unknown, string][] = [
      ["GET", "/api/host/remote-access", undefined, "Remote access control is only available from the desktop window"],
      ["PATCH", "/api/host/remote-access", {}, "Remote access control is only available from the desktop window"],
      ["GET", "/api/host/mcp", undefined, "The MCP server setting is only available from the desktop window"],
      ["PATCH", "/api/host/mcp", {}, "The MCP server setting is only available from the desktop window"],
      ["POST", "/api/host/mcp/token", undefined, "The MCP server setting is only available from the desktop window"],
      ["POST", "/api/app/backup", undefined, "Backing up the database is only available from the desktop window"],
      ["POST", "/api/files/save", { fileName: "a.txt", content: "x" }, "Saving to the Downloads folder is only available from the desktop window"],
      ["POST", "/api/files/reveal", { filePath: "/tmp" }, "Revealing a file is only available from the desktop window"],
      ["POST", "/api/app/quit", undefined, "Quitting is only available from the desktop window"],
      ["POST", "/api/llm/openrouter/connect", undefined, "Connecting OpenRouter is only available from the desktop window"],
    ];
    for (const [method, path, body, message] of cases) {
      const res = await call(method, path, body);
      expect({ path, status: res.status, message: res.body?.message }).toEqual({ path, status: 403, message });
    }
    const callback = await call("GET", "/api/llm/openrouter/callback/anything?code=x", undefined, { cookie: null });
    expect(callback.status).toBe(403);
    expect(callback.body.message).toBe("The OpenRouter sign-in completes only on this computer");
    await Bun.sleep(80);
    expect(quits).toBe(0);
  });

  it("treats this machine on the LAN port as remote", async () => {
    const res = await call("POST", "/api/app/quit", undefined, { ip: "127.0.0.1", host: "127.0.0.1:5250" });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Quitting is only available from the desktop window");
    await Bun.sleep(80);
    expect(quits).toBe(0);
  });

  it("hides local paths from a remote client", async () => {
    const { status, body } = await call("GET", "/api/app/info");
    expect(status).toBe(200);
    expect(body.isLocalClient).toBe(false);
    expect("paths" in body).toBe(false);
  });

  it("refuses internal targets from a remote session", async () => {
    const message = "A server on this computer or the local network can be set only from the desktop window";
    const before = JSON.stringify(loadConfig());
    const cases: [string, string, unknown][] = [
      ["PATCH", "/api/config", { gotifyUrl: "http://10.0.0.5:8080" }],
      ["PATCH", "/api/config", { ntfyUrl: "http://192.168.1.1/x" }],
      ["PATCH", "/api/config", { llmBaseUrls: { "openai-compatible": "http://169.254.169.254/" } }],
      ["POST", "/api/llm/test", { baseUrl: "http://127.0.0.1:6379" }],
      ["POST", "/api/llm/models", { baseUrl: "http://[::1]:11434" }],
      ["POST", "/api/metrics/preview", { url: "http://127.0.0.1:9999/m.wasm" }],
      ["POST", "/api/integrations/gotify/test", { url: "http://192.168.1.5:8080" }],
    ];
    for (const [method, path, body] of cases) {
      const res = await call(method, path, body);
      expect({ path, body, status: res.status, message: res.body?.message }).toEqual({ path, body, status: 403, message });
      expect(JSON.stringify(loadConfig())).toBe(before);
    }
    expect((await call("PATCH", "/api/config", { gotifyUrl: "https://1.1.1.1" })).status).toBe(200);
    expect((await call("PATCH", "/api/config", { llmBaseUrl: "http://127.0.0.1:1234/v1" })).status).toBe(200);
    saveConfig({ ...loadConfig(), gotifyUrl: original.gotifyUrl, llmBaseUrl: original.llmBaseUrl });
  });

  it("turns remote access off when the PIN is removed", async () => {
    const local = `${sessionCookieName()}=${authService.login(PIN)}`;
    const res = await call("DELETE", "/api/auth/pin", { currentPin: PIN }, { local: true, cookie: local });
    expect(res.body).toEqual({ pinEnabled: false });
    expect(isRemoteListening()).toBe(false);
    expect(loadConfig().allowRemoteConnections).toBe(false);
    expect((await call("GET", "/api/health", undefined, { cookie: null })).status).toBe(403);
  });

  it("revokes remote sessions when the PIN changes", async () => {
    const local = `${sessionCookieName()}=${authService.login(PIN)}`;
    const change = await call("PUT", "/api/auth/pin", { pin: "111111", currentPin: PIN }, { local: true, cookie: local });
    expect(change.status).toBe(200);
    const res = await call("GET", "/api/portfolios");
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid or expired session");
  });
});
