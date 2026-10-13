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

- `LlmService` in `modules/service/src/services/llm.ts` has three providers. `openai-compatible` speaks OpenAI chat completions to any base URL (llama.cpp, Ollama, LM Studio, vLLM and cloud APIs); an empty model lets the server pick. `claude-cli` spawns the Claude Code CLI (`modules/service/src/services/claude-cli.ts`) with tools and MCP off and the user's subscription sign-in, starts it in `<data>/claude-cli` (mode 0700) and passes the system prompt in a 0600 file; `codex-cli` spawns `codex exec --json` (`codex-cli.ts`) with the ChatGPT plan sign-in, `--ignore-user-config`, the shell and web search off, a read-only sandbox and no AGENTS.md, starts it in `<data>/codex-cli` and passes the system prompt as `model_instructions_file` (0600); `exec` returns the reply whole, not streamed. Shared CLI plumbing is in `cli-process.ts`; ids, names and model lists in `modules/shared/src/llm-defaults.ts`. `GET /api/llm/cli/:provider/status` reports whether a CLI is installed and signed in. Gemini CLI is not a provider: Google's terms forbid third-party software from using its Google sign-in. "Connect OpenRouter" (`openrouter-connect.ts`) runs the OAuth PKCE flow in the system browser and stores the returned key as the OpenAI-compatible provider's; its callback route is public, loopback only, and takes a one-time state. `resolve()` merges request options, stored settings and defaults; `getAvailableModels()` lists models; `POST /api/llm/test` and `/api/llm/test-step` test a connection.
- Provider ids from releases before 0.6 (llamacpp, ollama, groq, ...) are migrated to `openai-compatible` with their URL, key and model in `migrateLlmProvider()` (`modules/service/src/config.ts`).
- Provider config (provider, model, keys, base URLs, temperature) lives in `DesktopConfig` (`modules/service/src/config.ts`, stored in the `settings` table).
- `llm.ts` exports `LlmMessage`, `LlmChatOptions`, `sanitizeLlmResponse(text, isReport)`; every output goes through it.
- `modules/service/src/services/portfolio-report.ts`: ISO week keys, prompt preparation, streaming, persistence through `reportRepo`; `extractLastWords` for stream status. `modules/service/src/services/portfolio-chat.ts`: assistant conversation tied to a portfolio, persisted via `conversation.repo.ts`.
- Never send balances, holdings, transactions or personal identifiers to a provider unless the user asked for a report about their own portfolio.
- Report content is Markdown; render it with `react-markdown` and `remark-gfm` in the webview.
