/**
 * File operations for the desktop window (a client on this machine): saving a
 * generated file into the user's Downloads folder and revealing it in the
 * file manager. Remote clients use browser downloads instead; the routes
 * refuse them.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { homedir } from "node:os";

export function downloadsDir(): string {
  const dir = join(homedir(), "Downloads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes `content` (text) or `base64Data` under a safe name in Downloads. */
export function saveToDownloads(fileName: string, content?: string, base64Data?: string): string {
  const safeName = basename(fileName).replace(/[\\/:*?"<>|]/g, "_").trim() || "portfolio-file";
  let target = join(downloadsDir(), safeName);
  if (existsSync(target)) {
    const dot = safeName.lastIndexOf(".");
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : "";
    target = join(downloadsDir(), `${stem}-${Date.now()}${ext}`);
  }
  if (base64Data) writeFileSync(target, Buffer.from(base64Data, "base64"));
  else writeFileSync(target, content ?? "", "utf-8");
  return target;
}

/** Opens the file manager on a file or directory. */
export function revealInFileManager(targetPath: string): { success: boolean; error?: string } {
  try {
    if (!existsSync(targetPath)) return { success: false, error: "Target path does not exist" };
    if (process.platform === "win32") {
      Bun.spawn(["explorer", `/select,${targetPath}`]);
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", "-R", targetPath]);
    } else {
      const folder = statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
      Bun.spawn(["xdg-open", folder]);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
