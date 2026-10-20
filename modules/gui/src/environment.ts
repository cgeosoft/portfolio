/** Vendor identity and links (shared with the service). */
export { WEBPAGE_URL, SUPPORT_EMAIL as WEBPAGE_EMAIL, VENDOR_URL, APP_NAME } from "portfolio-shared/brand";

export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

/**
 * Opens a URL outside the app. With target=_blank the desktop shell hands
 * http(s) and mailto links to the system browser or mail client; in a normal
 * browser they open in a new tab. One anchor click only: window.open with
 * "noopener" always returns null, so a window.open-then-anchor fallback sent
 * every link to the shell twice.
 */
export function openExternal(url: string): boolean {
  const trimmed = (url || "").trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return false;
  const a = document.createElement("a");
  a.href = trimmed;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

/** Triggers a browser download of text or binary content. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
