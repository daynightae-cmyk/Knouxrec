const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("knouxDesktop", {
  isDesktop: true,
  platform: process.platform,
  inspectModel(id) {
    return ipcRenderer.invoke("knoux:models:inspect", String(id));
  },
  // Validated again in the main process: this only ever forwards a single
  // string, and resolves false when the destination is not allowed.
  openExternal(url) {
    return ipcRenderer.invoke("knoux:links:open", String(url));
  },
  desktopSources() {
    return ipcRenderer.invoke("knoux:desktop:sources");
  },
  async importModel() {
    return ipcRenderer.invoke("knoux:models:import");
  },
  onCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, command) => callback(String(command));
    ipcRenderer.on("knoux:command", listener);
    return () => ipcRenderer.removeListener("knoux:command", listener);
  },
});
