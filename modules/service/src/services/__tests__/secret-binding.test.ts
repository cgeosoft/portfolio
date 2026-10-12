import { describe, it, expect, afterEach } from "bun:test";
import { SECRET_MASK } from "portfolio-shared/config-types";
import { isSameServer, loadConfig, requestSecret, saveConfig, unmaskUpdates, updateConfig } from "../../config.js";
import { LlmService } from "../llm.js";
import { sendGotify } from "../gotify.js";

const original = loadConfig();
afterEach(() => saveConfig({ ...original }));

describe("isSameServer", () => {
  it("compares scheme, host and port, not the path", () => {
    expect(isSameServer("https://api.openai.com/v1", "https://api.openai.com/v1/")).toBe(true);
    expect(isSameServer("https://api.openai.com/v2", "https://api.openai.com/v1")).toBe(true);
    expect(isSameServer("https://attacker.example/v1", "https://api.openai.com/v1")).toBe(false);
    expect(isSameServer("http://api.openai.com/v1", "https://api.openai.com/v1")).toBe(false);
    expect(isSameServer("http://127.0.0.1:8081", "http://127.0.0.1:8080")).toBe(false);
    expect(isSameServer("", "https://api.openai.com/v1")).toBe(false);
    expect(isSameServer("not a url", "https://api.openai.com/v1")).toBe(false);
  });

  it("reads SECRET_MASK in a request as the stored secret, decided later", () => {
    expect(requestSecret(SECRET_MASK)).toBeUndefined();
    expect(requestSecret("sk-new")).toBe("sk-new");
  });
});

describe("stored LLM key", () => {
  const service = new LlmService();
  const store = () =>
    updateConfig({
      llmProvider: "openai-compatible",
      llmBaseUrl: "https://api.openai.com/v1",
      llmBaseUrls: { "openai-compatible": "https://api.openai.com/v1" },
      llmApiKey: "sk-stored",
      llmApiKeys: { "openai-compatible": "sk-stored" },
    });

  it("goes to the stored server", () => {
    store();
    expect(service.resolve({ provider: "openai-compatible" }).apiKey).toBe("sk-stored");
    expect(service.resolve({ provider: "openai-compatible", baseUrl: "https://api.openai.com/v1/" }).apiKey).toBe("sk-stored");
  });

  it("never goes to a server a request names", () => {
    store();
    const target = service.resolve({ provider: "openai-compatible", baseUrl: "https://attacker.example/v1" });
    expect(target.baseUrl).toBe("https://attacker.example/v1");
    expect(target.apiKey).toBe("");
    expect(service.resolve({ provider: "openai-compatible", baseUrl: "https://attacker.example/v1", apiKey: "sk-typed" }).apiKey).toBe("sk-typed");
  });

  it("is cleared when Settings points the provider at another server without a new key", () => {
    store();
    const out = unmaskUpdates({ llmBaseUrl: "https://api.groq.com/openai/v1", llmBaseUrls: { "openai-compatible": "https://api.groq.com/openai/v1" } });
    expect(out.llmApiKeys?.["openai-compatible"]).toBe("");
    expect(out.llmApiKey).toBe("");
  });

  it("stays when the server is the same or the update brings a new key", () => {
    store();
    const same = unmaskUpdates({ llmBaseUrl: "https://api.openai.com/v1/", llmBaseUrls: { "openai-compatible": "https://api.openai.com/v1/" } });
    expect(same.llmApiKeys).toBeUndefined();
    expect(same.llmApiKey).toBeUndefined();
    const withKey = unmaskUpdates({ llmBaseUrls: { "openai-compatible": "https://api.groq.com/openai/v1" }, llmApiKeys: { "openai-compatible": "gsk-new" } });
    expect(withKey.llmApiKeys?.["openai-compatible"]).toBe("gsk-new");
  });
});

describe("stored push tokens", () => {
  it("are not sent to a Gotify server a request names", async () => {
    updateConfig({ gotifyUrl: "https://gotify.home", gotifyToken: "stored-token" });
    const res = await sendGotify({ title: "t", message: "m" }, { url: "https://attacker.example" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("application token");
  });

  it("are cleared when Settings moves Gotify or ntfy to another server", () => {
    updateConfig({ gotifyUrl: "https://gotify.home", gotifyToken: "g", ntfyUrl: "https://ntfy.home", ntfyToken: "n" });
    const out = unmaskUpdates({ gotifyUrl: "https://gotify.example", ntfyUrl: "https://ntfy.example" });
    expect(out.gotifyToken).toBe("");
    expect(out.ntfyToken).toBe("");
    const same = unmaskUpdates({ gotifyUrl: "https://gotify.home/", ntfyUrl: "https://ntfy.home" });
    expect(same.gotifyToken).toBeUndefined();
    expect(same.ntfyToken).toBeUndefined();
  });
});
