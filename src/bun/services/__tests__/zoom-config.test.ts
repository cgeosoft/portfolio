import { describe, it, expect } from "bun:test";
import { loadConfig, updateConfig, saveConfig } from "../../config.js";

describe("Zoom Configuration and Persistence", () => {
  it("provides a default zoomLevel of 1.0 in DesktopConfig", () => {
    const config = loadConfig();
    expect(config.zoomLevel).toBeDefined();
    expect(typeof config.zoomLevel).toBe("number");
    expect(config.zoomLevel).toBeGreaterThanOrEqual(0.5);
    expect(config.zoomLevel).toBeLessThanOrEqual(2.5);
  });

  it("persists and updates zoomLevel across config updates", () => {
    const originalConfig = loadConfig();
    const originalZoom = originalConfig.zoomLevel ?? 1.0;

    try {
      const updated = updateConfig({ zoomLevel: 1.25 });
      expect(updated.zoomLevel).toBe(1.25);

      const reloaded = loadConfig();
      expect(reloaded.zoomLevel).toBe(1.25);
    } finally {
      saveConfig({ ...originalConfig, zoomLevel: originalZoom });
    }
  });

  it("normalizes invalid or out-of-range zoomLevel to 1.0 on load", () => {
    const originalConfig = loadConfig();
    const originalZoom = originalConfig.zoomLevel ?? 1.0;

    try {
      // Intentionally write an out-of-bounds zoom
      updateConfig({ zoomLevel: 99.0 });
      const reloaded = loadConfig();
      expect(reloaded.zoomLevel).toBe(1.0);
    } finally {
      saveConfig({ ...originalConfig, zoomLevel: originalZoom });
    }
  });
});
