const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createCuePiServer } = require('../../../backend/app');

let cuepi;
let mainWin;
let dskWin;
let localUrl = '';
let activeOutputDisplayId = null;

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

function getDisplaySnapshot() {
  const displays = screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: `${d.bounds.width}x${d.bounds.height} @ (${d.bounds.x},${d.bounds.y})`,
    isPrimary: d.id === screen.getPrimaryDisplay().id,
    bounds: d.bounds,
  }));
  const moderatorDisplayId = mainWin ? screen.getDisplayMatching(mainWin.getBounds()).id : null;
  return { displays, moderatorDisplayId, activeOutputDisplayId };
}

async function openDskWindow(displayId = null) {
  if (!localUrl) return;
  if (dskWin && !dskWin.isDestroyed()) {
    dskWin.close();
  }
  const targetDisplay = displayId
    ? screen.getAllDisplays().find((d) => String(d.id) === String(displayId))
    : null;
  const bounds = targetDisplay ? targetDisplay.bounds : { width: 1280, height: 720, x: 0, y: 0 };
  dskWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    autoHideMenuBar: true,
    frame: false,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await dskWin.loadURL(`${localUrl}/presenter-dsk.html`);
  activeOutputDisplayId = targetDisplay ? targetDisplay.id : null;
  dskWin.on('closed', () => { dskWin = null; activeOutputDisplayId = null; });
}

ipcMain.handle('cuepi:get-displays', async () => getDisplaySnapshot());

ipcMain.handle('cuepi:open-dsk-window', async (_event, payload = {}) => {
  await openDskWindow(payload.displayId || null);
  return { ok: true };
});

app.whenReady().then(createMainWindow);
app.on('before-quit', async () => {
  if (cuepi) await cuepi.stop();
});
