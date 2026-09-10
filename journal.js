const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const store = require('./store');

const KEEP_DAYS = 90;

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function journalDir() {
  return path.join(db.dataDir(), 'journal');
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
  fs.mkdirSync(journalDir(), { recursive: true });
}

function prune() {
  ensureDir();
  const cut = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  try {
    fs.readdirSync(journalDir()).forEach(function (name) {
      if (!/^\d{4}-\d{2}-\d{2}\.(json|jsonl)$/.test(name)) {
        return;
      }
      const stamp = new Date(name.slice(0, 10) + 'T00:00:00').getTime();
      if (Number.isFinite(stamp) && stamp < cut) {
        fs.unlinkSync(path.join(journalDir(), name));
      }
    });
  } catch (error) {
    return;
  }
}

function payload(row) {
  return [
    row.id || '',
    row.at || '',
    Number(row.userId) || 0,
    row.userName || '',
    row.kind || '',
    row.text || ''
  ].join('\t');
}

function chainHash(prev, row) {
  return crypto.createHash('sha256')
    .update(String(prev || '0') + '\n' + payload(row))
    .digest('hex');
}

function jsonlFile(key) {
  return path.join(journalDir(), dayKey(key) + '.jsonl');
}

function jsonFile(key) {
  return path.join(journalDir(), dayKey(key) + '.json');
}

function lastHash(file) {
  if (!fs.existsSync(file)) {
    return '0';
  }
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) {
    return '0';
  }
  const line = text.slice(text.lastIndexOf('\n') + 1);
  try {
    const row = JSON.parse(line);
    return row.hash || '0';
  } catch (error) {
    return '0';
  }
}

function readLegacy(key) {
  const file = jsonFile(key);
  try {
    const raw = store.readJson(file);
    return (Array.isArray(raw.rows) ? raw.rows : []).map(function (row) {
      return {
        id: row.id || '',
        at: row.at || '',
        userId: Number(row.userId) || 0,
        userName: row.userName || '',
        kind: row.kind || '',
        text: row.text || '',
        sealed: false,
        tampered: false
      };
    });
  } catch (error) {
    return [];
  }
}

function readJsonl(key) {
  const file = jsonlFile(key);
  if (!fs.existsSync(file)) {
    return [];
  }
  let prev = '0';
  const out = [];
  fs.readFileSync(file, 'utf8').split(/\n/).forEach(function (line) {
    const text = line.trim();
    if (!text) {
      return;
    }
    let row;
    try {
      row = JSON.parse(text);
    } catch (error) {
      out.push({
        id: '',
        at: '',
        userId: 0,
        userName: '',
        kind: 'info',
        text: 'Sətir oxunmadı',
        sealed: true,
        tampered: true
      });
      prev = '0';
      return;
    }
    const expect = chainHash(prev, row);
    const packed = {
      id: row.id || '',
      at: row.at || '',
      userId: Number(row.userId) || 0,
      userName: row.userName || '',
      kind: row.kind || '',
      text: row.text || '',
      sealed: true,
      tampered: row.hash !== expect
    };
    prev = row.hash || expect;
    out.push(packed);
  });
  return out;
}

function readDay(key) {
  return readLegacy(key).concat(readJsonl(key));
}

function append(row) {
  try {
    prune();
    ensureDir();
    const key = dayKey(new Date());
    const file = jsonlFile(key);
    const packed = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      userId: Number(row && row.userId) || 0,
      userName: String((row && row.userName) || '').trim().slice(0, 40),
      kind: String((row && row.kind) || 'info').slice(0, 24),
      text: String((row && row.text) || '').trim().slice(0, 160)
    };
    packed.hash = chainHash(lastHash(file), packed);
    fs.appendFileSync(file, JSON.stringify(packed) + '\n', 'utf8');
    return packed;
  } catch (error) {
    return null;
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
