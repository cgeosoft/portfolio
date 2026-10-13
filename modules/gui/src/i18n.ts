/**
 * Interface text. `main.tsx` loads one language before the first render and
 * the app reads it with `t()` from then on: no React context, no re-render on
 * a switch. Changing the language saves it and reloads the window.
 *
 * Every `lang/<code>.yml` at the repository root becomes its own chunk of the
 * build, so the packaged app carries all of them and loads only the active
 * one. English is part of the main bundle and fills any key a translation
 * lacks.
 */
import { DEFAULT_LANGUAGE, findLanguage, matchLanguage, parseMessages, translate, type Messages } from "portfolio-shared/i18n";
import enSource from "../../../lang/en.yml?raw";

const loaders = import.meta.glob<string>(["../../../lang/*.yml", "!../../../lang/en.yml"], { query: "?raw", import: "default" });

/** localStorage key of the chosen language on this device. */
const STORAGE_KEY = "portfolio_language";

const english: Messages = parseMessages(enSource);
let messages: Messages = english;
let language = DEFAULT_LANGUAGE;
let pluralRules = new Intl.PluralRules(DEFAULT_LANGUAGE);

/** Text of `key` in the active language; `{name}` placeholders take `params`. */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(messages, english, pluralRules, key, params);
}

/** Code of the active language ("en", "el"). */
export function getLanguage(): string {
  return language;
}

/** BCP 47 locale for dates and relative times. Amounts keep the en-US format everywhere. */
export function getLocale(): string {
  return language;
}

function storedLanguage(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The language this device starts in: the saved choice, else the closest browser language. */
export function preferredLanguage(): string {
  const saved = storedLanguage();
  if (findLanguage(saved)) return saved!;
  return matchLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/** Loads a language and makes it active. Unknown or broken files leave English active. */
export async function loadLanguage(code: string): Promise<void> {
  const info = findLanguage(code);
  if (!info || code === DEFAULT_LANGUAGE) {
    messages = english;
    language = DEFAULT_LANGUAGE;
  } else {
    const load = loaders[`../../../lang/${code}.yml`];
    try {
      if (!load) throw new Error(`no translation file for ${code}`);
      messages = parseMessages(await load());
      language = code;
    } catch (err) {
      console.warn(`[i18n] ${code} not loaded:`, err);
      messages = english;
      language = DEFAULT_LANGUAGE;
    }
  }
  pluralRules = new Intl.PluralRules(language);
  const root = document.documentElement;
  root.lang = language;
  root.dir = findLanguage(language)?.rtl ? "rtl" : "ltr";
}

/**
 * Saves the language of this device and reloads the window to apply it. The
 * caller saves `language` in the config first, so reports and notifications
 * follow.
 */
export function switchLanguage(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // localStorage unavailable: the choice lasts until the reload only.
  }
  window.location.reload();
}

/**
 * Adopts the language saved in the config when this device has no choice of
 * its own yet (a new browser on the network). Returns true when it reloads.
 */
export function adoptConfigLanguage(code: string | undefined): boolean {
  if (storedLanguage() || !findLanguage(code) || code === language) return false;
  switchLanguage(code!);
  return true;
}
