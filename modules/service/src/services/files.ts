/**
 * File operations for the desktop window (a client on this machine): saving a
 * generated file into the user's Downloads folder and revealing it in the
 * file manager. Remote clients use browser downloads instead; the routes
 * refuse them.
 *
 * The files hold portfolio data (reports, a database backup with the API
 * keys), so they are written readable by the user only (mode 0600 where the
 * file system has modes).
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, basename, resolve, sep } from "node:path";
import { homedir } from "node:os";

const PRIVATE_FILE = { mode: 0o600 };

export function downloadsDir(): string {
  const dir = join(homedir(), "Downloads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A path in Downloads under a safe version of `fileName` that does not exist yet. */
function freeDownloadPath(fileName: string): string {
  const safeName = basename(fileName).replace(/[\\/:*?"<>|]/g, "_").trim() || "portfolio-file";
  let target = join(downloadsDir(), safeName);
  if (existsSync(target)) {
    const dot = safeName.lastIndexOf(".");
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : "";
    target = join(downloadsDir(), `${stem}-${Date.now()}${ext}`);
  }
  return target;
}

/** Writes `content` (text) or `base64Data` under a safe name in Downloads. */
export function saveToDownloads(fileName: string, content?: string, base64Data?: string): string {
  const target = freeDownloadPath(fileName);
  if (base64Data) writeFileSync(target, Buffer.from(base64Data, "base64"), PRIVATE_FILE);
  else writeFileSync(target, content ?? "", { ...PRIVATE_FILE, encoding: "utf-8" });
  return target;
}

/** Writes raw bytes (a database backup) under a safe name in Downloads. */
export function saveBytesToDownloads(fileName: string, bytes: Uint8Array): string {
  const target = freeDownloadPath(fileName);
  writeFileSync(target, bytes, PRIVATE_FILE);
  return target;
}

/**
 * Opens the file manager on a file the app saved in Downloads. The path comes
 * from the client, so anything outside Downloads is refused: the window only
 * reveals the reports, backups and support files it saved there.
 */
export function revealInFileManager(filePath: string): { success: boolean; error?: string } {
  try {
    const downloads = downloadsDir();
    const targetPath = resolve(filePath);
    if (targetPath !== downloads && !targetPath.startsWith(downloads + sep)) {
      return { success: false, error: "Only files in the Downloads folder can be revealed" };
    }
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
