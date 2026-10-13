/**
 * Interface languages and the helpers both sides use to read the translation
 * files in `lang/<code>.yml`.
 *
 * A translation file is a small subset of YAML: nested maps of strings, two
 * spaces per level, `#` comment lines, values in double quotes. `{name}` in a
 * value is a placeholder. A key with `one`/`other` children (and `zero`,
 * `two`, `few`, `many` where the language has them) is a plural, chosen by
 * `Intl.PluralRules` from the `count` parameter.
 */

/** An LLM family whose documentation names the languages it supports. */
export type LlmFamily = "claude" | "gpt" | "gemini" | "llama" | "mistral" | "cohere" | "qwen";

export const LLM_FAMILY_LABELS: Record<LlmFamily, string> = {
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini",
  llama: "Llama 4",
  mistral: "Mistral",
  cohere: "Cohere",
  qwen: "Qwen3",
};

/**
 * How well the LLMs write reports in a language: 1 when all seven families
 * officially name it, 4 when two or fewer do. DeepSeek is left out: it only
 * officially targets English and Chinese.
 */
export type LanguageTier = 1 | 2 | 3 | 4;

export interface LanguageInfo {
  /** ISO 639-1 code; also the file name `lang/<code>.yml`. */
  code: string;
  /** English name, used in LLM prompts ("Write in Greek"). */
  name: string;
  /** The language's own name, shown in the picker. */
  nativeName: string;
  tier: LanguageTier;
  /** The families that officially name the language. */
  llms: LlmFamily[];
  /** Right-to-left script. */
  rtl?: boolean;
}

const ALL: LlmFamily[] = ["claude", "gpt", "gemini", "llama", "mistral", "cohere", "qwen"];

/** Every interface language, English first, then by tier as in the support table. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: "en", name: "English", nativeName: "English", tier: 1, llms: ALL },
  { code: "es", name: "Spanish", nativeName: "Español", tier: 1, llms: ALL },
  { code: "fr", name: "French", nativeName: "Français", tier: 1, llms: ALL },
  { code: "de", name: "German", nativeName: "Deutsch", tier: 1, llms: ALL },
  { code: "it", name: "Italian", nativeName: "Italiano", tier: 1, llms: ALL },
  { code: "pt", name: "Portuguese", nativeName: "Português", tier: 1, llms: ALL },
  { code: "ar", name: "Arabic", nativeName: "العربية", tier: 1, llms: ALL, rtl: true },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文", tier: 2, llms: ["claude", "gpt", "gemini", "mistral", "cohere", "qwen"] },
  { code: "ja", name: "Japanese", nativeName: "日本語", tier: 2, llms: ["claude", "gpt", "gemini", "mistral", "cohere", "qwen"] },
  { code: "ko", name: "Korean", nativeName: "한국어", tier: 2, llms: ["claude", "gpt", "gemini", "mistral", "cohere", "qwen"] },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", tier: 2, llms: ["claude", "gpt", "gemini", "llama", "cohere", "qwen"] },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", tier: 2, llms: ["claude", "gpt", "gemini", "llama", "cohere", "qwen"] },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", tier: 3, llms: ["gemini", "llama", "cohere", "qwen"] },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", tier: 3, llms: ["gemini", "mistral", "cohere", "qwen"] },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", tier: 3, llms: ["claude", "gpt", "gemini", "qwen"] },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", tier: 3, llms: ["claude", "gpt", "gemini", "qwen"] },
  { code: "th", name: "Thai", nativeName: "ไทย", tier: 3, llms: ["gemini", "llama", "qwen"] },
  { code: "ru", name: "Russian", nativeName: "Русский", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "pl", name: "Polish", nativeName: "Polski", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "cs", name: "Czech", nativeName: "Čeština", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "ro", name: "Romanian", nativeName: "Română", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "el", name: "Greek", nativeName: "Ελληνικά", tier: 3, llms: ["gemini", "cohere", "qwen"] },
  { code: "he", name: "Hebrew", nativeName: "עברית", tier: 3, llms: ["gemini", "cohere", "qwen"], rtl: true },
  { code: "fa", name: "Persian", nativeName: "فارسی", tier: 4, llms: ["cohere", "qwen"], rtl: true },
  { code: "tl", name: "Tagalog", nativeName: "Tagalog", tier: 4, llms: ["llama", "qwen"] },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá", tier: 4, llms: ["claude", "gpt"] },
  { code: "bg", name: "Bulgarian", nativeName: "Български", tier: 4, llms: ["gemini", "qwen"] },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski", tier: 4, llms: ["gemini", "qwen"] },
  { code: "da", name: "Danish", nativeName: "Dansk", tier: 4, llms: ["gemini", "qwen"] },
  { code: "et", name: "Estonian", nativeName: "Eesti", tier: 4, llms: ["gemini", "qwen"] },
  { code: "fi", name: "Finnish", nativeName: "Suomi", tier: 4, llms: ["gemini", "qwen"] },
  { code: "hu", name: "Hungarian", nativeName: "Magyar", tier: 4, llms: ["gemini", "qwen"] },
  { code: "lv", name: "Latvian", nativeName: "Latviešu", tier: 4, llms: ["gemini", "qwen"] },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių", tier: 4, llms: ["gemini", "qwen"] },
  { code: "no", name: "Norwegian", nativeName: "Norsk", tier: 4, llms: ["gemini", "qwen"] },
  { code: "sr", name: "Serbian", nativeName: "Српски", tier: 4, llms: ["gemini", "qwen"] },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina", tier: 4, llms: ["gemini", "qwen"] },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina", tier: 4, llms: ["gemini", "qwen"] },
  { code: "sv", name: "Swedish", nativeName: "Svenska", tier: 4, llms: ["gemini", "qwen"] },
];

export const DEFAULT_LANGUAGE = "en";

/** The language with this code, or undefined. */
export function findLanguage(code: string | undefined | null): LanguageInfo | undefined {
  if (!code) return undefined;
  return LANGUAGES.find((lang) => lang.code === code);
}

/**
 * The supported language closest to a list of BCP 47 tags such as
 * `navigator.languages` ("pt-BR" → "pt", "nb-NO" → "no"), or English.
 */
export function matchLanguage(tags: readonly string[]): string {
  for (const tag of tags) {
    let base = tag.toLowerCase().split(/[-_]/)[0] ?? "";
    if (base === "nb" || base === "nn") base = "no";
    if (base === "fil") base = "tl";
    if (findLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** A translation file flattened to dotted keys: `settings.appearance.title` → text. */
export type Messages = Record<string, string>;

function unquoteDouble(raw: string, lineNo: number): string {
  try {
    return JSON.parse(raw) as string;
  } catch {
    throw new Error(`line ${lineNo}: bad double-quoted string`);
  }
}

function parseScalar(raw: string, lineNo: number): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const end = value.lastIndexOf('"');
    if (end <= 0) throw new Error(`line ${lineNo}: unterminated string`);
    const rest = value.slice(end + 1).trim();
    if (rest && !rest.startsWith("#")) throw new Error(`line ${lineNo}: text after the closing quote`);
    return unquoteDouble(value.slice(0, end + 1), lineNo);
  }
  if (value.startsWith("'")) {
    const end = value.lastIndexOf("'");
    if (end <= 0) throw new Error(`line ${lineNo}: unterminated string`);
    return value.slice(1, end).replace(/''/g, "'");
  }
  // A plain scalar ends at " #" (a YAML comment).
  const hash = value.search(/\s#/);
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

function parseKey(raw: string, lineNo: number): string {
  const key = raw.trim();
  if (key.startsWith('"')) return unquoteDouble(key, lineNo);
  if (key.startsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
}

/** Index of the `:` that ends the key of a line, skipping quoted keys. */
function keyEnd(text: string): number {
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    for (let i = 1; i < text.length; i++) {
      if (quote === '"' && text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] === quote) return text.indexOf(":", i);
    }
    return -1;
  }
  return text.search(/:(\s|$)/);
}

/** Parses a translation file into dotted keys. Throws with the line number on a malformed line. */
export function parseMessages(source: string): Messages {
  const out: Messages = {};
  const stack: { indent: number; path: string }[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
    if (line.includes("\t")) throw new Error(`line ${lineNo}: tabs are not allowed`);
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const colon = keyEnd(trimmed);
    if (colon <= 0) throw new Error(`line ${lineNo}: expected "key: value"`);
    const key = parseKey(trimmed.slice(0, colon), lineNo);
    const path = stack.length ? `${stack[stack.length - 1]!.path}.${key}` : key;
    const rest = trimmed.slice(colon + 1).trim();
    if (!rest || rest.startsWith("#")) {
      stack.push({ indent, path });
      continue;
    }
    out[path] = parseScalar(rest, lineNo);
  }
  return out;
}

const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"] as const;

/** The `{name}` placeholders of a text, sorted. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

/**
 * Looks a key up and fills its placeholders. A plural key picks its form by
 * `params.count`. Falls back to `fallback`, then to the key itself.
 */
export function translate(
  messages: Messages,
  fallback: Messages,
  pluralRules: Intl.PluralRules,
  key: string,
  params?: Record<string, string | number>,
): string {
  let text = messages[key] ?? fallback[key];
  if (text === undefined && params && typeof params.count === "number") {
    const form = pluralRules.select(params.count);
    text = messages[`${key}.${form}`] ?? messages[`${key}.other`] ?? fallback[`${key}.${form}`] ?? fallback[`${key}.other`];
  }
  if (text === undefined) return key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match));
}

/** Whether `key` is one form of a plural (`items.one`, `items.other`). */
export function isPluralForm(key: string): boolean {
  const last = key.slice(key.lastIndexOf(".") + 1);
  return (PLURAL_FORMS as readonly string[]).includes(last);
}
