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
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCliStatusResponse } from "portfolio-shared/api-types";
import { cliWorkDir, findCliBinary, parseJsonLine, promptFor, readLines, runCli, stderrTail, systemPromptOf } from "./cli-process.js";
import type { LlmMessage } from "./llm.js";

/** The working directory of every CLI run, created on first use with mode 0700. */
export function claudeCliWorkDir(): string {
  return cliWorkDir("claude-cli");
}

/** `claude` on PATH, else the usual install locations a desktop launch may leave off PATH. */
export function findClaudeBinary(): string | null {
  return findCliBinary("claude", [join(homedir(), ".claude", "local")]);
}

function run(bin: string, args: string[]) {
  return runCli(bin, args, claudeCliWorkDir());
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
  const system = systemPromptOf(messages);
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
    const frame = parseJsonLine<StreamFrame>(line);
    if (!frame) return;
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
  await readLines(proc.stdout, onLine);

  const code = await proc.exited;
  if (options.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  if (isError || code !== 0) {
    const detail = (isError ? result : "") || stderrTail(await stderrText) || `exit code ${code}`;
    throw new Error(`Claude CLI request failed: ${detail}`);
  }
  const text = result ?? (streamed || whole);
  if (!text.trim()) throw new Error("No completion content returned from Claude CLI");
  return text;
}
