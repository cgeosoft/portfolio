/**
 * Pieces the Guided Analysis screens share: the AI capability hook, the
 * brief-saved event, node colours read from the design tokens, and the
 * small labels.
 */
import { useCallback, useEffect, useState } from "react";
import type { AiCapabilityResponse, AnalysisNode, AnalysisNodeKind } from "portfolio-shared/api-types";
import { api } from "../../api";
import { CONFIG_CHANGED_EVENT } from "../settings/SettingsFields";
import { t } from "../../i18n";

/** Fired after a brief is saved, with the portfolio id, so every view reloads it. */
export const BRIEF_SAVED_EVENT = "portfolio:brief-saved";

/** Fired to open a node of a run in the Analysis tab: `{ runId, nodeId }`. */
export const OPEN_ANALYSIS_NODE_EVENT = "portfolio:open-analysis-node";

export interface OpenAnalysisNodeDetail {
  runId?: string;
  nodeId?: string;
  /** A suggestion whose reasoning path should be highlighted. */
  suggestionId?: string;
}

export function openAnalysisNode(detail: OpenAnalysisNodeDetail): void {
  window.dispatchEvent(new CustomEvent<OpenAnalysisNodeDetail>(OPEN_ANALYSIS_NODE_EVENT, { detail }));
}

/**
 * Whether the AI features can run with the current setup. Reloads when a
 * setting changes. `probe()` repeats the tool-calling test.
 */
export function useAiCapability(): { capability: AiCapabilityResponse | null; loading: boolean; probe: () => Promise<void>; reload: () => Promise<void> } {
  const [capability, setCapability] = useState<AiCapabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (probe = false) => {
    setLoading(true);
    try {
      setCapability(await api.getAiCapability(probe));
    } catch {
      setCapability(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, onChange);
  }, [load]);

  return { capability, loading, probe: () => load(true), reload: () => load(false) };
}

/** The note under a disabled Run button, or null when a run can start. */
export function capabilityNote(capability: AiCapabilityResponse | null): string | null {
  if (!capability) return t("analysis.capability.unknown");
  if (capability.reason) return t(`analysis.capability.${capability.reason}`);
  if (!capability.toolMode) return t("analysis.capability.unknown");
  return null;
}

// ── colours ─────────────────────────────────────────────────────────────────

function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `rgb(${value})` : fallback;
}

export interface GraphPalette {
  accent: string;
  mint: string;
  cream: string;
  royal: string;
  plum: string;
  rose: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  card: string;
  canvas: string;
}

/** The token colours the canvas graph draws with; read at draw time so the theme applies. */
export function graphPalette(): GraphPalette {
  return {
    accent: token("--accent-rgb", "#dd3c73"),
    mint: token("--palette-mint-rgb", "#a7e2c0"),
    cream: token("--palette-cream-rgb", "#e3eacd"),
    royal: token("--palette-blue-bright-rgb", "#6d8bf7"),
    plum: token("--palette-purple-bright-rgb", "#a855f7"),
    rose: token("--rose-400-rgb", "#fb7185"),
    text: token("--slate-100-rgb", "#f1f5f9"),
    muted: token("--slate-400-rgb", "#94a3b8"),
    faint: token("--slate-600-rgb", "#475569"),
    line: token("--border-rgb", "#1e293b"),
    card: token("--bg-card-rgb", "#181d2b"),
    canvas: token("--bg-canvas-rgb", "#07090e"),
  };
}

/** The colour of a node: by kind, and by stance for findings. */
export function nodeColor(node: Pick<AnalysisNode, "kind" | "facts" | "status">, p: GraphPalette): string {
  if (node.status === "failed") return p.faint;
  switch (node.kind) {
    case "brief":
    case "allocation":
    case "report":
      return p.accent;
    case "holding":
      return p.text;
    case "question":
    case "event":
      return p.cream;
    case "news":
    case "macro":
      return p.royal;
    case "indicator":
    case "calc":
    case "metric":
    case "theme":
      return p.plum;
    case "company":
      return p.muted;
    case "finding":
      return node.facts.stance === "risk" ? p.rose : node.facts.stance === "opportunity" ? p.mint : p.muted;
    case "suggestion":
      return p.mint;
    default:
      return p.muted;
  }
}

/** Node kinds in the order the filters list them. */
export const KIND_ORDER: readonly AnalysisNodeKind[] = [
  "brief",
  "allocation",
  "holding",
  "question",
  "finding",
  "theme",
  "suggestion",
  "news",
  "indicator",
  "calc",
  "metric",
  "macro",
  "company",
  "event",
  "report",
];

export const kindLabel = (kind: AnalysisNodeKind) => t(`analysis.kinds.${kind}`);

export function phaseLabel(phase: string): string {
  return t(`analysis.phases.${phase}`);
}
