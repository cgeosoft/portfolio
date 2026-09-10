import { describe, it, expect } from "bun:test";
import { LlmService, sanitizeLlmResponse } from "../llm.js";

describe("sanitizeLlmResponse: reasoning models", () => {
  it("keeps the answer that follows a closed thinking block", () => {
    const raw = "<think>\nWeighing the options.\n</think>\n\nLLM connection verified";
    expect(sanitizeLlmResponse(raw)).toBe("LLM connection verified");
  });

  it("keeps an answer that contains no further angle bracket", () => {
    expect(sanitizeLlmResponse("<think>reasoning</think> plain answer")).toBe("plain answer");
  });

  it("keeps an answer that itself contains angle brackets", () => {
    expect(sanitizeLlmResponse("<think>reasoning</think>a < b > c")).toBe("a < b > c");
  });

  it("strips nested thinking blocks", () => {
    const raw = "<think>outer<think>inner</think>still outer</think>answer";
    expect(sanitizeLlmResponse(raw)).toBe("answer");
  });

  it("returns empty when the thinking block was truncated", () => {
    expect(sanitizeLlmResponse("<think>cut off mid-thought")).toBe("");
  });
});

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
        model: "local-model",
        baseUrl: "http://127.0.0.1:8080",
      });
      expect(res.success).toBe(true);
    });

    it("succeeds for llamacpp without a model identifier", async () => {
      const res = await service.testStep("config", {
        provider: "llamacpp-server",
        model: "",
        baseUrl: "http://192.168.1.50:9000",
      });
      expect(res.success).toBe(true);
    });

    it("fails when a named-model provider has no model identifier", async () => {
      const res = await service.testStep("config", {
        provider: "ollama",
        model: "",
        baseUrl: "http://127.0.0.1:11434",
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Model identifier cannot be empty");
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

  describe("testStep: inference phase", () => {
    it("fails with a reasoning-specific message when the model only thinks", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "<think>Still reasoning when the budget ran out" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch;
      try {
        const res = await service.testStep("inference", {
          provider: "llamacpp-server",
          model: "qwen3",
          baseUrl: "http://127.0.0.1:8080",
        });
        expect(res.success).toBe(false);
        expect(res.message).toContain("reasoning but no answer");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("passes the answer on when the thinking block closes", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "<think>reasoning</think>\n\nLLM connection verified" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch;
      try {
        const res = await service.testStep("inference", {
          provider: "llamacpp-server",
          model: "qwen3",
          baseUrl: "http://127.0.0.1:8080",
        });
        expect(res.success).toBe(true);
        expect(res.output).toBe("LLM connection verified");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("recovers the reply from reasoning_content when content is empty", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "", reasoning_content: "thinking out loud" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch;
      try {
        const res = await service.testStep("inference", {
          provider: "llamacpp-server",
          model: "qwen3",
          baseUrl: "http://127.0.0.1:8080",
        });
        expect(res.success).toBe(false);
        expect(res.message).toContain("reasoning but no answer");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("llama.cpp model resolution", () => {
    it("sends the loaded model when the user pinned none", async () => {
      const originalFetch = globalThis.fetch;
      let chatBody: Record<string, unknown> | undefined;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const target = String(input);
        if (target.endsWith("/v1/models")) {
          return new Response(
            JSON.stringify({
              data: [
                { id: "gemma3-1b", status: { value: "unloaded" } },
                { id: "qwen3-14b", status: { value: "loaded" } },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        chatBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "LLM connection verified" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;
      try {
        const res = await service.testStep("inference", {
          provider: "llamacpp-server",
          model: "",
          baseUrl: "http://127.0.0.1:19101",
        });
        expect(res.success).toBe(true);
        expect(chatBody?.model).toBe("qwen3-14b");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("omits the model when the server cannot list any", async () => {
      const originalFetch = globalThis.fetch;
      let chatBody: Record<string, unknown> | undefined;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const target = String(input);
        if (target.endsWith("/v1/models")) throw new Error("connection refused");
        chatBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "LLM connection verified" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;
      try {
        const res = await service.testStep("inference", {
          provider: "llamacpp-server",
          model: "",
          baseUrl: "http://127.0.0.1:19102",
        });
        expect(res.success).toBe(true);
        expect(chatBody && "model" in chatBody).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
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
