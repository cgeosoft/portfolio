/**
 * Window geometry persisted by the desktop shell in `window-state.json`
 * (user data dir). The service knows nothing about windows.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WindowStateConfig } from "portfolio-shared/config-types";

export const MIN_WINDOW_WIDTH = 400;
export const MIN_WINDOW_HEIGHT = 300;
export const MAX_WINDOW_DIMENSION = 10000;
export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_COORD = -10000;
export const MAX_WINDOW_COORD = 30000;

export interface NormalizedWindowState {
  frame: { width: number; height: number; x?: number; y?: number };
  isMaximized: boolean;
}

export interface WindowTarget {
  ptr?: unknown;
  isMaximized: () => boolean;
  getFrame: () => { x: number; y: number; width: number; height: number };
}

/** Validates saved window state; out-of-range values fall back to the defaults. */
export function normalizeWindowState(saved?: WindowStateConfig): NormalizedWindowState {
  let width = DEFAULT_WINDOW_WIDTH;
  if (typeof saved?.width === "number" && Number.isFinite(saved.width) && saved.width >= MIN_WINDOW_WIDTH && saved.width <= MAX_WINDOW_DIMENSION) {
    width = Math.round(saved.width);
  }
  let height = DEFAULT_WINDOW_HEIGHT;
  if (typeof saved?.height === "number" && Number.isFinite(saved.height) && saved.height >= MIN_WINDOW_HEIGHT && saved.height <= MAX_WINDOW_DIMENSION) {
    height = Math.round(saved.height);
  }
  let x: number | undefined;
  let y: number | undefined;
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
  return { frame: { width, height, x, y }, isMaximized: Boolean(saved?.isMaximized) };
}

export function readWindowState(file: string): WindowStateConfig | undefined {
  try {
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf-8")) as WindowStateConfig;
  } catch {
    return undefined;
  }
}

export function writeWindowState(file: string, state: WindowStateConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Tracks window geometry, debounces and persists it through `onPersist`. */
export class WindowStateManager {
  private normalBounds: { width: number; height: number; x?: number; y?: number };
  private isCurrentlyMaximized: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initialState: WindowStateConfig | undefined,
    private readonly onPersist: (state: WindowStateConfig) => void,
    private readonly saveDebounceMs = 500,
  ) {
    const normalized = normalizeWindowState(initialState);
    this.normalBounds = { ...normalized.frame };
    this.isCurrentlyMaximized = normalized.isMaximized;
  }

  getNormalBounds(): { width: number; height: number; x?: number; y?: number } {
    return { ...this.normalBounds };
  }

  isMaximized(): boolean {
    return this.isCurrentlyMaximized;
  }

  updateFromWindow(window: WindowTarget): void {
    try {
      if (!window.ptr) return;
      const maximized = window.isMaximized();
      this.isCurrentlyMaximized = maximized;
      if (!maximized) {
        const frame = window.getFrame();
        if (typeof frame.width === "number" && frame.width >= MIN_WINDOW_WIDTH && typeof frame.height === "number" && frame.height >= MIN_WINDOW_HEIGHT) {
          this.normalBounds = { width: Math.round(frame.width), height: Math.round(frame.height), x: Math.round(frame.x), y: Math.round(frame.y) };
        }
      }
      this.scheduleSave();
    } catch {
      // A window that is already gone.
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, this.saveDebounceMs);
  }

  flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.onPersist({ x: this.normalBounds.x, y: this.normalBounds.y, width: this.normalBounds.width, height: this.normalBounds.height, isMaximized: this.isCurrentlyMaximized });
    } catch {
      // Persisting is best effort.
    }
  }
}
