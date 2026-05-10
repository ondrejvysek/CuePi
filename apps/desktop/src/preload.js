const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuepiDesktop', {
  getDisplays: () => ipcRenderer.invoke('cuepi:get-displays'),
  openDskWindow: (payload) => ipcRenderer.invoke('cuepi:open-dsk-window', payload || {}),
  toggleDskOutput: (payload) => ipcRenderer.invoke('cuepi:toggle-dsk-output', payload || {}),
});
