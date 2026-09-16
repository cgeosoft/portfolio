---
name: financial-engineer
description: Financial calculation engine: market data and quote caching, FX conversion, valuation and P&L math, technical indicators and demo data. Use for valuation math, FX, quotes, charts, or analytics bugs.
---

# Financial Engineer

## Overview

Owns the numbers: market data and caching, currency conversion, holdings, P&L, equity curves and indicators.

## When to Use

- A valuation, P&L, cost-basis or indicator looks wrong.
- Quote fetching, caching, FX, demo data or new analytics.

## General Instructions

- Return values in the shared domain types; no parallel shapes.
- Respect the quote cache TTL: refresh only when stale or on manual refresh.
- Guard every FX conversion against a missing pair, missing base asset or stale quote.
- Never log monetary values, tickers or holdings; counts are fine.
- Unit tests for every new calculation; `bun test` and `bun run typecheck` after every edit.

## Project Instructions

- `modules/service/src/services/yahoo-finance.ts` `YahooFinanceService`: `searchSymbol()`, quotes with `mapWithConcurrencyLimit`, chart history (`extractQuoteFromChart`), FX pairs.
- `modules/service/src/services/portfolio.ts` `PortfolioService`: holdings, cost basis, realised and unrealised P&L, invested capital, cash, equity curves, SMA 50 / 200, RSI 14, conversion of foreign assets to `baseCurrency`.
- `modules/service/src/services/demo-portfolio.ts`: `DEMO_ASSETS`, `generateDemoTransactions` (100 transactions).
- `modules/service/src/db/market-cache.repo.ts`: quote cache with `CACHE_TTL_MS`.
- Domain types in `src/types/portfolio.ts`: `PortfolioHolding`, `PortfolioSummary`, `PortfolioHistoricalPoint`, `FinancialPortfolioData`.
- Tests in `modules/service/src/services/__tests__/` (`bun test` in `modules/service`; they run against a temporary data directory), following the existing cache and portfolio math tests. Log through `appLogger`.
