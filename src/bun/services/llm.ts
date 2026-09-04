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
}

export function sanitizeLlmResponse(text: string): string {
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

  // 5. If leading garbage exists before the first header, strip it
  if (!cleaned.startsWith("#") && !cleaned.startsWith("1.")) {
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

    return sanitizeLlmResponse(rawResponse);
  }

  public isLlamaCppConfigured(): boolean {
    const config = loadConfig();
    return Boolean(config.llamacppServerUrl?.trim());
  }

  private async chatWithLlamaCpp(
    messages: LlmMessage[], model: string | undefined, temperature: number,
    maxTokens: number, apiKey?: string, baseUrl?: string,
  ): Promise<string> {
    const config = loadConfig();
    const targetUrl = baseUrl || config.llamacppServerUrl?.trim();
    if (!targetUrl) {
      throw new Error("llama.cpp is disabled because no server URL is configured.");
    }
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
    if (!baseUrl) throw new Error("Ollama server URL is required. Configure it in Settings.");
    const url = baseUrl.endsWith("/api/chat") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/api/chat`;

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
}
