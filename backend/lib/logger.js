const fs = require('fs');

function createLogger({ actualsLogFile, onError = console.error }) {
  function csvEscape(value) {
    const str = String(value ?? '');
    if (!/[,"\n]/.test(str)) return str;
    return `"${str.replace(/"/g, '""')}"`;
  }

  function appendActualsLog(segmentName, plannedSeconds, actualSeconds) {
    try {
      const timestamp = new Date().toISOString();
      const delta = actualSeconds - plannedSeconds;
      const line = [
        csvEscape(timestamp),
        csvEscape(segmentName),
        csvEscape(plannedSeconds),
        csvEscape(actualSeconds),
        csvEscape(delta),
      ].join(',') + '\n';

      if (!fs.existsSync(actualsLogFile)) {
        fs.writeFileSync(actualsLogFile, 'timestamp,speaker,planned_seconds,actual_seconds,delta_seconds\n');
      }

      fs.appendFileSync(actualsLogFile, line);
    } catch (error) {
      onError('Failed to append actuals log', error);
    }
  }

  return { csvEscape, appendActualsLog };
}

module.exports = { createLogger };
