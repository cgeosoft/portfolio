#!/usr/bin/env bun
/**
 * Generates a release changelog entry from the git diff between the previous
 * release tag and the current HEAD, using an OpenAI-compatible model.
 *
 * Env vars read from .env (prefixed OPENAI_):
 *   OPENAI_API_TOKEN  API token (also accepts OPENAI_API_KEY)
 *   OPENAI_API_URL    Base URL of an OpenAI-compatible API
 *   OPENAI_MODEL      Model identifier
 *
 * Usage:
 *   bun scripts/gen-changelog.ts --version=<v> [--prev-tag=<tag>] [--only-print]
 *
 * The model answers with JSON; the markdown is rendered here so the changelog
 * keeps one heading hierarchy ("## [<version>]" per release, "### Added" and
 * friends inside it).
 *
 * The script prepends a "## [<version>] - <date>" section to CHANGELOG.md and
 * prints the notes body to stdout. If no token is configured or the answer is
 * unusable, it falls back to a plain git log based entry and continues without
 * failing the release.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, "..");
const CHANGELOG = resolve(APP_DIR, "CHANGELOG.md");

// ---------------------------------------------------------------------------
// Minimal .env loader (OPENAI_* keys only). Bun also auto-loads .env, but we
// parse explicitly so invocation from any cwd behaves the same.
// ---------------------------------------------------------------------------
function loadDotEnv(): void {
  const candidate = existsSync(".env") ? resolve(".env") : resolve(APP_DIR, ".env");
  if (!existsSync(candidate)) return;
  for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!line.includes("=")) continue;
    const eq = line.indexOf("=");
    let key = line.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.startsWith("OPENAI_") && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", cwd: APP_DIR, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv: string[]): { version: string; prevTag: string; onlyPrint: boolean } {
  let version = "";
  let prevTag = "";
  let onlyPrint = false;
  for (const arg of argv) {
    if (arg.startsWith("--version=")) version = arg.slice("--version=".length).replace(/^v/, "");
    else if (arg.startsWith("--prev-tag=")) prevTag = arg.slice("--prev-tag=".length);
    else if (arg === "--only-print") onlyPrint = true;
  }
  return { version, prevTag, onlyPrint };
}

function detectionPrevTag(): string {
  const tags = run("git tag --sort=-version:refname")
    .split("\n")
    .filter((t) => t.trim().length > 0);
  return tags[0] || "";
}

function buildCompletionsUrl(baseUrl: string): string {
  const cleaned = baseUrl.replace(/\/+$/, "");
  if (cleaned.endsWith("/chat/completions")) return cleaned;
  if (cleaned.endsWith("/v1")) return `${cleaned}/chat/completions`;
  return `${cleaned}/v1/chat/completions`;
}

// ---------------------------------------------------------------------------
// LLM call (OpenAI-compatible chat completions)
//
// The model returns JSON, never markdown: heading levels, ordering and bullet
// syntax are decided here so a chatty model cannot break the file structure.
// ---------------------------------------------------------------------------
const SECTIONS = [
  ["added", "Added"],
  ["changed", "Changed"],
  ["fixed", "Fixed"],
  ["removed", "Removed"],
  ["security", "Security"],
] as const;

type SectionKey = (typeof SECTIONS)[number][0];
type ReleaseNotes = Partial<Record<SectionKey, string[]>>;

async function generateNotes(diffText: string, prevTag: string, version: string): Promise<{ ok: boolean; body: string; reason?: string }> {
  const token =
    process.env.OPENAI_API_TOKEN ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_TOKEN;
  if (!token) {
    return { ok: false, body: "", reason: "no OPENAI_API_TOKEN configured in .env" };
  }

  const baseUrl = process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || process.env.OPENAI_URL || "";
  if (!baseUrl) {
    return { ok: false, body: "", reason: "no OPENAI_API_URL configured in .env" };
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const url = buildCompletionsUrl(baseUrl);

  const prompt = [
    "You write release notes for the Portfolio Desktop application.",
    "Describe the changes of version " + version + " in Simplified English.",
    "The changes are the git diff from tag " + prevTag + " to HEAD.",
    "",
    "Answer with a single JSON object and nothing else. Use this shape:",
    '{"added": ["..."], "changed": ["..."], "fixed": ["..."], "removed": ["..."], "security": ["..."]}',
    "Every value is an array of short plain sentences, one user visible change each.",
    "Leave out a key when it has no entries. Do not write markdown, headings or bullet markers.",
    "Do not include private data, balances, tickers, or personal identifiers.",
    "Do not use long dashes. Do not use emojis.",
    "",
    "Git changes:",
    diffText,
  ].join("\n");

  const payload: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a helpful release note writer that answers with JSON only." },
      { role: "user", content: prompt },
    ],
  };

  let res = await postCompletion(url, token, payload);
  if (!res.ok && (res.status === 400 || res.status === 404 || res.status === 422)) {
    // Not every OpenAI-compatible server knows response_format; the prompt
    // alone still asks for JSON, so retry once without it.
    delete payload.response_format;
    res = await postCompletion(url, token, payload);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, body: "", reason: `API returned status ${res.status}: ${detail}` };
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content || "";
  if (!content.trim()) return { ok: false, body: "", reason: "API returned empty content" };

  // Remove reasoning blocks if the model emits thinking sections.
  const parsed = parseNotes(sanitize(content));
  if (!parsed) return { ok: false, body: "", reason: "API returned no JSON object" };

  const body = renderNotes(parsed);
  if (!body) return { ok: false, body: "", reason: "API returned no usable release note items" };
  return { ok: true, body };
}

function postCompletion(url: string, token: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
}

// ---------------------------------------------------------------------------
// JSON parsing and local markdown rendering
// ---------------------------------------------------------------------------
function parseNotes(content: string): ReleaseNotes | null {
  // Models like to wrap JSON in a fence or add a sentence around it, so fall
  // back to the outermost braces before giving up.
  const candidates = [content, content.replace(/^```(?:json)?\s*|\s*```$/g, "")];
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(content.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate.trim()) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) return value as ReleaseNotes;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function renderNotes(notes: ReleaseNotes): string {
  const blocks: string[] = [];
  for (const [key, heading] of SECTIONS) {
    const items = toItems(notes[key]);
    if (items.length === 0) continue;
    blocks.push([`### ${heading}`, ...items.map((item) => `- ${item}`)].join("\n"));
  }
  return blocks.join("\n\n");
}

function toItems(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    // Flatten to one line and drop any markdown the model added anyway.
    const item = entry
      .replace(/\s+/g, " ")
      .replace(/^[-*+]\s+/, "")
      .replace(/^#{1,6}\s+/, "")
      .trim();
    if (item) items.push(item);
  }
  return items;
}

function sanitize(text: string): string {
  // Drop any reasoning blocks a model may emit, keep everything else.
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .replace(/-?thinking>?[\s\S]*?-?\/thinking/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Changelog entry construction
// ---------------------------------------------------------------------------
function buildEntry(version: string, body: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = body.trim();
  return [`## [${version}] - ${date}`, "", lines, ""].join("\n");
}

function prependToChangelog(entry: string): void {
  const header = "# Changelog\n\n";
  let content = `${header}${entry}`;
  if (existsSync(CHANGELOG)) {
    // Drop any existing header so the new entry sits directly beneath it,
    // with the previous entries below.
    const rest = readFileSync(CHANGELOG, "utf8")
      .replace(/^\s*#\s*Changelog\s*\n(?:\s*\n)?/, "")
      .trim();
    if (rest.length > 0) content = `${header}${entry}\n\n${rest}\n`;
  }
  writeFileSync(CHANGELOG, content);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  loadDotEnv();
  const { version, prevTag: prevArg, onlyPrint } = parseArgs(process.argv.slice(2));
  const prevTag = prevArg || detectionPrevTag();
  const currentVersion = version || (process.env.npm_package_version || "");

  if (!currentVersion) {
    console.error("[gen-changelog] Missing --version argument.");
    process.exitCode = 1;
    return;
  }

  const diffText = [
    "Commits:",
    run(`git --no-pager log --oneline --no-merges ${prevTag}..HEAD`) || "(none)",
    "",
    "Changed files:",
    run(`git --no-pager diff --stat ${prevTag} HEAD`) || "(none)",
  ].join("\n");

  const result = prevTag ? await generateNotes(diffText, prevTag, currentVersion) : { ok: false, body: "", reason: "no previous tag found" };

  let body: string;
  if (result.ok) {
    body = result.body;
  } else {
    if (result.reason) console.error(`[gen-changelog] LLM skipped: ${result.reason}`);
    // Fallback: plain commit list so a release never blocks on the LLM.
    body =
      run(`git --no-pager log --oneline --no-merges ${prevTag || ""}..HEAD`)
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => `- ${l}`)
        .join("\n") || "(no changes in this release)";
  }

  const entry = buildEntry(currentVersion, body);
  if (!onlyPrint) prependToChangelog(entry);

  // Print only the notes body for use as a release description.
  process.stdout.write(body + "\n");
})();