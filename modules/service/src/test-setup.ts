import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Preloaded by bunfig.toml before any test module: point the service at a
// fresh data directory so `loadConfig()` and the database never touch the
// user's real files.
process.env.PORTFOLIO_DATA_DIR = mkdtempSync(join(tmpdir(), "portfolio-test-"));
process.env.NODE_ENV = "test";
