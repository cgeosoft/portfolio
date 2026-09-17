/**
 * Multi-provider LLM client.
 *
 * Every provider is a row in PROVIDERS; the wire protocol (`api`) decides how
 * the request body, the reply and the stream frames look. Options given by
 * the caller win over the settings, which win over the provider defaults.
 */

import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import {
  DEFAULT_LLAMACPP_URL,
  DEFAULT_NEBIUS_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OPENAI_COMPATIBLE_URL,
} from "portfolio-shared/llm-defaults";

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
  /** Reports also lose any preamble the model printed before the first heading. */
  isReport?: boolean;
  signal?: AbortSignal;
}

/** Everything a request needs once options, settings and provider defaults are merged. */
export interface LlmTarget {
  provider: ProviderId;
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
}

export interface TestStepResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  output?: string;
}

// ── providers ───────────────────────────────────────────────────────────────

export type ProviderId =
  | "llamacpp-server"
  | "ollama"
  | "openai-compatible"
  | "nebius"
  | "groq"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "deepseek"
  | "gemini";

interface ProviderSpec {
  /** Name used in messages shown to the user. */
  name: string;
  /** Wire protocol: OpenAI chat completions, Anthropic messages or the Ollama API. */
  api: "openai" | "anthropic" | "ollama";
  /** Cloud services refuse requests without an API key; local servers accept one. */
  cloud: boolean;
  /** Model used when neither the request nor the settings name one; empty when the server decides. */
  defaultModel: string;
  defaultUrl: string;
  headers?: Record<string, string>;
}

const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  "llamacpp-server": { name: "llama.cpp", api: "openai", cloud: false, defaultModel: "", defaultUrl: DEFAULT_LLAMACPP_URL },
  ollama: { name: "Ollama", api: "ollama", cloud: false, defaultModel: DEFAULT_OLLAMA_MODEL, defaultUrl: DEFAULT_OLLAMA_URL },
  "openai-compatible": { name: "OpenAI-compatible", api: "openai", cloud: false, defaultModel: "", defaultUrl: DEFAULT_OPENAI_COMPATIBLE_URL },
  nebius: { name: "Nebius", api: "openai", cloud: true, defaultModel: "meta-llama/Llama-3.3-70B-Instruct", defaultUrl: DEFAULT_NEBIUS_URL },
  groq: { name: "Groq", api: "openai", cloud: true, defaultModel: "llama-3.3-70b-versatile", defaultUrl: "https://api.groq.com/openai/v1" },
  openai: { name: "OpenAI", api: "openai", cloud: true, defaultModel: "gpt-4o-mini", defaultUrl: "https://api.openai.com/v1" },
  anthropic: { name: "Anthropic", api: "anthropic", cloud: true, defaultModel: "claude-3-5-sonnet-20241022", defaultUrl: "https://api.anthropic.com" },
  openrouter: {
    name: "OpenRouter",
    api: "openai",
    cloud: true,
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    defaultUrl: "https://openrouter.ai/api/v1",
    headers: { "HTTP-Referer": "https://portfolio.local", "X-Title": "Financial Portfolio" },
  },
  deepseek: { name: "DeepSeek", api: "openai", cloud: true, defaultModel: "deepseek-chat", defaultUrl: "https://api.deepseek.com/v1" },
  gemini: { name: "Gemini", api: "openai", cloud: true, defaultModel: "gemini-2.5-flash", defaultUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
};

/** Settings may still say "llamacpp" (the GUI preset id) for the llama.cpp server. */
function normalizeProvider(raw: string | undefined): ProviderId {
  const id = (raw || "").toLowerCase().trim();
  if (id === "llamacpp") return "llamacpp-server";
  return id in PROVIDERS ? (id as ProviderId) : "llamacpp-server";
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

const REQUEST_TIMEOUT_MS = 120_000;

// ── URLs and headers ────────────────────────────────────────────────────────

/**
 * OpenAI-compatible endpoint for a base URL. A bare host gets the usual `/v1`
 * prefix; a URL that already carries a path (`/v1`, `/openai/v1`,
 * `/v1beta/openai`) is used as the API root. A full endpoint URL is accepted
 * as well and re-targeted to the requested path.
 */
export function buildOpenAIUrl(rawBaseUrl: string, endpointPath: "chat/completions" | "models"): string {
  const base = (rawBaseUrl || "").trim().replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "");
  const hasPath = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/./i.test(base);
  return `${base}${hasPath ? "" : "/v1"}/${endpointPath}`;
}

function endpointUrl(spec: ProviderSpec, baseUrl: string, kind: "chat" | "models"): string {
  const root = baseUrl.replace(/\/+$/, "");
  const withSuffix = (suffix: string) => (root.endsWith(suffix) ? root : `${root}${suffix}`);
  if (spec.api === "ollama") return kind === "chat" ? withSuffix("/api/chat") : `${root}/api/tags`;
  if (spec.api === "anthropic") return kind === "chat" ? withSuffix("/v1/messages") : `${root}/v1/models`;
  return buildOpenAIUrl(root, kind === "chat" ? "chat/completions" : "models");
}

function requestHeaders(spec: ProviderSpec, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...spec.headers };
  if (!apiKey) return headers;
  if (spec.api === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

// ── request and reply shapes per protocol ───────────────────────────────────

function requestBody(spec: ProviderSpec, target: LlmTarget, messages: LlmMessage[], maxTokens: number, stream: boolean): unknown {
  const model = target.model || undefined; // omitted when empty: llama.cpp answers with the model it was started with
  const { temperature } = target;
  if (spec.api === "ollama") return { model, messages, stream, options: { temperature } };
  if (spec.api === "anthropic") {
    const system = messages.find((m) => m.role === "system")?.content;
    return { model, max_tokens: maxTokens, temperature, stream, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== "system") };
  }
  return { model, messages, temperature, max_tokens: maxTokens, stream };
}

interface ChatReply {
  message?: { content?: string };
  content?: Array<{ text?: string }>;
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
}

/** Text of a non-streamed reply; empty when the provider returned none. */
function replyText(spec: ProviderSpec, json: ChatReply): string {
  if (spec.api === "ollama") return json.message?.content ?? "";
  if (spec.api === "anthropic") return json.content?.[0]?.text ?? "";
  const message = json.choices?.[0]?.message;
  if (message?.content?.trim()) return message.content;
  // Servers started with `--reasoning-format deepseek` return the thinking in
  // a separate field and leave `content` empty. Re-wrap it so callers see the
  // same shape as inline `<think>` output instead of a blank string.
  const reasoning = message?.reasoning_content?.trim();
  return reasoning ? `<think>${reasoning}</think>` : "";
}

/** Text carried by one line of a streamed reply (SSE `data:` frames, or NDJSON for Ollama). */
function streamDelta(spec: ProviderSpec, line: string): string {
  let payload = line.trim();
  if (spec.api !== "ollama") {
    if (!payload.startsWith("data:")) return "";
    payload = payload.slice(5).trim();
  }
  if (!payload || payload === "[DONE]") return "";
  try {
    const frame = JSON.parse(payload);
    if (spec.api === "ollama") return frame.message?.content ?? "";
    if (spec.api === "anthropic") return frame.type === "content_block_delta" ? (frame.delta?.text ?? "") : "";
    return frame.choices?.[0]?.delta?.content ?? frame.choices?.[0]?.text ?? "";
  } catch {
    return ""; // partial or non-JSON frame
  }
}

async function readLines(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(onLine);
  }
  if (buffer) onLine(buffer);
}

interface ModelList {
  data?: Array<{ id?: string; status?: { value?: string } }>;
  models?: Array<{ name?: string }>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── output cleanup ──────────────────────────────────────────────────────────

/** Removes `<think>` blocks and, for reports, a short preamble printed before the first heading. */
export function sanitizeLlmResponse(text: string, isReport = false): string {
  let result = stripThinkTags(text || "").trim();
  if (isReport && !/^(#|1\.)/.test(result)) {
    const headerIdx = result.search(/(?:^|\n)(?:#+|1\.\s+\*\*)/);
    const prefix = headerIdx > 0 ? result.slice(0, headerIdx).trim() : "";
    if (headerIdx > 0 && prefix.length < 100 && !prefix.includes("\n\n")) result = result.slice(headerIdx).trim();
  }
  return result;
}

/**
 * Single pass over the text that drops everything inside `<think>...</think>`,
 * nested blocks included. Tags are matched case-insensitively and may carry
 * attributes. An unclosed block swallows the rest of the text, which is what
 * a reply truncated mid-thought deserves. No regex, so no backtracking on
 * long or unbalanced input.
 */
function stripThinkTags(input: string): string {
  const lower = input.toLowerCase();
  let output = "";
  let depth = 0;
  let i = 0;
  while (i < input.length) {
    const opens = lower.startsWith("<think", i);
    const closes = lower.startsWith("</think", i);
    if (opens || closes) {
      const end = input.indexOf(">", i);
      i = end === -1 ? input.length : end + 1;
      depth = opens ? depth + 1 : Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) output += input[i];
    i++;
  }
  return output;
}

// ── service ─────────────────────────────────────────────────────────────────

export class LlmService {
  /** Model auto-detected per llama.cpp base URL, see detectLlamaCppModel(). */
  private static readonly detectedModels = new Map<string, { model: string; at: number }>();

  /**
   * Merges request options, the stored settings and the provider defaults.
   * The single `llmModel` / `llmApiKey` / `llmBaseUrl` settings mirror the
   * provider chosen in Settings; the per-provider maps hold every other one.
   */
  public resolve(options: LlmChatOptions = {}): LlmTarget {
    const config = loadConfig();
    const provider = normalizeProvider(options.provider || config.llmProvider);
    const spec = PROVIDERS[provider];
    const isCurrent = normalizeProvider(config.llmProvider) === provider;
    const isLlamaCpp = provider === "llamacpp-server";
    const stored = (map: Record<string, string> | undefined) => map?.[provider]?.trim() || (isLlamaCpp ? map?.llamacpp?.trim() : "");
    const current = (value: string | undefined) => (isCurrent ? value?.trim() : "");
    return {
      provider,
      name: spec.name,
      model: options.model?.trim() || stored(config.llmModels) || current(config.llmModel) || spec.defaultModel,
      apiKey: options.apiKey?.trim() || stored(config.llmApiKeys) || current(config.llmApiKey) || "",
      baseUrl: (
        options.baseUrl?.trim() ||
        stored(config.llmBaseUrls) ||
        (isLlamaCpp ? config.llamacppServerUrl?.trim() : "") ||
        current(config.llmBaseUrl) ||
        spec.defaultUrl
      ).replace(/\/+$/, ""),
      temperature: options.temperature ?? config.llmTemperature ?? 0.3,
    };
  }

  /** One completion, cleaned with sanitizeLlmResponse(). */
  public async chat(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<string> {
    return sanitizeLlmResponse(await this.complete(messages, options), options.isReport);
  }

  /** Streams the completion through onChunk and resolves to the cleaned full text. */
  public async chatStream(messages: LlmMessage[], onChunk: (chunk: string) => void, options: LlmChatOptions = {}): Promise<string> {
    return sanitizeLlmResponse(await this.complete(messages, options, onChunk), options.isReport);
  }

  /** Raw model output; streamed when onChunk is given. */
  private async complete(messages: LlmMessage[], options: LlmChatOptions, onChunk?: (chunk: string) => void): Promise<string> {
    const target = this.resolve(options);
    const spec = PROVIDERS[target.provider];
    if (spec.cloud && !target.apiKey) {
      throw new Error(`${spec.name} API key is not configured. Please open Settings > Assistant and configure your API key.`);
    }
    if (target.provider === "llamacpp-server" && !target.model) target.model = await this.detectLlamaCppModel(spec, target);

    appLogger.logStep("info", "llm", onChunk ? "chat_stream" : "chat", "Executing chat request", undefined, {
      provider: target.provider,
      model: target.model || "default",
    });

    const res = await fetch(endpointUrl(spec, target.baseUrl, "chat"), {
      method: "POST",
      headers: requestHeaders(spec, target.apiKey),
      body: JSON.stringify(requestBody(spec, target, messages, options.maxTokens ?? 3000, Boolean(onChunk))),
      signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`${spec.name} API request failed with status ${res.status}: ${await res.text().catch(() => "")}`);
    }

    if (!onChunk) {
      const text = replyText(spec, (await res.json()) as ChatReply);
      if (!text) throw new Error(`No completion content returned from ${spec.name}`);
      return text;
    }
    if (!res.body) throw new Error(`No response body returned from ${spec.name}`);
    let full = "";
    await readLines(res.body, options.signal, (line) => {
      const delta = streamDelta(spec, line);
      if (!delta) return;
      full += delta;
      onChunk(delta);
    });
    return full;
  }

  /**
   * A single-model `llama-server` ignores the model field, but a router
   * serving several models rejects requests without one. When the user has
   * not pinned a model we ask `/v1/models` and prefer one already loaded, so
   * the router does not have to swap a cold model in. Servers that cannot
   * answer get no model at all.
   */
  private async detectLlamaCppModel(spec: ProviderSpec, target: LlmTarget): Promise<string> {
    const cached = LlmService.detectedModels.get(target.baseUrl);
    if (cached && Date.now() - cached.at < LLAMACPP_MODEL_CACHE_MS) return cached.model;
    try {
      const res = await fetch(endpointUrl(spec, target.baseUrl, "models"), {
        headers: requestHeaders(spec, target.apiKey),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return "";
      const models = (((await res.json()) as ModelList).data ?? []).filter((m) => m.id);
      const model = (models.find((m) => m.status?.value === "loaded") ?? models[0])?.id ?? "";
      if (model) LlmService.detectedModels.set(target.baseUrl, { model, at: Date.now() });
      return model;
    } catch {
      return ""; // offline or not a router
    }
  }

  /** Model names the server lists; empty when it is offline or does not support listing. */
  public async getAvailableModels(provider: string, baseUrl?: string, apiKey?: string): Promise<string[]> {
    const target = this.resolve({ provider, baseUrl, apiKey });
    const spec = PROVIDERS[target.provider];
    try {
      const res = await fetch(endpointUrl(spec, target.baseUrl, "models"), {
        headers: requestHeaders(spec, target.apiKey),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const list = (await res.json()) as ModelList;
      const names = spec.api === "ollama" ? list.models?.map((m) => m.name) : list.data?.map((m) => m.id);
      return (names ?? []).filter((n): n is string => Boolean(n));
    } catch {
      return [];
    }
  }

  /** One step of the Settings diagnostic: form values, reachability, a real completion, then the output check. */
  public async testStep(
    step: "config" | "connection" | "inference" | "integrity",
    options: { provider: string; model: string; apiKey?: string; baseUrl?: string; previousOutput?: string },
  ): Promise<TestStepResult> {
    const fail = (message: string): TestStepResult => ({ success: false, message });
    const typed: LlmChatOptions = { provider: options.provider, model: options.model, apiKey: options.apiKey, baseUrl: options.baseUrl };
    const target = this.resolve(typed);
    const spec = PROVIDERS[target.provider];

    if (step === "config") {
      // Only what the user typed counts here; llama.cpp may run without a model name.
      if (!options.model?.trim() && target.provider !== "llamacpp-server") return fail("Model identifier cannot be empty.");
      if (spec.cloud && !options.apiKey?.trim()) return fail(`${spec.name} requires an API key.`);
      try {
        new URL(target.baseUrl);
      } catch {
        return fail(`Invalid server URL format: ${target.baseUrl}`);
      }
      return { success: true, message: "Configuration parameters and credentials validated." };
    }

    if (step === "connection") {
      const started = Date.now();
      const headers = requestHeaders(spec, target.apiKey);
      let res: Response | undefined;
      let failure = "";
      // The model list is the cheapest authenticated call; the bare base URL still proves the host is up.
      for (const url of [endpointUrl(spec, target.baseUrl, "models"), target.baseUrl]) {
        try {
          res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
          break;
        } catch (err) {
          failure = errorMessage(err);
        }
      }
      if (!res) return fail(`Unable to connect to ${target.baseUrl}: ${failure}`);
      if (res.status === 401) return fail("Authentication failed. Please check your API key.");
      if (res.status >= 500) return fail(`${spec.name} server error with status ${res.status}.`);
      const latencyMs = Date.now() - started;
      return { success: true, message: `Connected to ${spec.name} endpoint at ${target.baseUrl} (${latencyMs}ms).`, latencyMs };
    }

    if (step === "inference") {
      const started = Date.now();
      try {
        const raw = await this.complete(
          [
            { role: "system", content: "You are a concise assistant." },
            { role: "user", content: "Say 'LLM connection verified' in exactly those words." },
          ],
          { ...typed, maxTokens: TEST_INFERENCE_MAX_TOKENS },
        );
        const latencyMs = Date.now() - started;
        const answer = sanitizeLlmResponse(raw);
        if (!answer) {
          // The model replied, but everything it produced was reasoning: the `<think>` block never closed within the budget.
          return {
            success: false,
            latencyMs,
            message:
              `Model produced ${raw.trim().length} characters of reasoning but no answer within ` +
              `${TEST_INFERENCE_MAX_TOKENS} tokens. Raise the token budget or turn off thinking for this model.`,
          };
        }
        return { success: true, message: `Inference response generated in ${latencyMs}ms.`, output: answer.slice(0, 300), latencyMs };
      } catch (err) {
        return fail(errorMessage(err));
      }
    }

    if (step === "integrity") {
      const output = options.previousOutput?.trim() || "";
      if (!output) return fail("Empty inference response received.");
      return { success: true, message: `Output verified: "${output.length > 80 ? `${output.slice(0, 80)}...` : output}"`, output };
    }

    return fail(`Unknown step identifier: ${step}`);
  }
}
