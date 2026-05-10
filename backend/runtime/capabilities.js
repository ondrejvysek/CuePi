function createCapabilities({ hardware, shell }) {
  const isPiAppliance = Boolean(hardware.isRaspberryPi && hardware.platform === 'linux' && hardware.hasSystemd && hardware.hasNetworkManager && hardware.hasSudo);
  const isElectron = shell === 'electron' || hardware.isElectron;
  return {
    timer: true, rundown: true, messages: true, logo: true, presenter: true, dskOutput: true, companionApi: true, webControl: true, socketState: true,
    wifiManagement: isPiAppliance, fallbackAccessPoint: isPiAppliance, staticIpManagement: isPiAppliance, systemService: isPiAppliance, softwareUpdate: isPiAppliance, kioskHdmiOutput: isPiAppliance,
    localBackend: isElectron, displaySelector: isElectron, openPresenterWindow: isElectron, openDskWindow: isElectron,
  };
}
function detectHardwareProfile(hardware, shell) { if (hardware.isRaspberryPi && shell !== 'electron') return 'raspberry_pi'; return 'desktop'; }
module.exports = { createCapabilities, detectHardwareProfile };
