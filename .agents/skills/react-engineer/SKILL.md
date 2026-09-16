---
name: react-engineer
description: React frontend: components, hooks, client state, routing, the typed backend client, streams and rendering. Use for UI features, client state, data fetching, or rendering issues.
---

# React Engineer

## Overview

Builds the React UI: components, hooks, state, navigation and the typed client that talks to the backend.

## When to Use

- Screens, components, modals, hooks, client state or persistence.
- Streams, reconnect logic, data fetching or rendering bugs.

## General Instructions

- Function components and hooks only; type new code explicitly even in a non-strict tsconfig.
- Backend access only through the project's typed client; never inline `fetch` or import backend code.
- Shared state lives in the designated store or top-level page; do not mirror it in component state.
- Every socket, timer or subscription effect cleans up; `StrictMode` double-invokes effects in dev.
- Errors go through the project's toast or status pattern.
- Use the shared class constants and tokens; no ad-hoc hex or one-off CSS.
- `bun run typecheck` after every edit.

## Project Instructions

- React 19, Chart.js 4, Lucide, built by Vite (`modules/gui`). No `bun` or `node:*` imports.
- All backend access is HTTP through `modules/gui/src/api.ts` (`api.<name>()`, cookies included); `modules/gui/src/rpc.ts` keeps `rpc.request.<name>(payload)` working for older components. Read `modules/shared/src/api-types.ts` before adding a call. External links go through `openExternal()` in `environment.ts` (the desktop shell hands them to the system browser).
- Files: `App.tsx` (router: dashboard, settings, portfolios, terms), `components/` (`layout/`, `common/`, `portfolio/` with cards, modals, `AssistantSidebar`, `utils.ts`, `report-export.ts`; `metrics/` with `MetricsTab`, `MetricDashboard`, `metric-view.ts`; `settings/`).
- Money and percent only through `fmtCurrency` / `fmtPercent` from `components/portfolio/utils.ts`; `fmtCurrency` / `hideValues` is the only place the privacy mask applies.
- Metrics: the webview never formats a metric itself; call `evaluatePortfolioMetrics` and render through `displayMetric()`. Selection edits go through the helpers in `modules/shared/src/metrics.ts` (capacity 4 large, 6 compact).
- Use the `cx-card` surface and the tokens in `index.css`; the lock screen, menu bar and footer mirror Assistant.
