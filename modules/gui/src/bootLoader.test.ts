/** Boot loader: minimum display time, immediate hide and removal. The module's hiding flag never resets, so steps run in order. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { hideBootLoader } from "./bootLoader";

const g = globalThis as any;
const hadDocument = "document" in g;
const realDocument = g.document;
const realSetTimeout = globalThis.setTimeout;
const timers: { fn: () => void; ms: number }[] = [];
let current: any = null;
const dataset: Record<string, string> = {};

function element(classes: string[] = []) {
  const set = new Set(classes);
  return {
    removed: false,
    classList: {
      add: (c: string) => {
        set.add(c);
      },
      contains: (c: string) => set.has(c),
    },
    remove() {
      this.removed = true;
    },
  };
}

beforeAll(() => {
  g.document = {
    getElementById: (id: string) => (id === "boot-loader" ? current : null),
    documentElement: { dataset },
  };
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    timers.push({ fn, ms });
    return 0 as any;
  }) as any;
});

afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
  if (hadDocument) g.document = realDocument;
  else delete g.document;
});

describe("hideBootLoader", () => {
  it("does nothing without the element", () => {
    current = null;
    hideBootLoader();
    expect(timers.length).toBe(0);
  });

  it("does nothing when the element is already hidden", () => {
    current = element(["hide"]);
    hideBootLoader();
    expect(timers.length).toBe(0);
  });

  it("keeps the loader up for at least 2000 ms", () => {
    current = element();
    dataset.bootShownAt = String(performance.now());
    hideBootLoader();
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBeGreaterThan(1900);
    expect(timers[0].ms).toBeLessThanOrEqual(2000);
  });

  it("does not schedule twice while hiding", () => {
    hideBootLoader();
    expect(timers.length).toBe(1);
  });

  it("schedules an immediate hide while hiding", () => {
    hideBootLoader(true);
    expect(timers.length).toBe(2);
    expect(timers[1].ms).toBe(0);
  });

  it("hides, then removes the element after the fade", () => {
    timers[0].fn();
    expect(current.classList.contains("hide")).toBe(true);
    expect(timers.length).toBe(3);
    expect(timers[2].ms).toBe(350);
    timers[1].fn();
    expect(timers.length).toBe(3);
    timers[2].fn();
    expect(current.removed).toBe(true);
  });

  it("does nothing once hidden", () => {
    hideBootLoader(true);
    expect(timers.length).toBe(3);
  });
});
