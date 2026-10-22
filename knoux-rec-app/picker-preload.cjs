const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("knouxPicker", {
  list: () => ipcRenderer.invoke("knoux:picker:list"),
  choose: (id, audio) => ipcRenderer.send("knoux:picker:select", { id, audio: Boolean(audio) }),
  cancel: () => ipcRenderer.send("knoux:picker:cancel"),
});
