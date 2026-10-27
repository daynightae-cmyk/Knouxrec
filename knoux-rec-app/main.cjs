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
const crypto = require("crypto");

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

/**
 * Destinations the renderer may ask the operating system to open. The About
 * screen needs this for mailto:/tel:, which a webview cannot launch itself.
 * Anything outside the allowlist resolves to null and never reaches shell.
 */
const EXTERNAL_LINK_ALLOWLIST = new Set(["https:", "http:", "mailto:", "tel:"]);

function allowedExternalUrl(raw) {
  if (typeof raw !== "string") return null;
  const target = raw.trim();
  // Control characters and spaces are how a scheme gets smuggled in.
  if (!target || /[\u0000-\u0020\u007f]/.test(target)) return null;
  let url = null;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (!EXTERNAL_LINK_ALLOWLIST.has(scheme)) return null;
  if (scheme === "https:" || scheme === "http:") {
    if (!url.hostname || url.username || url.password) return null;
  }
  if (scheme === "mailto:") {
    const address = decodeURIComponent(url.pathname).trim();
    if (!/^[^\s@]+@[^\s@]+(\.[^\s@]+)+$/i.test(address)) return null;
  }
  if (scheme === "tel:" && url.pathname.replace(/\D/g, "").length < 6) return null;
  return target;
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

ipcMain.handle("knoux:links:open", async (event, raw) => {
  if (!isMainSender(event)) return false;
  const target = allowedExternalUrl(raw);
  if (!target) return false;
  try {
    await shell.openExternal(target);
    return true;
  } catch {
    // No registered handler, or the OS refused: report it honestly so the
    // renderer can show a fallback instead of a fake success.
    return false;
  }
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

function shapeBytes(shape, dtype) {
  if (!Array.isArray(shape) || shape.length === 0) return 0;
  const elements = shape.reduce((total, value) => total * Math.max(1, Number(value) || 1), 1);
  return elements * (dtype === "float16" ? 2 : dtype === "int8" || dtype === "bool" || dtype === "uint8" ? 1 : 4);
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const MAX_WEIGHTS_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_MODEL_MANIFEST_BYTES = 4 * 1024 * 1024;

async function hashModelFile(filePath) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

/**
 * Safe local model import. The user picks a manifest (and optional weight
 * file); we validate the manifest, hash the weights, compare the declared
 * size, and report. Nothing is downloaded, nothing is written into the bundle,
 * and no model is marked runnable by this flow.
 */
ipcMain.handle("knoux:models:import", async (event) => {
  if (!isMainSender(event)) return null;
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Model manifest", extensions: ["json"] },
      { name: "Weight file", extensions: ["bin"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  let manifestBuffer = null;
  let manifestName = "";
  let selectedWeightsPath = null;
  let selectedWeightsSize = 0;
  let weightsName = "";

  for (const filePath of result.filePaths) {
    try {
      const name = path.basename(filePath).toLowerCase();
      if (!name.endsWith(".json") && !name.endsWith(".bin")) continue;
      const info = await fs.promises.stat(filePath);
      if (!info.isFile()) continue;
      if (name.endsWith(".json") && !manifestBuffer) {
        if (info.size === 0 || info.size > MAX_MODEL_MANIFEST_BYTES) {
          return { ok: false, reason: "Model manifest must be between 1 byte and 4 MiB." };
        }
        const buffer = await fs.promises.readFile(filePath);
        try { JSON.parse(buffer.toString("utf8")); } catch { continue; }
        manifestBuffer = buffer;
        manifestName = path.basename(filePath);
      } else if (name.endsWith(".bin") && !selectedWeightsPath) {
        if (info.size === 0 || info.size > MAX_WEIGHTS_BYTES) {
          return { ok: false, reason: "Weight file must be between 1 byte and 8 GiB." };
        }
        selectedWeightsPath = filePath;
        selectedWeightsSize = info.size;
        weightsName = path.basename(filePath);
      }
    } catch {
      continue;
    }
  }

  if (!manifestBuffer) {
    return { ok: false, reason: "No valid model manifest was selected." };
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    return { ok: false, reason: "The manifest is not valid JSON." };
  }

  const group = manifest.weightsManifest ? manifest.weightsManifest[0] : null;
  const weightsPath = group && group.paths ? group.paths[0] : "weights.bin";
  const tensors = group && Array.isArray(group.weights) ? group.weights : [];
  const expectedWeightsBytes = tensors.reduce((total, t) => {
    const shape = t && Array.isArray(t.shape) ? t.shape : [];
    const elements = shape.reduce((n, v) => n * Math.max(1, Number(v) || 1), 1);
    return total + elements * (t.dtype === "float16" ? 2 : t.dtype === "int8" || t.dtype === "bool" || t.dtype === "uint8" ? 1 : 4);
  }, 0);

  const report = {
    ok: true,
    manifest: {
      modelName: manifest.modelName ? manifest.modelName : manifestName.replace(/\.json$/i, ""),
      version: manifest.version ? manifest.version : "",
      description: manifest.description ? manifest.description : "",
      weightsPath,
      expectedWeightsBytes,
      tensorCount: tensors.length,
      capabilities: manifest.userDefinedMetadata && manifest.userDefinedMetadata.capabilities ? manifest.userDefinedMetadata.capabilities : [],
      source: manifest.source ? manifest.source : manifest.generatedBy ? manifest.generatedBy : null,
      license: manifest.license ? manifest.license : null,
    },
    manifestSha256: sha256Hex(manifestBuffer),
  };

  if (!selectedWeightsPath) {
    report.reason = "Manifest parsed. No weights selected; this does not install or activate a model.";
    return report;
  }

  // Stream from disk rather than buffering up to 8 GiB in Electron's main process.
  const matchesDeclaredSize = expectedWeightsBytes > 0 && selectedWeightsSize === expectedWeightsBytes;
  const digest = await hashModelFile(selectedWeightsPath);
  report.weights = {
    name: weightsName,
    size: selectedWeightsSize,
    sha256: digest,
    matchesDeclaredSize,
  };
  report.ok = matchesDeclaredSize;
  report.reason = !matchesDeclaredSize
    ? "Selected file size does not match a declared, supported tensor inventory."
    : "Manifest and selected file sizes match; SHA-256 fingerprint computed. No model was installed, activated, or independently authenticated.";
  return report;
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

ipcMain.handle("knoux:desktop:sources", async (event) => {
  if (!isMainSender(event)) return [];
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources.map(({ id, name, thumbnail }) => ({
    id,
    name,
    thumbnail: thumbnail ? thumbnail.toDataURL() : null,
  }));
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
