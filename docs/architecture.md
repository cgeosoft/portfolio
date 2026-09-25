# Architecture

Portfolio is structured as a Bun workspace with `modules/service`, `modules/gui`, `modules/desktop` and `modules/shared`.

## Modules

| Module | Runs as | Responsibility |
|---|---|---|
| `modules/service` | Bun process (`bun src/main.ts`, or `service/main.js` inside the desktop bundle) | HTTP API on `/api`, serves the built GUI on `/`, owns the SQLite database, settings, sessions, logs, background work |
| `modules/gui` | Browser (the desktop webview or any browser on the LAN) | React app built by Vite; talks to the service over HTTP with cookies |
| `modules/desktop` | Electrobun main process | Spawns the service, waits for `/api/health`, loads `http://127.0.0.1:5130`, persists the window geometry, routes external links |
| `modules/shared` | Imported by all three | API and config types, brand constants, log line layout, domain models |

The service is plain Bun: `Bun.serve` with the router in `src/http/router.ts` and `bun:sqlite`. No web framework, no ORM.

## Configuration

There is no `.env` file and the service reads no environment variable of its own. It derives its paths itself (`modules/service/src/paths.ts`; the desktop shell applies the same rule in `modules/desktop/src/bun/app.ts`):

| Path | Where |
|---|---|
| Data directory | `~/.local/share/portfolio` (Linux, `XDG_DATA_HOME` ignored), `~/Library/Application Support/portfolio` (macOS), `%APPDATA%\portfolio` (Windows); the same in development and in the installed app |
| Database | `<data>/portfolio.sqlite` |
| Logs | `<data>/logs/` |
| Metric engine and modules | `<data>/metrics/` |
| Built GUI | `Resources/app/gui`, next to the bundle's `service/` directory; from a checkout Vite serves the GUI |
| Sponsor pages | `sponsor.html` and `sponsor-light.html` next to the bundle; `extras/website/sponsor/` in a checkout |

The service runs "from source" when a parent directory of the code holds the workspace `package.json` (`REPO_ROOT`). That run counts as development: debug records are printed and `/api/app/info` reports `isDev`.

On the first start `src/bootstrap.ts` imports the data of releases before 0.6: when `<data>/portfolio.sqlite` is missing and `<old>/data/portfolio.sqlite` exists (`<old>` = `~/.config/portfolio` on Linux, the data directory itself on macOS and Windows), it checkpoints the old database, copies it to `<data>/portfolio.sqlite` and copies the other entries of the old directory, skipping SQLite `-wal`, `-shm` and `-journal` files. The old directory stays in place.

Build-time values are global constants that `bun build --define` bakes into the bundle (`modules/service/src/globals.d.ts`): `APP_VERSION` (without it: `version.txt` next to the bundle, then the root `package.json`) and `POSTHOG_API_KEY` (empty: telemetry stays off).

Everything the user can change lives in the `settings` table: one row per key, `key` and `value`, a string as is and other values as JSON (`modules/service/src/config.ts`, types in `modules/shared/src/config-types.ts`). A `config.json` from a release before 0.3 is imported once and renamed to `config.json.migrated`. `GET /api/config` never returns an API key: each stored key comes back as `SECRET_MASK`, and a request that carries `SECRET_MASK` uses the stored key.

## Access

- `GET /api/health`, `GET /api/auth/status` and `POST /api/auth/login` are public; everything else needs the `portfolio_session` cookie (7 days, stored in the `sessions` table).
- Without a PIN the GUI logs in automatically. With a PIN (Settings → General) the lock screen asks for it; five wrong attempts lock for five minutes.
- On first run the lock screen asks to accept the Terms of Use. Until `POST /api/auth/accept-terms` records it (`auth:acceptedTermsAt` in `kv_entries`), a session may only call `/api/auth/me`, `/api/auth/accept-terms` and `/api/auth/logout`; everything else gets 403.
- The service binds to `127.0.0.1` until "Allow remote connections" is on, which requires a PIN. The switch rebinds the listener to `0.0.0.0` in place and is only accepted from a loopback client (the desktop window). Non-loopback clients get 403 while the switch is off.

## Logging

The service and desktop write a consistent line layout (`renderFileLogLine` in `modules/shared/src/log-format.ts`):

```
2026-09-16T21:34:27.134Z  INFO   auth:pin                    PIN enabled
2026-09-16T21:34:27.152Z  INFO   host:remote-access          Remote connections allowed; listening on 0.0.0.0:5130  12ms  key=value
```

The service writes one file per local day, `service-YYYY-MM-DD.log`, in the log directory (`modules/service/src/logger.ts`). Every start on the same day appends to that day's file; a new file begins at midnight; nothing is rotated by size or deleted. The same records are printed to the console in an aligned, coloured layout with the source, step, duration and `key=value` details (`log-console.ts`); colour is on when stdout is a terminal or in development, off with `NO_COLOR`. Debug records reach the file only in development. The desktop shell writes its own events to `desktop-YYYY-MM-DD.log` in the same directory and keeps the last lines of the service output (colour stripped) for the failure page. GUI events go to `POST /api/app/logs` and end up in the service file with source `gui`. Support tickets bundle the daily files modified in the last 24 hours.

## Release

`scripts/release.sh` provides the release and packaging commands:

1. `release [minor|patch|major]` runs the end-to-end release: bumps the version (defaults to minor), updates package manifests, generates the changelog entry, commits, tags `vX.Y.Z`, pushes, builds all 3 OS packages locally in Docker, creates a GitHub release, and uploads all artifacts.
2. `build [linux|windows|macos ...]` produces packages in `dist/<version>/`. The packages are built locally inside Docker (`scripts/docker/Dockerfile.linux`):
   - Linux: `portfolio_<version>_amd64.deb` and `portfolio_<version>_linux-x64.tar.gz`
   - Windows: `portfolio_<version>_x64_setup.exe` and `portfolio_<version>_windows-x64_portable.zip`
   - macOS: `portfolio_<version>_universal.dmg` and `portfolio_<version>_macos-universal.zip`
3. `publish-website` writes `extras/website/releases/latest.json` (version, notes, file names, sizes, SHA-256 and GitHub Releases asset URLs) from `dist/<version>/` and deploys the website to Cloudflare Pages with `extras/website/deploy.sh`. Release packages are hosted directly on GitHub Releases, so the website never hosts heavy binaries.

The app checks `https://portfolio.cgeosoft.com/releases/latest.json` for updates and opens the installer URL in the browser. The website reads the same file for its download links. GitHub Releases hosts all release binaries.
