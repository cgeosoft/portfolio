import { beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDirForTests } from "./paths";

// Preloaded by bunfig.toml before any test module: point the service at a
// fresh data directory so `loadConfig()` and the database never touch the
// user's real files.
setDataDirForTests(mkdtempSync(join(tmpdir(), "portfolio-test-")));

// Every test starts without recorded portfolio amounts, so the privacy gate
// never removes a number because of another test's portfolio. Imported after
// the data directory is set.
const { forgetPrivateValues } = await import("./services/llm-privacy");
beforeEach(() => forgetPrivateValues());
