# Portfolio Marketing Website

Static landing page for Portfolio, deployed to Cloudflare Pages. Plain HTML, CSS and one script; no build step (the metrics catalog page is generated, see below).

The site uses vanilla HTML, `style.css` and `script.js`. `index.html` is structured into hero, interface screenshot with interactive hotspots, features, how it works, downloads matrix, and FAQ.

## Pages

- `index.html` - hero with OS-detected download button, annotated screenshot (numbered markers with tooltips; click or "Expand" opens it full size; on narrow screens the markers become a list under the image), features, how it works, download matrix, FAQ.
- `terms/index.html` - Terms of Use, including the "Analytics and Cookies" section (`#cookie-policy`).
- `metrics/index.html` - the Metrics Marketplace catalog. **Generated** by `bun run build:metrics-site` from `extras/metrics/repository.yml` and each `manifest.yml`; it copies the `<head>`, header and footer of `terms/index.html`. Do not edit by hand; `deploy.sh` regenerates it.
- `sponsor/index.html` - self-contained sponsor page with its own inline styles.
- `assets/` - `app-icon.svg`, `app-icon.png`, `icon-512.png`, `screenshot.png` (1600x1104, the overview tab with the demo portfolio).

## Local preview

```bash
cd extras/website
bun run dev            # bunx serve .
# or: python3 -m http.server 3000
```

## Analytics

PostHog is loaded with capturing opted out. `script.js` shows a cookie banner on the first visit and only calls `opt_in_capturing()` after "Accept"; the choice is stored in `localStorage` (`portfolio_cookie_consent_v1`). Tracked events: `$pageview`, `download_clicked` (os, type), `screenshot_zoomed`, `screenshot_hotspot_opened`. The HTML carries the placeholder `YOUR_POSTHOG_PROJECT_API_KEY`; `deploy.sh` replaces it with `POSTHOG_API_KEY` from the environment or the repo `.env`.

## Download links

`script.js` reads the latest release from `/releases/latest.json` (written by `scripts/release.sh publish`, cached 15 minutes in `localStorage`) and builds asset URLs from the version:

```
portfolio_<version>_x64_setup.exe        portfolio_<version>_windows-x64_portable.zip
portfolio_<version>_universal.dmg        portfolio_<version>_macos-universal.zip
portfolio_<version>_amd64.deb            portfolio_<version>_linux-x64.tar.gz
```

Until the manifest is read (or when it fails) every link points at the downloads section. If `scripts/release.sh` renames the artifacts, update `buildAssetFilenames()`.

## Screenshot

Capture the running app's overview tab at 1600x1104 with the demo portfolio and save it as `assets/screenshot.png`. The hotspot markers in `index.html` are positioned in percent (`--x`, `--y`); adjust them if the layout of the overview changes.

## Deploy

```bash
./deploy.sh                       # wrangler pages deploy to project "portfolio-desktop"
./deploy.sh --project-name=<name> --branch=<branch>
```

Reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_PAGES_BRANCH` and `POSTHOG_API_KEY` from the repo `.env` or `extras/website/.env`. Without a token Wrangler falls back to its own login. The script regenerates `metrics/index.html`, then stages a copy without `deploy.sh`, `README.md`, `package.json` and `.env`.
