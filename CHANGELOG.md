# Changelog

## [0.12.0] - 2026-10-12

### Changed
- Hardened the service, GUI and desktop shell after a security and performance review
- State-changing requests now check the host and port, and only accept other loopback origins in development
- Request bodies are now streamed with a size limit, and error messages are bounded
- Tightened the GUI content security policy to block outside images, connections and framing
- LLM and provider text is now rendered through a safer markdown renderer
- The sponsor banner is now served as a sandboxed document
- The desktop shell now validates new-window URLs and opens links more safely
- Loopback clients no longer use gzip compression
- Hardened the metric runtime, installer and manifest validation
- Added security headers to the website
- The portfolio summary now converts each holding's cost using the correct trade currency rate instead of a single rate
- The portfolio history now converts cost to the base currency correctly for trades in another currency
- Holdings bought before their price chart's start now show their cost correctly instead of an incorrect older price
- The Linux build now installs Bun from a checksum verified release package instead of an unverified script
- The Linux build now always uses the baseline Bun build on amd64

### Fixed
- Fixed incorrect cost and gain values in the summary for holdings traded in multiple currencies
- Fixed incorrect cost, gain and return values in the portfolio history for trades in a non base currency
- Fixed incorrect valuation in the all time chart for holdings bought before their price chart's data started


## [0.11.0] - 2026-10-12

### Added
- Added a new Suggestions page with actionable rebalancing ideas
- The app suggests target weights for your portfolio based on current prices, without using your account amounts
- Each suggestion shows the target shares and money value calculated from live prices
- Suggestions automatically tick as done when their target weight is reached
- Suggestions are automatically cancelled if a validity rule fails
- The page shows a target portfolio view with cash covering the remaining difference
- Added a menu entry and header link to open the Suggestions page

### Changed
- New suggestions update existing open ones instead of duplicating them
- Dismissed suggestions are skipped unless the weight has moved by at least 5 points
- Older suggestions are replaced by newer ones when a new list is generated
- The suggestions list is marked as outdated after a transaction change, and the user must manually recalculate it


## [0.10.0] - 2026-10-10

### Added
- A boot loader screen shows while the first screen loads its data, so there is no blank page.
- You can add a manual price or NAV for private holdings.
- A pencil button lets you set a holding's ticker by hand, and a Find tickers button resolves ISIN only holdings to tickers.
- Importing Trade Republic files now looks up tickers for ISINs automatically using stored mappings and provider search.
- Clicking an instrument name, symbol or ISIN in reports, chat or tables now opens that holding's details.
- A Text size setting in Settings General changes the interface zoom from Small to Largest.
- The holding details modal now explains the exact reason a piece of company data is missing.

### Changed
- Each data directory now gets its own session cookie, so running two instances on the same address no longer logs you out of each other.
- The assistant and daily brief no longer include share quantities for recent transactions, only the type and ticker.
- Charts now size correctly in pixels when the app starts already zoomed.
- The saved ETF class for a holding is kept instead of being recalculated.
- Cash balance is now computed from the full transaction history instead of being estimated from deposits and holding costs, so Trade Republic imports match better.
- Transactions on the same day are now sorted by their exact time.
- A failed currency conversion no longer gets stuck at a rate of 1, so it can be corrected on the next refresh.
- Deleting a portfolio now clears its holdings, transactions and reports from the screen and from storage.
- Importing the same broker file into a second portfolio no longer fails, duplicate transaction ids are kept separate per portfolio.
- Newer AI models that reject a temperature setting are now detected automatically and the request adjusts to work with them.
- The Analyze with AI feature now uses your saved API key instead of a placeholder, so it works correctly.
- The intro and boot loader screens are each shown for two seconds before the dashboard appears.

### Fixed
- Transaction quantities are now hidden in privacy mode.
- Amounts in the allocation chart, prompt preview and assistant chat are now hidden in privacy mode.
- The saved zoom level is now applied again when the app starts.
- Fixed some internal test failures related to market data and provider selection.


## [0.9.1] - 2026-10-10

### Changed
- The public website was redesigned to match the app's own look, with a dark theme, rounded cards, and pink accents.
- The website home page now shows an animated demo portfolio chart and rotating assistant suggestion examples.
- The website now has sections explaining what data stays on your device and what leaves it, plus a feature list and a downloads table.
- The website now reads the latest release info from GitHub, falling back to the local file if that is not available.
- The CSV import dialog now keeps a fixed height instead of resizing as you move through its steps.

### Fixed
- The CSV import dialog no longer jumps around in size during import.


## [0.9.0] - 2026-10-09

### Added
- Added a short vendor intro animation on the starting page before the dashboard loads, skipped when reduced motion is on.
- Added a way to preview the intro animation separately for design review.
- The development build can now be opened from other devices on the network for hot reloading GUI access.
- Added Markets, Exposure and Income cards to the overview.
- Added a toaster for notifications.
- Added a setting to hide sponsor banners.
- Added shared market context used by reports, briefs and chat, covering exposure, dividend income, upcoming events, macro data, benchmark comparison and company information.
- Added a Markets card showing yield curve, economic indicators, economic calendar, risk premiums and sector performance.
- Added a performance chart comparing the portfolio against a chosen benchmark over a chosen time range.
- Added a market status check that reports whether any exchange of held symbols is open.
- Added a holding details view with company profile, analyst views, estimates, scores, valuation, ratios, insider activity, news and peers.
- Added earnings call transcript summaries for holdings, generated by the configured assistant and cached.
- Added daily alerts for upcoming ex-dividend dates and earnings, sent once through configured notification channels.
- Added automation settings to choose the alert time and portfolio.
- Added portfolio exposure look-through showing sector, country, asset class and underlying stocks, with fund overlap and concentration warnings.
- Added an income view showing expected and received dividends, yields, a 12-month calendar, split hints and upcoming key dates.
- Added a metric library listing all available metrics in settings.
- Added a metric picker to place a metric on a chosen dashboard slot.
- Added an assistant feature that can suggest a dashboard layout for the portfolio, pending user confirmation.
- Added seven new bundled metrics: portfolio beta, portfolio P/E, dividend yield, analyst upside, DCF upside, quality score and distress exposure.
- Added company fundamentals data to metrics for held symbols.
- Added Financial Modeling Prep as a new market data provider.
- Added a Data Providers settings page with API key entry, connection test and routing per data category.
- Added documentation describing the data providers and the features built on them.

### Changed
- Moved the portfolio picker, privacy toggle and quotes refresh into the status bar.
- Timed quote refresh now skips runs when every market of the holdings is closed.
- Grouped assistant, data providers and notification channel settings under an Integrations section.
- Catalog settings now apply without needing a reload.
- Replaced the metric marketplace with a metric library and picker, keeping each slotted metric in its place when another is removed.
- The analyze dialog now names the data providers behind the context it uses.
- Market data requests now route automatically between providers in quality order, falling back when one lacks a key or data.
- Website headings now use the Sansation font.
- Improved the metrics page on the website.

### Fixed
- Fixed a technical issue with the income chart type.


## [0.8.2] - 2026-10-09

### Fixed
- Day change for holdings and portfolios now uses the correct previous close instead of a one-year-old value.
- Allocation breakdown in chat and reports now includes a Private & Other category instead of leaving it out.
- Mutual funds are now counted under ETFs & Funds instead of under stocks.
- Holdings without a market price are now clearly labeled as valued at buy price in chat and reports.
- Chat now shows the ten most recent transactions instead of the ten oldest.


## [0.8.1] - 2026-09-29

- a88bc50 Show each start-up step on the starting page
- 3ca93de Put the menu bar and status bar flush with the window edges


## [0.8.0] - 2026-09-29

- 28ae343 chore(release): v0.7.1
- 0276a41 Harden the HTTP layer, speed up settings and imports, add backup and session controls
- a2ced78 Point the metrics site at Preferences, Metrics
- 061e25f Update the website copy for the assistant, automations and remote access


## [0.7.1] - 2026-09-29

### Added
- Added a Backup block in Preferences, About that saves a copy of the database to the Downloads folder.
- Added a Signed-in devices row in Preferences, General that shows the open sessions and signs out every device but the current one.

### Changed
- Large API responses are gzipped for clients that accept it, so a phone on the network loads the portfolio faster.
- Settings are read from memory between changes instead of from the database on every call.
- A CSV import writes its updates in one database transaction, and the database no longer waits for the disk on every commit.
- The ledger has an index on portfolio and date, which is how it is always read.
- Changing a portfolio now drops its cached market data on disk as well as in memory, so a reopened app never shows the state before the change.

### Fixed
- Deleting a transaction now checks that it belongs to the portfolio of the request.
- Clearing the market cache also clears the cached portfolio data, so the next load is recomputed.
- A malformed URL no longer answers with a 500 from the static file server.

### Security
- The service rejects state-changing requests from another web origin and requests to the desktop listener with a foreign Host header (DNS rebinding).
- API responses carry Cache-Control: no-store, so a shared browser keeps no balances.
- The sponsor banner route only fetches pages on the Portfolio website.
- Settings updates are limited to known keys.
- Service logs no longer contain tickers, portfolio names or balances.

## [0.7.0] - 2026-09-28

### Added
- Added Gotify and ntfy push notification channels that can send messages to your phone.
- Added an Integrations section in Preferences to set up Gotify and ntfy, with a test button for each.
- Added an Automation section in Preferences to control a daily brief and a weekly analysis.
- Added a scheduled daily brief that writes a short overview of the last trading session and sends it to your notification channels.
- Added a scheduled weekly analysis that writes a weekly report for each portfolio and sends a summary to your notification channels.
- Added a Run now option to send the daily brief or weekly analysis immediately.
- Added a privacy note explaining what the assistant sees and that notifications never include money amounts.
- Added submenus to sidebar sections that have more than one card.

### Changed
- Preferences sidebar now supports sections with multiple cards and animated submenus.
- Sidebar accent color now uses a shared color setting instead of a fixed color.
- Missed daily briefs or weekly analyses are caught up automatically the next time the service runs.


## [0.6.0] - 2026-09-25

### Added
- Added a Claude CLI option as an AI assistant provider.
- Added a marketplace for browsing and installing metrics.
- Added a close to tray option for the desktop app.
- Added a setting to allow remote connections with a custom port.

### Changed
- Moved Metrics from a top level tab into a Preferences section.
- Moved the Report an Issue form into its own window, opened from the Help menu or the About section.
- Moved the app lock and remote connection settings into the General settings section.
- Moved the portfolio switcher into the menu bar.
- Merged data provider settings into the Assistant settings section.
- Made all page headers look the same across the app.
- Changed how settings fields like model, server URL, and API keys are saved. They now save when you finish typing instead of on every keystroke.
- Made the app title use consistent capitalization.

### Fixed
- Fixed Ctrl+R so the app only reloads after you release the keys.

### Security
- API keys are now hidden when shown in settings.


## [0.5.1] - 2026-09-17

### Added
- GUI selections are now persisted across restarts.

### Changed
- Added a vertical divider before the assistant in the main menu.
- Added a lock label to the lock button in the top menu.
- Moved the privacy button to the top menu, to the left of the lock button.


## [0.5.0] - 2026-09-17

### Added
- Added Terms of Use acceptance on first run.
- Added a light theme option.
- Added a lock screen feature with 6-digit PIN input.
- Added a sponsor banner that adapts to the selected theme.

### Changed
- Updated the user interface to use semantic theme tokens.
- Refined light mode styling across the application.
- Reworked the LLM client for improved performance and reliability.
- Updated the website and screenshot asset.

### Fixed
- Fixed website cache key and reduced TTL.

## [0.4.0] - 2026-09-16

### Added
- Added packaging scripts and configuration for macOS (.dmg, .zip) and Windows (.exe setup, .zip portable).

### Changed
- Reworked the release pipeline to build Linux, Windows, and macOS packages locally in Docker.
- Updated update resolution to download binaries directly from GitHub Releases.
- Streamlined the marketing website to serve the release manifest.

### Fixed
- Fixed release artifact packaging and permissions.

## [0.3.1] - 2026-09-16

### Added
- Added app lock PIN and "Allow remote connections" in Settings → Access so devices on the LAN can open Portfolio.
- Added Docker Linux builder and local packaging orchestrator.

### Changed
- Split the application into modules: `modules/service` (pure Bun HTTP service with `bun:sqlite`), `modules/gui` (Vite build served by the service), `modules/desktop` (Electrobun shell that spawns the service) and `modules/shared`.
- Replaced Electrobun RPC bridge with HTTP API communication between GUI and service.
- Migrated settings from `config.json` to the database `config` table.
- Redesigned desktop shell splash and error pages, restored brand pink accent, and refreshed menu bar, footer, and self-hosted fonts.
- Switched to daily log files (`service-YYYY-MM-DD.log`) with structured layout.
- Updates and website download links resolve from `releases/latest.json`.

### Removed
- Removed cross-project references to Assistant across codebase and documentation.

## [0.2.3] - 2026-09-13

### Added
- Added a button to regenerate the assistant's response in the chat.

## [0.2.2] - 2026-09-13

### Added
- Added latest GitHub release resolution for update checks.

### Changed
- Release assets are named deterministically per platform.
- Website deploy script targets the production domain.

### Fixed
- Fixed download links to derive from the latest release instead of a hardcoded version.
- Added fallback to the releases page when resolving update downloads.

## [0.2.1] - 2026-09-13

### Fixed
- Improved validation of metric entry paths during build.

## [0.2.0] - 2026-09-11

### Added
- Added metric modules to the release build.
- Metrics are sandboxed WebAssembly modules with a YAML manifest that declares the developer, version, and data scopes, running in a separate engine process.
- Added a top-level Metrics tab with dashboard slots and a marketplace built from `extras/metrics/repository.yml`.
- Added install-from-URL for third-party metrics with scope consent dialog, size and SHA-256 validation.
- Added `extras/metrics/` with ten built-in metrics as AssemblyScript sources, starter template, and generated SDK.

### Changed
- The metrics page moved from Preferences to the dedicated Metrics tab.
- Stored metric selections migrate to slot-based configuration without data loss.

## [0.1.7] - 2026-09-11

### Added
- Added OpenAI-compatible and Nebius Token Factory inference providers.
- Added data providers settings tab with category routing.
- Added Finnhub API integration for market intelligence in reports.
- Added Metrics tab and sandboxed WebAssembly execution.
- Added ability to inspect the portfolio system prompt in the assistant.
- Added unified custom dropdown design system replacing native selects.
- Added Markdown changelog renderer with ReactMarkdown.

### Changed
- Simplified stream footer text.
- Isolated per-provider base URLs, API keys, and models in settings.
- Redesigned assistant panel with in-place history and contextual grounding.
- Moved portfolio select to front of main menu with separator.
- Renamed Portfolio Desktop to Portfolio.
- Enhanced logging with aligned columns, colour, and structured metadata.

### Fixed
- Fixed assistant sidebar left padding and transition alignment.
- Fixed doubled plus sign on holdings gain percentages.
- Fixed keeping the model response following a thinking block.
- Fixed missing screenshot asset in website and README.

## [0.1.6] - 2026-09-10

### Changed
- Sponsor banner now uses the contact email from the WEBPAGE_EMAIL environment variable.
- The About dialog has been integrated into the Settings About section.
- Build and release scripts now require WEBPAGE_URL, WEBPAGE_EMAIL and POSTHOG_API_KEY.

## [0.1.5] - 2026-09-10

### Added
- Added a metrics marketplace for each portfolio on the overview page.

### Changed
- Improved the display of metric importance as a plain paragraph.

### Fixed
- Calmed the metrics marketplace cards.
- Fixed changelog generation to prepend new entries.

## [0.1.4] - 2026-09-08

### Added
- Added an update popover in the bottom right corner of the app with changelog modal and download support.
- Added opt-in analytics to the website using PostHog.

## [0.1.3] - 2026-09-08

### Added
- Added agent skills and documented release changelog variables.
- Added automated release changelog generation with OpenAI-compatible models.

### Changed
- Settings fetch available models from server for llama.cpp and ollama providers.

### Fixed
- Added periodic eviction of expired in-memory FX and chart caches.

### Security
- Hardened LLM-rendered markdown with rehype-sanitize and link protections.
- Blocked non-HTTP URL schemes in external URL opener.
- Replaced ReDoS-vulnerable think-tag regex with O(n) state machine.

## [0.1.2] - 2026-09-07

### Added
- Added environment-aware loading for terms and sponsorship content.

## [0.1.1] - 2026-09-07

### Added
- Added 4-step wizard for portfolio report generation with week selection and markdown prompt preview.
- Added prompt inspection to view LLM prompt used for portfolio reports.
- Added zoom controls to View menu with keyboard shortcuts and persistence.
- Added report download modal and sidebar commands box.
- Added dynamic latest version downloads and GitHub releases notice to website.

### Changed
- Updated report view layout.

## [0.1.0] - 2026-09-07

### Added
- Initial release of Portfolio desktop application.
- Offline-first investment tracking with portfolio management and market data.
- Built-in assistant chat and report generation.
- Automated release packaging and support ticket generation.
