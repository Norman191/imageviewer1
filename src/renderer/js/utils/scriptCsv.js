// Excel-compatible import/export for the Auto Chat Script — implemented as
// CSV rather than a real binary .xlsx. Excel (and Google Sheets, Numbers,
// etc.) open, edit, and save CSV files natively, so "download the template,
// fill it in Excel, upload it back" works end-to-end without adding a new
// npm dependency for real .xlsx parsing.

export const TEMPLATE_HEADERS = [
  'time', 'user', 'action', 'message', 'image', 'target_time', 'emoji', 'target_count', 'growth', 'duration', 'randomize'
];

function csvField(value) {
  const str = String(value === null || value === undefined ? '' : value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

export function buildTemplateCsv() {
  const lines = [csvRow(TEMPLATE_HEADERS)];
  lines.push(csvRow(['00:00', 'Alex', 'message', 'Hey everyone!', '', '', '', '', '', '', '']));
  lines.push(csvRow(['00:02', 'Mike', 'typing', '', '', '', '', '', '', '', '']));
  lines.push(csvRow(['00:04', 'Mike', 'message', 'What is going on?', '', '', '', '', '', '', '']));
  lines.push(csvRow(['00:05', 'Alex', 'file', 'check this out', 'C:\\path\\to\\image.png', '', '', '', '', '', '']));
  lines.push(csvRow(['00:06', 'Alex', 'reaction', '', '', '00:00', '😂', '23', 'gradual', '5', 'yes']));
  lines.push(csvRow(['00:08', 'Alex', 'wait', '', '', '', '', '', '', '5', '']));
  return lines.join('\r\n');
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped quotes ("") and embedded newlines within quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const VALID_ACTIONS = new Set(['message', 'file', 'typing', 'reaction', 'wait']);
const VALID_GROWTH = new Set(['instant', 'gradual']);

function parseTimeStr(str) {
  const trimmed = (str || '').trim();
  if (/^\d+:\d{1,2}$/.test(trimmed)) {
    const [mm, ss] = trimmed.split(':').map(Number);
    return mm * 60 + ss;
  }
  if (trimmed === '') return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function truthy(str) {
  const v = (str || '').trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

// Validates and converts parsed CSV rows into script-event descriptors
// ({ time, characterId, action, payload }), matching reaction rows to a
// target message by its `time` value among the rows in THIS import batch
// (message/file rows only). Returns { events, errors } — errors are
// 1-indexed by data row (header excluded) for clear reporting, and a bad
// row is skipped rather than aborting the whole import.
export function parseScriptCsv(csvText, characters) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { events: [], errors: ['The file is empty.'] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dataRows = rows.slice(1);
  const col = (name) => header.indexOf(name);

  const idx = {
    time: col('time'), user: col('user'), action: col('action'), message: col('message'),
    image: col('image'), targetTime: col('target_time'), emoji: col('emoji'),
    targetCount: col('target_count'), growth: col('growth'), duration: col('duration'), randomize: col('randomize')
  };
  if (idx.time === -1 || idx.user === -1 || idx.action === -1) {
    return { events: [], errors: ['Missing required column(s): time, user, action.'] };
  }

  const errors = [];
  const events = [];
  // time -> event, for matching a reaction's target_time within this batch
  const messageEventsByTime = new Map();

  dataRows.forEach((cells, i) => {
    const rowNum = i + 1;
    const get = (colIdx) => (colIdx === -1 ? '' : (cells[colIdx] || '').trim());

    const action = get(idx.action).toLowerCase();
    if (!action) return; // silently skip fully blank rows
    if (!VALID_ACTIONS.has(action)) {
      errors.push(`Row ${rowNum}: unknown action "${get(idx.action)}" (expected message, file, typing, reaction, or wait).`);
      return;
    }

    const time = parseTimeStr(get(idx.time));
    if (time === null) {
      errors.push(`Row ${rowNum}: invalid or missing time ("${get(idx.time)}"). Use mm:ss or seconds.`);
      return;
    }

    let characterId = null;
    if (action !== 'wait') {
      const userName = get(idx.user);
      if (!userName) {
        errors.push(`Row ${rowNum}: missing user for a ${action} event.`);
        return;
      }
      const character = characters.find((c) => c.name.toLowerCase() === userName.toLowerCase());
      if (!character) {
        errors.push(`Row ${rowNum}: no character named "${userName}" exists.`);
        return;
      }
      characterId = character.id;
    }

    let payload = {};
    if (action === 'message' || action === 'file') {
      const text = get(idx.message);
      if (action === 'message' && !text) {
        errors.push(`Row ${rowNum}: message action requires text in the "message" column.`);
        return;
      }
      payload = { text };
      const imagePath = get(idx.image);
      if (imagePath) {
        payload.attachments = [{ imagePath }]; // resolved into a real attachment by the caller
      }
      messageEventsByTime.set(time, { time, payload });
    } else if (action === 'reaction') {
      const emoji = get(idx.emoji);
      if (!emoji) {
        errors.push(`Row ${rowNum}: reaction requires an emoji.`);
        return;
      }
      const targetTimeStr = get(idx.targetTime);
      const targetTime = parseTimeStr(targetTimeStr);
      if (targetTime === null || !messageEventsByTime.has(targetTime)) {
        errors.push(`Row ${rowNum}: target_time "${targetTimeStr}" does not match any message/file row's time in this file.`);
        return;
      }
      payload = { emoji, targetTime }; // targetTime resolved to a real event id by the caller after creation
      const targetCountStr = get(idx.targetCount);
      if (targetCountStr) {
        const targetCount = parseInt(targetCountStr, 10);
        if (!Number.isFinite(targetCount) || targetCount < 0) {
          errors.push(`Row ${rowNum}: target_count "${targetCountStr}" must be a non-negative number.`);
          return;
        }
        const growth = (get(idx.growth) || 'instant').toLowerCase();
        if (!VALID_GROWTH.has(growth)) {
          errors.push(`Row ${rowNum}: growth "${get(idx.growth)}" must be "instant" or "gradual".`);
          return;
        }
        payload.automation = {
          targetCount,
          mode: growth,
          durationSeconds: parseFloat(get(idx.duration)) || 5,
          randomize: truthy(get(idx.randomize))
        };
      }
    } else if (action === 'wait') {
      const seconds = parseFloat(get(idx.duration));
      payload = { seconds: Number.isFinite(seconds) ? seconds : 0 };
    }
    // 'typing' needs no payload beyond characterId, already set.

    events.push({ time, characterId, action, payload });
  });

  return { events, errors };
}
