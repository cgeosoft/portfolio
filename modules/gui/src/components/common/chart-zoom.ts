import { DomPlatform } from "chart.js";

/**
 * Chart.js sizes a chart from `container.getBoundingClientRect()` when it measures
 * the container itself (on creation, attach and device pixel ratio changes). Under
 * standardized CSS zoom on the root element that rect is in zoomed pixels, while
 * the ResizeObserver path passes the unzoomed content box. A chart created at a
 * saved zoom other than 100% came out too large and inflated its flex container,
 * so later resizes kept the wrong height. Measure the content box in the
 * container's own CSS pixels instead, the same units the ResizeObserver reports.
 */
export function containerContentSize(canvas: HTMLCanvasElement): { width: number; height: number } | null {
  const container = canvas.parentNode as HTMLElement | null;
  if (!container || typeof container.clientWidth !== "number") return null;
  const { clientWidth, clientHeight } = container;
  if (!clientWidth && !clientHeight) return null;
  const style = getComputedStyle(container);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  return { width: Math.max(0, clientWidth - padX), height: Math.max(0, clientHeight - padY) };
}

let installed = false;

/** Patches every Chart.js chart once; call before the first chart is created. */
export function installChartZoomFix(): void {
  if (installed) return;
  installed = true;
  const measure = DomPlatform.prototype.getMaximumSize;
  DomPlatform.prototype.getMaximumSize = function (canvas, width, height, aspectRatio) {
    if (width === undefined || height === undefined) {
      const size = containerContentSize(canvas);
      if (size) return measure.call(this, canvas, size.width, size.height, aspectRatio);
    }
    return measure.call(this, canvas, width, height, aspectRatio);
  };
}
