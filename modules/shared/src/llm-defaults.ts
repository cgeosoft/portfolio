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

/**
 * Model aliases the Claude CLI accepts with `--model`. An empty model leaves
 * the choice to the CLI and the user's subscription.
 */
export const CLAUDE_CLI_MODELS = ["sonnet", "opus", "haiku"];
