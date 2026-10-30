/** Language list, tag matching, the YAML subset parser, placeholders and translation with plurals. */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LLM_FAMILY_LABELS,
  findLanguage,
  isPluralForm,
  matchLanguage,
  parseMessages,
  placeholders,
  translate,
  type Messages,
} from "../i18n";

describe("LANGUAGES", () => {
  it("lists 41 unique languages with English first", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toHaveLength(41);
    expect(codes[0]).toBe("en");
    expect(new Set(codes).size).toBe(41);
    expect(DEFAULT_LANGUAGE).toBe("en");
  });

  it("marks exactly ar, he and fa as right to left", () => {
    expect(LANGUAGES.filter((l) => l.rtl).map((l) => l.code)).toEqual(["ar", "he", "fa"]);
  });

  it("derives the tier from the LLM count and sorts by tier", () => {
    for (const l of LANGUAGES) {
      expect({ code: l.code, tier1: l.tier === 1 }).toEqual({ code: l.code, tier1: l.llms.length === 7 });
      expect({ code: l.code, tier4: l.tier === 4 }).toEqual({ code: l.code, tier4: l.llms.length <= 2 });
    }
    for (let i = 1; i < LANGUAGES.length; i++) expect(LANGUAGES[i]!.tier).toBeGreaterThanOrEqual(LANGUAGES[i - 1]!.tier);
  });

  it("uses only known LLM families", () => {
    const known = Object.keys(LLM_FAMILY_LABELS);
    for (const l of LANGUAGES) for (const f of l.llms) expect(known).toContain(f);
  });
});

describe("findLanguage / matchLanguage", () => {
  it("finds by exact code", () => {
    expect(findLanguage("el")?.name).toBe("Greek");
    for (const c of ["", null, undefined, "EL", "xx"]) expect(findLanguage(c)).toBeUndefined();
  });

  it("maps regional and alias tags", () => {
    expect(matchLanguage(["pt-BR"])).toBe("pt");
    expect(matchLanguage(["nb-NO"])).toBe("no");
    expect(matchLanguage(["nn"])).toBe("no");
    expect(matchLanguage(["fil-PH"])).toBe("tl");
    expect(matchLanguage(["EL-gr"])).toBe("el");
    expect(matchLanguage(["zh-Hant-TW"])).toBe("zh");
  });

  it("takes the first supported tag and splits on underscores", () => {
    expect(matchLanguage(["xx", "de_AT"])).toBe("de");
    expect(matchLanguage(["fr", "de"])).toBe("fr");
  });

  it("falls back to English", () => {
    expect(matchLanguage([])).toBe("en");
    expect(matchLanguage([""])).toBe("en");
    expect(matchLanguage(["iw"])).toBe("en");
  });
});

describe("parseMessages", () => {
  it("nests keys by indentation", () => {
    expect(parseMessages('a:\n  b: "x"\n  c:\n    d: "y {n}"\ne: "z"')).toEqual({ "a.b": "x", "a.c.d": "y {n}", e: "z" });
  });

  it("closes scopes on dedent", () => {
    expect(parseMessages('a:\n  b:\n    c: "1"\n  d: "2"\ne: "3"')).toEqual({ "a.b.c": "1", "a.d": "2", e: "3" });
  });

  it("skips comments and the document marker and reads plain scalars", () => {
    expect(parseMessages('# c\n---\na: "x" # trailing\nb: plain value # comment\nc: plain#nohash\n')).toEqual({
      a: "x",
      b: "plain value",
      c: "plain#nohash",
    });
  });

  it("unescapes a doubled single quote", () => {
    expect(parseMessages("a: 'it''s'\n")).toEqual({ a: "it's" });
  });

  it("decodes JSON escapes in double quotes", () => {
    expect(parseMessages('a: "line\\nnext \\"q\\" \\u00e9"')).toEqual({ a: 'line\nnext "q" é' });
  });

  it("reads quoted keys as one segment", () => {
    expect(parseMessages('"a.b": "x"\n\'c d\': "y"\n"k:e\\"y": "z"')).toEqual({ "a.b": "x", "c d": "y", 'k:e"y': "z" });
  });

  it("keeps colons and hashes inside values", () => {
    expect(parseMessages('a: "x: y"\nb: http://x')).toEqual({ a: "x: y", b: "http://x" });
    expect(parseMessages("a: http://x.com/a#b")).toEqual({ a: "http://x.com/a#b" });
  });

  it("accepts CRLF and empty input", () => {
    expect(parseMessages('a:\r\n  b: "x"\r\n')).toEqual({ "a.b": "x" });
    expect(parseMessages("")).toEqual({});
  });

  it("throws with the line number", () => {
    expect(() => parseMessages('a:\n\tb: "x"')).toThrow("line 2: tabs are not allowed");
    expect(() => parseMessages('a "x"')).toThrow('line 1: expected "key: value"');
    expect(() => parseMessages(': "x"')).toThrow('line 1: expected "key: value"');
    expect(() => parseMessages('a: "abc')).toThrow("line 1: unterminated string");
    expect(() => parseMessages('a: "abc" xyz')).toThrow("line 1: text after the closing quote");
    expect(() => parseMessages('a: "\\q"')).toThrow("line 1: bad double-quoted string");
    expect(() => parseMessages('# c\n\nok: "1"\nbad')).toThrow('line 4: expected "key: value"');
  });
});

describe("placeholders", () => {
  it("returns unique sorted word names", () => {
    expect(placeholders("{b} {a} {b} {c-d} {}")).toEqual(["a", "b"]);
  });

  it("ignores text without placeholders and non-ASCII names", () => {
    expect(placeholders("none")).toEqual([]);
    expect(placeholders("{a_1}{Ü}")).toEqual(["a_1"]);
  });
});

describe("translate", () => {
  const pr = new Intl.PluralRules("en");
  const ru = new Intl.PluralRules("ru");
  const en: Messages = { a: "Hello {name}", "items.one": "{count} item", "items.other": "{count} items", x: "{a}{a}{b}" };

  it("uses the fallback when the language lacks the key", () => {
    expect(translate({}, en, pr, "a", { name: "Ana" })).toBe("Hello Ana");
  });

  it("prefers the language text", () => {
    expect(translate({ a: "Γεια {name}" }, en, pr, "a", { name: "Ana" })).toBe("Γεια Ana");
  });

  it("leaves placeholders without a matching param", () => {
    expect(translate({}, en, pr, "a")).toBe("Hello {name}");
    expect(translate({}, en, pr, "a", { other: 1 })).toBe("Hello {name}");
  });

  it("returns the key when it is missing", () => {
    expect(translate({}, en, pr, "missing")).toBe("missing");
    expect(translate({}, en, pr, "missing", { count: 1 })).toBe("missing");
  });

  it("picks English plural forms", () => {
    expect(translate({}, en, pr, "items", { count: 1 })).toBe("1 item");
    expect(translate({}, en, pr, "items", { count: 0 })).toBe("0 items");
    expect(translate({}, en, pr, "items", { count: 2 })).toBe("2 items");
  });

  it("does not select a plural for a string count", () => {
    expect(translate({}, en, pr, "items", { count: "1" })).toBe("items");
  });

  it("picks Russian forms and prefers the language other over the fallback", () => {
    expect(translate({ "items.few": "{count} F", "items.other": "{count} O" }, en, ru, "items", { count: 3 })).toBe("3 F");
    expect(translate({ "items.other": "{count} O" }, en, ru, "items", { count: 21 })).toBe("21 O");
  });

  it("replaces repeated and falsy params", () => {
    expect(translate({}, en, pr, "x", { a: 0, b: "" })).toBe("00");
  });
});

describe("isPluralForm", () => {
  it("checks the last dotted segment", () => {
    for (const k of ["a.one", "a.other", "a.many", "other"]) expect({ k, v: isPluralForm(k) }).toEqual({ k, v: true });
    for (const k of ["a.ones", "", "a.One", "common.none"]) expect({ k, v: isPluralForm(k) }).toEqual({ k, v: false });
  });
});
