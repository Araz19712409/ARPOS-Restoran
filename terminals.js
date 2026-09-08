const path = require('path');
const store = require('./store');

const FILE = path.join(__dirname, 'data', 'terminals.json');
const LOCK_MS = 60 * 1000;
const locks = {};
const focus = {};

function defaults() {
  return {
    nextId: 2,
    terminals: [{ id: 1, name: 'Kassa 1', active: true }]
  };
}

function readStore() {
  try {
    const raw = store.readJson(FILE);
    return {
      nextId: Number(raw.nextId) || 1,
      terminals: Array.isArray(raw.terminals) ? raw.terminals : []
    };
  } catch (error) {
    const row = defaults();
    writeStore(row);
    return row;
  }
}

function writeStore(data) {
  store.writeJson(FILE, data);
}

function listAll() {
  return readStore().terminals.filter(function (item) {
    return item.active !== false;
  });
}

function getById(id) {
  return listAll().find(function (item) {
    return item.id === Number(id);
  }) || null;
}

function create(name) {
  const title = String(name || '').trim().slice(0, 40);
  if (!title) {
    return { error: 'Terminal adını yazın.' };
  }
  const store = readStore();
  const exists = store.terminals.some(function (item) {
    return item.active !== false && item.name.toLocaleLowerCase('az') === title.toLocaleLowerCase('az');
  });
  if (exists) {
    return { error: 'Bu ad artıq var.' };
  }
  const row = {
    id: store.nextId,
    name: title,
    active: true
  };
  store.nextId += 1;
  store.terminals.push(row);
  writeStore(store);
  return { ok: true, terminal: row };
}

function remove(id) {
  const store = readStore();
  const active = store.terminals.filter(function (item) {
    return item.active !== false;
  });
  if (active.length <= 1) {
    return { error: 'Son terminalı silmək olmaz.' };
  }
  const row = store.terminals.find(function (item) {
    return item.id === Number(id);
  });
  if (!row || row.active === false) {
    return { error: 'Terminal tapılmadı.' };
  }
  row.active = false;
  writeStore(store);
  releaseByTerminal(row.id);
  return { ok: true };
}

function sweep() {
  const now = Date.now();
  Object.keys(locks).forEach(function (key) {
    if (now - locks[key].at > LOCK_MS) {
      delete locks[key];
    }
  });
}

function listLocks() {
  sweep();
  return Object.keys(locks).map(function (key) {
    const row = locks[key];
    return {
      tableId: Number(key),
      terminalId: row.terminalId,
      terminalName: row.terminalName,
      waiterName: row.waiterName,
      at: row.at
    };
  });
}

function lockOf(tableId) {
  sweep();
  return locks[String(tableId)] || null;
}

function setFocus(terminalId, tableId) {
  focus[Number(terminalId)] = Number(tableId);
}

function focusTable(terminalId) {
  sweep();
  const id = focus[Number(terminalId)];
  if (!id) {
    return null;
  }
  const cur = locks[String(id)];
  if (!cur || cur.terminalId !== Number(terminalId)) {
    delete focus[Number(terminalId)];
    return null;
  }
  return id;
}

function claim(tableId, terminal, waiterName, extraIds) {
  sweep();
  const ids = [];
  function add(id) {
    const n = Number(id);
    if (!n || ids.indexOf(n) !== -1) {
      return;
    }
    ids.push(n);
  }
  add(tableId);
  (extraIds || []).forEach(add);
  for (let i = 0; i < ids.length; i += 1) {
    const cur = locks[String(ids[i])];
    if (cur && cur.terminalId !== terminal.id) {
      return { error: 'Bu masa ' + cur.terminalName + '-dədir.' };
    }
  }
  const now = Date.now();
  ids.forEach(function (id) {
    locks[String(id)] = {
      terminalId: terminal.id,
      terminalName: terminal.name,
      waiterName: waiterName || '',
      at: now
    };
  });
  setFocus(terminal.id, tableId);
  return { ok: true, lock: locks[String(tableId)] };
}

function touch(tableId, terminalId) {
  sweep();
  const cur = locks[String(tableId)];
  if (cur && cur.terminalId !== Number(terminalId)) {
    return { error: 'Bu masa ' + cur.terminalName + '-dədir.' };
  }
  if (!cur) {
    const term = getById(terminalId);
    if (!term) {
      return { error: 'Terminal tapılmadı.' };
    }
    return claim(tableId, term, '');
  }
  const now = Date.now();
  Object.keys(locks).forEach(function (id) {
    if (locks[id].terminalId === Number(terminalId)) {
      locks[id].at = now;
    }
  });
  setFocus(terminalId, tableId);
  return { ok: true };
}

function release(tableId, terminalId) {
  const cur = locks[String(tableId)];
  if (cur && cur.terminalId === Number(terminalId)) {
    delete locks[String(tableId)];
  }
  if (focus[Number(terminalId)] === Number(tableId)) {
    delete focus[Number(terminalId)];
  }
  return { ok: true };
}

function releaseByTerminal(terminalId) {
  Object.keys(locks).forEach(function (key) {
    if (locks[key].terminalId === Number(terminalId)) {
      delete locks[key];
    }
  });
  delete focus[Number(terminalId)];
}

function assertCanWrite(tableId, terminalId) {
  sweep();
  const cur = locks[String(tableId)];
  if (cur && cur.terminalId !== Number(terminalId)) {
    return 'Bu masa ' + cur.terminalName + '-dədir.';
  }
  return '';
}

module.exports = {
  listAll: listAll,
  getById: getById,
  create: create,
  remove: remove,
  listLocks: listLocks,
  lockOf: lockOf,
  claim: claim,
  touch: touch,
  focusTable: focusTable,
  release: release,
  releaseByTerminal: releaseByTerminal,
  assertCanWrite: assertCanWrite
};
