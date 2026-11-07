/** Telemetry: no client without a key, event shape, shutdown, and a static scan of every capture call for private data. */
import { describe, it, expect, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowedProperties, analyticsProvider, TelemetryService } from "../telemetry.js";
import { loadConfig, updateConfig } from "../../config.js";

interface FakeClient {
  capture: (m: unknown) => void;
  shutdown: () => Promise<void>;
}

const savedEnabled = loadConfig().analyticsEnabled;
afterAll(() => {
  updateConfig({ analyticsEnabled: savedEnabled });
});

describe("TelemetryService", () => {
  it("creates no client in a checkout", async () => {
    updateConfig({ analyticsEnabled: true });
    try {
      const svc = new TelemetryService();
      svc.initialize();
      expect((svc as unknown as { client: unknown }).client).toBeNull();
      expect(() => svc.capture("x", { a: 1 })).not.toThrow();
      await svc.shutdown();
    } finally {
      updateConfig({ analyticsEnabled: false });
    }
  });

  it("forwards events with the device id", () => {
    const svc = new TelemetryService();
    svc.initialize();
    const sent: unknown[] = [];
    (svc as unknown as { client: FakeClient }).client = { capture: (m) => sent.push(m), shutdown: async () => {} };
    svc.capture("assistant_chat_sent", { provider: "openai-compatible" });
    const deviceId = loadConfig().deviceId;
    expect(sent[0]).toEqual({ distinctId: deviceId, event: "assistant_chat_sent", properties: { provider: "openai-compatible", consent_version: expect.any(Number) } });
    expect(deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("shuts the old client down on reinitialize", () => {
    const svc = new TelemetryService();
    svc.initialize();
    let shut = 0;
    (svc as unknown as { client: FakeClient }).client = { capture: () => {}, shutdown: async () => void shut++ };
    svc.reinitialize();
    expect(shut).toBe(1);
    expect((svc as unknown as { client: unknown }).client).toBeNull();
  });
});

describe("allowedProperties", () => {
  it("drops an event that is not on the list", () => {
    expect(allowedProperties("report_generated", { count: 1 })).toBeNull();
  });

  it("drops unknown keys and free text", () => {
    expect(allowedProperties("csv_imported", { count: 3, path: "/home/ann/a.csv" })).toEqual({ count: 3 });
    expect(allowedProperties("csv_imported", { count: "Acme broker" })).toEqual({});
    expect(allowedProperties("setup_completed", { demo: "free text" })).toEqual({});
  });

  it("maps a custom provider to the fixed value", () => {
    expect(allowedProperties("assistant_chat_sent", { provider: "https://my-server.example/v1" })).toEqual({ provider: "openai-compatible" });
  });
});

describe("analyticsProvider", () => {
  it("keeps a CLI id and hides any other provider name", () => {
    expect(analyticsProvider("claude-cli")).toBe("claude-cli");
    expect(analyticsProvider("https://my-server.example/v1")).toBe("openai-compatible");
  });
});

describe("telemetry privacy contract", () => {
  const root = join(import.meta.dir, "../..");
  const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: root })].filter((f) => !f.split(/[\\/]/).includes("__tests__"));
  const sources = files.map((f) => readFileSync(join(root, f), "utf-8"));
  const calls = sources.flatMap((src) =>
    [...src.matchAll(/telemetry\.capture\(\s*"([^"]+)"(?:\s*,\s*\{([^}]*)\})?\s*\)/g)].map((m) => ({ event: m[1]!, props: m[2] ?? "" })),
  );

  it("finds the capture calls", () => {
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });

  it("uses snake_case event names", () => {
    for (const c of calls) expect(c.event).toMatch(/^[a-z_]+$/);
  });

  it("sends only allowlisted property keys", () => {
    const allowed = ["count", "provider", "streaming", "demo"];
    for (const c of calls) {
      for (const m of c.props.matchAll(/(\w+)\s*:/g)) expect(allowed).toContain(m[1]!);
    }
  });

  it("never sends private data", () => {
    for (const c of calls) expect(c.props).not.toMatch(/value|balance|symbol|ticker|quantity|amount|name|email|portfolioId/i);
  });

  it("passes only object literals as properties", () => {
    for (const src of sources) expect(src).not.toMatch(/telemetry\.capture\(\s*"[^"]+"\s*,\s*[^{\s]/);
  });
});
