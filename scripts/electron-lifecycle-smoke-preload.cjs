const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lifecycleSmoke', {
  invokeDelayed: () => ipcRenderer.invoke('lifecycle-smoke:delayed'),
});
