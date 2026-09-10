# Changelog

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
