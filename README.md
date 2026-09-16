# Portfolio

An offline-first, private personal investment portfolio tracker for Linux, Windows and macOS built with **Bun**, **bun:sqlite**, **React 19** and **Electrobun**.

Your portfolio data stays strictly on your local device. Market quotes are fetched live from Yahoo Finance, and AI analytical briefings can be generated on-demand using local (Ollama, llamacpp-server) or cloud (Groq, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek) LLMs.

<p align="center">
  <img src="extras/website/assets/screenshot.png" width="900"
       alt="Portfolio overview tab: metric cards for total value, day gain and lifetime gain, a portfolio performance history chart, an asset allocation donut, and a live positions table with 52-week ranges and RSI.">
</p>

<p align="center">
  <sub>The overview dashboard on the built-in demo portfolio &mdash; customizable metric cards, performance history against invested capital, asset allocation by class and weight, and live positions with technical gauges.</sub>
</p>

---

## Key Features

- **100% Offline-First Data Storage**: Portfolios, transactions, and snapshots are stored locally in SQLite (`~/.config/portfolio/data/portfolio.sqlite`). No external server or accounts needed.
- **Local SQLite Engine (`bun:sqlite`)**: High-performance WAL-mode SQLite database with indexed tables and instant queries.
- **Live Market Valuation & Multi-Currency FX**: Real-time quotes, intraday P&L, historical charts, and foreign exchange conversions powered by Yahoo Finance.
- **Progressive Financial Analytics**: Automatic calculation of total invested capital, realized gains, uninvested cash liquidity balance, dividend income, broker fees, and tax withholdings.
- **Sandboxed Metric Modules**: Every metric is a WebAssembly module with a YAML manifest that declares its developer, version, and the data scopes it reads. Modules run in a separate engine process with no file, network, or system access, a memory ceiling, and a time budget. The Metrics tab lists the metrics of a portfolio, a bounded dashboard (4 large cards, 6 compact tiles) that feeds the Overview, and a marketplace built from [`extras/metrics/repository.yml`](extras/metrics/README.md). Third-party modules can be installed from a URL after a scope consent dialog and stay marked UNVERIFIED.
- **Technical Indicators**: 50-day and 200-day Simple Moving Averages (SMA 50, SMA 200), 14-day Relative Strength Index (RSI), and 52-week ranges.
- **Broker CSV Importer**: Intelligent CSV import wizard with automatic template detection (Trade Republic, Scalable Capital, Interactive Brokers, Degiro) with dry-run diff preview and duplicate protection.
- **On-Demand AI Analyst**: Generate tactical markdown portfolio performance briefings via local or cloud LLMs.
- **Setup Wizard**: 3-step onboarding wizard describing the application, offering an optional 100-transaction demo portfolio, and an opt-in anonymous telemetry toggle.
- **Anonymous Telemetry (Opt-in)**: Privacy-preserving telemetry using PostHog, completely optional (default off). No financial data, portfolio values, or personal identifiers are ever transmitted.
- **Dark Terminal Aesthetic**: dark navy canvas, Portfolio's pink accent, `Plus Jakarta Sans` for text and `JetBrains Mono` for numbers, interactive Chart.js visualizations.
- **App lock and LAN access**: an optional PIN locks the app; with a PIN set, phones and other devices on your network can open Portfolio in a browser.

---

## Project Structure

```
portfolio/
├── package.json                # Bun workspace: modules/*
├── modules/
│   ├── service/                # Pure Bun HTTP service: Bun.serve + bun:sqlite (API, settings, logs)
│   ├── gui/                    # React 19 + Vite GUI, served by the service on /
│   ├── desktop/                # Electrobun shell: spawns the service, one window, packaging
│   └── shared/                 # Types, brand constants and helpers used by all three
├── extras/
│   ├── metrics/                # Sandboxed AssemblyScript metric modules
│   └── website/                # Marketing site (Cloudflare Pages) + releases/latest.json manifest
├── scripts/
│   ├── release.sh              # tag | build (Docker for Linux) | publish (website)
│   ├── docker/Dockerfile.linux # Linux build box
│   ├── build-deb.sh            # Debian package from the Electrobun bundle
│   └── build-metrics.ts        # Compiles extras/metrics
└── docs/                       # architecture.md, theme.md
```

See [docs/architecture.md](docs/architecture.md) for how the modules fit together, where settings and logs live, and how releases are built.

---

## Development & Build

### Prerequisites

- [Bun](https://bun.sh) 1.3 or newer
- Linux: `libwebkit2gtk-4.1` and GTK 3 for the desktop shell; `dpkg-deb` and `zstd` for the Debian package
- Docker (for `scripts/release.sh build linux`)

### Install Dependencies

```bash
bun install
```

### Run in Development

```bash
bun run dev        # service on http://127.0.0.1:5130, Vite GUI on http://localhost:5131
bun run desktop    # stages service + GUI and opens the Electrobun window
```

Data goes to `~/.config/portfolio` (Linux), `%APPDATA%\portfolio` (Windows) or `~/Library/Application Support/portfolio` (macOS). Set `PORTFOLIO_DATA_DIR` to use another directory.

### Typecheck and Test

```bash
bun run typecheck
bun run test
```

### Build Metric Modules

```bash
bun run build:metrics       # after changing extras/metrics
bun run check:metrics       # validate without writing
```

### Build the Desktop Application

```bash
bun run desktop:build       # modules/desktop/artifacts for this OS
```

### Release

```bash
bun run release [minor|patch|major]    # bump, changelog, commit, tag, push, build 3 OS artifacts in Docker, GitHub release
bun run release:build                  # build 3 OS packages locally in Docker (dist/<version>/)
bun run website:publish                # write latest.json and deploy website to Cloudflare Pages
```
