import { describe, expect, it } from "bun:test";
import { startingHintScript, startingPage } from "./pages";

describe("startingPage", () => {
  it("shows the hint under the pill, escaped for HTML", () => {
    const html = startingPage("Waiting for <the> service & more.");
    expect(html).toContain("Starting up");
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
