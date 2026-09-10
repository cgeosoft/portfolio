# Portfolio Marketing Website

A modern, marketing landing page for [Portfolio](https://github.com/cgeosoft/portfolio).

## Features

- **Automated OS Detection**: Dynamically inspects the client's operating system (Windows, macOS, Linux) and adapts the primary hero download CTA with the appropriate installer (`.exe`, `.dmg`, or `.deb`).
- **Annotated Screenshot**: The real `assets/screenshot.png` of the overview dashboard, framed as an app window with numbered markers that reveal what each region does, a highlights toggle, and click-to-zoom full-size view. On narrow screens the markers collapse into a readable numbered list under the image.
- **Interactive App Showcase**: Embedded terminal/UI mockup highlighting live portfolio analytics, holdings indicators, AI briefings, and broker CSV importer.
- **3-Platform Download Matrix**: Direct installer and portable archive links for Windows, macOS, and Linux with verified checksum indicators.
- **Aesthetic**: Monospace typography (`JetBrains Mono`), dark space palette (`#0b0f19`), cyber pink primary accent (`#DD3C73`), mint highlights (`#A7E2C0`), and responsive glassmorphic cards.
- **Single-Script Cloudflare Pages Deployment**: Instant deployment using `./deploy.sh`.

## Local Development & Preview

You can serve the static site locally with Bun, Python, or any static server:

```bash
cd extras/website

# Using Bun
bun run dev

# Or using Python
python3 -m http.server 3000
```

Open `http://localhost:3000` in your browser.

## Customizing Download URLs

Download links and release filenames are centralized in `script.js`:

```javascript
const DOWNLOAD_CONFIG = {
  version: "0.1.0",
  releaseBase: "https://github.com/cgeosoft/portfolio/releases/download/v0.1.0",
  windows: { ... },
  macos: { ... },
  linux: { ... }
};
```

Simply update these values whenever you publish a new version.

## Deploying to Cloudflare Pages

To deploy the website to Cloudflare Pages in one command:

```bash
cd extras/website
./deploy.sh
```

Or pass custom parameters:

```bash
./deploy.sh --project-name=my-portfolio-site --branch=main
```

### CI / CD Deployment (GitHub Actions)

For automated CI/CD deployments, set the following repository secrets:
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Cloudflare Pages: Edit` permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.
- `POSTHOG_API_KEY`: Your PostHog project API key (`phc_...`). This is injected into the
  deployed site's analytics snippet at deploy time.

Then run:
```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... POSTHOG_API_KEY=phc_... ./extras/website/deploy.sh
```

You can also set `POSTHOG_API_KEY` in the repository root `.env` (or `extras/website/.env`);
`deploy.sh` loads it automatically.
