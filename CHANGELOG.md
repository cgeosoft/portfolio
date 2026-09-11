# Changelog

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
