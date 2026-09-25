/**
 * Static pages shown in the window while the service is not reachable.
 *
 * They copy the GUI's own loading screen (brand tile, radial-gradient glows, pill status) so the
 * hand-off from "service starting" to the GUI is seamless. The texts and colours come from
 * `app.ts`. Glows are gradients, not blur filters, and the only animated elements are small
 * boxes: the window renders in software WebKitGTK on Linux.
 */
import { APP } from "./app";

const { pages } = APP;
const t = pages.theme;

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

const shell = (body: string, glow: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(pages.documentTitle)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: ${t.background}; color: ${t.text}; overflow: hidden; -webkit-user-select: none; user-select: none;
    font: 14px/1.5 ${t.font};
    display: flex; align-items: center; justify-content: center;
    background-image: ${[`radial-gradient(circle 420px at 50% 25%, rgba(${glow}), transparent 70%)`, ...t.extraGlows].join(",\n                      ")};
  }
  main { display: flex; flex-direction: column; align-items: center; width: min(100%, 640px); padding: 24px; animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }

  .tile { width: 56px; height: 56px; padding: ${t.tileFrameWidth}px; border-radius: 16px; box-shadow: 0 20px 40px -12px ${t.tileShadow}; background: ${t.tileFrame}; }
  .tile div { width: 100%; height: 100%; border-radius: ${16 - t.tileFrameWidth}px; background: ${t.tileFill}; display: flex; align-items: center; justify-content: center; }
  .tile svg { width: 28px; height: 28px; color: ${t.accent}; animation: breathe 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  @keyframes breathe { 50% { opacity: 0.45; } }

  h1 { margin: 14px 0 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2;
       background: ${t.heading}; -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tagline { margin: 4px 0 0; font: 500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: ${t.accent}; }
  .tagline.error { color: #fb7185; }

  .pill { display: flex; align-items: center; gap: 8px; margin-top: 28px; padding: 8px 16px; border-radius: 999px; font-size: 12px; font-weight: 500; color: ${t.muted};
          background: ${t.surface}; border: 1px solid ${t.surfaceBorder}; box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.6); }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid ${t.accentSoft}; border-top-color: ${t.accent}; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hint { margin: 14px 0 0; font-size: 12px; color: ${t.hint}; }

  .card { width: 100%; margin-top: 24px; padding: 20px; border-radius: 20px; background: ${t.card}; border: 1px solid ${t.cardBorder};
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: left; }
  .card p { margin: 0 0 10px; color: ${t.muted}; font-size: 13px; }
  code { color: #bae6fd; background: ${t.inset}; padding: 2px 6px; border-radius: 6px; font-size: 12px; word-break: break-all; }
  pre { margin: 0; background: ${t.inset}; border: 1px solid ${t.cardBorder}; border-radius: 12px; padding: 12px; font-size: 11px; line-height: 1.5;
        max-height: 36vh; overflow: auto; white-space: pre-wrap; color: ${t.muted}; }
</style></head><body><main>${body}</main></body></html>`;

const brand = (tagline: string, error = false) => `<div class="tile"><div>${pages.icon}</div></div>
<h1>${escape(pages.heading)}</h1>
<p class="tagline${error ? " error" : ""}">${escape(tagline)}</p>`;

export function startingPage(): string {
  return shell(
    `${brand(pages.tagline)}
<div class="pill"><span class="spin"></span><span>Starting up</span></div>
<p class="hint">${escape(pages.startingHint)}</p>`,
    t.glow,
  );
}

export function failedPage(logPath: string, logTail: string, dataDir: string, reason = "The service exited before it became reachable."): string {
  return shell(
    `${brand("Could not start", true)}
<div class="card error">
<p>${escape(reason)} The service log is at <code>${escape(logPath)}</code>.</p>
<p>The data directory is <code>${escape(dataDir)}</code>. ${escape(pages.failedHint)}</p>
<pre>${escape(logTail) || "(no output)"}</pre>
</div>`,
    "239, 68, 68, 0.16",
  );
}
