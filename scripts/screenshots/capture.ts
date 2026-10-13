/**
 * Website tour screenshots: runs the app on a scratch data directory with the
 * demo portfolio, captures each screen in `shots.ts` at 1600x900 (2x), and
 * writes the images and `tour.json` that the website tour reads.
 *
 *   bun run website:screenshots [--llm claude-cli[:model]] [--data <dir>] [--only id,id]
 *                               [--chrome <path>] [--debug <dir>]
 *
 * --llm     generate a weekly report, suggestions and a daily brief first, with
 *           this provider (the Claude CLI, or an OpenAI-compatible server already
 *           set up in the --data directory). Without it the LLM screens show
 *           whatever the data directory holds.
 * --data    reuse a data directory, for example one where the LLM content was
 *           generated before. Default: a new temporary directory.
 * --only    capture only these screens; the others stay in tour.json.
 * --chrome  a Chromium or Chrome binary. Default: Playwright's Chromium, then
 *           the installed Google Chrome.
 * --debug   also write each screen with its crop boxes drawn on it.
 *
 * Output, in extras/website/assets/:
 *   tour/<screen>.webp            the screen, 2000 px wide
 *   tour/<screen>-<spot>.webp     the crop of each hotspot, at 2x
 *   tour/tour.json                screens, hotspot positions and texts
 *   screenshot.png                the overview at 1600x900 (README, og:image)
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "playwright-core";
import { SCREENS, type Query, type Rect, type Screen } from "./shots";

const ROOT = resolve(import.meta.dir, "..", "..");
const ASSETS = join(ROOT, "extras", "website", "assets");
const OUT = join(ASSETS, "tour");
const VIEWPORT = { width: 1600, height: 900 };
const SCALE = 2;
const SCREEN_WIDTH = 2000;
const CROP_MAX_WIDTH = 1100;
const FULL: Rect = { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height };

const { values: args } = parseArgs({
  options: {
    llm: { type: "string" },
    data: { type: "string" },
    only: { type: "string" },
    chrome: { type: "string" },
    debug: { type: "string" },
  },
});

// ── processes ────────────────────────────────────────────────────────────

type Child = ReturnType<typeof Bun.spawn>;
const children: Child[] = [];

/** Resolves with the first stdout line matching `pattern`, then keeps draining the pipe. */
async function waitForLine(child: Child, pattern: RegExp, timeoutMs = 60_000): Promise<RegExpMatchArray> {
  const stdout = child.stdout as ReadableStream<Uint8Array>;
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`process exited before printing ${pattern}`);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.trim().match(pattern);
        if (!match) continue;
        void (async () => {
          while (!(await reader.read()).done);
        })();
        return match;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function stopChildren(): void {
  for (const child of children) child.kill();
}
process.on("exit", stopChildren);
process.on("SIGINT", () => process.exit(130));

async function startService(dataDir: string): Promise<number> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "service.ts"), dataDir], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  children.push(child);
  const [, port] = await waitForLine(child, /^SERVICE_PORT=(\d+)$/);
  return Number(port);
}

async function startGui(servicePort: number): Promise<string> {
  // The dev server follows port changes on stdin, so stdin stays open.
  const child = Bun.spawn([process.execPath, "scripts/dev-server.ts", String(servicePort)], {
    cwd: join(ROOT, "modules", "gui"),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  children.push(child);
  const [, url] = await waitForLine(child, /^GUI_URL=(\S+)$/);
  return url!;
}

// ── service API ──────────────────────────────────────────────────────────

class Api {
  private cookie = "";
  constructor(private readonly base: string) {}

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie();
    if (set.length > 0) this.cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Signs in, seeds the demo portfolio on a fresh database, returns the portfolio. */
async function prepareData(api: Api): Promise<{ id: string; baseCurrency: string }> {
  await api.call("POST", "/api/auth/login", {});
  await api.call("POST", "/api/auth/accept-terms");
  let { portfolios } = await api.call<{ portfolios: { id: string; baseCurrency: string }[] }>("GET", "/api/portfolios");
  if (portfolios.length === 0) {
    await api.call("POST", "/api/setup/complete", { populateDemo: true, enableTelemetry: false });
    ({ portfolios } = await api.call("GET", "/api/portfolios"));
  }
  await api.call("PATCH", "/api/config", { hideSponsorBanners: true, dailyBriefEnabled: true });
  const portfolio = portfolios[0];
  if (!portfolio) throw new Error("no portfolio after setup");
  return portfolio;
}

/** Fills the LLM screens: a weekly report, suggestions and, last so the sidebar opens on it, a daily brief. */
async function generateLlmContent(api: Api, portfolio: { id: string; baseCurrency: string }, spec: string): Promise<void> {
  const [provider = "claude-cli", model = provider === "claude-cli" ? "sonnet" : ""] = spec.split(":");
  await api.call("PATCH", "/api/config", { llmProvider: provider, llmModel: model, llmModels: { [provider]: model } });
  const id = portfolio.id;
  console.log(`LLM: weekly report (${provider} ${model})`);
  await api.call("POST", `/api/portfolios/${id}/reports`, { provider, model });
  console.log("LLM: suggestions");
  await api.call("POST", `/api/portfolios/${id}/suggestions/generate`, { baseCurrency: portfolio.baseCurrency });
  for (let i = 0; i < 120; i++) {
    const res = await api.call<{ generation: { status: string; error?: string } }>("GET", `/api/portfolios/${id}/suggestions?baseCurrency=${portfolio.baseCurrency}`);
    if (res.generation.status === "fail") throw new Error(`suggestions failed: ${res.generation.error}`);
    if (res.generation.status !== "running") break;
    await Bun.sleep(3000);
  }
  console.log("LLM: daily brief");
  await api.call("POST", "/api/automation/daily-brief/run");
}

// ── browser ──────────────────────────────────────────────────────────────

async function launchBrowser(): Promise<Browser> {
  const options = { args: ["--hide-scrollbars", "--force-color-profile=srgb"] };
  if (args.chrome) return chromium.launch({ ...options, executablePath: args.chrome });
  try {
    return await chromium.launch(options);
  } catch {}
  try {
    return await chromium.launch({ ...options, channel: "chrome" });
  } catch {}
  // Any Chromium an earlier Playwright version downloaded.
  const cache = join(homedir(), ".cache", "ms-playwright");
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const build of builds) {
    const binary = join(cache, build, "chrome-linux64", "chrome");
    if (existsSync(binary)) return chromium.launch({ ...options, executablePath: binary });
  }
  throw new Error("No Chromium found. Run `bunx playwright-core install chromium` or pass --chrome <path>.");
}

/**
 * Runs in the page: the viewport rectangle of a query (see `Query` in shots.ts).
 * Text matches the deepest visible element whose text contains it, ignoring case.
 */
function resolveQuery(q: Query): Rect | null {
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const isCard = (el: Element) => {
    if (el.classList.contains("cx-card")) return true;
    const s = getComputedStyle(el);
    const bordered = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none";
    return parseFloat(s.borderTopLeftRadius) >= 6 && bordered && el.getBoundingClientRect().width >= 100;
  };
  const matchText = (el: Element) => {
    const text = norm(el.textContent);
    if (q.re) return new RegExp(q.re, "i").test(text);
    if (q.exact) return text === norm(q.text!);
    return text.includes(norm(q.text!));
  };

  let scope: ParentNode = document;
  if (q.within) {
    const parent = resolveElement({ text: q.within, mode: "card" });
    if (!parent) return null;
    scope = parent;
  }

  function resolveElement(query: Query, root: ParentNode = document): Element | null {
    let candidates: Element[];
    if (query.css) {
      const saved = q;
      q = query;
      candidates = Array.from(root.querySelectorAll(query.css)).filter((el) => visible(el) && (!query.text && !query.re ? true : matchText(el)));
      q = saved;
    } else {
      const saved = q;
      q = query;
      candidates = Array.from(root.querySelectorAll("body *"))
        .filter((el) => !["SCRIPT", "STYLE", "svg"].includes(el.tagName) && visible(el) && matchText(el))
        .filter((el) => !Array.from(el.children).some((child) => visible(child) && matchText(child)));
      q = saved;
    }
    let el = candidates[query.nth ?? 0] ?? null;
    if (!el) return null;
    for (let i = 0; i < (query.up ?? 0) && el.parentElement; i++) el = el.parentElement;
    switch (query.mode ?? "self") {
      case "card":
        for (let p: Element | null = el; p; p = p.parentElement) if (isCard(p)) return p;
        return null;
      case "control":
        return el.closest("button, select, input, textarea, a, [role=button], label") ?? el;
      case "row":
        return el.closest("tr");
      default:
        return el;
    }
  }

  let rect: DOMRect;
  if (q.mode === "column") {
    // A table column: the header cell's width, from the header to the bottom of row `rows`.
    const th = resolveElement({ ...q, css: "th", mode: "self" }, scope);
    const table = th?.closest("table");
    if (!th || !table) return null;
    const head = th.getBoundingClientRect();
    const rows = Array.from(table.querySelectorAll("tbody tr")).filter(visible);
    const last = rows[Math.min((q.rows ?? 4) - 1, rows.length - 1)];
    const bottom = last ? last.getBoundingClientRect().bottom : head.bottom;
    rect = new DOMRect(head.left, head.top, head.width, bottom - head.top);
  } else {
    const el = resolveElement(q, scope);
    if (!el) return null;
    rect = el.getBoundingClientRect();
  }
  const [fx, fy, fw, fh] = q.sub ?? [0, 0, 1, 1];
  return { x: rect.left + rect.width * fx, y: rect.top + rect.height * fy, w: rect.width * fw, h: rect.height * fh };
}

async function rectOf(page: Page, queries: Query | Query[], label: string): Promise<Rect> {
  const list = Array.isArray(queries) ? queries : [queries];
  const rects: Rect[] = [];
  for (const q of list) {
    // Retry for a few seconds: lists and charts render after their data arrives.
    let r: Rect | null = null;
    for (let attempt = 0; attempt < 20 && !r; attempt++) {
      if (attempt > 0) await page.waitForTimeout(250);
      r = (await page.evaluate(`(${resolveQuery.toString()})(${JSON.stringify(q)})`)) as Rect | null;
    }
    if (!r) throw new Error(`${label}: nothing matches ${JSON.stringify(q)}`);
    rects.push(r);
  }
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x;
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y;
  return { x, y, w, h };
}

/** Grows a rectangle by `pad` and keeps it inside the viewport. */
function padRect(r: Rect, pad: number): Rect {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  return { x, y, w: Math.min(VIEWPORT.width, r.x + r.w + pad) - x, h: Math.min(VIEWPORT.height, r.y + r.h + pad) - y };
}

interface EncodeJob {
  rect: Rect; // CSS pixels
  width: number; // output width in pixels
  type: "image/webp" | "image/png";
  quality?: number;
  boxes?: Rect[]; // debug overlay, CSS pixels
}

/** Crops, scales and encodes the 2x screenshot in the browser (canvas), so no image tool is needed. */
async function encode(page: Page, png: Buffer, jobs: EncodeJob[]): Promise<Buffer[]> {
  const urls = await page.evaluate(
    async ({ b64, jobs, scale }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      return jobs.map((job) => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(job.width);
        canvas.height = Math.round((job.rect.h / job.rect.w) * job.width);
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        const { x, y, w, h } = job.rect;
        ctx.drawImage(bitmap, x * scale, y * scale, w * scale, h * scale, 0, 0, canvas.width, canvas.height);
        const k = canvas.width / w;
        ctx.lineWidth = 3;
        ctx.font = "bold 20px monospace";
        (job.boxes ?? []).forEach((b, i) => {
          ctx.strokeStyle = "#00e5ff";
          ctx.strokeRect((b.x - x) * k, (b.y - y) * k, b.w * k, b.h * k);
          ctx.fillStyle = "#00e5ff";
          ctx.fillText(String(i + 1), (b.x - x) * k + 6, (b.y - y) * k + 22);
        });
        return canvas.toDataURL(job.type, job.quality);
      });
    },
    { b64: png.toString("base64"), jobs, scale: SCALE },
  );
  return urls.map((url) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}

// ── tour.json ────────────────────────────────────────────────────────────

interface TourHotspot {
  id: string;
  title: string;
  text: string;
  /** Marker position, percent of the screen. */
  x: number;
  y: number;
  /** Spotlighted region (the target), percent of the screen. */
  box: { x: number; y: number; w: number; h: number };
  image: string;
  width: number;
  height: number;
}

interface TourScreen {
  id: string;
  label: string;
  title: string;
  text: string;
  image: string;
  hotspots: TourHotspot[];
}

const pct = (v: number, of: number) => Math.round((v / of) * 10000) / 100;

async function captureScreen(page: Page, encoder: Page, gui: string, screen: Screen): Promise<TourScreen> {
  console.log(`capture: ${screen.id}`);
  // A full load per screen: a hash change alone keeps the scroll position and the open sidebar.
  await page.goto("about:blank");
  await page.goto(`${gui}/#${screen.hash}`, { waitUntil: "load" });
  await page.getByText(screen.ready, { exact: false }).first().waitFor({ timeout: 30_000 });
  await screen.prepare?.(page);
  // Quotes, charts and fonts settle.
  await page.waitForTimeout(screen.settleMs ?? 3500);
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);

  const spots = [];
  for (const spot of screen.hotspots) {
    const target = await rectOf(page, spot.target, `${screen.id}/${spot.id}`);
    const crop = padRect(spot.crop ? await rectOf(page, spot.crop, `${screen.id}/${spot.id} crop`) : target, spot.pad ?? 14);
    const [ax, ay] = spot.at ?? [0.5, 0.5];
    spots.push({ spot, target: padRect(target, 6), crop, marker: { x: target.x + target.w * ax, y: target.y + target.h * ay } });
  }

  const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  const jobs: EncodeJob[] = [
    { rect: FULL, width: SCREEN_WIDTH, type: "image/webp", quality: 0.86 },
    ...spots.map(({ crop }) => ({ rect: crop, width: Math.min(crop.w * SCALE, CROP_MAX_WIDTH), type: "image/webp" as const, quality: 0.9 })),
  ];
  if (screen.id === "overview") jobs.push({ rect: FULL, width: VIEWPORT.width, type: "image/png" });
  if (args.debug) jobs.push({ rect: FULL, width: VIEWPORT.width, type: "image/png", boxes: spots.map((s) => s.crop) });
  const images = await encode(encoder, png, jobs);

  writeFileSync(join(OUT, `${screen.id}.webp`), images[0]!);
  const hotspots: TourHotspot[] = spots.map(({ spot, target, crop, marker }, i) => {
    const file = `${screen.id}-${spot.id}.webp`;
    writeFileSync(join(OUT, file), images[i + 1]!);
    return {
      id: spot.id,
      title: spot.title,
      text: spot.text,
      x: pct(marker.x, VIEWPORT.width),
      y: pct(marker.y, VIEWPORT.height),
      box: { x: pct(target.x, VIEWPORT.width), y: pct(target.y, VIEWPORT.height), w: pct(target.w, VIEWPORT.width), h: pct(target.h, VIEWPORT.height) },
      image: `/assets/tour/${file}`,
      width: Math.round(jobs[i + 1]!.width),
      height: Math.round((crop.h / crop.w) * jobs[i + 1]!.width),
    };
  });
  let next = spots.length + 1;
  if (screen.id === "overview") writeFileSync(join(ASSETS, "screenshot.png"), images[next++]!);
  if (args.debug) writeFileSync(join(args.debug, `${screen.id}-debug.png`), images[next++]!);

  return { id: screen.id, label: screen.label, title: screen.title, text: screen.text, image: `/assets/tour/${screen.id}.webp`, hotspots };
}

// ── main ─────────────────────────────────────────────────────────────────

const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
const screens = SCREENS.filter((s) => !only || only.has(s.id));
if (screens.length === 0) throw new Error(`no screen matches --only ${args.only}`);

const dataDir = args.data ? resolve(args.data) : mkdtempSync(join(tmpdir(), "portfolio-shots-"));
mkdirSync(dataDir, { recursive: true });
mkdirSync(OUT, { recursive: true });
if (args.debug) mkdirSync(args.debug, { recursive: true });
console.log(`data: ${dataDir}`);

const servicePort = await startService(dataDir);
const api = new Api(`http://127.0.0.1:${servicePort}`);
const portfolio = await prepareData(api);
if (args.llm) await generateLlmContent(api, portfolio, args.llm);
const gui = await startGui(servicePort);

const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark", reducedMotion: "reduce" });
  // Each screen starts from the default GUI state (sidebar closed, default ranges).
  await context.addInitScript(() => {
    if (location.protocol.startsWith("http")) localStorage.clear();
  });
  const page = await context.newPage();
  const encoder = await context.newPage();

  const manifestFile = join(OUT, "tour.json");
  const previous: TourScreen[] = only && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).screens : [];
  const captured = new Map<string, TourScreen>();
  for (const screen of screens) {
    // One retry: a quote refresh or a slow model answer can delay a screen.
    try {
      captured.set(screen.id, await captureScreen(page, encoder, gui, screen));
    } catch (err) {
      console.warn(`retry ${screen.id}: ${err instanceof Error ? err.message : err}`);
      captured.set(screen.id, await captureScreen(page, encoder, gui, screen));
    }
  }

  // Screen order follows shots.ts; screens not captured this time keep their entry.
  const result = SCREENS.map((s) => captured.get(s.id) ?? previous.find((p) => p.id === s.id)).filter((s): s is TourScreen => Boolean(s));
  if (!only) {
    const keep = new Set(result.flatMap((s) => [s.image, ...s.hotspots.map((h) => h.image)].map((p) => p.split("/").pop())));
    for (const file of readdirSync(OUT)) if (file.endsWith(".webp") && !keep.has(file)) rmSync(join(OUT, file));
  }
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
  writeFileSync(manifestFile, JSON.stringify({ version, width: VIEWPORT.width, height: VIEWPORT.height, screens: result }, null, 2) + "\n");
  console.log(`wrote ${result.length} screens to ${OUT}`);
} finally {
  await browser.close();
  stopChildren();
  if (!args.data) rmSync(dataDir, { recursive: true, force: true });
}
