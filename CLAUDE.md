---
trimmedAt: 2026-11-05
---

# CLAUDE.md

## Project

Portfolio is an offline personal investment tracker for Linux, Windows and macOS. It is a Bun workspace in strict TypeScript. All user data stays on the local computer. The app has no remote accounts and no remote database.

## Modules

- `modules/service`: the Bun service (`Bun.serve`, `bun:sqlite`, no framework). It owns the `/api` routes, the database and the settings. It serves the GUI on `/`.
- `modules/gui`: the React 19 GUI, built with Vite.
- `modules/desktop`: the Electrobun shell. It starts the service and opens one window.
- `modules/shared`: the shared types and helpers.
- `extras/metrics`: sandboxed AssemblyScript metric modules. Read its README first. The metric contracts are in `modules/shared/src/metric*.ts`.
- `extras/website`: the marketing site on Cloudflare Pages.
- `lang/<code>.yml`: the interface text, one file for each ISO 639-1 code. `en.yml` is the source and the fallback. The format and the language list are in `modules/shared/src/i18n.ts`.

FMP, Yahoo Finance and Finnhub supply the market data through a provider chain. Local or cloud LLMs write the reports and answer in the assistant sidebar. PostHog usage analytics and error reporting are two separate opt-in options, both off by default. Follow `/mnt/files/NoteBook/CGEO/SOFT/App Telemetry and Consent.md`. The Portfolio plan is in `docs/telemetry-consent.md`.

For files, configuration, access, logs and release, read `docs/architecture.md`. For tests, read `docs/testing.md`. A test that connects to a non-loopback host fails (`scripts/test-network-guard.ts`). Stub `globalThis.fetch`.

## Skills

Before you change an area, load its skill from `.claude/skills/`. The skill description tells which area the skill covers.

## Commands

```bash
bun install            # link the workspace packages
bun start              # desktop window on Vite with hot reload, service under bun --watch
bun run typecheck
bun run test
bun run build:metrics  # after a change in extras/metrics
```

The release and website commands are in `devops-engineer`.

## Rules

1. After you edit code, run `bun run typecheck`. Do not run the tests or the build unless the user tells you to. The user checks the changes in the running app.
2. Commit only your changes. Other agents can work in this repo at the same time.
3. Do not log or send balances, tickers, quantities or personal data.
4. The GUI and the service communicate only through HTTP. For a new call, add the types in `modules/shared/src/api-types.ts`, a route in `modules/service/src/http/routes.ts` and a method in `modules/gui/src/api.ts`.
5. Do not import `bun` or `node:*` in `modules/gui`.
6. Keep the route handlers thin. Put the logic in `modules/service/src/services/`.
7. Keep the settings in the `settings` table (`loadConfig`, `updateConfig`). Do not use a `.env` file. The service reads no environment variables. `paths.ts` makes the paths. Build-time values are `--define` constants (`globals.d.ts`).
8. Clean all LLM output with `sanitizeLlmResponse()` before you show it.
9. Do not run a metric in the main process or in the webview. Change the metric ABI only with a new ABI version.
10. Send all user-visible GUI text through `t("section.key")`. Write the English text in `lang/en.yml`. Do not call `t()` at module top level, because the language loads before the first render.
11. Add each new text key to all languages. `bun run scripts/check-lang.ts` shows the missing keys.
12. Write the LLM prompts in English. The `language` setting sets the output language.
13. Write short, active sentences. Do not use em-dashes, emojis or AI clichés. Write only facts that you verified.
14. Remotes: `origin` is `cg@cronus:/mnt/repos/portfolio.git`. `github` is `cgeosoft/portfolio` (pull requests, Dependabot, Actions). Push only when Christos tells you to.
