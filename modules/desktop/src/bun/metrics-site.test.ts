/** The committed metrics page on the website matches the metric manifests. */
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const scriptPath = join(import.meta.dir, "../../../../scripts/build-metrics-site.ts");

describe("build-metrics-site --check", () => {
  it("passes against the committed page", () => {
    const r = Bun.spawnSync([process.execPath, scriptPath, "--check"], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("checked extras/website/metrics/index.html");
  }, 30_000);
});
