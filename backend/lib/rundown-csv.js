function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cell += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((part) => String(part).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((part) => String(part).trim() !== '')) rows.push(row);
  }
  return rows;
}

function parseDurationToSeconds(raw) {
  const value = String(raw || '').trim();
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.max(0, parseInt(value, 10));
  const parts = value.split(':').map((p) => p.trim()).filter(Boolean).map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return Math.max(0, (parts[0] * 60) + parts[1]);
  if (parts.length === 3) return Math.max(0, (parts[0] * 3600) + (parts[1] * 60) + parts[2]);
  return 0;
}

function createRundownCsvParser(queue) {
  return function parseRundownCsv(csvText) {
    const rows = parseCsvRows(csvText);
    if (!rows.length) return { segments: [], warnings: ['CSV is empty'] };
    const header = rows[0].map((v) => String(v || '').trim().toLowerCase());
    const hasHeader = header.includes('name') || header.includes('segment') || header.includes('duration') || header.includes('mode') || header.includes('notes');
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const warnings = [];
    const indexOf = (keys, fallback) => keys.map((k) => header.indexOf(k)).find((i) => i >= 0) ?? fallback;
    const nameIdx = hasHeader ? indexOf(['name', 'segment', 'title'], 0) : 0;
    const durationIdx = hasHeader ? indexOf(['duration', 'seconds', 'duration_seconds', 'time'], 1) : 1;
    const modeIdx = hasHeader ? indexOf(['mode', 'type'], 2) : 2;
    const notesIdx = hasHeader ? indexOf(['notes', 'note', 'optional_note'], 3) : 3;
    const validModes = new Set(['countdown', 'countup', 'timeofday', 'logo']);
    const segments = dataRows.map((cols, idx) => {
      const rowNum = hasHeader ? idx + 2 : idx + 1;
      const rawName = String(cols[nameIdx] || '').trim();
      const rawMode = String(cols[modeIdx] || '').trim().toLowerCase();
      const rawDuration = cols[durationIdx];
      if (rawMode && !validModes.has(rawMode)) warnings.push(`Row ${rowNum}: unknown mode "${rawMode}", defaulted to countdown`);
      return queue.sanitizeSegment({
        name: rawName || 'Untitled Segment',
        duration: parseDurationToSeconds(rawDuration),
        mode: validModes.has(rawMode) ? rawMode : 'countdown',
        notes: String(cols[notesIdx] || '').trim(),
      });
    });
    return { segments, warnings };
  };
}

module.exports = { createRundownCsvParser };
