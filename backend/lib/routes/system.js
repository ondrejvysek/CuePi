const fs = require('fs');
const path = require('path');

const EXPORT_VERSION = 'cuepi-config-v1';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function writeJsonBatchAtomic(targets) {
  const staged = [];
  try {
    for (const target of targets) {
      const tempPath = `${target.path}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(target.data, null, 2));
      staged.push({ tempPath, finalPath: target.path });
    }
    for (const entry of staged) fs.renameSync(entry.tempPath, entry.finalPath);
    return { ok: true };
  } catch (error) {
    for (const entry of staged) {
      try {
        if (fs.existsSync(entry.tempPath)) fs.unlinkSync(entry.tempPath);
      } catch (_) {
        // best effort cleanup
      }
    }
    return { ok: false, error };
  }
}

function validateImportPayload(payload) {
  if (!isPlainObject(payload)) return 'payload must be an object';
  if (payload.version !== EXPORT_VERSION) return `version must be ${EXPORT_VERSION}`;
  if (!isPlainObject(payload.config)) return 'config must be an object';
  if (!isPlainObject(payload.state)) return 'state must be an object';
  if (!isPlainObject(payload.display)) return 'display must be an object';
  if (!Array.isArray(payload.rundown)) return 'rundown must be an array';
  if (payload.integrationMappings !== undefined && !isPlainObject(payload.integrationMappings)) return 'integrationMappings must be an object';
  return null;
}

function registerSystemRoutes(app, ctx) {
  const {
    requireAdmin,
    structuredError,
    hardware,
    store,
    getDisplayConfig,
    setDisplayConfig,
    sanitizeDisplayConfig,
    queue,
    timer,
    persistState,
    persistRundown,
    persistDisplayConfig,
    broadcast,
    serviceName,
  } = ctx;

  app.get('/api/system/export', requireAdmin, (req, res) => {
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      config: JSON.parse(fs.readFileSync(store.configPath, 'utf8')),
      state: JSON.parse(fs.readFileSync(store.statePath, 'utf8')),
      display: getDisplayConfig(),
      rundown: queue.rundown,
    };

    const mappingsPath = path.join(store.dataDir, 'integration-mappings.json');
    if (fs.existsSync(mappingsPath)) {
      payload.integrationMappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
    }

    return res.json(payload);
  });

  app.post('/api/system/import', requireAdmin, (req, res) => {
    const payload = req.body;
    const validationError = validateImportPayload(payload);
    if (validationError) return structuredError(res, 400, 'Invalid payload', validationError);

    const nextDisplay = sanitizeDisplayConfig(payload.display);
    const targets = [
      { path: store.configPath, data: payload.config },
      { path: store.statePath, data: payload.state },
      { path: store.displayPath, data: nextDisplay },
      { path: store.rundownPath, data: payload.rundown },
    ];

    const mappingsPath = path.join(store.dataDir, 'integration-mappings.json');
    if (payload.integrationMappings !== undefined || fs.existsSync(mappingsPath)) {
      targets.push({ path: mappingsPath, data: payload.integrationMappings || {} });
    }

    const writeResult = writeJsonBatchAtomic(targets);
    if (!writeResult.ok) return structuredError(res, 500, 'Failed to import payload');

    // Refresh in-memory runtime state only after successful commit.
    timer.state = { ...timer.state, ...payload.state };
    queue.rundown = Array.isArray(payload.rundown) ? payload.rundown.slice() : [];
    queue.currentIndex = Number.isInteger(timer.state.currentIndex) ? timer.state.currentIndex : 0;
    setDisplayConfig(nextDisplay);
    persistState();
    persistRundown();
    persistDisplayConfig();
    broadcast();

    return res.json({ ok: true, status: 'Imported' });
  });

  app.post('/api/system/factory-reset', requireAdmin, (req, res) => {
    const confirm = req.body && req.body.confirm;
    if (confirm !== 'RESET_CUEPI') return structuredError(res, 400, 'Invalid payload', 'confirm must be RESET_CUEPI');

    const backupDir = path.join(store.dataDir, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[.:]/g, '-');
    const backupPath = path.join(backupDir, `factory-reset-backup-${stamp}.json`);
    const backupPayload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      config: JSON.parse(fs.readFileSync(store.configPath, 'utf8')),
      state: JSON.parse(fs.readFileSync(store.statePath, 'utf8')),
      display: getDisplayConfig(),
      rundown: queue.rundown,
    };
    fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2));

    const defaults = store.init();
    timer.state = { ...timer.state, ...defaults.state };
    queue.rundown = defaults.rundown.slice();
    queue.currentIndex = 0;
    setDisplayConfig(sanitizeDisplayConfig(defaults.display));
    broadcast();

    res.json({ ok: true, backupPath, status: `Factory reset complete; restarting service ${serviceName}` });
    hardware.restartService();
  });

  app.post('/api/system/restart', requireAdmin, (req, res) => {
    res.json({ ok: true, status: 'Restarting system service' });
    hardware.restartService();
  });
  app.post('/api/system/reload-hdmi', requireAdmin, (req, res) => {
    res.json({ ok: true, status: 'Reloading HDMI output' });
    if (hardware.reloadHdmiOutput) hardware.reloadHdmiOutput();
    else hardware.restartService();
  });

  app.post('/api/system/update', requireAdmin, (req, res) => {
    res.json({ ok: true, status: 'Pulling firmware and system updates' });
    hardware.updateSystem();
  });

  app.post('/api/system/hostname', requireAdmin, (req, res) => {
    const name = req.body && req.body.name;
    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9-]{1,63}$/.test(name)) return structuredError(res, 400, 'Invalid payload', 'name must be 1-63 chars [a-zA-Z0-9-]');
    hardware.setHostname(name, (error) => {
      if (error) return structuredError(res, 500, 'Failed to update hostname');
      return res.json({ ok: true, status: 'Hostname updated' });
    });
  });
}
module.exports = { registerSystemRoutes };
