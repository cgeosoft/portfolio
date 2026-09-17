/**
 * Portfolio desktop: a thin shell around the service and the GUI.
 *
 * It starts the bundled service as a child process, waits until /api/health
 * answers on loopback and points a single window at it. The service serves
 * the GUI itself and owns the "allow remote connections" switch (Settings →
 * Access), so nothing else lives here.
 */
import Electrobun, { BrowserWindow, BuildConfig, PATHS, Utils } from "electrobun/bun";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { failedPage, startingPage } from "./pages";
import { ServiceProcess } from "./service";
import { WindowStateManager, normalizeWindowState, readWindowState, writeWindowState } from "./window-state";
import { setNativeWindowIcon, setupLinuxDesktop } from "./linux-desktop";

const STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_PORT = 5130;

async function main(): Promise<void> {
  const build = await BuildConfig.get();
  const appDir = join(PATHS.RESOURCES_FOLDER, "app");
  const userData = Utils.paths.userData;
  const logDir = Utils.paths.userLogs;
  mkdirSync(userData, { recursive: true });

  const port = Number(process.env.PORTFOLIO_PORT) || DEFAULT_PORT;
  const appUrl = `http://127.0.0.1:${port}`;
  const windowStateFile = join(userData, "window-state.json");
  const windowState = normalizeWindowState(readWindowState(windowStateFile));
  const windowStateManager = new WindowStateManager(readWindowState(windowStateFile), (state) => writeWindowState(windowStateFile, state));

  const mainWindow = new BrowserWindow({
    title: "Portfolio",
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
  mainWindow.on("will-close", () => {
    windowStateManager.updateFromWindow(mainWindow);
    windowStateManager.flushSave();
  });

  if (process.platform === "linux") {
    if (!build.isPackaged) setupLinuxDesktop();
    if (mainWindow.ptr) setNativeWindowIcon(mainWindow.ptr);
  }

  // target=_blank and ctrl/cmd-click: keep app routes in a window of their
  // own, hand everything else (https, mailto) to the system.
  Electrobun.events.on("new-window-open", (event: { data: { detail: string | { url: string } } }) => {
    const detail = event.data.detail;
    const url = typeof detail === "string" ? detail : detail?.url;
    if (!url) return;
    if (url.startsWith(`${appUrl}/`)) {
      new BrowserWindow({ title: "Portfolio", url, frame: { width: 960, height: 760 } });
    } else if (/^(https?:|mailto:)/i.test(url)) {
      Utils.openExternal(url);
    }
  });

  function getDesktopVersion(): string | undefined {
    for (const candidate of [join(appDir, "service", "version.txt"), join(appDir, "version.txt")]) {
      try {
        if (existsSync(candidate)) {
          const v = readFileSync(candidate, "utf-8").trim();
          if (v) return v;
        }
      } catch {
        // Ignore
      }
    }
    return undefined;
  }

  const desktopVersion = getDesktopVersion();
  const service = new ServiceProcess({
    serviceDir: join(appDir, "service"),
    port,
    logDir,
    echo: !build.isPackaged,
    env: {
      ...process.env,
      NODE_ENV: build.isPackaged ? "production" : process.env.NODE_ENV || "development",
      PORTFOLIO_PORT: String(port),
      PORTFOLIO_LOG_DIR: logDir,
      PORTFOLIO_GUI_DIR: join(appDir, "gui"),
      PORTFOLIO_SPONSOR_FILE: join(appDir, "sponsor.html"),
      PORTFOLIO_LAUNCHER: process.execPath,
      ...(desktopVersion ? { PORTFOLIO_VERSION: desktopVersion } : {}),
    },
  });

  let ready = false;
  function shutdown(): void {
    windowStateManager.flushSave();
    service.stop();
  }
  mainWindow.on("close", shutdown);
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    Utils.quit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    Utils.quit(0);
  });

  service.start((code) => {
    // File → Quit asks the service to exit cleanly; a crash shows the log.
    if (ready && code === 0) {
      windowStateManager.flushSave();
      Utils.quit(0);
    } else if (ready) {
      mainWindow.webview.loadHTML(failedPage(service.serviceLogFile, service.tail()));
    }
  });
  service.log(`service starting on ${appUrl} (data ${userData}, logs ${logDir})`);

  ready = await service.waitUntilReady(STARTUP_TIMEOUT_MS);
  if (ready) {
    mainWindow.webview.loadURL(appUrl);
  } else {
    service.stop();
    mainWindow.webview.loadHTML(failedPage(service.serviceLogFile, service.tail()));
  }
}

void main();
