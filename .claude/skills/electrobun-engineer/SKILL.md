---
name: electrobun-engineer
description: Electrobun desktop app: Bun main process, window lifecycle, webview bridge, config, logging, staging and packaging. Use for desktop features, main-process changes, RPC methods, or packaging.
---

# Electrobun Engineer

## Overview

Owns the Electrobun shell: Bun main process, webview, the bridge between them, local config and packaging.

## When to Use

- Main-process code, window or tray lifecycle, exposing a capability to the webview.
- Desktop config, logging, staging or packaging problems.

## General Instructions

- Never import `bun`, `node:*` or main-process modules from view code.
- Thin bridge handlers; logic in services; typed payloads on both sides.
- New assets or view files need a `build.copy` entry in `electrobun.config.ts`.
- Never log secrets or personal data; use the project logger, not `console.log`.
- Packaging is verifiable only on the host OS; say which targets you built.
- Warn before a release script without `--dry-run`: it commits, tags and pushes.
- `bun run typecheck` after every edit.

## Project Instructions

- Bun main process with `bun:sqlite`, no React here. Relative imports use `.js`. `bun run typecheck` checks both TS contexts.
- Files: `modules/desktop/src/bun/index.ts` (shell: spawns `service/main.js`, reads its `SERVICE_PORT=<port>` line, waits for `/api/health`, loads `http://127.0.0.1:<port>`, tray and close to tray, window state, external links), `dev.ts` (`bun start`: the unpackaged shell finds the checkout, runs `src/main.ts` under `bun --watch` and `modules/gui/scripts/dev-server.ts`, and sends each new service port to Vite on stdin), `service.ts` (child process; appends its output to `<data>/logs/service-YYYY-MM-DD.log`), `app.ts` (the only per-app file: names, data directory rule, colours; the other `src/bun/` files are identical to FintechCrafts Management), `modules/desktop/scripts/stage.ts` (builds GUI and service into `stage/`, bakes `APP_VERSION` and `POSTHOG_API_KEY` with `--define`), `modules/desktop/electrobun.config.ts`. Service side: `modules/service/src/main.ts` (Bun.serve), `src/http/routes.ts` (every route), `src/config.ts` (`settings` table, `DesktopConfig`; a new field needs a `DEFAULT_CONFIG` entry in `config.ts` and the type in `modules/shared/src/config-types.ts`), `src/logger.ts` (`appLogger` with `logStep()` / `startTimer()`; metadata goes in `data`), `src/db/database.ts` (WAL, foreign keys, additive migrations via `PRAGMA table_info`; one repo module per table), `src/services/metrics/` (`runtime.ts` spawns the engine process, `registry.ts` merges built-ins with URL installs), `src/services/host-settings.ts` (remote-access switch), `src/services/auth.ts` (PIN, sessions).
- New API call: payload types in `modules/shared/src/api-types.ts`; a route in `modules/service/src/http/routes.ts` calling a service; a method in `modules/gui/src/api.ts` (and, for old call sites, an entry in `modules/gui/src/rpc.ts`).
- Never instantiate WebAssembly in the main process; a WASM loop cannot be interrupted in-thread, so metrics run in a killable child process.
- `bun run build:metrics` runs before `tsc`, `bun test` or `electrobun` (scripts chain it); its bundle is git-ignored.
