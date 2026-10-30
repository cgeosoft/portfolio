/**
 * Settings store: defaults, row encoding, merges, normalization, legacy LLM provider
 * migration and secret masking. Each case runs on its own empty database.
 * Never passes startWithBoot to updateConfig: that writes the real autostart file.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECRET_MASK, DEFAULT_DATA_PROVIDER_ROUTING } from "portfolio-shared/config-types";
import { DATA_DIR, setDataDirForTests } from "../../paths";
import { getDatabase, closeDatabase } from "../../db/database";
import {
  CONFIG_KEYS,
  loadConfig,
  saveConfig,
  updateConfig,
  maskSecrets,
  unmaskSecret,
  unmaskUpdates,
  isSameServer,
  type DesktopConfig,
} from "../../config";

/** Points the service at an empty data dir; `restore()` goes back to the shared one. */
function useFreshDataDir(prefix = "portfolio-iso-"): { dir: string; restore: () => void } {
  const previous = DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  setDataDirForTests(dir);
  closeDatabase();
  saveConfig({} as DesktopConfig);
  return {
    dir,
    restore: () => {
      closeDatabase();
      setDataDirForTests(previous);
      saveConfig({} as DesktopConfig);
    },
  };
}

const rows = (): Record<string, string> =>
  Object.fromEntries(
    (getDatabase().query("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  );

/** Writes a raw TEXT row and drops the config cache. */
function rawRow(key: string, value: string): void {
  getDatabase().query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  saveConfig({} as DesktopConfig);
}

let env: ReturnType<typeof useFreshDataDir>;
beforeEach(() => {
  env = useFreshDataDir();
});
afterEach(() => env.restore());

describe("defaults and storage", () => {
  it("returns the defaults on an empty table", () => {
    const { deviceId: _deviceId, ...cfg } = loadConfig();
    expect(cfg).toEqual({
      setupCompleted: false,
      telemetryEnabled: false,
      baseCurrency: "EUR",
      hideCurrencyValues: false,
      llmProvider: "",
      llmModel: "",
      llmApiKey: "",
      llmBaseUrl: "",
      llmTemperature: 0.3,
      llmApiKeys: {},
      llmBaseUrls: {},
      llmModels: {},
      finnhubApiKey: "",
      fmpApiKey: "",
      dataProviderRouting: DEFAULT_DATA_PROVIDER_ROUTING,
      marketQuotesInterval: 15,
      startWithBoot: false,
      skipReportIntro: false,
      checkForUpdates: true,
      zoomLevel: 1,
      theme: "dark",
      language: "en",
      allowRemoteConnections: false,
      remotePort: 5130,
      mcpEnabled: false,
      mcpPort: 5131,
      closeToTray: true,
      gotifyUrl: "",
      gotifyToken: "",
      gotifyPriority: 5,
      ntfyUrl: "https://ntfy.sh",
      ntfyTopic: "",
      ntfyToken: "",
      ntfyPriority: 3,
      dailyBriefEnabled: false,
      dailyBriefTime: "08:00",
      dailyBriefDays: "weekdays",
      dailyBriefPortfolioId: "",
      weeklyAnalysisEnabled: false,
      weeklyAnalysisDay: 6,
      weeklyAnalysisTime: "09:00",
      weeklyAnalysisPortfolioId: "",
      eventAlertsEnabled: false,
      eventAlertsTime: "18:00",
      eventAlertsPortfolioId: "",
      benchmarkSymbol: "^GSPC",
      chartRange: "1y",
    } as unknown as Omit<DesktopConfig, "deviceId">);
    const all = cfg as Record<string, unknown>;
    for (const key of ["lastQuotesSync", "lastUpdateCheck", "dismissedUpdateVersion", "dailyBriefLastRun", "weeklyAnalysisLastRun", "eventAlertsLastRun"]) {
      expect(all[key]).toBeUndefined();
    }
    const routing = DEFAULT_DATA_PROVIDER_ROUTING as unknown as Record<string, string>;
    expect(Object.keys(routing).length).toBe(15);
    for (const [k, v] of Object.entries(routing)) expect(v).toBe(k === "etfAssetClasses" ? "yahoo" : "fmp");
  });

  it("creates a stable deviceId and replaces an empty one", () => {
    const id = loadConfig().deviceId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows().deviceId).toBe(id);
    expect(loadConfig().deviceId).toBe(id);
    rawRow("deviceId", "");
    const fresh = loadConfig().deviceId;
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows().deviceId).toBe(fresh);
  });

  it("stores only the deviceId row after the first load", () => {
    loadConfig();
    expect(Object.keys(rows())).toEqual(["deviceId"]);
  });

  it("lists 54 config keys", () => {
    expect(CONFIG_KEYS.size).toBe(54);
    expect(CONFIG_KEYS.has("deviceId")).toBe(true);
    expect(CONFIG_KEYS.has("zoomLevel")).toBe(true);
    expect(CONFIG_KEYS.has("windowState")).toBe(false);
  });

  it("stores strings as text and everything else as JSON", () => {
    updateConfig({ baseCurrency: "USD", zoomLevel: 1.25, telemetryEnabled: true, llmModels: { x: "m" } });
    const r = rows();
    expect(r.baseCurrency).toBe("USD");
    expect(r.zoomLevel).toBe("1.25");
    expect(r.telemetryEnabled).toBe("true");
    expect(r.llmModels).toBe('{"x":"m"}');
  });

  it("decodes hand-written rows", () => {
    rawRow("zoomLevel", "{bad");
    rawRow("marketQuotesInterval", "30");
    rawRow("telemetryEnabled", "true");
    rawRow("baseCurrency", '"USD"');
    const cfg = loadConfig();
    expect(cfg.zoomLevel).toBe(1);
    expect(cfg.marketQuotesInterval).toBe(30);
    expect(cfg.telemetryEnabled).toBe(true);
    expect(cfg.baseCurrency).toBe('"USD"');
  });

  it("coerces a string number for a numeric key through JSON", () => {
    updateConfig({ zoomLevel: "1.5" } as any);
    expect(rows().zoomLevel).toBe("1.5");
    expect(loadConfig().zoomLevel).toBe(1.5);
  });

  it("drops retired keys", () => {
    updateConfig({ baseCurrency: "USD", windowState: { x: 1 }, lastImportDirectory: "/x", webpageUrl: "u", hideSponsorBanners: true } as any);
    expect(Object.keys(rows()).sort()).toEqual(["baseCurrency", "deviceId"]);
  });

  it("deletes a row when the value is undefined", () => {
    updateConfig({ llmModel: "m" });
    expect(rows().llmModel).toBe("m");
    updateConfig({ llmModel: undefined });
    expect("llmModel" in rows()).toBe(false);
    expect(loadConfig().llmModel).toBe("");
  });
});

describe("merges", () => {
  it("merges the per-provider records", () => {
    for (const key of ["llmApiKeys", "llmBaseUrls", "llmModels"] as const) {
      updateConfig({ [key]: { a: "1" } } as any);
      updateConfig({ [key]: { b: "2" } } as any);
      expect(loadConfig()[key]).toEqual({ a: "1", b: "2" });
    }
  });

  it("merges data provider routing with the defaults", () => {
    updateConfig({ dataProviderRouting: { quotes: "yahoo" } as any });
    updateConfig({ dataProviderRouting: { news: "finnhub" } as any });
    const expected = { ...DEFAULT_DATA_PROVIDER_ROUTING, quotes: "yahoo", news: "finnhub" };
    expect(loadConfig().dataProviderRouting).toEqual(expected as any);
    const stored = JSON.parse(rows().dataProviderRouting);
    expect(Object.keys(stored).length).toBe(15);
    expect(stored).toEqual(expected);
  });

  it("loads a stored partial routing over the defaults", () => {
    rawRow("dataProviderRouting", '{"charts":"yahoo"}');
    expect(loadConfig().dataProviderRouting).toEqual({ ...DEFAULT_DATA_PROVIDER_ROUTING, charts: "yahoo" } as any);
  });
});

describe("normalization", () => {
  it("replaces out-of-range values with defaults", () => {
    updateConfig({
      remotePort: 80,
      mcpPort: 70000,
      theme: "neon",
      language: "xx",
      gotifyPriority: 11,
      ntfyPriority: 0,
      ntfyUrl: "  ",
      dailyBriefTime: "24:00",
      dailyBriefDays: "monthly",
      weeklyAnalysisTime: "9:00",
      weeklyAnalysisDay: 7,
      zoomLevel: 0.2,
    } as any);
    const cfg = loadConfig();
    expect(cfg.remotePort).toBe(5130);
    expect(cfg.mcpPort).toBe(5131);
    expect(cfg.theme).toBe("dark");
    expect(cfg.language).toBe("en");
    expect(cfg.gotifyPriority).toBe(5);
    expect(cfg.ntfyPriority).toBe(3);
    expect(cfg.ntfyUrl).toBe("https://ntfy.sh");
    expect(cfg.dailyBriefTime).toBe("08:00");
    expect(cfg.dailyBriefDays).toBe("weekdays");
    expect(cfg.weeklyAnalysisTime).toBe("09:00");
    expect(cfg.weeklyAnalysisDay).toBe(6);
    expect(cfg.zoomLevel).toBe(1);
  });

  it("rejects a fractional port and a null zoom", () => {
    updateConfig({ remotePort: 5000.5 });
    expect(loadConfig().remotePort).toBe(5130);
    rawRow("zoomLevel", "null");
    expect(loadConfig().zoomLevel).toBe(1);
  });

  it("keeps boundary values", () => {
    updateConfig({
      remotePort: 1024,
      mcpPort: 65535,
      theme: "system",
      language: "el",
      gotifyPriority: 0,
      ntfyPriority: 5,
      dailyBriefTime: "23:59",
      dailyBriefDays: "daily",
      weeklyAnalysisTime: "00:00",
      weeklyAnalysisDay: 0,
      zoomLevel: 5,
    } as any);
    const cfg = loadConfig();
    expect(cfg.remotePort).toBe(1024);
    expect(cfg.mcpPort).toBe(65535);
    expect(cfg.theme).toBe("system");
    expect(cfg.language).toBe("el");
    expect(cfg.gotifyPriority).toBe(0);
    expect(cfg.ntfyPriority).toBe(5);
    expect(cfg.dailyBriefTime).toBe("23:59");
    expect(cfg.dailyBriefDays).toBe("daily");
    expect(cfg.weeklyAnalysisTime).toBe("00:00");
    expect(cfg.weeklyAnalysisDay).toBe(0);
    expect(cfg.zoomLevel).toBe(5);
    updateConfig({ zoomLevel: 0.25, theme: "light" } as any);
    expect(loadConfig().zoomLevel).toBe(0.25);
    expect(loadConfig().theme).toBe("light");
  });
});

describe("legacy LLM provider migration", () => {
  it("moves llamacpp to openai-compatible with its server URL", () => {
    updateConfig({ llmProvider: "llamacpp", llamacppServerUrl: "http://10.0.0.5:8080", llmModel: "qwen" } as any);
    const cfg = loadConfig();
    expect(cfg.llmProvider).toBe("openai-compatible");
    expect(cfg.llmBaseUrl).toBe("http://10.0.0.5:8080");
    expect(cfg.llmApiKey).toBe("");
    expect(cfg.llmModel).toBe("qwen");
    expect(cfg.llmBaseUrls).toEqual({ "openai-compatible": "http://10.0.0.5:8080" });
    expect(cfg.llmApiKeys).toEqual({ "openai-compatible": "" });
    expect(cfg.llmModels).toEqual({ "openai-compatible": "qwen" });
    expect("llamacppServerUrl" in rows()).toBe(false);
    expect("llamacppServerUrl" in cfg).toBe(false);
    expect(rows().llmProvider).toBe("openai-compatible");
  });

  it("moves groq to openai-compatible with its key and model", () => {
    updateConfig({ llmProvider: "groq", llmApiKeys: { groq: "gk" }, llmModels: { groq: "m1" } } as any);
    const cfg = loadConfig();
    expect(cfg.llmProvider).toBe("openai-compatible");
    expect(cfg.llmBaseUrl).toBe("https://api.groq.com/openai/v1");
    expect(cfg.llmApiKey).toBe("gk");
    expect(cfg.llmModel).toBe("m1");
    expect(cfg.llmApiKeys).toEqual({ groq: "gk", "openai-compatible": "gk" });
    expect(cfg.llmModels).toEqual({ groq: "m1", "openai-compatible": "m1" });
  });

  it("only deletes the llamacppServerUrl row for a current provider", () => {
    updateConfig({ llmProvider: "claude-cli", llamacppServerUrl: "x" } as any);
    const cfg = loadConfig();
    expect(cfg.llmProvider).toBe("claude-cli");
    expect(cfg.llmBaseUrl).toBe("");
    expect(cfg.llmApiKey).toBe("");
    expect(cfg.llmModel).toBe("");
    expect(Object.keys(rows()).sort()).toEqual(["deviceId", "llmProvider"]);
  });

  it("trims the per-provider base URL of llamacpp-server", () => {
    updateConfig({ llmProvider: "llamacpp-server", llmBaseUrls: { llamacpp: " http://h:1 " } } as any);
    const cfg = loadConfig();
    expect(cfg.llmBaseUrl).toBe("http://h:1");
    expect(cfg.llmBaseUrls).toEqual({ llamacpp: " http://h:1 ", "openai-compatible": "http://h:1" });
  });

  it("does not treat inherited object keys as legacy providers", () => {
    updateConfig({ llmProvider: "constructor" } as any);
    expect(loadConfig().llmProvider).toBe("constructor");
  });

  it("fills the openai base URL and trims the key", () => {
    updateConfig({ llmProvider: "openai", llmApiKey: " sk ", llmBaseUrl: "" } as any);
    const cfg = loadConfig();
    expect(cfg.llmBaseUrl).toBe("https://api.openai.com/v1");
    expect(cfg.llmApiKey).toBe("sk");
  });
});

describe("secrets", () => {
  it("masks set secrets without mutating the input", () => {
    const input = {
      ...loadConfig(),
      llmApiKey: "a",
      finnhubApiKey: "",
      fmpApiKey: "f",
      gotifyToken: "g",
      ntfyToken: undefined,
      llmApiKeys: { x: "1", y: "" },
    } as unknown as DesktopConfig;
    const before = structuredClone(input);
    const masked = maskSecrets(input);
    expect(SECRET_MASK).toBe("********");
    expect(masked.llmApiKey).toBe(SECRET_MASK);
    expect(masked.finnhubApiKey).toBe("");
    expect(masked.fmpApiKey).toBe("********");
    expect(masked.gotifyToken).toBe("********");
    expect(masked.ntfyToken).toBe("");
    expect(masked.llmApiKeys).toEqual({ x: "********", y: "" });
    const secretKeys = new Set(["llmApiKey", "finnhubApiKey", "fmpApiKey", "gotifyToken", "ntfyToken", "llmApiKeys"]);
    for (const [k, v] of Object.entries(input)) {
      if (!secretKeys.has(k)) expect((masked as unknown as Record<string, unknown>)[k]).toEqual(v);
    }
    expect(input).toEqual(before);
  });

  it("unmasks a single value", () => {
    expect(unmaskSecret("********", "stored")).toBe("stored");
    expect(unmaskSecret("new", "stored")).toBe("new");
    expect(unmaskSecret(undefined, "s")).toBeUndefined();
  });

  it("unmasks updates against the stored secrets", () => {
    saveConfig({
      ...loadConfig(),
      finnhubApiKey: "fh",
      fmpApiKey: "fm",
      llmProvider: "openai-compatible",
      llmApiKeys: { "openai-compatible": "k1" },
      llmApiKey: "k1",
    } as DesktopConfig);
    expect(unmaskUpdates({ finnhubApiKey: SECRET_MASK, fmpApiKey: SECRET_MASK, gotifyToken: SECRET_MASK, ntfyToken: SECRET_MASK })).toEqual({});
    expect(unmaskUpdates({ llmApiKeys: { "openai-compatible": SECRET_MASK, other: SECRET_MASK } }).llmApiKeys).toEqual({
      "openai-compatible": "k1",
      other: "",
    });
    expect(unmaskUpdates({ llmApiKey: SECRET_MASK }).llmApiKey).toBe("k1");
    expect(unmaskUpdates({ baseCurrency: "USD" })).toEqual({ baseCurrency: "USD" });
  });

  it("compares servers by origin and path", () => {
    expect(isSameServer("http://a:1/v1", "http://a:1/")).toBe(true);
    expect(isSameServer("", "http://a")).toBe(false);
    expect(isSameServer("http://a", undefined)).toBe(false);
    expect(isSameServer("not a url", "not a url/")).toBe(true);
    expect(isSameServer("not a url", "other")).toBe(false);
    expect(isSameServer("http://A:80", "http://a")).toBe(true);
  });
});

describe("suspected bugs", () => {
  it("does not leak a mutation of a returned config into the next load", () => {
    const c = loadConfig();
    (c.llmApiKeys as Record<string, string>).leak = "x";
    (c.llmBaseUrls as Record<string, string>).leak = "x";
    (c.llmModels as Record<string, string>).leak = "x";
    const next = loadConfig();
    expect("leak" in next.llmApiKeys).toBe(false);
    expect("leak" in next.llmBaseUrls).toBe(false);
    expect("leak" in (next.llmModels ?? {})).toBe(false);
  });

  it("returns the same normalized values from updateConfig as from loadConfig", () => {
    const returned = updateConfig({ zoomLevel: 99, theme: "neon" as any, remotePort: 80 });
    expect(returned.zoomLevel).toBe(1);
    expect(returned.theme).toBe("dark");
    expect(returned.remotePort).toBe(5130);
    const loaded = loadConfig();
    expect(loaded.zoomLevel).toBe(1);
    expect(loaded.theme).toBe("dark");
    expect(loaded.remotePort).toBe(5130);
  });
});
