# TODO

Instructions for agents: verify the assertions, current code behavior, and existing implementations for each item before implementing it. Check relevant modules and test suites first to confirm the problem still exists and requires changes. Implement each task on its own develop/<task-slug> branch.

## Tasks

### Inbox

### Urgent

None open.

### High

- [ ] [T] [Check the Oct 10 user fixes in the app](#check-the-oct-10-user-fixes-in-the-app)

### Medium

- [ ] [F] [Translate the screens left in English](#translate-the-screens-left-in-english)
- [ ] [B] [PDF reports in non-Latin scripts](#pdf-reports-in-non-latin-scripts)

### Low

None open.

### Postponed

None open.

### Implemented

- [x] [F] Interface in 41 languages: `lang/<code>.yml` (English source and fallback), `t()` in the GUI with the language loaded before the first render (a switch saves and reloads), a Language setting in Settings → Appearance with the AI support tier of each language, LLM reports, chat, briefs and suggestions written in the chosen language, translated push notifications; `scripts/check-lang.ts` checks keys, placeholders and plurals
- [x] [B] Privacy mode masks transaction quantities ("[BUY] •••• NVDA") and share or unit counts in the system prompt, prompt previews, chat and reports
- [x] [B] Charts keep their size when the app starts at a saved zoom other than 100%: Chart.js measures the container in CSS pixels, as its resizes do
- [x] [B] Analyze with AI uses the stored LLM key: the report stream route unmasks the key and the modal no longer sends the masked one
- [x] [B] Trade Republic imports: a stock perk is a cash credit (no double cost), every transaction type moves cash (card payments, manual transfers), a negative tax is a refund, rows sort by datetime, cash is kept per currency; a failed FX pair is left out and not cached as 1; holdings show "no quote" and "no FX" marks
- [x] [B] Privacy mode masks the allocation chart (centre total, tooltip amounts, share counts), the assistant chat and system prompt, and the report prompt preview; percentages stay visible
- [x] [B] Deleting the last portfolio clears its state and replaces it with an empty Main Portfolio; the same broker transaction ids import into two portfolios (scoped ids)
- [x] [B] Temperature left out for models that reject it (Claude Opus 4.7 and later, OpenAI reasoning models, which also get `max_completion_tokens`); a 400 naming the field retries once without it and remembers the answer
- [x] [B] A stored ETF class keeps a holding an ETF (only FUND mapped before, so SPY, QQQ and VWCE.DE showed as Stock); the Yahoo chart instrument type refines a Stock or missing class; the Yahoo session warning names the network error code
- [x] [B] Company intel gives a reason per missing part (no key, rejected key, plan restriction, failed, no data, not applicable); private holdings skip the lookup; the FMP key test lists the data the plan does not include
- [x] [F] ISINs resolve to tickers on import (stored `symbol_map`, then provider search, home listing first); a resolve button for older imports and a pencil to set the symbol by hand
- [x] [F] Text size select in Settings → General, bound to the interface zoom; the saved zoom applies on startup
- [x] [F] Instrument references open the holding: report and chat Markdown, exposure, income, allocation chart slices, the holdings table; the LLM context names instruments as `SYMBOL (Name)`
- [x] [T] Service typecheck and the provider chain test fixed (both failed before these changes)
- [x] [B] Two instances on 127.0.0.1 no longer replace each other's session: the cookie name carries a hash of the data directory (the old name moves over once), and a lost session without a PIN logs in again instead of showing the PIN screen
- [x] [F] Price or NAV for private holdings: a "set NAV" control on the holdings row stores a price per portfolio and symbol (`manual_prices`) that replaces the buy price, converted to the base currency, from the day it was set

## Check the Oct 10 user fixes in the app

```
type: task
importance: high
```

The nine fixes above were checked by typecheck and the test suite (228 tests) only, never in the running app. To check by eye (`bun start`):

- Analyze with AI with a Claude and a Groq key; a model such as claude-opus-4.7 over OpenAI-compatible, in Test assistant, chat and Analyze.
- A fresh Trade Republic import (`.tmp/Transaction export.csv`): the cash balance and total against the TR app, the "no quote" and "no FX" marks, the tickers found for the ISINs, the resolve button and the pencil for a holding left as an ISIN.
- Privacy mode (Ctrl+H): the allocation chart centre and tooltips, the assistant messages and system prompt, the Analyze prompt preview.
- Deleting the only portfolio: the screen clears and Main Portfolio appears.
- A private holding (SpaceX) and a stock on a free FMP plan: the wording of each missing part; the FMP key test message.
- Settings → General → Text size; the zoom kept across a restart.
- Clicking a symbol, ISIN or name in a report, a chat answer, the exposure and income cards, and an allocation chart slice.

## Translate the screens left in English

```
type: feature
importance: medium
```

Multilingual skipped the files other sessions were editing at the time; their text is still English:

- `App.tsx`, `api.ts`, `rpc.ts` (client-side errors and toasts).
- `LockScreen.tsx`, `BrandScreen.tsx`, `SetupWizardPage.tsx`: add a language step to the setup with `LanguageSelect` and `LanguageTierNote` (`components/common/LanguageSelect.tsx`), saved with `api.saveConfig({ language })` and `switchLanguage()`.
- `ImportCsvPage.tsx`, `AssistantSection.tsx`, `TestLlmModal.tsx`.
- Call `adoptConfigLanguage(config.language)` from `gui/src/i18n.ts` once App loads the config, so a new browser on the network starts in the saved language.
- `routes.ts`: send `testNotification("gotify" | "ntfy")` from `services/notify.ts` for the Gotify and ntfy test messages (the `service.testNotification.*` keys exist).

Add the new keys to `lang/en.yml` and every other language; `bun run scripts/check-lang.ts` lists what is missing.

## PDF reports in non-Latin scripts

```
type: bug
importance: medium
```

The PDF export (`report-export.ts`, jsPDF) uses the built-in Helvetica and Courier, which cannot draw Greek, Cyrillic, Arabic, Hebrew, CJK or Indic text. Report bodies in those languages and the translated PDF labels come out garbled. Embed a Unicode font (for example Noto Sans subsets) for those scripts, and handle right-to-left text.
