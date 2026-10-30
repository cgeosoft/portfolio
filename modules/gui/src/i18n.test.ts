/** Interface text: lookups, plurals, interpolation, language detection and switching. Only English loads under Bun. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  t,
  hasMessage,
  getLanguage,
  getLocale,
  preferredLanguage,
  loadLanguage,
  systemLanguage,
  applyLanguageNow,
  switchLanguage,
  adoptConfigLanguage,
} from "./i18n";

const KEY = "portfolio_language";
const g = globalThis as any;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const store = new Map<string, string>();
let reloads = 0;
let warnings = 0;
const realWarn = console.warn;

const goodStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, String(v)),
};

function setNavigator(value: object) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

beforeAll(() => {
  for (const name of ["localStorage", "window", "document", "navigator"]) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  }
  g.localStorage = goodStorage;
  g.window = { location: { reload: () => reloads++ } };
  g.document = { documentElement: { lang: "", dir: "" } };
  setNavigator({ languages: ["pt-BR", "en"], language: "pt-BR" });
  console.warn = () => {
    warnings++;
  };
});

afterAll(async () => {
  await loadLanguage("en");
  console.warn = realWarn;
  for (const [name, desc] of Object.entries(saved)) {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else delete g[name];
  }
});

describe("i18n", () => {
  it("looks up English text", () => {
    expect(t("common.yes")).toBe("Yes");
    expect(getLanguage()).toBe("en");
    expect(getLocale()).toBe("en");
  });

  it("picks the plural form by count", () => {
    expect(t("language.showMore", { count: 1 })).toBe("Show 1 more language");
    expect(t("language.showMore", { count: 3 })).toBe("Show 3 more languages");
  });

  it("returns the key for a plural key without params", () => {
    expect(t("language.showMore")).toBe("language.showMore");
  });

  it("interpolates and keeps missing placeholders", () => {
    expect(t("language.detected", { name: "Ελληνικά" })).toBe("Ελληνικά · your system");
    expect(t("language.detected")).toBe("{name} · your system");
    expect(t("language.detected", { other: 1 })).toBe("{name} · your system");
  });

  it("returns an unknown key as is", () => {
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("reports which messages exist", () => {
    expect(hasMessage("language.showMore.one")).toBe(true);
    expect(hasMessage("language.showMore")).toBe(false);
    expect(hasMessage("x.y")).toBe(false);
  });

  it("detects the system language", () => {
    expect(systemLanguage()).toBe("pt");
    setNavigator({ languages: [], language: "nb-NO" });
    expect(systemLanguage()).toBe("no");
    setNavigator({ languages: ["xx-YY"] });
    expect(systemLanguage()).toBe("en");
    setNavigator({ languages: ["pt-BR", "en"], language: "pt-BR" });
  });

  it("prefers a stored known language over the system one", () => {
    store.clear();
    expect(preferredLanguage()).toBe("pt");
    store.set(KEY, "de");
    expect(preferredLanguage()).toBe("de");
    store.set(KEY, "xx");
    expect(preferredLanguage()).toBe("pt");
    g.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    try {
      expect(preferredLanguage()).toBe("pt");
    } finally {
      g.localStorage = goodStorage;
      store.clear();
    }
  });

  it("falls back to English with one warning when no translation loads", async () => {
    warnings = 0;
    await loadLanguage("el");
    expect(getLanguage()).toBe("en");
    expect(g.document.documentElement.lang).toBe("en");
    expect(g.document.documentElement.dir).toBe("ltr");
    expect(warnings).toBe(1);
  });

  it("ignores an unknown code without a warning", async () => {
    warnings = 0;
    await loadLanguage("xx");
    expect(getLanguage()).toBe("en");
    await loadLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(warnings).toBe(0);
  });

  it("stores the language that actually loaded", async () => {
    store.clear();
    const before = reloads;
    await applyLanguageNow("de");
    expect(store.get(KEY)).toBe("en");
    expect(reloads).toBe(before);
  });

  it("adopts the config language only once and only when it differs", () => {
    store.clear();
    const before = reloads;
    expect(adoptConfigLanguage("de")).toBe(true);
    expect(reloads).toBe(before + 1);
    expect(store.get(KEY)).toBe("de");
    expect(adoptConfigLanguage("de")).toBe(false);
    store.clear();
    expect(adoptConfigLanguage("en")).toBe(false);
    expect(adoptConfigLanguage("zz")).toBe(false);
    expect(adoptConfigLanguage(undefined)).toBe(false);
    expect(reloads).toBe(before + 1);
  });

  it("switches the language and reloads even when storage fails", () => {
    store.clear();
    const before = reloads;
    switchLanguage("fr");
    expect(store.get(KEY)).toBe("fr");
    expect(reloads).toBe(before + 1);
    g.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    };
    try {
      expect(() => switchLanguage("de")).not.toThrow();
      expect(reloads).toBe(before + 2);
    } finally {
      g.localStorage = goodStorage;
    }
  });
});
