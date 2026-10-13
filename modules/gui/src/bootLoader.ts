/** The shortest time the boot loader stays on screen, so a fast start does not flash it. */
const MIN_VISIBLE_MS = 2000;

let hiding = false;

/**
 * Fades out and removes the static boot loader of `index.html`, at least `MIN_VISIBLE_MS` after
 * its content showed (the inline script of `index.html` records that time). `immediate` skips the
 * wait, for an error screen. Safe to call more than once.
 */
export function hideBootLoader(immediate = false): void {
  const el = document.getElementById("boot-loader");
  if (!el || el.classList.contains("hide") || (hiding && !immediate)) return;
  hiding = true;
  const shownAt = Number(document.documentElement.dataset.bootShownAt) || 0;
  const wait = immediate ? 0 : Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
  setTimeout(() => {
    if (el.classList.contains("hide")) return;
    el.classList.add("hide");
    setTimeout(() => el.remove(), 350);
  }, wait);
}
