/**
 * Render the public metrics catalog page (extras/website/metrics/index.html)
 * from extras/metrics/repository.yml and each manifest.yml.
 *
 * The page reuses the website design system and copies the <head>, header,
 * and footer of extras/website/terms/index.html verbatim, so one pull request
 * that adds a metric updates the application and the site together. Icons
 * are inlined from the lucide-react package the application already ships.
 *
 * Usage: bun run scripts/build-metrics-site.ts [--check]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { METRIC_SCOPE_DESCRIPTIONS } from "../src/shared/metric-abi.ts";
import { validateMetricManifest, type MetricManifest } from "../src/shared/metric-manifest.ts";

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

/** Inline SVG of a lucide icon, read from the icon data lucide-react ships. */
function lucideSvg(name: string, size = 24): string {
  const path = join(ROOT, "node_modules", "lucide-react", "dist", "esm", "icons", `${name}.mjs`);
  let nodes: [string, Record<string, string>][] = [];
  if (existsSync(path)) {
    const match = /const __iconNode = (\[[\s\S]*?\]);\n/.exec(readFileSync(path, "utf8"));
    if (match) nodes = new Function(`return ${match[1]}`)() as [string, Record<string, string>][];
  }
  if (nodes.length === 0) return lucideSvg("gauge", size);
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
      return `<span class="legal-badge" title="${escapeHtml(meta.grants)}"><span>${escapeHtml(meta.label)}</span></span>`;
    })
    .join("\n              ");
  const developer = manifest.developer.url
    ? `<a href="${escapeHtml(manifest.developer.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(manifest.developer.name)}</a>`
    : escapeHtml(manifest.developer.name);
  return `          <article class="feature-card metric-card" data-category="${escapeHtml(manifest.category)}">
            <div class="card-icon-wrap">${lucideSvg(manifest.icon)}</div>
            <h3 class="card-title">${escapeHtml(manifest.name)}</h3>
            <p class="metric-meta">${escapeHtml(manifest.category)} &bull; v${escapeHtml(manifest.version)} &bull; ${escapeHtml(manifest.license)} &bull; by ${developer}</p>
            <p class="card-desc">${escapeHtml(manifest.description.trim())}</p>
            <p class="card-desc metric-importance">${escapeHtml(manifest.importance.trim())}</p>
            <div class="legal-badge-strip metric-scopes">
              ${scopes}
            </div>
            <p class="metric-footer">
              ${bundled ? '<span class="status-dot"></span><span>BUNDLED WITH THE APP</span>' : "<span>REPOSITORY</span>"}
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
      '<meta name="description" content="Catalog of sandboxed WebAssembly metric modules for Portfolio Desktop. Every metric declares the data it reads before you add it.">',
    );
  const header = slice(template, "<!-- Header / Navigation -->", "</header>", "header");
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
  <!-- Ambient background glow and grid -->
  <div class="ambient-glow" aria-hidden="true"></div>
  <div class="cyber-grid" aria-hidden="true"></div>

  ${header}

  <main>
    <section class="legal-hero">
      <div class="container">
        <div class="hero-pill-badge">
          <span class="status-dot"></span>
          <span class="pill-text">METRICS MARKETPLACE : SANDBOXED WEBASSEMBLY MODULES</span>
        </div>

        <h1 class="hero-title" style="margin-block: 1rem 0.5rem;">
          Metrics <span class="gradient-text">Marketplace</span>
        </h1>
        <p class="hero-subtitle" style="margin-bottom: 0;">
          Every metric is a small WebAssembly module with a manifest that declares the data it reads. It runs in a sandbox with no file, network, or system access, against your portfolio only.
        </p>

        <div class="legal-badge-strip">
          <div class="legal-badge"><span class="status-dot"></span><span>${entries.length} METRICS IN THE REPOSITORY</span></div>
          <div class="legal-badge"><span>NO I/O IMPORTS</span></div>
          <div class="legal-badge"><span>4 MiB MEMORY CEILING</span></div>
          <div class="legal-badge"><span>MIT OPEN SOURCE LICENSE</span></div>
        </div>
      </div>
    </section>

    <section class="features-section" id="catalog">
      <div class="container">
        <div class="section-header" style="text-align: center;">
          <span class="section-pill">// CATALOG</span>
          <h2 class="section-title">Reviewed metrics</h2>
          <p class="section-subtitle">Bundled with the application and reviewed by pull request. Add any of them to a portfolio from the Metrics tab.</p>
        </div>

        <div class="chart-timeframe metric-filters" role="group" aria-label="Filter by category">
          <button type="button" class="tf-btn active" data-category="">All</button>
${categories.map((c) => `          <button type="button" class="tf-btn" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("\n")}
        </div>

        <div class="features-grid" id="metric-grid">
${entries.map(renderCard).join("\n")}
        </div>
      </div>
    </section>

    <section class="features-section" id="scopes">
      <div class="container">
        <div class="section-header" style="text-align: center;">
          <span class="section-pill">// DATA SCOPES</span>
          <h2 class="section-title">What a metric can see</h2>
          <p class="section-subtitle">A module receives only the scopes its manifest requests. The application spells them out before a metric is added, and a module installed from a URL stays marked unverified.</p>
        </div>
        <div class="legal-content-card">
          <table class="metric-scope-table">
            <thead><tr><th>Scope</th><th>Grants</th><th>Shown to the user as</th></tr></thead>
            <tbody>
${scopeRows}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="features-section" id="contribute">
      <div class="container">
        <div class="section-header" style="text-align: center;">
          <span class="section-pill">// CONTRIBUTE</span>
          <h2 class="section-title">Write your own</h2>
          <p class="section-subtitle">A metric is a few lines of AssemblyScript. Copy the template, describe it in a manifest, open a pull request, and it ships with the next release.</p>
        </div>
        <div class="legal-content-card">
          <pre class="metric-code"><code>import { Summary, Result, Format } from "../../_sdk/portfolio";
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

  <script src="/script.js"></script>
  <script>
    (function () {
      var buttons = document.querySelectorAll('.metric-filters .tf-btn');
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
    if (current !== html) throw new Error(`${relative(ROOT, OUT_PATH)} is stale; run bun run build:metrics-site and commit it`);
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
