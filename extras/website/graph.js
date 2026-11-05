/**
 * The evidence graph of a real Guided Analysis on the demo portfolio, drawn on
 * a canvas. Reads /assets/tour/run.json, which `bun run website:screenshots`
 * writes from the running app, with the positions of the app's radial layout.
 *
 * Three views share one Graph class:
 *   [data-graph-hero]  the hero: the graph grows, then traces one suggestion after another
 *   [data-run]         the walkthrough: a stepper over the six stages, a graph and a panel
 *   [data-why]         one suggestion and the path behind it
 *
 * A view draws only while it is on screen. Reduced motion shows the finished
 * graph, with no autoplay and no particles.
 */
(function () {
  "use strict";

  const DATA_URL = "/assets/tour/run.json";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;

  const COLORS = {
    accent: "#dd3c73",
    text: "#f8fafc",
    cream: "#e3eacd",
    royal: "#6d8bf7",
    plum: "#a855f7",
    mint: "#a7e2c0",
    rose: "#fb7185",
    muted: "#94a3b8",
    faint: "#475569",
  };

  const STAGES = [
    { id: "seed", label: "Seed", text: "Loads your brief, your allocation and the market context. No model yet." },
    { id: "survey", label: "Survey", text: "Turns the brief into questions to check." },
    { id: "expand", label: "Expand", text: "The model picks tools. The app runs them and adds what they return as evidence." },
    { id: "synthesise", label: "Synthesise", text: "Groups the findings into themes." },
    { id: "suggest", label: "Suggest", text: "Proposes changes. Each one has to act on a finding." },
    { id: "report", label: "Report", text: "Writes the short report. Its links open the nodes behind each claim." },
  ];

  const KINDS = {
    brief: "Brief",
    allocation: "Allocation",
    holding: "Holding",
    question: "Question",
    news: "News",
    indicator: "Indicator",
    metric: "Metric",
    calc: "Calculation",
    macro: "Macro",
    company: "Company",
    event: "Event",
    theme: "Theme",
    finding: "Finding",
    suggestion: "Suggestion",
    report: "Report",
  };

  const EDGE_WORDS = {
    about: "about",
    measures: "measures",
    exposes: "exposed to",
    derived_from: "derived from",
    answers: "answers",
    supports: "supports",
    contradicts: "contradicts",
    against_goal: "against the goal",
    motivates: "motivates",
  };

  const GOALS = {
    purpose: "Purpose",
    horizon: "Horizon",
    riskTolerance: "Risk tolerance",
    incomeNeed: "Income",
    cashFlowPattern: "Money in and out",
    targetBands: "Target bands",
    constraints: "Constraints",
    successInOwnWords: "Success",
  };

  function colorOf(node) {
    if (node.failed) return COLORS.faint;
    switch (node.kind) {
      case "brief":
      case "allocation":
      case "report":
        return COLORS.accent;
      case "holding":
        return COLORS.text;
      case "question":
      case "event":
        return COLORS.cream;
      case "news":
      case "macro":
        return COLORS.royal;
      case "indicator":
      case "calc":
      case "metric":
      case "theme":
        return COLORS.plum;
      case "finding":
        return node.stance === "risk" ? COLORS.rose : node.stance === "opportunity" ? COLORS.mint : COLORS.muted;
      case "suggestion":
        return COLORS.mint;
      default:
        return COLORS.muted;
    }
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  /** A soft dot in one colour, drawn once and stamped for every glow. */
  const glows = new Map();
  function glowOf(color) {
    if (glows.has(color)) return glows.get(color);
    const size = 96;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = size;
    const ctx = sprite.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    glows.set(color, sprite);
    return sprite;
  }

  function shapePath(ctx, kind, x, y, r) {
    ctx.beginPath();
    if (kind === "question") {
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r * 1.25, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r * 1.25, y);
      ctx.closePath();
    } else if (kind === "finding") {
      ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.3);
    } else if (kind === "theme") {
      for (let i = 0; i < 6; i++) {
        const a = (TAU * i) / 6 + TAU / 12;
        ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15);
      }
      ctx.closePath();
    } else if (kind === "suggestion") {
      for (let i = 0; i < 10; i++) {
        const a = (TAU * i) / 10 - TAU / 4;
        const radius = i % 2 ? r * 0.62 : r * 1.45;
        ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * radius, y + Math.sin(a) * radius);
      }
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, TAU);
    }
  }

  /** Splits a label into at most two lines that fit `width`. */
  function wrapLabel(ctx, text, width) {
    const words = text.split(" ");
    const lines = [""];
    for (const word of words) {
      const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
      if (ctx.measureText(next).width <= width) lines[lines.length - 1] = next;
      else if (lines.length === 2) return [lines[0], `${lines[1]}…`];
      else lines.push(word);
    }
    return lines;
  }

  class Graph {
    constructor(canvas, data, options) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.options = options || {};
      this.labelKinds = new Set(this.options.labels || []);
      this.rings = data.rings;
      this.nodes = data.nodes.map((n) => ({
        ...n,
        color: colorOf(n),
        size: n.kind === "brief" || n.kind === "allocation" ? 20 : 7 + n.relevance * 7,
        shown: false,
        born: Infinity,
        alpha: 0,
        wanted: 0,
      }));
      this.byId = new Map(this.nodes.map((n) => [n.id, n]));
      this.edges = data.edges
        .map((e) => ({ ...e, a: this.byId.get(e.s), b: this.byId.get(e.t) }))
        .filter((e) => e.a && e.b)
        .map((e) => ({ ...e, lit: 0, points: this.curve(e) }));
      this.treeEdges = this.edges.filter((e) => e.tree);
      this.links = new Map(this.nodes.map((n) => [n.id, []]));
      this.edges.forEach((e) => {
        this.links.get(e.s).push(e);
        this.links.get(e.t).push(e);
      });
      this.focus = null;
      this.emphasis = null;
      this.selected = null;
      this.hovered = null;
      this.particles = [];
      this.time = 0;
      this.last = 0;
      this.onScreen = false;
      this.running = false;
      this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
      this.frame = this.frame.bind(this);

      new ResizeObserver(() => this.resize()).observe(canvas);
      new IntersectionObserver(
        (entries) => {
          this.onScreen = entries.some((e) => e.isIntersecting);
          if (this.onScreen) this.start();
        },
        { rootMargin: "60px" },
      ).observe(canvas);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.start();
      });
      this.bindPointer();
      this.resize();
    }

    /** Tree edges bend gently around the centre, the way a dendrogram does. */
    curve(edge) {
      const { a, b } = edge;
      const steps = edge.tree ? 14 : 2;
      const points = [];
      const inner = Math.hypot(a.x, a.y) < Math.hypot(b.x, b.y) ? a : b;
      const outer = inner === a ? b : a;
      const radius = (Math.hypot(inner.x, inner.y) + Math.hypot(outer.x, outer.y)) / 2;
      const angle = Math.atan2(inner.y, inner.x);
      const hub = Math.hypot(inner.x, inner.y) < 80;
      const cx = hub ? (inner.x + outer.x) / 2 : Math.cos(angle) * radius;
      const cy = hub ? (inner.y + outer.y) / 2 : Math.sin(angle) * radius;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        points.push([u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y]);
      }
      return points;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.fit();
      this.draw();
    }

    fit() {
      const xs = this.nodes.map((n) => n.x);
      const ys = this.nodes.map((n) => n.y);
      const x1 = Math.min(...xs);
      const x2 = Math.max(...xs);
      const y1 = Math.min(...ys);
      const y2 = Math.max(...ys);
      const padX = this.options.padX ?? 90;
      const padY = this.options.padY ?? 34;
      const k = Math.min((this.width - padX * 2) / (x2 - x1), (this.height - padY * 2) / (y2 - y1));
      this.k = Math.max(0.22, k * (this.options.zoom ?? 1));
      const [fx, fy] = this.options.center ?? [0.5, 0.5];
      this.cx = this.width * fx - ((x1 + x2) / 2) * this.k;
      this.cy = this.height * fy - ((y1 + y2) / 2) * this.k;
    }

    /** World to screen, with a slow sway and the pointer's parallax in the hero. */
    project(x, y) {
      if (this.options.sway && !reducedMotion) {
        const angle = Math.sin(this.time / 9000) * 0.035;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const px = x * c - y * s;
        const py = x * s + y * c;
        return [this.cx + px * this.k + this.pointer.x, this.cy + py * this.k + this.pointer.y];
      }
      return [this.cx + x * this.k, this.cy + y * this.k];
    }

    bindPointer() {
      const canvas = this.canvas;
      const hit = (event) => {
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        let best = null;
        let bestDistance = 18;
        for (const n of this.nodes) {
          if (!n.shown || n.alpha < 0.08) continue;
          const [x, y] = this.project(n.x, n.y);
          const distance = Math.hypot(mx - x, my - y);
          if (distance < bestDistance) {
            best = n;
            bestDistance = distance;
          }
        }
        return best;
      };
      if (this.options.sway) {
        window.addEventListener(
          "pointermove",
          (event) => {
            this.pointer.tx = (event.clientX / window.innerWidth - 0.5) * -22;
            this.pointer.ty = (event.clientY / window.innerHeight - 0.5) * -16;
          },
          { passive: true },
        );
      }
      if (!this.options.interactive) return;
      canvas.addEventListener("pointermove", (event) => {
        const node = hit(event);
        if (node !== this.hovered) {
          this.hovered = node;
          canvas.style.cursor = node ? "pointer" : "";
          this.refresh();
          this.options.onHover?.(node, event);
        } else if (node) {
          this.options.onHover?.(node, event);
        }
      });
      canvas.addEventListener("pointerleave", () => {
        this.hovered = null;
        this.refresh();
        this.options.onHover?.(null);
      });
      canvas.addEventListener("click", (event) => this.options.onSelect?.(hit(event)));
    }

    /** Shows nodes, new ones one by one out of their parent. */
    reveal(ids, step) {
      const wanted = new Set(ids);
      let order = 0;
      for (const n of this.nodes) {
        if (!wanted.has(n.id)) {
          n.shown = false;
          n.born = Infinity;
        } else if (!n.shown) {
          n.shown = true;
          n.born = reducedMotion ? -1000 : this.time + order++ * step;
        }
      }
      this.refresh();
    }

    /** Lights these ids and dims the rest; `emphasis` keeps the rest readable. */
    highlight({ focus = this.focus, emphasis = this.emphasis } = {}) {
      this.focus = focus;
      this.emphasis = emphasis;
      this.refresh();
    }

    refresh() {
      const near = this.hovered ?? this.selected;
      const focus = near ? new Set([near.id, ...this.links.get(near.id).flatMap((e) => [e.s, e.t])]) : this.focus;
      for (const n of this.nodes) {
        if (!n.shown) n.wanted = 0;
        else if (focus) n.wanted = focus.has(n.id) ? 1 : 0.09;
        else if (this.emphasis) n.wanted = this.emphasis.has(n.id) ? 1 : 0.3;
        else n.wanted = 1;
      }
      for (const e of this.edges) {
        e.path = focus ? focus.has(e.s) && focus.has(e.t) : false;
        if (near) e.path = e.s === near.id || e.t === near.id;
      }
      this.activeFocus = focus;
      this.start();
    }

    start() {
      if (reducedMotion) {
        for (const n of this.nodes) n.alpha = n.wanted;
        this.draw();
        return;
      }
      if (this.running || !this.onScreen || document.hidden) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }

    frame(now) {
      if (!this.onScreen || document.hidden) {
        this.running = false;
        return;
      }
      const dt = Math.min(200, now - this.last);
      this.last = now;
      this.time += dt;
      this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.04;
      this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.04;
      for (const n of this.nodes) n.alpha += (n.wanted - n.alpha) * Math.min(1, dt / 160);
      this.moveParticles(dt);
      this.draw();
      requestAnimationFrame(this.frame);
    }

    grow(node) {
      if (reducedMotion) return 1;
      return clamp01((this.time - node.born) / 620);
    }

    /** Evidence travels inward along the tree, and along the lit path when there is one. */
    moveParticles(dt) {
      const pool = this.edges.filter((e) => e.path);
      const source = pool.length > 0 ? pool : this.treeEdges;
      const limit = this.options.particles ?? 36;
      if (this.particles.length < limit && Math.random() < dt / 70) {
        const edge = source[Math.floor(Math.random() * source.length)];
        if (edge && this.grow(edge.a) >= 1 && this.grow(edge.b) >= 1 && edge.a.alpha > 0.5 && edge.b.alpha > 0.5) {
          const outward = Math.hypot(edge.a.x, edge.a.y) > Math.hypot(edge.b.x, edge.b.y);
          this.particles.push({ edge, t: 0, forward: outward, speed: 0.00045 + Math.random() * 0.0005 });
        }
      }
      this.particles = this.particles.filter((p) => {
        p.t += p.speed * dt;
        return p.t < 1;
      });
    }

    draw() {
      const { ctx, width, height } = this;
      if (!width) return;
      ctx.clearRect(0, 0, width, height);
      this.drawBackdrop();
      this.drawEdges();
      this.drawParticles();
      this.drawNodes();
      this.drawLabels();
    }

    drawBackdrop() {
      const { ctx, k } = this;
      const brief = this.byId.get("B");
      const allocation = this.byId.get("A");
      if (!brief || !allocation) return;
      const [x, y] = this.project((brief.x + allocation.x) / 2, (brief.y + allocation.y) / 2);
      const seen = Math.max(brief.alpha, allocation.alpha);
      const breath = reducedMotion ? 1 : 1 + Math.sin(this.time / 1800) * 0.05;
      const r = 330 * k * breath;
      ctx.globalAlpha = 0.42 * seen;
      ctx.drawImage(glowOf(COLORS.accent), x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 0.07 * seen;
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      for (const ring of this.rings) {
        ctx.beginPath();
        ctx.arc(x, y, ring * k, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    drawEdges() {
      const { ctx } = this;
      ctx.lineCap = "round";
      for (const e of this.edges) {
        const grown = Math.min(this.grow(e.a), this.grow(e.b));
        const seen = Math.min(e.a.alpha, e.b.alpha);
        if (grown <= 0 || seen <= 0.01) continue;
        const contradiction = e.type === "contradicts";
        const base = e.path ? 0.72 : contradiction ? 0.4 : e.tree ? 0.42 : 0.08;
        ctx.globalAlpha = base * seen;
        ctx.lineWidth = e.path ? 1.25 : e.tree ? 1 : 0.7;
        ctx.strokeStyle = contradiction ? COLORS.rose : e.path || e.type === "supports" || e.type === "motivates" ? COLORS.mint : COLORS.faint;
        ctx.setLineDash(contradiction ? [4, 4] : []);
        const last = Math.ceil((e.points.length - 1) * easeOut(grown));
        ctx.beginPath();
        for (let i = 0; i <= last; i++) {
          const [x, y] = this.project(e.points[i][0], e.points[i][1]);
          ctx[i ? "lineTo" : "moveTo"](x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    drawParticles() {
      const { ctx } = this;
      if (reducedMotion) return;
      for (const p of this.particles) {
        const points = p.edge.points;
        const at = (p.forward ? p.t : 1 - p.t) * (points.length - 1);
        const i = Math.floor(at);
        const a = points[i];
        const b = points[Math.min(points.length - 1, i + 1)];
        const [x, y] = this.project(a[0] + (b[0] - a[0]) * (at - i), a[1] + (b[1] - a[1]) * (at - i));
        const seen = Math.min(p.edge.a.alpha, p.edge.b.alpha) * Math.sin(p.t * Math.PI);
        const color = p.edge.path ? COLORS.mint : p.edge.a.color;
        ctx.globalAlpha = seen;
        ctx.drawImage(glowOf(color), x - 7, y - 7, 14, 14);
        ctx.globalAlpha = seen;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawNodes() {
      const { ctx, k } = this;
      const scale = Math.max(0.62, Math.min(1.25, k * 1.6)) * (this.options.nodeScale ?? 1);
      for (const n of this.nodes) {
        const g = this.grow(n);
        if (g <= 0 || n.alpha <= 0.01) continue;
        const parent = n.parent ? this.byId.get(n.parent) : null;
        const eased = easeOut(g);
        const wx = parent ? parent.x + (n.x - parent.x) * eased : n.x;
        const wy = parent ? parent.y + (n.y - parent.y) * eased : n.y;
        const [x, y] = this.project(wx, wy);
        const r = n.size * scale * easeBack(g);
        const onPath = n === this.selected || n === this.hovered;
        const lit = this.activeFocus && this.activeFocus.has(n.id);

        // A fresh node flares, and a ring runs out of it.
        const flare = 1 - clamp01((this.time - n.born) / 1100);
        const pulse = reducedMotion ? 0 : n.kind === "brief" || n.kind === "allocation" ? (Math.sin(this.time / 1100) + 1) * 0.1 : 0;
        const glow = r * (3.4 + flare * 3 + (lit ? 1 : 0));
        ctx.globalAlpha = n.alpha * (0.3 + flare * 0.5 + pulse + (lit ? 0.2 : 0));
        ctx.drawImage(glowOf(n.color), x - glow, y - glow, glow * 2, glow * 2);
        if (flare > 0 && !reducedMotion) {
          ctx.globalAlpha = n.alpha * flare * 0.5;
          ctx.strokeStyle = n.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r + (1 - flare) * 26, 0, TAU);
          ctx.stroke();
        }

        ctx.globalAlpha = n.alpha;
        shapePath(ctx, n.kind, x, y, r);
        ctx.fillStyle = "#0b0e16";
        ctx.fill();
        shapePath(ctx, n.kind, x, y, r);
        ctx.globalAlpha = n.alpha * (n.kind === "brief" || n.kind === "allocation" ? 0.9 : 0.24);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.globalAlpha = n.failed ? n.alpha * 0.5 : n.alpha;
        ctx.lineWidth = onPath ? 2.4 : lit ? 1.8 : 1.3;
        ctx.strokeStyle = onPath ? COLORS.accent : lit ? COLORS.mint : n.color;
        ctx.setLineDash(n.failed ? [2, 2] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    drawLabels() {
      const { ctx } = this;
      const size = this.options.labelSize ?? 10.5;
      ctx.font = `600 ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      for (const n of this.nodes) {
        const always = this.labelKinds.has(n.kind);
        const lit = this.activeFocus ? this.activeFocus.has(n.id) : false;
        if (!always && !(lit && this.options.litLabels !== false)) continue;
        if (this.grow(n) < 1 || n.alpha < 0.2) continue;
        const [x, y] = this.project(n.x, n.y);
        const gap = n.size + 7;
        const lines = wrapLabel(ctx, n.title.length > 42 ? `${n.title.slice(0, 41)}…` : n.title, this.options.labelWidth ?? 128);
        const height = lines.length * (size + 2);
        ctx.textAlign = n.side === "left" ? "right" : n.side === "right" ? "left" : "center";
        const tx = n.side === "left" ? x - gap : n.side === "right" ? x + gap : x;
        const ty = n.side === "top" ? y - gap - height / 2 : n.side === "bottom" ? y + gap + height / 2 : y;
        ctx.globalAlpha = Math.min(1, n.alpha * (lit ? 1 : 0.86));
        lines.forEach((line, i) => {
          const ly = ty + (i - (lines.length - 1) / 2) * (size + 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(7, 9, 14, 0.82)";
          ctx.strokeText(line, tx, ly);
          ctx.fillStyle = lit ? COLORS.text : "#cbd5e1";
          ctx.fillText(line, tx, ly);
        });
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── small DOM helpers ─────────────────────────────────────────────────────

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style") Object.assign(node.style, value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach((child) => child && node.append(child));
    return node;
  }

  /** Model text with `[H1]` citations, `**bold**` and `[F1](#node/F1)` links, as DOM nodes. */
  function rich(text, data, onCite) {
    const known = new Set(data.nodes.map((n) => n.id));
    const parts = [];
    const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(#node\/([A-Z]\d*)\)|\[([A-Z]\d*)\]/g;
    let at = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      parts.push(text.slice(at, m.index));
      at = m.index + m[0].length;
      if (m[1]) {
        parts.push(h("strong", { text: m[1] }));
        continue;
      }
      const id = m[3] || m[4];
      if (!known.has(id)) {
        parts.push(m[0]);
        continue;
      }
      const chip = h("button", { type: "button", class: "cite", text: id, "aria-label": `Open node ${id}` });
      chip.addEventListener("click", () => onCite(id));
      parts.push(chip);
    }
    parts.push(text.slice(at));
    return parts;
  }

  function dot(node) {
    return h("span", { class: `kind-dot kind-${node.kind}`, style: { color: colorOf(node) }, "aria-hidden": "true" });
  }

  /** The short report: headings, numbered and bulleted lists, paragraphs. */
  function reportBlocks(markdown, data, onCite) {
    const out = [];
    let list = null;
    for (const raw of markdown.split("\n")) {
      const line = raw.trim();
      const item = /^(\d+\.|-)\s+(.*)$/.exec(line);
      if (item) {
        if (!list) {
          list = h(item[1] === "-" ? "ul" : "ol", {});
          out.push(list);
        }
        list.append(h("li", {}, rich(item[2], data, onCite)));
        continue;
      }
      list = null;
      if (!line) continue;
      if (line.startsWith("#")) out.push(h("h4", { text: line.replace(/^#+\s*/, "") }));
      else out.push(h("p", {}, rich(line, data, onCite)));
    }
    return out;
  }

  // ── hero ──────────────────────────────────────────────────────────────────

  function mountHero(root, data) {
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    const canvas = root.querySelector("canvas");
    const graph = new Graph(canvas, data, {
      sway: true,
      center: narrow ? [0.5, 0.5] : [0.74, 0.5],
      padX: narrow ? 26 : 150,
      padY: narrow ? 16 : 58,
      zoom: narrow ? 1 : 0.94,
      labels: narrow ? [] : ["brief", "allocation", "suggestion"],
      litLabels: !narrow,
      particles: narrow ? 24 : 54,
      labelWidth: 150,
      labelSize: 11,
    });
    const caption = root.querySelector("[data-hero-trace]");
    const textEl = root.querySelector("[data-hero-trace-text]");
    const nodeCount = root.querySelectorAll("[data-run-nodes]");
    nodeCount.forEach((el) => (el.textContent = String(data.run.nodes)));

    const ids = data.nodes.map((n) => n.id);
    graph.reveal(ids, 95);
    if (reducedMotion || data.suggestions.length === 0) return;

    let index = 0;
    const grown = ids.length * 95 + 1200;
    function trace() {
      if (!graph.onScreen) return setTimeout(trace, 1500);
      const s = data.suggestions[index % data.suggestions.length];
      index += 1;
      graph.highlight({ focus: pathIds(s) });
      if (caption && textEl) {
        textEl.textContent = s.title;
        caption.classList.add("is-on");
      }
      setTimeout(() => {
        graph.highlight({ focus: null });
        if (caption) caption.classList.remove("is-on");
        setTimeout(trace, 3200);
      }, 5200);
    }
    setTimeout(trace, grown);
  }

  function pathIds(s) {
    return new Set(["B", s.node, ...s.findings, ...s.support, ...s.counter].filter(Boolean));
  }

  // ── the walkthrough ───────────────────────────────────────────────────────

  function mountRun(root, data) {
    const canvas = root.querySelector("canvas");
    const panel = root.querySelector("[data-run-panel]");
    const stepper = root.querySelector("[data-run-stages]");
    const tip = root.querySelector("[data-run-tip]");
    const toggle = root.querySelector("[data-run-toggle]");
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const DWELL = 5200;

    const graph = new Graph(canvas, data, {
      interactive: true,
      labels: narrow ? [] : ["brief", "allocation", "finding", "suggestion"],
      particles: 30,
      padX: narrow ? 22 : 96,
      labelSize: 10,
      onHover(node, event) {
        if (!node) {
          tip.hidden = true;
          return;
        }
        const bounds = tip.parentElement.getBoundingClientRect();
        tip.textContent = "";
        tip.append(h("span", { class: "graph-tip-kind", text: `${node.id} · ${KINDS[node.kind]}` }), h("span", { text: node.title }));
        tip.hidden = false;
        tip.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 240)}px`;
        tip.style.top = `${event.clientY - bounds.top + 14}px`;
      },
      onSelect(node) {
        stop();
        selectNode(node ? node.id : null);
      },
    });

    let stage = -1;
    let timer = 0;
    let playing = false;
    let started = false;

    const stageNodes = (i) => data.nodes.filter((n) => n.stage === STAGES[i].id);

    const buttons = STAGES.map((s, i) => {
      const info = data.stages.find((x) => x.id === s.id);
      const meta = [info && info.nodes ? `${info.nodes} ${info.nodes === 1 ? "node" : "nodes"}` : null, info && info.time].filter(Boolean).join(" · ");
      const button = h("button", { type: "button", role: "tab", class: "stage", "aria-selected": "false", id: `stage-${s.id}` }, [
        h("span", { class: "stage-num mono", text: String(i + 1) }),
        h("span", { class: "stage-name", text: s.label }),
        h("span", { class: "stage-meta mono", text: meta }),
        h("span", { class: "stage-fill", "aria-hidden": "true" }),
      ]);
      button.addEventListener("click", () => {
        stop();
        show(i);
      });
      stepper.append(button);
      return button;
    });

    stepper.addEventListener("keydown", (event) => {
      const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      const next = (stage + delta + STAGES.length) % STAGES.length;
      stop();
      show(next);
      buttons[next].focus();
    });

    function rows(nodes) {
      const list = h("ul", { class: "node-rows" });
      nodes.forEach((n) => {
        const row = h("button", { type: "button", class: "node-row" }, [
          dot(n),
          h("span", { class: "node-row-body" }, [h("span", { class: "node-row-title", text: n.title }), n.summary && n.kind !== "question" ? h("span", { class: "node-row-sub" }, rich(n.summary, data, selectNode)) : null]),
        ]);
        row.addEventListener("click", () => {
          stop();
          selectNode(n.id);
        });
        list.append(h("li", {}, [row]));
      });
      return list;
    }

    function stageBody(i) {
      const s = STAGES[i];
      const nodes = stageNodes(i);
      const out = [h("p", { class: "panel-lead", text: s.text })];
      if (s.id === "seed") {
        const brief = data.nodes.find((n) => n.kind === "brief");
        const lines = (brief ? brief.summary : "").split(/;\s*/).filter(Boolean);
        out.push(
          h(
            "dl",
            { class: "brief-lines" },
            lines.map((line) => {
              const at = line.indexOf(":");
              return at < 0 ? h("div", {}, [h("dd", { text: line })]) : h("div", {}, [h("dt", { text: line.slice(0, at) }), h("dd", { text: line.slice(at + 1).trim() })]);
            }),
          ),
        );
        out.push(rows(nodes.filter((n) => n.kind === "allocation" || n.kind === "macro" || n.id === "N1")));
      } else if (s.id === "expand") {
        const findings = nodes.filter((n) => n.kind === "finding");
        out.push(h("h4", { text: `Findings (${findings.length})` }), rows(findings), h("h4", { text: `Evidence (${nodes.length - findings.length})` }), rows(nodes.filter((n) => n.kind !== "finding")));
      } else if (s.id === "suggest") {
        const list = h("ul", { class: "suggest-rows" });
        data.suggestions.forEach((sg, index) => {
          const why = h("a", { href: "#why", class: "why-link", "data-why-open": String(index) }, [h("span", { text: "Why" })]);
          list.append(
            h("li", {}, [
              h("div", { class: "suggest-head" }, [h("b", { class: "mono", text: sg.symbol }), h("span", { class: "mono", text: `${sg.from.toFixed(1)}% → ${sg.to.toFixed(1)}%` }), why]),
              h("p", { class: "suggest-title", text: sg.title }),
              h("p", { class: "suggest-why" }, rich(sg.why, data, selectNode)),
            ]),
          );
        });
        out.push(list);
      } else if (s.id === "report") {
        out.length = 0;
        out.push(...reportBlocks(data.report, data, selectNode));
      } else {
        out.push(rows(nodes));
      }
      return out;
    }

    function renderStage(i) {
      panel.textContent = "";
      panel.append(...stageBody(i));
      panel.scrollTop = 0;
    }

    function selectNode(id) {
      const node = id ? graph.byId.get(id) : null;
      graph.selected = node;
      graph.refresh();
      if (!node) {
        renderStage(stage);
        return;
      }
      const back = h("button", { type: "button", class: "panel-back mono", text: `← ${STAGES[stage].label}` });
      back.addEventListener("click", () => selectNode(null));
      const links = graph.links.get(id).filter((e) => e.a !== e.b);
      const list = h("ul", { class: "node-rows" });
      const seen = new Set();
      links.forEach((e) => {
        const other = e.s === id ? e.b : e.a;
        if (seen.has(other.id)) return;
        seen.add(other.id);
        const row = h("button", { type: "button", class: "node-row" }, [
          dot(other),
          h("span", { class: "node-row-body" }, [h("span", { class: "node-row-sub mono", text: `${e.s === id ? "" : "← "}${EDGE_WORDS[e.type] || e.type}` }), h("span", { class: "node-row-title", text: other.title })]),
        ]);
        row.addEventListener("click", () => selectNode(other.id));
        list.append(h("li", {}, [row]));
      });
      panel.textContent = "";
      panel.append(
        back,
        h("p", { class: "node-kind mono" }, [dot(node), `${node.id} · ${KINDS[node.kind]}`]),
        h("h3", { class: "node-title", text: node.title }),
        h("p", { class: "node-summary" }, rich(node.summary, data, selectNode)),
        list.childNodes.length ? h("h4", { text: `Links (${list.childNodes.length})` }) : null,
        list,
      );
      panel.scrollTop = 0;
    }

    function show(i) {
      stage = i;
      buttons.forEach((b, n) => {
        b.setAttribute("aria-selected", n === i ? "true" : "false");
        b.tabIndex = n === i ? 0 : -1;
        b.classList.toggle("is-done", n < i);
        b.classList.toggle("is-on", n === i);
      });
      graph.selected = null;
      const upTo = new Set(STAGES.slice(0, i + 1).map((s) => s.id));
      graph.reveal(
        data.nodes.filter((n) => upTo.has(n.stage)).map((n) => n.id),
        Math.min(120, 1600 / Math.max(1, stageNodes(i).length)),
      );
      graph.highlight({ focus: null, emphasis: STAGES[i].id === "report" ? null : new Set(stageNodes(i).map((n) => n.id)) });
      renderStage(i);
    }

    function setPlaying(on) {
      playing = on;
      root.classList.toggle("is-playing", on);
      if (toggle) {
        toggle.textContent = on ? "Pause" : stage === STAGES.length - 1 ? "Replay" : "Play";
        toggle.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    function tick() {
      clearTimeout(timer);
      if (!playing) return;
      timer = setTimeout(() => {
        if (stage >= STAGES.length - 1) return setPlaying(false);
        show(stage + 1);
        tick();
      }, DWELL);
    }

    function stop() {
      clearTimeout(timer);
      setPlaying(false);
    }

    function play() {
      if (stage >= STAGES.length - 1) show(0);
      setPlaying(true);
      tick();
    }

    toggle?.addEventListener("click", () => {
      if (playing) stop();
      else {
        started = true;
        play();
      }
    });

    panel.addEventListener("click", (event) => {
      const link = event.target.closest("[data-why-open]");
      if (link) document.dispatchEvent(new CustomEvent("portfolio:why", { detail: Number(link.dataset.whyOpen) }));
    });

    if (reducedMotion) {
      show(STAGES.length - 1);
      setPlaying(false);
      return;
    }
    show(0);
    setPlaying(false);
    new IntersectionObserver(
      (entries) => {
        const seen = entries.some((e) => e.isIntersecting);
        if (seen && !started) {
          started = true;
          play();
        }
      },
      { threshold: 0.45 },
    ).observe(stepper.parentElement);
  }

  // ── why this suggestion ───────────────────────────────────────────────────

  function mountWhy(root, data) {
    const chain = root.querySelector("[data-why-chain]");
    const tabs = root.querySelector("[data-why-tabs]");
    const canvas = root.querySelector("canvas");
    if (data.suggestions.length === 0) {
      root.hidden = true;
      return;
    }
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const graph = new Graph(canvas, data, { labels: [], litLabels: !narrow, particles: 26, padX: narrow ? 20 : 70, padY: 26, labelSize: 10, labelWidth: 112 });
    graph.reveal(data.nodes.map((n) => n.id), 0);

    const buttons = data.suggestions.map((s, i) => {
      const button = h("button", { type: "button", role: "tab", class: "why-tab", "aria-selected": "false" }, [h("span", { class: "mono", text: `${s.symbol} ${s.from.toFixed(1)}% → ${s.to.toFixed(1)}%` }), h("b", { text: s.title })]);
      button.addEventListener("click", () => show(i));
      tabs.append(button);
      return button;
    });

    function step(label, nodes, tone) {
      const group = h("div", { class: `chain-step ${tone || ""}` }, [h("p", { class: "chain-label mono", text: label })]);
      nodes.forEach((n) => {
        group.append(h("div", { class: "chain-node" }, [h("p", { class: "chain-title" }, [dot(n), h("span", { text: n.title })]), n.summary ? h("p", { class: "chain-sub" }, rich(n.summary, data, () => {})) : null]));
      });
      return group;
    }

    const EVIDENCE_SHOWN = 3;

    function show(i) {
      const s = data.suggestions[i];
      buttons.forEach((b, n) => b.setAttribute("aria-selected", n === i ? "true" : "false"));
      graph.highlight({ focus: pathIds(s) });
      const get = (ids) => ids.map((id) => graph.byId.get(id)).filter(Boolean);
      const evidence = get(s.support).filter((n) => n.kind !== "brief");
      const parts = [
        h("div", { class: "chain-step chain-goal" }, [h("p", { class: "chain-label mono", text: "Goal from the brief" }), h("p", { class: "chain-title", text: GOALS[s.goal] || "The brief as a whole" })]),
        step("Findings", get(s.findings)),
        step("Evidence", evidence.slice(0, EVIDENCE_SHOWN)),
      ];
      if (evidence.length > EVIDENCE_SHOWN) parts[2].append(h("p", { class: "chain-more mono", text: `+ ${evidence.length - EVIDENCE_SHOWN} more in the graph` }));
      if (s.counter.length > 0) parts.push(step("Counter-evidence", get(s.counter), "chain-counter"));
      parts.push(h("div", { class: "chain-step chain-result" }, [h("p", { class: "chain-label mono", text: "Suggestion" }), h("p", { class: "chain-title", text: s.title })]));
      chain.textContent = "";
      chain.append(...parts);
      chain.classList.remove("is-in");
      void chain.offsetWidth;
      chain.classList.add("is-in");
    }

    // Open on the suggestion with evidence against it: that is the honest story.
    const first = data.suggestions.reduce((best, s, i) => (s.counter.length > data.suggestions[best].counter.length ? i : best), 0);
    show(first);
    document.addEventListener("portfolio:why", (event) => show(event.detail));
  }

  // ── boot ──────────────────────────────────────────────────────────────────

  const hero = document.querySelector("[data-graph-hero]");
  const run = document.querySelector("[data-run]");
  const why = document.querySelector("[data-why]");
  if (!hero && !run && !why) return;

  fetch(DATA_URL)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => {
      document.querySelectorAll("[data-run-stat]").forEach((el) => {
        const value = data.run[el.dataset.runStat];
        if (value !== undefined) el.textContent = String(value);
      });
      if (hero) mountHero(hero, data);
      if (run) mountRun(run, data);
      if (why) mountWhy(why, data);
      document.documentElement.classList.add("graph-ready");
    })
    .catch(() => {
      // The sections keep their screenshot fallback.
      document.documentElement.classList.add("graph-failed");
    });
})();
