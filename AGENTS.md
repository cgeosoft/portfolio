# AGENTS.md

## What this repo is

Portfolio is an offline personal investment tracker for Linux, Windows and macOS. Electrobun 2 desktop shell; Bun main process with `bun:sqlite` (WAL) at `~/.config/portfolio/data/portfolio.sqlite`; React 19 webview with Chart.js 4, Tailwind CSS 3.4 and Lucide. TypeScript 5.7 strict, two separate TS contexts (main and webview).

Offline-first and private: no remote accounts or databases. Yahoo Finance provides quotes and FX. Local or cloud LLMs generate performance reports. PostHog telemetry is off by default and never sends balances, holdings or personal data. Metric modules are sandboxed AssemblyScript (`extras/metrics/`, `manifest.yml` + source) run in a separate engine process.

## Layout

- `src/bun/` - main process: `index.ts` (RPC handlers, window, menu), `config.ts`, `logger.ts`, `db/` (repositories), `services/` (finance, LLM, `metrics/` runtime).
- `src/views/` - webview: `src/App.tsx`, `src/rpc.ts`, `src/components/{layout,common,portfolio,metrics,settings}/`, `src/input.css` → compiled `style.css`.
- `src/shared/` - `rpc-types.ts` (`PortfolioRPC`), metric contracts (`metrics.ts`, `metric-abi.ts`, `metric-output.ts`). `src/types/` - domain models.
- `extras/metrics/` - metric modules (read its README first). `scripts/release.sh`, `.github/workflows/`.

## Skills

Load the matching skill before you change that area.

| Skill | Use for |
|---|---|
| [`electrobun-engineer`](.agents/skills/electrobun-engineer/SKILL.md) | Main process, RPC bridge, `bun:sqlite`, config, metric sandbox wiring |
| [`financial-engineer`](.agents/skills/financial-engineer/SKILL.md) | Portfolio math, Yahoo Finance, FX, indicators |
| [`prompt-engineer`](.agents/skills/prompt-engineer/SKILL.md) | LLM reports, assistant chat, providers, output cleanup |
| [`react-engineer`](.agents/skills/react-engineer/SKILL.md) | Webview UI, components, Chart.js, Electroview RPC client |
| [`ui-engineer`](.agents/skills/ui-engineer/SKILL.md) | Tailwind styling, design tokens, compiled stylesheet |
| [`devops-engineer`](.agents/skills/devops-engineer/SKILL.md) | Build, packaging, release tags, GitHub Actions |

## Commands

```bash
bun run typecheck                 # both contexts
bun run build:css                 # after any Tailwind class change
bun run build:metrics             # after changing extras/metrics
bun run dev | bun run build | bun test
bun run release | bash scripts/release.sh tag patch|minor|0.2.0 [--dry-run]
```

## Rules

1. Do not run build, typecheck or test after edits unless asked; the user validates against the running app.
2. After each verified change: `git add -A && git commit -m "<message>" && git push`. Commit only your changes; other agents may work in parallel.
3. Never log or send balances, tickers, quantities or personal data.
4. UI and backend talk only through Electrobun RPC (`src/shared/rpc-types.ts`, handlers in `src/bun/index.ts`, `rpc.request.<name>()` in views). No `bun` or `node:*` imports in `src/views/`.
5. Keep RPC handlers thin; logic in `src/bun/services/`.
6. Clean LLM output with `sanitizeLlmResponse()` before display.
7. A metric never runs in the main process or webview; the ABI changes only with a new version.
8. Writing: short active sentences. No em-dashes, emojis or AI clichés. State only verified facts.
