import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DomPlatform } from "chart.js";
import { containerContentSize, installChartZoomFix } from "./chart-zoom";

function fakeStyle(el: { padding?: string }) {
  const pad = el.padding ?? "0px";
  return {
    maxWidth: "none",
    maxHeight: "none",
    boxSizing: "border-box",
    paddingLeft: pad,
    paddingRight: pad,
    paddingTop: pad,
    paddingBottom: pad,
    "padding-left": pad,
    "padding-right": pad,
    "padding-top": pad,
    "padding-bottom": pad,
  };
}

const ownerDocument = { defaultView: { getComputedStyle: fakeStyle } };

// A container at 110% zoom: layout box 557x267 CSS px, bounding rect in zoomed px.
function zoomedCanvas(padding = 0): HTMLCanvasElement {
  const container = {
    ownerDocument,
    clientWidth: 557 + 2 * padding,
    clientHeight: 267 + 2 * padding,
    padding: `${padding}px`,
    getBoundingClientRect: () => ({ width: (557 + 2 * padding) * 1.1, height: (267 + 2 * padding) * 1.1 }),
  };
  return { parentNode: container, ownerDocument } as unknown as HTMLCanvasElement;
}

describe("chart zoom fix", () => {
  const original = globalThis.getComputedStyle;

  beforeAll(() => {
    globalThis.getComputedStyle = fakeStyle as unknown as typeof getComputedStyle;
  });

  afterAll(() => {
    globalThis.getComputedStyle = original;
  });

  it("measures the zoomed bounding rect without the fix", () => {
    const size = new DomPlatform().getMaximumSize(zoomedCanvas());
    expect(size.width).toBeCloseTo(612.7, 1);
  });

  it("measures the container in its own CSS pixels with the fix", () => {
    installChartZoomFix();
    expect(new DomPlatform().getMaximumSize(zoomedCanvas())).toEqual({ width: 557, height: 267 });
    expect(new DomPlatform().getMaximumSize(zoomedCanvas(8))).toEqual({ width: 557, height: 267 });
  });

  it("keeps explicit sizes from the ResizeObserver", () => {
    expect(new DomPlatform().getMaximumSize(zoomedCanvas(), 500, 200)).toEqual({ width: 500, height: 200 });
  });
});

describe("containerContentSize", () => {
  const original = globalThis.getComputedStyle;
  const canvas = (parent: object | null) => ({ parentNode: parent, ownerDocument }) as unknown as HTMLCanvasElement;
  const box = (clientWidth: number, clientHeight: number, padding: string) => canvas({ ownerDocument, clientWidth, clientHeight, padding });

  beforeAll(() => {
    globalThis.getComputedStyle = fakeStyle as unknown as typeof getComputedStyle;
  });

  afterAll(() => {
    globalThis.getComputedStyle = original;
  });

  it("returns null without a measurable parent", () => {
    expect(containerContentSize(canvas(null))).toBeNull();
    expect(containerContentSize(canvas({ ownerDocument }))).toBeNull();
    expect(containerContentSize(box(0, 0, "0px"))).toBeNull();
  });

  it("subtracts the padding", () => {
    expect(containerContentSize(box(200, 100, "10px"))).toEqual({ width: 180, height: 80 });
  });

  it("never goes below zero", () => {
    expect(containerContentSize(box(10, 10, "20px"))).toEqual({ width: 0, height: 0 });
  });

  it("keeps a height with zero width", () => {
    expect(containerContentSize(box(0, 100, "0px"))).toEqual({ width: 0, height: 100 });
  });

  it("counts non-numeric padding as zero", () => {
    expect(containerContentSize(box(200, 100, "auto"))).toEqual({ width: 200, height: 100 });
  });

  it("installs the fix only once", () => {
    installChartZoomFix();
    const first = DomPlatform.prototype.getMaximumSize;
    installChartZoomFix();
    expect(DomPlatform.prototype.getMaximumSize).toBe(first);
  });
});
