/** Fades out and removes the static boot loader of `index.html`. Safe to call more than once. */
export function hideBootLoader(): void {
  const el = document.getElementById("boot-loader");
  if (!el || el.classList.contains("hide")) return;
  el.classList.add("hide");
  setTimeout(() => el.remove(), 350);
}
