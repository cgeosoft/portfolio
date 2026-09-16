/**
 * Static pages shown in the window while the service is not reachable.
 *
 * They copy the GUI's own loading and lock screens (brand tile, radial-gradient
 * glows, pill status) so the hand-off from "service starting" to "GUI loading"
 * is seamless. Glows are gradients, not blur filters, and the only animated
 * elements are small boxes: the window renders in software WebKitGTK on Linux.
 */

const APP_NAME = "Portfolio";

/** Brand mark from modules/gui/src/components/common/AppIcon.tsx: the trending-up line. */
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M22 7 13.5 15.5 8.5 10.5 2 17"/>
  <path d="M16 7h6v6"/>
</svg>`;

const shell = (body: string, glow: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #07090e; color: #e2e8f0; overflow: hidden; -webkit-user-select: none; user-select: none;
    font: 14px/1.5 "Plus Jakarta Sans", Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center;
    background-image: radial-gradient(circle 420px at 50% 25%, rgba(${glow}), transparent 70%),
                      radial-gradient(circle 340px at 25% 75%, rgba(147, 51, 234, 0.12), transparent 70%),
                      radial-gradient(circle 300px at 85% 85%, rgba(6, 182, 212, 0.08), transparent 70%);
  }
  main { display: flex; flex-direction: column; align-items: center; width: min(100%, 640px); padding: 24px; animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }

  .tile { width: 56px; height: 56px; padding: 1px; border-radius: 16px; box-shadow: 0 20px 40px -12px rgba(221, 60, 115, 0.35);
          background: linear-gradient(to top right, #DD3C73, #a855f7, #22d3ee); }
  .tile div { width: 100%; height: 100%; border-radius: 15px; background: #020617; display: flex; align-items: center; justify-content: center; }
  .tile svg { width: 28px; height: 28px; color: #e65f8e; animation: breathe 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  @keyframes breathe { 50% { opacity: 0.45; } }

  h1 { margin: 14px 0 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2;
       background: linear-gradient(to right, #fff, #e2e8f0, #f5abc5); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tagline { margin: 4px 0 0; font: 500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e65f8e; }
  .tagline.error { color: #fb7185; }

  .pill { display: flex; align-items: center; gap: 8px; margin-top: 28px; padding: 8px 16px; border-radius: 999px; font-size: 12px; font-weight: 500; color: #94a3b8;
          background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(30, 41, 59, 0.8); box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.6); }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(230, 95, 142, 0.25); border-top-color: #e65f8e; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hint { margin: 14px 0 0; font-size: 12px; color: #475569; }

  .card { width: 100%; margin-top: 24px; padding: 20px; border-radius: 20px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(30, 41, 59, 0.9);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: left; }
  .card p { margin: 0 0 10px; color: #94a3b8; font-size: 13px; }
  code { color: #bae6fd; background: rgba(2, 6, 23, 0.7); padding: 2px 6px; border-radius: 6px; font-size: 12px; word-break: break-all; }
  pre { margin: 0; background: rgba(2, 6, 23, 0.7); border: 1px solid rgba(30, 41, 59, 0.9); border-radius: 12px; padding: 12px; font-size: 11px; line-height: 1.5;
        max-height: 36vh; overflow: auto; white-space: pre-wrap; color: #94a3b8; }
</style></head><body><main>${body}</main></body></html>`;

const brand = (tagline: string, error = false) => `<div class="tile"><div>${ICON}</div></div>
<h1>${APP_NAME}</h1>
<p class="tagline${error ? " error" : ""}">${tagline}</p>`;

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

export function startingPage(): string {
  return shell(
    `${brand("Personal investment tracker")}
<div class="pill"><span class="spin"></span><span>Starting up…</span></div>
<p class="hint">Opening the local database. This takes a few seconds.</p>`,
    "79, 70, 229, 0.22",
  );
}

export function failedPage(logPath: string, logTail: string): string {
  return shell(
    `${brand("Could not start", true)}
<div class="card error">
<p>The service exited before it became reachable. The full log is at <code>${escape(logPath)}</code>.</p>
<pre>${escape(logTail) || "(no output)"}</pre>
</div>`,
    "239, 68, 68, 0.16",
  );
}
