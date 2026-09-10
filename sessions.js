const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const FILE = path.join(__dirname, 'data', 'sessions.json');
const KEY_FILE = path.join(__dirname, 'data', 'session.key');
const MAX_IDLE_MS = 12 * 60 * 60 * 1000;
const SAVE_EVERY_MS = 15 * 1000;

let sessions = {};
let lastSave = 0;
let dirty = false;
let key = null;

function loadKey() {
  try {
    const buf = fs.readFileSync(KEY_FILE);
    if (buf.length === 32) {
      return buf;
    }
  } catch (error) {
    // ilk dəfə açar yazılır
  }
  const next = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, next);
  return next;
}

function encryptPayload(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: enc.toString('hex')
  };
}

function decryptPayload(raw) {
  const iv = Buffer.from(raw.iv, 'hex');
  const tag = Buffer.from(raw.tag, 'hex');
  const data = Buffer.from(raw.data, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

function isEncrypted(raw) {
  return !!(raw && raw.v === 1 && raw.iv && raw.tag && raw.data);
}

function parseStore(raw) {
  if (isEncrypted(raw)) {
    return decryptPayload(raw);
  }
  return raw;
}

function load() {
  key = loadKey();
  let migrated = false;
  try {
    const raw = store.readJson(FILE);
    migrated = !isEncrypted(raw);
    const box = parseStore(raw);
    const rows = box && box.sessions && typeof box.sessions === 'object' ? box.sessions : {};
    sessions = {};
    Object.keys(rows).forEach(function (token) {
      const row = rows[token];
      if (row && row.userId && row.at) {
        sessions[token] = { userId: Number(row.userId), at: Number(row.at) };
      }
    });
  } catch (error) {
    sessions = {};
  }
  if (migrated) {
    dirty = true;
    save(true);
  }
}

function save(force) {
  const now = Date.now();
  if (!force && !dirty) {
    return;
  }
  if (!force && now - lastSave < SAVE_EVERY_MS) {
    return;
  }
  store.writeJson(FILE, encryptPayload({ sessions: sessions }));
  lastSave = now;
  dirty = false;
}

function sweep() {
  const now = Date.now();
  let cut = false;
  Object.keys(sessions).forEach(function (token) {
    if (now - sessions[token].at > MAX_IDLE_MS) {
      delete sessions[token];
      cut = true;
    }
  });
  if (cut) {
    dirty = true;
    save(true);
  }
}

function create(userId) {
  sweep();
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { userId: Number(userId), at: Date.now() };
  dirty = true;
  save(true);
  return token;
}

function get(token) {
  sweep();
  const row = token ? sessions[String(token)] : null;
  if (!row) {
    return null;
  }
  row.at = Date.now();
  dirty = true;
  save(false);
  return row;
}

function drop(token) {
  if (token && sessions[String(token)]) {
    delete sessions[String(token)];
    dirty = true;
    save(true);
  }
}

function dropUser(userId) {
  const id = Number(userId);
  let cut = false;
  Object.keys(sessions).forEach(function (token) {
    if (sessions[token].userId === id) {
      delete sessions[token];
      cut = true;
    }
  });
  if (cut) {
    dirty = true;
    save(true);
  }
}

function dropOthers(keepIds) {
  const keep = {};
  (keepIds || []).forEach(function (id) {
    keep[Number(id)] = true;
  });
  let cut = false;
  Object.keys(sessions).forEach(function (token) {
    if (!keep[sessions[token].userId]) {
      delete sessions[token];
      cut = true;
    }
  });
  if (cut) {
    dirty = true;
    save(true);
  }
}

load();

module.exports = {
  create: create,
  get: get,
  drop: drop,
  dropUser: dropUser,
  dropOthers: dropOthers
};
