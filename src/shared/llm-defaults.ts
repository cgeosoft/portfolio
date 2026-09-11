/**
 * Default endpoints for the local inference providers.
 *
 * These are the upstream defaults of each daemon, not a particular machine's
 * setup: `llama-server` listens on 8080 and the Ollama daemon on 11434 unless
 * they are told otherwise. Anyone running on another host or port overrides it
 * with the Server Base URL field in Settings, which is persisted in the config
 * and threaded through every request.
 */

/** Default endpoint of a local llama.cpp `llama-server` instance. */
export const DEFAULT_LLAMACPP_URL = "http://127.0.0.1:8080";

/** Default endpoint of the local Ollama daemon. */
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Default Ollama model. Ollama addresses a specific pulled model by name, so a
 * request without one fails. llama.cpp has no equivalent default: its server
 * answers with whichever model it was started with and ignores the field, so
 * the model is left unset for that provider.
 */
export const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";

/** Default endpoint for Nebius Token Factory OpenAI-compatible API. */
export const DEFAULT_NEBIUS_URL = "https://api.tokenfactory.nebius.com/v1";

/** Default endpoint for custom OpenAI-compatible server. */
export const DEFAULT_OPENAI_COMPATIBLE_URL = "http://127.0.0.1:1234/v1";
