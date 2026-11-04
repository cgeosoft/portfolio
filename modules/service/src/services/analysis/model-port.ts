/**
 * The model port: one interface the harness talks to, whatever the provider.
 *
 *   step({ system, user, tools, output }) -> { calls, output, done, note }
 *
 * Two adapters translate it:
 * - native: OpenAI-compatible servers with tool calling get each tool as a
 *   real tool, plus a `submit` tool whose arguments are the phase output.
 * - json: the CLI providers (tools off by design) and any setup forced to it
 *   get the same catalog in the system prompt and answer with one JSON object
 *   `{"calls": [...], "output": {...}, "done": false, "note": "..."}`.
 *
 * Every prompt passes `toPromptSafe()`. The harness owns the loop, the
 * budgets and validation; the port only translates. Each step is a fresh
 * request built from the graph, so both adapters see the same state and a
 * run can resume after a restart.
 */
import type { AnalysisToolMode } from "portfolio-shared/api-types";
import { toPromptSafe } from "../llm-privacy.js";
import { sanitizeLlmResponse, type LlmMessage, type LlmService, type LlmToolSpec } from "../llm.js";
import { extractJsonObject } from "../json-reply.js";
import type { AnalysisTool, JsonSchema, ToolCall } from "./types.js";

export interface PortOutputSpec {
  name: string;
  description: string;
  schema: JsonSchema;
}

export interface PortRequest {
  system: string;
  user: string;
  /** Tools the model may call this step; empty in the one-call phases. */
  tools: readonly AnalysisTool[];
  output: PortOutputSpec;
  signal: AbortSignal;
  maxTokens?: number;
}

export interface PortTurn {
  calls: ToolCall[];
  output: Record<string, unknown> | null;
  done: boolean;
  note: string;
  /** Calls the adapter could not read (unknown tool, broken arguments), for the next prompt. */
  errors: string[];
}

export interface ModelPort {
  readonly mode: Exclude<AnalysisToolMode, "none">;
  step(req: PortRequest): Promise<PortTurn>;
}

const SUBMIT = "submit";
const TEMPERATURE = 0.2;

/** Every tool takes an optional question id, so a result can answer a question. */
function withQuestionId(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    properties: { ...(schema.properties ?? {}), question_id: { type: "string", description: "Id of the open question this call serves, such as Q2." } },
  };
}

function outputWithControl(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    properties: {
      ...(schema.properties ?? {}),
      done: { type: "boolean", description: "True when you need no more data for the open questions." },
      note: { type: "string", description: "One short sentence on what you did in this step." },
    },
  };
}

function readCall(name: string, rawArgs: unknown, index: number, tools: readonly AnalysisTool[], errors: string[]): ToolCall | null {
  if (!tools.some((t) => t.name === name)) {
    errors.push(`Unknown tool "${name}". Use only the tools listed.`);
    return null;
  }
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === "string") {
    try {
      args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      errors.push(`The arguments of ${name} were not valid JSON.`);
      return null;
    }
  } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  }
  const qid = args.question_id ?? args.questionId;
  delete args.question_id;
  delete args.questionId;
  return { id: `c${index + 1}`, name, args, questionId: typeof qid === "string" && qid.trim() ? qid.trim() : undefined };
}

function control(output: Record<string, unknown> | null): { done: boolean; note: string } {
  return {
    done: output?.done === true,
    note: typeof output?.note === "string" ? sanitizeLlmResponse(output.note).replace(/\s+/g, " ").slice(0, 240) : "",
  };
}

// ── native tools ────────────────────────────────────────────────────────────

class NativeToolsPort implements ModelPort {
  readonly mode = "native" as const;
  constructor(private readonly llm: LlmService) {}

  async step(req: PortRequest): Promise<PortTurn> {
    const specs: LlmToolSpec[] = [
      ...req.tools.map((t) => ({ name: t.name, description: toPromptSafe(t.description), parameters: withQuestionId(t.inputSchema) })),
      { name: SUBMIT, description: toPromptSafe(`Submit the ${req.output.name}: ${req.output.description}`), parameters: outputWithControl(req.output.schema) },
    ];
    const system = `${req.system}\n\nAnswer only with tool calls. Call data tools for facts you still need, and call "${SUBMIT}" once with your ${req.output.name}. You may call data tools and "${SUBMIT}" in the same turn.`;
    const messages: LlmMessage[] = [
      { role: "system", content: toPromptSafe(system) },
      { role: "user", content: toPromptSafe(req.user) },
    ];
    let reply = await this.llm.chatWithTools(messages, specs, { toolChoice: "required", temperature: TEMPERATURE, maxTokens: req.maxTokens ?? 4000, signal: req.signal });
    if (reply.toolCalls.length === 0 && !reply.text) {
      reply = await this.llm.chatWithTools(
        [...messages, { role: "user", content: toPromptSafe(`You returned nothing. Call "${SUBMIT}" now.`) }],
        specs,
        { toolChoice: "required", temperature: TEMPERATURE, maxTokens: req.maxTokens ?? 4000, signal: req.signal },
      );
    }
    const errors: string[] = [];
    const calls: ToolCall[] = [];
    let output: Record<string, unknown> | null = null;
    for (const [i, c] of reply.toolCalls.entries()) {
      if (c.name === SUBMIT) {
        try {
          output = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
        } catch {
          errors.push(`The arguments of ${SUBMIT} were not valid JSON.`);
        }
        continue;
      }
      const call = readCall(c.name, c.arguments, i, req.tools, errors);
      if (call) calls.push(call);
    }
    // Some servers put the answer in the text instead of a tool call.
    if (!output && reply.text) {
      try {
        output = extractJsonObject(reply.text);
      } catch {
        if (calls.length === 0) errors.push(`Answer with tool calls, not text.`);
      }
    }
    return { calls, output, ...control(output), errors };
  }
}

// ── JSON actions ────────────────────────────────────────────────────────────

function toolCatalogText(tools: readonly AnalysisTool[]): string {
  return tools
    .map((t) => {
      const props = Object.entries(t.inputSchema.properties ?? {})
        .map(([k, v]) => `${k}${t.inputSchema.required?.includes(k) ? "" : "?"}: ${v.type}${v.enum ? ` (${v.enum.join(" | ")})` : ""}`)
        .join(", ");
      return `- ${t.name}(${props}): ${t.description}`;
    })
    .join("\n");
}

class JsonActionsPort implements ModelPort {
  readonly mode = "json" as const;
  constructor(private readonly llm: LlmService) {}

  async step(req: PortRequest): Promise<PortTurn> {
    const calls = req.tools.length
      ? `"calls": [{"tool": "tool_name", "args": {...}, "questionId": "Q1"}], `
      : "";
    const system = `${req.system}

## How to answer
Reply with one JSON object and nothing else, in this shape:
{${calls}"output": <your ${req.output.name}>, "done": false, "note": "one short sentence on what you did"}
${req.tools.length ? `\n## Tools you may call\nThe app runs each call and adds the results to the graph for the next step. Leave "calls" empty when you need no more data.\n${toolCatalogText(req.tools)}\n` : ""}
## The "output" field: ${req.output.name}
${req.output.description}
JSON Schema: ${JSON.stringify(req.output.schema)}`;
    const messages: LlmMessage[] = [
      { role: "system", content: toPromptSafe(system) },
      { role: "user", content: toPromptSafe(req.user) },
    ];
    const first = await this.llm.chat(messages, { temperature: TEMPERATURE, maxTokens: req.maxTokens ?? 4000, signal: req.signal });
    let raw: Record<string, unknown>;
    try {
      raw = extractJsonObject(first);
    } catch (err) {
      // One repair turn, for models that drift from the format.
      const retry = await this.llm.chat(
        [
          ...messages,
          { role: "assistant", content: toPromptSafe(first.slice(0, 4000)) },
          { role: "user", content: toPromptSafe(`${err instanceof Error ? err.message : "Invalid answer"}. Reply again with only the JSON object in the given shape.`) },
        ],
        { temperature: 0.1, maxTokens: req.maxTokens ?? 4000, signal: req.signal },
      );
      raw = extractJsonObject(retry);
    }
    const errors: string[] = [];
    const list = Array.isArray(raw.calls) ? raw.calls : [];
    const parsed: ToolCall[] = [];
    list.forEach((c, i) => {
      if (!c || typeof c !== "object") return;
      const o = c as Record<string, unknown>;
      const name = typeof o.tool === "string" ? o.tool : typeof o.name === "string" ? o.name : "";
      const call = readCall(name, { ...(o.args && typeof o.args === "object" ? (o.args as object) : {}), ...(o.questionId ? { question_id: o.questionId } : {}) }, i, req.tools, errors);
      if (call) parsed.push(call);
    });
    const output = raw.output && typeof raw.output === "object" && !Array.isArray(raw.output) ? (raw.output as Record<string, unknown>) : null;
    const done = raw.done === true;
    const note = typeof raw.note === "string" ? sanitizeLlmResponse(raw.note).replace(/\s+/g, " ").slice(0, 240) : "";
    return { calls: parsed, output, done, note, errors };
  }
}

export function createModelPort(llm: LlmService, mode: Exclude<AnalysisToolMode, "none">): ModelPort {
  return mode === "native" ? new NativeToolsPort(llm) : new JsonActionsPort(llm);
}
