import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedPage, loadHeadingFont, startingHintScript, startingPage } from "./pages";

let fontDir = "";
beforeAll(() => {
  fontDir = mkdtempSync(join(tmpdir(), "portfolio-pages-"));
  mkdirSync(join(fontDir, "fonts"));
  writeFileSync(join(fontDir, "fonts", "sansation-latin-700.woff2"), new Uint8Array([1, 2, 3]));
});
afterAll(() => {
  loadHeadingFont("/nonexistent");
  rmSync(fontDir, { recursive: true, force: true });
});

describe("startingPage", () => {
  it("shows the hint under the tagline, escaped for HTML", () => {
    const html = startingPage("Waiting for <the> service & more.");
    expect(html).toContain('<h1 class="loading">');
    expect(html).toContain('id="starting-hint">Waiting for &lt;the&gt; service &amp; more.</p>');
  });
});

describe("startingHintScript", () => {
  it("writes the hint as a string literal into the element of the starting page", () => {
    const script = startingHintScript('Opening the "dashboard".');
    expect(script).toContain('document.getElementById("starting-hint")');
    expect(script).toContain('"Opening the \\"dashboard\\"."');
  });
});

describe("failedPage", () => {
  it("escapes the paths and shows the default reason without the vendor intro", () => {
    const html = failedPage("/tmp/a<b>.log", "", "/d&d");
    expect(html).toContain("Could not start");
    expect(html).toContain('class="tagline error"');
    expect(html).toContain("/tmp/a&lt;b&gt;.log");
    expect(html).toContain("/d&amp;d");
    expect(html).toContain("(no output)");
    expect(html).toContain("The service exited before it became reachable.");
    expect(html).toContain("nothing is read from a .env file");
    expect(html).not.toContain('class="intro"');
  });

  it("shows a custom reason and the escaped output", () => {
    const html = failedPage("l", "line <1>\n", "d", "Port in use & busy.");
    expect(html).toContain("Port in use &amp; busy.");
    expect(html).toContain("<pre>line &lt;1&gt;\n</pre>");
    expect(html).not.toContain("The service exited before it became reachable.");
  });
});

describe("heading font", () => {
  it("starts without an embedded font", () => {
    const html = startingPage("x");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('class="intro"');
    expect(html).toContain(">cgeo<");
    expect(html).toContain(">soft<");
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("document.fonts.load");
  });

  it("embeds the font after loadHeadingFont", () => {
    loadHeadingFont(fontDir);
    const html = startingPage("x");
    expect(html).toContain("url(data:font/woff2;base64,AQID)");
    expect(html).toContain('font-family: "Sansation"');
    expect(html).toContain("document.fonts.load");
    expect(html).toContain('"700 28px \\"Sansation\\""');
    expect(failedPage("a", "b", "c")).toContain("AQID");
  });

  it("drops the font when the file is missing", () => {
    loadHeadingFont(join(fontDir, "missing"));
    expect(startingPage("x")).not.toContain("@font-face");
  });
});
