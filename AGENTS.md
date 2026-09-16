# AGENTS.md

## What this repo is

Portfolio is an offline personal investment tracker for Linux, Windows and macOS. Bun workspace with the same module layout as Assistant: a pure Bun service (`modules/service`, `Bun.serve` + `bun:sqlite`, no framework), a React 19 GUI built with Vite (`modules/gui`) and served by the service, a thin Electrobun shell (`modules/desktop`) that spawns the service and points one window at it, and `modules/shared` for the types both sides use. TypeScript strict throughout.

Offline-first and private: no remote accounts or databases. Yahoo Finance and Finnhub provide quotes, news and FX. Local or cloud LLMs generate reports and answer in the assistant sidebar. PostHog telemetry is off by default and never sends balances, holdings or personal data. Metric modules are sandboxed AssemblyScript (`extras/metrics/`) run in a separate engine process.

The GUI talks to the service only over HTTP (`/api/...`). The service listens on loopback; Settings → Access can lock the app with a PIN and, once a PIN is set, allow other devices on the network to open it (same switch as Assistant).

## Layout

- `modules/service/src/` - `main.ts` (bootstrap, `Bun.serve`), `http/` (router, routes, static GUI), `services/` (portfolio, market data, LLM, reports, chat, metrics runtime, auth, host settings, update check, support), `db/` (schema and repositories), `config.ts` (settings in the `config` table), `paths.ts` (data and log directories), `logger.ts` (daily `service-YYYY-MM-DD.log`). Tests in `services/__tests__/`.
- `modules/gui/src/` - `App.tsx`, `api.ts` (typed HTTP client), `rpc.ts` (compatibility shim `rpc.request.<name>` over `api`), `components/{layout,common,portfolio,metrics,settings}/`, `index.css` (tokens shared with Assistant).
- `modules/shared/src/` - `api-types.ts`, `config-types.ts`, `brand.ts`, `log-format.ts`, `portfolio.ts` (domain models), metric contracts (`metrics.ts`, `metric-abi.ts`, `metric-manifest.ts`, `metric-output.ts`).
- `modules/desktop/` - `electrobun.config.ts`, `src/bun/` (shell, window state, Linux icons), `scripts/stage.ts`, `assets/`.
- `extras/metrics/` - metric modules (read its README first). `extras/website/` - marketing site (Cloudflare Pages) including `releases/latest.json` and the packages.
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
bun run dev                       # service (port 5130) + Vite GUI (port 5131)
bun run desktop                   # electrobun dev with the staged service and GUI
bun run typecheck | bun run test
bun run build:metrics             # after changing extras/metrics
bun run release [patch|minor|major]      # tag
bun run release:build [linux|windows|macos]
bun run release:publish
```

## Rules

1. Do not run build, typecheck or test after edits unless asked; the user validates against the running app.
2. Commit only your changes; other agents may work in parallel.
3. Never log or send balances, tickers, quantities or personal data.
4. GUI and service talk only over HTTP: a route in `modules/service/src/http/routes.ts`, a method in `modules/gui/src/api.ts`, types in `modules/shared/src/api-types.ts`. No `bun` or `node:*` imports in `modules/gui`.
5. Keep route handlers thin; logic in `modules/service/src/services/`.
6. Settings live in the `config` table (`loadConfig`/`updateConfig`), never in a .env file. Only paths and ports come from the environment (`paths.ts`, `main.ts`).
7. Clean LLM output with `sanitizeLlmResponse()` before display.
8. A metric never runs in the main process or webview; the ABI changes only with a new version.
9. Writing: short active sentences. No em-dashes, emojis or AI clichés. State only verified facts.
