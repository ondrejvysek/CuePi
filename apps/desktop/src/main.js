const path = require('path');
const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
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
      sandbox: false,
    },
  });
  await mainWin.loadURL(localUrl);
  mainWin.on('close', async (event) => {
    if (!dskWin || dskWin.isDestroyed()) return;
    const choice = await dialog.showMessageBox(mainWin, {
      type: 'warning',
      buttons: ['Cancel', 'Exit and close DSK'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Exit',
      message: 'DSK output is active. Close CuePi and stop DSK output?',
    });
    if (choice.response === 0) {
      event.preventDefault();
      return;
    }
    await closeDskWindow();
  });
}

function getDisplaySnapshot() {
  if (!dskWin || dskWin.isDestroyed()) activeOutputDisplayId = null;
  const displays = screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    resolution: `${d.bounds.width}x${d.bounds.height}`,
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
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
      sandbox: false,
    },
  });
  await dskWin.loadURL(`${localUrl}/presenter-dsk.html`);
  activeOutputDisplayId = targetDisplay ? targetDisplay.id : null;
  dskWin.on('closed', () => { dskWin = null; activeOutputDisplayId = null; });
}

async function closeDskWindow() {
  if (dskWin && !dskWin.isDestroyed()) {
    dskWin.close();
  }
  dskWin = null;
  activeOutputDisplayId = null;
}

ipcMain.handle('cuepi:get-displays', async () => getDisplaySnapshot());

ipcMain.handle('cuepi:open-dsk-window', async (_event, payload = {}) => {
  await openDskWindow(payload.displayId || null);
  return { ok: true };
});

ipcMain.handle('cuepi:toggle-dsk-output', async (_event, payload = {}) => {
  const displayId = payload.displayId || null;
  if (activeOutputDisplayId && String(activeOutputDisplayId) === String(displayId)) {
    await closeDskWindow();
    return { ok: true, active: false };
  }
  await openDskWindow(displayId);
  return { ok: true, active: true };
});

app.whenReady().then(createMainWindow);
app.on('before-quit', async () => {
  await closeDskWindow();
  if (cuepi) await cuepi.stop();
});
