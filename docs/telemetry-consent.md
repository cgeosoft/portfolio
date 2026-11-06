# Telemetry and consent plan

Standard: /mnt/files/NoteBook/CGEO/SOFT/App Telemetry and Consent.md
Standard reviewed: 2026-11-06

Status: approved on 2026-11-06. The code and the public text are implemented. The vendor tasks are open. The "Current state" and "Gaps" sections show the state before this work.

## Current state

### App

- One setting, `telemetryEnabled`, defaults to false (`modules/service/src/config.ts:24`).
- The PostHog client exists only with the setting on and a build key (`modules/service/src/services/telemetry.ts:24`).
- Events use `deviceId`, a persistent random UUID, as `distinctId`.
- The service only logs uncaught errors (`modules/service/src/main.ts`). The GUI `ErrorBoundary` only writes to the console.
- No error data reaches PostHog from the app. The project shows no `$exception` event in the last 30 days.
- No consent record exists. `auth:acceptedTermsAt` covers the Terms only, with no version.

### PostHog project

Read from project `portfolio` (265321) on 2026-11-06:

| Setting | Value | Problem |
| --- | --- | --- |
| Host | `eu.i.posthog.com` | None |
| Plan | Paid, existing plan | The limit is 7 years, so old events can stay for a long time |
| `anonymize_ips` | `false` | PostHog stores client IP addresses on new events |
| `session_recording_opt_in` | `true` | The website turns recording off in code. The project should match |
| `capture_console_log_opt_in` | `true` | Breaks rule 14 |
| `autocapture_exceptions_opt_in` | `true` | Breaks rule 25 for the website |
| `heatmaps_opt_in` | `true` | Breaks rule 14 |
| `capture_dead_clicks` | `true` | Breaks rule 14, and it is live |

Events seen in the last 30 days: `$pageview`, `download_clicked`, `app_launched`, `assistant_chat_sent`, `$dead_click`, `$dead_swipe`, `report_generated`, `screenshot_zoomed`.

The website promises page views and download clicks only. `$dead_click` and `$dead_swipe` are not in that promise.

The project settings do not show whether the DPA is signed. Christos must check it.

## Outbound connections

### Desktop app

| Host | When | What |
| --- | --- | --- |
| `query1` and `query2.finance.yahoo.com`, `fc.yahoo.com` | Default on, every 15 minutes | Ticker symbols |
| `finnhub.io` | With a key | Ticker symbols |
| `financialmodelingprep.com` | With a key | Ticker symbols |
| OpenAI, Anthropic, Google, Groq, DeepSeek, Nebius, OpenRouter, or a custom URL | With a provider, on request | Weights, percentages, tickers |
| Claude and Codex CLIs | If chosen | The same data, sent by that CLI |
| `openrouter.ai` key exchange | On connect | Sign-in exchange |
| `api.github.com`, `github.com` | Default on, hourly | Update check and download |
| `portfolio.cgeosoft.com/releases/latest.json` | Default on, hourly | Update check |
| ntfy or Gotify | If switched on | Briefs |
| `eu.i.posthog.com` | Opt-in | Analytics |

### Website

| Host | When | What |
| --- | --- | --- |
| `eu-assets.i.posthog.com`, `eu.i.posthog.com` | After consent | PostHog script and events |
| `api.github.com` | From `script.js` | Latest release data |

## False or incomplete public claims

| Location | Claim | Fix |
| --- | --- | --- |
| Terms section 3 | "Anonymous product telemetry", "anonymous interaction counters only" | New text from the standard |
| Terms section 3 | "offline-first", with no list of outbound data | Link to the Notice |
| Terms section 10 | "anonymous, aggregated", "only an anonymous identifier", no "other personal data" | Describe the random ID and the IP |
| Terms section 10 | The app "stays fully offline" | Remove |
| Terms section 11 | Only GitHub issues as contact | Add christos@cgeosoft.com |
| Terms sections 3 and 11 | No controller | Name Christos Georgiou, or link the Notice |
| Website cookie banner (`script.js`) | "anonymous page views and download clicks. No personal data." | Say "a random ID" |
| Website "Leaves, and only this" | Omits updates, analytics and error reports | Add them |
| `tour/index.html` | "offline investment tracker" | Use "local" or "on your computer" |
| `README.md` lines 28 and 29 | "Anonymous", no "personal identifiers", "3-step" | Rewrite |
| `lang/en.yml` setup | "Anonymous Analytics", "Enable Anonymous Telemetry" | New text |
| `lang/en.yml` setup guarantee | No "personal identities" are ever sent | New text |
| `lang/en.yml` settings | "Share anonymous usage statistics" | New text |
| `lang/en.yml` support | "anonymous app log" | "redacted app log" |
| `lang/en.yml` support dialog | "completely anonymized", including tickers | Say what the redaction removes, and tell the user to check the file |
| `lang/en.yml` welcome | "Your data stays on this computer." | "Your holdings and amounts stay on this computer." |
| `telemetry.ts`, `CLAUDE.md` | "Anonymous" | Update the wording |

## Gaps against each rule

Rule numbers refer to the standard.

| Rules | State | Gap |
| --- | --- | --- |
| 1 | Gap | One option today |
| 2, 3, 5 | Met | None |
| 4 | Met | Terms and telemetry are separate setup steps |
| 6 | Met | A change calls `telemetry.reinitialize()` |
| 7, 8 | Gap | No consent record and no notice version |
| 9 | Gap | `PATCH /api/config` accepts `telemetryEnabled` from a LAN session |
| 10 | Partial | A test scans the keys. Add one for error reports |
| 11 | Met | None in the current events |
| 12 | Check | Confirm that `res.provider` is always a fixed value. Map it if not |
| 13 | Gap | See the claims table |
| 14 | Gap | Website and project settings. The app is met |
| 15 | Partial | A checkout has no key. Add an `isDev()` check |
| 16, 17 | Met | The website and app share one project for one product |
| 18, 19 | Gap | No ID display and no `consent_version` |
| 20 to 28 | Gap | No error reporter exists |
| 29, 30 | Met | Local logs and the manual support flow stay |
| 31, 32 | Gap | No Privacy Notice |
| 33 | Gap | See the claims table |
| 34 | Gap | No retention period is published |

## Consent storage and write path

- Rename `telemetryEnabled` to `analyticsEnabled`. Add `errorReportingEnabled`, default false.
- In `loadConfig`, copy an old `telemetryEnabled` row to `analyticsEnabled` once, then delete the old row.
- Store `ConsentRecord` in `kv_entries` under `privacy:consent`.
- Add `PRIVACY_NOTICE_VERSION = 1` to `modules/shared/src/brand.ts`.
- Keep `PATCH /api/config` as the write path, so the Settings catalog keeps working.
- When the body has a consent key, the route calls `assertLocal`, then `privacyConsent.record()`, then reinitialises the client.
- `POST /api/setup/complete` takes `enableAnalytics` and `enableErrorReporting`. A remote session stores both as off.
- New `GET /api/privacy/consent` returns the record and `needsPrompt`.
- New `PUT /api/privacy/prompt-answer` saves both answers from the update prompt.
- New logic goes in `modules/service/src/services/privacy-consent.ts`.
- Add a `localOnly` flag to `SettingView`. Settings shows those toggles read-only on a remote client.

## Analytics events and allowed properties

| Event | Properties |
| --- | --- |
| `app_launched`, `portfolio_created`, `portfolio_brief_saved`, `metric_installed`, `suggestions_generated`, `quotes_sync_completed`, `analysis_run_started` | None |
| `csv_imported` | `count` |
| `assistant_chat_sent` | `provider` |
| `analysis_run_completed`, `analysis_run_failed`, `analysis_run_cancelled` | `count` |
| `setup_completed` | `demo` |

- Remove the `telemetry` property from `setup_completed`.
- Add `consent_version` inside `capture()`.
- Website: keep `$pageview`, `download_clicked` and `screenshot_zoomed`.
- Website: pass `autocapture: false`, `capture_dead_clicks: false`, `capture_heatmaps: false` and `capture_exceptions: false` to `posthog.init`. Check each option name against the SDK that the site loads.

## Error capture points

Split the client into `posthog-client.ts`, `telemetry.ts` and a new `error-reporting.ts`.

Capture points:

1. `uncaughtException` and `unhandledRejection` in `modules/service/src/main.ts`.
2. GUI `ErrorBoundary.componentDidCatch`.
3. New GUI `window` listeners for `error` and `unhandledrejection`.

The GUI sends `{ name, stack, source }` to a new `POST /api/app/error-report` route. The route always writes the local log. It sends a report only with the option on.

Report build:

- Capture codes: `service:uncaught`, `service:unhandled`, `gui:boundary`, `gui:window`.
- Keep frames only from the bundle. Replace others with `[external]`, including metric modules.
- Build a new `Error` from the safe fields.
- Call `client.captureException(safeError, undefined, props)`. With no ID, the SDK makes a one-off ID and sets `$process_person_profile` to false.
- Keep `enableExceptionAutocapture` off.
- Add a `before_send` allowlist for `$exception` that removes `pre_context`, `context_line` and `post_context`.
- Allow one report per fingerprint and 20 per run.

Do not reuse `anonymizeLogContent`. It is a denylist, and it masks tickers only in `symbols` arrays.

The Electrobun shell is out of scope for this version.

## Text changes

- Setup step 4: two toggles, both off, with the standard's text.
- Settings: two catalog entries, a Notice link, and the analytics ID with Copy and Reset.
- A one-time prompt for existing installs.
- New `extras/website/privacy/index.html`, linked from all footers, the Terms and the app.
- Terms version 1.2, with the fixes in the claims table.
- All text keys go to `lang/en.yml` and the other 40 language files.
- Update `README.md`, `docs/architecture.md` and the Portfolio line in `CLAUDE.md`.
- Add a reference to the standard in `CLAUDE.md`.

## Owner input

| Item | Value | State |
| --- | --- | --- |
| Controller | Christos Georgiou | Set |
| Privacy contact | christos@cgeosoft.com | Set |
| Geographic address | Not published | I found no income in the repo after the sponsorship removal. Christos must confirm that no other income exists |
| PostHog project | `portfolio` (265321), EU, paid plan | Set |
| Retention | 12 months for all events | Proposed |
| Earlier analytics consent | Keep it, and show the prompt | Proposed |

**Retention:** PostHog sets retention per project, in months, not per event type. A 90-day window for error reports would need a second project. I propose one project with a 12-month window. Cleanup runs monthly, so the Notice says that an event can stay up to about a month longer.

**Warning:** a shorter window deletes older events at the next cleanup, and PostHog cannot restore them. The project is from September 2026, so 12 months removes nothing yet.

**Earlier consent:** the setup screen disclosed the UUID, so the standard's default keeps the choice. That screen also said "anonymous". Settings did not disclose the ID. The stricter choice is to reset everyone to off.

**Stored IP addresses:** turning on "Discard client IP data" affects new events only. Old events keep their IP until the retention window removes them. Christos must decide whether that is acceptable.

## Vendor tasks before release

Christos does these, or approves each one for an agent to do:

1. Sign the DPA at `eu.posthog.com/legal`. On 2026-11-06 that page listed no signed document.
2. Turn on "Discard client IP data" on the project. Done on 2026-11-06.
3. Turn off session recording, console logs, heatmaps, exception autocapture and dead clicks on the project. Done on 2026-11-06. Exception capture for the app does not depend on this, because it uses a manual call.
4. Set the project retention to 12 months. Done on 2026-11-06. It shows as 1 year.
5. Read the PostHog sub-processor list.

Tasks 2 and 3 fix a live problem. They can run before any code changes.

## Proposed changes to the standard

Found while I applied it to Portfolio. Christos decides.

1. **PostHog setup:** add a task to turn off project-level recording, console logs, heatmaps, exception autocapture and dead clicks. These settings sit in PostHog, not in the code.
2. **Retention:** say that PostHog sets retention per project, in months, with a monthly cleanup. Separate windows need separate projects.
3. **Web SDK:** add a note that `posthog-js` needs explicit options for rule 14.
4. **Stored IP addresses:** add a note that the IP setting affects new events only.

## Tests

The standard's acceptance tests apply. These tests change in Portfolio:

- `telemetry.test.ts`: the privacy scan, the allowlist without `telemetry`, and the new setting name.
- `config-store.test.ts`: the migration from `telemetryEnabled`.
- `desktop-settings-catalog.test.ts`: the six known settings become seven.
- New `error-reporting.test.ts`: the canary, the allowlist, the rate limit and the recursion guard.
- New `privacy-consent.test.ts`: the record, `assertLocal` and `needsPrompt`.
- `api.test.ts`: the new client methods.

## Delivery order

1. Vendor tasks.
2. Settings, migration and the consent record.
3. Client split and analytics changes, with the website `init` options.
4. Error reporter and capture points.
5. Setup, Settings and the update prompt.
6. Language files.
7. Privacy Notice, Terms, website, README and docs.

Do not release until the vendor tasks are complete. Deploy the website text before or with the app.
