const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const { StateStore } = require('./backend/lib/state-store');
const { TimerEngine } = require('./backend/lib/timer-engine');
const { QueueEngine } = require('./backend/lib/queue-engine');
const { structuredError, createRequireAdmin, createLegacyRoute } = require('./backend/lib/api-auth');
const { createHardware } = require('./backend/lib/hardware');
const { createLogger } = require('./backend/lib/logger');
const { registerTimerRoutes } = require('./backend/lib/routes/timer');
const { registerRundownRoutes } = require('./backend/lib/routes/rundown');
const { registerDisplayRoutes } = require('./backend/lib/routes/display');
const { registerSystemRoutes } = require('./backend/lib/routes/system');
const { createRundownCsvParser } = require('./backend/lib/rundown-csv');
const { badRequest, enumField, numberField, requiredField, stringField, isAcceptedColorFormat } = require('./backend/lib/validators');

const app = express();
app.use(express.json({ limit: '10mb' }));

const store = new StateStore();
const bootData = store.init();
const DEFAULT_PRESENTER_COLORS = {
  text: { ok: '#22c55e', warning: '#ffffff', overflow: '#ffffff' },
  background: { ok: '#000000', warning: '#f97316', overflow: '#ef4444' },
  indicator: { ok: '#22c55e', warning: '#f97316', overflow: '#ef4444' },
};
function defaultPresenterColorGroups() {
  return {
    text: { ...DEFAULT_PRESENTER_COLORS.text },
    background: { ...DEFAULT_PRESENTER_COLORS.background },
    indicator: { ...DEFAULT_PRESENTER_COLORS.indicator },
  };
}

if (!bootData.config.uuid) {
  bootData.config.uuid = crypto.randomUUID();
  store.saveConfig(bootData.config);
}

const bindHost = process.env.BIND_HOST || '0.0.0.0';
const corsOrigin = process.env.CORS_ORIGIN || bootData.config.corsOrigin || '*';
const adminToken = process.env.STAGE_TIMER_ADMIN_TOKEN || bootData.config.adminToken || '';
const strictV2Only = process.env.STAGE_TIMER_V2_ONLY === 'true' || bootData.config.v2OnlyMode === true;
const apConnectionName = process.env.CUEPI_AP_CONNECTION || 'CuePi_Fallback';
const legacyApConnectionName = process.env.LEGACY_AP_CONNECTION || 'StageTimer_Fallback';
const systemdServiceName = process.env.CUEPI_SERVICE_NAME || 'cuepi';
const legacySystemdServiceName = process.env.LEGACY_CUEPI_SERVICE_NAME || 'stage-timer';
const hardware = createHardware({
  systemdServiceName,
  legacySystemdServiceName,
  apConnectionName,
  legacyApConnectionName,
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', corsOrigin);
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-stage-timer-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const server = http.createServer(app);
const io = new Server(server);

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return { ip: iface.address, mask: iface.netmask };
      }
    }
  }
  return { ip: '127.0.0.1', mask: '255.0.0.0' };
}

const messagesFile = path.join(__dirname, 'messages.json');
const logoFile = path.join(__dirname, 'logo.json');
const logsDir = path.join(__dirname, 'logs');
const actualsLogFile = path.join(logsDir, 'actuals.csv');
let quickMessages = ['Wrap Up Now', 'Q&A Starting', '5 Minutes Left', 'Speak Up'];
let logoData = '';

function displaySchemaVersion() { return 1; }
function displayProfileVersion() { return 1; }
function displayProfileToLegacy() {
  return {
    program: { keyMode: 'none' },
    chroma_dsk: { keyMode: 'chroma' },
    luma_dsk: { keyMode: 'luma' },
  };
}
function displayLegacyToProfile() {
  return {
    none: 'program',
    small: 'program',
    large: 'program',
    chroma: 'chroma_dsk',
    luma: 'luma_dsk',
  };
}

try {
  if (fs.existsSync(messagesFile)) quickMessages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
  else fs.writeFileSync(messagesFile, JSON.stringify(quickMessages));
} catch (error) {
  console.error('Could not load messages.json', error);
}

try {
  if (fs.existsSync(logoFile)) {
    const parsed = JSON.parse(fs.readFileSync(logoFile, 'utf8'));
    if (parsed && parsed.image) logoData = parsed.image;
  }
} catch (error) {
  console.error('Could not load logo.json', error);
}

const timer = new TimerEngine({ ...bootData.state, logoData });
const queue = new QueueEngine(bootData.rundown, timer.state.currentIndex || 0);
const parseRundownCsv = createRundownCsvParser(queue);
let displayConfig;
try {
  displayConfig = sanitizeDisplayConfig(bootData.display || {});
} catch (error) {
  console.error('Display config boot sanitize failed; falling back to defaults:', error);
  displayConfig = sanitizeDisplayConfig({
    schemaVersion: displaySchemaVersion(),
    profileVersion: displayProfileVersion(),
    profile: 'program',
    keyMode: 'none',
    position: 4,
    scale: 1,
    margin: 24,
  });
}
store.saveDisplay(displayConfig);

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function saveMessages() {
  try {
    fs.writeFileSync(messagesFile, JSON.stringify(quickMessages));
  } catch (error) {
    console.error('Could not save messages.json', error);
  }
}

function persistState() {
  store.saveState(timer.getPersistedState());
}

function persistRundown() {
  store.saveRundown(queue.rundown);
}

function publicState() {
  return timer.getPublicState({
    ...getNetworkInfo(),
    logoData: timer.state.logoData || logoData,
    rundownLength: queue.rundown.length,
    currentSegment: queue.getCurrent(),
    currentIndex: queue.currentIndex,
    v2OnlyMode: strictV2Only,
    presenterColors: sanitizePresenterColors(displayConfig.presenterColors),
  });
}

function broadcast() {
  io.emit('stateUpdate', publicState());
}

const requireAdmin = createRequireAdmin(adminToken);

function parseIntField(value, fieldName, opts = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return { error: `${fieldName} must be a number` };
  const val = Math.floor(num);
  if (opts.min != null && val < opts.min) return { error: `${fieldName} must be >= ${opts.min}` };
  if (opts.max != null && val > opts.max) return { error: `${fieldName} must be <= ${opts.max}` };
  return { value: val };
}

function reqValue(req, key) {
  if (req && req.body && req.body[key] !== undefined) return req.body[key];
  if (req && req.query && req.query[key] !== undefined) return req.query[key];
  return undefined;
}

function sanitizePresenterColors(colors) {
  const input = (colors && typeof colors === 'object') ? colors : {};
  const getColorField = (obj, key) => {
    if (!obj || typeof obj !== 'object') return undefined;
    return obj[key];
  };
  const sanitizeTriplet = (triplet, fallback) => ({
    ok: isAcceptedColorFormat(getColorField(triplet, 'ok')) ? String(getColorField(triplet, 'ok')).trim() : fallback.ok,
    warning: isAcceptedColorFormat(getColorField(triplet, 'warning')) ? String(getColorField(triplet, 'warning')).trim() : fallback.warning,
    overflow: isAcceptedColorFormat(getColorField(triplet, 'overflow')) ? String(getColorField(triplet, 'overflow')).trim() : fallback.overflow,
  });

  const hasGrouped = input.text || input.background || input.indicator;
  if (hasGrouped) {
    const groupedDefaults = defaultPresenterColorGroups();
    return {
      text: sanitizeTriplet(input.text || {}, groupedDefaults.text),
      background: sanitizeTriplet(input.background || {}, groupedDefaults.background),
      indicator: sanitizeTriplet(input.indicator || {}, groupedDefaults.indicator),
    };
  }

  const fallbackText = input.timerText || input;
  return {
    text: sanitizeTriplet(fallbackText, defaultPresenterColorGroups().text),
    background: sanitizeTriplet(input.background || {}, defaultPresenterColorGroups().background),
    indicator: sanitizeTriplet(input.indicator || {}, defaultPresenterColorGroups().indicator),
  };
}

function sanitizeDisplayConfig(nextDisplay) {
  const merged = {
    ...(bootData.display || {}),
    ...(nextDisplay || {}),
  };
  const profileToLegacy = displayProfileToLegacy();
  const legacyToProfile = displayLegacyToProfile();
  const rawProfile = typeof merged.profile === 'string' ? merged.profile.trim() : '';
  const legacyProfile = legacyToProfile[String(merged.keyMode || '').trim()] || 'program';
  const profile = profileToLegacy[rawProfile] ? rawProfile : legacyProfile;
  const profileLegacyMapping = profileToLegacy[profile] || profileToLegacy.program;
  const rawSchemaVersion = Number(merged.schemaVersion);
  const rawProfileVersion = Number(merged.profileVersion);

  return {
    ...merged,
    schemaVersion: Number.isFinite(rawSchemaVersion) && rawSchemaVersion > 0
      ? Math.floor(rawSchemaVersion)
      : displaySchemaVersion(),
    profileVersion: Number.isFinite(rawProfileVersion) && rawProfileVersion > 0
      ? Math.floor(rawProfileVersion)
      : displayProfileVersion(),
    profile,
    keyMode: profileLegacyMapping.keyMode,
    presenterColors: sanitizePresenterColors(merged.presenterColors),
  };
}

function validateRundownSegment(segment, fieldName = 'segment') {
  const details = [];
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return { ok: false, details: [`${fieldName} must be an object`] };
  const name = stringField(segment.name, `${fieldName}.name`, { trim: true, min: 1, max: 120 });
  if (!name.ok) details.push(name.error);
  const duration = numberField(segment.duration, `${fieldName}.duration`, { integer: true, min: 0, max: 86400 });
  if (!duration.ok) details.push(duration.error);
  const mode = enumField(segment.mode, `${fieldName}.mode`, ['countdown', 'countup', 'timeofday', 'target']);
  if (!mode.ok) details.push(mode.error);
  if (segment.notes !== undefined) {
    const notes = stringField(segment.notes, `${fieldName}.notes`, { trim: true, max: 500 });
    if (!notes.ok) details.push(notes.error);
  }
  return { ok: details.length === 0, details };
}

function validateDisplayConfigPayload(payload) {
  const details = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, details: ['payload must be an object'] };
  if (payload.schemaVersion !== undefined && !numberField(payload.schemaVersion, 'schemaVersion', { integer: true, min: 1 }).ok) details.push('schemaVersion must be an integer >= 1');
  if (payload.profileVersion !== undefined && !numberField(payload.profileVersion, 'profileVersion', { integer: true, min: 1 }).ok) details.push('profileVersion must be an integer >= 1');
  if (payload.profile !== undefined && !enumField(payload.profile, 'profile', ['program', 'chroma_dsk', 'luma_dsk']).ok) details.push('profile must be one of: program, chroma_dsk, luma_dsk');
  if (payload.keyMode !== undefined && !enumField(payload.keyMode, 'keyMode', ['none', 'small', 'large', 'chroma', 'luma']).ok) details.push('keyMode must be one of: none, small, large, chroma, luma');
  if (payload.position !== undefined && !enumField(payload.position, 'position', ['top', 'center', 'bottom']).ok) details.push('position must be one of: top, center, bottom');
  if (payload.scale !== undefined && !numberField(payload.scale, 'scale', { min: 0.5, max: 3 }).ok) details.push('scale must be >= 0.5 and <= 3');
  if (payload.margin !== undefined && !numberField(payload.margin, 'margin', { integer: true, min: 0, max: 200 }).ok) details.push('margin must be >= 0 and <= 200');
  if (payload.presenterColors !== undefined) {
    const groups = ['text', 'background', 'indicator'];
    const levels = ['ok', 'warning', 'overflow'];
    if (!payload.presenterColors || typeof payload.presenterColors !== 'object') details.push('presenterColors must be an object');
    else {
      for (const group of groups) {
        if (payload.presenterColors[group] === undefined) continue;
        for (const level of levels) {
          const color = payload.presenterColors[group][level];
          if (color !== undefined && !isAcceptedColorFormat(color)) details.push(`presenterColors.${group}.${level} must be a valid color`);
        }
      }
    }
  }
  return { ok: details.length === 0, details };
}

function persistDisplayConfig() {
  store.saveDisplay(displayConfig);
}

const legacyRoute = createLegacyRoute(app, { strictV2Only, requireAdmin });

const { appendActualsLog } = createLogger({ actualsLogFile, onError: console.error });

function applySegmentToTimer(segment, autoStart = false) {
  if (!segment) return;
  timer.setMode(segment.mode || 'countdown');
  timer.reset(segment.duration || 0);
  if (autoStart) timer.start();
}

app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'CuePi',
    short_name: 'CuePi',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
  });
});

app.get('/icon.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%230f172a'/><text x='50' y='62' font-family='sans-serif' font-size='34' font-weight='bold' fill='%2322c55e' text-anchor='middle'>Cue</text><text x='50' y='86' font-family='sans-serif' font-size='26' font-weight='bold' fill='%2360a5fa' text-anchor='middle'>Pi</text></svg>");
});

app.get('/api/state', (req, res) => res.json(publicState()));
app.get('/presenter.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presenter.html'));
});
app.get('/api/messages', (req, res) => res.json(quickMessages));

app.post('/api/toggle_playback', (req, res) => {
  timer.togglePlayback();
  persistState();
  broadcast();
  res.json({ ok: true, running: timer.state.isRunning });
});
legacyRoute('/api/toggle_playback', (req, res) => {
  timer.togglePlayback();
  persistState();
  broadcast();
  res.send(timer.state.isRunning ? 'Started' : 'Paused');
});

function handleResetInput(req) {
  const raw = reqValue(req, 'sec');
  return parseIntField(raw ?? timer.state.durationSeconds, 'sec', { min: 0, max: 86400 });
}

app.post('/api/add', (req, res) => {
  const parsed = parseIntField(reqValue(req, 'sec') ?? 0, 'sec', { min: -7200, max: 7200 });
  if (parsed.error) return badRequest(res, parsed.error)
  timer.add(parsed.value);
  persistState();
  broadcast();
  res.json({ ok: true, status: 'Adjusted' });
});
legacyRoute('/api/add', (req, res) => {
  const parsed = parseIntField((req.query && req.query.sec) ?? 0, 'sec', { min: -7200, max: 7200 });
  if (parsed.error) return badRequest(res, parsed.error);
  timer.add(parsed.value);
  persistState();
  broadcast();
  res.send('Adjusted');
});

app.post('/api/mode', requireAdmin, (req, res) => {
  const mode = req.body && req.body.set;
  if (mode === 'target') {
    const targetISO = req.body && req.body.targetISO;
    const repeatSeconds = Number((req.body && req.body.targetRepeatSeconds) || 0);
    const targetPreset = String((req.body && req.body.targetPreset) || 'manual');
    if (!targetISO || Number.isNaN(new Date(targetISO).getTime())) return badRequest(res, 'targetISO is required for target mode');
    if (!Number.isFinite(repeatSeconds) || repeatSeconds < 0) return badRequest(res, 'targetRepeatSeconds must be >= 0');
    timer.state.targetISO = targetISO;
    timer.state.targetRepeatSeconds = Math.floor(repeatSeconds);
    timer.state.targetPreset = ['manual', 'nextfull', 'nexthalf'].includes(targetPreset) ? targetPreset : 'manual';
  }
  if (!timer.setMode(mode)) return badRequest(res, 'Invalid mode');
  persistState();
  broadcast();
  res.json({ ok: true, status: 'Mode updated' });
});
legacyRoute('/api/mode', (req, res) => {
  const mode = req.query && req.query.set;
  if (mode === 'target') {
    const targetISO = req.query && req.query.targetISO;
    const repeatSeconds = Number((req.query && req.query.targetRepeatSeconds) || 0);
    const targetPreset = String((req.query && req.query.targetPreset) || 'manual');
    if (!targetISO || Number.isNaN(new Date(targetISO).getTime())) return badRequest(res, 'targetISO is required for target mode');
    if (!Number.isFinite(repeatSeconds) || repeatSeconds < 0) return badRequest(res, 'targetRepeatSeconds must be >= 0');
    timer.state.targetISO = targetISO;
    timer.state.targetRepeatSeconds = Math.floor(repeatSeconds);
    timer.state.targetPreset = ['manual', 'nextfull', 'nexthalf'].includes(targetPreset) ? targetPreset : 'manual';
  }
  if (!timer.setMode(mode)) return badRequest(res, 'Invalid mode');
  persistState();
  broadcast();
  res.send('Mode updated');
}, { auth: true });

app.post('/api/message/toggle', (req, res) => {
  timer.toggleMessage();
  persistState();
  broadcast();
  res.json({ ok: true, showMessage: timer.state.showMessage });
});
legacyRoute('/api/message/toggle', (req, res) => {
  timer.toggleMessage();
  persistState();
  broadcast();
  res.send(timer.state.showMessage ? 'Message Shown' : 'Message Hidden');
});

app.post('/api/message/set', (req, res) => {
  const text = reqValue(req, 'text') ?? '';
  const sourceRaw = String(reqValue(req, 'source') ?? 'manual');
  const source = ['manual', 'auto_rundown', 'quick_message'].includes(sourceRaw) ? sourceRaw : 'manual';
  timer.setMessage(String(text).slice(0, 280), source);
  persistState();
  broadcast();
  res.json({ ok: true });
});
legacyRoute('/api/message/set', (req, res) => {
  timer.setMessage(req.query.text || '', 'manual');
  persistState();
  broadcast();
  res.send('Message Set');
});

app.post('/api/system/logo/upload', requireAdmin, (req, res) => {
  if (!req.body || typeof req.body.image !== 'string' || req.body.image.length === 0) {
    return badRequest(res, 'image is required');
  }
  timer.state.logoData = req.body.image;
  logoData = req.body.image;
  fs.writeFileSync(logoFile, JSON.stringify({ image: logoData }));
  persistState();
  broadcast();
  return res.json({ ok: true, status: 'Logo Uploaded' });
});

app.post('/api/system/logo/clear', requireAdmin, (req, res) => {
  timer.state.logoData = '';
  logoData = '';
  if (fs.existsSync(logoFile)) fs.unlinkSync(logoFile);
  persistState();
  broadcast();
  res.json({ ok: true, status: 'Logo Cleared' });
});
legacyRoute('/api/system/logo/clear', (req, res) => {
  timer.state.logoData = '';
  logoData = '';
  if (fs.existsSync(logoFile)) fs.unlinkSync(logoFile);
  persistState();
  broadcast();
  res.send('Logo Cleared');
}, { auth: true });

app.post('/api/system/ap', requireAdmin, (req, res) => {
  const action = req.body && req.body.action;
  if (!['on', 'off'].includes(action)) return badRequest(res, 'action must be on/off');
  const desired = action === 'on' ? 'up' : 'down';
  hardware.setAp(action, (error, result) => {
    if (error) return structuredError(res, 500, 'Failed to switch fallback AP');
    if (result.legacy) return res.json({ ok: true, status: `AP ${result.desired} (legacy connection)` });
    return res.json({ ok: true, status: `AP ${result.desired}` });
  });
});

app.get('/api/system/ap/status', requireAdmin, (req, res) => {
  hardware.getApStatus((_, active) => res.json({ active }));
});

app.post('/api/system/wifi/scan', requireAdmin, (req, res) => {
  runCommand('sudo', ['nmcli', '-t', '-f', 'SSID,SIGNAL', 'dev', 'wifi', 'list'], (error, stdout) => {
    if (error) return res.status(500).json([]);
    const networks = [];
    const seen = new Set();
    stdout.split('\n').forEach((line) => {
      const [ssid, signal] = line.split(':');
      if (ssid && ssid.trim() !== '' && !seen.has(ssid)) {
        seen.add(ssid);
        networks.push({ ssid, signal });
      }
    });
    return res.json(networks);
  });
});

app.post('/api/system/wifi/connect', requireAdmin, (req, res) => {
  const ssid = req.body && req.body.ssid;
  const password = req.body && req.body.password;
  if (!ssid || typeof ssid !== 'string' || ssid.length > 128) {
    return badRequest(res, 'ssid is required (1-128 chars)');
  }

  const args = ['nmcli', 'dev', 'wifi', 'connect', ssid];
  if (password) args.push('password', String(password));

  runCommand('sudo', args, (error) => {
    if (error) return structuredError(res, 500, 'Connection failed');
    return res.json({ ok: true, status: 'Connected' });
  });
});

app.post('/api/system/wifi/static', requireAdmin, (req, res) => {
  const { ssid, ip, gateway } = req.body || {};
  if (!ssid || typeof ssid !== 'string') return badRequest(res, 'ssid is required');

  if (ip === 'auto') {
    runCommand('sudo', ['nmcli', 'con', 'modify', ssid, 'ipv4.method', 'auto'], (error) => {
      if (error) return structuredError(res, 500, 'Failed to set DHCP');
      runCommand('sudo', ['nmcli', 'con', 'up', ssid], (upError) => {
        if (upError) return structuredError(res, 500, 'Failed to activate connection');
        return res.json({ ok: true, status: 'IP Configured' });
      });
    });
    return;
  }

  if (!ip || !gateway) return badRequest(res, 'ip and gateway are required unless ip=auto');

  runCommand('sudo', ['nmcli', 'con', 'modify', ssid, 'ipv4.addresses', ip, 'ipv4.gateway', gateway, 'ipv4.method', 'manual'], (error) => {
    if (error) return structuredError(res, 500, 'Failed to set static IP');
    runCommand('sudo', ['nmcli', 'con', 'up', ssid], (upError) => {
      if (upError) return structuredError(res, 500, 'Failed to activate connection');
      return res.json({ ok: true, status: 'IP Configured' });
    });
  });
});

app.post('/api/messages/add', requireAdmin, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return badRequest(res, 'text is required');
  if (!quickMessages.includes(text)) {
    quickMessages.push(text);
    saveMessages();
    io.emit('messagesUpdate', quickMessages);
  }
  res.json({ ok: true, messages: quickMessages });
});
legacyRoute('/api/messages/add', (req, res) => {
  const text = String((req.query && req.query.text) || '').trim();
  if (!text) return badRequest(res, 'text is required');
  if (!quickMessages.includes(text)) {
    quickMessages.push(text);
    saveMessages();
    io.emit('messagesUpdate', quickMessages);
  }
  res.json({ ok: true, messages: quickMessages });
}, { auth: true });

app.post('/api/messages/remove', requireAdmin, (req, res) => {
  const parsed = parseIntField(req.body && req.body.index, 'index', { min: 0, max: quickMessages.length - 1 });
  if (parsed.error) return badRequest(res, parsed.error)
  quickMessages.splice(parsed.value, 1);
  saveMessages();
  io.emit('messagesUpdate', quickMessages);
  res.json({ ok: true, messages: quickMessages });
});
legacyRoute('/api/messages/remove', (req, res) => {
  const index = parseInt(req.query.index, 10);
  if (Number.isNaN(index) || index < 0 || index >= quickMessages.length) return badRequest(res, 'index must be within quick message bounds');
  quickMessages.splice(index, 1);
  saveMessages();
  io.emit('messagesUpdate', quickMessages);
  res.json({ ok: true, messages: quickMessages });
}, { auth: true });

app.post('/api/rundown/set', requireAdmin, (req, res) => {
  const rundown = req.body && req.body.rundown;
  if (!Array.isArray(rundown)) return badRequest(res, 'rundown must be an array');
  const validationErrors = rundown.flatMap((segment, idx) => {
    const validation = validateRundownSegment(segment, `rundown[${idx}]`);
    return validation.ok ? [] : validation.details;
  });
  if (validationErrors.length) return badRequest(res, validationErrors);

  queue.setRundown(rundown);
  timer.state.currentIndex = queue.currentIndex;
  persistRundown();
  persistState();
  broadcast();

  res.json({ ok: true, ...queue.getState() });
});

app.post('/api/rundown/import', requireAdmin, (req, res) => {
  const csv = String((req.body && req.body.csv) || '');
  const importMode = (req.body && req.body.importMode) === 'append' ? 'append' : 'replace';
  if (!csv.trim()) return badRequest(res, 'csv is required');
  const parsed = parseRundownCsv(csv);
  if (!parsed.segments.length) return structuredError(res, 400, 'CSV import failed', parsed.warnings);
  const combined = importMode === 'append' ? [...queue.rundown, ...parsed.segments] : parsed.segments;
  queue.setRundown(combined);
  persistRundown();
  persistState();
  broadcast();
  return res.json({ ok: true, importMode, imported: parsed.segments.length, warnings: parsed.warnings, ...queue.getState() });
});

app.post('/api/rundown/item/add', requireAdmin, (req, res) => {
  const segment = req.body && req.body.segment;
  const validation = validateRundownSegment(segment, 'segment');
  if (!validation.ok) return badRequest(res, validation.details);
  queue.addSegment(segment);
  persistRundown();
  broadcast();
  res.json({ ok: true, ...queue.getState() });
});

app.post('/api/rundown/item/update', requireAdmin, (req, res) => {
  const parsed = parseIntField(req.body && req.body.index, 'index', { min: 0, max: queue.rundown.length - 1 });
  if (parsed.error) return badRequest(res, parsed.error)
  const segment = req.body && req.body.segment;
  const validation = validateRundownSegment(segment, 'segment');
  if (!validation.ok) return badRequest(res, validation.details);
  const updated = queue.updateSegment(parsed.value, segment);
  persistRundown();
  broadcast();
  res.json({ ok: true, segment: updated, ...queue.getState() });
});

app.post('/api/rundown/item/remove', requireAdmin, (req, res) => {
  const parsed = parseIntField(req.body && req.body.index, 'index', { min: 0, max: queue.rundown.length - 1 });
  if (parsed.error) return badRequest(res, parsed.error)
  const removed = queue.removeSegment(parsed.value);
  timer.state.currentIndex = queue.currentIndex;
  persistRundown();
  persistState();
  broadcast();
  res.json({ ok: true, removed, ...queue.getState() });
});

app.post('/api/rundown/previous', requireAdmin, (req, res) => {
  const prevSegment = queue.previous();
  if (!prevSegment) return structuredError(res, 400, 'No rundown loaded');

  timer.state.currentIndex = queue.currentIndex;
  applySegmentToTimer(prevSegment, false);
  persistRundown();
  persistState();
  broadcast();
  res.json({ ok: true, currentSegment: prevSegment, currentIndex: queue.currentIndex });
});

app.post('/api/rundown/run-current', requireAdmin, (req, res) => {
  const current = queue.getCurrent();
  if (!current) return structuredError(res, 400, 'No rundown loaded');
  timer.state.currentIndex = queue.currentIndex;
  applySegmentToTimer(current, true);
  persistState();
  broadcast();
  res.json({ ok: true, currentSegment: current, currentIndex: queue.currentIndex });
});

app.get('/api/rundown/actuals/export', requireAdmin, (req, res) => {
  if (!fs.existsSync(actualsLogFile)) {
    return structuredError(res, 404, 'No actuals log available');
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=\"actuals.csv\"');
  return fs.createReadStream(actualsLogFile).pipe(res);
});

app.get('/api/companion', (req, res) => {
  const state = publicState();
  const abs = Math.abs(state.timeLeft);
  const timeStr = `${state.timeLeft < 0 ? '-' : ''}${Math.floor(abs / 60).toString().padStart(2, '0')}:${(abs % 60).toString().padStart(2, '0')}`;
  const overTimeStr = state.timeLeft < 0 ? `+${Math.floor(abs / 60).toString().padStart(2, '0')}:${(abs % 60).toString().padStart(2, '0')}` : '';
  res.json({
    time: timeStr,
    running: state.isRunning,
    msg_active: state.showMessage,
    raw_seconds: state.timeLeft,
    over_time: overTimeStr,
    mode: state.mode,
    blink_state: state.blink_state,
    messages: quickMessages,
    current_segment: queue.getCurrent() ? queue.getCurrent().name : '',
    current_index: queue.currentIndex,
    rundown_length: queue.rundown.length,
  });
});

setInterval(() => {
  if (timer.tickBlink()) broadcast();
}, 500);

setInterval(() => {
  if (timer.state.isRunning || timer.state.mode === 'timeofday' || timer.state.mode === 'target') {
    broadcast();
  }
}, 250);

io.on('connection', (socket) => {
  socket.emit('stateUpdate', publicState());
  socket.emit('messagesUpdate', quickMessages);
});


registerDisplayRoutes(app, {
  sanitizeDisplayConfig,
  validateDisplayConfigPayload,
  persistDisplayConfig,
  broadcast,
  badRequest,
  structuredError,
  getDisplayConfig: () => displayConfig,
  setDisplayConfig: (next) => { displayConfig = next; },
});
registerTimerRoutes(app, { timer, persistState, broadcast, structuredError, parseIntField, reqValue, legacyRoute, requireAdmin, quickMessages });
registerRundownRoutes(app, { queue, timer, requireAdmin, structuredError, parseIntField, persistRundown, persistState, broadcast, applySegmentToTimer, appendActualsLog, actualsLogFile, fs });
registerSystemRoutes(app, {
  requireAdmin,
  structuredError,
  hardware,
  store,
  getDisplayConfig: () => displayConfig,
  setDisplayConfig: (next) => { displayConfig = next; },
  sanitizeDisplayConfig,
  queue,
  timer,
  persistState,
  persistRundown,
  persistDisplayConfig,
  broadcast,
  serviceName: systemdServiceName,
});

app.use(express.static(path.join(__dirname, 'public')));
server.listen(3000, bindHost, () => console.log(`Server running on ${bindHost}:3000`));
