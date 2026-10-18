/**
 * File operations for the desktop window (a client on this machine): saving a
 * generated file into the user's Downloads folder, revealing it in the file
 * manager and asking for a folder with the system dialog. Remote clients use browser downloads instead; the routes
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

/** Runs a dialog command; its trimmed stdout on exit code 0, null otherwise (cancelled). */
async function runDialog(command: string[]): Promise<string | null> {
  const proc = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const path = out.trim();
  return code === 0 && path ? path : null;
}

/**
 * Asks the user for a folder with the system dialog, opened on `startDir`.
 * Null when the user cancels. Undefined when this system has no dialog the
 * service can open (Linux without zenity or kdialog): the caller then uses
 * `startDir`.
 */
export async function pickFolder(startDir: string, title: string): Promise<string | null | undefined> {
  if (process.platform === "darwin") {
    const quoted = (text: string) => `"${text.replace(/["\\]/g, "\\$&")}"`;
    const script = `POSIX path of (choose folder with prompt ${quoted(title)} default location (POSIX file ${quoted(startDir)}))`;
    return runDialog(["osascript", "-e", script]);
  }
  if (process.platform === "win32") {
    // PowerShell also ends a single-quoted string at the typographic quotes U+2018 to U+201B: double each of them too.
    const quoted = (text: string) => `'${text.replace(/['\u2018-\u201B]/g, "$&$&")}'`;
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = ${quoted(title)}`,
      `$dialog.SelectedPath = ${quoted(startDir)}`,
      "if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) }",
    ].join("; ");
    return runDialog(["powershell", "-NoProfile", "-STA", "-Command", script]);
  }
  if (Bun.which("zenity")) {
    return runDialog(["zenity", "--file-selection", "--directory", `--title=${title}`, `--filename=${startDir}${sep}`]);
  }
  if (Bun.which("kdialog")) {
    return runDialog(["kdialog", "--title", title, "--getexistingdirectory", startDir]);
  }
  return undefined;
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
