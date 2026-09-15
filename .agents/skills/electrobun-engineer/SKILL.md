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
- Files: `src/bun/index.ts` (the only place RPC methods are bound), `src/bun/config.ts` (`~/.config/portfolio/config.json`, `DesktopConfig`; a new field needs a `DEFAULT_CONFIG` entry), `src/bun/logger.ts` (`appLogger` with `logStep()` / `startTimer()`; metadata goes in `data`), `src/bun/db/database.ts` (WAL, foreign keys, additive migrations via `PRAGMA table_info`; one repo module per table), `src/bun/services/metrics/` (`runtime.ts` spawns the engine process, `registry.ts` merges built-ins with URL installs), `src/shared/rpc-types.ts` (`PortfolioRPC`).
- RPC method: payload types and a `PortfolioRPC.bun.requests` entry in `rpc-types.ts`; handler in `index.ts` calling a service; `rpc.request.<name>(payload)` from the webview.
- Never instantiate WebAssembly in the main process; a WASM loop cannot be interrupted in-thread, so metrics run in a killable child process.
- `bun run build:metrics` runs before `tsc`, `bun test` or `electrobun` (scripts chain it); its bundle is git-ignored.
