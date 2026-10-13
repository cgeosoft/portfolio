/**
 * Defaults for the inference providers.
 *
 * The OpenAI-compatible URL is LM Studio's upstream default, not a particular
 * machine's setup. Anyone running another server (llama.cpp, Ollama, vLLM or
 * a cloud API) overrides it with the Server Base URL field in Settings, which
 * is persisted in the config and threaded through every request.
 */

/** Default endpoint for a custom OpenAI-compatible server. */
export const DEFAULT_OPENAI_COMPATIBLE_URL = "http://127.0.0.1:1234/v1";

/** The providers that run a vendor CLI on this machine with the user's own sign-in. */
export type CliProviderId = "claude-cli" | "codex-cli";

export const CLI_PROVIDER_NAMES: Record<CliProviderId, string> = {
  "claude-cli": "Claude CLI",
  "codex-cli": "Codex CLI",
};

/**
 * Model aliases the Claude CLI accepts with `--model`. An empty model leaves
 * the choice to the CLI and the user's subscription.
 */
export const CLAUDE_CLI_MODELS = ["sonnet", "opus", "haiku"];

/**
 * Models the Codex CLI recommends for a ChatGPT sign-in (`--model`), as of
 * October 2026. Which ones a plan gets varies; an empty model leaves the
 * choice to the CLI.
 */
export const CODEX_CLI_MODELS = ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"];

/** The model list shown in Settings for each CLI provider; any other name can be typed. */
export const CLI_PROVIDER_MODELS: Record<CliProviderId, string[]> = {
  "claude-cli": CLAUDE_CLI_MODELS,
  "codex-cli": CODEX_CLI_MODELS,
};
