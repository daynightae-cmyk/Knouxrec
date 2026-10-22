const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const isPackaged = app.isPackaged;
const appEntry = path.join(__dirname, "..", "dist", "index.html");
const appEntryUrl = pathToFileURL(appEntry).href;
const pickerEntry = path.join(__dirname, "picker.html");
const pickerEntryUrl = pathToFileURL(pickerEntry).href;
const iconPath = isPackaged
  ? path.join(process.resourcesPath, "icon.ico")
  : path.join(__dirname, "build", "icon.ico");

let mainWindow = null;
let pendingPicker = null;

function isMainSender(event) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents,
  );
}

function isPickerSender(event) {
  return Boolean(
    pendingPicker &&
      pendingPicker.window &&
      !pendingPicker.window.isDestroyed() &&
      event.sender === pendingPicker.window.webContents,
  );
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("knoux:command", command);
  }
}

function resolvePicker(result) {
  if (!pendingPicker) return;
  const { callback, window } = pendingPicker;
  pendingPicker = null;
  if (window && !window.isDestroyed()) window.destroy();
  callback(result);
}

async function openSourcePicker(callback) {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    if (!sources.length) {
      callback({});
      return;
    }
    if (pendingPicker) {
      callback({});
      return;
    }
    const picker = new BrowserWindow({
      width: 940,
      height: 680,
      parent: mainWindow ?? undefined,
      modal: Boolean(mainWindow),
      show: false,
      title: "Choose what to share",
      backgroundColor: "#07070a",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    pendingPicker = {
      window: picker,
      callback,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        source,
      })),
    };
    picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    picker.webContents.on("will-navigate", (event, navigationUrl) => {
      if (navigationUrl !== pickerEntryUrl) event.preventDefault();
    });
    picker.once("ready-to-show", () => picker.show());
    picker.on("closed", () => {
      if (pendingPicker && pendingPicker.window === picker) {
        const cancelled = pendingPicker.callback;
        pendingPicker = null;
        cancelled({});
      }
    });
    await picker.loadFile(pickerEntry);
  } catch (error) {
    callback({});
  }
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New screen recording", accelerator: "F9", click: () => sendCommand("record.toggle") },
        { label: "Pause or resume", accelerator: "F10", click: () => sendCommand("record.pause-toggle") },
        { label: "Capture screenshot", accelerator: "F12", click: () => sendCommand("record.screenshot") },
        { type: "separator" },
        {
          label: "Open library",
          accelerator: "CmdOrCtrl+L",
          click: () => sendCommand("navigate:library"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Dashboard", accelerator: "CmdOrCtrl+1", click: () => sendCommand("navigate:dashboard") },
        { label: "Recorder", accelerator: "CmdOrCtrl+2", click: () => sendCommand("navigate:studio") },
        { label: "Screenshots", accelerator: "CmdOrCtrl+3", click: () => sendCommand("navigate:screenshots") },
        { label: "Library", accelerator: "CmdOrCtrl+4", click: () => sendCommand("navigate:library") },
        { label: "Settings", accelerator: "CmdOrCtrl+5", click: () => sendCommand("navigate:settings") },
        { label: "Diagnostics", accelerator: "CmdOrCtrl+6", click: () => sendCommand("navigate:diagnostics") },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About KNOUX REC",
          click: () => {
            void dialog.showMessageBox(mainWindow ?? undefined, {
              type: "info",
              title: "About KNOUX REC",
              message: `KNOUX REC ${app.getVersion()}`,
              detail:
                "Local-first screen recorder.\n\nElectron " +
                process.versions.electron +
                "\nChromium " +
                process.versions.chrome +
                "\nNode " +
                process.versions.node,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const options = {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#07070a",
    title: "KNOUX REC",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  };
  if (fs.existsSync(iconPath)) options.icon = iconPath;
  mainWindow = new BrowserWindow(options);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl === appEntryUrl) return;
    event.preventDefault();
    if (/^https?:/i.test(navigationUrl)) void shell.openExternal(navigationUrl);
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.webContents.on("did-finish-load", () => {
    console.error("[knoux] renderer finished loading");
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[knoux] renderer failed to load (${code} ${description}) ${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[knoux] renderer process gone: ${details.reason} (${details.exitCode})`);
  });
  mainWindow.webContents.on("console-message", (event) => {
    const level = typeof event.level === "number" ? event.level : event.level === "error" ? 3 : 0;
    if (level >= 2) {
      console.error(
        `[knoux] renderer console: ${event.message} (${event.sourceId}:${event.lineNumber})`,
      );
    }
  });

  mainWindow.loadFile(appEntry).catch((error) => {
    void dialog.showErrorBox(
      "KNOUX REC failed to load",
      `The built renderer was not found at:\n${appEntry}\n\nRun "npm run build" first.\n\n${error}`,
    );
  });
}

app.whenReady().then(() => {
  if (!fs.existsSync(appEntry)) {
    dialog.showErrorBox(
      "KNOUX REC failed to load",
      `The built renderer was not found at:\n${appEntry}\n\nRun "npm run build" before starting the desktop shell.`,
    );
    app.quit();
    return;
  }

  buildMenu();

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(
      permission === "media" ||
        permission === "display-capture" ||
        permission === "fullscreen" ||
        permission === "clipboard-sanitized-write",
    );
  });

  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    permission === "media" || permission === "display-capture" || permission === "fullscreen",
  );

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    void openSourcePicker(callback);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.handle("knoux:models:inspect", (event, id) => {
  if (!isMainSender(event) || typeof id !== "string" || !/^[a-z0-9_]+$/.test(id)) {
    return null;
  }
  const modelDir = path.join(app.getAppPath(), "dist", "models", id);
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(modelDir, "model.json"), "utf8"),
    );
    const relative =
      manifest?.weightsManifest?.[0]?.paths?.[0] ?? "weights.bin";
    const weightsFile = path.resolve(modelDir, String(relative));
    if (
      !weightsFile.startsWith(path.resolve(modelDir) + path.sep) ||
      !fs.existsSync(weightsFile)
    ) {
      return {
        id,
        name: manifest?.modelName ?? id,
        description: manifest?.description ?? "",
        weightsPath: relative,
        weightsState: "missing",
        weightsBytes: 0,
      };
    }
    const stats = fs.statSync(weightsFile);
    return {
      id,
      name: manifest?.modelName ?? id,
      description: manifest?.description ?? "",
      weightsPath: relative,
      weightsState: stats.isFile() && stats.size > 0 ? "present" : "missing",
      weightsBytes: stats.size,
    };
  } catch {
    return null;
  }
});

ipcMain.handle("knoux:picker:list", (event) => {
  if (!isPickerSender(event)) return [];
  return (pendingPicker?.sources ?? []).map(({ id, name, thumbnail }) => ({
    id,
    name,
    thumbnail,
  }));
});

ipcMain.on("knoux:picker:select", (event, payload) => {
  if (!isPickerSender(event) || !pendingPicker) return;
  const id = typeof payload?.id === "string" ? payload.id : "";
  const entry = pendingPicker.sources.find((source) => source.id === id);
  if (!entry) return;
  resolvePicker({
    video: entry.source,
    audio: payload?.audio === true ? "loopback" : undefined,
  });
});

ipcMain.on("knoux:picker:cancel", (event) => {
  if (!isPickerSender(event)) return;
  resolvePicker({});
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
