---
name: electrobun-engineer
description: "Electrobun desktop shell and service wiring: shell process, window, tray, dev run, staging, service start-up, settings table, logger and database. Use it for desktop features, main-process changes, a new API call, a new setting or staging problems."
trimmedAt: 2026-11-05
---

# Electrobun Engineer

## Shell files (`modules/desktop/`)

- `src/bun/index.ts`: the shell. It starts the service, waits for `/api/health` and opens the window. It owns the tray, the window state and the external links.
- `src/bun/dev.ts`: the `bun start` run. It runs the service under `bun --watch` and the Vite dev server from the checkout.
- `src/bun/service.ts`: the service child process and its daily log file.
- `src/bun/app.ts`: the only file for this app. The other `src/bun/` files are the same as in FintechCrafts Management.
- `scripts/stage.ts`: builds the GUI and the service into `stage/` and sets the `--define` constants.
- `electrobun.config.ts`: copies `stage/service` and `stage/gui` into the bundle. Add other bundle files to `extraCopies`.

## Service files (`modules/service/src/`)

- `config.ts`: the `settings` table and `DesktopConfig`.
- `logger.ts`: `appLogger` with `logStep()` and `startTimer()`. Put the metadata in `data`.
- `db/database.ts`: WAL, foreign keys, additive migrations with `PRAGMA table_info`. Use one repo module for each table.
- `services/metrics/runtime.ts`: starts the metric engine process.
- `services/remote-access.ts`: the LAN listener. `services/auth.ts`: the PIN and the sessions.

## Procedures

- New API call: do CLAUDE.md rule 4. For old call sites, also add an entry in `modules/gui/src/rpc.ts`.
- New setting: add the type in `modules/shared/src/config-types.ts` and a `DEFAULT_CONFIG` entry in `config.ts`.

## Rules

- Do not use React in the shell. Keep the handlers thin and the payloads typed.
- Log through the project logger, not `console.log`.
- Do not create a WebAssembly instance in the main process. A WASM loop cannot stop in its own thread.
- For a new service capability (for example a new `bun:` module), update `capabilities` in `electrobun.config.ts`. Hutch scans only the main-process bundle.
- After a change in `src/bun/`, the user must start `bun start` again.
