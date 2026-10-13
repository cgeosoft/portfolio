/**
 * The language of LLM output. The prompts stay English; each prompt whose
 * answer the user reads ends with `languageInstruction()`, which asks for the
 * language of Settings, Appearance. English needs no instruction, so the
 * English prompts are unchanged.
 *
 * ASD-STE100 Simplified English exists for English only: `plainStyle()`
 * gives the rule to use in its place for other languages.
 */
import { DEFAULT_LANGUAGE, findLanguage } from "portfolio-shared/i18n";

export interface LanguageInstructionOptions {
  /**
   * For a JSON answer: the fields that hold text for the user. Only these are
   * written in the language; keys, enum values, ids and symbols stay as given.
   */
  jsonFields?: string[];
}

/** The English name of the output language, or undefined for English and unknown codes. */
function languageName(language: string | undefined): string | undefined {
  const info = findLanguage(language);
  return info && info.code !== DEFAULT_LANGUAGE ? info.name : undefined;
}

/** Whether the model writes English: the default, and the fallback for an unknown code. */
export function isEnglishOutput(language: string | undefined): boolean {
  return languageName(language) === undefined;
}

/** "ASD-STE100 Simplified English" for English, "short, simple sentences" otherwise; reads after "Use". */
export function plainStyle(language: string | undefined): string {
  return isEnglishOutput(language) ? "ASD-STE100 Simplified English" : "short, simple sentences";
}

function quotedList(fields: string[]): string {
  const quoted = fields.map((f) => `"${f}"`);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}` : (quoted[0] ?? "");
}

/**
 * One instruction line that asks for the output language, or "" for English.
 * With `jsonFields` it names the text fields and keeps the JSON structure in
 * English, so the answer still parses.
 */
export function languageInstruction(language: string | undefined, options: LanguageInstructionOptions = {}): string {
  const name = languageName(language);
  if (!name) return "";
  const keep = "Keep tickers, ISINs, currency codes, numbers and product names unchanged.";
  if (options.jsonFields && options.jsonFields.length > 0) {
    const values = options.jsonFields.length === 1 ? "value" : "values";
    return `Write the ${quotedList(options.jsonFields)} ${values} in ${name}. Keep the JSON keys and all other values, such as actions, ids and symbols, in English exactly as specified. ${keep}`;
  }
  return `Write your whole answer in ${name}, headings included. ${keep}`;
}

/** `prompt` with the language instruction as its last paragraph; unchanged for English. */
export function withLanguageInstruction(prompt: string, language: string | undefined, options?: LanguageInstructionOptions): string {
  const line = languageInstruction(language, options);
  return line ? `${prompt}\n\n${line}` : prompt;
}
