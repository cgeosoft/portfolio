# Portfolio Desktop Marketing Website

A modern, tactical cyberpunk marketing landing page for [Portfolio Desktop](https://github.com/your-username/portfolio).

## Features

- **Automated OS Detection**: Dynamically inspects the client's operating system (Windows, macOS, Linux) and adapts the primary hero download CTA with the appropriate installer (`.exe`, `.dmg`, or `.deb`).
- **Interactive App Showcase**: Embedded terminal/UI mockup highlighting live portfolio analytics, holdings indicators, AI briefings, and broker CSV importer.
- **3-Platform Download Matrix**: Direct installer and portable archive links for Windows, macOS, and Linux with verified checksum indicators.
- **Tactical Cyberpunk Aesthetic**: Monospace typography (`JetBrains Mono`), dark space palette (`#0b0f19`), cyber pink primary accent (`#DD3C73`), mint highlights (`#A7E2C0`), and responsive glassmorphic cards.
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
  releaseBase: "https://github.com/your-username/portfolio/releases/download/v0.1.0",
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

Then run:
```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./extras/website/deploy.sh
```
