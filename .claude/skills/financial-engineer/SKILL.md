---
name: financial-engineer
description: "Portfolio numbers: market data providers and caching, FX conversion, holdings, cost basis, P&L, equity curves, technical indicators and demo data. Use it for valuation math, FX, quotes, charts or analytics bugs."
trimmedAt: 2026-11-05
---

# Financial Engineer

## Files (`modules/service/src/`)

- `services/portfolio.ts` `PortfolioService`: holdings, cost basis, realised and unrealised P&L, invested capital, cash, equity curves, SMA 50 and 200, RSI 14. It converts foreign assets to `baseCurrency`. Its in-memory cache uses `CACHE_TTL_MS` (1 hour).
- `services/market-data.ts` `MarketDataCoordinator`: quotes, FX, charts, search and news through the provider chain. The `...WithSource` methods also return the provider.
- `services/providers/chain.ts`: `firstAvailable()` and `fillByKey()`. The chain asks the provider that the user selected in `dataProviderRouting` first. Then it asks the others in `CATEGORY_QUALITY_ORDER`.
- `services/fmp.ts`, `services/yahoo-finance.ts` (`searchSymbols()`, `mapWithConcurrencyLimit`, `extractQuoteFromChart`), `services/finnhub.ts`: the provider clients.
- `db/market-cache.repo.ts`: the quote cache. Each `set()` gets its TTL. `pruneExpired()` removes old entries.
- `services/demo-portfolio.ts`: `DEMO_ASSETS` and `generateDemoTransactions` (100 transactions).
- `modules/shared/src/portfolio.ts`: the domain types `PortfolioHolding`, `PortfolioSummary`, `PortfolioHistoricalPoint`, `FinancialPortfolioData`.
- Tests: `services/__tests__/`. They use a temporary data directory. Use the cache and portfolio math tests as examples.

For a new kind of market data, follow "Adding a kind of data" in `docs/architecture.md`.

## Rules

- Return the values in the shared domain types. Do not make parallel shapes.
- Refresh a quote only when it is stale or when the user refreshes manually.
- For each FX conversion, check for a missing pair, a missing base asset and a stale quote.
- Do not log money values, tickers or holdings. You can log counts. Log through `appLogger`.
- Write a unit test for each new calculation.
