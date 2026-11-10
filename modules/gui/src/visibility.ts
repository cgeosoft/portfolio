/** True while the window is hidden: minimised, on another workspace or in a background tab. */
export function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/**
 * A `setInterval` that does no work while the window is hidden. A tick in a hidden window is
 * skipped. When the window shows again after a skipped tick, `fn` runs one time at once.
 * Returns the function that stops the timer and removes the listener.
 */
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  let skipped = false;
  const timer = setInterval(() => {
    if (isPageHidden()) {
      skipped = true;
      return;
    }
    fn();
  }, ms);
  const onVisibilityChange = () => {
    if (isPageHidden() || !skipped) return;
    skipped = false;
    fn();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
