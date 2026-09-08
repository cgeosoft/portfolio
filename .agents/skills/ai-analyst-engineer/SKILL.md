---
name: ai-analyst-engineer
description: "Maintain the LLM-powered analyst features: portfolio performance reports, the portfolio assistant chat, provider configuration, report streaming, and LLM output cleanup. Use for LLM provider issues, report generation, prompts, or model configuration."
---

# AI Analyst Engineer

## Stack and rules

- `LlmService` in `src/bun/services/llm.ts` is the multi-provider LLM client. It was ported from a NestJS service without DI decorators.
- Providers include local models (Ollama, llamacpp-server) and cloud APIs (Groq, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek).
- Always clean LLM output with `sanitizeLlmResponse()` before display or persistence. This removes `</think>` reasoning blocks and stray tags.
- Never send portfolio balances, holdings, transactions, or personal identifiers to LLM providers unless the user asks for a report about their own portfolio. Keep prompts focused on the requested report.

## Repo layout

- `src/bun/services/llm.ts` - LLM client:
  - `LlmMessage`, `LlmChatOptions`, `sanitizeLlmResponse(text, isReport=)`.
  - Provider-specific request handling and model listing (`getProviderModels`).
- `src/bun/services/portfolio-report.ts` - Report generation service:
  - ISO week key helpers (`getIsoWeekKey`, `parseIsoWeekKey`).
  - Prompt preparation, LLM streaming, and report persistence via `reportRepo`.
  - `extractLastWords` uses `sanitizeLlmResponse` for stream polling status.
- `src/bun/services/portfolio-chat.ts` - Assistant conversation service tied to a portfolio.
- `src/bun/db/report.repo.ts` - Persists generated reports and metrics.
- `src/bun/db/conversation.repo.ts` - Persists assistant conversations and messages.

## Conventions

- Filter model reasoning blocks with `sanitizeLlmResponse()` (the `cleanThinkTags` equivalent) before you display report text.
- Provider config (provider, model, API keys, base URLs, temperature, llamacpp server URL) lives in `DesktopConfig`; see `src/bun/config.ts`.
- Test LLM connections with the `testLlm` / `testLlmStep` RPC flow and `getProviderModels`.

## Gotchas and pitfalls

- Never log API keys or token values. They are stored in config and passed only to the selected provider.
- Report content can contain Markdown. Keep it rendered with react-markdown and `remark-gfm` in the webview.
- Run `bun run typecheck` after any TypeScript edit in `src/bun/`.
- Commit and push your change after it works, following the release workflow. Commit only your changes.
