/**
 * Checks every lang/<code>.yml against lang/en.yml: it parses, it names each
 * language of LANGUAGES, it has the same keys (plural forms may differ by
 * language) and each text keeps the placeholders of the English one.
 *
 *   bun run scripts/check-lang.ts [code...]
 *
 * Exits 1 when a file has a problem.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LANGUAGES, isPluralForm, parseMessages, placeholders, type Messages } from "../modules/shared/src/i18n";

const dir = resolve(import.meta.dir, "..", "lang");
const only = process.argv.slice(2);

function load(code: string): Messages {
  return parseMessages(readFileSync(join(dir, `${code}.yml`), "utf8"));
}

const pluralBase = (key: string) => key.slice(0, key.lastIndexOf("."));

const en = load("en");
const files = new Set(readdirSync(dir).filter((f) => f.endsWith(".yml")).map((f) => f.slice(0, -4)));
let failed = false;

for (const code of files) if (!LANGUAGES.some((l) => l.code === code)) console.log(`${code}.yml: not a language of LANGUAGES`);

for (const lang of LANGUAGES) {
  if (lang.code === "en" || (only.length && !only.includes(lang.code))) continue;
  const problems: string[] = [];
  if (!files.has(lang.code)) {
    problems.push("file missing");
  } else {
    let messages: Messages;
    try {
      messages = load(lang.code);
    } catch (err) {
      console.log(`${lang.code}.yml: ${(err as Error).message}`);
      failed = true;
      continue;
    }
    const plurals = new Set(Object.keys(messages).filter(isPluralForm).map(pluralBase));
    for (const [key, text] of Object.entries(en)) {
      if (isPluralForm(key) && plurals.has(pluralBase(key))) {
        if (!(`${pluralBase(key)}.other` in messages)) problems.push(`${pluralBase(key)}: plural without "other"`);
        continue;
      }
      if (!(key in messages)) {
        problems.push(`missing ${key}`);
        continue;
      }
      const want = placeholders(text).join(",");
      const got = placeholders(messages[key]!).join(",");
      if (want !== got) problems.push(`${key}: placeholders {${got}} instead of {${want}}`);
    }
    const enPlurals = new Set(Object.keys(en).filter(isPluralForm).map(pluralBase));
    for (const key of Object.keys(messages)) {
      if (key in en) continue;
      if (isPluralForm(key) && enPlurals.has(pluralBase(key))) continue;
      problems.push(`extra ${key}`);
    }
  }
  if (problems.length) {
    failed = true;
    console.log(`${lang.code}.yml: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  … ${problems.length - 20} more`);
  }
}

console.log(failed ? "lang check failed" : `lang check passed (${Object.keys(en).length} keys)`);
process.exit(failed ? 1 : 0);
