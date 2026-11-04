/**
 * What the model sees of the graph each step: the brief, the allocation, the
 * open questions and node summaries ranked by relevance, cut to a character
 * budget. Only `summary`, `title` and, for app-made nodes, a compact copy of
 * `facts` reach the prompt; `local` never does. Pruned nodes stay stored but
 * leave the prompt; failed tool calls show as one line so the model does not
 * ask for the same thing again.
 */
import type { AnalysisNode } from "portfolio-shared/api-types";
import { MODEL_KINDS, type RunGraph } from "./graph.js";

/** Characters of graph text per prompt. */
export const CONTEXT_BUDGET_CHARS = 14_000;
/** Facts shown in full for this many of the most relevant app nodes. */
const FACT_NODES = 12;
const FACT_CHARS = 500;

function factsText(node: AnalysisNode): string {
  const rest: Record<string, unknown> = { ...node.facts };
  if (node.kind !== "company") delete rest.text; // the summary carries it already; company data is longer than a summary
  const json = JSON.stringify(rest);
  return json.length > FACT_CHARS ? `${json.slice(0, FACT_CHARS - 3)}...` : json;
}

export function nodeLine(node: AnalysisNode, withFacts = false): string {
  if (node.status === "failed") return `[${node.id}] ${node.kind} FAILED (${node.createdBy}): ${node.summary}`;
  const facts = withFacts && !MODEL_KINDS.has(node.kind) && node.kind !== "brief" ? ` | facts ${factsText(node)}` : "";
  return `[${node.id}] ${node.kind} | ${node.title}: ${node.summary}${facts}`;
}

export function openQuestions(graph: RunGraph): AnalysisNode[] {
  return graph
    .byKind("question")
    .filter((q) => q.status === "ready" && q.facts.status !== "closed")
    .sort((a, b) => b.relevance - a.relevance);
}

export interface ContextOptions {
  /** Nodes that must be in the text, such as the questions of this step. */
  focus?: readonly string[];
  budget?: number;
  /** Leave out these kinds from the ranked evidence. */
  exclude?: readonly AnalysisNode["kind"][];
}

/** The graph as prompt text. */
export function graphContext(graph: RunGraph, options: ContextOptions = {}): string {
  const budget = options.budget ?? CONTEXT_BUDGET_CHARS;
  const brief = graph.get("B");
  const allocation = graph.get("A");
  const parts: string[] = [];
  if (brief) parts.push(`## Brief [B]\n${brief.summary}${brief.facts.prose ? `\nIn the user's words: ${String(brief.facts.prose)}` : ""}`);
  if (allocation) parts.push(`## Allocation [A]\n${allocation.summary}`);

  const open = openQuestions(graph);
  if (open.length) parts.push(`## Open questions\n${open.map((q) => `[${q.id}] (brief field: ${String(q.facts.briefField ?? "general")}) ${q.title}`).join("\n")}`);

  const findings = graph.byKind("finding").filter((f) => f.status === "ready");
  if (findings.length) parts.push(`## Findings so far\n${findings.map((f) => nodeLine(f)).join("\n")}`);

  const focus = new Set(options.focus ?? []);
  const exclude = new Set<AnalysisNode["kind"]>(["brief", "allocation", "question", "finding", "suggestion", "report", ...(options.exclude ?? [])]);
  const ranked = graph.nodes
    .filter((n) => !exclude.has(n.kind) && n.status !== "pruned")
    .sort((a, b) => Number(focus.has(b.id)) - Number(focus.has(a.id)) || b.relevance - a.relevance || a.depth - b.depth);
  let used = parts.join("\n\n").length;
  const lines: string[] = [];
  let withFacts = 0;
  let left = 0;
  for (const node of ranked) {
    const line = nodeLine(node, withFacts < FACT_NODES);
    if (used + line.length + 1 > budget) {
      left++;
      continue;
    }
    if (!MODEL_KINDS.has(node.kind)) withFacts++;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length) parts.push(`## Evidence (most relevant first)\n${lines.join("\n")}${left ? `\n(${left} less relevant nodes left out)` : ""}`);
  return parts.join("\n\n");
}

/** The ids of every node the model may cite. */
export function citableIds(graph: RunGraph): Set<string> {
  return new Set(graph.nodes.filter((n) => n.status === "ready" && n.kind !== "suggestion" && n.kind !== "report").map((n) => n.id));
}
