import { describe, it, expect } from "bun:test";
import {
  normalizeWindowState,
  WindowStateManager,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from "../window-state.js";
import type { WindowStateConfig } from "../../config.js";

describe("Window State Normalization and Management", () => {
  describe("normalizeWindowState", () => {
    it("returns standard defaults when input is undefined", () => {
      const result = normalizeWindowState(undefined);
      expect(result.frame.width).toBe(DEFAULT_WINDOW_WIDTH);
      expect(result.frame.height).toBe(DEFAULT_WINDOW_HEIGHT);
      expect(result.frame.x).toBeUndefined();
      expect(result.frame.y).toBeUndefined();
      expect(result.isMaximized).toBe(false);
    });

    it("accepts valid dimensions, coordinates, and maximized state", () => {
      const input: WindowStateConfig = {
        width: 1280,
        height: 800,
        x: 150,
        y: 120,
        isMaximized: true,
      };
      const result = normalizeWindowState(input);
      expect(result.frame.width).toBe(1280);
      expect(result.frame.height).toBe(800);
      expect(result.frame.x).toBe(150);
      expect(result.frame.y).toBe(120);
      expect(result.isMaximized).toBe(true);
    });

    it("resets dimensions to defaults when values are below minimum thresholds", () => {
      const input: WindowStateConfig = {
        width: 200, // Below MIN_WINDOW_WIDTH (400)
        height: 150, // Below MIN_WINDOW_HEIGHT (300)
        x: 50,
        y: 50,
        isMaximized: false,
      };
      const result = normalizeWindowState(input);
      expect(result.frame.width).toBe(DEFAULT_WINDOW_WIDTH);
      expect(result.frame.height).toBe(DEFAULT_WINDOW_HEIGHT);
      expect(result.frame.x).toBe(50);
      expect(result.frame.y).toBe(50);
      expect(result.isMaximized).toBe(false);
    });

    it("discards coordinates that are out of bounds or non-finite", () => {
      const input: WindowStateConfig = {
        width: 1000,
        height: 700,
        x: 999999, // Out of bounds
        y: NaN,
        isMaximized: false,
      };
      const result = normalizeWindowState(input);
      expect(result.frame.width).toBe(1000);
      expect(result.frame.height).toBe(700);
      expect(result.frame.x).toBeUndefined();
      expect(result.frame.y).toBeUndefined();
    });
  });

  describe("WindowStateManager", () => {
    it("initializes with normalized bounds", () => {
      const manager = new WindowStateManager({
        width: 1100,
        height: 750,
        x: 100,
        y: 100,
        isMaximized: false,
      });

      expect(manager.getNormalBounds()).toEqual({
        width: 1100,
        height: 750,
        x: 100,
        y: 100,
      });
      expect(manager.isMaximized()).toBe(false);
    });

    it("updates normal bounds when window is not maximized", () => {
      let persisted: WindowStateConfig | null = null;
      const manager = new WindowStateManager(
        undefined,
        500,
        (state) => {
          persisted = state;
        },
      );

      const mockWindow = {
        ptr: 1,
        isMaximized: () => false,
        getFrame: () => ({ x: 250, y: 180, width: 1200, height: 800 }),
      };

      manager.updateFromWindow(mockWindow);
      expect(manager.getNormalBounds()).toEqual({
        x: 250,
        y: 180,
        width: 1200,
        height: 800,
      });
      expect(manager.isMaximized()).toBe(false);

      manager.flushSave();
      expect(persisted as WindowStateConfig | null).toEqual({
        x: 250,
        y: 180,
        width: 1200,
        height: 800,
        isMaximized: false,
      });
    });

    it("preserves normal bounds when window is maximized", () => {
      let persisted: WindowStateConfig | null = null;
      const initial: WindowStateConfig = {
        width: 1100,
        height: 700,
        x: 200,
        y: 150,
        isMaximized: false,
      };

      const manager = new WindowStateManager(
        initial,
        500,
        (state) => {
          persisted = state;
        },
      );

      // Window becomes maximized and frame expands to screen dimensions
      const mockWindow = {
        ptr: 1,
        isMaximized: () => true,
        getFrame: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      };

      manager.updateFromWindow(mockWindow);
      // Normal bounds must NOT be overwritten by the 1920x1080 maximized size
      expect(manager.getNormalBounds()).toEqual({
        x: 200,
        y: 150,
        width: 1100,
        height: 700,
      });
      expect(manager.isMaximized()).toBe(true);

      manager.flushSave();
      expect(persisted as WindowStateConfig | null).toEqual({
        x: 200,
        y: 150,
        width: 1100,
        height: 700,
        isMaximized: true,
      });
    });

    it("updates normal bounds when unmaximizing", () => {
      let persisted: WindowStateConfig | null = null;
      const manager = new WindowStateManager(
        { isMaximized: true, width: 1000, height: 700, x: 50, y: 50 },
        500,
        (state) => {
          persisted = state;
        },
      );

      expect(manager.isMaximized()).toBe(true);

      // User unmaximizes and moves the window
      const mockWindow = {
        ptr: 1,
        isMaximized: () => false,
        getFrame: () => ({ x: 120, y: 90, width: 1050, height: 720 }),
      };

      manager.updateFromWindow(mockWindow);
      expect(manager.getNormalBounds()).toEqual({
        x: 120,
        y: 90,
        width: 1050,
        height: 720,
      });
      expect(manager.isMaximized()).toBe(false);

      manager.flushSave();
      expect(persisted as WindowStateConfig | null).toEqual({
        x: 120,
        y: 90,
        width: 1050,
        height: 720,
        isMaximized: false,
      });
    });
  });
});
