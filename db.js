const fs = require('fs');
const path = require('path');
const store = require('./store');

const ROOT = __dirname;

function dataDir() {
  return process.env.ARPOS_DATA_DIR
    ? path.resolve(process.env.ARPOS_DATA_DIR)
    : path.join(ROOT, 'data');
}

function dbFile() {
  return path.join(dataDir(), 'arpos.sqlite');
}

function dataFile(name) {
  return path.join(dataDir(), name);
}

function migratedDir() {
  return path.join(dataDir(), 'migrated');
}

const JSON_FILES = [
  'layout.json', 'catalog.json', 'orders.json', 'users.json', 'printers.json',
  'reservations.json', 'settings.json', 'tables.json', 'terminals.json',
  'stock.json', 'fiscal-queue.json', 'shifts.json', 'gifts.json', 'waitlist.json',
  'print-queue.json', 'pin-lock.json'
];
const MOVE_FILES = ['catalog.json', 'orders.json', 'stock.json'];
const OFFICE_FILES = ['users.json', 'settings.json', 'shifts.json', 'terminals.json'];
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

let Database;
let conn = null;
let usable = false;

try {
  Database = require('better-sqlite3');
} catch (error) {
  Database = null;
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function jsonText(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(text, fallback) {
  if (text == null || text === '') {
    return fallback;
  }
  try {
    const out = JSON.parse(text);
    return out == null ? fallback : out;
  } catch (error) {
    return fallback;
  }
}

function isLiveOrder(order) {
  if (!order) {
    return false;
  }
  if (order.status === 'open') {
    return true;
  }
  const t = new Date(order.updatedAt || (order.payment && order.payment.at) || order.createdAt).getTime();
  return Number.isFinite(t) && (Date.now() - t) < KEEP_MS;
}

function schemaSql() {
  return [
    'CREATE TABLE IF NOT EXISTS kv (name TEXT PRIMARY KEY, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS catalog_groups (id INTEGER PRIMARY KEY, name TEXT, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS catalog_stations (id INTEGER PRIMARY KEY, name TEXT, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS catalog_products (id INTEGER PRIMARY KEY, group_id INTEGER, station_id INTEGER, name TEXT, sale_price REAL, sold_out INTEGER, barcode TEXT, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stock_items (id INTEGER PRIMARY KEY, name TEXT, unit TEXT, qty REAL, min_qty REAL, buy_price REAL, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stock_moves (id INTEGER PRIMARY KEY, item_id INTEGER, type TEXT, qty REAL, note TEXT, at TEXT, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stock_purchases (id INTEGER PRIMARY KEY, at TEXT, supplier TEXT, doc_no TEXT, total REAL, by_name TEXT, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stock_suppliers (name TEXT PRIMARY KEY, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, table_id INTEGER, table_name TEXT, status TEXT, channel TEXT, created_at TEXT, updated_at TEXT, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER, name TEXT, qty REAL, sale_price REAL, voided INTEGER, json TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS order_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, at TEXT, method TEXT, cash REAL, card REAL, gift REAL, total REAL, json TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_orders_updated ON orders(updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)',
    'CREATE INDEX IF NOT EXISTS idx_order_pay_order ON order_payments(order_id)',
    'CREATE INDEX IF NOT EXISTS idx_stock_moves_item ON stock_moves(item_id)'
  ].join(';');
}

function open() {
  if (conn) {
    return usable;
  }
  if (!Database) {
    usable = false;
    return false;
  }
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    conn = new Database(dbFile());
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    conn.pragma('busy_timeout = 5000');
    conn.exec(schemaSql());
    usable = true;
    return true;
  } catch (error) {
    conn = null;
    usable = false;
    return false;
  }
}

function available() {
  if (!conn && Database) {
    open();
  }
  return usable && !!conn;
}

function tx(fn) {
  if (!available()) {
    return fn();
  }
  return conn.transaction(fn)();
}

function metaGet(key) {
  const row = conn.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : '';
}

function metaSet(key, value) {
  conn.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function kvGet(name, fallback) {
  if (!available()) {
    return fallback;
  }
  const row = conn.prepare('SELECT json FROM kv WHERE name = ?').get(name);
  return row ? parseJson(row.json, fallback) : fallback;
}

function kvSet(name, data) {
  if (!available()) {
    return;
  }
  conn.prepare('INSERT INTO kv(name, json) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json')
    .run(name, jsonText(data));
}

function loadCatalog() {
  const meta = kvGet('catalog_meta', {});
  const groups = conn.prepare('SELECT json FROM catalog_groups ORDER BY id').all().map(function (row) {
    return parseJson(row.json, {});
  });
  const stations = conn.prepare('SELECT json FROM catalog_stations ORDER BY id').all().map(function (row) {
    return parseJson(row.json, {});
  });
  const products = conn.prepare('SELECT json FROM catalog_products ORDER BY id').all().map(function (row) {
    return parseJson(row.json, {});
  });
  return {
    nextGroupId: Number(meta.nextGroupId) || 1,
    nextProductId: Number(meta.nextProductId) || 1,
    nextStationId: Number(meta.nextStationId) || 4,
    soldOutDay: meta.soldOutDay || '',
    groups: groups,
    stations: stations,
    products: products
  };
}

function saveCatalog(data) {
  tx(function () {
    kvSet('catalog_meta', {
      nextGroupId: data.nextGroupId,
      nextProductId: data.nextProductId,
      nextStationId: data.nextStationId,
      soldOutDay: data.soldOutDay || ''
    });
    conn.prepare('DELETE FROM catalog_groups').run();
    conn.prepare('DELETE FROM catalog_stations').run();
    conn.prepare('DELETE FROM catalog_products').run();
    const insG = conn.prepare('INSERT INTO catalog_groups(id, name, json) VALUES(?,?,?)');
    const insS = conn.prepare('INSERT INTO catalog_stations(id, name, json) VALUES(?,?,?)');
    const insP = conn.prepare('INSERT INTO catalog_products(id, group_id, station_id, name, sale_price, sold_out, barcode, json) VALUES(?,?,?,?,?,?,?,?)');
    (data.groups || []).forEach(function (row) {
      insG.run(row.id, row.name || '', jsonText(row));
    });
    (data.stations || []).forEach(function (row) {
      insS.run(row.id, row.name || '', jsonText(row));
    });
    (data.products || []).forEach(function (row) {
      insP.run(
        row.id,
        row.groupId || 0,
        row.stationId || 0,
        row.name || '',
        Number(row.salePrice) || 0,
        row.soldOut ? 1 : 0,
        row.barcode || '',
        jsonText(row)
      );
    });
  });
}

function loadStock() {
  const meta = kvGet('stock_meta', {});
  return {
    nextItemId: Number(meta.nextItemId) || 1,
    nextMoveId: Number(meta.nextMoveId) || 1,
    nextPurchaseId: Number(meta.nextPurchaseId) || 1,
    items: conn.prepare('SELECT json FROM stock_items ORDER BY id').all().map(function (row) {
      return parseJson(row.json, {});
    }),
    moves: conn.prepare('SELECT json FROM stock_moves ORDER BY id').all().map(function (row) {
      return parseJson(row.json, {});
    }),
    purchases: conn.prepare('SELECT json FROM stock_purchases ORDER BY id').all().map(function (row) {
      return parseJson(row.json, {});
    }),
    suppliers: conn.prepare('SELECT name, json FROM stock_suppliers ORDER BY name').all().map(function (row) {
      const parsed = parseJson(row.json, null);
      if (typeof parsed === 'string' && parsed.trim()) {
        return parsed.trim();
      }
      if (parsed && parsed.name) {
        return String(parsed.name).trim();
      }
      return String(row.name || '').trim();
    }).filter(Boolean),
  };
}

function saveStock(data) {
  tx(function () {
    kvSet('stock_meta', {
      nextItemId: data.nextItemId,
      nextMoveId: data.nextMoveId,
      nextPurchaseId: data.nextPurchaseId
    });
    conn.prepare('DELETE FROM stock_items').run();
    conn.prepare('DELETE FROM stock_moves').run();
    conn.prepare('DELETE FROM stock_purchases').run();
    conn.prepare('DELETE FROM stock_suppliers').run();
    const insI = conn.prepare('INSERT INTO stock_items(id, name, unit, qty, min_qty, buy_price, json) VALUES(?,?,?,?,?,?,?)');
    const insM = conn.prepare('INSERT INTO stock_moves(id, item_id, type, qty, note, at, json) VALUES(?,?,?,?,?,?,?)');
    const insP = conn.prepare('INSERT INTO stock_purchases(id, at, supplier, doc_no, total, by_name, json) VALUES(?,?,?,?,?,?,?)');
    const insS = conn.prepare('INSERT INTO stock_suppliers(name, json) VALUES(?,?)');
    (data.items || []).forEach(function (row) {
      insI.run(row.id, row.name || '', row.unit || '', Number(row.qty) || 0, Number(row.minQty) || 0, Number(row.buyPrice) || 0, jsonText(row));
    });
    (data.moves || []).forEach(function (row) {
      insM.run(row.id, row.itemId || 0, row.type || '', Number(row.qty) || 0, row.note || '', row.at || '', jsonText(row));
    });
    (data.purchases || []).forEach(function (row) {
      insP.run(row.id, row.at || '', row.supplier || '', row.docNo || '', Number(row.total) || 0, row.by || '', jsonText(row));
    });
    const seen = {};
    (data.suppliers || []).forEach(function (row) {
      const name = typeof row === 'string' ? String(row).trim() : String((row && row.name) || '').trim();
      if (!name) {
        return;
      }
      const key = name.toLowerCase();
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      insS.run(name.slice(0, 40), jsonText({ name: name.slice(0, 40) }));
    });
  });
}

function assembleOrder(header) {
  const order = parseJson(header.json, {});
  order.id = header.id;
  order.tableId = header.table_id;
  order.tableName = header.table_name;
  order.status = header.status;
  order.channel = header.channel;
  order.createdAt = header.created_at;
  order.updatedAt = header.updated_at;
  order.items = conn.prepare('SELECT json FROM order_items WHERE order_id = ? ORDER BY id').all(header.id).map(function (row) {
    return parseJson(row.json, {});
  });
  order.payments = conn.prepare('SELECT json FROM order_payments WHERE order_id = ? ORDER BY id').all(header.id).map(function (row) {
    return parseJson(row.json, {});
  });
  return order;
}

function loadAllOrders() {
  const meta = kvGet('orders_meta', {});
  const headers = conn.prepare('SELECT * FROM orders ORDER BY id').all();
  return {
    nextOrderId: Number(meta.nextOrderId) || 1,
    nextItemId: Number(meta.nextItemId) || 1,
    orders: headers.map(assembleOrder)
  };
}

function loadLiveOrders() {
  const all = loadAllOrders();
  return {
    nextOrderId: all.nextOrderId,
    nextItemId: all.nextItemId,
    orders: all.orders.filter(isLiveOrder)
  };
}

function upsertOrder(order) {
  conn.prepare(
    'INSERT INTO orders(id, table_id, table_name, status, channel, created_at, updated_at, json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET table_id=excluded.table_id, table_name=excluded.table_name, status=excluded.status, channel=excluded.channel, created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json'
  ).run(
    order.id,
    order.tableId || 0,
    order.tableName || '',
    order.status || '',
    order.channel || '',
    order.createdAt || '',
    order.updatedAt || '',
    jsonText(order)
  );
  conn.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
  conn.prepare('DELETE FROM order_payments WHERE order_id = ?').run(order.id);
  const insI = conn.prepare('INSERT INTO order_items(id, order_id, product_id, name, qty, sale_price, voided, json) VALUES(?,?,?,?,?,?,?,?)');
  (order.items || []).forEach(function (item) {
    insI.run(
      item.id,
      order.id,
      item.productId || 0,
      item.name || '',
      Number(item.qty) || 0,
      Number(item.salePrice) || 0,
      item.voided ? 1 : 0,
      jsonText(item)
    );
  });
  const insP = conn.prepare('INSERT INTO order_payments(order_id, at, method, cash, card, gift, total, json) VALUES(?,?,?,?,?,?,?,?)');
  (order.payments || []).forEach(function (pay) {
    insP.run(
      order.id,
      pay.at || '',
      pay.method || '',
      Number(pay.cashAmount) || 0,
      Number(pay.cardAmount) || 0,
      Number(pay.giftAmount) || 0,
      Number(pay.total) || 0,
      jsonText(pay)
    );
  });
}

function saveLiveOrders(data) {
  tx(function () {
    kvSet('orders_meta', {
      nextOrderId: data.nextOrderId,
      nextItemId: data.nextItemId
    });
    const incoming = {};
    (data.orders || []).forEach(function (order) {
      incoming[order.id] = true;
      upsertOrder(order);
    });
    const headers = conn.prepare('SELECT id, json FROM orders').all();
    headers.forEach(function (row) {
      if (incoming[row.id]) {
        return;
      }
      const order = parseJson(row.json, { id: row.id, status: '' });
      if (isLiveOrder(order)) {
        conn.prepare('DELETE FROM order_items WHERE order_id = ?').run(row.id);
        conn.prepare('DELETE FROM order_payments WHERE order_id = ?').run(row.id);
        conn.prepare('DELETE FROM orders WHERE id = ?').run(row.id);
      }
    });
  });
}

function readJsonFile(name) {
  const file = path.join(dataDir(), name);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return store.readJson(file);
  } catch (error) {
    return null;
  }
}

function moveToMigrated(name) {
  const src = path.join(dataDir(), name);
  if (!fs.existsSync(src)) {
    return;
  }
  fs.mkdirSync(migratedDir(), { recursive: true });
  const dest = path.join(migratedDir(), name);
  try {
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
    fs.renameSync(src, dest);
  } catch (error) {
    try {
      fs.copyFileSync(src, dest);
    } catch (copyError) {
      return;
    }
  }
}

function importOrdersFromJson() {
  const live = readJsonFile('orders.json') || {};
  const orders = Array.isArray(live.orders) ? live.orders.slice() : [];
  const archive = path.join(dataDir(), 'orders-archive');
  if (fs.existsSync(archive)) {
    fs.readdirSync(archive).forEach(function (name) {
      if (name.slice(-5) !== '.json') {
        return;
      }
      const raw = store.readJson(path.join(archive, name));
      (raw.orders || []).forEach(function (order) {
        if (order && order.id && !orders.some(function (row) { return row.id === order.id; })) {
          orders.push(order);
        }
      });
    });
  }
  kvSet('orders_meta', {
    nextOrderId: Number(live.nextOrderId) || 1,
    nextItemId: Number(live.nextItemId) || 1
  });
  orders.forEach(upsertOrder);
}

function migrateJson() {
  if (!available()) {
    return { ok: false, skipped: true };
  }
  if (metaGet('json_migrated') === '1') {
    return migrateOffice();
  }
  try {
    tx(function () {
      const catalog = readJsonFile('catalog.json');
      if (catalog && (catalog.products || catalog.groups)) {
        saveCatalog({
          nextGroupId: catalog.nextGroupId,
          nextProductId: catalog.nextProductId,
          nextStationId: catalog.nextStationId,
          soldOutDay: catalog.soldOutDay,
          groups: catalog.groups || [],
          stations: catalog.stations || [],
          products: catalog.products || []
        });
      }
      const stock = readJsonFile('stock.json');
      if (stock && (stock.items || stock.moves)) {
        saveStock({
          nextItemId: stock.nextItemId,
          nextMoveId: stock.nextMoveId,
          nextPurchaseId: stock.nextPurchaseId,
          items: stock.items || [],
          moves: stock.moves || [],
          purchases: stock.purchases || [],
          suppliers: stock.suppliers || []
        });
      }
      importOrdersFromJson();
      JSON_FILES.forEach(function (name) {
        const raw = readJsonFile(name);
        if (raw) {
          kvSet('file:' + name, raw);
        }
      });
      metaSet('json_migrated', '1');
    });
    MOVE_FILES.forEach(moveToMigrated);
    const arch = path.join(dataDir(), 'orders-archive');
    if (fs.existsSync(arch)) {
      const destArch = path.join(migratedDir(), 'orders-archive');
      fs.mkdirSync(destArch, { recursive: true });
      fs.readdirSync(arch).forEach(function (name) {
        try {
          fs.renameSync(path.join(arch, name), path.join(destArch, name));
        } catch (error) {
          return;
        }
      });
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
  return migrateOffice();
}

function officeReady() {
  return available() && metaGet('office_migrated') === '1';
}

function readOffice(name) {
  if (officeReady()) {
    const raw = kvGet('file:' + name, null);
    return raw && typeof raw === 'object' ? raw : {};
  }
  return readJsonFile(name) || {};
}

function writeOffice(name, data) {
  if (officeReady()) {
    kvSet('file:' + name, data);
    return;
  }
  store.writeJson(path.join(dataDir(), name), data);
}

function migrateOffice() {
  if (!available()) {
    return { ok: false, skipped: true };
  }
  if (metaGet('office_migrated') === '1') {
    return { ok: true, existed: true };
  }
  try {
    tx(function () {
      OFFICE_FILES.forEach(function (name) {
        const disk = readJsonFile(name);
        if (disk) {
          kvSet('file:' + name, disk);
        } else if (kvGet('file:' + name, null) == null) {
          kvSet('file:' + name, {});
        }
      });
      metaSet('office_migrated', '1');
    });
    OFFICE_FILES.forEach(function (name) {
      moveToMigrated(name);
      moveToMigrated(name + '.bak');
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function migrated() {
  return available() && metaGet('json_migrated') === '1';
}

function close() {
  if (conn) {
    try {
      conn.close();
    } catch (error) {
      /* keç */
    }
  }
  conn = null;
  usable = false;
}

module.exports = {
  dataDir: dataDir,
  dataFile: dataFile,
  dbFile: dbFile,
  open: open,
  available: available,
  migrated: migrated,
  tx: tx,
  kvGet: kvGet,
  kvSet: kvSet,
  loadCatalog: loadCatalog,
  saveCatalog: saveCatalog,
  loadStock: loadStock,
  saveStock: saveStock,
  loadLiveOrders: loadLiveOrders,
  loadAllOrders: loadAllOrders,
  saveLiveOrders: saveLiveOrders,
  migrateJson: migrateJson,
  officeReady: officeReady,
  readOffice: readOffice,
  writeOffice: writeOffice,
  close: close,
  isLiveOrder: isLiveOrder
};
