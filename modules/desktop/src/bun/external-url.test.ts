import { describe, expect, it } from "bun:test";
import { classifyExternalUrl, encodeForShell } from "./external-url";

const APP = "http://127.0.0.1:5123";

describe("classifyExternalUrl", () => {
  it("keeps an app route in a window of its own", () => {
    expect(classifyExternalUrl(`${APP}/portfolios/1`, APP)).toEqual({ kind: "app", url: `${APP}/portfolios/1` });
  });

  it("hands http(s) and mailto links to the system", () => {
    expect(classifyExternalUrl("https://example.com/x", APP)).toEqual({ kind: "external", url: "https://example.com/x" });
    expect(classifyExternalUrl("mailto:a@b.co", APP).kind).toBe("external");
  });

  it("drops a scheme that is not http(s) or mailto", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>", "chrome://settings"]) {
      expect(classifyExternalUrl(url, APP).kind).toBe("ignore");
    }
  });

  it("drops empty, non-string and unparseable input", () => {
    expect(classifyExternalUrl("", APP).kind).toBe("ignore");
    expect(classifyExternalUrl(undefined, APP).kind).toBe("ignore");
    expect(classifyExternalUrl({ nope: true }, APP).kind).toBe("ignore");
    expect(classifyExternalUrl("not a url", APP).kind).toBe("ignore");
  });

  it("treats a link to a look-alike host as external, not app", () => {
    // The app prefix must be followed by a slash, so a look-alike host is not an app route.
    expect(classifyExternalUrl("http://127.0.0.1.evil.com/", APP).kind).toBe("external");
  });

  it("returns external before an app origin is known", () => {
    expect(classifyExternalUrl("https://example.com", null).kind).toBe("external");
  });
});

describe("encodeForShell", () => {
  it("percent-encodes the characters a shell would act on", () => {
    expect(encodeForShell('https://x/?q=$(id)`\\"\'')).toBe("https://x/?q=%24(id)%60%5C%22%27");
  });

  it("leaves a plain URL unchanged", () => {
    expect(encodeForShell("https://example.com/path?a=1&b=2")).toBe("https://example.com/path?a=1&b=2");
  });
});
