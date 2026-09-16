# Changelog

## [0.4.0] - 2026-09-16

- 9d65a78 Rework release pipeline for local builds


## [0.3.1] - 2026-09-16

- 735c868 Remove cross-project references to Assistant across codebase and documentation
- 86cd101 Restore brand pink accent color and clean up settings presentation across GUI
- bb7cede Redesign desktop shell splash and error pages and harmonize app description
- e97d456 Switch to daily log files and write development logs to workspace logs directory
- 0759be9 Align marketing website layout and styles with Assistant and update metrics site generator
- 899e0e4 Release script with Docker Linux builder, website release manifest, docs and skills for the module layout
- 7121a35 Restructure into modules: pure Bun service with HTTP API, Vite GUI, thin Electrobun shell
- b3c6827 Consolidate agent config: condensed AGENTS.md, uniform skills


## [0.3.0] - Unreleased
### Changed
- Split the app into `modules/service` (pure Bun HTTP service with `bun:sqlite`), `modules/gui` (Vite build served by the service), `modules/desktop` (Electrobun shell that spawns the service) and `modules/shared`; the GUI talks to the service over HTTP instead of the Electrobun RPC bridge.
- Settings moved from `config.json` to the `config` table of the database; an existing `config.json` is imported on first start. No `.env` file is read at runtime.
- Menu bar, footer, lock screen, colour tokens and self-hosted fonts.
- One log file per day, `service-YYYY-MM-DD.log`, with a structured line layout; `<workspace>/logs` in development, the per-user log directory in production.
- Updates and website download links come from `releases/latest.json` on the website; the release script builds Linux packages in Docker and publishes to Cloudflare Pages. GitHub Actions removed.
### Added
- Settings → Access: app lock PIN and "Allow remote connections" so phones on the LAN can open Portfolio.

## [0.2.3] - 2026-09-13

### Added
- Added a button to regenerate the assistant's response in the chat.


## [0.2.2] - 2026-09-13

- 37a8301 Update package descriptions and asset naming
- 35a4780 Resolve download links from latest GitHub release


## [0.2.1] - 2026-09-13

### Fixed
- Improved validation of metric entry paths during build.


## [0.2.0] - 2026-09-11

### Added
- Added metric modules to the release build.


## [0.1.7] - 2026-09-11

- 9656fd1 Simplify stream footer text
- 016946e Isolate per-provider base URLs, API keys, and models in settings
- a81f6f7 Add OpenAI-compatible and Nebius Token Factory inference providers
- ce853fb feat(providers): add data providers settings tab and category routing
- 96ad112 Fix assistant sidebar left padding and transition alignment
- a510801 refactor(ui): remove nested boxes in settings general, support, and about
- dd1b2b7 feat: implement Finnhub API for report market intelligence
- 31df2b0 Redesign assistant panel with in-place history and contextual grounding
- a27397d feat(ui): move portfolio select to front of main menu with separator
- c08ff03 Rename Portfolio Desktop to Portfolio
- 4e40f97 chore(website): add the screenshot asset referenced by the README and website
- 2fd0b55 fix(ui): drop the doubled plus sign on holdings gain percentages
- 6a06db3 refactor(logging): route service console output through appLogger
- 1b83efb feat(logging): render console logs with aligned columns, colour and key=value metadata
- cbf8d91 feat(metrics): run metrics as sandboxed WASM modules with a Metrics tab and marketplace
- 0914a2a Add annotated app screenshot to website and README
- 3bf4e3b feat(assistant): let the user inspect the portfolio system prompt
- 751b7b4 feat(ui): render dropdowns as a custom listbox instead of a native select
- 1093cd1 fix(llm): keep the answer that follows a model's thinking block
- 72a5c83 refactor(llm): share local inference defaults and detect the llama.cpp model
- ad2d3a4 chore(gitignore): ignore the local tmp/ scratch directory
- 548869e feat(ui): unify all dropdowns with a shared design system
- 3e04061 Replace changelog renderer with ReactMarkdown
- e72051a Refactor changelog generation to render JSON notes


## [Unreleased]

### Added
- Metrics are now sandboxed WebAssembly modules with a YAML manifest that declares the developer, version, and data scopes. They run in a separate engine process with no I/O, a memory ceiling, and a time budget.
- Added a top-level Metrics tab with the dashboard slots (4 large, 6 compact), every metric added to the portfolio, and a marketplace built from `extras/metrics/repository.yml`.
- Added install-from-URL for third-party metrics, with a scope consent dialog, size and SHA-256 checks, and a permanent UNVERIFIED badge.
- Added `extras/metrics/` with the ten built-in metrics as AssemblyScript sources, a starter template, a generated SDK, and a contributor guide.
- Added a public metrics catalog page to the website, generated from the repository.
- Added a CI workflow that validates manifests, builds every module, and runs them against a fixture portfolio.

### Changed
- The metrics page moved from Preferences to the Metrics tab. `#settings/metrics` links forward to `#metrics`.
- Stored metric selections migrate from `{key, enabled, size}` to `{id, added, slot, order}` without loss.

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
- Added an update popover in the bottom right corner of the app. It shows a changelog modal and provides download support for new versions.
- Added opt-in analytics to the website using PostHog. Users can choose to enable analytics.

## [0.1.3] - 2026-09-08

- 8cc1e22 chore: add agent skills and treat generated stylesheet as generated
- 9ae8342 docs(env): document OPENAI_* release changelog variables
- 878de1d ci(release): use committed changelog section as release description
- d66c4f1 feat(release): generate changelog entry during tag release
- 1ba1e6b feat(scripts): generate release changelog with OpenAI-compatible model
- d21a583 deps: add rehype-sanitize for LLM markdown output safety
- f790d56 fix: harden LLM-rendered markdown with rehype-sanitize and link protections
- 7041a16 fix: add periodic eviction of expired in-memory FX and chart caches
- b6c793f fix: block non-HTTP URL schemes in openExternalUrl RPC handler
- b2a70e5 fix: replace ReDoS-vulnerable think-tag regex with O(n) state machine
- c4c9fe8 fix(settings): remove hardcoded model lists for local server providers
- 25aff9f fix(settings): list llama.cpp and ollama models from server endpoint
