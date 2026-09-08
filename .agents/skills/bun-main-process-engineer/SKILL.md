---
name: bun-main-process-engineer
description: Maintain the Electrobun Bun main process, the type-safe RPC bridge, the bun:sqlite database layer, the JSON configuration manager, and service wiring. Use for back-end changes, new RPC methods, database work, or the setup and window lifecycle.
---

# Bun Main Process Engineer

## Stack and rules

- Main process runs on Bun (`bun:sqlite`, `node:*` built-ins). No React code here.
- TypeScript 5.7 in strict mode. Imports must use the `.js` extension for relative paths (`import X from "./file.js"`).
- The main process and the webview use separate TypeScript contexts. Run `bun run typecheck` after every edit.
- Keep RPC handlers thin. Put business logic in `src/bun/services/`, not in `src/bun/index.ts`.
- Never send or log balances, tickers, quantities, or personal data. Use `appLogger` and avoid sensitive payloads in log messages.

## Repo layout

- `src/bun/index.ts` - Entry point. Initializes the database, services, RPC handlers, window, and menu. This is the single place RPC methods are bound.
- `src/bun/config.ts` - Loads and saves `~/.config/portfolio/config.json` (`DesktopConfig`). Defines `getStorageDir()`, `loadConfig()`, `saveConfig()`, `updateConfig()`, and cross-platform autostart sync.
- `src/bun/environment.ts` - Environment helpers: production detection, webpage URL resolution, and app version.
- `src/bun/logger.ts` - Rotating file logger exposing `appLogger`.
- `src/bun/db/` - The `bun:sqlite` layer:
  - `database.ts` - Connection pool and schema migration (WAL mode, foreign keys, busy timeout).
  - `portfolio.repo.ts`, `transaction.repo.ts`, `report.repo.ts`, `snapshot.repo.ts`, `market-cache.repo.ts`, `conversation.repo.ts` - Repository modules that query and mutate tables.
- `src/bun/services/` - Business logic and external integrations (see the `financial-engineer` and `ai-analyst-engineer` skills).
- `src/shared/rpc-types.ts` - The single source of truth for the `PortfolioRPC` schema.

## Adding an RPC method

1. Define request and response payload interfaces in `src/shared/rpc-types.ts`.
2. Add the method to the `PortfolioRPC.bun.requests` map with `params` and `response` types.
3. Implement the handler in `src/bun/index.ts`. For complex logic, call a method on a service in `src/bun/services/`.
4. Call it from the webview using `rpc.request.methodName(payload)`.
5. Do not import `bun` or `node:*` modules inside `src/views/`. All system access flows through RPC.

## Database notes

- The database lives at `~/.config/portfolio/data/portfolio.sqlite` (path from `getStorageDir()`).
- WAL mode and foreign keys are enabled in `database.ts`.
- Repositories return domain types from `src/types/portfolio.ts`.
- The `reports` table has a nullable `prompt` column added via migration. Follow the same pattern of `PRAGMA table_info` checks for additive migrations.

## Gotchas and pitfalls

- Always run `bun run typecheck` after TypeScript edits in `src/bun/`. It checks both the main process and the webview.
- Every change must be committed and pushed per the release workflow. Other agents may work in the repo at the same time, so commit only your changes.
- Do not log API keys, token values, or financial data.
- Keep the RPC schema and the `DesktopConfig` type in sync manually. A new config field needs a `DEFAULT_CONFIG` entry in `config.ts`.