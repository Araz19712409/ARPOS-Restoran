const fs = require('fs');
const path = require('path');
const store = require('./store');

const DIR = path.join(__dirname, 'data', 'journal');
const KEEP_DAYS = 90;

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function dayKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function prune() {
  ensureDir();
  const cut = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  try {
    fs.readdirSync(DIR).forEach(function (name) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) {
        return;
      }
      const stamp = new Date(name.slice(0, 10) + 'T00:00:00').getTime();
      if (Number.isFinite(stamp) && stamp < cut) {
        fs.unlinkSync(path.join(DIR, name));
      }
    });
  } catch (error) {
    return;
  }
}

function readDay(key) {
  const file = path.join(DIR, dayKey(key) + '.json');
  try {
    const raw = store.readJson(file);
    return Array.isArray(raw.rows) ? raw.rows : [];
  } catch (error) {
    return [];
  }
}

function append(row) {
  try {
    prune();
    ensureDir();
    const key = dayKey(new Date());
    const file = path.join(DIR, key + '.json');
    const rows = readDay(key);
    rows.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      userId: Number(row && row.userId) || 0,
      userName: String((row && row.userName) || '').trim().slice(0, 40),
      kind: String((row && row.kind) || 'info').slice(0, 24),
      text: String((row && row.text) || '').trim().slice(0, 160)
    });
    store.writeJson(file, { rows: rows });
  } catch (error) {
    return;
  }
}

function parseDay(value) {
  const key = dayKey(value);
  const parts = key.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) {
    return null;
  }
  return new Date(y, m - 1, d);
}

function readRange(from, to) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end || start > end) {
    return [];
  }
  const out = [];
  const cur = new Date(start.getTime());
  let guard = 0;
  while (cur <= end && guard < 62) {
    readDay(dayKey(cur)).forEach(function (row) {
      out.push(row);
    });
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return out;
}

module.exports = {
  append: append,
  readDay: readDay,
  readRange: readRange,
  dayKey: dayKey
};
