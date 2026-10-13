import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLangDirForTests, t, translateFor } from "../../i18n.js";
import { getLangDir } from "../../paths.js";

const dir = mkdtempSync(join(tmpdir(), "portfolio-lang-"));
writeFileSync(
  join(dir, "en.yml"),
  `service:
  greeting: "Hello {name}"
  onlyEnglish: "English only"
  items:
    one: "{count} item"
    other: "{count} items"
`,
);
writeFileSync(
  join(dir, "el.yml"),
  `service:
  greeting: "Γεια σου {name}"
  items:
    one: "{count} στοιχείο"
    other: "{count} στοιχεία"
`,
);
writeFileSync(join(dir, "fr.yml"), "service:\n\tbroken: \"tab\"\n");

describe("service translator", () => {
  beforeAll(() => setLangDirForTests(dir));
  afterAll(() => setLangDirForTests(undefined));

  it("translates into the language and fills placeholders", () => {
    expect(translateFor("el", "service.greeting", { name: "Ada" })).toBe("Γεια σου Ada");
    expect(translateFor("en", "service.greeting", { name: "Ada" })).toBe("Hello Ada");
  });

  it("falls back to English for a missing key, a missing file, a broken file and an unknown code", () => {
    expect(translateFor("el", "service.onlyEnglish")).toBe("English only");
    expect(translateFor("de", "service.greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(translateFor("fr", "service.greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(translateFor("../en", "service.greeting", { name: "Ada" })).toBe("Hello Ada");
  });

  it("returns the key when no file has it", () => {
    expect(translateFor("el", "service.nothing")).toBe("service.nothing");
  });

  it("picks the plural form by count", () => {
    expect(translateFor("en", "service.items", { count: 1 })).toBe("1 item");
    expect(translateFor("en", "service.items", { count: 3 })).toBe("3 items");
    expect(translateFor("el", "service.items", { count: 3 })).toBe("3 στοιχεία");
  });

  it("uses the configured language, English by default", () => {
    expect(t("service.greeting", { name: "Ada" })).toBe("Hello Ada");
  });
});

describe("lang/en.yml", () => {
  it("is found from the checkout and holds the service texts", () => {
    expect(getLangDir()).toBeDefined();
    setLangDirForTests(undefined);
    expect(translateFor("en", "service.eventAlerts.notificationTitle")).toBe("Portfolio: upcoming events");
    expect(translateFor("en", "service.dailyBrief.notificationTitle", { portfolio: "Main" })).toBe("Main: daily brief");
    expect(translateFor("en", "service.suggestions.dropped.extra", { count: 2, max: 8 })).toBe("2 suggestions were dropped: only 8 are kept.");
  });
});
