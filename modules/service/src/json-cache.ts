/**
 * JSON text of large, read-only payloads (the portfolio data), kept next to
 * the object so the disk cache write and every GET reuse one serialization.
 * Only objects passed to `rememberJson` are tracked: they must not change
 * after that, or the text goes stale.
 */
const texts = new WeakMap<object, string>();

/** Serializes `data` once and keeps the text for as long as the object lives. */
export function rememberJson(data: object, json?: string): string {
  const known = texts.get(data);
  if (known !== undefined) return known;
  const text = json ?? JSON.stringify(data);
  texts.set(data, text);
  return text;
}

/** The kept text of `data`, else a fresh `JSON.stringify`. */
export function toJson(data: unknown): string {
  if (data && typeof data === "object") {
    const known = texts.get(data);
    if (known !== undefined) return known;
  }
  return JSON.stringify(data ?? null);
}
