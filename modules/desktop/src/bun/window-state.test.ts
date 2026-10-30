import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_WINDOW_COORD,
  MAX_WINDOW_DIMENSION,
  MIN_WINDOW_COORD,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WindowStateManager,
  normalizeWindowState,
  readWindowState,
  writeWindowState,
  type WindowStateConfig,
} from "./window-state";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-ws-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("normalizeWindowState", () => {
  it("returns the defaults when nothing was saved", () => {
    const result = normalizeWindowState(undefined);
    expect(result.frame).toEqual({ width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, x: undefined, y: undefined });
    expect(result.isMaximized).toBe(false);
  });

  it("accepts valid dimensions, coordinates and the maximized flag", () => {
    const result = normalizeWindowState({ width: 1280, height: 800, x: 150, y: 120, isMaximized: true });
    expect(result.frame).toEqual({ width: 1280, height: 800, x: 150, y: 120 });
    expect(result.isMaximized).toBe(true);
  });

  it("falls back to the defaults for dimensions below the minimum", () => {
    const result = normalizeWindowState({ width: MIN_WINDOW_WIDTH - 1, height: MIN_WINDOW_HEIGHT - 1 });
    expect(result.frame.width).toBe(DEFAULT_WINDOW_WIDTH);
    expect(result.frame.height).toBe(DEFAULT_WINDOW_HEIGHT);
  });

  it("drops the position when only one coordinate is valid", () => {
    const result = normalizeWindowState({ width: 1000, height: 700, x: 10, y: Number.NaN });
    expect(result.frame.x).toBeUndefined();
    expect(result.frame.y).toBeUndefined();
  });
});

describe("WindowStateManager", () => {
  const window = (frame: { x: number; y: number; width: number; height: number }, maximized = false) => ({
    ptr: {},
    isMaximized: () => maximized,
    getFrame: () => frame,
  });

  it("persists the normal bounds after a resize", () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager(undefined, (state) => saved.push(state), 0);
    manager.updateFromWindow(window({ x: 5, y: 6, width: 900, height: 600 }));
    manager.flushSave();
    expect(saved.at(-1)).toEqual({ x: 5, y: 6, width: 900, height: 600, isMaximized: false });
  });

  it("keeps the last normal bounds while the window is maximized", () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager({ width: 1000, height: 700, x: 1, y: 2 }, (state) => saved.push(state), 0);
    manager.updateFromWindow(window({ x: 0, y: 0, width: 1920, height: 1080 }, true));
    manager.flushSave();
    expect(saved.at(-1)).toEqual({ x: 1, y: 2, width: 1000, height: 700, isMaximized: true });
  });

  it("takes the new normal bounds when the window is unmaximized", () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager({ width: 1000, height: 700, x: 50, y: 50, isMaximized: true }, (state) => saved.push(state), 0);
    expect(manager.isMaximized()).toBe(true);
    manager.updateFromWindow(window({ x: 120, y: 90, width: 1050, height: 720 }));
    manager.flushSave();
    expect(saved.at(-1)).toEqual({ x: 120, y: 90, width: 1050, height: 720, isMaximized: false });
  });

  it("ignores a window without a native handle", () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager(undefined, (state) => saved.push(state), 0);
    manager.updateFromWindow({ ptr: undefined, isMaximized: () => false, getFrame: () => ({ x: 0, y: 0, width: 1, height: 1 }) });
    expect(manager.getNormalBounds().width).toBe(DEFAULT_WINDOW_WIDTH);
  });
});

describe("window state constants", () => {
  it("match the documented ranges", () => {
    expect(MIN_WINDOW_WIDTH).toBe(400);
    expect(MIN_WINDOW_HEIGHT).toBe(300);
    expect(MAX_WINDOW_DIMENSION).toBe(10000);
    expect(DEFAULT_WINDOW_WIDTH).toBe(1400);
    expect(DEFAULT_WINDOW_HEIGHT).toBe(900);
    expect(MIN_WINDOW_COORD).toBe(-10000);
    expect(MAX_WINDOW_COORD).toBe(30000);
  });
});

describe("normalizeWindowState boundaries", () => {
  it("keeps the exact minimum and maximum dimensions", () => {
    const min = normalizeWindowState({ width: 400, height: 300 });
    expect(min.frame.width).toBe(400);
    expect(min.frame.height).toBe(300);
    const max = normalizeWindowState({ width: 10000, height: 10000 });
    expect(max.frame.width).toBe(10000);
    expect(max.frame.height).toBe(10000);
  });

  it("falls back to the defaults above the maximum and a fraction below the minimum", () => {
    const above = normalizeWindowState({ width: 10000.4, height: 10001 });
    expect(above.frame.width).toBe(1400);
    expect(above.frame.height).toBe(900);
    expect(normalizeWindowState({ width: 399.6 }).frame.width).toBe(1400);
  });

  it("rounds dimensions and coordinates", () => {
    const result = normalizeWindowState({ width: 1280.5, height: 800.4, x: 1.5, y: -1.5 });
    expect(result.frame).toEqual({ width: 1281, height: 800, x: 2, y: -1 });
  });

  it("keeps coordinates inside the range and drops both outside it", () => {
    const inside = normalizeWindowState({ x: -10000, y: 30000 });
    expect(inside.frame.x).toBe(-10000);
    expect(inside.frame.y).toBe(30000);
    const outside = normalizeWindowState({ x: -10001, y: 0 });
    expect(outside.frame.x).toBeUndefined();
    expect(outside.frame.y).toBeUndefined();
  });

  it("falls back for non-numbers", () => {
    const dims = normalizeWindowState({ width: "1280" as any, height: Infinity });
    expect(dims.frame.width).toBe(1400);
    expect(dims.frame.height).toBe(900);
    const pos = normalizeWindowState({ x: Infinity, y: 0 });
    expect(pos.frame.x).toBeUndefined();
    expect(pos.frame.y).toBeUndefined();
  });

  it("reads the maximized flag as a boolean", () => {
    expect(normalizeWindowState({ isMaximized: "yes" as any }).isMaximized).toBe(true);
    expect(normalizeWindowState({ isMaximized: 0 as any }).isMaximized).toBe(false);
  });
});

describe("readWindowState / writeWindowState", () => {
  it("returns undefined for a missing or malformed file", () => {
    const dir = tempDir();
    expect(readWindowState(join(dir, "missing.json"))).toBeUndefined();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(readWindowState(bad)).toBeUndefined();
  });

  it("creates nested directories and round-trips the state", () => {
    const dir = tempDir();
    const file = join(dir, "a", "b", "window-state.json");
    const state: WindowStateConfig = { width: 900, height: 600, x: 1, y: 2, isMaximized: false };
    writeWindowState(file, state);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe(JSON.stringify(state, null, 2) + "\n");
    expect(readWindowState(file)).toEqual(state);
  });
});

describe("WindowStateManager more", () => {
  const window = (frame: { x: number; y: number; width: number; height: number }, maximized = false) => ({
    ptr: {},
    isMaximized: () => maximized,
    getFrame: () => frame,
  });

  it("does not take a frame below the minimum", () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager({ width: 1000, height: 700, x: 1, y: 2 }, (state) => saved.push(state), 0);
    manager.updateFromWindow(window({ x: 0, y: 0, width: 300, height: 200 }));
    manager.flushSave();
    expect(saved.at(-1)).toEqual({ x: 1, y: 2, width: 1000, height: 700, isMaximized: false });
  });

  it("rounds frame values", () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager(undefined, (state) => saved.push(state), 0);
    manager.updateFromWindow(window({ x: 10.4, y: 20.6, width: 900.5, height: 600.49 }));
    manager.flushSave();
    expect(saved.at(-1)).toEqual({ x: 10, y: 21, width: 901, height: 600, isMaximized: false });
  });

  it("debounces a burst of updates into one save", async () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager(undefined, (state) => saved.push(state), 20);
    for (const width of [900, 950, 1000]) manager.updateFromWindow(window({ x: 0, y: 0, width, height: 600 }));
    await Bun.sleep(60);
    expect(saved).toHaveLength(1);
    expect(saved[0].width).toBe(1000);
  });

  it("cancels the pending timer on flushSave", async () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager(undefined, (state) => saved.push(state), 30);
    manager.updateFromWindow(window({ x: 0, y: 0, width: 900, height: 600 }));
    manager.flushSave();
    expect(saved).toHaveLength(1);
    await Bun.sleep(60);
    expect(saved).toHaveLength(1);
  });

  it("swallows a throwing onPersist", () => {
    const manager = new WindowStateManager(undefined, () => {
      throw new Error("x");
    }, 0);
    expect(() => manager.flushSave()).not.toThrow();
  });

  it("swallows a throwing getFrame and schedules nothing", async () => {
    const saved: WindowStateConfig[] = [];
    const manager = new WindowStateManager(undefined, (state) => saved.push(state), 0);
    expect(() =>
      manager.updateFromWindow({
        ptr: {},
        isMaximized: () => false,
        getFrame: () => {
          throw new Error("gone");
        },
      }),
    ).not.toThrow();
    await Bun.sleep(10);
    expect(saved).toHaveLength(0);
    expect(manager.getNormalBounds().width).toBe(DEFAULT_WINDOW_WIDTH);
    expect(manager.getNormalBounds().height).toBe(DEFAULT_WINDOW_HEIGHT);
  });

  it("returns a copy from getNormalBounds", () => {
    const manager = new WindowStateManager({ width: 1000, height: 700 }, () => {}, 0);
    const bounds = manager.getNormalBounds();
    bounds.width = 1;
    expect(manager.getNormalBounds().width).toBe(1000);
  });
});
