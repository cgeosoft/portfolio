/** Static pages shown in the window while the service is not reachable. */

const shell = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Portfolio</title>
<style>
  html, body { height: 100%; margin: 0; background: #090b10; color: #cbd5e1; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 18vh 24px 48px; }
  h1 { color: #fff; font-size: 20px; margin: 0 0 12px; }
  p { margin: 0 0 12px; }
  code { color: #bae6fd; background: #111827; padding: 2px 6px; border-radius: 6px; font-size: 12px; word-break: break-all; }
  pre { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; font-size: 11px; max-height: 40vh; overflow: auto; white-space: pre-wrap; color: #94a3b8; }
  .spin { width: 22px; height: 22px; border: 3px solid #1f2937; border-top-color: #818cf8; border-radius: 50%; animation: s 0.9s linear infinite; margin-bottom: 20px; }
  @keyframes s { to { transform: rotate(360deg); } }
  a { color: #a5b4fc; }
</style></head><body><main>${body}</main></body></html>`;

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

export function startingPage(): string {
  return shell(`<div class="spin"></div><h1>Starting Portfolio</h1>
<p>Opening the local database. This takes a few seconds.</p>`);
}

export function failedPage(logPath: string, logTail: string): string {
  return shell(`<h1>Portfolio could not start</h1>
<p>The service exited before it became reachable. The full log is at <code>${escape(logPath)}</code>.</p>
<pre>${escape(logTail) || "(no output)"}</pre>`);
}
