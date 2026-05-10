const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuepiDesktop', {
  openDskWindow: () => ipcRenderer.invoke('cuepi:open-dsk-window'),
});
