/**
 * Baked-in build-time configuration for the webview.
 *
 * Electrobun substitutes the literal `process.env.NAME` expressions below with
 * string constants at build time (see electrobun.config.ts), so no `process`
 * object needs to survive into the webview bundle. A dynamic `process.env[name]`
 * lookup would not be substituted at all.
 *
 * These are only the starting values; App.tsx replaces them with the authoritative
 * ones the bun process reports over RPC as soon as getAppInfo resolves.
 */

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

let bakedWebpageUrl = "";
let bakedWebpageEmail = "";
try {
  bakedWebpageUrl = clean(process.env.WEBPAGE_URL);
  bakedWebpageEmail = clean(process.env.WEBPAGE_EMAIL);
} catch {
  // `process` does not exist in the webview when the values were not substituted.
}

/** Base URL for terms and the sponsor/marketing pages. */
export const WEBPAGE_URL = bakedWebpageUrl;

/** Developer contact address shown in the sponsorship dialog. */
export const WEBPAGE_EMAIL = bakedWebpageEmail;
