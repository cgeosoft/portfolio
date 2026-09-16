# Architecture

Portfolio and Assistant share one shape: a Bun workspace with `modules/service`, `modules/gui`, `modules/desktop` and `modules/shared`. A user should recognise the same vendor in both apps: same menu bar, footer, lock screen, tokens and fonts, same log format, same release flow.

## Modules

| Module | Runs as | Responsibility |
|---|---|---|
| `modules/service` | Bun process (`bun src/main.ts`, or `service/main.js` inside the desktop bundle) | HTTP API on `/api`, serves the built GUI on `/`, owns the SQLite database, settings, sessions, logs, background work |
| `modules/gui` | Browser (the desktop webview or any browser on the LAN) | React app built by Vite; talks to the service over HTTP with cookies |
| `modules/desktop` | Electrobun main process | Spawns the service, waits for `/api/health`, loads `http://127.0.0.1:5130`, persists the window geometry, routes external links |
| `modules/shared` | Imported by all three | API and config types, brand constants, log line layout, domain models |

The service is plain Bun: `Bun.serve` with the router in `src/http/router.ts` and `bun:sqlite`. No web framework, no ORM.

## Configuration

There is no `.env` file at runtime. The service reads only these environment variables, set by the desktop shell or a developer:

| Variable | Default | Purpose |
|---|---|---|
| `PORTFOLIO_PORT` | `5130` | Listen port |
| `PORTFOLIO_HOST` | remote-access switch | Force a bind address (servers) |
| `PORTFOLIO_DATA_DIR` | `~/.config/portfolio` (Linux), `%APPDATA%\portfolio`, `~/Library/Application Support/portfolio` | Database `data/portfolio.sqlite`, `host-settings.json` |
| `PORTFOLIO_LOG_DIR` | `<workspace>/logs` in dev; `~/.local/state/portfolio/logs` (Linux), `%LOCALAPPDATA%\portfolio\logs`, `~/Library/Logs/portfolio` in production | One `service-YYYY-MM-DD.log` per day |
| `PORTFOLIO_GUI_DIR` | unset | Built GUI to serve on `/` |
| `PORTFOLIO_VERSION` | root `package.json` in dev | Baked into the bundle by `modules/desktop/scripts/stage.ts` |
| `POSTHOG_API_KEY` | empty (telemetry off) | Baked into the bundle at build time |

Everything the user can change lives in the `config` table: one row per key, JSON value (`modules/service/src/config.ts`, types in `modules/shared/src/config-types.ts`). A `config.json` from a release before 0.3 is imported once and renamed to `config.json.migrated`.

## Access

- `GET /api/health`, `GET /api/auth/status` and `POST /api/auth/login` are public; everything else needs the `portfolio_session` cookie (7 days, stored in the `sessions` table).
- Without a PIN the GUI logs in automatically. With a PIN (Settings → Access) the lock screen asks for it; five wrong attempts lock for five minutes.
- The service binds to `127.0.0.1` until "Allow remote connections" is on, which requires a PIN. The switch rebinds the listener to `0.0.0.0` in place and is only accepted from a loopback client (the desktop window). Non-loopback clients get 403 while the switch is off.

## Logging

Both apps write the same line layout (`renderFileLogLine` in `modules/shared/src/log-format.ts`):

```
2026-09-16T21:34:27.134Z  INFO   auth:pin                    PIN enabled
2026-09-16T21:34:27.152Z  INFO   host:remote-access          Remote connections allowed; listening on 0.0.0.0:5130  12ms  key=value
```

The service writes one file per local day, `service-YYYY-MM-DD.log`, in the log directory (`modules/service/src/logger.ts`). Every start on the same day appends to that day's file; a new file begins at midnight; nothing is rotated by size or deleted. The same records are printed to the console in an aligned, coloured layout with the source, step, duration and `key=value` details (`log-console.ts`); colour is on when stdout is a terminal or in development, off with `NO_COLOR`. Debug records reach the file only in development. The desktop shell writes its own events to `desktop-YYYY-MM-DD.log` in the same directory and keeps the last lines of the service output (colour stripped) for the failure page. GUI events go to `POST /api/app/logs` and end up in the service file with source `gui`. Support tickets bundle the daily files modified in the last 24 hours.

## Release

`scripts/release.sh` has three commands:

1. `tag` bumps every `package.json`, writes the changelog entry, commits, tags `vX.Y.Z` and pushes.
2. `build [linux|windows|macos]` produces `dist/<version>/portfolio_<version>_{amd64.deb,linux-x64.tar.gz,x64_setup.exe,windows-x64_portable.zip,universal.dmg,macos-universal.zip}`. The Linux packages are built inside the Docker image `scripts/docker/Dockerfile.linux`. Electrobun only builds for the host OS and macOS cannot run in Docker, so the Windows and macOS packages are built on such a machine: `--native` on that machine, or over SSH by setting `RELEASE_BUILDER_WINDOWS` / `RELEASE_BUILDER_MACOS` to `user@host`.
3. `publish` copies `dist/<version>/*` into `extras/website/releases/<version>/`, writes `releases/latest.json` (version, notes, file names, sizes, SHA-256) and deploys the website to Cloudflare Pages with `extras/website/deploy.sh`. Cloudflare Pages rejects files above 25 MiB; the script stops if a package is larger.

The app checks `https://portfolio.cgeosoft.com/releases/latest.json` for updates and opens the installer URL in the browser. The website reads the same file for its download links. GitHub Actions are no longer used.
