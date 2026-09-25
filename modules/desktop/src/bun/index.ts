/**
 * Portfolio desktop: a thin shell around the service and the GUI.
 *
 * It starts the bundled service as a child process, waits until /api/health
 * answers on loopback and points a single window at it. The service serves
 * the GUI itself and owns the "allow remote connections" switch (Settings →
 * Access), so nothing else lives here.
 *
 * Live development (`bun start`, `modules/desktop/scripts/dev.ts`) sets
 * `PORTFOLIO_DEV_GUI_URL`, `PORTFOLIO_DEV_SERVICE_DIR` and `PORTFOLIO_DEV_BUN`.
 * The shell then runs the service from source under `bun --watch` (it
 * restarts on every change) and points the window at the Vite dev server
 * (hot reload), which proxies `/api` to the service. The staged bundle is
 * not used.
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

interface DevMode {
  guiUrl: string;
  serviceDir: string;
  bun: string;
}

/** The live development setup, when `scripts/dev.ts` started the shell. */
function readDevMode(): DevMode | null {
  const guiUrl = process.env.PORTFOLIO_DEV_GUI_URL?.trim();
  const serviceDir = process.env.PORTFOLIO_DEV_SERVICE_DIR?.trim();
  const bun = process.env.PORTFOLIO_DEV_BUN?.trim();
  return guiUrl && serviceDir && bun ? { guiUrl: guiUrl.replace(/\/+$/, ""), serviceDir, bun } : null;
}

async function main(): Promise<void> {
  const build = await BuildConfig.get();
  const appDir = join(PATHS.RESOURCES_FOLDER, "app");
  const userData = Utils.paths.userData;
  const logDir = Utils.paths.userLogs;
  mkdirSync(userData, { recursive: true });

  const port = Number(process.env.PORTFOLIO_PORT) || DEFAULT_PORT;
  const dev = build.isPackaged ? null : readDevMode();
  const appUrl = dev ? dev.guiUrl : `http://127.0.0.1:${port}`;
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
  const serviceEnv = {
    ...process.env,
    NODE_ENV: build.isPackaged ? "production" : process.env.NODE_ENV || "development",
    PORTFOLIO_PORT: String(port),
    PORTFOLIO_LOG_DIR: logDir,
    PORTFOLIO_LAUNCHER: process.execPath,
  };
  // In live development the service reads the version and the sponsor pages
  // from the checkout and the Vite dev server serves the GUI, so only the
  // bundle needs the paths spelled out.
  const service = dev
    ? new ServiceProcess({
        serviceDir: dev.serviceDir,
        command: [dev.bun, "--watch", "src/main.ts"],
        port,
        logDir,
        echo: true,
        env: serviceEnv,
      })
    : new ServiceProcess({
        serviceDir: join(appDir, "service"),
        port,
        logDir,
        echo: !build.isPackaged,
        env: {
          ...serviceEnv,
          PORTFOLIO_GUI_DIR: join(appDir, "gui"),
          PORTFOLIO_SPONSOR_FILE: join(appDir, "sponsor.html"),
          PORTFOLIO_SPONSOR_LIGHT_FILE: join(appDir, "sponsor-light.html"),
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
  service.log(`service starting on port ${port}, window on ${appUrl} (data ${userData}, logs ${logDir})`);

  // In live development a failed start is fixed in the editor and bun --watch
  // restarts the service, so keep waiting instead of giving up.
  ready = await service.waitUntilReady(dev ? Number.POSITIVE_INFINITY : STARTUP_TIMEOUT_MS);
  if (ready) {
    mainWindow.webview.loadURL(appUrl);
  } else {
    service.stop();
    mainWindow.webview.loadHTML(failedPage(service.serviceLogFile, service.tail()));
  }
}

void main();
