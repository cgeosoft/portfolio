/** Contract checks on the constant tables in config-types, llm-defaults and brand. */
import { describe, expect, it } from "bun:test";
import {
  BENCHMARK_OPTIONS,
  DATA_PROVIDER_LABELS,
  DEFAULT_BENCHMARK_SYMBOL,
  DEFAULT_DATA_PROVIDER_ROUTING,
  DEFAULT_GOTIFY_PRIORITY,
  DEFAULT_MCP_PORT,
  DEFAULT_NTFY_PRIORITY,
  DEFAULT_NTFY_URL,
  DEFAULT_REMOTE_PORT,
  PROTECTED_CONFIG_KEYS,
  SECRET_MASK,
} from "../config-types";
import { CLI_PROVIDER_MODELS, CLI_PROVIDER_NAMES, CLAUDE_CLI_MODELS, CODEX_CLI_MODELS, DEFAULT_OPENAI_COMPATIBLE_URL } from "../llm-defaults";
import { APP_ID, APP_NAME, GITHUB_URL, RELEASE_MANIFEST_URL, VENDOR_URL, WEBPAGE_URL } from "../brand";

describe("config-types", () => {
  it("routes every data kind to a known provider", () => {
    const routing = DEFAULT_DATA_PROVIDER_ROUTING as Record<string, string>;
    const providers = Object.keys(DATA_PROVIDER_LABELS);
    for (const v of Object.values(routing)) expect(providers).toContain(v);
    expect(Object.keys(routing).sort()).toEqual(
      [
        "quotes",
        "news",
        "charts",
        "fx",
        "fundamentals",
        "search",
        "companyNews",
        "dividends",
        "splits",
        "earnings",
        "analyst",
        "etfInfo",
        "etfHoldings",
        "etfSectors",
        "etfAssetClasses",
      ].sort(),
    );
    for (const [k, v] of Object.entries(routing)) expect({ k, v }).toEqual({ k, v: k === "etfAssetClasses" ? "yahoo" : "fmp" });
  });

  it("offers the default benchmark", () => {
    const symbols = BENCHMARK_OPTIONS.map((b) => b.symbol);
    expect(DEFAULT_BENCHMARK_SYMBOL).toBe("^GSPC");
    expect(symbols).toContain(DEFAULT_BENCHMARK_SYMBOL);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const b of BENCHMARK_OPTIONS) expect(b.label.length).toBeGreaterThan(0);
  });

  it("uses distinct unprivileged default ports", () => {
    expect(DEFAULT_REMOTE_PORT).toBe(5130);
    expect(DEFAULT_MCP_PORT).toBe(5131);
    for (const port of [DEFAULT_REMOTE_PORT, DEFAULT_MCP_PORT]) {
      expect(port).toBeGreaterThanOrEqual(1024);
      expect(port).toBeLessThanOrEqual(65535);
    }
  });

  it("keeps notification defaults in range", () => {
    expect(DEFAULT_GOTIFY_PRIORITY).toBe(5);
    expect(DEFAULT_GOTIFY_PRIORITY).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_GOTIFY_PRIORITY).toBeLessThanOrEqual(10);
    expect(DEFAULT_NTFY_PRIORITY).toBe(3);
    expect(DEFAULT_NTFY_PRIORITY).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_NTFY_PRIORITY).toBeLessThanOrEqual(5);
    expect(new URL(DEFAULT_NTFY_URL).protocol).toBe("https:");
  });

  it("protects the remote and identity keys", () => {
    for (const k of ["remotePort", "allowRemoteConnections", "mcpEnabled", "mcpPort", "deviceId"]) {
      expect(PROTECTED_CONFIG_KEYS as readonly string[]).toContain(k);
    }
    expect(new Set(PROTECTED_CONFIG_KEYS).size).toBe(PROTECTED_CONFIG_KEYS.length);
  });

  it("masks secrets with 8 asterisks", () => {
    expect(SECRET_MASK).toBe("********");
  });
});

describe("llm-defaults", () => {
  it("lists models for every CLI provider", () => {
    expect(Object.keys(CLI_PROVIDER_MODELS).sort()).toEqual(Object.keys(CLI_PROVIDER_NAMES).sort());
    expect(Object.keys(CLI_PROVIDER_MODELS).sort()).toEqual(["claude-cli", "codex-cli"]);
    expect(CLI_PROVIDER_MODELS["claude-cli"]).toBe(CLAUDE_CLI_MODELS);
    expect(CLI_PROVIDER_MODELS["codex-cli"]).toBe(CODEX_CLI_MODELS);
    for (const list of [CLAUDE_CLI_MODELS, CODEX_CLI_MODELS]) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
      for (const m of list) expect(m.length).toBeGreaterThan(0);
    }
    expect([...CLAUDE_CLI_MODELS]).toEqual(["sonnet", "opus", "haiku"]);
  });

  it("points the OpenAI-compatible default at a local server", () => {
    const u = new URL(DEFAULT_OPENAI_COMPATIBLE_URL);
    expect(u.hostname).toBe("127.0.0.1");
    expect(u.port).toBe("1234");
    expect(u.pathname).toBe("/v1");
  });
});

describe("brand", () => {
  it("derives the manifest URL and app id", () => {
    expect(RELEASE_MANIFEST_URL).toBe(`${WEBPAGE_URL}/releases/latest.json`);
    for (const url of [WEBPAGE_URL, VENDOR_URL, GITHUB_URL]) {
      expect(new URL(url).protocol).toBe("https:");
      expect(url.endsWith("/")).toBe(false);
    }
    expect(APP_ID).toBe(APP_NAME.toLowerCase());
    expect(APP_ID).toBe("portfolio");
  });
});
