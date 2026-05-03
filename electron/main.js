const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');

let moderatorWindow;
const dskWindows = new Map();

function displayKey(displayId) {
  return String(displayId);
}

function getModeratorDisplayId() {
  if (!moderatorWindow || moderatorWindow.isDestroyed()) {
    return screen.getPrimaryDisplay().id;
  }

  return screen.getDisplayMatching(moderatorWindow.getBounds()).id;
}

function getDisplaysForUi() {
  const primaryId = screen.getPrimaryDisplay().id;
  const moderatorDisplayId = getModeratorDisplayId();

  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `Display ${index + 1}`,
    isPrimary: display.id === primaryId,
    isModerator: display.id === moderatorDisplayId,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: Boolean(display.internal)
  }));
}

function getState() {
  return {
    displays: getDisplaysForUi(),
    moderatorDisplayId: getModeratorDisplayId(),
    liveDisplayIds: Array.from(dskWindows.keys()).map(Number)
  };
}

function notifyDisplaysChanged() {
  if (!moderatorWindow || moderatorWindow.isDestroyed()) {
    return;
  }

  moderatorWindow.webContents.send('displays:changed', getState());
}

function createModeratorWindow() {
  moderatorWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    title: 'Presenter Out / DSK',
    autoHideMenuBar: true,
    backgroundColor: '#07101f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  moderatorWindow.loadFile(path.join(__dirname, '../public/moderator.html'));

  moderatorWindow.on('move', notifyDisplaysChanged);
  moderatorWindow.on('resize', notifyDisplaysChanged);
}

function createDskWindow(targetDisplay) {
  const { x, y, width, height } = targetDisplay.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    fullscreenable: true,
    backgroundColor: '#00ff00',
    autoHideMenuBar: true,
    skipTaskbar: true,
    show: false,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '../public/moderator.html'), { query: { mode: 'dsk' } });
  win.on('closed', () => {
    dskWindows.delete(displayKey(targetDisplay.id));
    notifyDisplaysChanged();
  });

  return win;
}

function startDsk(displayId) {
  const targetDisplay = screen.getAllDisplays().find(display => display.id === Number(displayId));

  if (!targetDisplay) {
    return getState();
  }

  const key = displayKey(targetDisplay.id);
  const existingWindow = dskWindows.get(key);

  if (existingWindow && !existingWindow.isDestroyed()) {
    return getState();
  }

  const dskWindow = createDskWindow(targetDisplay);
  const { x, y, width, height } = targetDisplay.bounds;
  dskWindows.set(key, dskWindow);

  dskWindow.setBounds({ x, y, width, height });
  dskWindow.showInactive();
  dskWindow.setAlwaysOnTop(true, 'screen-saver');

  if (screen.getAllDisplays().length === 1) {
    if (process.platform === 'darwin' && dskWindow.setSimpleFullScreen) {
      dskWindow.setSimpleFullScreen(true);
    } else {
      dskWindow.setFullScreen(true);
    }
  }

  if (moderatorWindow && !moderatorWindow.isDestroyed()) {
    moderatorWindow.focus();
  }

  notifyDisplaysChanged();
  return getState();
}

function stopDsk(displayId) {
  const key = displayKey(displayId);
  const dskWindow = dskWindows.get(key);

  if (dskWindow && !dskWindow.isDestroyed()) {
    dskWindow.close();
  }

  dskWindows.delete(key);
  notifyDisplaysChanged();
  return getState();
}

function toggleDsk(displayId) {
  const key = displayKey(displayId);
  const dskWindow = dskWindows.get(key);

  if (dskWindow && !dskWindow.isDestroyed()) {
    return stopDsk(displayId);
  }

  return startDsk(displayId);
}

function stopAllDsk() {
  for (const dskWindow of dskWindows.values()) {
    if (dskWindow && !dskWindow.isDestroyed()) {
      dskWindow.close();
    }
  }

  dskWindows.clear();
  notifyDisplaysChanged();
  return getState();
}

function cleanupMissingDisplays() {
  const availableDisplayIds = new Set(screen.getAllDisplays().map(display => displayKey(display.id)));

  for (const [key, dskWindow] of dskWindows.entries()) {
    if (!availableDisplayIds.has(key)) {
      if (dskWindow && !dskWindow.isDestroyed()) {
        dskWindow.close();
      }
      dskWindows.delete(key);
    }
  }
}

function setupIpc() {
  ipcMain.handle('displays:list', () => getState());
  ipcMain.handle('dsk:toggle', (_event, displayId) => toggleDsk(displayId));
  ipcMain.handle('dsk:stopAll', () => stopAllDsk());
  ipcMain.handle('app:close', () => {
    app.quit();
  });
}

function setupDisplayEvents() {
  screen.on('display-added', notifyDisplaysChanged);
  screen.on('display-removed', () => {
    cleanupMissingDisplays();
    notifyDisplaysChanged();
  });
  screen.on('display-metrics-changed', notifyDisplaysChanged);
}

function setupShortcuts() {
  const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+D' : 'Control+Shift+D';

  globalShortcut.register(toggleShortcut, () => {
    const displays = screen.getAllDisplays();
    const moderatorDisplayId = getModeratorDisplayId();
    const preferredDisplay = displays.find(display => display.id !== moderatorDisplayId) || displays[0];

    if (preferredDisplay) {
      toggleDsk(preferredDisplay.id);
    }
  });
}

app.whenReady().then(() => {
  setupIpc();
  createModeratorWindow();
  setupDisplayEvents();
  setupShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createModeratorWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
