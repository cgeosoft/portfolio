# Changelog

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
