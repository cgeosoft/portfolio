# Portfolio Marketing Website

Static landing page for Portfolio, deployed to Cloudflare Pages. Plain HTML, CSS and two scripts; no build step (the metrics catalog page and the tour screenshots are generated, see below).

The site uses vanilla HTML, `style.css`, `script.js` and `tour.js`. `style.css` copies the app's tokens (canvas, cards, radius, mono labels) from `modules/gui/src/index.css`. `index.html` has a ticker tape, a hero with an animated demo (chart drawing in with a count-up, rotating assistant suggestions; made-up figures, off under reduced motion), the screenshot tour, what stays home and what leaves, a feature ledger, downloads and FAQ. The hero download button follows the detected OS and shows the version and size of the latest installer.

## Pages

- `index.html` - hero with OS-detected download button, the screenshot tour, features, how it works, download matrix, FAQ.
- `tour/index.html` - the screenshot tour on its own page, sized to fit the window. `#<screen id>` opens a screen.
- `terms/index.html` - Terms of Use, including the "Analytics and Cookies" section (`#cookie-policy`).
- `metrics/index.html` - the Metrics Marketplace catalog. **Generated** by `bun run website:metrics` from `extras/metrics/repository.yml` and each `manifest.yml`; it copies the `<head>`, header and footer of `terms/index.html`. Do not edit by hand; `deploy.sh` regenerates it.
- `sponsor/index.html` - self-contained sponsor page (dark theme) with its own inline styles.
- `sponsor/light/index.html` - self-contained sponsor page (light theme) for light mode.
- `assets/` - `app-icon.svg`, `app-icon.png`, `icon-512.png`, `screenshot.png` (1600x900, the overview tab with the demo portfolio; README and og:image), `tour/` (generated, see Screenshots).

## Local preview

```bash
cd extras/website
bun run dev            # bunx serve .
# or: python3 -m http.server 3000
```

## Analytics

PostHog is loaded with capturing opted out. `script.js` shows a cookie banner on the first visit and only calls `opt_in_capturing()` after "Accept"; the choice is stored in `localStorage` (`portfolio_cookie_consent_v1`). Tracked events: `$pageview`, `download_clicked` (os, type) and `screenshot_zoomed`. The HTML carries the placeholder `YOUR_POSTHOG_PROJECT_API_KEY`; `deploy.sh` replaces it with `POSTHOG_API_KEY` from the environment or the repo `.env`.

## Download links

`script.js` reads the latest release from the GitHub Releases API, falls back to `/releases/latest.json` (written by `scripts/release.sh publish`), caches it 2 minutes in `localStorage`, and matches assets by name:

```
portfolio_<version>_x64_setup.exe        portfolio_<version>_windows-x64_portable.zip
portfolio_<version>_universal.dmg        portfolio_<version>_macos-universal.zip
portfolio_<version>_amd64.deb            portfolio_<version>_linux-x64.tar.gz
```

Until the manifest is read (or when it fails) every link points at the downloads section. If `scripts/release.sh` renames the artifacts, update the `ASSETS` map.

## Screenshots and tour

`tour.js` mounts on every `[data-tour]` element and reads `assets/tour/tour.json`. Tabs switch between screens. Each screen has numbered markers; a click spotlights the region and opens a popover with a sharp close-up and a short text. A second click, a click on the screenshot or Escape closes it; arrow keys step through the markers. On narrow screens the popover sits under the screenshot. Without the JSON the `.tour-fallback` image stays.

The images and the JSON are generated from the running app:

```bash
bun run website:screenshots --llm claude-cli      # fresh demo data, LLM report, suggestions and daily brief
bun run website:screenshots --data <dir>          # reuse a data directory (keeps earlier LLM content)
bun run website:screenshots --only reports --debug /tmp/shots
```

`scripts/screenshots/capture.ts` starts the service on a scratch data directory (never the real one), seeds the demo portfolio, opens the GUI in headless Chromium at 1600x900 (2x) and writes `assets/tour/<screen>.webp`, one close-up per hotspot, `tour.json` and `assets/screenshot.png`. The screens, hotspot targets and texts live in `scripts/screenshots/shots.ts`; targets are found by text in the page, so markers follow layout changes. `--debug <dir>` writes each screen with its crop boxes drawn on it. It needs Playwright's Chromium (`bunx playwright-core install chromium`) or Google Chrome.

## Deploy

```bash
./deploy.sh                       # wrangler pages deploy to project "portfolio-desktop"
./deploy.sh --project-name=<name> --branch=<branch>
```

Reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_PAGES_BRANCH` and `POSTHOG_API_KEY` from the repo `.env` or `extras/website/.env`. Without a token Wrangler falls back to its own login. The script regenerates `metrics/index.html`, then stages a copy without `deploy.sh`, `README.md`, `package.json` and `.env`.
