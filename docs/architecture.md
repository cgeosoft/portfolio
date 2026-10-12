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
| Data directory | `~/.local/share/portfolio` (Linux, `XDG_DATA_HOME` ignored), `~/Library/Application Support/portfolio` (macOS), `%APPDATA%\portfolio` (Windows); the same in development and in the installed app. On Linux and macOS `src/bootstrap.ts` sets it to mode 0700 on every start: the database keeps the API keys in plain text |
| Database | `<data>/portfolio.sqlite` |
| Logs | `<data>/logs/` |
| Metric engine and modules | `<data>/metrics/` |
| Claude CLI working directory | `<data>/claude-cli/` (mode 0700): every `claude -p` run starts there, never in a shared directory such as `/tmp`, and gets the system prompt in a 0600 file that is deleted after the request |
| Desktop switches | `<data>/desktop-settings.json` (`{ "closeToTray": bool }`), written by the service at start-up and when Settings → General → Close to tray changes; the shell reads it when the window closes |
| Built GUI | `Resources/app/gui`, next to the bundle's `service/` directory; from a checkout Vite serves the GUI |
| Sponsor pages | `sponsor.html` and `sponsor-light.html` next to the bundle; `extras/website/sponsor/` in a checkout |

The service runs "from source" when a parent directory of the code holds the workspace `package.json` (`REPO_ROOT`). That run counts as development: debug records are printed and `/api/app/info` reports `isDev`.

On the first start `src/bootstrap.ts` imports the data of releases before 0.6: when `<data>/portfolio.sqlite` is missing and `<old>/data/portfolio.sqlite` exists (`<old>` = `~/.config/portfolio` on Linux, the data directory itself on macOS and Windows), it checkpoints the old database, copies it to `<data>/portfolio.sqlite` and copies the other entries of the old directory, skipping SQLite `-wal`, `-shm` and `-journal` files. The old directory stays in place.

Build-time values are global constants that `bun build --define` bakes into the bundle (`modules/service/src/globals.d.ts`): `APP_VERSION` (without it: `version.txt` next to the bundle, then the root `package.json`) and `POSTHOG_API_KEY` (empty: telemetry stays off).

Everything the user can change lives in the `settings` table: one row per key, `key` and `value`, a string as is and other values as JSON (`modules/service/src/config.ts`, types in `modules/shared/src/config-types.ts`). A `config.json` from a release before 0.3 is imported once and renamed to `config.json.migrated`. `GET /api/config` never returns an API key: each stored key comes back as `SECRET_MASK`, and a request that carries `SECRET_MASK` uses the stored key. A stored key or token goes only to the server it was saved for (`isSameServer()`, scheme, host and port): a test or model list that names another LLM, Gotify or ntfy server gets no stored secret, and saving another server URL for one of them clears its stored key, so Settings asks for the key again.

## Access

- `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/login` and the sponsor frame are public; everything else needs the session cookie (`portfolio_session_<hash of the data directory>`, 7 days, `HttpOnly`, `SameSite=Strict`). The `sessions` table keeps the SHA-256 of each session id, so a copy of the database opens no session; ids stored raw by earlier releases are hashed on first use.
- Without a PIN the GUI logs in automatically. With a PIN (Settings → General) the lock screen asks for it; five wrong attempts lock for five minutes.
- On first run the lock screen asks to accept the Terms of Use. Until `POST /api/auth/accept-terms` records it (`auth:acceptedTermsAt` in `kv_entries`), a session may only call `/api/auth/me`, `/api/auth/accept-terms` and `/api/auth/logout`; everything else gets 403.
- The service always listens on `127.0.0.1` on a random port (`Bun.serve` with port 0) and prints `SERVICE_PORT=<port>` once to stdout; the desktop shell reads that line and polls `GET /api/health`.
- "Allow remote connections" (Settings → General, requires a PIN) starts a second listener on `0.0.0.0:<remote port>` that serves the same app (`modules/service/src/services/remote-access.ts`). The port is a setting next to the switch (default 5130). The switch and the port live in the `settings` table (`allowRemoteConnections`, `remotePort`), change only through `PATCH /api/host/remote-access` from a loopback client, and start, stop or rebind the listener without a restart. A port in use comes back as 409 and the old listener keeps running. Removing the PIN turns the switch off. Non-loopback clients get 403 while the LAN listener is off. A request on the LAN listener counts as remote even from this machine, so the routes reserved for the desktop window (remote access, backup, saving and revealing files, quit) refuse it. A `host-settings.json` from an earlier release is imported once and renamed to `host-settings.json.migrated`.
- Two transport checks run before any route (`modules/service/src/http/router.ts`, `main.ts`): a request that changes state (POST, PUT, PATCH, DELETE) with an `Origin` header must name this app, the request's own host and port (cookies ignore the port, so a page of another program on this machine is refused too; a development run also accepts the other loopback origins, for the Vite dev server), and the loopback listener answers only to a loopback `Host` header, which stops DNS rebinding from a web page. API responses are sent with `Cache-Control: no-store`. A request body may hold 30 MB (`Bun.serve` refuses a longer one; the login route reads 4 KiB at most). JSON bodies over 4 KiB are gzipped for a remote client that accepts it; the desktop window on loopback gets them as they are. Error messages are cut at 1,000 characters, and a 4xx answer to a request without a session is logged at debug level only.
- The desktop window runs sandboxed (the page gets no Electrobun bridge) and may navigate only to the app origin, the website (the Terms page iframe) and `blob:` downloads (`appNavigationRules()` in `modules/desktop/src/bun/index.ts`). A link the page opens in a new window goes to the system only as http, https or mailto (`external-url.ts`); on Linux the shell runs `xdg-open` with an argument list, never through a shell.
- The built GUI is served with a Content-Security-Policy (`src/http/static.ts`): scripts from the app plus the theme bootstrap of `index.html` by its hash, no connections or images from other servers, no plugins, no framing of the app. The sponsor banner is a separate document (`GET /api/app/sponsor/frame`, `services/sponsor.ts`) with a `sandbox` policy: it runs in an opaque origin, without the session cookie, the API or the app's DOM, and tells the overview its height and the links the user clicks through `postMessage`.
- `POST /api/app/backup` (loopback clients only) writes a `VACUUM INTO` copy of the database to the Downloads folder (`services/backup.ts`). The copy leaves out the market cache, which the app downloads again, and the sessions; it keeps the earnings call summaries. Files the service saves in Downloads are readable by the user only (mode 0600), and `POST /api/files/reveal` opens the file manager only on a path inside Downloads. `GET /api/auth/sessions` counts the live sessions and `POST /api/auth/sessions/revoke-others` ends every one but the caller's.

## Market data providers

Three providers supply market data: Financial Modeling Prep (FMP, `services/fmp.ts`, paid key), Yahoo Finance (`services/yahoo-finance.ts`, no key) and Finnhub (`services/finnhub.ts`, free key). The keys live in the `settings` table (`fmpApiKey`, `finnhubApiKey`) and are set in Settings → Data providers, where each key has a Test button (`POST /api/providers/fmp/test`, `/api/providers/finnhub/test`).

### Provider chain

`services/providers/chain.ts` picks the best data available. A chain gets a data category and one attempt per provider. It asks the provider the user picked for that category in `dataProviderRouting` first, then the other providers in the category's quality order (`CATEGORY_QUALITY_ORDER`): FMP, Yahoo, Finnhub, with Finnhub before Yahoo for news and fundamentals. It skips a provider without a key and treats null, an empty result or a throw as a miss.

- `firstAvailable()` returns the first non-empty value (a chart, a search, a news list).
- `fillByKey()` resolves symbol-keyed batches (quotes, FX rates). Each provider only gets the keys the providers before it did not supply.

Both return the provider of the data (`source`, or `sources` per key), so the GUI and the assistant can cite it. `MarketDataCoordinator` (`services/market-data.ts`) runs quotes, FX, charts, search and news through the chain; its `...WithSource` methods return the provider too. The default routing is FMP for every category. Without an FMP key the chain falls through to the providers the app used before.

Search takes ISIN and CUSIP queries (check digit validated, `providers/identifiers.ts`) to FMP first when a key is set.

### FMP client

`FmpService.get<T>(path, params, ttlMs)` is the single entry point for FMP calls. It:

- sends the key in the `apikey` header, so no URL or log carries it;
- caches each response in `market_cache` under `fmp:<path>?<sorted params>` for the TTL the caller passes (`FMP_TTL`: quotes 5 min, FX 15 min, end-of-day charts 1 h, news 30 min, calendars 12 h, profiles and fundamentals 24 h, ETF holdings 7 days);
- shares one in-flight request between identical callers;
- runs every call through one throttle (`FMP_THROTTLE`: 6 in flight, 300 a minute, a tenth of the plan limit) and pauses 30 s after HTTP 429;
- marks an endpoint outside the plan (HTTP 402 or 403, or a "Restricted" or "Premium" message) for 24 h in `market_cache` (`fmp:restricted:...`) and returns null, so the chain falls back;
- returns an expired cache entry when FMP fails for a transient reason (`marketCache.pruneExpired()` deletes entries 7 days after they expire, at start and hourly; the cached portfolios stay);
- asks for end-of-day charts from the first of the month and drops the earlier bars, so a chart's cache key changes once a month instead of every day;
- logs the endpoint path only, once per 10 minutes per kind of failure, and never a symbol, quantity or balance.

Batch endpoints (`/batch-quote`, `/market-capitalization-batch`) take 50 symbols a call and cache each symbol on its own (`fmp:quote:<SYMBOL>`). FMP sends no currency with a quote, so `resolveCurrency()` takes it from the symbol for FX and crypto pairs and from the company profile otherwise (`fmp:currency:<SYMBOL>`, 30 days). A symbol with no known currency is left to the next provider. `toFmpSymbol()` maps app symbols to FMP symbols (`BTC-USD` → `BTCUSD`, `EURUSD=X` → `EURUSD`). Settings → Data providers → Clear Market Cache also clears every `fmp:` entry, plan markers included.

### Adding a kind of data

1. Add a method for each provider that has the data. For FMP, write it in its own file on top of `fmp.get()` with a TTL from `FMP_TTL`. Return null or an empty result when the provider has no answer; do not throw for a missing symbol.
2. Resolve it through `firstAvailable()` or `fillByKey()` with one attempt per provider and `isAvailable: () => service.isConfigured()` for keyed providers. A category name outside `dataProviderRouting` (for example `"etfHoldings"`) uses the quality order alone; pass `order` to change it.
3. Keep the `source` with the data wherever the GUI or the assistant shows it.
4. Add a category to `DataProviderCategoryRouting` and to `CATEGORIES` in `DataProvidersSection.tsx` only when the user should choose its provider.

### Macro context, benchmarks and market hours

- `services/intel/macro.ts` `getMacroSnapshot()` (`GET /api/market/macro`): Treasury yield curve and a year of weekly history (FMP, then Yahoo `^IRX`, `^FVX`, `^TNX`, `^TYX`), US GDP, CPI, inflation, unemployment and fed funds (FMP), economic releases of the next 7 days in the base currency and USD plus high-impact major currencies (FMP), equity risk premium (FMP), sector day change (FMP snapshot, then the SPDR sector ETFs through the quotes chain) with sector P/E (FMP), and the risk-free rate (3-month yield, else 3%). Every piece carries its provider and is null when none had it. The Markets card on the overview shows it.
- `services/intel/benchmark.ts`: benchmark closes through the chart chain (FMP end-of-day, then Yahoo; `GET /api/market/benchmark`) and `getBenchmarkComparison()` (`GET /api/portfolios/:id/benchmark`). The performance chart draws the time-weighted return of the holdings against the benchmark in `benchmarkSymbol` (default S&P 500, "none" turns it off), with `relativePerformance()` from `portfolio-shared/benchmark`.
- `services/intel/market-hours.ts`: `isTradingDay()` and `isMarketOpen()` from FMP exchange hours and holidays, else a built-in table (session hours, weekdays, NYSE holiday rules, a few fixed European closures). Symbols map to exchanges by suffix. `GET /api/market/status` tells the GUI whether any market of the held symbols is open (15 minutes before the open to 45 after the close); the timed quotes refresh skips a run when none is. A manual refresh never checks.

### ETF look-through and exposure

- `services/intel/etf.ts` `EtfIntelService` resolves fund holdings, sector, country and asset-class weights and fund facts (FMP, then Yahoo), and the sector and country of single stocks (FMP, then Finnhub, then Yahoo).
- `services/exposure.ts` `ExposureService` (`GET /api/portfolios/:id/exposure`) weights the direct holdings and the fund data by market value. It returns sector, country and asset-class exposure, the largest underlying stocks, fund overlap, concentration warnings and the share it covers. Results stay in memory for 15 minutes. The Exposure card on the overview shows it.
- `getPortfolioExposureSummary()` and `formatExposureForPrompt()` give the AI features a percent-only summary.

### Calendars, income and event alerts

- `services/intel/calendar.ts` `CalendarService`: dividends (FMP, then Yahoo), splits (FMP, then Yahoo) and earnings (FMP, then Finnhub, then Yahoo) per symbol, cached for 12 hours.
- `services/income.ts` `IncomeService`: expected dividend income of the next 12 months, dividends received, yield on cost and current yield, split hints (`GET /api/portfolios/:id/income`), and the ex-dividend dates, pay dates, earnings and splits of held symbols (`GET /api/portfolios/:id/events?days=`). The Income card on the overview shows both. `describeIncomeForAssistant()` and `describeEventsForAssistant()` drop money amounts.
- `services/event-alerts.ts`: a daily push that names the held symbols that go ex-dividend or report earnings the next day. Each event is sent once (`db/sent-alerts.repo.ts`).

### Company intel

`services/intel/company.ts` resolves profile, analyst views, estimates, financial scores, DCF, TTM ratios, insider activity, press releases, news, peers and the latest earnings call, each through the chain (FMP first, Finnhub where it has the data). `GET /api/symbols/:symbol/intel?include=` returns the parts asked for. ETFs and funds get the profile and news only. The transcript routes return the latest call and an LLM summary, cached per quarter. The holdings table opens `HoldingIntelModal` with all of it. A full fetch costs up to 17 FMP calls per stock, so batch callers ask for a few parts and the largest holdings only.

### AI features

`services/ai-context.ts` feeds the data above to the language model. Every piece has a time limit and may be null; a section without data is left out. The text holds percentages, dates and public company data, never money amounts, quantities or balances.

- Weekly report (`portfolio-report.ts`): market news, macro snapshot, the week and one year against the benchmark, exposure after look-through, income and the events of the next 7 days, company intel for the largest holdings (profile, analyst, scores, ratios, news; 12 holdings with FMP, 6 with Finnhub alone, about 7,000 characters) and cached earnings call summaries of up to 3 stocks. A report never starts a new transcript summary. News, macro, events and summaries describe today, so a report for an older week leaves them out. `POST /api/portfolios/:id/reports/prompt` returns the exact prompt and its providers. The reports list leaves the stored prompts out; `GET /api/portfolios/:id/reports/:reportId/prompt` returns one.
- Weekly analysis (`weekly-analysis.ts`): the report above, and a push summary with the week against the benchmark, the 10-year yield move, the events of the next 7 days and exposure warnings.
- Suggestions (`portfolio-suggestions.ts`, `shared/suggestions.ts`): the model gets the weights in percent, public prices and the report market context, and answers with JSON target weights, a priority from 1 to 5 and validity rules (days, price range, weight range). The service drops proposals with unknown symbols, private holdings, misread weights or the wrong direction. A suggestion is keyed `action:SYMBOL`: a new generation updates an open one, skips a dismissed one until the weight moved 5 points, and marks the rest superseded. The GUI turns target weights into shares and money from live prices, ticks a suggestion when the weight is within the tolerance of the target, cancels it when a validity rule fails, and shows the target portfolio with cash taking the difference. A change to the transactions marks the list as outdated; the user starts the recalculation.
- Daily brief (`daily-brief.ts`): headlines of the largest movers through the news chain (FMP stock news, then Finnhub company news), and earnings, ex-dividend dates and splits of today and tomorrow. The scheduled brief skips a portfolio when none of its markets traded since the last brief and none trades today (`isTradingDay()`). "Send now" always runs.
- Assistant chat (`portfolio-chat.ts`): the LLM service has no tool calling, so the system prompt gets a short block with exposure, the events of the next 14 days, a macro headline and the 1-year benchmark line. `GET /api/portfolios/:id/assistant/system-prompt` shows it.
- Finnhub calls share one throttle (`FINNHUB_THROTTLE`: 4 in flight, 50 a minute, a 20 s pause after HTTP 429), so the fallbacks stay inside the free plan. Identical concurrent Finnhub calls share one request.
- Yahoo calls pause for 60 s after HTTP 429 (the second host is not tried) and serve the stale cached copy meanwhile; a failed cookie and crumb lookup is retried after a minute.

## Logging

The service and desktop write a consistent line layout (`renderFileLogLine` in `modules/shared/src/log-format.ts`):

```
2026-09-16T21:34:27.134Z  INFO   auth:pin                    PIN enabled
2026-09-16T21:34:27.152Z  INFO   host:remote-access          Remote connections allowed; listening on 0.0.0.0:5130  12ms  key=value
```

The service opens no log file. It prints every record to stdout in the file layout above (`modules/service/src/logger.ts`, `log-console.ts`), coloured when stdout is a terminal or when it runs from a checkout; debug records only from a checkout. The desktop shell appends that output, colour stripped, to `<data>/logs/service-YYYY-MM-DD.log`, one file per local day, and writes its own events to `desktop-YYYY-MM-DD.log` in the same directory. Every start on the same day appends to that day's file through one handle per file, opened with mode 0600 (`DailyLogWriter` in `modules/desktop/src/bun/service.ts`). A day's file stops at 20 MB with one "log capped" line, and daily files older than 14 days are deleted when the shell starts. Only the first `SERVICE_PORT=` line of a packaged run counts, and only at the start of a line, so logged text cannot move the window to another port. GUI events go to `POST /api/app/logs` and end up in the service file with source `gui`: the level must be a known one, source, step and data keys stay on one line, and the message is cut at 4,000 characters. Log lines name no ticker, ISIN, search query, quantity or balance; provider errors are logged by type and HTTP status. Support tickets bundle the service files of `<data>/logs` modified in the last 24 hours.

## Release

`scripts/release.sh` provides the release and packaging commands:

1. `release [minor|patch|major]` runs the end-to-end release: bumps the version (defaults to minor), updates package manifests, generates the changelog entry, commits, tags `vX.Y.Z`, pushes, builds all 3 OS packages locally in Docker, creates a GitHub release, and uploads all artifacts.
2. `build [linux|windows|macos ...]` produces packages in `dist/<version>/`. The packages are built locally inside Docker (`scripts/docker/Dockerfile.linux`):
   - Linux: `portfolio_<version>_amd64.deb` and `portfolio_<version>_linux-x64.tar.gz`
   - Windows: `portfolio_<version>_x64_setup.exe` and `portfolio_<version>_windows-x64_portable.zip`
   - macOS: `portfolio_<version>_universal.dmg` and `portfolio_<version>_macos-universal.zip`
   - `release` also uploads `SHA256SUMS` for the artifacts. The build scripts check the Electrobun runtime archives against pinned SHA-256 values, and the Docker build cannot read the git-ignored `.env` files.
3. `publish-website` writes `extras/website/releases/latest.json` (version, notes, file names, sizes, SHA-256 and GitHub Releases asset URLs) from `dist/<version>/` and deploys the website to Cloudflare Pages with `extras/website/deploy.sh`. Release packages are hosted directly on GitHub Releases, so the website never hosts heavy binaries.

The app checks `https://portfolio.cgeosoft.com/releases/latest.json` for updates and opens the installer URL in the browser. The website reads the same file for its download links. GitHub Releases hosts all release binaries.
