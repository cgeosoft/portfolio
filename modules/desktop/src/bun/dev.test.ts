import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DevGuiServer } from "./dev";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-dev-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A checkout whose `modules/gui/scripts/dev-server.ts` runs `script`. */
function fakeGui(script: string): DevGuiServer {
  const root = tempDir();
  const scripts = join(root, "modules", "gui", "scripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "dev-server.ts"), script);
  return new DevGuiServer(root, tempDir());
}

describe("DevGuiServer", () => {
  it("returns only the last line from tail(1)", async () => {
    // One write of three lines arrives as one chunk; tail counts lines, not chunks.
    const gui = fakeGui('process.stdout.write("one\\ntwo\\nthree\\n");');
    gui.start(1);
    expect(await gui.waitForUrl(5000)).toBeNull();
    await Bun.sleep(50);
    expect(gui.tail(1).split("\n").filter(Boolean)).toEqual(["three"]);
  }, 10_000);

  it("joins a line split across writes and keeps an unfinished last line", async () => {
    const gui = fakeGui('process.stdout.write("al"); await Bun.sleep(30); process.stdout.write("pha\\nbeta");');
    gui.start(1);
    expect(await gui.waitForUrl(5000)).toBeNull();
    await Bun.sleep(50);
    expect(gui.tail(2)).toBe("alpha\nbeta\n");
  }, 10_000);
});
