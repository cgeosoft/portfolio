/**
 * Runs the service on a scratch data directory for `capture.ts`, so the
 * screenshots never read or write the user's own database.
 *
 *   bun scripts/screenshots/service.ts <dataDir>
 */
import { setDataDirForTests } from "../../modules/service/src/paths";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: service.ts <dataDir>");
  process.exit(2);
}
setDataDirForTests(dir);
await import("../../modules/service/src/main");
