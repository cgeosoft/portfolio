/**
 * Sends uncaught GUI errors to the service. The service writes them to the
 * local log and applies the allowlist. The error message never leaves the GUI.
 */
import { api } from "./api";

const MAX_PER_PAGE_LOAD = 20;
const sent = new Set<string>();

export function reportClientError(error: unknown, source: "boundary" | "window"): void {
  if (!(error instanceof Error) || !error.stack) return;
  const key = `${error.name}|${error.stack}`;
  if (sent.has(key) || sent.size >= MAX_PER_PAGE_LOAD) return;
  sent.add(key);
  api.reportClientError({ name: error.name, stack: error.stack.replaceAll(error.message, ""), source }).catch(() => {});
}

export function installErrorReporting(): void {
  window.addEventListener("error", (event) => reportClientError(event.error, "window"));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, "window"));
}
