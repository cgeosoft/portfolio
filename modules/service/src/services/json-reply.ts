/** Reading JSON out of a model reply. */

/** Find the first JSON object in the reply; models sometimes wrap it in a code fence or text. */
export function extractJsonObject(reply: string): Record<string, unknown> {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The assistant did not return a JSON object");
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("The assistant returned JSON that is not valid");
  }
}
