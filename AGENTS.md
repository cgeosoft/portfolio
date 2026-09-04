# AGENTS.md: Developer and AI Agent Guide for Portfolio Desktop

This guide gives developers and AI agents the context, architecture, commands, and rules for this repository.

## 1. Project Overview

Portfolio Desktop is an offline personal investment portfolio tracker for Linux, Windows, and macOS.

### Technology Stack
- **Desktop Shell**: Electrobun (v2.0.1)
- **Main Process**: Bun (v1.2+) with `bun:sqlite` in WAL mode
- **User Interface**: React 19, Chart.js 4, Tailwind CSS 3.4, Lucide React
- **Language**: TypeScript 5.7 in strict mode

### Core Principles
- **Offline-First and Private**: All data stays in `~/.config/portfolio/data/portfolio.sqlite`. The application does not use remote accounts or remote databases.
- **Market Data**: Yahoo Finance provides market quotes and currency exchange rates.
- **AI Analyst**: Local LLMs (Ollama, llamacpp-server) or cloud APIs (Groq, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek) generate performance reports.
- **Optional Telemetry**: PostHog telemetry is off by default. The application never sends balances, holdings, transactions, or personal data.
- **Design**: Dark terminal interface with `JetBrains Mono` typography.

## 2. Repository Layout

- `src/bun/`: Main process code (database, external APIs, and RPC handlers).
  - `src/bun/db/`: Database layer using `bun:sqlite`.
  - `src/bun/services/`: Financial calculations and external services.
- `src/views/`: Webview process code (React user interface).
- `src/shared/`: Shared RPC definitions (`rpc-types.ts`).
- `src/types/`: Domain models and type definitions.

## 3. Commands and Workflows

### Install Dependencies
```bash
bun install
```

### Typecheck Code
Run typecheck to verify types in both TypeScript contexts:
```bash
bun run typecheck
```

### Compile Tailwind CSS
Run this command after you add or modify Tailwind classes:
```bash
bun run build:css
```

### Start Development Mode
```bash
bun run dev
```

### Automated Git Commit and Push
Run this command after each feature change to commit and push changes:
```bash
git add -A && git commit -m "<feature description>" && git push
```

### Build Desktop Application
```bash
bun run build
```

### Package Application
```bash
bun run package:deb
bun run release
```

## 4. Key Architecture Rules

### Electrobun RPC Bridge
- All communication between UI and backend must use Electrobun RPC.
- Add new RPC methods to `src/shared/rpc-types.ts`.
- Implement RPC handlers in `src/bun/index.ts`.
- Call handlers from React components using `rpc.request.<methodName>(payload)`.
- Do not import Bun or Node modules inside `src/views/`.

### Database Layer
- Managed in `src/bun/db/database.ts` using `bun:sqlite`.
- File path: `~/.config/portfolio/data/portfolio.sqlite`.
- WAL mode and foreign keys are active.

### Financial Calculations
- `PortfolioService` in `src/bun/services/portfolio.ts` computes positions, cost basis, P&L, and cash balances.
- Foreign assets convert to `baseCurrency` with Yahoo Finance exchange rates.

### LLM Reports
- Filter model reasoning blocks with `cleanThinkTags()` before you display report text.

## 5. Design System

- **Backgrounds**: `#0b0f19` (Canvas), `#111726` (Widget), `#151d30` (Card)
- **Borders**: `#1e293b`
- **Primary Accent**: `#DD3C73` (Cyber Pink)
- **Status Colors**: `#A7E2C0` (Positive/Mint), `#DD3C73` (Negative/Error), `#E3EACD` (Warning/Notice)
- **Typography**: `JetBrains Mono` for numbers, tickers, and tables; `Inter` for prose.

## 6. Agent Rules

Follow these rules when you modify the repository:

1. **Verify Types**: Run `bun run typecheck` after every TypeScript edit. Ensure zero errors.
2. **Commit and Push**: Run `git add -A && git commit -m "<message>" && git push` after each feature change.
3. **Protect Privacy**: Never log or send balances, tickers, quantities, or personal data.
4. **Compile CSS**: Run `bun run build:css` when you add or change Tailwind CSS classes.
5. **Keep RPC Handlers Lean**: Put business logic in `src/bun/services/`, not in `src/bun/index.ts`.
6. **Filter LLM Output**: Use `cleanThinkTags()` on LLM outputs to remove `<think>` tags.
7. **Writing Style**: Use ASD-STE100 Simplified English when you generate text. Do not use long dashes (`—`). Do not use emojis.
