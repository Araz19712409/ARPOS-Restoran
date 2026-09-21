const db = require('./db');
const store = require('./store');
const catalog = require('./catalog');

const hits = {};

function file() {
  return db.dataFile('guest.json');
}

function readBox() {
  const raw = store.readJson(file());
  return {
    nextRequestId: Number(raw.nextRequestId) || 1,
    nextCallId: Number(raw.nextCallId) || 1,
    requests: Array.isArray(raw.requests) ? raw.requests : [],
    calls: Array.isArray(raw.calls) ? raw.calls : []
  };
}

function writeBox(box) {
  box.requests = (box.requests || []).slice(-80);
  box.calls = (box.calls || []).slice(-80);
  store.writeJson(file(), box);
}

function tooSoon(key, ms) {
  const now = Date.now();
  const prev = hits[key] || 0;
  if (now - prev < ms) {
    return true;
  }
  hits[key] = now;
  return false;
}

function clientKey(req) {
  return String((req && req.ip) || '') + '|' + String((req && req.body && req.body.tableId) || '');
}

function tableOf(layout, tableId) {
  const id = Number(tableId);
  if (!id || !layout || !Array.isArray(layout.tables)) {
    return null;
  }
  const byId = layout.tables.find(function (item) {
    return Number(item.id) === id;
  });
  if (byId) {
    return byId;
  }
  const byNum = layout.tables.filter(function (item) {
    return Number(item.number) === id;
  }).sort(function (a, b) {
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
  return byNum[0] || null;
}

function openList(rows) {
  return (rows || []).filter(function (row) { return row.status === 'open'; });
}

function tablesForGuest(layout) {
  return (layout && Array.isArray(layout.tables) ? layout.tables : []).map(function (item) {
    const id = Number(item && item.id) || 0;
    const num = Number(item && item.number) || id;
    return {
      id: id,
      number: num,
      name: (item && item.name) || ('Masa ' + num)
    };
  }).filter(function (item) {
    return item.id > 0;
  }).sort(function (a, b) {
    return (a.number - b.number) || (a.id - b.id);
  });
}

function menuForTable(layout, tableId) {
  const table = tableOf(layout, tableId);
  if (!table) {
    return { error: 'Masa tapılmadı.' };
  }
  const data = catalog.readCatalog();
  const groups = (data.groups || []).map(function (g) {
    return { id: g.id, name: g.name };
  });
  const products = (data.products || []).filter(function (p) {
    return p && !p.blocked && !p.soldOut;
  }).map(function (p) {
    const pub = catalog.publicProduct(p);
    return {
      id: pub.id,
      groupId: pub.groupId,
      name: pub.name,
      price: catalog.salePriceNow(p),
      image: pub.image || ''
    };
  });
  const num = Number(table.number) || table.id;
  return {
    table: {
      id: table.id,
      number: num,
      name: table.name || ('Masa ' + num)
    },
    groups: groups,
    products: products
  };
}

function addRequest(layout, body, req) {
  if (tooSoon('ord|' + clientKey(req), 8000)) {
    return { error: 'Bir az gözləyin.', status: 429 };
  }
  const table = tableOf(layout, body && body.tableId);
  if (!table) {
    return { error: 'Masa tapılmadı.', status: 400 };
  }
  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) {
    return { error: 'Səbət boşdur.', status: 400 };
  }
  if (lines.length > 30) {
    return { error: 'Səbət çox doludur.', status: 400 };
  }
  const data = catalog.readCatalog();
  const packed = [];
  let total = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const pid = Number(lines[i] && lines[i].productId);
    const qty = Math.round(Number(lines[i] && lines[i].qty) || 0);
    if (!pid || qty < 1 || qty > 20) {
      return { error: 'Miqdar 1–20 olmalıdır.', status: 400 };
    }
    const prod = (data.products || []).find(function (p) { return p.id === pid; });
    if (!prod || prod.blocked || prod.soldOut) {
      return { error: 'Məhsul yoxdur.', status: 400 };
    }
    const price = catalog.salePriceNow(prod);
    packed.push({
      productId: prod.id,
      name: prod.name,
      qty: qty,
      price: price
    });
    total += price * qty;
  }
  const box = readBox();
  const row = {
    id: box.nextRequestId,
    kind: 'order-request',
    tableId: table.id,
    tableName: table.name || ('Masa ' + table.number),
    items: packed,
    total: Math.round(total * 100) / 100,
    status: 'open',
    at: new Date().toISOString()
  };
  box.nextRequestId += 1;
  box.requests.push(row);
  writeBox(box);
  return { item: row };
}

function addCall(layout, body, req) {
  if (tooSoon('call|' + clientKey(req), 8000)) {
    return { error: 'Bir az gözləyin.', status: 429 };
  }
  const table = tableOf(layout, body && body.tableId);
  if (!table) {
    return { error: 'Masa tapılmadı.', status: 400 };
  }
  const box = readBox();
  const row = {
    id: box.nextCallId,
    kind: 'call-waiter',
    tableId: table.id,
    tableName: table.name || ('Masa ' + table.number),
    status: 'open',
    at: new Date().toISOString()
  };
  box.nextCallId += 1;
  box.calls.push(row);
  writeBox(box);
  return { item: row };
}

function inbox() {
  const box = readBox();
  return {
    requests: openList(box.requests),
    calls: openList(box.calls)
  };
}

function markSeen(kind, id) {
  const box = readBox();
  const list = kind === 'call' ? box.calls : box.requests;
  const row = list.find(function (item) { return item.id === Number(id); });
  if (!row || row.status !== 'open') {
    return { error: 'Qeyd tapılmadı.' };
  }
  row.status = 'seen';
  row.seenAt = new Date().toISOString();
  writeBox(box);
  return { item: row, inbox: inbox() };
}

module.exports = {
  menuForTable: menuForTable,
  tablesForGuest: tablesForGuest,
  addRequest: addRequest,
  addCall: addCall,
  inbox: inbox,
  markSeen: markSeen,
  tableOf: tableOf
};
