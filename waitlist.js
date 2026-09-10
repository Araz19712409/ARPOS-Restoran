const db = require('./db');
const store = require('./store');

function file() {
  return db.dataFile('waitlist.json');
}

function readStore() {
  try {
    const raw = store.readJson(file());
    return {
      nextId: Number(raw.nextId) || 1,
      items: Array.isArray(raw.items) ? raw.items : []
    };
  } catch (error) {
    return { nextId: 1, items: [] };
  }
}

function writeStore(data) {
  data.items = (data.items || []).slice(-80);
  store.writeJson(file(), data);
}

function waiting(box) {
  return (box.items || []).filter(function (row) {
    return row.status === 'waiting';
  });
}

function seated(box) {
  return (box.items || []).filter(function (row) {
    return row.status === 'seated' && Number(row.tableId) > 0;
  });
}

function seatedAt(box, tableId) {
  const id = Number(tableId);
  return seated(box).find(function (row) {
    return Number(row.tableId) === id;
  }) || null;
}

function add(body) {
  const name = String((body && body.name) || '').replace(/<[^>]*>/g, '').trim().slice(0, 40);
  if (!name) {
    return { error: 'Qonağın adını yazın.' };
  }
  const guests = Math.max(1, Math.min(20, Math.round(Number(body && body.guests) || 1)));
  const box = readStore();
  const row = {
    id: box.nextId,
    name: name,
    phone: String((body && body.phone) || '').trim().slice(0, 20),
    guests: guests,
    note: String((body && body.note) || '').trim().slice(0, 80),
    status: 'waiting',
    tableId: 0,
    createdAt: new Date().toISOString()
  };
  box.nextId += 1;
  box.items.push(row);
  writeStore(box);
  return { item: row, items: waiting(box) };
}

function setStatus(id, status, extra) {
  const box = readStore();
  const row = box.items.find(function (item) { return item.id === Number(id); });
  if (!row || row.status !== 'waiting') {
    return { error: 'Növbədə qonaq tapılmadı.' };
  }
  row.status = status;
  row.updatedAt = new Date().toISOString();
  if (extra && extra.tableId) {
    row.tableId = Number(extra.tableId);
  }
  writeStore(box);
  return { item: row, items: waiting(box) };
}

module.exports = {
  readStore: readStore,
  waiting: waiting,
  seated: seated,
  seatedAt: seatedAt,
  add: add,
  setStatus: setStatus
};
