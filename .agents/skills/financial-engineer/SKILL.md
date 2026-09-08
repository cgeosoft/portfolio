---
name: financial-engineer
description: Maintain and extend the financial calculation engine, Yahoo Finance market data integration, foreign exchange conversion, technical indicators, and the demo portfolio generator. Use for valuation math, FX, quotes, charts, or analytics bugs.
---

# Financial Engineer

## Stack and rules

- `YahooFinanceService` in `src/bun/services/yahoo-finance.ts` fetches quotes, FX pairs, and chart histories. It was ported from a NestJS service without DI decorators.
- `PortfolioService` in `src/bun/services/portfolio.ts` computes positions, cost basis, P&L, cash balances, and equity curves.
- Foreign assets convert to `baseCurrency` using Yahoo Finance exchange rates.
- Values are stored and returned in the domain types from `src/types/portfolio.ts`.
- Run `bun test` for unit tests in `src/bun/services/__tests__/`.

## Repo layout

- `src/bun/services/yahoo-finance.ts` - Market data client:
  - `YahooQuote` and `YahooChartCandle` interfaces.
  - `searchSymbol(query)` for symbol lookup.
  - Quote fetching with concurrency limits (`mapWithConcurrencyLimit`).
  - Chart history parsing (`extractQuoteFromChart`).
- `src/bun/services/portfolio.ts` - Core analytics engine:
  - Holdings, realized and unrealized gains, invested capital, cash liquidity.
  - SMA 50 / SMA 200 and RSI 14 technical indicators.
  - Currency conversion for foreign holdings.
- `src/bun/services/demo-portfolio.ts` - Generates a 100-transaction demo portfolio (`DEMO_ASSETS`, `generateDemoTransactions`).
- `src/bun/db/market-cache.repo.ts` - Caches market quotes with an expiry (TTL) to reduce API calls.
- `src/types/portfolio.ts` - Domain models: `PortfolioHolding`, `PortfolioHoldingConfig`, `PortfolioSummary`, `PortfolioHistoricalPoint`, `FinancialPortfolioData`.

## Conventions

- Use the app logger (`appLogger`) for service activity. Do not log balances, tickers, quantities, or other financial data.
- Respect the market cache TTL in `CACHE_TTL_MS`. Refresh quotes only when the cache is stale or the UI requests a manual refresh.
- Include unit tests for new calculations. Look at `src/bun/services/__tests__/` for the existing test style (cache concurrency, portfolio math).

## Gotchas and pitfalls

- Never log actual monetary values or holdings. Aggregate metadata such as counts is fine.
- FX conversion requires the target currency pair. Guard against a missing base asset or stale quote.
- Run `bun run typecheck` after any TypeScript edit in `src/bun/`.
- Commit and push your change after it works, following the release workflow.