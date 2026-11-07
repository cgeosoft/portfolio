/** Consent: the record, the migration prompt, the desktop-only rule and the routes. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { PRIVACY_NOTICE_VERSION } from "portfolio-shared/brand";
import { loadConfig, updateConfig } from "../../config";
import { getDatabase } from "../../db/database";
import { readConsentRecord, writeConsentRecord } from "../../db/privacy-consent.repo";
import { Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { authService, sessionCookieName } from "../auth";
import { setRemoteAccess, startRemoteAccess, stopRemoteAccess } from "../remote-access";
import type { AppServices } from "../container";
import { applyConsent, consentStatus, consentVersion, needsConsentPrompt, resetAnalyticsId, takeConsentChanges } from "../privacy-consent";

const PIN = "246810";
const DESKTOP_ONLY = /only available from the desktop window/;
const saved = loadConfig();
const router = new Router();
registerRoutes(router, {} as AppServices, () => {});
let cookie = "";
let remoteCookie = "";

function clearRecord(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key = 'privacy:consent'");
}

async function call(method: string, path: string, body: unknown, isLocal: boolean) {
  const host = isLocal ? "127.0.0.1:4000" : "192.168.1.10:5250";
  const headers: Record<string, string> = { host, cookie: isLocal ? cookie : remoteCookie };
  const res = await router.handle(new Request(`http://${host}${path}`, { method, headers, body: JSON.stringify(body) }), isLocal ? "127.0.0.1" : "192.168.1.20", isLocal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res!.status, body: (await res!.json()) as any };
}

beforeAll(() => {
  authService.acceptTerms();
});

beforeEach(() => {
  clearRecord();
  updateConfig({ setupCompleted: true, analyticsEnabled: false, errorReportingEnabled: false });
  cookie = `${sessionCookieName()}=${authService.login()}`;
});

afterAll(() => {
  clearRecord();
  updateConfig({ setupCompleted: saved.setupCompleted, analyticsEnabled: saved.analyticsEnabled, errorReportingEnabled: saved.errorReportingEnabled });
});

describe("applyConsent", () => {
  it("stores each option apart, with the time, the source and the notice version", () => {
    const record = applyConsent({ analytics: false, errorReporting: true }, "setup");
    expect(record.noticeVersion).toBe(PRIVACY_NOTICE_VERSION);
    expect(record.analytics).toMatchObject({ granted: false, source: "setup" });
    expect(record.errorReporting).toMatchObject({ granted: true, source: "setup" });
    expect(record.errorReporting.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readConsentRecord()).toEqual(record);
    expect(loadConfig().analyticsEnabled).toBe(false);
    expect(loadConfig().errorReportingEnabled).toBe(true);
  });

  it("records a no", () => {
    expect(applyConsent({ analytics: false, errorReporting: false }, "setup").analytics.granted).toBe(false);
    expect(readConsentRecord()?.analytics.source).toBe("setup");
  });

  it("leaves the other option and its history alone", () => {
    const first = applyConsent({ analytics: true, errorReporting: false }, "setup");
    const second = applyConsent({ errorReporting: true }, "settings");
    expect(second.analytics).toEqual(first.analytics);
    expect(second.errorReporting).toMatchObject({ granted: true, source: "settings" });
  });
});

describe("takeConsentChanges", () => {
  it("returns a real change and removes the keys from the update", () => {
    const update = { analyticsEnabled: true, zoomLevel: 1 };
    expect(takeConsentChanges(update)).toEqual({ analytics: true });
    expect(update).toEqual({ zoomLevel: 1 } as typeof update);
  });

  it("treats an equal value and a non-boolean as no change", () => {
    expect(takeConsentChanges({ analyticsEnabled: false, errorReportingEnabled: false })).toBeNull();
    expect(takeConsentChanges({ analyticsEnabled: "true" as unknown as boolean })).toBeNull();
  });
});

describe("prompt and version", () => {
  it("asks an install with no record, once", () => {
    expect(needsConsentPrompt()).toBe(true);
    expect(consentVersion()).toBe(0);
    applyConsent({ analytics: true, errorReporting: false }, "update-prompt");
    expect(needsConsentPrompt()).toBe(false);
    expect(consentVersion()).toBe(PRIVACY_NOTICE_VERSION);
  });

  it("does not ask before setup", () => {
    updateConfig({ setupCompleted: false });
    expect(needsConsentPrompt()).toBe(false);
  });

  it("asks again after a new notice version", () => {
    const record = applyConsent({ analytics: true, errorReporting: false }, "setup");
    writeConsentRecord({ ...record, noticeVersion: PRIVACY_NOTICE_VERSION - 1 });
    expect(needsConsentPrompt()).toBe(true);
  });

  it("ignores a broken record", () => {
    getDatabase().run("INSERT INTO kv_entries (key, value, expiresAt) VALUES ('privacy:consent', '{bad', NULL)");
    expect(readConsentRecord()).toBeNull();
    expect(needsConsentPrompt()).toBe(true);
  });
});

describe("status and analytics ID", () => {
  it("shows the analytics ID to the desktop window only", () => {
    expect(consentStatus(true)).toMatchObject({ canChange: true, analyticsId: loadConfig().deviceId });
    expect(consentStatus(false).canChange).toBe(false);
    expect(consentStatus(false).analyticsId).toBeUndefined();
  });

  it("replaces the ID on a reset", () => {
    const before = loadConfig().deviceId;
    expect(resetAnalyticsId()).not.toBe(before);
    expect(loadConfig().deviceId).not.toBe(before);
  });
});

describe("routes", () => {
  beforeEach(() => {
    startRemoteAccess(() => ({ stop: () => {} }));
    authService.setPin(PIN);
    setRemoteAccess({ enabled: true, port: 5250 });
    cookie = `${sessionCookieName()}=${authService.login(PIN, "local")}`;
    remoteCookie = `${sessionCookieName()}=${authService.login(PIN, "remote")}`;
  });

  afterEach(() => {
    stopRemoteAccess();
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:pinHash' OR key LIKE 'rate-limit:pin%'");
    updateConfig({ allowRemoteConnections: false, remotePort: saved.remotePort });
  });

  it("updates the record through PATCH /api/config", async () => {
    const res = await call("PATCH", "/api/config", { analyticsEnabled: true }, true);
    expect(res.status).toBe(200);
    expect(res.body.analyticsEnabled).toBe(true);
    expect(readConsentRecord()?.analytics).toMatchObject({ granted: true, source: "settings" });
  });

  it("refuses a privacy change from another device", async () => {
    const res = await call("PATCH", "/api/config", { errorReportingEnabled: true }, false);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(DESKTOP_ONLY);
    expect(loadConfig().errorReportingEnabled).toBe(false);
    expect(readConsentRecord()).toBeNull();
  });

  it("lets another device send the stored values with other settings", async () => {
    const res = await call("PATCH", "/api/config", { analyticsEnabled: false, zoomLevel: 1.1 }, false);
    expect(res.status).toBe(200);
  });

  it("saves the prompt answer from the desktop window only", async () => {
    const remote = await call("PUT", "/api/privacy/prompt-answer", { analytics: true, errorReporting: true }, false);
    expect(remote.status).toBe(403);
    expect(remote.body.message).toMatch(DESKTOP_ONLY);
    const res = await call("PUT", "/api/privacy/prompt-answer", { analytics: true, errorReporting: false }, true);
    expect(res.status).toBe(200);
    expect(res.body.needsPrompt).toBe(false);
    expect(readConsentRecord()?.analytics.source).toBe("update-prompt");
  });

  it("leaves both options off for a setup from another device", async () => {
    updateConfig({ setupCompleted: false });
    const res = await call("POST", "/api/setup/complete", { populateDemo: false, enableAnalytics: true, enableErrorReporting: true }, false);
    expect(res.status).toBe(200);
    expect(loadConfig().analyticsEnabled).toBe(false);
    expect(loadConfig().errorReportingEnabled).toBe(false);
  });

  it("keeps the choices when another device calls setup again", async () => {
    updateConfig({ setupCompleted: true, analyticsEnabled: true, errorReportingEnabled: true });
    const before = readConsentRecord();
    const res = await call("POST", "/api/setup/complete", { populateDemo: false }, false);
    expect(res.status).toBe(200);
    expect(loadConfig().analyticsEnabled).toBe(true);
    expect(loadConfig().errorReportingEnabled).toBe(true);
    expect(readConsentRecord()).toEqual(before);
    updateConfig({ analyticsEnabled: false, errorReportingEnabled: false });
  });

  it("refuses a reset of the analytics ID from another device", async () => {
    const res = await call("POST", "/api/privacy/reset-analytics-id", {}, false);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(DESKTOP_ONLY);
  });

  it("accepts a GUI error and refuses an unknown source", async () => {
    expect((await call("POST", "/api/app/error-report", { name: "TypeError", stack: "x", source: "window" }, true)).status).toBe(200);
    expect((await call("POST", "/api/app/error-report", { source: "other" }, true)).status).toBe(400);
  });
});
