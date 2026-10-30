/** Consistency of the lang/*.yml files with en.yml and the language list. Reads the real files only. */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LANGUAGES, isPluralForm, parseMessages, placeholders, type Messages } from "../i18n";

const LANG_DIR = resolve(import.meta.dir, "../../../../lang");
const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const load = (code: string): Messages => parseMessages(readFileSync(join(LANG_DIR, `${code}.yml`), "utf8"));
const pluralBase = (key: string) => key.slice(0, key.lastIndexOf("."));
const pluralGroups = (m: Messages) => {
  const groups = new Map<string, Set<string>>();
  for (const k of Object.keys(m)) {
    if (!isPluralForm(k) || !k.includes(".")) continue;
    const base = pluralBase(k);
    if (!groups.has(base)) groups.set(base, new Set());
    groups.get(base)!.add(k.slice(base.length + 1));
  }
  return groups;
};

const en = load("en");
const enGroups = pluralGroups(en);

describe("en.yml", () => {
  it("parses and has keys", () => {
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it("has one and other in every plural group", () => {
    const problems: string[] = [];
    for (const [base, forms] of enGroups) {
      if (!forms.has("one") || !forms.has("other")) problems.push(base);
    }
    expect(problems).toEqual([]);
  });

  it("has no em-dash", () => {
    expect(Object.entries(en).filter(([, v]) => v.includes("—")).map(([k]) => k)).toEqual([]);
  });

  it("leaves only setup.welcome.agreeAfter empty", () => {
    expect(Object.entries(en).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual(["setup.welcome.agreeAfter"]);
  });
});

describe("language files", () => {
  it("exist for exactly the listed languages", () => {
    const files = readdirSync(LANG_DIR)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => f.slice(0, -4))
      .sort();
    expect(files).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  for (const lang of LANGUAGES.filter((l) => l.code !== "en")) {
    it(`${lang.code}.yml matches en.yml`, () => {
      const m = load(lang.code);
      const groups = pluralGroups(m);
      const problems: string[] = [];

      for (const key of Object.keys(en)) {
        if (isPluralForm(key) && key.includes(".")) {
          const base = pluralBase(key);
          if (groups.has(base)) {
            if (!groups.get(base)!.has("other") && !problems.includes(`missing ${base}.other`)) problems.push(`missing ${base}.other`);
            continue;
          }
        }
        if (!(key in m)) problems.push(`missing ${key}`);
      }

      for (const key of Object.keys(m)) {
        if (key in en) {
          // A plural form may spell out its number ("one share" in ar/he), so check-lang.ts
          // does not compare placeholders inside plural groups. Mirror that.
          if (isPluralForm(key)) continue;
          const want = placeholders(en[key]!).join(",");
          const got = placeholders(m[key]!).join(",");
          if (want !== got) problems.push(`placeholders ${key}: ${got} != ${want}`);
        } else if (!(isPluralForm(key) && key.includes(".") && enGroups.has(pluralBase(key)))) {
          problems.push(`extra ${key}`);
        }
      }

      expect(problems).toEqual([]);
    });
  }

  for (const lang of LANGUAGES) {
    it(`${lang.code}.yml has every plural category`, () => {
      const categories = new Intl.PluralRules(lang.code).resolvedOptions().pluralCategories;
      const problems: string[] = [];
      for (const [base, forms] of pluralGroups(load(lang.code))) {
        for (const c of categories) if (!forms.has(c)) problems.push(`${base}.${c}`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("check-lang CLI", () => {
  it("passes", () => {
    const r = Bun.spawnSync([process.execPath, "run", join(REPO_ROOT, "scripts/check-lang.ts")], { cwd: REPO_ROOT });
    expect(r.exitCode).toBe(0);
    expect(new TextDecoder().decode(r.stdout)).toContain("lang check passed");
  });
});
