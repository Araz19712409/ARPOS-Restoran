const fs = require('fs');
const path = require('path');
const store = require('./store');
const db = require('./db');

const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const ARCHIVE_DIR = path.join(__dirname, 'data', 'orders-archive');
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
    const raw = store.readJson(path.join(ARCHIVE_DIR, key + '.json'));
    return Array.isArray(raw.orders) ? raw.orders : [];
  } catch (error) {
    return [];
  }
}

function writeArchiveMonth(key, list) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  store.writeJson(path.join(ARCHIVE_DIR, key + '.json'), { orders: list });
}

function listArchiveKeys() {
  try {
    return fs.readdirSync(ARCHIVE_DIR).filter(function (name) {
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
  const raw = store.readJson(ORDERS_FILE);
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
  store.writeJson(ORDERS_FILE, data);
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

function lineSum(item) {
  return Number(item.salePrice) * Number(item.qty);
}

function orderTotal(order) {
  return (order.items || []).reduce(function (sum, item) {
    if (item.voided) {
      return sum;
    }
    return sum + lineSum(item);
  }, 0);
}

function openTotal(order) {
  return (order.items || []).reduce(function (sum, item) {
    if (!isOpenLine(item)) {
      return sum;
    }
    return sum + lineSum(item);
  }, 0);
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

function paidTotal(order) {
  return (order.payments || []).reduce(function (sum, row) {
    return sum + Number(row.cashAmount || 0) + Number(row.cardAmount || 0) + Number(row.giftAmount || 0);
  }, 0);
}

module.exports = {
  ARCHIVE_DIR: ARCHIVE_DIR,
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
  orderTotal: orderTotal,
  openTotal: openTotal,
  pickPayLines: pickPayLines,
  paidTotal: paidTotal,
  hasProductSales: hasProductSales,
  soldProductIds: soldProductIds
};
