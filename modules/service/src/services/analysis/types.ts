/**
 * Contracts of the Guided Analysis harness: tools, the context a tool runs
 * in, and the JSON Schema subset the tool and output schemas use.
 */
import type { AnalysisNode } from "portfolio-shared/api-types";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { AiContextDeps } from "../ai-context.js";
import type { MetricsService } from "../metrics/index.js";
import type { RunGraph } from "./graph.js";

/** The JSON Schema subset tool inputs and model outputs use. */
export interface JsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  additionalProperties?: boolean;
}

/** The services the tools read from. `AppServices` (container.ts) satisfies it. */
export interface AnalysisDeps extends AiContextDeps {
  metricsService?: MetricsService;
}

export interface ToolContext {
  runId: string;
  portfolioId: string;
  baseCurrency: string;
  /** The portfolio as the run started; tools never read the ledger again. */
  data: FinancialPortfolioData;
  deps: AnalysisDeps;
  graph: RunGraph;
  /** Per-run memo for slow fetches shared by several tools (charts). */
  memo: Map<string, Promise<unknown>>;
  /** Depth of the nodes this call adds. */
  depth: number;
  /** Relevance the new nodes start from. */
  relevance: number;
  signal: AbortSignal;
}

export interface AnalysisTool {
  name: string;
  /** One or two sentences for the model. */
  description: string;
  inputSchema: JsonSchema;
  /** Calls allowed per run, to respect the provider throttles. */
  maxCallsPerRun: number;
  /** Time limit of one call. */
  timeoutMs: number;
  /**
   * Adds its nodes and edges to `ctx.graph` and returns the new nodes. A
   * throw becomes a failed node the model can see. Read-only: a tool never
   * changes the ledger.
   */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<AnalysisNode[]>;
}

/** A tool call the model asked for. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** The question the call serves, when the model named one. */
  questionId?: string;
}

/** Thrown by a tool for a request it cannot serve: the model sees the message. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
