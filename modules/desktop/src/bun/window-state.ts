/**
 * Window geometry persisted by the desktop shell in `<data>/window-state.json`.
 * The service knows nothing about windows.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { APP } from "./app";

export interface WindowStateConfig {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
}

export const MIN_WINDOW_WIDTH = 400;
export const MIN_WINDOW_HEIGHT = 300;
export const MAX_WINDOW_DIMENSION = 10000;
export const DEFAULT_WINDOW_WIDTH: number = APP.window.width;
export const DEFAULT_WINDOW_HEIGHT: number = APP.window.height;
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

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Validates saved window state; out-of-range values fall back to the defaults. */
export function normalizeWindowState(saved?: WindowStateConfig): NormalizedWindowState {
  const width = inRange(saved?.width, MIN_WINDOW_WIDTH, MAX_WINDOW_DIMENSION) ? Math.round(saved!.width!) : DEFAULT_WINDOW_WIDTH;
  const height = inRange(saved?.height, MIN_WINDOW_HEIGHT, MAX_WINDOW_DIMENSION) ? Math.round(saved!.height!) : DEFAULT_WINDOW_HEIGHT;
  let x: number | undefined;
  let y: number | undefined;
  if (inRange(saved?.x, MIN_WINDOW_COORD, MAX_WINDOW_COORD) && inRange(saved?.y, MIN_WINDOW_COORD, MAX_WINDOW_COORD)) {
    x = Math.round(saved!.x!);
    y = Math.round(saved!.y!);
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
        if (frame.width >= MIN_WINDOW_WIDTH && frame.height >= MIN_WINDOW_HEIGHT) {
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
      this.onPersist({ ...this.normalBounds, isMaximized: this.isCurrentlyMaximized });
    } catch {
      // Persisting is best effort.
    }
  }
}
