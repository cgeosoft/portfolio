/**
 * Translations of the text the service itself writes for the user: push
 * notification titles and fixed bodies, the fallback texts of the daily brief
 * and the weekly analysis, report titles. The keys live under `service.*` in
 * `lang/<code>.yml` (see `getLangDir()` in paths.ts).
 *
 * `t()` reads the language of Settings, Appearance. A missing file or key
 * falls back to English, then to the key. Parsed files stay in memory.
 * HTTP error messages and log lines stay English.
 *
 * LLM output is not translated here: the prompts ask the model for the
 * language (services/output-language.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LANGUAGE, findLanguage, parseMessages, translate, type Messages } from "portfolio-shared/i18n";
import { loadConfig } from "./config";
import { appLogger } from "./logger";
import { getLangDir } from "./paths";

const messageCache = new Map<string, Messages>();
const pluralCache = new Map<string, Intl.PluralRules>();
let langDirOverride: string | undefined;

/** Test hook: read the translation files from `dir` and drop the cache. Undefined restores the default. */
export function setLangDirForTests(dir: string | undefined): void {
  langDirOverride = dir;
  messageCache.clear();
}

/** The parsed `lang/<code>.yml`, or an empty table when the file is missing or broken. */
function messagesFor(code: string): Messages {
  const cached = messageCache.get(code);
  if (cached) return cached;
  let messages: Messages = {};
  const dir = langDirOverride ?? getLangDir();
  const file = dir ? join(dir, `${code}.yml`) : undefined;
  if (file && existsSync(file)) {
    try {
      messages = parseMessages(readFileSync(file, "utf8"));
    } catch (err) {
      appLogger.logStep("warning", "i18n", "load", `Translation file ${code}.yml is not valid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  messageCache.set(code, messages);
  return messages;
}

function pluralRulesFor(code: string): Intl.PluralRules {
  let rules = pluralCache.get(code);
  if (!rules) {
    rules = new Intl.PluralRules(code);
    pluralCache.set(code, rules);
  }
  return rules;
}

/** The configured interface language, or English when it is unknown or the settings cannot be read. */
export function serviceLanguage(): string {
  try {
    const code = loadConfig().language;
    return findLanguage(code) ? code : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Translates `key` into `language` and fills its `{name}` placeholders; plurals pick their form by `params.count`. */
export function translateFor(language: string, key: string, params?: Record<string, string | number>): string {
  const code = findLanguage(language) ? language : DEFAULT_LANGUAGE;
  const fallback = messagesFor(DEFAULT_LANGUAGE);
  const messages = code === DEFAULT_LANGUAGE ? fallback : messagesFor(code);
  return translate(messages, fallback, pluralRulesFor(code), key, params);
}

/** Translates `key` into the configured language. */
export function t(key: string, params?: Record<string, string | number>): string {
  return translateFor(serviceLanguage(), key, params);
}
