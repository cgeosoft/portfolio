---
name: react-engineer
description: "React GUI: components, hooks, client state, views, the typed HTTP client, charts and rendering. Use it for GUI features, client state, data fetching or rendering bugs."
trimmedAt: 2026-11-05
---

# React Engineer

## Files (`modules/gui/src/`)

- Stack: React 19, Chart.js 4, Cytoscape, Lucide, built by Vite.
- `App.tsx`: the views (dashboard, portfolios, settings, sponsorship, terms). The dashboard tabs are Overview, Insights, Transactions and Analysis.
- `api.ts`: the typed HTTP client (`api.<name>()`, with cookies). `rpc.ts` keeps `rpc.request.<name>(payload)` for old components. Use `api` in new code.
- `environment.ts`: `openExternal()` sends external links to the system browser.
- `components/`: `layout/`, `common/`, `auth/`, `settings/`, `portfolio/`, `analysis/`, `metrics/`.
- `portfolio/` has the cards, the modals, `AssistantSidebar` and `utils.ts`. `analysis/` has the brief, the Analysis tab and the Cytoscape graph. `metrics/` has `MetricsTab`, `MetricDashboard` and `metric-view.ts`.

## Rules

- Use function components and hooks only.
- Get backend data only through `api.ts`. Read `modules/shared/src/api-types.ts` before you add a call. Do not use `fetch` in a component.
- Keep shared state in the top-level page. Do not copy it into component state.
- Clean up each socket, timer and subscription in its effect. `StrictMode` runs effects 2 times in development.
- Show errors with the toast or status pattern of the project.
- Format money and percentages only with `fmtCurrency` and `fmtPercent` (`modules/shared/src/format.ts`, exported again by `components/portfolio/utils.ts`).
- The `hideValues` argument of `fmtCurrency` is the only privacy mask. One exception: `displayMetric()` hides all figures of a metric module that is not verified while the values are hidden.
- Do not format a metric in the webview. Call `evaluatePortfolioMetrics` and show the result through `displayMetric()`.
- Change the metric selection only with the helpers in `modules/shared/src/metrics.ts`. The dashboard holds 4 large cards and 6 compact tiles.
- For styles, use the `cx-card` surface and the tokens in `index.css`. Do not use a hex value or one-time CSS in a component.
