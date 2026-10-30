/** Shared CLI helpers: version parsing, prompt flattening, line reading, private work dirs and process runs. */
import { describe, it, expect, afterAll } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliWorkDir, findCliBinary, runCli, versionOf, promptFor, systemPromptOf, readLines, parseJsonLine, stderrTail } from "../cli-process.js";
import { DATA_DIR } from "../../paths.js";
import type { LlmMessage } from "../llm.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const enc = new TextEncoder();
const stream = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of chunks) c.enqueue(b);
      c.close();
    },
  });
async function lines(chunks: Uint8Array[]): Promise<string[]> {
  const out: string[] = [];
  await readLines(stream(chunks), (line) => out.push(line));
  return out;
}
const msg = (role: LlmMessage["role"], content: string) => ({ role, content }) as LlmMessage;

describe("versionOf", () => {
  it("finds the version number", () => {
    expect(versionOf("codex-cli 0.46.0")).toBe("0.46.0");
    expect(versionOf("2.1.3 (Claude Code)")).toBe("2.1.3");
    expect(versionOf("v1.2")).toBe("1.2");
    expect(versionOf("tool 1.2.3-beta.1 build")).toBe("1.2.3-beta.1");
    expect(versionOf("no version")).toBeUndefined();
    expect(versionOf("")).toBeUndefined();
  });
});

describe("promptFor / systemPromptOf", () => {
  it("sends a single question as is", () => {
    expect(promptFor([msg("user", "Hi")])).toBe("Hi");
    expect(promptFor([msg("system", "S"), msg("user", "Q")])).toBe("Q");
  });

  it("flattens a conversation", () => {
    expect(promptFor([msg("system", "S"), msg("user", "Hi"), msg("assistant", "Hello"), msg("user", "How?")])).toBe(
      "User: Hi\n\nAssistant: Hello\n\nUser: How?\n\nReply to the last User message as the Assistant.",
    );
  });

  it("keeps only the closing line for system-only input", () => {
    expect(promptFor([msg("system", "S")])).toBe("\n\nReply to the last User message as the Assistant.");
  });

  it("joins system messages", () => {
    expect(systemPromptOf([msg("system", "A"), msg("user", "x"), msg("system", "B")])).toBe("A\n\nB");
    expect(systemPromptOf([msg("user", "x")])).toBe("");
  });
});

describe("readLines", () => {
  it("joins lines across chunks", async () => {
    expect(await lines(["a\nb", "c\n", "d"].map((s) => enc.encode(s)))).toEqual(["a", "bc", "d"]);
  });

  it("delivers the final empty buffer", async () => {
    expect(await lines([enc.encode("x\n")])).toEqual(["x", ""]);
  });

  it("decodes a character split across chunks", async () => {
    expect(await lines([new Uint8Array([0xc3]), new Uint8Array([0xa9, 0x0a])])).toEqual(["é", ""]);
  });

  it("delivers one empty line for an empty stream", async () => {
    expect(await lines([])).toEqual([""]);
  });
});

describe("parseJsonLine / stderrTail", () => {
  it("parses only valid JSON", () => {
    expect(parseJsonLine("")).toBeNull();
    expect(parseJsonLine("   ")).toBeNull();
    expect(parseJsonLine("{bad")).toBeNull();
    expect(parseJsonLine("warning: x")).toBeNull();
    expect(parseJsonLine<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLine<number>("42")).toBe(42);
  });

  it("keeps the last lines of stderr", () => {
    expect(stderrTail("a\nb\nc\nd\n")).toBe("b c d");
    expect(stderrTail("a\nb\nc\nd\n", 1)).toBe("d");
    expect(stderrTail("")).toBe("");
    expect(stderrTail("  only  ")).toBe("only");
  });
});

describe("findCliBinary", () => {
  it("returns null for a missing binary", () => {
    expect(findCliBinary("portfolio-no-such-cli-xyz-123")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("cliWorkDir / runCli", () => {
  it("tightens an existing work dir to 0700", () => {
    const dir = join(DATA_DIR, "cli-workdir-test");
    cleanup.push(dir);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    const path = cliWorkDir("cli-workdir-test");
    expect(path).toBe(dir);
    expect(statSync(path).mode & 0o777).toBe(0o700);
  });

  it("creates a fresh work dir with 0700", () => {
    const name = `cli-workdir-fresh-${process.pid}`;
    const path = cliWorkDir(name);
    cleanup.push(path);
    expect(statSync(path).isDirectory()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o700);
  });

  it("returns the exit code and both outputs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-cli-"));
    cleanup.push(dir);
    const bin = join(dir, "fake");
    writeFileSync(bin, `#!${process.execPath}\nconsole.log("out");\nconsole.error("err");\nprocess.exit(4);\n`);
    chmodSync(bin, 0o755);
    expect(await runCli(bin, [], dir)).toEqual({ code: 4, stdout: "out\n", stderr: "err\n", timedOut: false });
  });
});
