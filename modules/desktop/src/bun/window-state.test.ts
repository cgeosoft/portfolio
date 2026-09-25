import { describe, expect, it } from "bun:test";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WindowStateManager,
  normalizeWindowState,
  type WindowStateConfig,
} from "./window-state";

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
