import { describe, it, expect, afterAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { codexCliComplete, codexCliWorkDir } from "../codex-cli.js";
import { DATA_DIR } from "../../paths.js";
import type { LlmMessage } from "../llm.js";

/** One start of the fake CLI. */
interface FakeRun {
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
 * A stand-in for the `codex` binary: a Bun script that records how it was
 * started and prints the given `exec --json` events, then exits with `code`.
 */
function fakeCli(events: object[], code = 0): { bin: string; runs: () => FakeRun[] } {
  const dir = mkdtempSync(join(tmpdir(), "fake-codex-"));
  fakeDirs.push(dir);
  const log = join(dir, "runs.jsonl");
  const bin = join(dir, "codex");
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const override = args.find((a) => a.startsWith("model_instructions_file="));
const systemFile = override ? JSON.parse(override.slice("model_instructions_file=".length)) : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  cwd: process.cwd(),
  args,
  systemFile,
  systemText: systemFile ? fs.readFileSync(systemFile, "utf8") : null,
  systemMode: systemFile ? fs.statSync(systemFile).mode & 0o777 : null,
  stdin: fs.readFileSync(0, "utf8"),
}) + "\\n");
for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));
process.exit(${code});
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

const reply = (text: string) => ({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } });
const SUCCESS = [{ type: "thread.started", thread_id: "t" }, { type: "turn.started" }, reply("Fine."), { type: "turn.completed", usage: {} }];

// The fake CLI is a shebang script, which Windows cannot start.
describe.skipIf(process.platform === "win32")("Codex CLI process", () => {
  it("runs exec without tools in a private directory and reads the prompt from stdin", async () => {
    const cli = fakeCli(SUCCESS);
    expect(await codexCliComplete(messages, { bin: cli.bin, signal: timeout() })).toBe("Fine.");

    const [run] = cli.runs();
    expect(realpathSync(run!.cwd)).toBe(realpathSync(join(DATA_DIR, "codex-cli")));
    expect(run!.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(run!.args).toContain("--ignore-user-config");
    expect(run!.args).toContain("--ephemeral");
    expect(run!.args).toContain("features.shell_tool=false");
    expect(run!.args[run!.args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(run!.args.at(-1)).toBe("-");
    expect(run!.stdin).toBe("How concentrated is my portfolio?");
  });

  it("passes the system prompt in a file only the user can read, and deletes it afterwards", async () => {
    const cli = fakeCli(SUCCESS);
    await codexCliComplete(messages, { bin: cli.bin, signal: timeout() });

    const [run] = cli.runs();
    expect(run!.args.some((arg) => arg.includes("AAPL"))).toBe(false);
    expect(run!.systemText).toBe(LEDGER);
    expect(run!.systemMode).toBe(0o600);
    expect(realpathSync(dirname(run!.systemFile!))).toBe(realpathSync(codexCliWorkDir()));
    expect(existsSync(run!.systemFile!)).toBe(false);
  });

  it("starts without an instructions file when there is no system prompt, and passes the model", async () => {
    const cli = fakeCli(SUCCESS);
    await codexCliComplete([{ role: "user", content: "Hello" }], { bin: cli.bin, model: "gpt-6-sol", signal: timeout() });

    const [run] = cli.runs();
    expect(run!.systemFile).toBeNull();
    expect(run!.args[run!.args.indexOf("--model") + 1]).toBe("gpt-6-sol");
  });

  it("takes the last agent message and hands it to onChunk once", async () => {
    const cli = fakeCli([reply("Thinking out loud."), { type: "error", message: "Reconnecting... 1/5" }, reply("Final answer."), { type: "turn.completed" }]);
    const chunks: string[] = [];
    expect(await codexCliComplete(messages, { bin: cli.bin, signal: timeout(), onChunk: (c) => chunks.push(c) })).toBe("Final answer.");
    expect(chunks).toEqual(["Final answer."]);
  });

  it("reports a failed turn and still deletes the system prompt file", async () => {
    const cli = fakeCli([{ type: "turn.started" }, { type: "turn.failed", error: { message: "usage limit reached" } }], 1);
    await expect(codexCliComplete(messages, { bin: cli.bin, signal: timeout() })).rejects.toThrow("usage limit reached");

    const [run] = cli.runs();
    expect(run!.systemText).toBe(LEDGER);
    expect(existsSync(run!.systemFile!)).toBe(false);
  });

  it("fails when the turn ends without a reply", async () => {
    const cli = fakeCli([{ type: "turn.started" }, { type: "turn.completed" }]);
    await expect(codexCliComplete(messages, { bin: cli.bin, signal: timeout() })).rejects.toThrow("No completion content");
  });
});

describe.skipIf(process.platform === "win32")("Codex CLI failures and streaming", () => {
  it("reports an error event on a failed exit", async () => {
    const cli = fakeCli([{ type: "error", message: "stream disconnected" }], 1);
    await expect(codexCliComplete(messages, { bin: cli.bin, signal: timeout() })).rejects.toThrow("Codex CLI request failed: stream disconnected");
  });

  it("reports a failed turn without a message", async () => {
    const cli = fakeCli([{ type: "turn.failed", error: {} }], 0);
    await expect(codexCliComplete(messages, { bin: cli.bin, signal: timeout() })).rejects.toThrow("Codex CLI request failed: turn failed");
  });

  it("reports the exit code when there are no events", async () => {
    const cli = fakeCli([], 7);
    await expect(codexCliComplete(messages, { bin: cli.bin, signal: timeout() })).rejects.toThrow("Codex CLI request failed: exit code 7");
  });

  it("rejects an aborted request with an AbortError, leaves no instructions file and never starts", async () => {
    const cli = fakeCli(SUCCESS);
    const error = await codexCliComplete(messages, { bin: cli.bin, signal: AbortSignal.abort() }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.name).toBe("AbortError");
    expect(readdirSync(codexCliWorkDir()).filter((f) => f.startsWith("system-"))).toEqual([]);
    expect(cli.runs()).toEqual([]);
  });

  it("hands a reply without a system message to onChunk once", async () => {
    const cli = fakeCli(SUCCESS);
    const chunks: string[] = [];
    const answer = await codexCliComplete([{ role: "user", content: "Hello" }], { bin: cli.bin, signal: timeout(), onChunk: (c) => chunks.push(c) });
    expect(answer).toBe("Fine.");
    expect(chunks).toEqual(["Fine."]);
  });
});

// Bun.which reads PATH from the start-up environment, so a runtime PATH change cannot point it at a fake CLI.
describe("getCodexCliStatus", () => {
  it.skip("parses version and sign-in state from a fake CLI on PATH (Bun.which ignores a runtime PATH change)", () => {});
});
