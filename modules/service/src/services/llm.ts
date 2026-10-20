/**
 * LLM client for the inference providers.
 *
 * `openai-compatible` speaks OpenAI chat completions over HTTP to any server
 * or cloud API that offers them (llama.cpp, Ollama, LM Studio, vLLM, OpenAI,
 * Groq, OpenRouter and others). The CLI providers run a vendor CLI on this
 * machine with the user's own sign-in: `claude-cli` (Claude Code, Claude
 * subscription, claude-cli.ts) and `codex-cli` (Codex, ChatGPT plan,
 * codex-cli.ts). Gemini CLI is not one: Google's terms forbid third-party
 * software from using its Google sign-in, so Gemini goes through an API key.
 * Options given by the caller win over the settings, which win over the
 * defaults.
 */

import { isSameServer, loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import { fetchWithCheckedRedirects } from "./outbound-target.js";
import { CLI_PROVIDER_MODELS, CLI_PROVIDER_NAMES, DEFAULT_OPENAI_COMPATIBLE_URL, type CliProviderId } from "portfolio-shared/llm-defaults";
import type { CliProviderStatusResponse } from "portfolio-shared/api-types";
import { claudeCliComplete, getClaudeCliStatus } from "./claude-cli.js";
import { codexCliComplete, getCodexCliStatus } from "./codex-cli.js";

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

/** Everything a request needs once options, settings and defaults are merged. */
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

export type ProviderId = "openai-compatible" | CliProviderId;

/** A vendor CLI on this machine: its sign-in check and one completion. */
interface CliProvider {
  name: string;
  status(): Promise<CliProviderStatusResponse>;
  complete(messages: LlmMessage[], options: { model?: string; signal: AbortSignal; onChunk?: (chunk: string) => void }): Promise<string>;
}

const CLI_PROVIDERS: Record<CliProviderId, CliProvider> = {
  "claude-cli": { name: CLI_PROVIDER_NAMES["claude-cli"], status: getClaudeCliStatus, complete: claudeCliComplete },
  "codex-cli": { name: CLI_PROVIDER_NAMES["codex-cli"], status: getCodexCliStatus, complete: codexCliComplete },
};

const PROVIDER_NAMES: Record<ProviderId, string> = { "openai-compatible": "OpenAI-compatible", ...CLI_PROVIDER_NAMES };

function isCliProvider(id: ProviderId): id is CliProviderId {
  return id !== "openai-compatible";
}

/**
 * The CLI provider ids are kept; every other stored id maps to the
 * OpenAI-compatible provider. Earlier versions stored one id per server or
 * cloud (llamacpp, ollama, groq, ...); their base URL and key still apply
 * through the `llmBaseUrl` / `llmApiKey` settings.
 */
function normalizeProvider(raw: string | undefined): ProviderId {
  const id = (raw || "").toLowerCase().trim();
  return Object.hasOwn(CLI_PROVIDERS, id) ? (id as CliProviderId) : "openai-compatible";
}

/**
 * Token budget for the diagnostic inference step. Reasoning models such as
 * Qwen3 spend their first few hundred tokens inside `<think>`, so a tight
 * budget truncates the reply before the block closes and leaves nothing once
 * the thinking is stripped.
 */
const TEST_INFERENCE_MAX_TOKENS = 512;

/** How long an auto-detected server model name stays valid. */
const SERVER_MODEL_CACHE_MS = 60_000;

const REQUEST_TIMEOUT_MS = 120_000;

/** A CLI starts a fresh session per request, so it gets more time than an HTTP call. */
const CLI_TIMEOUT_MS = 300_000;

/** A request with the caller's own signal (a report stream) lives at most as long as its session, 15 minutes (portfolio-report.ts). */
const CALLER_SIGNAL_LIMIT_MS = 15 * 60_000;

/** The caller's signal capped at the session lifetime, else the request's own limit: a stalled server never holds a request forever. */
function requestSignal(signal: AbortSignal | undefined, limitMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(CALLER_SIGNAL_LIMIT_MS)]) : AbortSignal.timeout(limitMs);
}

/** Only http(s) servers: Bun's fetch also reads `file:` and `data:` URLs, and a base URL can come from a request. */
function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** A provider's error body as one short line: some echo the request back, some send a whole HTML page. */
function shortDetail(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

// ── URLs, headers and reply shapes ──────────────────────────────────────────

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

function requestHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

interface ChatReply {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
}

/** Text of a non-streamed reply; empty when the server returned none. */
function replyText(json: ChatReply): string {
  const message = json.choices?.[0]?.message;
  if (message?.content?.trim()) return message.content;
  // Servers started with `--reasoning-format deepseek` return the thinking in
  // a separate field and leave `content` empty. Re-wrap it so callers see the
  // same shape as inline `<think>` output instead of a blank string.
  const reasoning = message?.reasoning_content?.trim();
  return reasoning ? `<think>${reasoning}</think>` : "";
}

/** Text carried by one SSE `data:` line of a streamed reply. */
function streamDelta(line: string): string {
  let payload = line.trim();
  if (!payload.startsWith("data:")) return "";
  payload = payload.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const frame = JSON.parse(payload);
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

// ── request parameters per model ────────────────────────────────────────────

/** Which sampling and length fields a chat completion request carries. */
export interface RequestShape {
  temperature: boolean;
  tokenField: "max_tokens" | "max_completion_tokens";
}

/**
 * Request fields the model accepts, judged from its name. Claude Opus 4.7 and
 * every Claude model from generation 5 on (Fable and Mythos included) reject a
 * temperature; Sonnet 5.5 and Haiku 5.5 accept only the default, so leaving it
 * out is correct there too. OpenAI reasoning models (o1, o3, o4-mini, GPT-5)
 * take no temperature and want `max_completion_tokens`. Gateways prefix the
 * name (`anthropic/`, `us.anthropic.`, `openai/`), so only the last path
 * segment counts and the Claude match is not anchored.
 */
export function requestShapeFor(model: string): RequestShape {
  const name = (model.split("/").pop() ?? "").toLowerCase();
  if (/^(o\d+)(-|$)|^gpt-5/.test(name)) return { temperature: false, tokenField: "max_completion_tokens" };
  return { temperature: !rejectsClaudeSampling(name), tokenField: "max_tokens" };
}

function rejectsClaudeSampling(name: string): boolean {
  // Family-first ids only: the older `claude-3-5-sonnet` style all accept a temperature.
  const match = /claude-(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:[-.](\d{1,2})(?!\d))?)?/.exec(name);
  if (!match) return false;
  if (match[1] === "fable" || match[1] === "mythos") return true;
  const major = Number(match[2] ?? 0);
  const minor = Number(match[3] ?? 0);
  return major >= 5 || (major === 4 && minor >= 7);
}

/**
 * The shape to retry with when a 400 names a field the model refuses, or
 * null when the error is about something else. Covers models the name match
 * above does not know yet.
 */
function shapeAfterRejection(shape: RequestShape, error: string): RequestShape | null {
  const text = error.toLowerCase();
  if (shape.temperature && text.includes("temperature")) return { ...shape, temperature: false };
  if (shape.tokenField === "max_tokens" && text.includes("max_completion_tokens")) return { ...shape, tokenField: "max_completion_tokens" };
  return null;
}

interface ModelList {
  data?: Array<{ id?: string; status?: { value?: string } }>;
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
  /** Model auto-detected per server base URL, see detectServerModel(). */
  private static readonly detectedModels = new Map<string, { model: string; at: number }>();
  /** Request fields learned from a rejected request, per server base URL and model. */
  private static readonly learnedShapes = new Map<string, RequestShape>();

  /**
   * Merges request options, the stored settings and the defaults. The single
   * `llmModel` / `llmApiKey` / `llmBaseUrl` settings mirror the provider
   * chosen in Settings; the per-provider maps hold the other one. The stored
   * key goes only to the stored server: options that name another server
   * (Test, model list) must carry their own key.
   */
  public resolve(options: LlmChatOptions = {}): LlmTarget {
    const config = loadConfig();
    const provider = normalizeProvider(options.provider || config.llmProvider);
    const isCurrent = normalizeProvider(config.llmProvider) === provider;
    const stored = (map: Record<string, string> | undefined) => map?.[provider]?.trim() || "";
    const current = (value: string | undefined) => (isCurrent ? value?.trim() : "");
    const isCli = isCliProvider(provider);
    const storedUrl = stored(config.llmBaseUrls) || current(config.llmBaseUrl) || DEFAULT_OPENAI_COMPATIBLE_URL;
    const baseUrl = (options.baseUrl?.trim() || storedUrl).replace(/\/+$/, "");
    const storedKey = isSameServer(baseUrl, storedUrl) ? stored(config.llmApiKeys) || current(config.llmApiKey) || "" : "";
    return {
      provider,
      name: PROVIDER_NAMES[provider],
      model: options.model?.trim() || stored(config.llmModels) || current(config.llmModel) || "",
      apiKey: isCli ? "" : options.apiKey?.trim() || storedKey,
      baseUrl: isCli ? "" : baseUrl,
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

    appLogger.logStep("info", "llm", onChunk ? "chat_stream" : "chat", "Executing chat request", undefined, {
      provider: target.provider,
      model: target.model || "default",
    });

    if (isCliProvider(target.provider)) {
      return CLI_PROVIDERS[target.provider].complete(messages, {
        model: target.model,
        signal: requestSignal(options.signal, CLI_TIMEOUT_MS),
        onChunk,
      });
    }

    if (!isHttpUrl(target.baseUrl)) throw new Error(`${target.name} server URL must start with http:// or https://`);
    if (!target.model) target.model = await this.detectServerModel(target);
    const signal = requestSignal(options.signal, REQUEST_TIMEOUT_MS);
    const shapeKey = `${target.baseUrl}\n${target.model}`;
    let shape = LlmService.learnedShapes.get(shapeKey) ?? requestShapeFor(target.model);
    const send = (s: RequestShape) =>
      fetchWithCheckedRedirects(buildOpenAIUrl(target.baseUrl, "chat/completions"), {
        method: "POST",
        headers: requestHeaders(target.apiKey),
        body: JSON.stringify({
          model: target.model || undefined, // omitted when empty: llama.cpp answers with the model it was started with
          messages,
          ...(s.temperature ? { temperature: target.temperature } : {}),
          [s.tokenField]: options.maxTokens ?? 3000,
          stream: Boolean(onChunk),
        }),
        signal,
      });

    let res = await send(shape);
    // A model the name match missed rejects the field with a 400 that names it. Retry
    // once without it and remember the answer for this server and model.
    for (let attempt = 0; !res.ok; attempt++) {
      const detail = await res.text().catch(() => "");
      const retry = res.status === 400 && attempt === 0 ? shapeAfterRejection(shape, detail) : null;
      if (!retry) throw new Error(`${target.name} API request failed with status ${res.status}: ${shortDetail(detail)}`);
      appLogger.logStep("warning", "llm", "chat", "Model rejected a request field, retrying without it", undefined, {
        model: target.model || "default",
        temperature: retry.temperature,
        tokenField: retry.tokenField,
      });
      shape = retry;
      LlmService.learnedShapes.set(shapeKey, shape);
      res = await send(shape);
    }

    if (!onChunk) {
      const text = replyText((await res.json()) as ChatReply);
      if (!text) throw new Error(`No completion content returned from ${target.name}`);
      return text;
    }
    if (!res.body) throw new Error(`No response body returned from ${target.name}`);
    let full = "";
    await readLines(res.body, signal, (line) => {
      const delta = streamDelta(line);
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
  private async detectServerModel(target: LlmTarget): Promise<string> {
    const cached = LlmService.detectedModels.get(target.baseUrl);
    if (cached && Date.now() - cached.at < SERVER_MODEL_CACHE_MS) return cached.model;
    try {
      const res = await fetchWithCheckedRedirects(buildOpenAIUrl(target.baseUrl, "models"), {
        headers: requestHeaders(target.apiKey),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return "";
      const models = (((await res.json()) as ModelList).data ?? []).filter((m) => m.id);
      const model = (models.find((m) => m.status?.value === "loaded") ?? models[0])?.id ?? "";
      if (model) LlmService.detectedModels.set(target.baseUrl, { model, at: Date.now() });
      return model;
    } catch {
      return ""; // offline or no model listing
    }
  }

  /** Model names the provider offers; empty when the server is offline or does not list models. */
  public async getAvailableModels(provider: string, baseUrl?: string, apiKey?: string): Promise<string[]> {
    const target = this.resolve({ provider, baseUrl, apiKey });
    if (isCliProvider(target.provider)) return [...CLI_PROVIDER_MODELS[target.provider]];
    if (!isHttpUrl(target.baseUrl)) return [];
    try {
      const res = await fetchWithCheckedRedirects(buildOpenAIUrl(target.baseUrl, "models"), {
        headers: requestHeaders(target.apiKey),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const list = (await res.json()) as ModelList;
      return (list.data ?? []).map((m) => m.id).filter((n): n is string => Boolean(n));
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
    const cli = isCliProvider(target.provider) ? CLI_PROVIDERS[target.provider] : null;

    if (step === "config") {
      // The model may stay empty: the server or the CLI then picks its default.
      if (cli) return { success: true, message: `${cli.name} with ${target.model ? `model "${target.model}"` : "its default model"}.` };
      if (!isHttpUrl(target.baseUrl)) return fail(`Invalid server URL format: ${target.baseUrl}. Use an http:// or https:// address.`);
      return { success: true, message: "Configuration parameters and credentials validated." };
    }

    if (step === "connection") {
      const started = Date.now();
      if (cli) {
        const status = await cli.status();
        if (!status.installed || !status.loggedIn) return fail(status.message);
        return { success: true, message: status.message, latencyMs: Date.now() - started };
      }
      if (!isHttpUrl(target.baseUrl)) return fail(`Invalid server URL format: ${target.baseUrl}. Use an http:// or https:// address.`);
      const headers = requestHeaders(target.apiKey);
      let res: Response | undefined;
      let failure = "";
      // The model list is the cheapest authenticated call; the bare base URL still proves the host is up.
      for (const url of [buildOpenAIUrl(target.baseUrl, "models"), target.baseUrl]) {
        try {
          res = await fetchWithCheckedRedirects(url, { headers, signal: AbortSignal.timeout(4000) });
          break;
        } catch (err) {
          failure = errorMessage(err);
        }
      }
      if (!res) return fail(`Unable to connect to ${target.baseUrl}: ${failure}`);
      if (res.status === 401) return fail("Authentication failed. Please check your API key.");
      if (res.status >= 500) return fail(`${target.name} server error with status ${res.status}.`);
      const latencyMs = Date.now() - started;
      return { success: true, message: `Connected to ${target.name} endpoint at ${target.baseUrl} (${latencyMs}ms).`, latencyMs };
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

  /** Whether the CLI of a CLI provider is installed on this machine and signed in. */
  public cliStatus(provider: string): Promise<CliProviderStatusResponse> {
    const id = normalizeProvider(provider);
    if (!isCliProvider(id) || id !== provider.toLowerCase().trim()) {
      return Promise.resolve({ installed: false, loggedIn: false, message: `Unknown CLI provider: ${provider}` });
    }
    return CLI_PROVIDERS[id].status();
  }
}
