const path = require('path');
const { app, BrowserWindow } = require('electron');
const { createCuePiServer } = require('../../../backend/app');

let cuepi;

async function startLocalCuePi() {
  cuepi = createCuePiServer({
    bindHost: '127.0.0.1',
    port: 0,
    shell: 'electron',
    role: 'standalone',
  });
  const { url } = await cuepi.start();
  return url;
}

async function createMainWindow() {
  const url = await startLocalCuePi();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadURL(url);
}

app.whenReady().then(createMainWindow);
app.on('before-quit', async () => {
  if (cuepi) await cuepi.stop();
});
