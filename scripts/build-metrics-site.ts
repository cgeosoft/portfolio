/**
 * Render the public metrics catalog page (extras/website/metrics/index.html)
 * from extras/metrics/repository.yml and each manifest.yml.
 *
 * The page reuses the shared website stylesheet and copies the <head>, header
 * and footer of extras/website/terms/index.html verbatim, so one pull request
 * that adds a metric updates the application and the site together. Icons
 * are inlined from the lucide-react package the application already ships.
 *
 * Usage: bun run scripts/build-metrics-site.ts [--check]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { METRIC_SCOPE_DESCRIPTIONS } from "../modules/shared/src/metric-abi.ts";
import { validateMetricManifest, type MetricManifest } from "../modules/shared/src/metric-manifest.ts";

const ROOT = resolve(import.meta.dir, "..");
const METRICS_DIR = join(ROOT, "extras", "metrics");
const SITE_DIR = join(ROOT, "extras", "website");
const TEMPLATE_PATH = join(SITE_DIR, "terms", "index.html");
const OUT_PATH = join(SITE_DIR, "metrics", "index.html");
const REPO_URL = "https://github.com/cgeosoft/portfolio";
const checkOnly = process.argv.includes("--check");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slice(source: string, start: string, end: string, what: string): string {
  const from = source.indexOf(start);
  const to = from < 0 ? -1 : source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`could not find the ${what} in ${relative(ROOT, TEMPLATE_PATH)}`);
  return source.slice(from, to + end.length);
}

/** Inline SVG of a lucide icon, read from the icon data lucide-react ships (a GUI dependency). */
function lucideSvg(name: string, size = 24): string {
  const path = join(ROOT, "modules", "gui", "node_modules", "lucide-react", "dist", "esm", "icons", `${name}.mjs`);
  let nodes: [string, Record<string, string>][] = [];
  if (existsSync(path)) {
    // lucide-react >= 1.46 exports `__iconData = { node: [...] }`; older builds `__iconNode = [...]`.
    const match = /(?:node: |const __iconNode = )(\[[\s\S]*?\n {0,2}\]);?\n/.exec(readFileSync(path, "utf8"));
    if (match) nodes = new Function(`return ${match[1]}`)() as [string, Record<string, string>][];
  }
  if (nodes.length === 0) {
    if (name === "gauge") throw new Error(`lucide icon data not found at ${relative(ROOT, path)}; run bun install`);
    return lucideSvg("gauge", size);
  }
  const inner = nodes
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
        .join(" ");
      return `<${tag} ${attributes}></${tag}>`;
    })
    .join("");
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function readManifests(): { manifest: MetricManifest; bundled: boolean }[] {
  const repo = Bun.YAML.parse(readFileSync(join(METRICS_DIR, "repository.yml"), "utf8")) as { metrics: { id: string; path?: string; bundled?: boolean }[] };
  return repo.metrics.map((entry) => {
    const path = join(METRICS_DIR, entry.path || entry.id, "manifest.yml");
    const manifest = validateMetricManifest(Bun.YAML.parse(readFileSync(path, "utf8")));
    if (manifest.id !== entry.id) throw new Error(`${relative(ROOT, path)}: id does not match repository entry ${entry.id}`);
    return { manifest, bundled: entry.bundled !== false };
  });
}

function renderCard({ manifest, bundled }: { manifest: MetricManifest; bundled: boolean }): string {
  const scopes = manifest.scopes
    .map((scope) => {
      const meta = METRIC_SCOPE_DESCRIPTIONS[scope];
      return `<span class="tag" title="${escapeHtml(meta.grants)}">${escapeHtml(meta.label)}</span>`;
    })
    .join("\n              ");
  const developer = manifest.developer.url
    ? `<a href="${escapeHtml(manifest.developer.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(manifest.developer.name)}</a>`
    : escapeHtml(manifest.developer.name);
  return `          <article class="feature-card metric-card" data-category="${escapeHtml(manifest.category)}">
            <div class="feature-icon">${lucideSvg(manifest.icon, 22)}</div>
            <h3 class="card-title">${escapeHtml(manifest.name)}</h3>
            <p class="card-meta">${escapeHtml(manifest.category)} &bull; v${escapeHtml(manifest.version)} &bull; ${escapeHtml(manifest.license)} &bull; by ${developer}</p>
            <p class="card-desc">${escapeHtml(manifest.description.trim())}</p>
            <p class="card-desc">${escapeHtml(manifest.importance.trim())}</p>
            <div class="tag-row">
              ${scopes}
            </div>
            <p class="card-footer">
              ${bundled ? '<span class="status-dot"></span><span>Bundled with the app</span>' : "<span>Repository</span>"}
              &bull; <a href="${REPO_URL}/tree/main/extras/metrics/${escapeHtml(manifest.id)}" target="_blank" rel="noopener noreferrer">Source</a>
            </p>
          </article>`;
}

function main(): void {
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const head = slice(template, "<head>", "</head>", "head")
    .replace(/<title>[\s\S]*?<\/title>/, "<title>Metrics Marketplace - Portfolio</title>")
    .replace(
      /<meta name="description" content="[^"]*">/,
      '<meta name="description" content="Catalog of sandboxed WebAssembly metric modules for Portfolio. Every metric declares the data it reads before you add it.">',
    );
  const header = slice(template, '<header class="site-header">', "</header>", "header");
  const footer = slice(template, '<footer class="site-footer">', "</footer>", "footer");
  if (!header.includes('href="/metrics/"')) throw new Error("terms/index.html navigation has no Metrics link");

  const entries = readManifests();
  const categories = [...new Set(entries.map((e) => e.manifest.category))];
  const scopeRows = Object.entries(METRIC_SCOPE_DESCRIPTIONS)
    .map(([scope, meta]) => `              <tr><td><code>${escapeHtml(scope)}</code></td><td>${escapeHtml(meta.grants)}</td><td>${escapeHtml(meta.consent)}</td></tr>`)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
${head}
<body>
  <!-- Generated by scripts/build-metrics-site.ts from extras/metrics/repository.yml. Do not edit by hand. -->
  <div class="ambient-glow" aria-hidden="true"></div>
  <div class="dot-grid" aria-hidden="true"></div>

  ${header}

  <main>
    <section class="hero-section">
      <div class="container hero-container">
        <div class="hero-pill">
          <span class="status-dot"></span>
          <span>METRICS MARKETPLACE &bull; SANDBOXED WEBASSEMBLY MODULES</span>
        </div>
        <h1 class="hero-title">Metrics <span class="gradient-text">Marketplace</span></h1>
        <p class="hero-subtitle">Every metric is a small WebAssembly module with a manifest that declares the data it reads. It runs in a sandbox with no file, network or system access, against your portfolio only.</p>
        <ul class="hero-stats" aria-label="Highlights">
          <li><strong>${entries.length}</strong><span>metrics in the repository</span></li>
          <li><strong>0</strong><span>I/O imports allowed</span></li>
          <li><strong>4 MiB</strong><span>memory ceiling</span></li>
          <li><strong>MIT</strong><span>open source license</span></li>
        </ul>
      </div>
    </section>

    <section class="features-section" id="catalog">
      <div class="container">
        <div class="section-heading">
          <span class="section-kicker">Catalog</span>
          <h2 class="section-title">Reviewed metrics</h2>
          <p class="section-lead">Bundled with the application and reviewed by pull request. Add any of them to a portfolio from the Metrics tab.</p>
        </div>

        <div class="chip-row metric-filters" role="group" aria-label="Filter by category">
          <button type="button" class="chip-btn active" data-category="">All</button>
${categories.map((c) => `          <button type="button" class="chip-btn" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("\n")}
        </div>

        <div class="features-grid" id="metric-grid">
${entries.map(renderCard).join("\n")}
        </div>
      </div>
    </section>

    <section class="how-section" id="scopes">
      <div class="container">
        <div class="section-heading">
          <span class="section-kicker">Data scopes</span>
          <h2 class="section-title">What a metric can see</h2>
          <p class="section-lead">A module receives only the scopes its manifest requests. The application spells them out before a metric is added, and a module installed from a URL stays marked unverified.</p>
        </div>
        <div class="panel">
          <table class="data-table">
            <thead><tr><th>Scope</th><th>Grants</th><th>Shown to the user as</th></tr></thead>
            <tbody>
${scopeRows}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="downloads-section" id="contribute">
      <div class="container">
        <div class="section-heading">
          <span class="section-kicker">Contribute</span>
          <h2 class="section-title">Write your own</h2>
          <p class="section-lead">A metric is a few lines of AssemblyScript. Copy the template, describe it in a manifest, open a pull request, and it ships with the next release.</p>
        </div>
        <div class="panel">
          <pre class="code-block"><code>import { Summary, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalFees, Format.Currency)
    .text("Lifetime transaction costs")
    .neutral()
    .finish();
}</code></pre>
          <p class="card-desc">
            Read the contributor guide at
            <a href="${REPO_URL}/tree/main/extras/metrics" target="_blank" rel="noopener noreferrer">extras/metrics/README.md</a>.
            Modules built outside the repository can be installed from any URL; the application checks the size and SHA-256, rejects forbidden imports, and shows the requested scopes first.
          </p>
        </div>
      </div>
    </section>
  </main>

  ${footer}

  <script src="/script.js" defer></script>
  <script>
    (function () {
      var buttons = document.querySelectorAll('.metric-filters .chip-btn');
      var cards = document.querySelectorAll('#metric-grid .metric-card');
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var category = btn.getAttribute('data-category') || '';
          buttons.forEach(function (b) { b.classList.toggle('active', b === btn); });
          cards.forEach(function (card) {
            card.style.display = !category || card.getAttribute('data-category') === category ? '' : 'none';
          });
        });
      });
    })();
  </script>
</body>
</html>
`;

  if (checkOnly) {
    const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
    if (current !== html) throw new Error(`${relative(ROOT, OUT_PATH)} is stale; run bun run website:metrics and commit it`);
    console.log(`checked ${relative(ROOT, OUT_PATH)}`);
    return;
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, html);
  console.log(`wrote ${relative(ROOT, OUT_PATH)} (${entries.length} metrics, ${categories.length} categories)`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
