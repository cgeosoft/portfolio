import { describe, it, expect } from "bun:test";
import { LlmService } from "../llm.js";

describe("LlmService diagnostic and configuration", () => {
  const service = new LlmService();

  describe("testStep: config phase", () => {
    it("fails when model identifier is empty", async () => {
      const res = await service.testStep("config", {
        provider: "ollama",
        model: "",
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Model identifier cannot be empty");
    });

    it("fails when cloud provider has no API key", async () => {
      const res = await service.testStep("config", {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "",
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Openai requires an API key");
    });

    it("succeeds when cloud provider has API key", async () => {
      const res = await service.testStep("config", {
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        apiKey: "gsk_test_token",
      });
      expect(res.success).toBe(true);
    });

    it("succeeds for local provider without API key", async () => {
      const res = await service.testStep("config", {
        provider: "llamacpp-server",
        model: "qwen3-abliterated-14b-q4_k_m",
        baseUrl: "http://127.0.0.1:9100",
      });
      expect(res.success).toBe(true);
    });

    it("fails when local provider has invalid URL format", async () => {
      const res = await service.testStep("config", {
        provider: "ollama",
        model: "llama3.2:latest",
        baseUrl: "invalid://url with spaces",
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Invalid server URL format");
    });
  });

  describe("testStep: integrity phase", () => {
    it("fails when previous output is empty", async () => {
      const res = await service.testStep("integrity", {
        provider: "ollama",
        model: "llama3.2:latest",
        previousOutput: "",
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Empty inference response");
    });

    it("succeeds when previous output contains text", async () => {
      const res = await service.testStep("integrity", {
        provider: "ollama",
        model: "llama3.2:latest",
        previousOutput: "LLM connection verified",
      });
      expect(res.success).toBe(true);
      expect(res.output).toBe("LLM connection verified");
    });
  });
});
