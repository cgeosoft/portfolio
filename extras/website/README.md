# Portfolio Marketing Website

Static landing page for Portfolio, deployed to Cloudflare Pages. Plain HTML, CSS and three scripts; no build step (the metrics catalog page and the tour screenshots are generated, see below).

The site uses vanilla HTML, `style.css`, `script.js`, `graph.js` and `tour.js`. `style.css` copies the app's tokens (canvas, cards, radius, mono labels) from `modules/gui/src/index.css`. `index.html` leads with Guided Analysis: a hero over the live evidence graph, a walkthrough of the six stages, the path behind a suggestion, the guardrails and the workflow around them. Then the screenshot tour, privacy, a feature ledger, downloads and FAQ. The hero download button follows the detected OS and shows the version and size of the latest installer.

## Pages

- `index.html` - hero with OS-detected download button, Guided Analysis, the screenshot tour, privacy, features, download matrix, FAQ.
- `tour/index.html` - the screenshot tour on its own page, sized to fit the window. `#<screen id>` opens a screen.
- `terms/index.html` - Terms of Use, including the "Analytics and Cookies" section (`#cookie-policy`).
- `privacy/index.html` - Privacy Notice: what the app and the site send, who receives it, retention and rights. Raise `PRIVACY_NOTICE_VERSION` in `modules/shared/src/brand.ts` when the data, the purpose or the recipient changes.
- `metrics/index.html` - the Metrics Marketplace catalog. **Generated** by `bun run website:metrics` from `extras/metrics/repository.yml` and each `manifest.yml`; it copies the `<head>`, header and footer of `terms/index.html`. Do not edit by hand; `deploy.sh` regenerates it.
- `assets/fonts/` - self-hosted fonts (Latin subset) with their OFL licenses. `style.css` loads them. The site makes no request to Google Fonts.
- `assets/` - `app-icon.svg`, `app-icon.png`, `icon-512.png`, `screenshot.png` (1600x900, an open analysis with the demo portfolio; README and og:image), `tour/` (generated, see Screenshots).

## Local preview

```bash
cd extras/website
bun run dev            # bunx serve .
# or: python3 -m http.server 3000
```

## Analytics

PostHog loads only after the visitor accepts. Before that, the page makes no request to it. The `posthog.init` options in `script.js` turn off autocapture, dead clicks, heatmaps, exception capture, session recording and surveys, so the site sends only page views and its named events. `script.js` shows a cookie banner on the first visit and adds the PostHog script after "Accept"; the choice is stored in `localStorage` (`portfolio_cookie_consent_v1`). Tracked events: `$pageview`, `download_clicked` (os, type) and `screenshot_zoomed`. Each page carries `<meta name="posthog-key">` with the placeholder `YOUR_POSTHOG_PROJECT_API_KEY`; `deploy.sh` replaces it with `POSTHOG_API_KEY` from the environment or the repo `.env`. Without a real key, the banner does not show and PostHog does not load.

## Download links

`script.js` reads the latest release from the GitHub Releases API, falls back to `/releases/latest.json` (written by `scripts/release.sh publish`), caches it 2 minutes in `localStorage`, and matches assets by name:

```
portfolio_<version>_x64_setup.exe        portfolio_<version>_windows-x64_portable.zip
portfolio_<version>_universal.dmg        portfolio_<version>_macos-universal.zip
portfolio_<version>_amd64.deb            portfolio_<version>_linux-x64.tar.gz
```

Until the manifest is read (or when it fails) every link points at the downloads section. If `scripts/release.sh` renames the artifacts, update the `ASSETS` map.

## Evidence graph

`graph.js` draws a real Guided Analysis of the demo portfolio on a canvas, with no library. It reads `assets/tour/run.json`, which `scripts/screenshots/run-data.ts` writes: nodes with the positions of the app's own `radialLayout`, edges, stages, suggestions with their paths, and the short report. The file holds titles, summaries and links only, no `facts` and no `local` values. It mounts three views: `[data-graph-hero]`, `[data-run]` (a stepper that plays once when it comes into view, then waits for clicks) and `[data-why]`. A view draws only while it is on screen. Reduced motion shows the finished graph with no autoplay. Without the JSON the walkthrough falls back to `assets/tour/graph.webp`.

## Screenshots and tour

`tour.js` mounts on every `[data-tour]` element and reads `assets/tour/tour.json`. Tabs switch between screens. Each screen has numbered markers; a click spotlights the region and opens a popover with a sharp close-up and a short text. A second click, a click on the screenshot or Escape closes it; arrow keys step through the markers. On narrow screens the popover sits under the screenshot. Without the JSON the `.tour-fallback` image stays.

The images and the JSON are generated from the running app:

```bash
bun run website:screenshots --llm claude-cli      # fresh demo data, a brief, two Guided Analysis runs and a daily brief
bun run website:screenshots --data <dir>          # reuse a data directory (keeps earlier LLM content)
bun run website:screenshots --only graph --debug /tmp/shots
```

`scripts/screenshots/capture.ts` starts the service on a scratch data directory (never the real one), seeds the demo portfolio, opens the GUI in headless Chromium at 1600x900 (2x) and writes `assets/tour/<screen>.webp`, one close-up per hotspot, `tour.json`, `run.json` and `assets/screenshot.png`. The screens, hotspot targets and texts live in `scripts/screenshots/shots.ts`; targets are found by text in the page, so markers follow layout changes. `--debug <dir>` writes each screen with its crop boxes drawn on it. It needs Playwright's Chromium (`bunx playwright-core install chromium`) or Google Chrome.

## Deploy

```bash
./deploy.sh                       # wrangler pages deploy to project "portfolio-desktop"
./deploy.sh --project-name=<name> --branch=<branch>
```

Reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_PAGES_BRANCH` and `POSTHOG_API_KEY` from the repo `.env` or `extras/website/.env`. Without a token Wrangler falls back to its own login. The script regenerates `metrics/index.html`, then stages a copy without `deploy.sh`, `README.md`, `package.json` and `.env`.
