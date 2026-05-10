const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
function safeRead(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } }
function commandExists(command) { try { execFileSync('which', [command], { stdio: 'ignore' }); return true; } catch (_) { return false; } }
function detectRaspberryPi() {
  if (process.platform !== 'linux') return false;
  const model = safeRead('/proc/device-tree/model') || safeRead('/sys/firmware/devicetree/base/model');
  const cpuInfo = safeRead('/proc/cpuinfo');
  return /raspberry pi/i.test(model) || /raspberry pi/i.test(cpuInfo);
}
function detectHardware() {
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    isRaspberryPi: detectRaspberryPi(),
    hasSystemd: fs.existsSync('/run/systemd/system') || commandExists('systemctl'),
    hasNetworkManager: process.platform === 'linux' && commandExists('nmcli'),
    hasSudo: process.platform === 'linux' && commandExists('sudo'),
    isElectron: Boolean(process.versions && process.versions.electron),
  };
}
module.exports = { detectHardware };
