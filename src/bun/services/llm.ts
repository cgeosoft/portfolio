/**
 * Multi-provider LLM client.
 * Ported from the NestJS service, removing DI decorators.
 */

import { loadConfig } from "../config.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
  isReport?: boolean;
}

export function sanitizeLlmResponse(text: string, isReport = false): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove all complete <think>...</think> blocks
  cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?<\/think\b[^>]*>/gi, "");

  // 2. If an orphaned closing </think> tag exists, strip everything before it
  if (/<\/think\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/^[\s\S]*?<\/think\b[^>]*>\s*/i, "");
  }

  // 3. If an unclosed <think> tag remains
  if (/<think\b[^>]*>/i.test(cleaned)) {
    const match = cleaned.match(/<think\b[^>]*>[\s\S]*?(?=(?:^|\n)(?:#+|1\.\s+\*\*))/i);
    if (match) {
      cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?(?=(?:^|\n)(?:#+|1\.\s+\*\*))/i, "");
    } else {
      cleaned = cleaned.replace(/<think\b[^>]*>/gi, "");
    }
  }

  // 4. Remove any remaining isolated <think> or </think> tags
  cleaned = cleaned.replace(/<\/?think\b[^>]*>/gi, "");

  cleaned = cleaned.trim();

  // 5. If leading garbage exists before the first header in reports, strip it
  if (isReport && !cleaned.startsWith("#") && !cleaned.startsWith("1.")) {
    const headerIdx = cleaned.search(/(?:^|\n)(?:#+|1\.\s+\*\*)/);
    if (headerIdx > 0) {
      const prefix = cleaned.slice(0, headerIdx).trim();
      if (prefix.length < 100 && !prefix.includes("\n\n")) {
        cleaned = cleaned.slice(headerIdx).trim();
      }
    }
  }

  return cleaned.trim();
}

export class LlmService {
  public async chat(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<string> {
    const provider = (options.provider || "llamacpp-server").toLowerCase().trim();
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 3000;
    const { apiKey, baseUrl } = options;

    console.log(`[LLM] Executing chat with provider: ${provider}, model: ${options.model || "default"}`);

    let rawResponse = "";
    if (provider === "groq") {
      rawResponse = await this.chatWithGroq(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    } else if (provider === "openai") {
      rawResponse = await this.chatWithOpenAI(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    } else if (provider === "anthropic") {
      rawResponse = await this.chatWithAnthropic(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    } else if (provider === "openrouter") {
      rawResponse = await this.chatWithOpenRouter(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    } else if (provider === "deepseek") {
      rawResponse = await this.chatWithDeepSeek(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    } else if (provider === "gemini") {
      rawResponse = await this.chatWithGemini(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    } else if (provider === "ollama") {
      rawResponse = await this.chatWithOllama(messages, options.model, temperature, apiKey, baseUrl);
    } else {
      rawResponse = await this.chatWithLlamaCpp(messages, options.model, temperature, maxTokens, apiKey, baseUrl);
    }

    return sanitizeLlmResponse(rawResponse, options.isReport);
  }

  public isLlamaCppConfigured(): boolean {
    const config = loadConfig();
    return Boolean(
      config.llamacppServerUrl?.trim() ||
      config.llmBaseUrls?.["llamacpp-server"]?.trim() ||
      config.llmBaseUrls?.["llamacpp"]?.trim() ||
      ((!config.llmProvider || config.llmProvider === "llamacpp-server" || config.llmProvider === "llamacpp") && config.llmBaseUrl?.trim())
    );
  }

  private async chatWithLlamaCpp(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    const config = loadConfig();
    const targetUrl =
      baseUrl?.trim() ||
      config.llmBaseUrls?.["llamacpp-server"]?.trim() ||
      config.llmBaseUrls?.["llamacpp"]?.trim() ||
      config.llamacppServerUrl?.trim() ||
      config.llmBaseUrl?.trim() ||
      "http://127.0.0.1:9100";
    const url = targetUrl.endsWith("/chat/completions")
      ? targetUrl
      : `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "qwen3-abliterated-14b-q4_k_m",
        messages, temperature, max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`llamacpp-server responded with status ${res.status}: ${errorText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (!content) throw new Error("No completion content returned from llamacpp-server");
    return content;
  }

  private async chatWithOllama(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    const config = loadConfig();
    const targetUrl =
      baseUrl?.trim() ||
      config.llmBaseUrls?.["ollama"]?.trim() ||
      config.llmBaseUrl?.trim() ||
      "http://127.0.0.1:11434";
    const url = targetUrl.endsWith("/api/chat") ? targetUrl : `${targetUrl.replace(/\/$/, "")}/api/chat`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "llama3.2:latest",
        messages, stream: false, options: { temperature },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`Ollama responded with status ${res.status}: ${errorText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const msg = json.message as { content?: string } | undefined;
    if (!msg?.content) throw new Error("No completion content returned from Ollama");
    return msg.content;
  }

  private async chatOpenAICompatible(
    messages: LlmMessage[], model: string, url: string, apiKey: string,
    temperature: number, maxTokens: number, providerName: string,
    extraHeaders?: Record<string, string>,
  ): Promise<string> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`${providerName} API request failed with status ${res.status}: ${errorText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (!content) throw new Error(`No completion content returned from ${providerName}`);
    return content;
  }

  private async chatWithGroq(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    if (!apiKey) throw new Error("Groq API key is required. Configure it in Settings.");
    const url = baseUrl || "https://api.groq.com/openai/v1/chat/completions";
    return this.chatOpenAICompatible(messages, model || "llama-3.3-70b-versatile", url, apiKey, temperature, maxTokens, "Groq");
  }

  private async chatWithOpenAI(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    if (!apiKey) throw new Error("OpenAI API key is required. Configure it in Settings.");
    const targetUrl = baseUrl || "https://api.openai.com";
    const url = targetUrl.endsWith("/chat/completions")
      ? targetUrl : `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;
    return this.chatOpenAICompatible(messages, model || "gpt-4o-mini", url, apiKey, temperature, maxTokens, "OpenAI");
  }

  private async chatWithAnthropic(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    if (!apiKey) throw new Error("Anthropic API key is required. Configure it in Settings.");
    const targetUrl = baseUrl || "https://api.anthropic.com";
    const url = targetUrl.endsWith("/messages")
      ? targetUrl : `${targetUrl.replace(/\/$/, "")}/v1/messages`;
    const selectedModel = model || "claude-3-5-sonnet-20241022";

    const systemMessage = messages.find((m) => m.role === "system")?.content;
    const anthropicMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: maxTokens,
        temperature,
        ...(systemMessage ? { system: systemMessage } : {}),
        messages: anthropicMessages,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`Anthropic API request failed with status ${res.status}: ${errorText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const contentArr = json.content as Array<{ text?: string }> | undefined;
    if (!contentArr?.[0]?.text) throw new Error("No completion content returned from Anthropic");
    return contentArr[0].text;
  }

  private async chatWithOpenRouter(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    if (!apiKey) throw new Error("OpenRouter API key is required. Configure it in Settings.");
    const url = baseUrl || "https://openrouter.ai/api/v1/chat/completions";
    return this.chatOpenAICompatible(
      messages, model || "meta-llama/llama-3.3-70b-instruct", url, apiKey, temperature, maxTokens, "OpenRouter",
      { "HTTP-Referer": "https://portfolio.local", "X-Title": "Financial Portfolio" },
    );
  }

  private async chatWithDeepSeek(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    if (!apiKey) throw new Error("DeepSeek API key is required. Configure it in Settings.");
    const targetUrl = baseUrl || "https://api.deepseek.com";
    const url = targetUrl.endsWith("/chat/completions")
      ? targetUrl : `${targetUrl.replace(/\/$/, "")}/chat/completions`;
    return this.chatOpenAICompatible(messages, model || "deepseek-chat", url, apiKey, temperature, maxTokens, "DeepSeek");
  }

  private async chatWithGemini(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    if (!apiKey) throw new Error("Gemini API key is required. Configure it in Settings.");
    const url = baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    return this.chatOpenAICompatible(messages, model || "gemini-2.5-flash", url, apiKey, temperature, maxTokens, "Gemini");
  }

  /** Fetch available models from server when supported (e.g. Ollama or llama.cpp) */
  public async getAvailableModels(provider: string, baseUrl?: string, apiKey?: string): Promise<string[]> {
    const p = (provider || "").toLowerCase().trim();
    if (p === "ollama") {
      const targetUrl = baseUrl?.trim() || "http://127.0.0.1:11434";
      const endpoint = `${targetUrl.replace(/\/$/, "")}/api/tags`;
      try {
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = (await res.json()) as { models?: Array<{ name?: string }> };
          const names = data.models?.map((m) => m.name).filter((n): n is string => Boolean(n)) || [];
          if (names.length > 0) return names;
        }
      } catch {
        // Fall back if server is offline
      }
    } else if (p === "llamacpp-server" || p === "llamacpp") {
      const targetUrl = baseUrl?.trim() || "http://127.0.0.1:9100";
      const endpoint = `${targetUrl.replace(/\/$/, "")}/v1/models`;
      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = (await res.json()) as { data?: Array<{ id?: string }> };
          const names = data.data?.map((m) => m.id).filter((n): n is string => Boolean(n)) || [];
          if (names.length > 0) return names;
        }
      } catch {
        // Fall back if server is offline
      }
    }
    return [];
  }

  /** Run diagnostic test step for inference provider */
  public async testStep(
    step: "config" | "connection" | "inference" | "integrity",
    options: {
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
      previousOutput?: string;
    }
  ): Promise<{ success: boolean; message: string; latencyMs?: number; output?: string }> {
    const provider = (options.provider || "llamacpp-server").toLowerCase().trim();
    const model = (options.model || "").trim();
    const apiKey = (options.apiKey || "").trim();
    const baseUrl = (options.baseUrl || "").trim();

    if (step === "config") {
      if (!model) {
        return { success: false, message: "Model identifier cannot be empty." };
      }
      const cloudProviders = ["groq", "openai", "anthropic", "gemini", "openrouter", "deepseek"];
      if (cloudProviders.includes(provider) && !apiKey) {
        const name = provider.charAt(0).toUpperCase() + provider.slice(1);
        return { success: false, message: `${name} requires an API key.` };
      }
      if (provider === "llamacpp-server" || provider === "llamacpp" || provider === "ollama") {
        const urlToTest = baseUrl || (provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:9100");
        try {
          new URL(urlToTest);
        } catch {
          return { success: false, message: `Invalid server URL format: ${urlToTest}` };
        }
      }
      return { success: true, message: "Configuration parameters and credentials validated." };
    }

    if (step === "connection") {
      const startTime = Date.now();
      try {
        if (provider === "ollama") {
          const targetUrl = baseUrl || "http://127.0.0.1:11434";
          const pingUrl = `${targetUrl.replace(/\/$/, "")}/api/tags`;
          const res = await fetch(pingUrl, { signal: AbortSignal.timeout(4000) });
          const latencyMs = Date.now() - startTime;
          if (!res.ok) {
            return { success: false, message: `Ollama server returned status ${res.status}.` };
          }
          return { success: true, message: `Connected to Ollama daemon at ${targetUrl} (${latencyMs}ms).`, latencyMs };
        } else if (provider === "llamacpp-server" || provider === "llamacpp") {
          const targetUrl = baseUrl || "http://127.0.0.1:9100";
          const pingUrl = `${targetUrl.replace(/\/$/, "")}/v1/models`;
          const headers: Record<string, string> = {};
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
          let res: Response | null = null;
          try {
            res = await fetch(pingUrl, { headers, signal: AbortSignal.timeout(4000) });
          } catch {
            try {
              res = await fetch(`${targetUrl.replace(/\/$/, "")}/health`, { headers, signal: AbortSignal.timeout(3000) });
            } catch {
              res = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(3000) });
            }
          }
          const latencyMs = Date.now() - startTime;
          if (res && !res.ok && res.status >= 500) {
            return { success: false, message: `llama.cpp server error with status ${res.status}.` };
          }
          return { success: true, message: `Connected to llamacpp server at ${targetUrl} (${latencyMs}ms).`, latencyMs };
        } else {
          // Cloud providers: verify host reachability
          const hostMap: Record<string, string> = {
            groq: "https://api.groq.com/openai/v1/models",
            openai: "https://api.openai.com/v1/models",
            anthropic: "https://api.anthropic.com",
            gemini: "https://generativelanguage.googleapis.com",
            openrouter: "https://openrouter.ai/api/v1/models",
            deepseek: "https://api.deepseek.com",
          };
          const targetHost = hostMap[provider] || "https://api.openai.com";
          const headers: Record<string, string> = {};
          if (apiKey) {
            if (provider === "anthropic") {
              headers["x-api-key"] = apiKey;
              headers["anthropic-version"] = "2023-06-01";
            } else {
              headers.Authorization = `Bearer ${apiKey}`;
            }
          }
          try {
            await fetch(targetHost, { method: "GET", headers, signal: AbortSignal.timeout(6000) });
          } catch {
            await fetch(targetHost, { method: "HEAD", signal: AbortSignal.timeout(4000) });
          }
          const latencyMs = Date.now() - startTime;
          return { success: true, message: `Connected to ${provider} API gateway (${latencyMs}ms).`, latencyMs };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const defaultHost = provider === "ollama" ? "127.0.0.1:11434" : (provider === "llamacpp-server" || provider === "llamacpp" ? "127.0.0.1:9100" : `${provider} host`);
        return {
          success: false,
          message: `Unable to connect to ${baseUrl || defaultHost}: ${msg}`,
        };
      }
    }

    if (step === "inference") {
      const startTime = Date.now();
      try {
        const result = await this.chat(
          [
            { role: "system", content: "You are a concise assistant." },
            { role: "user", content: "Say 'LLM connection verified' in exactly those words." },
          ],
          {
            provider,
            model,
            apiKey: apiKey || undefined,
            baseUrl: baseUrl || undefined,
            maxTokens: 50,
          }
        );
        const latencyMs = Date.now() - startTime;
        return {
          success: true,
          message: `Inference response generated in ${latencyMs}ms.`,
          output: result.slice(0, 300),
          latencyMs,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: msg };
      }
    }

    if (step === "integrity") {
      const output = options.previousOutput?.trim() || "";
      if (!output) {
        return { success: false, message: "Empty inference response received." };
      }
      return {
        success: true,
        message: `Output verified: "${output.length > 80 ? output.slice(0, 80) + '...' : output}"`,
        output,
      };
    }

    return { success: false, message: `Unknown step identifier: ${step}` };
  }
}
