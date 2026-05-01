const { execFile } = require('child_process');
const runCommand = (bin, args, cb) => execFile(bin, args, (error, stdout, stderr) => cb(error, stdout, stderr));
function createHardware({ systemdServiceName, legacySystemdServiceName, apConnectionName, legacyApConnectionName }) {
  return {
    restartService: () => runCommand('sudo', ['systemctl', 'restart', systemdServiceName], (e) => e && runCommand('sudo', ['systemctl', 'restart', legacySystemdServiceName], () => {})),
    reloadHdmiOutput: () => runCommand('bash', ['-lc', `pkill -f chromium || true; sudo systemctl restart ${systemdServiceName} || sudo systemctl restart ${legacySystemdServiceName}`], () => {}),
    updateSystem: () => runCommand('bash', ['-lc', `git pull && npm install && sudo apt update && sudo apt upgrade -y && (sudo systemctl restart ${systemdServiceName} || sudo systemctl restart ${legacySystemdServiceName})`], () => {}),
    setHostname: (name, cb) => runCommand('sudo', ['hostnamectl', 'set-hostname', name], cb),
    setAp: (action, cb) => {
      const desired = action === 'on' ? 'up' : 'down';
      runCommand('sudo', ['nmcli', 'con', desired, apConnectionName], (error) => {
        if (!error) return cb(null, { desired, legacy: false });
        return runCommand('sudo', ['nmcli', 'con', desired, legacyApConnectionName], (legacyError) => legacyError ? cb(legacyError) : cb(null, { desired, legacy: true }));
      });
    },
    getApStatus: (cb) => runCommand('nmcli', ['-t', '-f', 'NAME', 'con', 'show', '--active'], (e, out='') => cb(null, !e && (out.includes(apConnectionName) || out.includes(legacyApConnectionName)))),
  };
}
module.exports = { createHardware };
