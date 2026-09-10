/**
 * Multi-provider LLM client.
 * Ported from the NestJS service, removing DI decorators.
 */

import { loadConfig } from "../config.js";
import {
  DEFAULT_LLAMACPP_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
} from "../../shared/llm-defaults.js";

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
  signal?: AbortSignal;
  /** Return the model output untouched, keeping `<think>` blocks intact. */
  skipSanitize?: boolean;
}

/**
 * Token budget for the diagnostic inference step. Reasoning models such as
 * Qwen3 spend their first few hundred tokens inside `<think>`, so a tight
 * budget truncates the reply before the block closes and leaves nothing once
 * the thinking is stripped.
 */
const TEST_INFERENCE_MAX_TOKENS = 512;

/** How long an auto-detected llama.cpp model name stays valid. */
const LLAMACPP_MODEL_CACHE_MS = 60_000;

/**
 * Strip LLM thinking blocks without backtracking regex.
 * Uses a single-pass state machine that scans for `<think` open tags
 * and `</think>` close tags, tracking nesting depth.
 * This avoids catastrophic backtracking on unbalanced or very long inputs.
 */
export function sanitizeLlmResponse(text: string, isReport = false): string {
  if (!text) return "";

  const cleaned = stripThinkTags(text);

  let result = cleaned.trim();

  // If leading garbage exists before the first header in reports, strip it
  if (isReport && !result.startsWith("#") && !result.startsWith("1.")) {
    const headerIdx = result.search(/(?:^|\n)(?:#+|1\.\s+\*\*)/);
    if (headerIdx > 0) {
      const prefix = result.slice(0, headerIdx).trim();
      if (prefix.length < 100 && !prefix.includes("\n\n")) {
        result = result.slice(headerIdx).trim();
      }
    }
  }

  return result.trim();
}

/**
 * Single-pass state machine to strip `<think>...</think>` blocks.
 * Tracks nesting depth so that orphaned tags are handled correctly
 * without catastrophic backtracking via regex.
 */
function stripThinkTags(input: string): string {
  let depth = 0;
  let output = "";
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Check for open tag: `<think` followed by `>` or space/attr then `>`
    if (input[i] === "<" &&
        i + 6 <= len &&
        (input[i + 1] === "t" || input[i + 1] === "T") &&
        (input[i + 2] === "h" || input[i + 2] === "H") &&
        (input[i + 3] === "i" || input[i + 3] === "I") &&
        (input[i + 4] === "n" || input[i + 4] === "N") &&
        (input[i + 5] === "k" || input[i + 5] === "K")) {
      // Found `<think`
      // Fast-forward past the opening tag to find `>`
      i += 6;
      while (i < len && input[i] !== ">") i++;
      if (i < len) i++; // skip `>`
      depth++;
      continue;
    }

    // Check for close tag: `</think` followed by `>`
    if (input[i] === "<" &&
        i + 8 <= len &&
        input[i + 1] === "/" &&
        (input[i + 2] === "t" || input[i + 2] === "T") &&
        (input[i + 3] === "h" || input[i + 3] === "H") &&
        (input[i + 4] === "i" || input[i + 4] === "I") &&
        (input[i + 5] === "n" || input[i + 5] === "N") &&
        (input[i + 6] === "k" || input[i + 6] === "K")) {
      // Found `</think`. Advance past the tag name only: consuming the `>` here
      // as well would make the scan below swallow everything up to the *next*
      // `>` in the document, discarding the answer that follows the block.
      i += 7;
      while (i < len && input[i] !== ">") i++;
      if (i < len) i++; // skip `>`
      if (depth > 0) depth--;
      continue;
    }

    // If we are inside a thinking block (depth > 0), skip this character
    if (depth > 0) {
      i++;
      continue;
    }

    // Otherwise, copy to output
    output += input[i];
    i++;
  }

  // If we ended while still inside a thinking block, everything after
  // the last open `<think>` was stripped, which is the correct behavior.
  return output;
}

export class LlmService {
  /** Model auto-detected per llama.cpp base URL, see resolveLlamaCppModel(). */
  private static llamaCppModelCache = new Map<string, { model: string; at: number }>();

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

    if (options.skipSanitize) return rawResponse;
    return sanitizeLlmResponse(rawResponse, options.isReport);
  }

  public async chatStream(
    messages: LlmMessage[],
    onChunk: (chunk: string) => void,
    options: LlmChatOptions = {},
  ): Promise<string> {
    const provider = (options.provider || "llamacpp-server").toLowerCase().trim();
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 3000;
    const { apiKey, baseUrl, signal } = options;

    console.log(`[LLM] Executing chatStream with provider: ${provider}, model: ${options.model || "default"}`);

    let rawResponse = "";
    if (provider === "groq") {
      if (!apiKey) throw new Error("Groq API key is required. Configure it in Settings.");
      const url = baseUrl || "https://api.groq.com/openai/v1/chat/completions";
      rawResponse = await this.chatOpenAICompatibleStream(
        messages, options.model || "llama-3.3-70b-versatile", url, apiKey, temperature, maxTokens, "Groq", onChunk, undefined, signal,
      );
    } else if (provider === "openai") {
      if (!apiKey) throw new Error("OpenAI API key is required. Configure it in Settings.");
      const targetUrl = baseUrl || "https://api.openai.com";
      const url = targetUrl.endsWith("/chat/completions") ? targetUrl : `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;
      rawResponse = await this.chatOpenAICompatibleStream(
        messages, options.model || "gpt-4o-mini", url, apiKey, temperature, maxTokens, "OpenAI", onChunk, undefined, signal,
      );
    } else if (provider === "anthropic") {
      rawResponse = await this.chatWithAnthropicStream(
        messages, options.model, temperature, maxTokens, apiKey, baseUrl, onChunk, signal,
      );
    } else if (provider === "openrouter") {
      if (!apiKey) throw new Error("OpenRouter API key is required. Configure it in Settings.");
      const url = baseUrl || "https://openrouter.ai/api/v1/chat/completions";
      rawResponse = await this.chatOpenAICompatibleStream(
        messages, options.model || "meta-llama/llama-3.3-70b-instruct", url, apiKey, temperature, maxTokens, "OpenRouter", onChunk,
        { "HTTP-Referer": "https://portfolio.local", "X-Title": "Financial Portfolio" }, signal,
      );
    } else if (provider === "deepseek") {
      if (!apiKey) throw new Error("DeepSeek API key is required. Configure it in Settings.");
      const targetUrl = baseUrl || "https://api.deepseek.com";
      const url = targetUrl.endsWith("/chat/completions") ? targetUrl : `${targetUrl.replace(/\/$/, "")}/chat/completions`;
      rawResponse = await this.chatOpenAICompatibleStream(
        messages, options.model || "deepseek-chat", url, apiKey, temperature, maxTokens, "DeepSeek", onChunk, undefined, signal,
      );
    } else if (provider === "gemini") {
      if (!apiKey) throw new Error("Gemini API key is required. Configure it in Settings.");
      const url = baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      rawResponse = await this.chatOpenAICompatibleStream(
        messages, options.model || "gemini-2.5-flash", url, apiKey, temperature, maxTokens, "Gemini", onChunk, undefined, signal,
      );
    } else if (provider === "ollama") {
      rawResponse = await this.chatWithOllamaStream(
        messages, options.model, temperature, apiKey, baseUrl, onChunk, signal,
      );
    } else {
      rawResponse = await this.chatWithLlamaCppStream(
        messages, options.model, temperature, maxTokens, apiKey, baseUrl, onChunk, signal,
      );
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

  /**
   * Resolve which model name to send to a llama.cpp server.
   *
   * A single-model `llama-server` ignores the field, but a router serving
   * several models rejects requests without one ("model name is missing from
   * the request"). When the user has not pinned a model we ask `/v1/models`
   * and prefer one already loaded, so a router does not have to swap a cold
   * model in. Servers that cannot answer fall back to sending no model at all.
   */
  private async resolveLlamaCppModel(
    model: string | undefined, targetUrl: string, apiKey?: string,
  ): Promise<string | undefined> {
    const pinned = model?.trim();
    if (pinned) return pinned;

    const cacheKey = targetUrl.replace(/\/$/, "");
    const cached = LlmService.llamaCppModelCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LLAMACPP_MODEL_CACHE_MS) return cached.model;

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${cacheKey}/v1/models`, { headers, signal: AbortSignal.timeout(4000) });
      if (!res.ok) return undefined;
      const data = (await res.json()) as {
        data?: Array<{ id?: string; status?: { value?: string } }>;
      };
      const entries = data.data?.filter((m): m is { id: string; status?: { value?: string } } =>
        Boolean(m.id)
      ) || [];
      if (entries.length === 0) return undefined;
      const resolved = (entries.find((m) => m.status?.value === "loaded") || entries[0]).id;
      LlmService.llamaCppModelCache.set(cacheKey, { model: resolved, at: Date.now() });
      return resolved;
    } catch {
      // Server offline or not a router: let the request go out without a model.
      return undefined;
    }
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
      DEFAULT_LLAMACPP_URL;
    const url = targetUrl.endsWith("/chat/completions")
      ? targetUrl
      : `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const resolvedModel = await this.resolveLlamaCppModel(model, targetUrl, apiKey);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(resolvedModel ? { model: resolvedModel } : {}),
        messages, temperature, max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`llamacpp-server responded with status ${res.status}: ${errorText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const choices = json.choices as
      | Array<{ message?: { content?: string; reasoning_content?: string } }>
      | undefined;
    const message = choices?.[0]?.message;
    const content = message?.content;
    if (content?.trim()) return content;

    // Servers started with `--reasoning-format deepseek` return the thinking in
    // a separate field and leave `content` empty. Re-wrap it so callers see the
    // same shape as inline `<think>` output instead of a blank string.
    const reasoning = message?.reasoning_content?.trim();
    if (reasoning) return `<think>${reasoning}</think>`;

    throw new Error("No completion content returned from llamacpp-server");
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
      DEFAULT_OLLAMA_URL;
    const url = targetUrl.endsWith("/api/chat") ? targetUrl : `${targetUrl.replace(/\/$/, "")}/api/chat`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || DEFAULT_OLLAMA_MODEL,
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

  private async chatOpenAICompatibleStream(
    messages: LlmMessage[],
    model: string,
    url: string,
    apiKey: string | undefined,
    temperature: number,
    maxTokens: number,
    providerName: string,
    onChunk: (chunk: string) => void,
    extraHeaders?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(model ? { model } : {}),
        messages, temperature, max_tokens: maxTokens, stream: true,
      }),
      signal: signal || AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`${providerName} API request failed with status ${res.status}: ${errorText}`);
    }

    if (!res.body) {
      throw new Error(`No response body returned from ${providerName}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullResponse = "";

    try {
      while (true) {
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.replace(/^data:\s*/, "");
          if (dataStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? "";
            if (delta) {
              fullResponse += delta;
              onChunk(delta);
            }
          } catch {
            // Ignore incomplete SSE chunk
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Best effort
      }
    }

    return fullResponse;
  }

  private async chatWithLlamaCppStream(
    messages: LlmMessage[],
    model: string | undefined,
    temperature: number,
    maxTokens: number,
    apiKey?: string,
    baseUrl?: string,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const config = loadConfig();
    const targetUrl =
      baseUrl?.trim() ||
      config.llmBaseUrls?.["llamacpp-server"]?.trim() ||
      config.llmBaseUrls?.["llamacpp"]?.trim() ||
      config.llamacppServerUrl?.trim() ||
      config.llmBaseUrl?.trim() ||
      DEFAULT_LLAMACPP_URL;
    const url = targetUrl.endsWith("/chat/completions")
      ? targetUrl
      : `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;

    const resolvedModel = await this.resolveLlamaCppModel(model, targetUrl, apiKey);

    return this.chatOpenAICompatibleStream(
      messages,
      resolvedModel || "",
      url,
      apiKey,
      temperature,
      maxTokens,
      "llamacpp-server",
      onChunk || (() => {}),
      undefined,
      signal,
    );
  }

  private async chatWithOllamaStream(
    messages: LlmMessage[],
    model: string | undefined,
    temperature: number,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const config = loadConfig();
    const targetUrl =
      baseUrl?.trim() ||
      config.llmBaseUrls?.["ollama"]?.trim() ||
      config.llmBaseUrl?.trim() ||
      DEFAULT_OLLAMA_URL;
    const url = targetUrl.endsWith("/api/chat") ? targetUrl : `${targetUrl.replace(/\/$/, "")}/api/chat`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || DEFAULT_OLLAMA_MODEL,
        messages,
        stream: true,
        options: { temperature },
      }),
      signal: signal || AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`Ollama responded with status ${res.status}: ${errorText}`);
    }

    if (!res.body) {
      throw new Error("No response body returned from Ollama");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullResponse = "";

    try {
      while (true) {
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = parsed.message?.content;
            if (delta) {
              fullResponse += delta;
              onChunk(delta);
            }
          } catch {
            // Ignore incomplete line
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Best effort
      }
    }

    return fullResponse;
  }

  private async chatWithAnthropicStream(
    messages: LlmMessage[],
    model: string | undefined,
    temperature: number,
    maxTokens: number,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!apiKey) throw new Error("Anthropic API key is required. Configure it in Settings.");
    const targetUrl = baseUrl || "https://api.anthropic.com";
    const url = targetUrl.endsWith("/messages") ? targetUrl : `${targetUrl.replace(/\/$/, "")}/v1/messages`;
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
        stream: true,
        ...(systemMessage ? { system: systemMessage } : {}),
        messages: anthropicMessages,
      }),
      signal: signal || AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`Anthropic API request failed with status ${res.status}: ${errorText}`);
    }

    if (!res.body) {
      throw new Error("No response body returned from Anthropic");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullResponse = "";

    try {
      while (true) {
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.replace(/^data:\s*/, "");
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              fullResponse += parsed.delta.text;
              onChunk(parsed.delta.text);
            }
          } catch {
            // Ignore non-json
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Best effort
      }
    }

    return fullResponse;
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
      const targetUrl = baseUrl?.trim() || DEFAULT_OLLAMA_URL;
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
      const targetUrl = baseUrl?.trim() || DEFAULT_LLAMACPP_URL;
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
      // llama.cpp serves the model it was launched with, so an unset model is
      // valid there; every other provider addresses a model by name.
      const modelOptional = provider === "llamacpp-server" || provider === "llamacpp";
      if (!model && !modelOptional) {
        return { success: false, message: "Model identifier cannot be empty." };
      }
      const cloudProviders = ["groq", "openai", "anthropic", "gemini", "openrouter", "deepseek"];
      if (cloudProviders.includes(provider) && !apiKey) {
        const name = provider.charAt(0).toUpperCase() + provider.slice(1);
        return { success: false, message: `${name} requires an API key.` };
      }
      if (provider === "llamacpp-server" || provider === "llamacpp" || provider === "ollama") {
        const urlToTest = baseUrl || (provider === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_LLAMACPP_URL);
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
          const targetUrl = baseUrl || DEFAULT_OLLAMA_URL;
          const pingUrl = `${targetUrl.replace(/\/$/, "")}/api/tags`;
          const res = await fetch(pingUrl, { signal: AbortSignal.timeout(4000) });
          const latencyMs = Date.now() - startTime;
          if (!res.ok) {
            return { success: false, message: `Ollama server returned status ${res.status}.` };
          }
          return { success: true, message: `Connected to Ollama daemon at ${targetUrl} (${latencyMs}ms).`, latencyMs };
        } else if (provider === "llamacpp-server" || provider === "llamacpp") {
          const targetUrl = baseUrl || DEFAULT_LLAMACPP_URL;
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
        const defaultHost = provider === "ollama" ? DEFAULT_OLLAMA_URL : (provider === "llamacpp-server" || provider === "llamacpp" ? DEFAULT_LLAMACPP_URL : `${provider} host`);
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
            maxTokens: TEST_INFERENCE_MAX_TOKENS,
            skipSanitize: true,
          }
        );
        const latencyMs = Date.now() - startTime;
        const answer = sanitizeLlmResponse(result);
        if (!answer) {
          // The model replied, but everything it produced was reasoning: the
          // `<think>` block never closed within the token budget.
          return {
            success: false,
            message:
              `Model produced ${result.trim().length} characters of reasoning but no answer ` +
              `within ${TEST_INFERENCE_MAX_TOKENS} tokens. Raise the token budget or turn off ` +
              `thinking for this model.`,
            latencyMs,
          };
        }
        return {
          success: true,
          message: `Inference response generated in ${latencyMs}ms.`,
          output: answer.slice(0, 300),
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
