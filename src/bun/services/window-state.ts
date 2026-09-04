import type { WindowStateConfig } from "../config.js";
import { updateConfig } from "../config.js";
import { appLogger } from "../logger.js";

export const MIN_WINDOW_WIDTH = 400;
export const MIN_WINDOW_HEIGHT = 300;
export const MAX_WINDOW_DIMENSION = 10000;
export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_COORD = -10000;
export const MAX_WINDOW_COORD = 30000;

export interface NormalizedWindowState {
  frame: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  isMaximized: boolean;
}

export interface WindowTarget {
  ptr?: unknown;
  isMaximized: () => boolean;
  getFrame: () => { x: number; y: number; width: number; height: number };
}

/**
 * Validate and normalize saved window state.
 * Returns safe default dimensions when saved values are invalid or out of range.
 */
export function normalizeWindowState(saved?: WindowStateConfig): NormalizedWindowState {
  let width = DEFAULT_WINDOW_WIDTH;
  if (
    typeof saved?.width === "number" &&
    Number.isFinite(saved.width) &&
    saved.width >= MIN_WINDOW_WIDTH &&
    saved.width <= MAX_WINDOW_DIMENSION
  ) {
    width = Math.round(saved.width);
  }

  let height = DEFAULT_WINDOW_HEIGHT;
  if (
    typeof saved?.height === "number" &&
    Number.isFinite(saved.height) &&
    saved.height >= MIN_WINDOW_HEIGHT &&
    saved.height <= MAX_WINDOW_DIMENSION
  ) {
    height = Math.round(saved.height);
  }

  let x: number | undefined = undefined;
  let y: number | undefined = undefined;

  if (
    typeof saved?.x === "number" &&
    Number.isFinite(saved.x) &&
    saved.x >= MIN_WINDOW_COORD &&
    saved.x <= MAX_WINDOW_COORD &&
    typeof saved?.y === "number" &&
    Number.isFinite(saved.y) &&
    saved.y >= MIN_WINDOW_COORD &&
    saved.y <= MAX_WINDOW_COORD
  ) {
    x = Math.round(saved.x);
    y = Math.round(saved.y);
  }

  return {
    frame: {
      width,
      height,
      x,
      y,
    },
    isMaximized: Boolean(saved?.isMaximized),
  };
}

/**
 * Manages window state tracking, debouncing, and disk persistence.
 */
export class WindowStateManager {
  private normalBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  private isCurrentlyMaximized: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly saveDebounceMs: number;
  private readonly onPersist: (state: WindowStateConfig) => void;

  constructor(
    initialState?: WindowStateConfig,
    saveDebounceMs = 500,
    onPersist: (state: WindowStateConfig) => void = (state) => updateConfig({ windowState: state }),
  ) {
    const normalized = normalizeWindowState(initialState);
    this.normalBounds = { ...normalized.frame };
    this.isCurrentlyMaximized = normalized.isMaximized;
    this.saveDebounceMs = saveDebounceMs;
    this.onPersist = onPersist;
  }

  public getNormalBounds(): { width: number; height: number; x?: number; y?: number } {
    return { ...this.normalBounds };
  }

  public isMaximized(): boolean {
    return this.isCurrentlyMaximized;
  }

  public updateFromWindow(window: WindowTarget): void {
    try {
      if (!window.ptr) return;
      const maximized = window.isMaximized();
      this.isCurrentlyMaximized = maximized;

      if (!maximized) {
        const frame = window.getFrame();
        if (
          typeof frame.width === "number" &&
          frame.width >= MIN_WINDOW_WIDTH &&
          typeof frame.height === "number" &&
          frame.height >= MIN_WINDOW_HEIGHT
        ) {
          this.normalBounds = {
            width: Math.round(frame.width),
            height: Math.round(frame.height),
            x: Math.round(frame.x),
            y: Math.round(frame.y),
          };
        }
      }
      this.scheduleSave();
    } catch (err) {
      appLogger.log("warning", `Failed to read window frame: ${err}`);
    }
  }

  public scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, this.saveDebounceMs);
  }

  public flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.onPersist({
        x: this.normalBounds.x,
        y: this.normalBounds.y,
        width: this.normalBounds.width,
        height: this.normalBounds.height,
        isMaximized: this.isCurrentlyMaximized,
      });
    } catch (err) {
      appLogger.log("warning", `Failed to persist window state: ${err}`);
    }
  }
}
