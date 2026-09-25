# Architecture

Portfolio is structured as a Bun workspace with `modules/service`, `modules/gui`, `modules/desktop` and `modules/shared`.

## Modules

| Module | Runs as | Responsibility |
|---|---|---|
| `modules/service` | Bun process (`bun src/main.ts`, or `service/main.js` inside the desktop bundle) | HTTP API on `/api`, serves the built GUI on `/`, owns the SQLite database, settings, sessions, logs, background work |
| `modules/gui` | Browser (the desktop webview or any browser on the LAN) | React app built by Vite; talks to the service over HTTP with cookies |
| `modules/desktop` | Electrobun main process | Starts the service (`service/main.js` in the bundle), reads its `SERVICE_PORT=` line, waits for `/api/health` and loads `http://127.0.0.1:<port>`. In development (`bun start`) it runs the service under `bun --watch` and the Vite dev server itself (`src/bun/dev.ts`). Writes `<data>/logs`, keeps the window geometry in `<data>/window-state.json`, owns the tray and close to tray, installs the Linux `.desktop` entry, routes external links |
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
| Desktop switches | `<data>/desktop-settings.json` (`{ "closeToTray": bool }`), written by the service at start-up and when Settings → General → Close to tray changes; the shell reads it when the window closes |
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
- The service always listens on `127.0.0.1` on a random port (`Bun.serve` with port 0) and prints `SERVICE_PORT=<port>` once to stdout; the desktop shell reads that line and polls `GET /api/health`.
- "Allow remote connections" (Settings → General, requires a PIN) starts a second listener on `0.0.0.0:<remote port>` that serves the same app (`modules/service/src/services/remote-access.ts`). The port is a setting next to the switch (default 5130). The switch and the port live in the `settings` table (`allowRemoteConnections`, `remotePort`), change only through `PATCH /api/host/remote-access` from a loopback client, and start, stop or rebind the listener without a restart. A port in use comes back as 409 and the old listener keeps running. Removing the PIN turns the switch off. Non-loopback clients get 403 while the LAN listener is off. A `host-settings.json` from an earlier release is imported once and renamed to `host-settings.json.migrated`.

## Logging

The service and desktop write a consistent line layout (`renderFileLogLine` in `modules/shared/src/log-format.ts`):

```
2026-09-16T21:34:27.134Z  INFO   auth:pin                    PIN enabled
2026-09-16T21:34:27.152Z  INFO   host:remote-access          Remote connections allowed; listening on 0.0.0.0:5130  12ms  key=value
```

The service opens no log file. It prints every record to stdout in the file layout above (`modules/service/src/logger.ts`, `log-console.ts`), coloured when stdout is a terminal or when it runs from a checkout; debug records only from a checkout. The desktop shell appends that output, colour stripped, to `<data>/logs/service-YYYY-MM-DD.log`, one file per local day, and writes its own events to `desktop-YYYY-MM-DD.log` in the same directory. Every start on the same day appends to that day's file; nothing is rotated by size or deleted. GUI events go to `POST /api/app/logs` and end up in the service file with source `gui`. Support tickets bundle the service files of `<data>/logs` modified in the last 24 hours.

## Release

`scripts/release.sh` provides the release and packaging commands:

1. `release [minor|patch|major]` runs the end-to-end release: bumps the version (defaults to minor), updates package manifests, generates the changelog entry, commits, tags `vX.Y.Z`, pushes, builds all 3 OS packages locally in Docker, creates a GitHub release, and uploads all artifacts.
2. `build [linux|windows|macos ...]` produces packages in `dist/<version>/`. The packages are built locally inside Docker (`scripts/docker/Dockerfile.linux`):
   - Linux: `portfolio_<version>_amd64.deb` and `portfolio_<version>_linux-x64.tar.gz`
   - Windows: `portfolio_<version>_x64_setup.exe` and `portfolio_<version>_windows-x64_portable.zip`
   - macOS: `portfolio_<version>_universal.dmg` and `portfolio_<version>_macos-universal.zip`
3. `publish-website` writes `extras/website/releases/latest.json` (version, notes, file names, sizes, SHA-256 and GitHub Releases asset URLs) from `dist/<version>/` and deploys the website to Cloudflare Pages with `extras/website/deploy.sh`. Release packages are hosted directly on GitHub Releases, so the website never hosts heavy binaries.

The app checks `https://portfolio.cgeosoft.com/releases/latest.json` for updates and opens the installer URL in the browser. The website reads the same file for its download links. GitHub Releases hosts all release binaries.
