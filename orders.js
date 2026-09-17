const fs = require('fs');
const path = require('path');
const store = require('./store');
const db = require('./db');
const num = require('./num');

function ordersFile() {
  return path.join(db.dataDir(), 'orders.json');
}

function archiveDir() {
  return path.join(db.dataDir(), 'orders-archive');
}
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function monthKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return 'unknown';
  }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

function isLive(order) {
  if (order.status === 'open') {
    return true;
  }
  const t = new Date(order.updatedAt || (order.payment && order.payment.at) || order.createdAt).getTime();
  return Number.isFinite(t) && (Date.now() - t) < KEEP_MS;
}

function readArchiveMonth(key) {
  try {
    const raw = store.readJson(path.join(archiveDir(), key + '.json'));
    return Array.isArray(raw.orders) ? raw.orders : [];
  } catch (error) {
    return [];
  }
}

function writeArchiveMonth(key, list) {
  fs.mkdirSync(archiveDir(), { recursive: true });
  store.writeJson(path.join(archiveDir(), key + '.json'), { orders: list });
}

function listArchiveKeys() {
  try {
    return fs.readdirSync(archiveDir()).filter(function (name) {
      return name.slice(-5) === '.json';
    }).map(function (name) {
      return name.slice(0, -5);
    });
  } catch (error) {
    return [];
  }
}

function prune(data) {
  const keep = [];
  const moved = {};
  (data.orders || []).forEach(function (order) {
    if (isLive(order)) {
      keep.push(order);
      return;
    }
    const key = monthKey(order.updatedAt || (order.payment && order.payment.at) || order.createdAt);
    if (!moved[key]) {
      moved[key] = [];
    }
    moved[key].push(order);
  });
  Object.keys(moved).forEach(function (key) {
    const prev = readArchiveMonth(key);
    const seen = {};
    prev.forEach(function (row) {
      seen[row.id] = true;
    });
    moved[key].forEach(function (row) {
      if (!seen[row.id]) {
        prev.push(row);
      }
    });
    writeArchiveMonth(key, prev);
  });
  data.orders = keep;
}

function readOrders() {
  if (db.migrated()) {
    return db.loadLiveOrders();
  }
  const raw = store.readJson(ordersFile());
  return {
    nextOrderId: Number(raw.nextOrderId) || 1,
    nextItemId: Number(raw.nextItemId) || 1,
    orders: Array.isArray(raw.orders) ? raw.orders : []
  };
}

function writeOrders(data) {
  if (db.migrated()) {
    db.saveLiveOrders(data);
    return;
  }
  prune(data);
  store.writeJson(ordersFile(), data);
}

function readAllOrders() {
  if (db.migrated()) {
    return db.loadAllOrders();
  }
  const live = readOrders();
  const seen = {};
  const all = [];
  live.orders.forEach(function (order) {
    seen[order.id] = true;
    all.push(order);
  });
  listArchiveKeys().forEach(function (key) {
    readArchiveMonth(key).forEach(function (order) {
      if (!seen[order.id]) {
        seen[order.id] = true;
        all.push(order);
      }
    });
  });
  return {
    nextOrderId: live.nextOrderId,
    nextItemId: live.nextItemId,
    orders: all
  };
}

function coversTable(order, tableId) {
  if (!order || order.status !== 'open') {
    return false;
  }
  const id = Number(tableId);
  if (Number(order.tableId) === id) {
    return true;
  }
  return (order.linkedTableIds || []).some(function (item) {
    return Number(item) === id;
  });
}

function findOpenForTable(box, tableId) {
  return (box.orders || []).find(function (item) {
    return coversTable(item, tableId);
  }) || null;
}

function tableIdsOf(order) {
  const ids = [Number(order.tableId)].concat(order.linkedTableIds || []);
  return ids.filter(function (id) {
    return Number(id) > 0;
  });
}

function isServiceTable(id) {
  return Number(id) < 0;
}

function channelOfId(id) {
  const n = Number(id);
  if (n === -2 || n <= -2000) {
    return 'delivery';
  }
  if (n < 0) {
    return 'takeaway';
  }
  return 'dine';
}

function openForTable(box, tableId, tableName, extra) {
  let order = findOpenForTable(box, tableId);
  if (!order) {
    const channel = (extra && extra.channel) || channelOfId(tableId);
    order = {
      id: box.nextOrderId,
      tableId: tableId,
      tableName: tableName,
      status: 'open',
      guests: 0,
      items: [],
      channel: channel,
      linkedTableIds: [],
      guestName: (extra && extra.guestName) || '',
      guestPhone: (extra && extra.guestPhone) || '',
      guestAddress: (extra && extra.guestAddress) || '',
      courierName: (extra && extra.courierName) || '',
      runStatus: channel === 'dine' ? '' : 'prep',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    box.nextOrderId += 1;
    box.orders.push(order);
  }
  return order;
}

function isOpenLine(item) {
  return !!(item && !item.voided && !item.settled);
}

function modsKey(mods) {
  return (mods || []).map(function (row) {
    return String((row && row.name) || '').trim();
  }).filter(Boolean).sort().join('\t');
}

function saleLineKey(item) {
  const price = Number(item && item.salePrice);
  return [
    String(Number(item && item.productId) || 0),
    String((item && item.name) || '').trim(),
    Number.isFinite(price) ? price.toFixed(2) : '0.00',
    String((item && item.note) || '').trim(),
    item && item.complimentary ? '1' : '0',
    modsKey(item && item.modifiers)
  ].join('|');
}

function findOpenSameLine(items, candidate) {
  const key = saleLineKey(candidate);
  return (items || []).find(function (row) {
    if (!row || row.voided || row.settled || row.comboOf) {
      return false;
    }
    return saleLineKey(row) === key;
  }) || null;
}

function lineMinor(item) {
  return num.mulQty(num.toMinor(item && item.salePrice), item && item.qty);
}

function lineSum(item) {
  return num.fromMinor(lineMinor(item));
}

function orderTotal(order) {
  let sum = 0;
  (order.items || []).forEach(function (item) {
    if (item.voided) {
      return;
    }
    sum = num.addMinor(sum, lineMinor(item));
  });
  return num.fromMinor(sum);
}

function openTotal(order) {
  let sum = 0;
  (order.items || []).forEach(function (item) {
    if (!isOpenLine(item)) {
      return;
    }
    sum = num.addMinor(sum, lineMinor(item));
  });
  return num.fromMinor(sum);
}

function pickPayLines(order, itemIds, seatTableId) {
  const ids = Array.isArray(itemIds)
    ? itemIds.map(function (id) { return Number(id); }).filter(function (id) { return id > 0; })
    : [];
  const seat = Number(seatTableId) || 0;
  if (!ids.length && !seat) {
    return [];
  }
  return (order.items || []).filter(function (item) {
    if (!isOpenLine(item)) {
      return false;
    }
    const home = Number(item.seatTableId || order.tableId);
    if (seat && home !== seat) {
      return false;
    }
    if (ids.length && ids.indexOf(item.id) === -1) {
      return false;
    }
    return true;
  });
}

function hasProductSales(productId) {
  const id = Number(productId);
  return readAllOrders().orders.some(function (order) {
    return (order.items || []).some(function (item) {
      return Number(item.productId) === id;
    });
  });
}

function soldProductIds() {
  const map = {};
  readOrders().orders.forEach(function (order) {
    (order.items || []).forEach(function (item) {
      if (item.productId) {
        map[Number(item.productId)] = true;
      }
    });
  });
  return map;
}

function cleanRunStatus(channel, value) {
  const v = String(value || '');
  if (channel === 'delivery') {
    if (v === 'way' || v === 'done') {
      return v;
    }
    return 'prep';
  }
  if (channel === 'takeaway') {
    if (v === 'ready' || v === 'done') {
      return v;
    }
    return 'prep';
  }
  return '';
}

function lastPaidOrder() {
  function pick(list) {
    let best = null;
    let bestAt = '';
    (list || []).forEach(function (order) {
      if (!order || order.status !== 'paid' || !order.payment) {
        return;
      }
      const at = String(order.payment.at || order.updatedAt || '');
      if (!best || at > bestAt) {
        best = order;
        bestAt = at;
      }
    });
    return best;
  }
  const live = pick(readOrders().orders);
  if (live) {
    return live;
  }
  try {
    return pick(readAllOrders().orders);
  } catch (error) {
    return null;
  }
}

function paidTotal(order) {
  let sum = 0;
  (order.payments || []).forEach(function (row) {
    sum = num.addMinor(sum, num.toMinor(row.cashAmount));
    sum = num.addMinor(sum, num.toMinor(row.cardAmount));
    sum = num.addMinor(sum, num.toMinor(row.giftAmount));
  });
  return num.fromMinor(sum);
}

function ticketSlice(line, qty) {
  return {
    id: line.id,
    name: line.name,
    qty: qty,
    stationId: line.stationId,
    extras: line.extras,
    note: line.note,
    course: line.course,
    productId: line.productId,
    sent: true
  };
}

/** reduceBy > 0 və < qty → qismən kəs; əks halda tam void. */
function applyQtyCut(line, reduceBy, staffName) {
  if (!line || line.voided) {
    return { ok: false, full: false, ticketQty: 0 };
  }
  const have = Math.max(0, Number(line.qty) || 0);
  const cut = Math.max(0, Math.floor(Number(reduceBy) || 0));
  if (cut > 0 && cut < have) {
    line.qty = have - cut;
    return { ok: true, full: false, ticketQty: cut, slice: ticketSlice(line, cut) };
  }
  line.voided = true;
  line.voidedAt = new Date().toISOString();
  line.voidedBy = staffName || '';
  return { ok: true, full: true, ticketQty: have, slice: ticketSlice(line, have) };
}

module.exports = {
  ARCHIVE_DIR: archiveDir,
  readOrders: readOrders,
  writeOrders: writeOrders,
  readAllOrders: readAllOrders,
  coversTable: coversTable,
  findOpenForTable: findOpenForTable,
  tableIdsOf: tableIdsOf,
  isServiceTable: isServiceTable,
  cleanRunStatus: cleanRunStatus,
  channelOfId: channelOfId,
  openForTable: openForTable,
  isOpenLine: isOpenLine,
  saleLineKey: saleLineKey,
  findOpenSameLine: findOpenSameLine,
  orderTotal: orderTotal,
  openTotal: openTotal,
  pickPayLines: pickPayLines,
  lastPaidOrder: lastPaidOrder,
  paidTotal: paidTotal,
  applyQtyCut: applyQtyCut,
  ticketSlice: ticketSlice,
  hasProductSales: hasProductSales,
  soldProductIds: soldProductIds
};
