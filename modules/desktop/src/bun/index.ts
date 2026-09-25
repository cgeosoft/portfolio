/**
 * Desktop shell: one window around the service. This file is the same in Portfolio and in
 * FintechCrafts Management; `app.ts` holds what differs.
 *
 * Packaged app: the shell starts `<appDir>/service/main.js` under its own runtime, with no
 * arguments and no variables of its own. The service binds a random loopback port and prints
 * `SERVICE_PORT=<port>`; the shell reads that line, waits until `/api/health` answers and points
 * the window at `http://127.0.0.1:<port>`. The service serves the GUI itself.
 *
 * Development (`bun start`, an unpackaged shell inside a checkout): the shell runs the service
 * and the Vite dev server from source and points the window at Vite. See `dev.ts`.
 *
 * Files: the user data directory (`userDataDir` in `app.ts`, the same rule as the service's `paths.ts`)
 * holds `window-state.json`, and `logs/` with this shell's `desktop-YYYY-MM-DD.log` and the
 * service output in `service-YYYY-MM-DD.log`. The service never opens a log file.
 *
 * The window closes into the system tray when the "Close to tray" setting is on (the service
 * mirrors it into `<data>/desktop-settings.json`, which the shell reads at close time). The tray
 * menu and File > Quit end the app. Without a tray the close button quits.
 */
import Electrobun, { BrowserWindow, BuildConfig, PATHS, Tray, Utils } from "electrobun/bun";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP, userDataDir } from "./app";
import { DevGuiServer, devServiceCommand, findRepoRoot } from "./dev";
import { installDesktopEntry, setNativeWindowIcon } from "./linux-desktop";
import { failedPage, startingPage } from "./pages";
import { ServiceProcess } from "./service";
import { WindowStateManager, normalizeWindowState, readWindowState, writeWindowState } from "./window-state";

const STARTUP_TIMEOUT_MS = 60_000;
const DEV_GUI_TIMEOUT_MS = 60_000;

/** The switch the service writes for us. Defaults to "close to tray" when the file is missing. */
function readCloseToTray(dataDir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "desktop-settings.json"), "utf-8")) as { closeToTray?: unknown };
    return parsed.closeToTray !== false;
  } catch {
    return true;
  }
}

/** The tray icon: the bundled PNG, or the checkout's asset in a development run. */
function trayIconPath(appDir: string, repoRoot: string | undefined): string | undefined {
  const assets = repoRoot ? join(repoRoot, "modules", "desktop", "assets") : undefined;
  const candidates = [
    join(appDir, "icons", "app-icon-32x32.png"),
    join(appDir, "app-icon.png"),
    ...(assets ? [join(assets, "app-icon-32x32.png"), join(assets, "app-icon.png")] : []),
  ];
  return candidates.find((p) => existsSync(p));
}

async function main(): Promise<void> {
  const build = await BuildConfig.get();
  const appDir = join(PATHS.RESOURCES_FOLDER, "app");
  const dataDir = userDataDir();
  const logDir = join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  // An unpackaged shell inside a checkout runs everything from source (dev.ts). Without a
  // checkout it falls back to the staged bundle.
  const repoRoot = build.isPackaged ? undefined : findRepoRoot(appDir);
  const echo = !build.isPackaged;

  const windowStateFile = join(dataDir, "window-state.json");
  const savedWindowState = readWindowState(windowStateFile);
  const windowState = normalizeWindowState(savedWindowState);
  const windowStateManager = new WindowStateManager(savedWindowState, (state) => writeWindowState(windowStateFile, state));

  const mainWindow = new BrowserWindow({
    title: APP.windowTitle,
    html: startingPage(),
    frame: { width: windowState.frame.width, height: windowState.frame.height, x: windowState.frame.x, y: windowState.frame.y },
  });
  if (windowState.isMaximized) {
    try {
      mainWindow.maximize();
    } catch {
      // Best effort.
    }
  }
  mainWindow.on("resize", () => windowStateManager.updateFromWindow(mainWindow));
  mainWindow.on("move", () => windowStateManager.updateFromWindow(mainWindow));

  if (process.platform === "linux") {
    installDesktopEntry({ packaged: build.isPackaged, appDir, repoRoot });
    if (mainWindow.ptr) setNativeWindowIcon(mainWindow.ptr, appDir);
  }

  // Set once the window shows the app: the service URL, or the Vite URL in development.
  let appUrl: string | null = null;

  // target=_blank and ctrl/cmd-click: keep app routes in a window of their own, hand
  // everything else (https, mailto) to the system.
  Electrobun.events.on("new-window-open", (event: { data: { detail: string | { url: string } } }) => {
    const detail = event.data.detail;
    const url = typeof detail === "string" ? detail : detail?.url;
    if (!url) return;
    if (appUrl && url.startsWith(`${appUrl}/`)) {
      new BrowserWindow({ title: APP.windowTitle, url, frame: { width: APP.popup.width, height: APP.popup.height } });
    } else if (/^(https?:|mailto:)/i.test(url)) {
      Utils.openExternal(url);
    }
  });

  const service = new ServiceProcess(
    repoRoot
      ? { ...devServiceCommand(repoRoot), logDir, echo }
      : { command: [process.execPath, join(appDir, "service", "main.js")], cwd: join(appDir, "service"), logDir, echo },
  );
  const devGui = repoRoot ? new DevGuiServer(repoRoot, logDir) : null;

  let ready = false;
  let quitting = false;

  function shutdown(): void {
    windowStateManager.flushSave();
    service.stop();
    devGui?.stop();
  }

  function quit(code = 0): void {
    if (quitting) return;
    quitting = true;
    shutdown();
    Utils.quit(code);
  }

  // ---- system tray ----------------------------------------------------------------------
  // Created once; without a tray the close button quits (nothing could bring the window back).
  let tray: Tray | null = null;
  const showWindow = () => {
    try {
      if (mainWindow.isMinimized()) mainWindow.unminimize();
      mainWindow.show();
    } catch {
      // Best effort.
    }
  };
  try {
    const image = trayIconPath(appDir, repoRoot);
    tray = new Tray({ title: build.isPackaged ? "" : APP.tray.devTitle, image: image ?? "", template: false, width: 22, height: 22 });
    if (!tray.visible) tray = null;
  } catch (err) {
    service.log(`tray unavailable: ${err instanceof Error ? err.message : String(err)}`);
    tray = null;
  }
  if (tray) {
    tray.setMenu([
      { type: "normal", label: APP.tray.show, action: "show" },
      { type: "divider" },
      { type: "normal", label: APP.tray.quit, action: "quit" },
    ]);
    tray.on("tray-clicked", (event: unknown) => {
      const action = (event as { data?: { action?: string } })?.data?.action ?? "";
      if (action === "quit") quit(0);
      else showWindow();
    });
  }

  // Close button: hide into the tray when the setting is on and a tray exists, else quit.
  mainWindow.on("will-close", (event: unknown) => {
    const e = event as { response?: { allow: boolean } };
    windowStateManager.updateFromWindow(mainWindow);
    windowStateManager.flushSave();
    if (quitting) return;
    if (tray && readCloseToTray(dataDir)) {
      e.response = { allow: false };
      mainWindow.hide();
      return;
    }
    quit(0);
  });

  process.on("exit", shutdown);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => quit(0));
  }

  service.onPort((port) => {
    service.log(`service listening on 127.0.0.1:${port}`);
    // A restart under --watch picks a new port; the Vite proxy follows it.
    devGui?.setServicePort(port);
  });
  service.start((code) => {
    if (quitting) return;
    if (ready && code === 0) {
      // File > Quit asks the service to exit cleanly; a crash shows the log.
      quit(0);
    } else if (ready) {
      showWindow();
      mainWindow.webview.loadHTML(failedPage(service.serviceLogFile, service.tail(), dataDir));
    }
  });
  service.log(`${repoRoot ? `development run from ${repoRoot}` : "starting the bundled service"} (data ${dataDir})`);

  // In development a failed start is fixed in the editor and bun --watch restarts the service,
  // so keep waiting instead of giving up.
  ready = await service.waitUntilReady(repoRoot ? Number.POSITIVE_INFINITY : STARTUP_TIMEOUT_MS);
  if (!ready || service.port === null) {
    service.stop();
    mainWindow.webview.loadHTML(failedPage(service.serviceLogFile, service.tail(), dataDir));
    return;
  }

  if (devGui) {
    devGui.start(service.port);
    const guiUrl = await devGui.waitForUrl(DEV_GUI_TIMEOUT_MS);
    if (!guiUrl) {
      service.log("the Vite dev server did not report its URL");
      mainWindow.webview.loadHTML(failedPage(service.serviceLogFile, devGui.tail(), dataDir, "The Vite dev server did not start."));
      return;
    }
    appUrl = guiUrl;
  } else {
    appUrl = `http://127.0.0.1:${service.port}`;
  }
  service.log(`window on ${appUrl}`);
  mainWindow.webview.loadURL(appUrl);
}

void main();
