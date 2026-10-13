/**
 * Inference through the OpenAI Codex CLI installed on this machine.
 *
 * The CLI signs in with the user's ChatGPT plan (`codex login`), so no API
 * key passes through the app. Each request runs `codex exec --json` and feeds
 * the conversation on stdin. `exec` reports the reply as one `agent_message`
 * item when the turn ends, not as text deltas, so a streamed request gets the
 * whole reply in one chunk.
 *
 * The run is a plain completion, not a coding agent: it ignores the user's
 * `config.toml` (and so its MCP servers), turns the shell and web search off,
 * keeps the sandbox read-only, reads no AGENTS.md and saves no session. It
 * starts in `<data>/codex-cli`, which only this user can write and which is
 * not a git checkout. The system prompt replaces Codex's own instructions
 * through `model_instructions_file`; it can hold the portfolio ledger and any
 * local user can read a command line, so it goes in a 0600 file in that
 * directory and only the path is on the command line.
 */

import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliProviderStatusResponse } from "portfolio-shared/api-types";
import { cliWorkDir, findCliBinary, parseJsonLine, promptFor, readLines, runCli, stderrTail, systemPromptOf, versionOf } from "./cli-process.js";
import type { LlmMessage } from "./llm.js";

/** The working directory of every CLI run, created on first use with mode 0700. */
export function codexCliWorkDir(): string {
  return cliWorkDir("codex-cli");
}

/** `codex` on PATH, else the install locations of the install script, npm and Homebrew. */
export function findCodexBinary(): string | null {
  const windowsInstall = process.platform === "win32" ? [join(homedir(), "AppData", "Local", "Programs", "OpenAI", "Codex", "bin")] : [];
  return findCliBinary("codex", windowsInstall);
}

/** Whether the CLI is installed and signed in. `codex login status` answers on stderr and exits 1 when signed out. */
export async function getCodexCliStatus(): Promise<CliProviderStatusResponse> {
  const bin = findCodexBinary();
  if (!bin) {
    return { installed: false, loggedIn: false, message: "Codex CLI not found. Install Codex, then run `codex login` in a terminal." };
  }
  const cwd = codexCliWorkDir();
  try {
    const versionRun = await runCli(bin, ["--version"], cwd);
    if (versionRun.code !== 0) {
      return { installed: false, loggedIn: false, message: `Codex CLI at ${bin} failed to start: ${stderrTail(versionRun.stderr)}` };
    }
    const version = versionOf(versionRun.stdout);
    const label = `Codex CLI${version ? ` ${version}` : ""}`;

    const authRun = await runCli(bin, ["login", "status"], cwd);
    const said = `${authRun.stderr}\n${authRun.stdout}`;
    const method = /Logged in using (.+)/i.exec(said)?.[1]?.trim();
    if (authRun.code !== 0 || !method) {
      return { installed: true, version, loggedIn: false, message: `${label} is installed but not signed in. Run \`codex login\` in a terminal.` };
    }
    const isChatGpt = /^chatgpt/i.test(method);
    // An API key sign-in prints a masked key after the method; keep only the method.
    const how = isChatGpt ? "your ChatGPT plan" : method.replace(/\s+-\s+.*$/, "");
    return { installed: true, version, loggedIn: true, authMethod: isChatGpt ? "chatgpt" : how, message: `${label} signed in with ${how}.` };
  } catch (err) {
    return { installed: true, loggedIn: false, message: `Codex CLI check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

interface ExecEvent {
  type?: string;
  item?: { type?: string; text?: string };
  error?: { message?: string };
  message?: string;
}

export interface CodexCliCompleteOptions {
  model?: string;
  signal: AbortSignal;
  onChunk?: (chunk: string) => void;
  /** The CLI to run; `findCodexBinary()` when left out. */
  bin?: string;
}

/** A TOML string for a `-c key=value` override. JSON escapes are valid TOML basic-string escapes. */
const tomlString = (value: string) => JSON.stringify(value);

/** Runs one completion; the reply reaches onChunk in one piece when the turn ends. */
export async function codexCliComplete(messages: LlmMessage[], options: CodexCliCompleteOptions): Promise<string> {
  const bin = options.bin ?? findCodexBinary();
  if (!bin) throw new Error("Codex CLI not found. Install Codex and sign in, then select Codex CLI again in Settings > Assistant.");

  const cwd = codexCliWorkDir();
  const system = systemPromptOf(messages);
  // Only this user can read the file; a command line is visible to every local user.
  const systemFile = system ? join(cwd, `system-${randomUUID()}.md`) : null;
  if (options.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  if (systemFile) writeFileSync(systemFile, system, { mode: 0o600, flag: "wx" });

  try {
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "read-only",
      "-C", cwd,
      "-c", "features.shell_tool=false",
      "-c", `web_search=${tomlString("disabled")}`,
      "-c", "project_doc_max_bytes=0",
      ...(systemFile ? ["-c", `model_instructions_file=${tomlString(systemFile)}`] : []),
      ...(options.model ? ["--model", options.model] : []),
      "-",
    ];
    return await runExec(bin, args, cwd, messages, options);
  } finally {
    if (systemFile) rmSync(systemFile, { force: true });
  }
}

/** Spawns `codex exec` and takes the last `agent_message` of the turn as the reply. */
async function runExec(bin: string, args: string[], cwd: string, messages: LlmMessage[], options: CodexCliCompleteOptions): Promise<string> {
  const proc = Bun.spawn([bin, ...args], {
    cwd,
    stdin: new Blob([promptFor(messages)]),
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal,
  });
  const stderrText = new Response(proc.stderr).text();

  let reply = "";
  let failure: string | undefined;
  // An `error` event can come before a retry that succeeds; it only explains a failed run.
  let lastError: string | undefined;
  await readLines(proc.stdout, (line) => {
    const event = parseJsonLine<ExecEvent>(line);
    if (!event) return;
    if (event.type === "item.completed" && event.item?.type === "agent_message") reply = event.item.text ?? "";
    else if (event.type === "turn.failed") failure = event.error?.message || "turn failed";
    else if (event.type === "error") lastError = event.message;
  });

  const code = await proc.exited;
  if (options.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  if (failure !== undefined || code !== 0) {
    const detail = failure || lastError || stderrTail(await stderrText) || `exit code ${code}`;
    throw new Error(`Codex CLI request failed: ${detail}`);
  }
  if (!reply.trim()) throw new Error("No completion content returned from Codex CLI");
  options.onChunk?.(reply);
  return reply;
}
