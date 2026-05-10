const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createCuePiServer } = require('../../../backend/app');

let cuepi;
let mainWin;
let dskWin;
let localUrl = '';

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
  localUrl = await startLocalCuePi();
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await mainWin.loadURL(localUrl);
}

async function openDskWindow() {
  if (!localUrl) return;
  if (dskWin && !dskWin.isDestroyed()) {
    dskWin.show();
    dskWin.focus();
    return;
  }
  dskWin = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await dskWin.loadURL(`${localUrl}/presenter-dsk.html`);
  dskWin.on('closed', () => { dskWin = null; });
}

ipcMain.handle('cuepi:open-dsk-window', async () => {
  await openDskWindow();
  return { ok: true };
});

app.whenReady().then(createMainWindow);
app.on('before-quit', async () => {
  if (cuepi) await cuepi.stop();
});
