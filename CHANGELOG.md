# Changelog

All notable changes to Portfolio Desktop are documented in this file.

## [0.1.5] - 2026-09-10

# Release Notes for Portfolio Desktop v0.1.5

## Added
- Added a metrics marketplace for each portfolio on the overview page.

## Changed
- Improved the display of metric importance as a plain paragraph.

## Fixed
- Calmed the metrics marketplace cards.
- Fixed changelog generation to prepend new entries.


All notable changes to Portfolio Desktop are documented in this file.

## [0.1.4] - 2026-09-08

## Added
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
