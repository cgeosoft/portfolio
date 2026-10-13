/**
 * Shared plumbing for the vendor CLIs that serve as inference providers
 * (Claude Code, Codex, Gemini). Each signs in with the user's own account, so
 * no API key passes through the app.
 *
 * Every run starts in `<data>/<cli>`, which only this user can write: a CLI
 * reads settings and instruction files (hooks, AGENTS.md, GEMINI.md) from the
 * directory it starts in, so a shared one such as /tmp would let another
 * local user steer it.
 */

import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "../paths.js";
import type { LlmMessage } from "./llm.js";

const STATUS_TIMEOUT_MS = 15_000;

/** `<data>/<name>` with mode 0700, created on first use and tightened when an older release left it open. */
export function cliWorkDir(name: string): string {
  const dir = join(DATA_DIR, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && (statSync(dir).mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  return dir;
}

/**
 * `name` on PATH, else the usual install locations a desktop launch may leave
 * off PATH (user-local bin, npm global, Homebrew). `extraDirs` adds the ones
 * only this CLI uses.
 */
export function findCliBinary(name: string, extraDirs: string[] = []): string | null {
  const onPath = Bun.which(name);
  if (onPath) return onPath;
  const home = homedir();
  const isWindows = process.platform === "win32";
  const exes = isWindows ? [`${name}.exe`, `${name}.cmd`] : [name];
  const dirs = [
    join(home, ".local", "bin"),
    ...extraDirs,
    join(home, ".npm-global", "bin"),
    ...(isWindows ? [join(home, "AppData", "Roaming", "npm")] : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs) {
    for (const exe of exes) {
      const path = join(dir, exe);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** A short run with no input (version, sign-in status), stopped after 15 seconds. */
export async function runCli(bin: string, args: string[], cwd: string): Promise<CliRun> {
  const signal = AbortSignal.timeout(STATUS_TIMEOUT_MS);
  const proc = Bun.spawn([bin, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr, timedOut: signal.aborted };
}

/** The first version-like token of `--version` output, e.g. "0.46.0" from "codex-cli 0.46.0". */
export function versionOf(output: string): string | undefined {
  return /\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?/.exec(output)?.[0];
}

/** A CLI takes one prompt; earlier turns are replayed as a labelled transcript. */
export function promptFor(messages: LlmMessage[]): string {
  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length === 1) return turns[0]!.content;
  const transcript = turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return `${transcript}\n\nReply to the last User message as the Assistant.`;
}

/** The system messages joined, empty when there are none. */
export function systemPromptOf(messages: LlmMessage[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
}

/** Calls onLine for every line of a stream, the last one included when it has no newline. */
export async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(onLine);
  }
  onLine(buffer);
}

/** One JSON line as an object, or null for a blank or non-JSON line. */
export function parseJsonLine<T>(line: string): T | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/** The last lines of stderr as one line, for an error message. */
export function stderrTail(stderr: string, lines = 3): string {
  return stderr.trim().split("\n").slice(-lines).join(" ");
}
