import { describe, it, expect, afterAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claudeCliComplete, claudeCliWorkDir } from "../claude-cli.js";
import { DATA_DIR } from "../../paths.js";
import type { LlmMessage } from "../llm.js";

/** One start of the fake CLI. `probe` marks a start that stopped at the option check. */
interface FakeRun {
  probe: boolean;
  cwd: string;
  args: string[];
  systemFile: string | null;
  systemText: string | null;
  systemMode: number | null;
  stdin: string;
}

const fakeDirs: string[] = [];
afterAll(() => {
  for (const dir of fakeDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A stand-in for the `claude` binary: a Bun script that records how it was
 * started and answers with one `result` frame. `fileFlag: false` acts like a
 * CLI without `--system-prompt-file`; `fail` ends every completion with an error.
 */
function fakeCli(options: { fileFlag: boolean; fail?: boolean }): { bin: string; runs: () => FakeRun[] } {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  fakeDirs.push(dir);
  const log = join(dir, "runs.jsonl");
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const record = (fields) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ probe: false, cwd: process.cwd(), args, systemFile: null, systemText: null, systemMode: null, stdin: "", ...fields }) + "\\n");
const at = args.indexOf("--system-prompt-file");
if (at >= 0 && !${options.fileFlag}) {
  record({ probe: true });
  console.error("error: unknown option '--system-prompt-file'");
  process.exit(1);
}
const systemFile = at >= 0 ? args[at + 1] : null;
if (systemFile && !fs.existsSync(systemFile)) {
  record({ probe: true });
  console.error("Error: System prompt file not found: " + systemFile);
  process.exit(1);
}
record({
  systemFile,
  systemText: systemFile ? fs.readFileSync(systemFile, "utf8") : null,
  systemMode: systemFile ? fs.statSync(systemFile).mode & 0o777 : null,
  stdin: fs.readFileSync(0, "utf8"),
});
if (${Boolean(options.fail)}) {
  console.log(JSON.stringify({ type: "result", result: "Model overloaded", is_error: true }));
  process.exit(1);
}
console.log(JSON.stringify({ type: "result", result: "Fine.", is_error: false }));
`,
  );
  chmodSync(bin, 0o755);
  const runs = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as FakeRun) : []);
  return { bin, runs };
}

const LEDGER = "=== FULL HOLDINGS LEDGER ===\n- **AAPL** (Apple Inc, Type: Stock): weight 12.5%";
const messages: LlmMessage[] = [
  { role: "system", content: LEDGER },
  { role: "user", content: "How concentrated is my portfolio?" },
];
const timeout = () => AbortSignal.timeout(20_000);
const completions = (runs: FakeRun[]) => runs.filter((r) => !r.probe);

// The fake CLI is a shebang script, which Windows cannot start.
describe.skipIf(process.platform === "win32")("Claude CLI process", () => {
  it("runs in a private directory under the data directory, not in the shared temp directory", async () => {
    const cli = fakeCli({ fileFlag: true });
    expect(await claudeCliComplete(messages, { bin: cli.bin, signal: timeout() })).toBe("Fine.");

    const [run] = completions(cli.runs());
    expect(realpathSync(run!.cwd)).toBe(realpathSync(join(DATA_DIR, "claude-cli")));
    expect(realpathSync(run!.cwd)).not.toBe(realpathSync(tmpdir()));
    expect(statSync(claudeCliWorkDir()).mode & 0o777).toBe(0o700);
  });

  it("passes the system prompt in a file only the user can read, and deletes it afterwards", async () => {
    const cli = fakeCli({ fileFlag: true });
    await claudeCliComplete(messages, { bin: cli.bin, signal: timeout() });

    const [run] = completions(cli.runs());
    expect(run!.args).toContain("--system-prompt-file");
    expect(run!.args).not.toContain("--system-prompt");
    expect(run!.args.some((arg) => arg.includes("AAPL"))).toBe(false);
    expect(run!.systemText).toBe(LEDGER);
    expect(run!.systemMode).toBe(0o600);
    expect(realpathSync(dirname(run!.systemFile!))).toBe(realpathSync(claudeCliWorkDir()));
    expect(existsSync(run!.systemFile!)).toBe(false);
    expect(run!.stdin).toBe("How concentrated is my portfolio?");
  });

  it("deletes the system prompt file when the CLI fails", async () => {
    const cli = fakeCli({ fileFlag: true, fail: true });
    await expect(claudeCliComplete(messages, { bin: cli.bin, signal: timeout() })).rejects.toThrow("Model overloaded");

    const [run] = completions(cli.runs());
    expect(run!.systemText).toBe(LEDGER);
    expect(existsSync(run!.systemFile!)).toBe(false);
  });

  it("falls back to --system-prompt when the CLI lacks the file flag, and probes it only once", async () => {
    const cli = fakeCli({ fileFlag: false });
    await claudeCliComplete(messages, { bin: cli.bin, signal: timeout() });
    await claudeCliComplete(messages, { bin: cli.bin, signal: timeout() });

    const runs = cli.runs();
    expect(runs.filter((r) => r.probe).length).toBe(1);
    const done = completions(runs);
    expect(done.length).toBe(2);
    expect(done[0]!.args).not.toContain("--system-prompt-file");
    expect(done[0]!.args[done[0]!.args.indexOf("--system-prompt") + 1]).toBe(LEDGER);
  });

  it("probes a CLI with the file flag only once", async () => {
    const cli = fakeCli({ fileFlag: true });
    await claudeCliComplete(messages, { bin: cli.bin, signal: timeout() });
    await claudeCliComplete(messages, { bin: cli.bin, signal: timeout() });

    const runs = cli.runs();
    expect(runs.filter((r) => r.probe).length).toBe(1);
    expect(completions(runs).every((r) => r.args.includes("--system-prompt-file"))).toBe(true);
  });

  it("starts without a probe or a file when there is no system prompt", async () => {
    const cli = fakeCli({ fileFlag: true });
    await claudeCliComplete([{ role: "user", content: "Hello" }], { bin: cli.bin, signal: timeout() });

    const runs = cli.runs();
    expect(runs.length).toBe(1);
    expect(runs[0]!.args).not.toContain("--system-prompt-file");
    expect(runs[0]!.args).not.toContain("--system-prompt");
  });
});

/** A fake `claude` that records args/stdin, prints the given raw lines on stdout, optional stderr, then exits. */
function framesCli(lines: string[], opts: { code?: number; stderr?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-frames-"));
  fakeDirs.push(dir);
  const log = join(dir, "runs.jsonl");
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), stdin: fs.readFileSync(0, "utf8") }) + "\\n");
for (const l of ${JSON.stringify(lines)}) console.log(l);
${opts.stderr ? `console.error(${JSON.stringify(opts.stderr)});` : ""}
process.exit(${opts.code ?? 0});
`,
  );
  chmodSync(bin, 0o755);
  const runs = () =>
    existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; stdin: string }) : [];
  return { bin, runs };
}
const delta = (text: string) => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const assistant = (content: object[]) => JSON.stringify({ type: "assistant", message: { content } });
const result = (text: string, isError = false) => JSON.stringify({ type: "result", result: text, is_error: isError });
const userOnly: LlmMessage[] = [{ role: "user", content: "Hi" }];
const BASE_ARGS = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--tools",
  "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
];

describe.skipIf(process.platform === "win32")("Claude CLI stream frames", () => {
  it("streams text deltas to onChunk and resolves with the result frame", async () => {
    const cli = framesCli([delta("Hel"), delta("lo"), assistant([{ type: "text", text: "Hello" }]), result("Hello")]);
    const chunks: string[] = [];
    expect(await claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout(), onChunk: (c) => chunks.push(c) })).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("joins the deltas when no result frame arrives", async () => {
    const cli = framesCli([delta("A"), delta("B")]);
    expect(await claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout() })).toBe("AB");
  });

  it("joins the text of assistant frames without calling onChunk", async () => {
    const cli = framesCli([assistant([{ type: "text", text: "X" }, { type: "tool_use" }]), assistant([{ type: "text", text: "Y" }])]);
    const chunks: string[] = [];
    expect(await claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout(), onChunk: (c) => chunks.push(c) })).toBe("XY");
    expect(chunks).toEqual([]);
  });

  it("does not call onChunk for an empty delta", async () => {
    const cli = framesCli([delta(""), delta("A"), result("A")]);
    const chunks: string[] = [];
    await claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout(), onChunk: (c) => chunks.push(c) });
    expect(chunks).toEqual(["A"]);
  });

  it("ignores lines that are not JSON", async () => {
    const cli = framesCli(["warning: slow", "", delta("Hello"), "", result("Hello")]);
    expect(await claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout() })).toBe("Hello");
  });

  it("rejects on an error result even when the exit code is 0", async () => {
    const cli = framesCli([result("Rate limited", true)]);
    await expect(claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout() })).rejects.toThrow("Claude CLI request failed: Rate limited");
  });

  it("reports the last three stderr lines on a failed exit", async () => {
    const cli = framesCli([], { code: 2, stderr: "line1\nline2\nline3\nline4" });
    await expect(claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout() })).rejects.toThrow(
      "Claude CLI request failed: line2 line3 line4",
    );
  });

  it("reports the exit code when stderr is empty", async () => {
    const cli = framesCli([], { code: 3 });
    await expect(claudeCliComplete(userOnly, { bin: cli.bin, signal: timeout() })).rejects.toThrow("Claude CLI request failed: exit code 3");
  });

  it("rejects an empty or blank result and does not replace it with streamed text", async () => {
    const empty = framesCli([delta("streamed"), result("")]);
    await expect(claudeCliComplete(userOnly, { bin: empty.bin, signal: timeout() })).rejects.toThrow(
      "No completion content returned from Claude CLI",
    );
    const blank = framesCli([result("   ")]);
    await expect(claudeCliComplete(userOnly, { bin: blank.bin, signal: timeout() })).rejects.toThrow(
      "No completion content returned from Claude CLI",
    );
  });

  it("passes the fixed arguments and the model", async () => {
    const withModel = framesCli([result("ok")]);
    await claudeCliComplete(userOnly, { bin: withModel.bin, model: "opus", signal: timeout() });
    expect(withModel.runs()[0]!.args).toEqual([...BASE_ARGS, "--model", "opus"]);

    const noModel = framesCli([result("ok")]);
    await claudeCliComplete(userOnly, { bin: noModel.bin, signal: timeout() });
    expect(noModel.runs()[0]!.args).toEqual(BASE_ARGS);
  });

  it("writes a multi-turn conversation as a transcript on stdin", async () => {
    const cli = framesCli([result("ok")]);
    const turns: LlmMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "How?" },
    ];
    await claudeCliComplete(turns, { bin: cli.bin, signal: timeout() });
    expect(cli.runs()[0]!.stdin).toBe("User: Hi\n\nAssistant: Hello\n\nUser: How?\n\nReply to the last User message as the Assistant.");
  });

  it("rejects with an AbortError and never starts when the signal is already aborted", async () => {
    const cli = framesCli([result("ok")]);
    const error = await claudeCliComplete(userOnly, { bin: cli.bin, signal: AbortSignal.abort() }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.name).toBe("AbortError");
    expect(cli.runs()).toEqual([]);
  });

  it("rejects when the binary does not exist", async () => {
    await expect(claudeCliComplete(userOnly, { bin: "/nonexistent/claude", signal: timeout() })).rejects.toThrow();
  });
});

// Bun.which reads PATH from the start-up environment, so a runtime PATH change cannot point it at a fake CLI.
describe("getClaudeCliStatus", () => {
  it.skip("parses version and sign-in state from a fake CLI on PATH (Bun.which ignores a runtime PATH change)", () => {});
});
