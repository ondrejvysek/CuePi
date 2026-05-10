const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createCuePiServer } = require('../../../backend/app');

let cuepi;
let mainWin;
let dskWin;
let localUrl = '';
let activeOutputDisplayId = null;
let allowMainClose = false;

async function showStyledExitConfirm() {
  return new Promise((resolve) => {
    const modal = new BrowserWindow({
      width: 460,
      height: 220,
      parent: mainWin || undefined,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: false },
    });
    const html = `<!doctype html><html><body style="margin:0;font-family:Arial;background:#071a33;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;">
      <div style="width:90%;border:1px solid #334155;border-radius:14px;padding:18px;background:#0b1f3e;">
        <h3 style="margin:0 0 10px 0;">DSK output is active</h3>
        <p style="margin:0 0 18px 0;color:#94a3b8;">Close CuePi and stop DSK output?</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="window.confirmExit(false)" style="padding:10px 14px;border-radius:8px;border:1px solid #334155;background:#132b4d;color:#e2e8f0;">Cancel</button>
          <button onclick="window.confirmExit(true)" style="padding:10px 14px;border-radius:8px;border:0;background:#2563eb;color:white;">Exit and close DSK</button>
        </div>
      </div>
      <script>window.confirmExit=(ok)=>{window.location='cuepi-exit:'+ok}</script>
    </body></html>`;
    modal.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('cuepi-exit:')) return;
      e.preventDefault();
      const ok = url === 'cuepi-exit:true';
      resolve(ok);
      if (!modal.isDestroyed()) modal.close();
    });
    modal.on('closed', () => resolve(false));
    modal.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  });
}

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
  mainWin.on('close', (event) => {
    if (allowMainClose) return;
    if (!dskWin || dskWin.isDestroyed()) return;
    event.preventDefault();
    showStyledExitConfirm().then(async (ok) => {
      if (!ok) return;
      await closeDskWindow();
      allowMainClose = true;
      if (mainWin && !mainWin.isDestroyed()) mainWin.close();
    });
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
  allowMainClose = true;
  await closeDskWindow();
  if (cuepi) await cuepi.stop();
});
