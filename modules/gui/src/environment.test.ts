/** Browser environment helpers: brand constants, safe external links and blob downloads. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { openExternal, downloadBlob, APP_VERSION, APP_NAME, WEBPAGE_URL, WEBPAGE_EMAIL, VENDOR_URL } from "./environment";

const g = globalThis as any;
const hadDocument = "document" in g;
const realDocument = g.document;
const realSetTimeout = globalThis.setTimeout;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

const anchors: any[] = [];
const revoked: string[] = [];
const timers: { fn: () => void; ms: number }[] = [];

beforeAll(() => {
  g.document = {
    createElement: (tag: string) => {
      const a: any = {
        tag,
        clicked: 0,
        removed: false,
        click() {
          this.clicked++;
        },
        remove() {
          this.removed = true;
        },
      };
      anchors.push(a);
      return a;
    },
    body: {
      appendChild: (el: any) => {
        el.appended = true;
      },
    },
  };
});

beforeEach(() => {
  anchors.length = 0;
  revoked.length = 0;
  timers.length = 0;
});

afterAll(() => {
  if (hadDocument) g.document = realDocument;
  else delete g.document;
  globalThis.setTimeout = realSetTimeout;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe("environment", () => {
  it("exposes the brand constants", () => {
    expect(APP_VERSION).toBe("");
    expect(APP_NAME).toBe("Portfolio");
    expect(WEBPAGE_URL).toBe("https://portfolio.cgeosoft.com");
    expect(VENDOR_URL).toBe("https://cgeosoft.com");
    expect(typeof WEBPAGE_EMAIL).toBe("string");
    expect(WEBPAGE_EMAIL.length).toBeGreaterThan(0);
    expect(WEBPAGE_EMAIL).toContain("@");
  });

  it("opens a trimmed https link in a new tab", () => {
    expect(openExternal("  https://example.com/a  ")).toBe(true);
    expect(anchors.length).toBe(1);
    const a = anchors[0];
    expect(a.href).toBe("https://example.com/a");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.clicked).toBe(1);
    expect(a.removed).toBe(true);
  });

  it("accepts mailto and upper-case http", () => {
    expect(openExternal("mailto:x@example.com")).toBe(true);
    expect(openExternal("HTTP://EXAMPLE.COM")).toBe(true);
  });

  it("refuses other schemes and empty input", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "", "/relative", undefined as any]) {
      expect(openExternal(url)).toBe(false);
    }
    expect(anchors.length).toBe(0);
  });

  it("downloads a blob and revokes its URL later", () => {
    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = (u: string) => {
      revoked.push(u);
    };
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return 0 as any;
    }) as any;
    try {
      downloadBlob("a.csv", new Blob(["x"]));
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(anchors.length).toBe(1);
    const a = anchors[0];
    expect(a.href).toBe("blob:fake");
    expect(a.download).toBe("a.csv");
    expect(a.clicked).toBe(1);
    expect(a.removed).toBe(true);
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(1000);
    timers[0].fn();
    expect(revoked).toEqual(["blob:fake"]);
  });
});
