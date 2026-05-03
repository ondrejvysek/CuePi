const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dskApi', {
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  toggleDsk: displayId => ipcRenderer.invoke('dsk:toggle', displayId),
  stopAllDsk: () => ipcRenderer.invoke('dsk:stopAll'),
  closeApp: () => ipcRenderer.invoke('app:close'),
  onDisplaysChanged: callback => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('displays:changed', handler);
    return () => ipcRenderer.removeListener('displays:changed', handler);
  }
});
