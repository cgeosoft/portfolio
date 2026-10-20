/**
 * Helpers for the website screenshots (`capture.ts`) and other scripts that
 * drive the app: runs the service and the GUI dev server on a scratch data
 * directory with the demo portfolio, and drives them from Playwright.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import type { Query, Rect } from "./shots";

export const ROOT = resolve(import.meta.dir, "..", "..");

// ── processes ────────────────────────────────────────────────────────────

type Child = ReturnType<typeof Bun.spawn>;
const children: Child[] = [];

/** Resolves with the first stdout line matching `pattern`, then keeps draining the pipe. */
export async function waitForLine(child: Child, pattern: RegExp, timeoutMs = 60_000): Promise<RegExpMatchArray> {
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

export function stopChildren(): void {
  for (const child of children) child.kill();
}
process.on("exit", stopChildren);
process.on("SIGINT", () => process.exit(130));

export async function startService(dataDir: string): Promise<number> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "service.ts"), dataDir], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  children.push(child);
  const [, port] = await waitForLine(child, /^SERVICE_PORT=(\d+)$/);
  return Number(port);
}

export async function startGui(servicePort: number): Promise<string> {
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

export class Api {
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
export async function prepareData(api: Api): Promise<{ id: string; baseCurrency: string }> {
  await api.call("POST", "/api/auth/login", {});
  await api.call("POST", "/api/auth/accept-terms");
  let { portfolios } = await api.call<{ portfolios: { id: string; baseCurrency: string }[] }>("GET", "/api/portfolios");
  if (portfolios.length === 0) {
    await api.call("POST", "/api/setup/complete", { populateDemo: true, enableTelemetry: false });
    ({ portfolios } = await api.call("GET", "/api/portfolios"));
  }
  // English: the hotspot targets in shots.ts match English text.
  await api.call("PATCH", "/api/config", { language: "en", dailyBriefEnabled: true });
  const portfolio = portfolios[0];
  if (!portfolio) throw new Error("no portfolio after setup");
  return portfolio;
}

/** Fills the LLM screens: a weekly report, suggestions and, last so the sidebar opens on it, a daily brief. */
export async function generateLlmContent(api: Api, portfolio: { id: string; baseCurrency: string }, spec: string): Promise<void> {
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

export async function launchBrowser(chrome?: string, extraArgs: string[] = []): Promise<Browser> {
  const options = { args: ["--hide-scrollbars", "--force-color-profile=srgb", ...extraArgs] };
  if (chrome) return chromium.launch({ ...options, executablePath: chrome });
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
export function resolveQuery(q: Query): Rect | null {
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
    let el = candidates.at(query.nth ?? 0) ?? null;
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

export async function rectOf(page: Page, queries: Query | Query[], label: string): Promise<Rect> {
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
