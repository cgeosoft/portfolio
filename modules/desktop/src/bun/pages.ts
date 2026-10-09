/**
 * Static pages shown in the window while the service is not reachable.
 *
 * They copy the GUI's own loading screen (brand tile, radial-gradient glows, pill status) so the
 * hand-off from "service starting" to the GUI is seamless. The texts and colours come from
 * `app.ts`. Glows are gradients, not blur filters, and the only animated elements are small
 * boxes: the window renders in software WebKitGTK on Linux. The line under the "Starting up"
 * pill follows the start-up steps: `startingHintScript` replaces it in place, without a reload.
 * The starting page opens with the vendor intro of `pages.intro`: a white square wordmark whose
 * rows slide in from the left and the right, snap together in the centre and send out ripples,
 * then fade out before the brand rises.
 */
import { APP } from "./app";

const { pages } = APP;
const t = pages.theme;

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

const intro = pages.intro;
const introSeconds = intro.durationMs / 1000;

const introHtml = () => {
  const [top = "", bottom = ""] = intro.rows;
  const ripples = t.ripples.map((c, i) => `<span class="intro-ripple" style="--i:${i};border-color:${c}"></span>`).join("");
  return `<div class="intro" aria-hidden="true">
<div class="intro-mark">${ripples}<span class="intro-flash"></span>
<span class="intro-row from-left">${escape(top)}</span>
<span class="intro-row from-right">${escape(bottom)}</span>
</div>
<p class="intro-caption">${escape(intro.caption)}</p>
</div>`;
};

/** The rows meet at this second; the snap, flash and ripples start here. */
const SNAP = 0.7;

const introCss = () => `
  .intro { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;
           animation: intro-out 0.5s cubic-bezier(0.7, 0, 0.84, 0) ${(introSeconds - 0.55).toFixed(2)}s both; }
  @keyframes intro-out { to { opacity: 0; transform: scale(1.06); } }
  .intro-mark { position: relative; display: flex; flex-direction: column; align-items: center;
                font: 800 56px/1.2 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff;
                animation: intro-snap 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.3) ${SNAP}s both; }
  @keyframes intro-snap { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.12); } }
  .intro-row { position: relative; display: block; text-shadow: 0 0 28px ${t.accentSoft}; }
  .intro-row.from-left { animation: intro-in-left 0.75s linear 0.1s both; }
  .intro-row.from-right { animation: intro-in-right 0.75s linear 0.1s both; }
  @keyframes intro-in-left {
    0% { opacity: 0; transform: translateX(-70vw) skewX(-16deg); animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.4); }
    20% { opacity: 1; }
    80% { transform: translateX(10px) skewX(-16deg); animation-timing-function: ease-out; }
    90% { transform: translateX(-4px) skewX(6deg); }
    100% { transform: none; } }
  @keyframes intro-in-right {
    0% { opacity: 0; transform: translateX(70vw) skewX(16deg); animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.4); }
    20% { opacity: 1; }
    80% { transform: translateX(-10px) skewX(16deg); animation-timing-function: ease-out; }
    90% { transform: translateX(4px) skewX(-6deg); }
    100% { transform: none; } }
  .intro-flash { position: absolute; left: 50%; top: 50%; width: 220px; height: 220px; margin: -110px 0 0 -110px; border-radius: 50%;
                 background: radial-gradient(circle, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 65%);
                 animation: intro-flash 0.5s ease-out ${SNAP}s both; }
  @keyframes intro-flash { 0% { opacity: 0; transform: scale(0.4); } 20% { opacity: 1; } 100% { opacity: 0; transform: scale(1.5); } }
  .intro-ripple { position: absolute; left: 50%; top: 50%; width: 160px; height: 160px; margin: -80px 0 0 -80px; border-radius: 50%; border: 2px solid;
                  animation: intro-ripple 1.2s cubic-bezier(0.2, 0.7, 0.3, 1) calc(${SNAP}s + var(--i) * 0.13s) both; }
  @keyframes intro-ripple { 0% { opacity: 0; transform: scale(0.8); } 8% { opacity: 0.9; } 100% { opacity: 0; transform: scale(3.4); } }
  .intro-caption { margin: 26px 0 0; padding-left: 0.5em; font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.5em;
                   text-transform: uppercase; color: ${t.muted}; animation: intro-fade 0.6s ease-out ${SNAP + 0.4}s both; }
  @keyframes intro-fade { from { opacity: 0; transform: translateY(6px); } }
  main { animation-delay: ${(introSeconds - 0.3).toFixed(2)}s; }
  @media (prefers-reduced-motion: reduce) { .intro { display: none; } main { animation-delay: 0s; } }`;

const shell = (body: string, glow: string, withIntro = false) => `<!doctype html>
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
        max-height: 36vh; overflow: auto; white-space: pre-wrap; color: ${t.muted}; }${withIntro ? introCss() : ""}
</style></head><body>${withIntro ? introHtml() : ""}<main>${body}</main></body></html>`;

const brand = (tagline: string, error = false) => `<div class="tile"><div>${pages.icon}</div></div>
<h1>${escape(pages.heading)}</h1>
<p class="tagline${error ? " error" : ""}">${escape(tagline)}</p>`;

/** The id of the line under the "Starting up" pill; `startingHintScript` replaces its text. */
const HINT_ID = "starting-hint";

/** The page of the start-up, with `hint` (a text of `pages.starting`) under the pill. */
export function startingPage(hint: string): string {
  return shell(
    `${brand(pages.tagline)}
<div class="pill"><span class="spin"></span><span>Starting up</span></div>
<p class="hint" id="${HINT_ID}">${escape(hint)}</p>`,
    t.glow,
    true,
  );
}

/**
 * A script for `webview.executeJavascript` that replaces the line under "Starting up" with
 * `hint`, so the page follows the start-up without a reload. A no-op on any other page.
 */
export function startingHintScript(hint: string): string {
  return `(function () { var el = document.getElementById(${JSON.stringify(HINT_ID)}); if (el) el.textContent = ${JSON.stringify(hint)}; })();`;
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
