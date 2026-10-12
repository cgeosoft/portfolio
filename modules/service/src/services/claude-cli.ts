/**
 * Inference through the Claude Code CLI installed on this machine.
 *
 * The CLI signs in with the user's Claude subscription, so no API key passes
 * through the app. Each request spawns `claude -p` with tools, MCP servers and
 * slash commands off, feeds the conversation on stdin and reads the
 * `stream-json` frames from stdout.
 *
 * Every run starts in `<data>/claude-cli`, which only this user can write.
 * The CLI loads `.claude/settings.json` (hooks included) and `CLAUDE.md` from
 * the directory it starts in, so a shared one such as /tmp would let another
 * local user run commands as this user. The system prompt can hold the
 * portfolio ledger, and any local user can read a command line, so it goes to
 * the CLI in a file in that directory when the CLI takes one.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCliStatusResponse } from "portfolio-shared/api-types";
import { DATA_DIR } from "../paths.js";
import type { LlmMessage } from "./llm.js";

const STATUS_TIMEOUT_MS = 15_000;

/** The working directory of every CLI run, created on first use with mode 0700. */
export function claudeCliWorkDir(): string {
  const dir = join(DATA_DIR, "claude-cli");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** `claude` on PATH, else the usual install locations a desktop launch may leave off PATH. */
export function findClaudeBinary(): string | null {
  const onPath = Bun.which("claude");
  if (onPath) return onPath;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", exe),
    join(home, ".claude", "local", exe),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

async function run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const signal = AbortSignal.timeout(STATUS_TIMEOUT_MS);
  const proc = Bun.spawn([bin, ...args], {
    cwd: claudeCliWorkDir(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr, timedOut: signal.aborted };
}

/** Per CLI binary: whether it takes `--system-prompt-file`. */
const systemPromptFileSupport = new Map<string, Promise<boolean>>();

/**
 * Whether the CLI takes `--system-prompt-file`. `--help` names the flag only
 * inside the text of another option, so the probe asks the parser: it names a
 * file that does not exist. A CLI with the flag stops on the missing file, one
 * without it on the unknown option; neither reads a prompt or reaches the
 * model. The answer is kept per binary. A probe that times out or does not
 * start counts as "no" and runs again on the next request.
 */
function supportsSystemPromptFile(bin: string): Promise<boolean> {
  let known = systemPromptFileSupport.get(bin);
  if (!known) {
    const retryLater = () => {
      systemPromptFileSupport.delete(bin);
      return false;
    };
    known = run(bin, ["-p", "--system-prompt-file", join(claudeCliWorkDir(), "probe-missing.txt")]).then(
      ({ stdout, stderr, timedOut }) => (timedOut ? retryLater() : !/unknown option/i.test(`${stderr}\n${stdout}`)),
      retryLater,
    );
    systemPromptFileSupport.set(bin, known);
  }
  return known;
}

interface AuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

/** Whether the CLI is installed and signed in. Never returns the account email. */
export async function getClaudeCliStatus(): Promise<ClaudeCliStatusResponse> {
  const bin = findClaudeBinary();
  if (!bin) {
    return {
      installed: false,
      loggedIn: false,
      message: "Claude CLI not found. Install Claude Code, then run `claude auth login` in a terminal.",
    };
  }
  try {
    const versionRun = await run(bin, ["--version"]);
    const version = versionRun.stdout.trim().split(/\s+/)[0] || undefined;
    if (versionRun.code !== 0) {
      return { installed: false, loggedIn: false, message: `Claude CLI at ${bin} failed to start: ${versionRun.stderr.trim()}` };
    }

    const authRun = await run(bin, ["auth", "status", "--json"]);
    let auth: AuthStatus = {};
    try {
      auth = JSON.parse(authRun.stdout) as AuthStatus;
    } catch {
      return {
        installed: true,
        version,
        loggedIn: false,
        message: `Claude CLI ${version ?? ""} could not report its sign-in state. Update Claude Code and run \`claude auth login\`.`,
      };
    }
    if (!auth.loggedIn) {
      return { installed: true, version, loggedIn: false, message: "Claude CLI is installed but not signed in. Run `claude auth login` in a terminal." };
    }
    const plan = auth.authMethod === "claude.ai" && auth.subscriptionType ? `Claude ${auth.subscriptionType} subscription` : (auth.authMethod ?? "unknown method");
    return {
      installed: true,
      version,
      loggedIn: true,
      authMethod: auth.authMethod,
      subscriptionType: auth.subscriptionType,
      message: `Claude CLI ${version ?? ""} signed in with ${plan}.`.replace("  ", " "),
    };
  } catch (err) {
    return { installed: true, loggedIn: false, message: `Claude CLI check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The CLI takes one prompt; earlier turns are replayed as a labelled transcript. */
function promptFor(messages: LlmMessage[]): string {
  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length === 1) return turns[0]!.content;
  const transcript = turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return `${transcript}\n\nReply to the last User message as the Assistant.`;
}

interface StreamFrame {
  type?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: Array<{ type?: string; text?: string }> };
  result?: string;
  is_error?: boolean;
}

export interface ClaudeCliCompleteOptions {
  model?: string;
  signal: AbortSignal;
  onChunk?: (chunk: string) => void;
  /** The CLI to run; `findClaudeBinary()` when left out. */
  bin?: string;
}

/** Runs one completion; streams text deltas through onChunk when given. */
export async function claudeCliComplete(messages: LlmMessage[], options: ClaudeCliCompleteOptions): Promise<string> {
  const bin = options.bin ?? findClaudeBinary();
  if (!bin) throw new Error("Claude CLI not found. Install Claude Code and sign in, then select Claude CLI again in Settings > Assistant.");

  const cwd = claudeCliWorkDir();
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  // Only this user can read the file; a command line is visible to every local user.
  const systemFile = system && (await supportsSystemPromptFile(bin)) ? join(cwd, `system-${randomUUID()}.txt`) : null;
  if (options.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  if (systemFile) writeFileSync(systemFile, system, { mode: 0o600, flag: "wx" });

  try {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      ...(systemFile ? ["--system-prompt-file", systemFile] : system ? ["--system-prompt", system] : []),
      ...(options.model ? ["--model", options.model] : []),
    ];
    return await streamCompletion(bin, args, cwd, messages, options);
  } finally {
    if (systemFile) rmSync(systemFile, { force: true });
  }
}

/** Spawns the CLI and collects the reply from its `stream-json` frames. */
async function streamCompletion(bin: string, args: string[], cwd: string, messages: LlmMessage[], options: ClaudeCliCompleteOptions): Promise<string> {
  const proc = Bun.spawn([bin, ...args], {
    cwd,
    stdin: new Blob([promptFor(messages)]),
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal,
  });
  const stderrText = new Response(proc.stderr).text();

  let streamed = "";
  let whole = "";
  let result: string | undefined;
  let isError = false;
  const onLine = (line: string) => {
    if (!line.trim()) return;
    let frame: StreamFrame;
    try {
      frame = JSON.parse(line) as StreamFrame;
    } catch {
      return; // not a JSON frame
    }
    if (frame.type === "stream_event" && frame.event?.type === "content_block_delta" && frame.event.delta?.type === "text_delta") {
      const text = frame.event.delta.text ?? "";
      streamed += text;
      if (text) options.onChunk?.(text);
    } else if (frame.type === "assistant") {
      whole += (frame.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    } else if (frame.type === "result") {
      result = frame.result;
      isError = Boolean(frame.is_error);
    }
  };

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of proc.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(onLine);
  }
  onLine(buffer);

  const code = await proc.exited;
  if (options.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  if (isError || code !== 0) {
    const detail = (isError ? result : "") || (await stderrText).trim().split("\n").slice(-3).join(" ") || `exit code ${code}`;
    throw new Error(`Claude CLI request failed: ${detail}`);
  }
  const text = result ?? (streamed || whole);
  if (!text.trim()) throw new Error("No completion content returned from Claude CLI");
  return text;
}
