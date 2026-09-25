#!/usr/bin/env bun
/**
 * Generates a release changelog entry from the git diff between the previous
 * release tag and the current HEAD, using the Claude Code CLI installed on
 * this machine (`claude -p`). The CLI uses its own sign-in, so the script
 * needs no API token or environment variable.
 *
 * Usage:
 *   bun scripts/gen-changelog.ts --version=<v> [--prev-tag=<tag>] [--only-print]
 *
 * The model answers with JSON; the markdown is rendered here so the changelog
 * keeps one heading hierarchy ("## [<version>]" per release, "### Added" and
 * friends inside it).
 *
 * The script prepends a "## [<version>] - <date>" section to CHANGELOG.md and
 * prints the notes body to stdout. If the CLI is missing, fails or the answer
 * is unusable, it falls back to a plain git log based entry and continues without
 * failing the release.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, "..");
const CHANGELOG = resolve(APP_DIR, "CHANGELOG.md");
const MODEL = "sonnet";

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

/** `claude` on PATH, else the usual install locations. */
function findClaudeBinary(): string | null {
  const onPath = Bun.which("claude");
  if (onPath) return onPath;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const home = homedir();
  const candidates = [join(home, ".local", "bin", exe), join(home, ".claude", "local", exe), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function parseArgs(argv: string[]): { version: string; prevTag: string; toRef: string; onlyPrint: boolean } {
  let version = "";
  let prevTag = "";
  let toRef = "";
  let onlyPrint = false;
  for (const arg of argv) {
    if (arg.startsWith("--version=")) version = arg.slice("--version=".length).replace(/^v/, "");
    else if (arg.startsWith("--prev-tag=")) prevTag = arg.slice("--prev-tag=".length);
    else if (arg.startsWith("--to-tag=")) toRef = arg.slice("--to-tag=".length);
    else if (arg.startsWith("--to=")) toRef = arg.slice("--to=".length);
    else if (arg === "--only-print") onlyPrint = true;
  }
  return { version, prevTag, toRef, onlyPrint };
}

function detectionPrevTag(currentVersion?: string): string {
  const tags = run("git tag --sort=-version:refname")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (!currentVersion) return tags[0] || "";
  const normalized = currentVersion.replace(/^v/, "");
  return tags.find((t) => t.replace(/^v/, "") !== normalized) || "";
}

// ---------------------------------------------------------------------------
// LLM call (Claude Code CLI)
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

async function generateNotes(diffText: string, prevTag: string, version: string, toRef: string = "HEAD"): Promise<{ ok: boolean; body: string; reason?: string }> {
  const bin = findClaudeBinary();
  if (!bin) return { ok: false, body: "", reason: "Claude CLI not found; install Claude Code and run `claude auth login`" };

  const prompt = [
    "You write release notes for the Portfolio application.",
    "Describe the changes of version " + version + " in Simplified English.",
    "The changes are the git diff from " + (prevTag || "start") + " to " + toRef + ".",
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

  // One-shot print mode with tools, MCP servers and slash commands off, so
  // the CLI only answers the prompt and never touches the repo.
  const proc = Bun.spawn(
    [
      bin,
      "-p",
      "--output-format", "json",
      "--model", MODEL,
      "--tools", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--system-prompt", "You are a helpful release note writer that answers with JSON only.",
    ],
    {
      cwd: tmpdir(),
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(180_000),
    },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  let answer: { result?: string; is_error?: boolean } = {};
  try {
    answer = JSON.parse(stdout) as typeof answer;
  } catch {
    // Reported below with stderr.
  }
  if (code !== 0 || answer.is_error) {
    const detail = (answer.result || stderr.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`).slice(0, 300);
    return { ok: false, body: "", reason: `Claude CLI failed: ${detail}` };
  }

  const content = answer.result || "";
  if (!content.trim()) return { ok: false, body: "", reason: "Claude CLI returned empty content" };

  const parsed = parseNotes(sanitize(content));
  if (!parsed) return { ok: false, body: "", reason: "Claude CLI returned no JSON object" };

  const body = renderNotes(parsed);
  if (!body) return { ok: false, body: "", reason: "Claude CLI returned no usable release note items" };
  return { ok: true, body };
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
  const { version, prevTag: prevArg, toRef: toArg, onlyPrint } = parseArgs(process.argv.slice(2));
  const currentVersion = version || (process.env.npm_package_version || "");

  if (!currentVersion) {
    console.error("[gen-changelog] Missing --version argument.");
    process.exitCode = 1;
    return;
  }

  const prevTag = prevArg || detectionPrevTag(currentVersion);
  let toRef = toArg;
  if (!toRef) {
    const versionTag = `v${currentVersion}`;
    const tagExists = run(`git rev-parse "${versionTag}" >/dev/null 2>&1 && echo yes || echo no`) === "yes";
    toRef = tagExists ? versionTag : "HEAD";
  }

  const diffRange = prevTag ? `${prevTag}..${toRef}` : toRef;
  const diffText = [
    "Commits:",
    run(`git --no-pager log --format="- %s%n%b" --no-merges ${diffRange}`) || "(none)",
    "",
    "Changed files:",
    run(`git --no-pager diff --stat ${diffRange}`) || "(none)",
  ].join("\n");

  const result = await generateNotes(diffText, prevTag, currentVersion, toRef);

  let body: string;
  if (result.ok) {
    body = result.body;
  } else {
    if (result.reason) console.error(`[gen-changelog] LLM skipped: ${result.reason}`);
    // Fallback: plain commit list so a release never blocks on the LLM.
    body =
      run(`git --no-pager log --oneline --no-merges ${diffRange}`)
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