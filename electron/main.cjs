const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAIN_LOG_PATH = path.join(os.tmpdir(), "riverside-main.log");

const appendMainLog = (line) => {
  try {
    fs.appendFileSync(MAIN_LOG_PATH, `${new Date().toISOString()} ${line}${os.EOL}`);
  } catch {
    // ignore
  }
};

process.on("uncaughtException", (err) => {
  appendMainLog(`uncaughtException ${err?.stack || err}`);
});

process.on("unhandledRejection", (reason) => {
  appendMainLog(`unhandledRejection ${reason?.stack || reason}`);
});

if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawn } = require("node:child_process");

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  appendMainLog("ELECTRON_RUN_AS_NODE detected, relaunching without it.");

  spawn(process.execPath, process.argv.slice(1), {
    env,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  }).unref();

  process.exit(0);
}

const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");

const PARTITION = "persist:riverside";

let mainWindow = null;
let windowIpcRegistered = false;
let collapsedState = {
  collapsed: false,
  previousBounds: null,
  previousMinSize: null,
  wasMaximized: false,
};

const COLLAPSED_WIDTH = 366;
const COLLAPSED_MIN_HEIGHT = 180;
const DEFAULT_MIN_WIDTH = 240;
const DEFAULT_MIN_HEIGHT = 180;

function createWindow() {
  const isDev = !app.isPackaged;

  nativeTheme.themeSource = "system";

  const iconPath = path.join(__dirname, "..", "logo.ico");

  const windowOptions = {
    width: 1100,
    height: 720,
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    show: false,
    resizable: true,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#00000000",
    transparent: true,
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (!windowIpcRegistered) {
    windowIpcRegistered = true;

    ipcMain.handle("window:minimize", () => mainWindow?.minimize());
    ipcMain.handle("window:toggleMaximize", () => {
      if (!mainWindow) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.handle("window:close", () => mainWindow?.close());
    ipcMain.handle("window:getBounds", () => mainWindow?.getBounds() ?? null);
    ipcMain.handle("window:getMinSize", () => mainWindow?.getMinimumSize?.() ?? [0, 0]);
    ipcMain.on("window:setBounds", (_ev, bounds) => {
      if (!mainWindow) return;
      if (!bounds || typeof bounds !== "object") return;
      const x = Number(bounds.x);
      const y = Number(bounds.y);
      const width = Number(bounds.width);
      const height = Number(bounds.height);
      if (![x, y, width, height].every((n) => Number.isFinite(n))) return;
      if (width <= 0 || height <= 0) return;
      try {
        if (!collapsedState.collapsed) {
          mainWindow.setMinimumSize(DEFAULT_MIN_WIDTH, DEFAULT_MIN_HEIGHT);
        }
      } catch {
        // ignore
      }
      try {
        mainWindow.setBounds({ x, y, width, height }, true);
      } catch {
        // ignore
      }
    });

    ipcMain.handle("window:setCollapsed", async (_ev, collapsed) => {
      if (!mainWindow) return { ok: false };

      const next = !!collapsed;
      if (next === collapsedState.collapsed)
        return { ok: true, collapsed: collapsedState.collapsed };

      if (next) {
        collapsedState.previousBounds = mainWindow.getBounds();
        collapsedState.previousMinSize = mainWindow.getMinimumSize();
        collapsedState.wasMaximized = mainWindow.isMaximized();

      if (collapsedState.wasMaximized) mainWindow.unmaximize();

      mainWindow.setMinimumSize(COLLAPSED_WIDTH, COLLAPSED_MIN_HEIGHT);
      mainWindow.setBounds({ ...collapsedState.previousBounds, width: COLLAPSED_WIDTH }, true);
      collapsedState.collapsed = true;
      return { ok: true, collapsed: true };
    }

      const prevMin = collapsedState.previousMinSize;
      const prevBounds = collapsedState.previousBounds;
      const wasMax = collapsedState.wasMaximized;

    mainWindow.setMinimumSize(
      Array.isArray(prevMin) ? prevMin[0] : DEFAULT_MIN_WIDTH,
      Array.isArray(prevMin) ? prevMin[1] : DEFAULT_MIN_HEIGHT
    );

      if (prevBounds) {
        mainWindow.setBounds(prevBounds, true);
      } else {
        mainWindow.setBounds({ width: 1100, height: 720 });
      }

      if (wasMax) mainWindow.maximize();

      collapsedState.collapsed = false;
      collapsedState.previousBounds = null;
      collapsedState.previousMinSize = null;
      collapsedState.wasMaximized = false;
      return { ok: true, collapsed: false };
    });
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
  if (isDev) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexHtml = path.join(__dirname, "..", "dist", "renderer", "index.html");
    mainWindow.loadFile(indexHtml);
  }
}

app.setAppUserModelId("cc.river-side.desktop");

app.whenReady().then(() => {
  const { registerIpc: registerDiscourseIpc } = require("./discourse.cjs");
  const { registerIpc: registerDiscuzIpc } = require("./discuz.cjs");
  registerDiscourseIpc(ipcMain);
  registerDiscuzIpc(ipcMain);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
