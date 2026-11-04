/**
 * The evidence graph of a run, drawn with Cytoscape.js on a canvas. The brief
 * and the allocation sit at the centre and evidence fans out in rings along a
 * radial tree (`graph-layout.ts`). Colour follows the node kind, findings by
 * stance. Clicking a node selects it; hovering lights up its links; `highlight`
 * dims everything outside a reasoning path.
 *
 * The graph builds itself: nodes wait in a queue in creation order and grow
 * out of their parent one by one, while the nodes already drawn glide to make
 * room. A live run feeds the queue on every poll; opening a finished run plays
 * its growth back quickly. The camera follows the growth until the user pans
 * or zooms; a double click on the background hands it back.
 *
 * Cytoscape loads on first use, so the app start does not pay for it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Core, ElementDefinition, NodeSingular } from "cytoscape";
import type { AnalysisEdge, AnalysisNode, AnalysisNodeKind } from "portfolio-shared/api-types";
import { RefreshCw } from "lucide-react";
import { t } from "../../i18n";
import { compareNodes, radialLayout, type GraphLayout } from "./graph-layout";
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

/** How long one node takes to grow out of its parent. */
const GROW_MS = 520;
/** How long the drawn nodes and the camera take to make room. */
const MOVE_MS = 640;
const GLOW_MS = 1_100;
const EDGE_MS = 420;
/** The queue of a poll drains before the next poll arrives. */
const LIVE_BUDGET_MS = 1_800;
const OPEN_BUDGET_MS = 2_800;
const MIN_STEP_MS = 28;
const MAX_STEP_MS = 240;

const FIT_PADDING_X = 64;
const FIT_PADDING_Y = 36;
const MAX_FIT_ZOOM = 1.5;

/** Label size on screen; a framed graph sits zoomed out, so the drawn size grows to match. */
const LABEL_FONT = 10;
const LABEL_WIDTH = 124;
const MAX_LABEL_SCALE = 2.6;

const TREE_EDGE_OPACITY = 0.5;
const CROSS_EDGE_OPACITY = 0.09;
const CONTRADICTION_OPACITY = 0.4;

/** Kinds that keep their label; the rest show it on hover and selection. */
const LABELLED: ReadonlySet<AnalysisNodeKind> = new Set(["brief", "allocation", "holding", "finding", "suggestion", "report"]);

const label = (n: AnalysisNode) => (n.title.length > 36 ? `${n.title.slice(0, 35)}…` : n.title);

const nodeSize = (n: AnalysisNode) => (n.kind === "brief" || n.kind === "allocation" ? 40 : 14 + Math.round(n.relevance * 14));

function elementsOf(nodes: readonly AnalysisNode[], edges: readonly AnalysisEdge[], hidden: ReadonlySet<AnalysisNodeKind>, layout: GraphLayout): ElementDefinition[] {
  const p = graphPalette();
  const shown = nodes.filter((n) => !hidden.has(n.kind) && n.status !== "pruned").sort(compareNodes);
  const ids = new Set(shown.map((n) => n.id));
  return [
    ...shown.map((n) => ({
      group: "nodes" as const,
      data: {
        id: n.id,
        label: label(n),
        color: nodeColor(n, p),
        size: nodeSize(n),
        kind: n.kind,
        side: layout.positions.get(n.id)?.side ?? "bottom",
        labelled: LABELLED.has(n.kind) ? 1 : 0,
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
          tree: layout.parents.get(e.sourceId) === e.targetId || layout.parents.get(e.targetId) === e.sourceId ? 1 : 0,
          color: e.type === "contradicts" ? p.rose : e.type === "supports" || e.type === "motivates" ? p.mint : p.faint,
        },
      })),
  ];
}

const edgeOpacity = (data: { type?: string; tree?: number }) => (data.type === "contradicts" ? CONTRADICTION_OPACITY : data.tree ? TREE_EDGE_OPACITY : CROSS_EDGE_OPACITY);

export function AnalysisGraph({ nodes, edges, selectedId, onSelect, highlight, hiddenKinds }: AnalysisGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<SVGGElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  const layout = useMemo(() => {
    const kept = nodes.filter((n) => n.status !== "pruned");
    const ids = new Set(kept.map((n) => n.id));
    return radialLayout(kept, edges.filter((e) => ids.has(e.sourceId) && ids.has(e.targetId)));
  }, [nodes, edges]);
  const elements = useMemo(() => elementsOf(nodes, edges, hiddenKinds, layout), [nodes, edges, hiddenKinds, layout]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const wantedRef = useRef(new Map<string, ElementDefinition>());
  const queueRef = useRef<string[]>([]);
  const stepRef = useRef(MAX_STEP_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Nodes still growing; they settle on their latest target when they finish. */
  const growingRef = useRef(new Set<string>());
  const runRef = useRef<string | null>(null);
  const followRef = useRef(true);
  const hoverRef = useRef<string | null>(null);
  const labelRef = useRef({ font: LABEL_FONT, wrap: LABEL_WIDTH });

  // Dims and lights elements for the path, the hovered node and the selection.
  const paintRef = useRef(() => {});
  paintRef.current = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().unselect().removeClass("dim path near");
      if (highlight && highlight.size > 0) {
        cy.elements().addClass("dim");
        cy.nodes().filter((n) => highlight.has(n.id())).removeClass("dim").addClass("path");
        cy.edges().filter((e) => highlight.has(e.source().id()) && highlight.has(e.target().id())).removeClass("dim").addClass("path");
      } else {
        const focus = cy.getElementById(hoverRef.current ?? selectedId ?? "");
        if (focus.nonempty()) {
          const near = focus.closedNeighborhood();
          cy.elements().not(near).addClass("dim");
          near.addClass("near");
        }
      }
      if (selectedId) cy.getElementById(selectedId).select();
    });
  };
  const focusedRef = useRef(false);
  focusedRef.current = Boolean(selectedId || highlight?.size);

  /** Frames the whole layout, queued nodes included, so the camera moves once per batch. */
  const frameRef = useRef((_animate: boolean) => {});
  frameRef.current = (animate) => {
    const cy = cyRef.current;
    if (!cy || !followRef.current) return;
    const width = cy.width();
    const height = cy.height();
    if (width === 0 || height === 0) return;
    const { x1, y1, x2, y2 } = layoutRef.current.bounds;
    const zoom = Math.min(
      MAX_FIT_ZOOM,
      Math.max(60, width - 2 * FIT_PADDING_X) / Math.max(1, x2 - x1),
      Math.max(60, height - 2 * FIT_PADDING_Y) / Math.max(1, y2 - y1),
    );
    const scale = Math.min(MAX_LABEL_SCALE, Math.max(1, 1 / zoom));
    labelRef.current = { font: LABEL_FONT * scale, wrap: LABEL_WIDTH * scale };
    cy.batch(() => cy.nodes().data(labelRef.current));
    const pan = { x: width / 2 - ((x1 + x2) / 2) * zoom, y: height / 2 - ((y1 + y2) / 2) * zoom };
    cy.stop(true);
    if (animate) cy.animate({ zoom, pan }, { duration: MOVE_MS, easing: "ease-in-out-cubic" });
    else cy.viewport({ zoom, pan });
  };

  // Create the graph once.
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const growing = growingRef.current;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || !containerRef.current) return;
      const p = graphPalette();
      const cy = cytoscape({
        container: containerRef.current,
        elements: [],
        minZoom: 0.15,
        maxZoom: 3,
        wheelSensitivity: 0.3,
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              "background-opacity": 0.2,
              "border-width": 1.5,
              "border-color": "data(color)",
              width: "data(size)",
              height: "data(size)",
              label: "data(label)",
              color: p.muted,
              "font-family": "Plus Jakarta Sans, Inter, sans-serif",
              "font-size": "data(font)",
              "font-weight": 600,
              "text-wrap": "wrap",
              "text-max-width": "data(wrap)",
              "text-opacity": 0,
              "text-background-color": p.card,
              "text-background-opacity": 0.72,
              "text-background-padding": "2px",
              "text-background-shape": "roundrectangle",
              "underlay-color": "data(color)",
              "underlay-padding": 9,
              "underlay-opacity": 0,
              "underlay-shape": "ellipse",
            },
          },
          { selector: "node[side = 'right']", style: { "text-halign": "right", "text-valign": "center", "text-margin-x": 5 } },
          { selector: "node[side = 'left']", style: { "text-halign": "left", "text-valign": "center", "text-margin-x": -5 } },
          { selector: "node[side = 'top']", style: { "text-halign": "center", "text-valign": "top", "text-margin-y": -5 } },
          { selector: "node[side = 'bottom']", style: { "text-halign": "center", "text-valign": "bottom", "text-margin-y": 5 } },
          { selector: "node[labelled = 1]", style: { "text-opacity": 1 } },
          {
            selector: "node[kind = 'brief'], node[kind = 'allocation']",
            style: { "background-opacity": 0.9, color: p.text, "underlay-opacity": 0.16, "underlay-padding": 12 },
          },
          { selector: "node[kind = 'question']", style: { shape: "diamond" } },
          { selector: "node[kind = 'finding']", style: { shape: "round-rectangle", color: p.text } },
          { selector: "node[kind = 'suggestion']", style: { shape: "star", color: p.text } },
          { selector: "node[kind = 'theme']", style: { shape: "hexagon" } },
          { selector: "node[failed = 1]", style: { opacity: 0.5, "border-style": "dashed" } },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": "data(color)",
              "target-arrow-color": "data(color)",
              "target-arrow-shape": "none",
              "arrow-scale": 0.7,
              "curve-style": "unbundled-bezier",
              "control-point-distances": 26,
              "control-point-weights": 0.5,
              opacity: CROSS_EDGE_OPACITY,
            },
          },
          { selector: "edge[tree = 1]", style: { "curve-style": "straight", opacity: TREE_EDGE_OPACITY } },
          { selector: "edge[type = 'contradicts']", style: { "line-style": "dashed", width: 1.5, opacity: CONTRADICTION_OPACITY } },
          { selector: ".dim", style: { opacity: 0.1, "text-opacity": 0 } },
          { selector: "node.near", style: { "text-opacity": 1, color: p.text, "underlay-opacity": 0.14 } },
          { selector: "edge.near", style: { opacity: 0.85, width: 1.5, "target-arrow-shape": "triangle" } },
          { selector: "node:selected", style: { "border-width": 2.5, "border-color": p.accent, color: p.text, "text-opacity": 1, "underlay-color": p.accent, "underlay-opacity": 0.3 } },
          { selector: "node.path", style: { "border-width": 2, "border-color": p.mint, color: p.text, "text-opacity": 1 } },
          { selector: "edge.path", style: { width: 2, opacity: 1, "target-arrow-shape": "triangle" } },
        ],
      });
      const container = containerRef.current;
      cy.on("tap", "node", (e) => onSelectRef.current(e.target.id()));
      cy.on("tap", (e) => {
        if (e.target === cy) onSelectRef.current(null);
      });
      cy.on("mouseover", "node", (e) => {
        hoverRef.current = e.target.id();
        container.style.cursor = "pointer";
        paintRef.current();
      });
      cy.on("mouseout", "node", () => {
        hoverRef.current = null;
        container.style.cursor = "";
        paintRef.current();
      });
      cy.on("dragpan scrollzoom pinchzoom", () => {
        followRef.current = false;
      });
      cy.on("dbltap", (e) => {
        if (e.target !== cy) return;
        followRef.current = true;
        frameRef.current(true);
      });
      // The rings live behind the canvas and follow its viewport.
      const moveRings = () => {
        const { x, y } = cy.pan();
        ringsRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${cy.zoom()})`);
      };
      cy.on("viewport", moveRings);
      moveRings();
      observer = new ResizeObserver(() => {
        cy.resize();
        frameRef.current(false);
      });
      observer.observe(container);
      cyRef.current = cy;
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      growing.clear();
      cyRef.current?.destroy();
      cyRef.current = null;
      // A new instance starts empty, so the next one has to draw the run again.
      runRef.current = null;
      setReady(false);
    };
  }, []);

  // Takes the next queued node from its parent to its place on the rings.
  const growRef = useRef((_id: string) => {});
  growRef.current = (id) => {
    const cy = cyRef.current;
    const definition = wantedRef.current.get(id);
    if (!cy || !definition || cy.getElementById(id).nonempty()) return;
    const target = layoutRef.current.positions.get(id);
    const parentId = layoutRef.current.parents.get(id);
    const parent = parentId ? cy.getElementById(parentId) : null;
    const origin = parent?.nonempty() ? parent.position() : { x: target?.x ?? 0, y: target?.y ?? 0 };
    const node = cy.add({ ...definition, data: { ...definition.data, ...labelRef.current }, position: { x: origin.x, y: origin.y } }) as unknown as NodeSingular;
    const size = Number(definition.data.size);
    node.style({ opacity: 0, width: 2, height: 2, "text-opacity": 0, "underlay-opacity": 0.5 });
    growingRef.current.add(id);
    node.animate(
      { position: { x: target?.x ?? origin.x, y: target?.y ?? origin.y }, style: { opacity: 1, width: size, height: size } },
      {
        duration: GROW_MS,
        easing: "ease-out-cubic",
        complete: () => {
          growingRef.current.delete(id);
          if (node.removed()) return;
          node.removeStyle("opacity width height text-opacity");
          const latest = layoutRef.current.positions.get(id);
          if (latest) node.animate({ position: { x: latest.x, y: latest.y } }, { duration: MOVE_MS / 2, easing: "ease-in-out-cubic" });
          node.animate({ style: { "underlay-opacity": 0 } }, { duration: GLOW_MS, easing: "ease-out", complete: () => void (node.removed() || node.removeStyle("underlay-opacity")) });
        },
      },
    );
    addEdgesRef.current(id);
    if (focusedRef.current) paintRef.current();
  };

  /** Fades in the wanted edges whose two ends are drawn, those of one node when `id` is given. */
  const addEdgesRef = useRef((_id?: string) => {});
  addEdgesRef.current = (id) => {
    const cy = cyRef.current;
    if (!cy) return;
    for (const definition of wantedRef.current.values()) {
      if (definition.group !== "edges") continue;
      const { source, target } = definition.data as { source: string; target: string };
      if (id && source !== id && target !== id) continue;
      if (cy.getElementById(definition.data.id as string).nonempty()) continue;
      if (cy.getElementById(source).empty() || cy.getElementById(target).empty()) continue;
      const edge = cy.add(definition);
      edge.style("opacity", 0);
      edge.animate({ style: { opacity: edgeOpacity(definition.data) } }, { duration: EDGE_MS, easing: "ease-out", complete: () => void (edge.removed() || edge.removeStyle("opacity")) });
    }
  };

  const stepQueueRef = useRef(() => {});
  stepQueueRef.current = () => {
    timerRef.current = null;
    const id = queueRef.current.shift();
    if (id) growRef.current(id);
    if (queueRef.current.length > 0) timerRef.current = setTimeout(() => stepQueueRef.current(), stepRef.current);
  };

  // Follows the elements: removes what left, updates what stayed, queues what is new.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    const run = nodes[0]?.runId ?? null;
    const opened = run !== runRef.current;
    if (opened) {
      runRef.current = run;
      followRef.current = true;
      queueRef.current = [];
      growingRef.current.clear();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      cy.elements().stop(true).remove();
    }

    const wanted = new Map(elements.map((e) => [e.data.id as string, e]));
    wantedRef.current = wanted;
    let grew = opened;
    cy.batch(() => {
      cy.elements().forEach((el) => {
        if (wanted.has(el.id())) el.data(wanted.get(el.id())!.data);
        else el.remove();
      });
    });

    const fresh = elements.filter((e) => e.group === "nodes" && cy.getElementById(e.data.id as string).empty()).map((e) => e.data.id as string);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) {
      // Everything lands in place at once.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      cy.batch(() => {
        for (const el of elements) {
          if (cy.getElementById(el.data.id as string).nonempty()) continue;
          const point = layout.positions.get(el.data.id as string);
          cy.add(el.group === "nodes" ? { ...el, data: { ...el.data, ...labelRef.current }, position: { x: point?.x ?? 0, y: point?.y ?? 0 } } : el);
        }
        cy.nodes().forEach((n) => {
          const point = layout.positions.get(n.id());
          if (point) n.position({ x: point.x, y: point.y });
        });
      });
      frameRef.current(false);
      paintRef.current();
      return;
    }

    // Queued nodes wait in creation order; newer ones join behind them.
    const queued = new Set(queueRef.current);
    const joining = fresh.filter((id) => !queued.has(id));
    if (joining.length > 0) grew = true;
    queueRef.current = fresh;
    if (grew || growingRef.current.size > 0) {
      cy.nodes().forEach((n) => {
        if (growingRef.current.has(n.id())) return;
        const point = layout.positions.get(n.id());
        if (!point) return;
        const { x, y } = n.position();
        if (Math.hypot(point.x - x, point.y - y) < 0.5) return;
        n.stop(true).animate({ position: { x: point.x, y: point.y } }, { duration: MOVE_MS, easing: "ease-in-out-cubic" });
      });
    }
    addEdgesRef.current();
    if (grew) frameRef.current(!opened);
    if (fresh.length > 0) {
      const budget = opened ? OPEN_BUDGET_MS : LIVE_BUDGET_MS;
      stepRef.current = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, budget / fresh.length));
      if (!timerRef.current) timerRef.current = setTimeout(() => stepQueueRef.current(), opened ? 120 : 0);
    }
  }, [elements, layout, nodes, ready]);

  // Selection and reasoning path.
  useEffect(() => {
    if (ready) paintRef.current();
  }, [selectedId, highlight, ready]);

  // Bring a newly selected node into view.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready || !selectedId) return;
    const node = cy.getElementById(selectedId);
    if (node.nonempty()) cy.animate({ center: { eles: node } }, { duration: 260, easing: "ease-in-out-cubic" });
  }, [selectedId, ready]);

  const outer = layout.rings[layout.rings.length - 1] ?? 0;
  return (
    <div className="relative w-full h-full min-h-[360px] overflow-hidden">
      <svg className="absolute inset-0 w-full h-full pointer-events-none text-slate-700" aria-hidden="true">
        <defs>
          <radialGradient id="analysis-graph-glow">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.14" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g ref={ringsRef}>
          {outer > 0 && <circle r={outer * 0.8} fill="url(#analysis-graph-glow)" />}
          {layout.rings.map((r) => (
            <circle key={r} r={r} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </svg>
      {/* Inline: Cytoscape injects an unlayered `position: relative` that beats the Tailwind class. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} aria-label={t("analysis.graph.ariaLabel")} role="img" />
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
