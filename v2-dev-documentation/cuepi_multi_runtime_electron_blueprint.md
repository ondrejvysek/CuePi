# CuePi multi runtime and Electron desktop blueprint

## Purpose

This blueprint describes how to evolve CuePi from a Raspberry Pi based browser controlled appliance into a multi runtime application that can also run locally on Windows and macOS through Electron.

The goal is to keep the current Raspberry Pi structure working, avoid Electron on the Pi, and introduce a desktop app that can either run CuePi locally or control one or more CuePi instances on the network.

## Current direction

CuePi currently runs as a Node.js web app on the Raspberry Pi. It exposes browser based control, presenter output, DSK output, HTTP API routes, and Socket.io state updates.

The Raspberry Pi remains the preferred appliance runtime.

Electron should be introduced as a desktop shell for Windows and macOS. It should not replace the web UI. It should reuse the existing frontend and backend contracts.

## Key decisions already made

1. The desktop app must be able to run CuePi locally without a Raspberry Pi.
2. The desktop app must support presenter and DSK output windows, especially the DSK Out popup concept already prototyped in `v2-dev-documentation\\electron-dsk-prototype` which is DSK out popup in `index.html`.
3. When CuePi runs locally on a computer, the backend should bind to `127.0.0.1` by default.
4. Local network control may be added later as an explicit setting.
5. Raspberry Pi specific features such as Wi-Fi management, fallback access point, static IP configuration, service restart, and appliance update are exclusively for the Pi.
6. Electron should not run on the Raspberry Pi.
7. Multiple CuePi instances may exist on the network. They do not need to share one synced event state.
8. A master device may control multiple independent CuePi instances later. The master can be a Pi or a computer.

## Recommended architecture

CuePi should become a multi runtime application with a shared backend core and multiple shells.

```text
CuePi core
  Node backend
  Timer engine
  State store
  API routes
  Socket.io events
  Static frontend files

Raspberry Pi shell
  systemd starts backend
  backend binds to 0.0.0.0
  Chromium kiosk opens local presenter or HDMI output
  browser controls the app over the network

Desktop Electron shell
  Electron starts local backend or connects to remote backend
  backend binds to 127.0.0.1 by default in local mode
  Electron opens moderator, presenter, and DSK windows
  desktop shell handles display selection and popup placement
```

The backend remains the source of truth. Electron should not contain separate timer logic.

## Core principle

The frontend must not check whether it is running on a Pi or desktop directly.

It should check capabilities returned by the backend or shell.

Bad pattern

```js
if (isRaspberryPi) {
  showWifiSettings()
}
```

Good pattern

```js
if (runtime.capabilities.wifiManagement) {
  showWifiSettings()
}
```

This keeps the system flexible for future Linux devices, desktop shells, or controller only modes.

## Runtime model

CuePi should describe every running instance using three separate concepts.

```text
Runtime
  Where the backend process runs.

Hardware profile
  What system level features are available.

Role
  What this instance does during the event.
```

Example runtime context for Raspberry Pi

```json
{
  "app": "CuePi",
  "runtime": "node",
  "shell": "web",
  "hardwareProfile": "raspberry\_pi",
  "role": "standalone",
  "capabilities": {
    "timer": true,
    "rundown": true,
    "presenter": true,
    "dskOutput": true,
    "displaySelector": false,
    "wifiManagement": true,
    "fallbackAccessPoint": true,
    "staticIpManagement": true,
    "systemService": true,
    "softwareUpdate": true,
    "multiInstanceControl": true
  }
}
```

Example runtime context for local Electron desktop mode

```json
{
  "app": "CuePi",
  "runtime": "electron",
  "shell": "desktop",
  "hardwareProfile": "desktop",
  "role": "standalone",
  "capabilities": {
    "timer": true,
    "rundown": true,
    "presenter": true,
    "dskOutput": true,
    "displaySelector": true,
    "wifiManagement": false,
    "fallbackAccessPoint": false,
    "staticIpManagement": false,
    "systemService": false,
    "softwareUpdate": false,
    "multiInstanceControl": true
  }
}
```

## Runtime roles

Define explicit roles instead of relying on one vague master mode.

```text
standalone
  The instance owns its own event state and can be controlled locally.

controller
  The instance controls another CuePi instance.

output
  The instance only renders presenter or DSK output.

master-controller
  The instance can control multiple discovered CuePi instances.

follower
  The instance accepts commands from a selected master.
```

For the first version, implement `standalone` and `controller` only.

## Capability groups

### Core capabilities

Available on both Pi and desktop.

```text
timer
rundown
messages
logo
presenter
dskOutput
companionApi
webControl
socketState
```

### Raspberry Pi appliance capabilities

Available only when confirmed by hardware and OS detection.

```text
wifiManagement
fallbackAccessPoint
staticIpManagement
systemService
systemRestart
linuxServiceLogs
softwareUpdate
kioskHdmiOutput
```

### Electron desktop capabilities

Available only in the Electron shell.

```text
localBackend
displaySelector
openPresenterWindow
openDskWindow
fullscreenOnDisplay
rememberWindowLayout
connectToRemoteInstance
```

### Network control capabilities

Can exist on both Pi and desktop.

```text
advertiseInstance
discoverInstances
controlRemoteInstance
multiInstanceControl
```

## Proposed repository structure

```text
cuepi/
  backend/
    app.js
    server-cli.js
    runtime/
      detect-runtime.js
      detect-hardware.js
      capabilities.js
      instance-id.js
    lib/
      timer-engine.js
      state-store.js
      queue-engine.js
      hardware/
        index.js
        pi.js
        desktop.js
        noop.js
        unsupported.js
    routes/
      runtime.js
      timer.js
      display.js
      system.js
      network.js

  public/
    index.html
    presenter.html
    presenter-dsk.html
    loading.html
    assets/
    js/

  apps/
    desktop/
      package.json
      src/
        main.js
        preload.js
        windows.js
        displays.js
        remote-instances.js
        local-backend.js
      build/

  scripts/
    setup-pi.sh
    build-desktop.js

  server.js
  package.json
```

## Development phases

### Phase 1. Refactor backend startup

Goal

Make the current backend startable from both Node CLI and Electron without changing current Raspberry Pi behavior.

Tasks

1. Move Express, HTTP server, Socket.io setup, route registration, and engine initialization from `server.js` into `backend/app.js`.
2. Export a `createCuePiServer(options)` function.
3. Keep `server.js` as a thin CLI entry point.
4. Preserve current Pi startup behavior.
5. Preserve current default port `3000` for Pi mode.
6. Allow `port: 0` for Electron local mode so the operating system can choose a free port.

Example

```js
const { createCuePiServer } = require('./backend/app')

const cuepi = createCuePiServer({
  bindHost: process.env.BIND\_HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  shell: process.env.CUEPI\_SHELL || 'web',
  role: process.env.CUEPI\_ROLE || 'standalone'
})

cuepi.start().then(({ url }) => {
  console.log(`CuePi running at ${url}`)
})
```

Acceptance criteria

```text
npm start still works on Raspberry Pi.
Existing browser control still works.
Existing presenter and DSK routes still work.
Electron can import and start the backend without spawning a separate CLI process.
```

### Phase 2. Add runtime and hardware detection

Goal

Detect where CuePi is running and expose a stable runtime context to the frontend.

Tasks

1. Add `backend/runtime/detect-hardware.js`.
2. Add `backend/runtime/capabilities.js`.
3. Add `backend/routes/runtime.js`.
4. Add `/api/runtime`.
5. Include app version, instance ID, runtime, shell, hardware profile, role, detected hardware, and capabilities.

Suggested detection logic

```js
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child\_process')

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function commandExists(command) {
  try {
    execFileSync('which', \[command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function detectRaspberryPi() {
  if (process.platform !== 'linux') return false

  const model =
    safeRead('/proc/device-tree/model') ||
    safeRead('/sys/firmware/devicetree/base/model')

  const cpuInfo = safeRead('/proc/cpuinfo')

  return /raspberry pi/i.test(model) || /raspberry pi/i.test(cpuInfo)
}

function detectHardware() {
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    isRaspberryPi: detectRaspberryPi(),
    hasSystemd: fs.existsSync('/run/systemd/system') || commandExists('systemctl'),
    hasNetworkManager: process.platform === 'linux' \&\& commandExists('nmcli'),
    hasSudo: process.platform === 'linux' \&\& commandExists('sudo'),
    isElectron: Boolean(process.versions \&\& process.versions.electron)
  }
}

module.exports = { detectHardware }
```

Acceptance criteria

```text
/api/runtime returns valid JSON on Pi.
/api/runtime returns valid JSON on Windows and macOS desktop.
Pi specific capabilities are true only on confirmed Pi appliance mode.
Desktop capabilities are true only in Electron shell mode.
```

### Phase 3. Capability guard Pi only routes

Goal

Prevent desktop mode from exposing or attempting unsupported Pi operations.

Tasks

1. Add `requireCapability(runtimeContext, capability)` middleware.
2. Apply it to all Pi specific routes.
3. Return a consistent unsupported response when a capability is unavailable.
4. Do not let desktop mode call `nmcli`, `systemctl`, fallback AP scripts, or Git update logic.

Example

```js
function requireCapability(runtimeContext, capability) {
  return (req, res, next) => {
    if (!runtimeContext.capabilities\[capability]) {
      return res.status(404).json({
        ok: false,
        code: 'CAPABILITY\_NOT\_AVAILABLE',
        capability,
        message: `${capability} is not available on this device`
      })
    }

    next()
  }
}
```

Routes to guard

```text
Wi-Fi scan
Wi-Fi connect
Fallback AP enable and disable
Static IP configuration
System service restart
System logs
Software update
Pi shutdown or reboot if present
```

Acceptance criteria

```text
Pi routes still work on Raspberry Pi.
Desktop mode does not attempt Pi only commands.
Desktop mode returns a clear unsupported response.
UI does not show Pi only cards when capabilities are false.
```

### Phase 4. Add hardware adapters

Goal

Separate Pi system operations from desktop behavior.

Tasks

1. Create `backend/lib/hardware/index.js`.
2. Keep Pi specific implementation in `backend/lib/hardware/pi.js`.
3. Add `backend/lib/hardware/desktop.js`.
4. Add `backend/lib/hardware/noop.js` if useful for tests.
5. Inject runtime context into hardware adapter creation.

Example

```js
function createHardware(options) {
  const { runtimeContext } = options

  if (runtimeContext.hardwareProfile === 'raspberry\_pi') {
    return require('./pi').createPiHardware(options)
  }

  return require('./desktop').createDesktopHardware(options)
}

module.exports = { createHardware }
```

Desktop adapter example

```js
function unsupported(name) {
  return (callback) => {
    const error = new Error(`${name} is not available on this device`)
    error.code = 'CAPABILITY\_NOT\_AVAILABLE'
    callback(error)
  }
}

function createDesktopHardware() {
  return {
    getApStatus: callback => callback(null, false),
    setAp: unsupported('Fallback access point'),
    scanWifi: unsupported('Wi-Fi scan'),
    connectWifi: unsupported('Wi-Fi connect'),
    setStaticIp: unsupported('Static IP management'),
    restartService: unsupported('Service restart'),
    updateSoftware: unsupported('Software update')
  }
}

module.exports = { createDesktopHardware }
```

Acceptance criteria

```text
All Pi specific commands live behind the Pi adapter.
Desktop backend can run without Linux specific tools installed.
Unsupported operations fail predictably.
```

### Phase 5. Make data path configurable

Goal

Avoid writing persistent data inside packaged desktop app files.

Tasks

1. Add `CUEPI\_DATA\_DIR` support.
2. Pass `dataDir` into `StateStore`.
3. On Pi, preserve current behavior unless a data dir is configured.
4. In Electron, use `app.getPath('userData')`.

Example

```js
const dataDir =
  options.dataDir ||
  process.env.CUEPI\_DATA\_DIR ||
  path.join(process.cwd(), 'data')
```

Acceptance criteria

```text
Pi data persistence remains unchanged or explicitly configured.
Desktop data is stored in the user application data folder.
Packaged app does not need write access to its install directory.
```

### Phase 6. Update frontend to consume capabilities

Goal

Make the same frontend work safely on Pi, browser, desktop local mode, and desktop controller mode.

Tasks

1. Add a small runtime client module.
2. Fetch `/api/runtime` during frontend initialization.
3. Store runtime context globally or in app state.
4. Hide or disable unsupported UI sections.
5. Show runtime information in diagnostics or settings.

Example

```js
async function loadRuntimeContext() {
  const response = await fetch('/api/runtime')
  const runtime = await response.json()

  window.CUEPI\_RUNTIME = runtime

  document.body.dataset.hardwareProfile = runtime.hardwareProfile
  document.body.dataset.role = runtime.role

  toggleSection('wifi-settings', runtime.capabilities.wifiManagement)
  toggleSection('fallback-ap-settings', runtime.capabilities.fallbackAccessPoint)
  toggleSection('desktop-display-settings', runtime.capabilities.displaySelector)
  toggleSection('dsk-popup-button', runtime.capabilities.openDskWindow)
}
```

Acceptance criteria

```text
Pi only settings are visible on Pi.
Pi only settings are hidden on Windows and macOS.
Desktop display controls are visible only in Electron.
Frontend does not rely on hardcoded OS checks.
```

### Phase 7. Integrate Electron desktop shell

Goal

Turn the existing Electron concept into the official desktop shell.

Tasks

1. Move the Electron prototype into `apps/desktop`.
2. Add local mode that starts the CuePi backend internally.
3. Add remote mode that connects to an existing CuePi instance.
4. Add moderator window.
5. Add presenter output window.
6. Add DSK output window.
7. Add display selection.
8. Add remembered window layout.
9. Keep Electron security defaults strict.

Recommended Electron web preferences

```js
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: path.join(\_\_dirname, 'preload.js')
}
```

Local backend example

```js
const { app, BrowserWindow } = require('electron')
const { createCuePiServer } = require('../../../backend/app')

let cuepi

async function startLocalCuePi() {
  cuepi = createCuePiServer({
    bindHost: '127.0.0.1',
    port: 0,
    shell: 'electron',
    role: 'standalone',
    dataDir: app.getPath('userData')
  })

  await cuepi.start()

  const address = cuepi.server.address()
  return `http://127.0.0.1:${address.port}`
}
```

Acceptance criteria

```text
Desktop app can start a local CuePi backend.
Desktop app can open moderator UI.
Desktop app can open DSK output popup.
Desktop app can place output on selected display.
Desktop app does not expose local backend to the network by default.
```

### Phase 8. Add remote CuePi connection mode

Goal

Allow the desktop app to control an existing Raspberry Pi or another desktop CuePi instance.

Tasks

1. Add start screen with two choices.

```text
Use this computer as CuePi
Connect to existing CuePi
```

2. Add manual URL or IP entry.
3. Call remote `/api/runtime` after connecting.
4. Store recent connections.
5. Show remote capabilities.
6. Allow local DSK or presenter window to connect to the remote instance if needed.

Important distinction

In remote mode, the app has two capability sets.

```json
{
  "localCapabilities": {
    "displaySelector": true,
    "openDskWindow": true
  },
  "remoteCapabilities": {
    "wifiManagement": true,
    "fallbackAccessPoint": true,
    "timer": true,
    "dskOutput": true
  }
}
```

Acceptance criteria

```text
Desktop app can connect to a Pi by manual IP or hostname.
Desktop app can control the remote CuePi instance.
Desktop app can show Pi specific settings only when the remote target supports them.
Local desktop DSK window can render remote CuePi state if selected.
```

### Phase 9. Add multi instance control foundation

Goal

Prepare for controlling multiple independent CuePi instances from one device.

Do not implement full state sync first.

Recommended model

```text
Each CuePi instance owns its own event state.
A controller can send commands to one or more selected targets.
Targets execute commands locally.
Targets report state back to the controller.
```

Avoid this in the first version

```text
All instances automatically sync one shared event state.
```

Tasks

1. Add stable instance ID.
2. Add instance name.
3. Add `/api/instance` or include this in `/api/runtime`.
4. Add remote target list in desktop app.
5. Add selected target concept.
6. Add command routing abstraction.
7. Add grouped commands later.

Instance advertisement shape

```json
{
  "id": "uuid",
  "name": "CuePi Main Stage",
  "url": "http://192.168.1.44:3000",
  "role": "standalone",
  "hardwareProfile": "raspberry\_pi",
  "capabilities": {
    "timer": true,
    "presenter": true,
    "dskOutput": true,
    "wifiManagement": true
  }
}
```

Acceptance criteria

```text
Every CuePi instance has a stable ID.
Every CuePi instance has a human friendly name.
Desktop controller can store more than one target.
Commands can be routed to a selected target.
No automatic shared state sync is required.
```

### Phase 10. Add discovery later

Goal

Make CuePi instances discoverable on the local network.

Recommended order

1. Manual IP or hostname first.
2. Recent connections second.
3. mDNS discovery third.
4. Group control fourth.

Possible mDNS service name

```text
\_cuepi.\_tcp.local
```

Discovery payload should include

```text
Instance ID
Instance name
Version
Role
Hardware profile
Capabilities summary
URL
```

Acceptance criteria

```text
Desktop app can discover CuePi instances on the local network.
Discovery does not replace manual connection.
Discovery can be disabled.
Discovered devices are verified by calling /api/runtime before use.
```

### Phase 11. Packaging and release

Goal

Produce Windows and macOS desktop builds.

Tasks

1. Use Electron Builder.
2. Build Windows NSIS installer.
3. Build macOS DMG.
4. Add app icon.
5. Add version display in UI.
6. Add unsigned local developer builds first.
7. Add signing and notarization later.

Suggested desktop package scripts

```json
{
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --dir",
    "build": "electron-builder",
    "build:win": "electron-builder --win nsis",
    "build:mac": "electron-builder --mac dmg"
  }
}
```

Acceptance criteria

```text
Windows build starts successfully.
macOS build starts successfully.
Local backend starts and stops with the app.
Packaged app stores data in the user data folder.
DSK popup works in packaged app.
```

## Recommended API additions

### GET /api/runtime

Returns runtime context and capabilities.

### GET /api/instance

Returns stable identity and friendly name.

This may be merged into `/api/runtime` at first.

### POST /api/instance/name

Renames the instance.

Admin protected.

### GET /api/remotes

Returns known remote instances.

Desktop only or controller mode only.

### POST /api/remotes

Adds a remote instance manually.

### POST /api/remotes/:id/command

Sends a command to a selected remote instance.

Future phase.

## Recommended environment variables

```text
PORT
BIND\_HOST
CUEPI\_DATA\_DIR
CUEPI\_SHELL
CUEPI\_ROLE
CUEPI\_INSTANCE\_NAME
CUEPI\_ALLOW\_NETWORK\_CONTROL
CUEPI\_ADMIN\_TOKEN
```

Suggested defaults

```text
Pi web mode
  BIND\_HOST=0.0.0.0
  PORT=3000
  CUEPI\_SHELL=web
  CUEPI\_ROLE=standalone

Desktop local mode
  BIND\_HOST=127.0.0.1
  PORT=0
  CUEPI\_SHELL=electron
  CUEPI\_ROLE=standalone
```

## Security recommendations

1. Desktop local backend should bind to `127.0.0.1` by default.
2. Network exposure should require an explicit setting.
3. Admin protected routes should remain protected on Pi and desktop.
4. Remote connection mode should display the connected target clearly.
5. Electron should use `contextIsolation: true` and `nodeIntegration: false`.
6. Pi only system routes should not exist as callable operations on desktop.
7. mDNS discovery should be treated as discovery only, not trust.
8. Every remote target should be verified by calling `/api/runtime`.

## Testing checklist

### Raspberry Pi regression

```text
App starts through existing service.
Browser control works.
Presenter output works.
DSK output works.
Wi-Fi settings work.
Fallback AP works.
Static IP settings work.
Companion API works.
State persists after restart.
```

### Desktop local mode

```text
App starts on Windows.
App starts on macOS.
Backend starts on 127.0.0.1.
Moderator window opens.
Presenter window opens.
DSK window opens.
Display selector works.
Pi settings are hidden.
State persists in user data folder.
App quits cleanly and stops backend.
```

### Desktop remote mode

```text
Manual Pi IP connection works.
Remote runtime context is loaded.
Remote capabilities are shown correctly.
Pi settings appear only when connected target supports them.
Local DSK popup can render remote state.
Connection failure is handled clearly.
Recent connections are saved.
```

### Multi instance foundation

```text
Each instance has stable ID.
Each instance has friendly name.
Controller can store multiple targets.
Controller can select active target.
Commands affect only selected target.
No accidental global sync occurs.
```

## Open questions before implementation

1. Should desktop local mode have Companion API enabled by default, or only when local network access is enabled?

Recommendation

Keep it enabled only on the local backend. If external Companion control is needed, require explicit local network exposure.

2. Should desktop remote mode require an admin token for Pi system settings?

Recommendation

Yes. Keep the same admin model for browser and Electron clients.

3. Should the desktop app allow both local and remote sessions at the same time?

Recommendation

Not in the first version. Start with one active session per app window. Add advanced multi target control later.

4. Should DSK output from desktop remote mode use remote state or local state?

Recommendation

Remote mode DSK should use remote state. Local mode DSK should use local state. Make the source visible in the UI.

5. Should discovery be required for version one?

Recommendation

No. Manual IP plus recent connections is enough for the first working desktop app.

6. Should Pi detection rely only on Raspberry Pi model files?

Recommendation

No. Use a capability based result. Raspberry Pi detection should identify the device, but Pi features should still require Linux, systemd, NetworkManager, and available command line tools.

7. Should desktop software update be implemented?

Recommendation

Not initially. Pi update and desktop app update should be treated separately.

8. Should there be one shared settings page for Pi and desktop?

Recommendation

Yes, but every section should be capability driven. Do not create two separate settings UIs unless required.

## Recommended first development milestone

Build the smallest safe slice first.

Scope

```text
Refactor backend startup.
Add /api/runtime.
Add hardware detection.
Add capability map.
Guard Pi only routes.
Update frontend to hide unsupported sections.
Create Electron app that starts local backend and opens moderator plus DSK window.
```

Do not include in the first milestone

```text
mDNS discovery
multi target control
state synchronization
auto update
code signing
notarization
advanced network permissions
```

## Definition of done for first milestone

```text
Current Raspberry Pi deployment still works without functional regression.
Windows desktop app can run CuePi locally.
macOS desktop app can run CuePi locally.
DSK popup works from Electron.
Pi specific settings do not appear on desktop.
The frontend uses capabilities instead of hardcoded platform checks.
The backend can clearly explain its runtime through /api/runtime.
```

## Final recommendation

Implement this as a capability driven multi runtime architecture.

Keep the Raspberry Pi as the appliance runtime.

Use Electron as a desktop shell, not a separate product.

Let every CuePi instance own its own state.

Add master control later as command routing across independent instances, not automatic shared state sync.

This approach keeps the current Pi product stable while making Windows and macOS support possible without duplicating the core app.

