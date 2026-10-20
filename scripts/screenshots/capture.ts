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
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Page } from "playwright-core";
import { Api, generateLlmContent, launchBrowser, prepareData, rectOf, ROOT, startGui, startService, stopChildren } from "./app";
import { SCREENS, type Rect, type Screen } from "./shots";
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

const browser = await launchBrowser(args.chrome);
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
