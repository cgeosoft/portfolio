# TODO

Instructions for agents: verify the assertions, current code behavior, and existing implementations for each item before implementing it. Check relevant modules and test suites first to confirm the problem still exists and requires changes.

## Tasks

### Inbox

- [ ] [T] Two dev instances on 127.0.0.1 share the session cookie (cookies ignore the port): the second login logs the first out and it shows the PIN screen

### Urgent

None open.

### High

- [ ] [T] [Check the Oct 10 user fixes in the app](#check-the-oct-10-user-fixes-in-the-app)

### Medium

None open.

### Low

- [ ] [F] [Price or NAV for private holdings](#price-or-nav-for-private-holdings)

### Postponed

None open.

### Implemented

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

## Price or NAV for private holdings

```
type: feature
importance: low
```

Private market funds (Trade Republic `PRIVATE_MARKET_BUY`) and private companies have no public quote, so `buildPortfolioData` values them at cost, while TR shows the fund's NAV. Let the user enter a current price or NAV per private holding, stored on the service, and use it in place of the buy price.
