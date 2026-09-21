const fs = require('fs');
const path = require('path');
const store = require('./store');

const PKG = path.join(__dirname, 'package.json');
function histFile() {
  return path.join(require('./db').dataDir(), 'versions.json');
}
const LOG = path.join(__dirname, 'VERSIONS.md');

function current() {
  try {
    return String(JSON.parse(fs.readFileSync(PKG, 'utf8')).version || '0.0.0');
  } catch (error) {
    return '0.0.0';
  }
}

function readHistory() {
  try {
    const raw = store.readJson(histFile());
    return {
      current: String(raw.current || current()),
      history: Array.isArray(raw.history) ? raw.history : []
    };
  } catch (error) {
    return { current: current(), history: [] };
  }
}

function appendMarkdown(ver, note) {
  const line = '- **' + ver + '** — ' + new Date().toISOString().slice(0, 10) +
    (note ? ' — ' + note : '') + '\n';
  let prev = '';
  if (fs.existsSync(LOG)) {
    prev = fs.readFileSync(LOG, 'utf8');
  } else {
    prev = '# Arpos Restoran — versiyalar\n\n';
  }
  if (prev.indexOf('**' + ver + '**') !== -1) {
    return;
  }
  const parts = prev.split('\n');
  const head = [];
  let i = 0;
  while (i < parts.length && (parts[i].indexOf('# ') === 0 || parts[i] === '')) {
    head.push(parts[i]);
    i += 1;
  }
  const rest = parts.slice(i).join('\n').replace(/^\n/, '');
  fs.writeFileSync(LOG, head.join('\n') + (head.length ? '\n' : '') + line + rest);
}

function fileCurrent() {
  try {
    return String(store.readJson(histFile()).current || '');
  } catch (error) {
    return '';
  }
}

function record(reason, note) {
  const ver = current();
  const box = readHistory();
  const last = box.history.length ? box.history[box.history.length - 1] : null;
  if (last && last.version === ver && last.reason === reason) {
    if (fileCurrent() !== ver) {
      box.current = ver;
      store.writeJson(histFile(), box);
    }
    return box;
  }
  box.current = ver;
  box.history.push({
    version: ver,
    reason: String(reason || 'run').slice(0, 40),
    note: String(note || '').slice(0, 80),
    at: new Date().toISOString()
  });
  box.history = box.history.slice(-80);
  store.writeJson(histFile(), box);
  if (reason === 'update' || reason === 'release') {
    try {
      appendMarkdown(ver, note || reason);
    } catch (error) {
      // qovluq yazılmasa keç
    }
  }
  return box;
}

function ensure() {
  const ver = current();
  const box = readHistory();
  if (box.current !== ver) {
    return record('update', 'Versiya ' + box.current + ' → ' + ver);
  }
  if (!box.history.length) {
    return record('start', 'İlk işəsalma');
  }
  box.current = ver;
  if (fileCurrent() !== ver) {
    store.writeJson(histFile(), box);
  }
  return box;
}

function dataDirs() {
  const dirs = [path.join(__dirname, 'data')];
  if (process.env.ARPOS_DATA_DIR) {
    dirs.push(path.resolve(process.env.ARPOS_DATA_DIR));
  }
  const local = process.env.LOCALAPPDATA || process.env.LOCAL_APPDATA;
  if (local) {
    dirs.push(path.join(local, 'Arpos Restoran', 'data'));
  }
  const uniq = [];
  dirs.forEach(function (dir) {
    const full = path.resolve(dir);
    if (uniq.indexOf(full) >= 0) {
      return;
    }
    uniq.push(full);
  });
  return uniq;
}

function ensureAll() {
  const prev = process.env.ARPOS_DATA_DIR;
  dataDirs().forEach(function (dir) {
    if (!fs.existsSync(dir)) {
      return;
    }
    process.env.ARPOS_DATA_DIR = dir;
    ensure();
  });
  if (prev) {
    process.env.ARPOS_DATA_DIR = prev;
  } else {
    delete process.env.ARPOS_DATA_DIR;
  }
  return ensure();
}

module.exports = {
  current: current,
  readHistory: readHistory,
  record: record,
  ensure: ensure,
  ensureAll: ensureAll
};
