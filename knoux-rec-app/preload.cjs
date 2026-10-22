const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("knouxDesktop", {
  isDesktop: true,
  platform: process.platform,
  inspectModel(id) {
    return ipcRenderer.invoke("knoux:models:inspect", String(id));
  },
  onCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, command) => callback(String(command));
    ipcRenderer.on("knoux:command", listener);
    return () => ipcRenderer.removeListener("knoux:command", listener);
  },
});
