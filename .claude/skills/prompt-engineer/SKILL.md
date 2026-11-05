---
name: prompt-engineer
description: "LLM features: providers, prompts, tool calling, output cleanup, Guided Analysis, the MCP server and the privacy gate for data that goes to a model. Use it for model, prompt, tool, provider or inference changes."
trimmedAt: 2026-11-05
---

# Prompt Engineer

## Files (`modules/service/src/services/`)

- `llm.ts`: `LlmService` with 3 providers. `openai-compatible` sends OpenAI chat completions to a base URL. `claude-cli` and `codex-cli` start a CLI with the user's sign-in.
- `claude-cli.ts`, `codex-cli.ts`, `cli-process.ts`: the CLI runs. The CLIs run with their own tools off. Each run starts in `<data>/<provider>` (mode 0700) and gets the system prompt in a 0600 file.
- Gemini CLI is not a provider. Google's terms do not let third-party software use its Google sign-in.
- `openrouter-connect.ts`: OAuth PKCE. The callback route is public and loopback only, with a one-time state.
- `modules/shared/src/llm-defaults.ts`: ids, names, model lists. The provider settings are in `DesktopConfig` (`config.ts`).
- `analysis/`: Guided Analysis (`phases.ts`, `harness.ts`, `tools/`, `context.ts`, `grounding.ts`, `model-port.ts`). Read "AI features" in `docs/architecture.md` first.
- `portfolio-report.ts`: reads the stored reports. Each Guided Analysis run writes one.
- `portfolio-chat.ts`: the assistant chat. `mcp-*.ts`: the MCP server. Its tools return percentages only.

## Privacy rules

- Send all calls through `LlmService`. Do not call a provider directly.
- Make all `LlmMessage` content with `toPromptSafe()` (`llm-privacy.ts`). Do not cast to `PromptSafe`.
- Also send a prompt from portfolio data through `assertNoLedgerAmounts()`.
- Check structured values and graph node `facts` with `assertPercentOnly()`. Put amounts in `local`.
- Each number that the model writes must be in a cited node.
- Do not send balances, holdings, transactions or personal identifiers, unless the user asked for a report about their own portfolio.
- Do not log API keys, tokens or prompts with user data.
- Add each new prompting feature to `__tests__/privacy-canary.test.ts`. For a new phase or tool, extend `__tests__/analysis-harness.test.ts`.

## Output rules

- Clean all output with `sanitizeLlmResponse()` before you show, store, export or reuse it.
- Show model Markdown only through `SafeMarkdown`.
- Add a new model or provider as a setting entry, not as a new code path.
