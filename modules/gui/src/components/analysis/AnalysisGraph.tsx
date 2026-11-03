/**
 * The evidence graph of a run, drawn with Cytoscape.js on a canvas: the
 * brief and the allocation at the centre, rings by depth, colour by node
 * kind (findings by stance), filters by kind. Clicking a node selects it;
 * `highlight` dims everything outside a reasoning path. New nodes of a live
 * run are added in place and the rings are laid out again.
 *
 * Cytoscape loads on first use, so the app start does not pay for it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Core, ElementDefinition } from "cytoscape";
import type { AnalysisEdge, AnalysisNode, AnalysisNodeKind } from "portfolio-shared/api-types";
import { RefreshCw } from "lucide-react";
import { t } from "../../i18n";
import { KIND_ORDER, graphPalette, kindLabel, nodeColor } from "./shared";

interface AnalysisGraphProps {
  nodes: readonly AnalysisNode[];
  edges: readonly AnalysisEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Node ids of a reasoning path; the rest is dimmed. */
  highlight?: ReadonlySet<string> | null;
  /** Kinds left out of the drawing. */
  hiddenKinds: ReadonlySet<AnalysisNodeKind>;
}

const label = (n: AnalysisNode) => {
  const title = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
  return `${n.id} ${title}`;
};

function elementsOf(nodes: readonly AnalysisNode[], edges: readonly AnalysisEdge[], hidden: ReadonlySet<AnalysisNodeKind>): ElementDefinition[] {
  const p = graphPalette();
  const shown = nodes.filter((n) => !hidden.has(n.kind) && n.status !== "pruned");
  const ids = new Set(shown.map((n) => n.id));
  return [
    ...shown.map((n) => ({
      group: "nodes" as const,
      data: {
        id: n.id,
        label: label(n),
        color: nodeColor(n, p),
        depth: n.depth,
        size: n.kind === "brief" || n.kind === "allocation" ? 34 : 14 + Math.round(n.relevance * 16),
        kind: n.kind,
        failed: n.status === "failed" ? 1 : 0,
      },
    })),
    ...edges
      .filter((e) => ids.has(e.sourceId) && ids.has(e.targetId))
      .map((e) => ({
        group: "edges" as const,
        data: {
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          type: e.type,
          color: e.type === "contradicts" ? p.rose : e.type === "supports" || e.type === "motivates" ? p.mint : p.faint,
        },
      })),
  ];
}

export function AnalysisGraph({ nodes, edges, selectedId, onSelect, highlight, hiddenKinds }: AnalysisGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const elements = useMemo(() => elementsOf(nodes, edges, hiddenKinds), [nodes, edges, hiddenKinds]);

  // Create the graph once.
  useEffect(() => {
    let disposed = false;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || !containerRef.current) return;
      const p = graphPalette();
      const cy = cytoscape({
        container: containerRef.current,
        elements: [],
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.3,
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              width: "data(size)",
              height: "data(size)",
              label: "data(label)",
              color: p.muted,
              "font-family": "JetBrains Mono, monospace",
              "font-size": 8,
              "text-valign": "bottom",
              "text-margin-y": 3,
              "text-max-width": "120px",
              "text-wrap": "ellipsis",
              "border-width": 0,
            },
          },
          { selector: "node[kind = 'brief'], node[kind = 'allocation']", style: { "font-size": 10, color: p.text, "font-weight": "bold" } },
          { selector: "node[kind = 'question']", style: { shape: "diamond" } },
          { selector: "node[kind = 'finding']", style: { shape: "round-rectangle" } },
          { selector: "node[kind = 'suggestion']", style: { shape: "star" } },
          { selector: "node[kind = 'theme']", style: { shape: "hexagon" } },
          { selector: "node[failed = 1]", style: { opacity: 0.45 } },
          { selector: "node:selected", style: { "border-width": 3, "border-color": p.accent, color: p.text } },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": "data(color)",
              "target-arrow-color": "data(color)",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.6,
              "curve-style": "bezier",
              opacity: 0.7,
            },
          },
          { selector: "edge[type = 'contradicts']", style: { "line-style": "dashed", width: 1.5 } },
          { selector: ".dim", style: { opacity: 0.12 } },
          { selector: "node.path", style: { "border-width": 2, "border-color": p.mint, color: p.text } },
          { selector: "edge.path", style: { width: 2, opacity: 1 } },
        ],
      });
      cy.on("tap", "node", (e) => onSelectRef.current(e.target.id()));
      cy.on("tap", (e) => {
        if (e.target === cy) onSelectRef.current(null);
      });
      cyRef.current = cy;
      setReady(true);
    });
    return () => {
      disposed = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  // Add, change and remove elements, then lay the rings out again when the set changed.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    const wanted = new Set(elements.map((e) => e.data.id as string));
    let changed = false;
    cy.batch(() => {
      cy.elements().forEach((el) => {
        if (!wanted.has(el.id())) {
          el.remove();
          changed = true;
        }
      });
      for (const el of elements) {
        const existing = cy.getElementById(el.data.id as string);
        if (existing.nonempty()) existing.data(el.data);
        else {
          cy.add(el);
          changed = true;
        }
      }
    });
    if (changed) {
      const maxDepth = Math.max(1, ...cy.nodes().map((n) => Number(n.data("depth")) || 0));
      cy.layout({
        name: "concentric",
        concentric: (n) => maxDepth - (Number(n.data("depth")) || 0),
        levelWidth: () => 1,
        minNodeSpacing: 18,
        animate: false,
        fit: true,
        padding: 24,
      }).run();
    }
  }, [elements, ready]);

  // Selection and reasoning path.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    cy.batch(() => {
      cy.elements().unselect().removeClass("dim path");
      if (highlight && highlight.size > 0) {
        cy.elements().addClass("dim");
        cy.nodes().filter((n) => highlight.has(n.id())).removeClass("dim").addClass("path");
        cy.edges().filter((e) => highlight.has(e.source().id()) && highlight.has(e.target().id())).removeClass("dim").addClass("path");
      }
      if (selectedId) cy.getElementById(selectedId).select();
    });
    if (selectedId) {
      const node = cy.getElementById(selectedId);
      if (node.nonempty()) cy.animate({ center: { eles: node } }, { duration: 200 });
    }
  }, [selectedId, highlight, ready, elements]);

  return (
    <div className="relative w-full h-full min-h-[360px]">
      <div ref={containerRef} className="absolute inset-0" aria-label={t("analysis.graph.ariaLabel")} role="img" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <RefreshCw className="w-5 h-5 text-accent-400 animate-spin" />
        </div>
      )}
    </div>
  );
}

/** Kind filter chips under the graph. */
export function KindFilters({ nodes, hidden, onToggle }: { nodes: readonly AnalysisNode[]; hidden: ReadonlySet<AnalysisNodeKind>; onToggle: (kind: AnalysisNodeKind) => void }) {
  const p = graphPalette();
  const counts = new Map<AnalysisNodeKind, number>();
  for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  return (
    <div className="flex flex-wrap gap-1.5">
      {KIND_ORDER.filter((k) => counts.has(k)).map((k) => {
        const off = hidden.has(k);
        const sample = nodes.find((n) => n.kind === k)!;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(k)}
            aria-pressed={!off}
            className={`h-6 inline-flex items-center gap-1.5 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
              off ? "border-slate-800 text-slate-600" : "border-slate-700 text-slate-300 hover:border-slate-600"
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: off ? "transparent" : nodeColor({ ...sample, facts: k === "finding" ? { stance: "risk" } : sample.facts, status: "ready" }, p), border: off ? "1px solid currentColor" : undefined }} />
            {kindLabel(k)} {counts.get(k)}
          </button>
        );
      })}
    </div>
  );
}
