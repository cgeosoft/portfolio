# AGENTS.md

## What this repo is

Portfolio is an offline personal investment tracker for Linux, Windows and macOS. Bun workspace layout: a pure Bun service (`modules/service`, `Bun.serve` + `bun:sqlite`, no framework), a React 19 GUI built with Vite (`modules/gui`) and served by the service, a thin Electrobun shell (`modules/desktop`) that spawns the service and points one window at it, and `modules/shared` for the types both sides use. TypeScript strict throughout.

Offline-first and private: no remote accounts or databases. Yahoo Finance and Finnhub provide quotes, news and FX. Local or cloud LLMs generate reports and answer in the assistant sidebar. PostHog telemetry is off by default and never sends balances, holdings or personal data. Metric modules are sandboxed AssemblyScript (`extras/metrics/`) run in a separate engine process.

The GUI talks to the service only over HTTP (`/api/...`). The service listens on loopback on a random port and prints `SERVICE_PORT=<port>`; Settings → General can lock the app with a PIN and, once a PIN is set, open a second listener on a user-set port for other devices on the network.

## Layout

- `modules/service/src/` - `main.ts` (bootstrap, `Bun.serve`), `http/` (router, routes, static GUI), `services/` (portfolio, market data, LLM, reports, chat, metrics runtime, auth, remote access, update check, support), `db/` (schema and repositories), `config.ts` (settings in the `settings` table), `paths.ts` (data directory, repo root, bundled files), `bootstrap.ts` (creates the data directory, one-time import of the old one), `globals.d.ts` (build-time constants), `logger.ts` (stdout only; the desktop shell writes `<data>/logs/service-YYYY-MM-DD.log`). Tests in `services/__tests__/`.
- `modules/gui/src/` - `App.tsx`, `api.ts` (typed HTTP client), `rpc.ts` (compatibility shim `rpc.request.<name>` over `api`), `components/{layout,common,portfolio,metrics,settings}/`, `index.css` (design tokens).
- `modules/shared/src/` - `api-types.ts`, `config-types.ts`, `brand.ts`, `log-format.ts`, `portfolio.ts` (domain models), metric contracts (`metrics.ts`, `metric-abi.ts`, `metric-manifest.ts`, `metric-output.ts`).
- `modules/desktop/` - `electrobun.config.ts`, `src/bun/` (`index.ts` shell, `dev.ts` development run, `service.ts` child process and logs, tray, window state, Linux icons; `app.ts` is the only file that differs from FintechCrafts Management), `scripts/stage.ts`, `assets/`. `modules/gui/scripts/dev-server.ts` starts Vite for `bun start`.
- `extras/metrics/` - metric modules (read its README first). `extras/website/` - marketing site (Cloudflare Pages) with `releases/latest.json` manifest.
- `scripts/release.sh` (tag, build, publish), `scripts/docker/Dockerfile.linux`, `scripts/build-deb.sh`, `scripts/build-metrics.ts`.
- `docs/architecture.md` (modules, config, logging, release), `docs/theme.md`.

## Skills

Load the matching skill before you change that area.

| Skill | Use for |
|---|---|
| [`electrobun-engineer`](.agents/skills/electrobun-engineer/SKILL.md) | Desktop shell, staging, packaging, `release.sh` |
| [`financial-engineer`](.agents/skills/financial-engineer/SKILL.md) | Portfolio math, Yahoo Finance, Finnhub, FX, indicators |
| [`prompt-engineer`](.agents/skills/prompt-engineer/SKILL.md) | LLM reports, assistant chat, providers, output cleanup |
| [`react-engineer`](.agents/skills/react-engineer/SKILL.md) | GUI components, HTTP client, Chart.js |
| [`ui-engineer`](.agents/skills/ui-engineer/SKILL.md) | Tailwind styling, design tokens |
| [`devops-engineer`](.agents/skills/devops-engineer/SKILL.md) | Build, packaging, release, website deploy |

## Commands

```bash
bun install                       # links the workspace packages
bun start                         # desktop window on Vite (hot reload), service under bun --watch; random ports, no stage
bun run typecheck | bun run test
bun run build:metrics             # after changing extras/metrics
bun run release [minor|patch|major]      # tag, build 3 OS artifacts in Docker, GitHub release
bun run release:build [linux|windows|macos] # build OS packages locally in Docker
bun run website:publish                   # write latest.json and deploy website to Cloudflare Pages
```

## Rules

1. Do not run build, typecheck or test after edits unless asked; the user validates against the running app.
2. Commit only your changes; other agents may work in parallel.
3. Never log or send balances, tickers, quantities or personal data.
4. GUI and service talk only over HTTP: a route in `modules/service/src/http/routes.ts`, a method in `modules/gui/src/api.ts`, types in `modules/shared/src/api-types.ts`. No `bun` or `node:*` imports in `modules/gui`.
5. Keep route handlers thin; logic in `modules/service/src/services/`.
6. Settings live in the `settings` table (`loadConfig`/`updateConfig`), never in a .env file. The service reads no environment variables: `paths.ts` derives the paths, build-time values are `--define` constants (`globals.d.ts`).
7. Clean LLM output with `sanitizeLlmResponse()` before display.
8. A metric never runs in the main process or webview; the ABI changes only with a new version.
9. Writing: short active sentences. No em-dashes, emojis or AI clichés. State only verified facts.
