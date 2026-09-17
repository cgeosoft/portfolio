---
name: prompt-engineer
description: LLM inference features: provider clients, model configuration, prompts, tool calling, streaming, output cleanup and the data allowed to reach a model. Use for model, prompt, tool, provider, or inference changes.
---

# Prompt Engineer

## Overview

Owns everything between the app and a language model: provider client, model catalogue, prompts, tool calling, streaming and sanitising.

## When to Use

- Adding or configuring a model, provider, prompt or tool.
- Streaming, compaction, report generation or output cleanup bugs.

## General Instructions

- Every call goes through the project's single LLM service; never call a provider directly from a feature.
- Strip `<think>`, `<tool>` and stray tags before display, persistence, export or reuse as context.
- Never log API keys, tokens or prompts containing user data.
- Send a model only what the request needs; personal or financial data is opt-in per feature.
- A new model or provider is a config entry, not a code path.
- `bun run typecheck` after every edit.

## Project Instructions

- `LlmService` in `modules/service/src/services/llm.ts` is the multi-provider client. Each provider is a row in its `PROVIDERS` table (name, wire protocol `openai` | `anthropic` | `ollama`, cloud flag, default model and URL): llama.cpp, Ollama and any OpenAI-compatible server locally; Groq, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Nebius in the cloud. `resolve()` merges request options, stored settings and defaults; `getAvailableModels()` lists models; `POST /api/llm/test` and `/api/llm/test-step` test a connection.
- Provider config (provider, model, keys, base URLs, temperature) lives in `DesktopConfig` (`modules/service/src/config.ts`, stored in the `config` table).
- `llm.ts` exports `LlmMessage`, `LlmChatOptions`, `sanitizeLlmResponse(text, isReport)`; every output goes through it.
- `modules/service/src/services/portfolio-report.ts`: ISO week keys, prompt preparation, streaming, persistence through `reportRepo`; `extractLastWords` for stream status. `modules/service/src/services/portfolio-chat.ts`: assistant conversation tied to a portfolio, persisted via `conversation.repo.ts`.
- Never send balances, holdings, transactions or personal identifiers to a provider unless the user asked for a report about their own portfolio.
- Report content is Markdown; render it with `react-markdown` and `remark-gfm` in the webview.
