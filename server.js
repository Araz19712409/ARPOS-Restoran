const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const store = require('./store');

const catalog = require('./catalog');
const printers = require('./printers');
const logger = require('./logger');
const users = require('./users');
const orders = require('./orders');
const reservations = require('./reservations');
const settings = require('./settings');
const minor = require('./num');
const backup = require('./backup');
const lock = require('./lock');
const terminals = require('./terminals');
const sessions = require('./sessions');
const shifts = require('./shifts');
const stock = require('./stock');
const fiscal = require('./fiscal');
const delivery = require('./delivery');
const journal = require('./journal');
const waitlist = require('./waitlist');
const clock = require('./clock');
const gifts = require('./gifts');
const sms = require('./sms');
const updater = require('./updater');
const license = require('./license');
const version = require('./version');
const books = require('./books');
const db = require('./db');
const totp = require('./totp');

db.open();
db.migrateJson();

const app = express();
const PORT = 3004;
const LIVE_HOST = settings.listenHost();
function layoutFile() {
  return db.dataFile('layout.json');
}

app.use(express.json({ limit: '6mb' }));
app.use(function (req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(function (req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 400) {
      const payload = {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        message: body && body.message ? body.message : 'Xəta'
      };
      if (res.statusCode >= 500) {
        logger.error(payload);
      } else {
        logger.warn(payload);
      }
    }
    return sendJson(body);
  };
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function needPerm(req, res, key) {
  if (!req.staff) {
    res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
    return false;
  }
  if (key && !users.hasPermission(req.staff.role, key)) {
    res.status(403).json({ success: false, message: 'İcazəniz yoxdur.' });
    return false;
  }
  return true;
}

function needAnyPerm(req, res, keys) {
  if (!req.staff) {
    res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
    return false;
  }
  const ok = keys.some(function (key) {
    return users.hasPermission(req.staff.role, key);
  });
  if (!ok) {
    res.status(403).json({ success: false, message: 'İcazəniz yoxdur.' });
    return false;
  }
  return true;
}

function needStockMode(req, res) {
  if (settings.isStockMode()) {
    return true;
  }
  res.status(403).json({ success: false, message: 'Anbar bu rejimdə bağlıdır.' });
  return false;
}

app.use('/api', function (req, res, next) {
  if (req.path === '/license/status' || req.path === '/license/activate') {
    return next();
  }
  if (!license.isLicensed()) {
    res.status(423).json({
      success: false,
      message: 'Əvvəlcə lisenziya kodunu yazın.',
      needLicense: true
    });
    return;
  }
  if (req.method === 'POST' && (req.path === '/login' || req.path === '/login/totp' || req.path === '/logs')) {
    return next();
  }
  if (req.method === 'POST' && String(req.path || '').indexOf('/delivery/webhook/') === 0) {
    return next();
  }
  const token = req.get('X-Session') || '';
  const sess = sessions.get(token);
  if (!sess) {
    res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
    return;
  }
  const staff = users.findStaff(sess.userId);
  if (!staff) {
    sessions.drop(token);
    res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
    return;
  }
  req.staff = staff;
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body.waiterId = staff.user.id;
  }
  req.query.waiterId = String(staff.user.id);
  if (users.needsPinChange(staff.user) && req.path !== '/pin' && req.path !== '/logout') {
    res.status(403).json({ success: false, message: 'Əvvəlcə PIN-i dəyişin.', mustChangePin: true });
    return;
  }
  if (settings.readSettings().tillLocked && !users.isAdminUser(staff.user) && req.path !== '/logout') {
    res.status(423).json({
      success: false,
      message: 'Kassa bağlanıb. Admin daxil olsun.',
      tillLocked: true
    });
    return;
  }
  next();
});

// Təhlükəli simvolları təmizləyirik
function sanitize(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .trim()
    .slice(0, maxLength || 80);
}

const GROUP_ICON_IDS = {
  meal: 1, snack: 1, drink: 1, coffee: 1, beer: 1, cocktail: 1,
  dessert: 1, ice: 1, grill: 1, pizza: 1, hookah: 1, soup: 1,
  fish: 1, salad: 1, bread: 1
};

function sanitizeGroupIcon(value) {
  const id = String(value || '').trim();
  return GROUP_ICON_IDS[id] ? id : '';
}

// Çertyoj faylını oxuyuruq
function readLayout() {
  const raw = store.readJson(layoutFile());
  return {
    nextFloorId: Number(raw.nextFloorId) || 1,
    nextRoomId: Number(raw.nextRoomId) || 1,
    nextTableId: Number(raw.nextTableId) || 1,
    floors: Array.isArray(raw.floors) ? raw.floors : [],
    rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
    tables: Array.isArray(raw.tables) ? raw.tables : []
  };
}

// Çertyoj faylını yazırıq
function writeLayout(data) {
  store.writeJson(layoutFile(), data);
}

const GRID = 32;

function snapGrid(value, min, max, fallback) {
  const n = num(value, min, max, fallback);
  const snapped = Math.round(n / GRID) * GRID;
  return Math.min(max, Math.max(min, snapped));
}

// Otaqda növbəti boş masa yerini tapırıq
function nextTableSlot(tables) {
  const size = GRID * 2;
  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 12; col += 1) {
      const x = col * size;
      const y = row * size;
      const busy = tables.some(function (table) {
        return Math.abs(Number(table.x || 0) - x) < size && Math.abs(Number(table.y || 0) - y) < size;
      });
      if (!busy) {
        return { x: x, y: y };
      }
    }
  }
  return { x: 0, y: 0 };
}

// Rəqəmi icazəli intervalda saxlayırıq
function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

function roomHasTables(store, roomId) {
  return store.tables.some(function (table) {
    return table.roomId === roomId;
  });
}

function pinHasPerm(pin, key) {
  const user = users.verifyPin(pin);
  if (!user) {
    return false;
  }
  const staff = users.findStaff(user.id);
  return !!(staff && users.hasPermission(staff.role, key));
}

// Bütün çertyojı qaytarırıq
app.get('/api/layout', function (req, res) {
  try {
    res.json({ success: true, data: readLayout() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Yeni mərtəbə yaradırıq
app.post('/api/floors', function (req, res) {
  if (!needPerm(req, res, 'layout.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const name = sanitize(req.body && req.body.name, 40);
    if (!name) {
      reject(400, 'Mərtəbə adı vacibdir.');
    }
    const store = readLayout();
    const floor = { id: store.nextFloorId, name: name };
    store.nextFloorId += 1;
    store.floors.push(floor);
    writeLayout(store);
    return floor;
  }, true);
});

// Mərtəbəni silirik
app.delete('/api/floors/:id', function (req, res) {
  if (!needAnyPerm(req, res, ['layout.delete', 'layout.edit'])) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = readLayout();
    const rooms = store.rooms.filter(function (room) { return room.floorId === id; });
    const roomIds = rooms.map(function (room) { return room.id; });
    store.floors = store.floors.filter(function (floor) { return floor.id !== id; });
    store.rooms = store.rooms.filter(function (room) { return room.floorId !== id; });
    store.tables = store.tables.filter(function (table) { return roomIds.indexOf(table.roomId) === -1; });
    writeLayout(store);
  });
});

// Yeni otaq yaradırıq
app.post('/api/rooms', function (req, res) {
  if (!needPerm(req, res, 'layout.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const body = req.body || {};
    const floorId = Number(body.floorId);
    const name = sanitize(body.name, 40);
    const store = readLayout();
    const floor = store.floors.find(function (item) { return item.id === floorId; });
    if (!floor) {
      reject(400, 'Mərtəbə tapılmadı.');
    }
    if (!name) {
      reject(400, 'Otaq adı vacibdir.');
    }
    const room = {
      id: store.nextRoomId,
      floorId: floorId,
      name: name,
      x: snapGrid(body.x, 0, 2400, 0),
      y: snapGrid(body.y, 0, 1800, 0),
      w: snapGrid(body.w, 160, 2400, 384),
      h: snapGrid(body.h, 128, 1800, 256)
    };
    store.nextRoomId += 1;
    store.rooms.push(room);
    writeLayout(store);
    return room;
  }, true);
});

// Otağın yerini və ölçüsünü yeniləyirik
app.put('/api/rooms/:id', function (req, res) {
  if (!needPerm(req, res, 'layout.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const body = req.body || {};
    const store = readLayout();
    const room = store.rooms.find(function (item) { return item.id === id; });
    if (!room) {
      reject(404, 'Otaq tapılmadı.');
    }
    if (body.name) {
      room.name = sanitize(body.name, 40);
    }
    if (body.x != null) {
      room.x = snapGrid(body.x, 0, 2400, room.x);
    }
    if (body.y != null) {
      room.y = snapGrid(body.y, 0, 1800, room.y);
    }
    if (body.w != null) {
      room.w = snapGrid(body.w, 160, 2400, room.w);
    }
    if (body.h != null) {
      room.h = snapGrid(body.h, 128, 1800, room.h);
    }
    writeLayout(store);
    return room;
  });
});

// Otağı silirik
app.delete('/api/rooms/:id', function (req, res) {
  if (!req.staff) {
    res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
    return;
  }
  const id = Number(req.params.id);
  const preview = readLayout();
  const occupied = roomHasTables(preview, id);
  if (occupied) {
    const own = users.hasPermission(req.staff.role, 'layout.delete');
    const viaPin = pinHasPerm(req.body && req.body.confirmPin, 'layout.delete');
    if (!own && !viaPin) {
      res.status(403).json({
        success: false,
        message: 'Masalı otağı silmək üçün «Çertyoj → Sil» icazəsi və ya o PIN lazımdır.',
        needDeletePin: true
      });
      return;
    }
  } else if (!needAnyPerm(req, res, ['layout.delete', 'layout.edit'])) {
    return;
  }
  lockedWrite(res, function () {
    const store = readLayout();
    store.rooms = store.rooms.filter(function (room) { return room.id !== id; });
    store.tables = store.tables.filter(function (table) { return table.roomId !== id; });
    writeLayout(store);
  });
});

// Yeni masa yaradırıq
app.post('/api/tables', function (req, res) {
  if (!needPerm(req, res, 'layout.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const body = req.body || {};
    const roomId = Number(body.roomId);
    const store = readLayout();
    const room = store.rooms.find(function (item) { return item.id === roomId; });
    if (!room) {
      reject(400, 'Otaq seçin.');
    }
    let number = num(body.number, 1, 200, 0);
    if (!number) {
      const used = store.tables.map(function (table) { return table.number; });
      number = 1;
      while (used.indexOf(number) !== -1) {
        number += 1;
      }
    }
    const exists = store.tables.some(function (table) { return table.number === number; });
    if (exists) {
      reject(400, 'Bu masa nömrəsi artıq var.');
    }
    const name = sanitize(body.name, 40);
    if (!name) {
      reject(400, 'Masa adını yazın.');
    }
    const others = store.tables.filter(function (item) { return item.roomId === roomId; });
    const slot = nextTableSlot(others);
    const table = {
      id: store.nextTableId,
      roomId: roomId,
      number: number,
      name: name,
      shape: body.shape === 'round' ? 'round' : 'square',
      capacity: num(body.capacity, 1, 20, 4),
      x: snapGrid(body.x, 0, 2400, slot.x),
      y: snapGrid(body.y, 0, 1800, slot.y),
      w: snapGrid(body.w, 64, 384, 64),
      h: snapGrid(body.h, 64, 384, 64),
      status: 'boş'
    };
    store.nextTableId += 1;
    store.tables.push(table);
    writeLayout(store);
    return table;
  }, true);
});

// Masanın yerini yeniləyirik
app.put('/api/tables/:id', function (req, res) {
  if (!needPerm(req, res, 'layout.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const body = req.body || {};
    const store = readLayout();
    const table = store.tables.find(function (item) { return item.id === id; });
    if (!table) {
      reject(404, 'Masa tapılmadı.');
    }
    if (body.name) {
      table.name = sanitize(body.name, 40);
    }
    if (body.x != null) {
      table.x = snapGrid(body.x, 0, 2400, table.x);
    }
    if (body.y != null) {
      table.y = snapGrid(body.y, 0, 1800, table.y);
    }
    if (body.w != null) {
      table.w = snapGrid(body.w, 64, 384, table.w || 64);
    }
    if (body.h != null) {
      table.h = snapGrid(body.h, 64, 384, table.h || 64);
    }
    writeLayout(store);
    return table;
  });
});

// Masanı silirik
app.delete('/api/tables/:id', function (req, res) {
  if (!needAnyPerm(req, res, ['layout.delete', 'layout.edit'])) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = readLayout();
    store.tables = store.tables.filter(function (table) { return table.id !== id; });
    writeLayout(store);
  });
});

// Kataloqu qaytarırıq
function sendCatalog(res, data) {
  const sold = orders.soldProductIds();
  data.products = (data.products || []).map(function (item) {
    return Object.assign({}, item, {
      sold: !!sold[item.id],
      nowPrice: catalog.salePriceNow(item)
    });
  });
  const stamp = settings.branchStamp();
  data.branchCode = stamp.code;
  data.branchName = stamp.name;
  res.json({ success: true, data: data });
}

app.get('/api/catalog', function (req, res) {
  try {
    const peek = catalog.loadCatalogRaw();
    if (catalog.needsSoldOutRoll(peek)) {
      catalog.readCatalogLocked().then(function (data) {
        sendCatalog(res, data);
      }).catch(function (error) {
        res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
      });
      return;
    }
    sendCatalog(res, catalog.readCatalog());
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/catalog/prices', function (req, res) {
  try {
    if (!needPerm(req, res, 'settings.view')) {
      return;
    }
    const stamp = settings.branchStamp();
    function sendPrices(data) {
      res.json({
        success: true,
        data: {
          branchCode: stamp.code,
          branchName: stamp.name,
          products: (data.products || []).map(function (row) {
            return {
              id: row.id,
              name: row.name,
              salePrice: row.salePrice,
              prices: row.prices && typeof row.prices === 'object' ? row.prices : {}
            };
          })
        }
      });
    }
    const peek = catalog.loadCatalogRaw();
    if (catalog.needsSoldOutRoll(peek)) {
      catalog.readCatalogLocked().then(sendPrices).catch(function (error) {
        res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
      });
      return;
    }
    sendPrices(catalog.readCatalog());
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.put('/api/catalog/prices', function (req, res) {
  if (!needAnyPerm(req, res, ['products.edit', 'settings.edit'])) {
    return;
  }
  lock.withLock('write', function () {
    const pack = (req.body && req.body.products) || [];
    if (!Array.isArray(pack) || !pack.length) {
      reject(400, 'Qiymət siyahısı boşdur.');
    }
    const store = catalog.readCatalog();
    let n = 0;
    pack.forEach(function (row) {
      const product = store.products.find(function (item) { return item.id === Number(row.id); });
      if (!product) {
        return;
      }
      if (row.salePrice != null) {
        const p = stock.parseDec(row.salePrice);
        if (Number.isFinite(p) && p >= 0 && p <= 10000) {
          product.salePrice = Number(p.toFixed(2));
        }
      }
      if (row.prices && typeof row.prices === 'object') {
        product.prices = product.prices && typeof product.prices === 'object' ? product.prices : {};
        Object.keys(row.prices).forEach(function (key) {
          const code = settings.cleanBranchCode(key);
          const val = stock.parseDec(row.prices[key]);
          if (code && Number.isFinite(val) && val >= 0 && val <= 10000) {
            product.prices[code] = Number(val.toFixed(2));
          }
        });
      }
      n += 1;
    });
    catalog.writeCatalog(store);
    return { count: n };
  }).then(function (data) {
    res.json({ success: true, data: data });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.get('/api/stock', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['stock.view', 'cost.view', 'cost.edit', 'products.edit'])) {
      return;
    }
    if (!needStockMode(req, res)) {
      return;
    }
    const box = stock.readStock();
    const catalogStore = catalog.readCatalog();
    res.json({
      success: true,
      data: {
        items: box.items.map(function (item) {
          return stock.publicItemLinked(item, box, catalogStore);
        }),
        moves: box.moves.slice(-80).reverse(),
        purchases: stock.listPurchasesForApi(box),
        suppliers: box.suppliers || [],
        permissions: req.staff && req.staff.permissions ? req.staff.permissions : []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/stock', function (req, res) {
  if (!needPerm(req, res, 'stock.edit')) {
    return;
  }
  if (!needStockMode(req, res)) {
    return;
  }
  lock.withLock('write', function () {
    const who = req.staff && req.staff.user ? req.staff.user.name : '';
    const out = stock.createItem(req.body || {}, who);
    if (out.error) {
      reject(400, out.error);
    }
    return out.item;
  }).then(function (item) {
    res.status(201).json({ success: true, data: item });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.put('/api/stock/:id', function (req, res) {
  if (!needPerm(req, res, 'stock.edit')) {
    return;
  }
  if (!needStockMode(req, res)) {
    return;
  }
  lock.withLock('write', function () {
    const out = stock.updateItem(Number(req.params.id), req.body || {}, catalog.readCatalog());
    if (out.error) {
      reject(out.error === 'Xammal tapılmadı.' ? 404 : 400, out.error);
    }
    return out.item;
  }).then(function (item) {
    res.json({ success: true, data: item });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.delete('/api/stock/:id', function (req, res) {
  if (!needAnyPerm(req, res, ['stock.edit', 'stock.delete'])) {
    return;
  }
  if (!needStockMode(req, res)) {
    return;
  }
  lock.withLock('write', function () {
    const catalogStore = catalog.readCatalog();
    const box = stock.readStock();
    const links = stock.itemLinks(Number(req.params.id), box, catalogStore);
    const canForce = users.hasPermission(req.staff.role, 'stock.delete');
    if (links.hasMoves && !canForce) {
      reject(403, 'Hərəkət var. Silmək üçün Anbar → Sil icazəsi lazımdır.');
    }
    const out = stock.removeItem(Number(req.params.id), {
      catalog: catalogStore,
      force: canForce
    });
    if (out.error) {
      reject(out.error === 'Xammal tapılmadı.' ? 404 : 400, out.error);
    }
    return out.item;
  }).then(function (item) {
    res.json({ success: true, data: item });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/stock/move', function (req, res) {
  if (!needPerm(req, res, 'stock.edit')) {
    return;
  }
  if (!needStockMode(req, res)) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const out = stock.moveStock(body.itemId, body.type, body.qty, body.note);
    if (out.error) {
      reject(400, out.error);
    }
    return out.item;
  }).then(function (item) {
    audit(req, 'stock', 'Hərəkət: ' + (item && item.name ? item.name : ''));
    res.json({ success: true, data: item });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/stock/purchases', function (req, res) {
  if (!needPerm(req, res, 'stock.edit')) {
    return;
  }
  if (!needStockMode(req, res)) {
    return;
  }
  lock.withLock('write', function () {
    const who = req.staff && req.staff.user ? req.staff.user.name : '';
    const out = stock.addPurchase(req.body || {}, who);
    if (out.error) {
      reject(400, out.error);
    }
    return out.purchase;
  }).then(function (purchase) {
    audit(req, 'stock', 'Alış sənədi');
    res.status(201).json({ success: true, data: purchase });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/stock/purchases/:id/pay', function (req, res) {
  if (!needPerm(req, res, 'stock.edit')) {
    return;
  }
  if (!needStockMode(req, res)) {
    return;
  }
  lock.withLock('write', function () {
    const who = req.staff && req.staff.user ? req.staff.user.name : '';
    const out = stock.payPurchase(req.params.id, req.body && req.body.amount, who);
    if (out.error) {
      reject(400, out.error);
    }
    const paid = Number(out.paid) || 0;
    const shiftStore = shifts.readStore();
    const dropped = shifts.addCashDrop(
      shiftStore,
      req.body && req.body.terminalId,
      paid,
      'Təchizatçı ödənişi',
      req.staff && req.staff.user
    );
    if (dropped) {
      shifts.writeStore(shiftStore);
    }
    return out.purchase;
  }).then(function (purchase) {
    audit(req, 'stock', 'Alış ödənişi');
    res.json({ success: true, data: purchase });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.get('/api/fiscal', function (req, res) {
  try {
    if (!needPerm(req, res, 'settings.view')) {
      return;
    }
    res.json({ success: true, data: fiscal.listJobs() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/fiscal/test', function (req, res) {
  if (!needPerm(req, res, 'settings.edit')) {
    return;
  }
  fiscal.probe('test').then(function (data) {
    res.json({ success: true, data: data });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/fiscal/shift', function (req, res) {
  if (!needPerm(req, res, 'settings.edit')) {
    return;
  }
  fiscal.probe('shift').then(function (data) {
    res.json({ success: true, data: data });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/fiscal/:id/retry', function (req, res) {
  if (!needPerm(req, res, 'settings.edit')) {
    return;
  }
  lock.withLock('write', function () {
    return fiscal.retry(req.params.id);
  }).then(function (job) {
    res.json({ success: true, data: job });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Yeni qrup yaradırıq
app.post('/api/groups', function (req, res) {
  if (!needPerm(req, res, 'products.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const name = sanitize(req.body && req.body.name, 40);
    if (!name) {
      reject(400, 'Qrup adı vacibdir.');
    }
    const store = catalog.readCatalog();
    const group = { id: store.nextGroupId, name: name };
    store.nextGroupId += 1;
    store.groups.push(group);
    catalog.writeCatalog(store);
    return group;
  }).then(function (group) {
    res.status(201).json({ success: true, data: group });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Qrupun adını və ikonunu dəyişirik
app.put('/api/groups/:id', function (req, res) {
  if (!needPerm(req, res, 'products.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const id = Number(req.params.id);
    const name = sanitize(req.body && req.body.name, 40);
    if (!name) {
      reject(400, 'Qrup adı vacibdir.');
    }
    const store = catalog.readCatalog();
    const group = store.groups.find(function (item) { return item.id === id; });
    if (!group) {
      reject(404, 'Qrup tapılmadı.');
    }
    group.name = name;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'icon')) {
      const icon = sanitizeGroupIcon(req.body.icon);
      if (req.body.icon && !icon) {
        reject(400, 'İkon düzgün deyil.');
      }
      group.icon = icon;
    }
    catalog.writeCatalog(store);
    return group;
  }).then(function (group) {
    res.json({ success: true, data: group });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Qrupu silirik
app.delete('/api/groups/:id', function (req, res) {
  if (!needAnyPerm(req, res, ['products.delete', 'products.edit'])) {
    return;
  }
  lock.withLock('write', function () {
    const id = Number(req.params.id);
    const store = catalog.readCatalog();
    const inGroup = store.products.filter(function (item) { return item.groupId === id; });
    const blocked = inGroup.find(function (item) { return orders.hasProductSales(item.id); });
    if (blocked) {
      reject(400, '"' + blocked.name + '" satışda olub. Satışı olan məhsulu silmək olmaz.');
    }
    store.groups = store.groups.filter(function (group) { return group.id !== id; });
    store.products = store.products.filter(function (item) { return item.groupId !== id; });
    catalog.writeCatalog(store);
  }).then(function () {
    res.json({ success: true });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Yeni stansiya yaradırıq
app.post('/api/stations', function (req, res) {
  if (!needPerm(req, res, 'products.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const name = sanitize(req.body && req.body.name, 40);
    if (!name) {
      reject(400, 'Stansiya adı vacibdir.');
    }
    const store = catalog.readCatalog();
    const station = { id: store.nextStationId, name: name };
    store.nextStationId += 1;
    store.stations.push(station);
    catalog.writeCatalog(store);
    return station;
  }).then(function (station) {
    res.status(201).json({ success: true, data: station });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Stansiyanın adını dəyişirik
app.put('/api/stations/:id', function (req, res) {
  if (!needPerm(req, res, 'products.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const id = Number(req.params.id);
    const name = sanitize(req.body && req.body.name, 40);
    if (!name) {
      reject(400, 'Stansiya adı vacibdir.');
    }
    const store = catalog.readCatalog();
    const station = store.stations.find(function (item) { return item.id === id; });
    if (!station) {
      reject(404, 'Stansiya tapılmadı.');
    }
    station.name = name;
    catalog.writeCatalog(store);
    return station;
  }).then(function (station) {
    res.json({ success: true, data: station });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Stansiyanı silirik
app.delete('/api/stations/:id', function (req, res) {
  if (!needAnyPerm(req, res, ['products.delete', 'products.edit'])) {
    return;
  }
  lock.withLock('write', function () {
    const id = Number(req.params.id);
    const store = catalog.readCatalog();
    const used = store.products.filter(function (item) { return item.stationId === id; }).length;
    if (used) {
      reject(400, 'Bu stansiyada ' + used + ' məhsul var. Əvvəlcə onların təyinatını dəyişin.');
    }
    const assigned = printers.readStore().printers.filter(function (item) {
      return item.stationId === id;
    }).length;
    if (assigned) {
      reject(400, 'Bu stansiyaya ' + assigned + ' printer bağlıdır. Əvvəlcə printeri dəyişin.');
    }
    store.stations = store.stations.filter(function (item) { return item.id !== id; });
    catalog.writeCatalog(store);
  }).then(function () {
    res.json({ success: true });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Yeni məhsul yaradırıq
app.post('/api/products', function (req, res) {
  if (!needPerm(req, res, 'products.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const store = catalog.readCatalog();
    const groupId = Number(body.groupId);
    const group = store.groups.find(function (item) { return item.id === groupId; });
    if (!group) {
      reject(400, 'Qrup seçin.');
    }
    const name = sanitize(body.name, 60);
    if (!name) {
      reject(400, 'Məhsul adı vacibdir.');
    }
    const salePrice = stock.parseDec(body.salePrice);
    if (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > 10000) {
      reject(400, 'Satış qiyməti düzgün deyil.');
    }

    const stationId = Number(body.stationId);
    const station = store.stations.find(function (item) { return item.id === stationId; });
    if (!station) {
      reject(400, 'Sifarişin gedəcəyi yeri seçin.');
    }

    const extra = catalog.emptyCostFields();
    const mods = catalog.parseModifiers(body);
    const product = {
      id: store.nextProductId,
      groupId: groupId,
      name: name,
      salePrice: Number(salePrice.toFixed(2)),
      stationId: stationId,
      image: '',
      buyPrice: body.buyPrice != null ? stock.parseDec(body.buyPrice) : extra.buyPrice,
      costPrice: extra.costPrice,
      ingredients: stock.parseRecipe(body.ingredients || extra.ingredients),
      portions: mods.portions,
      extras: mods.extras,
      blocked: false,
      soldOut: false,
      allergens: catalog.parseAllergens(body.allergens),
      happyPrice: body.happyPrice === '' || body.happyPrice == null ? null : stock.parseDec(body.happyPrice),
      happyFrom: body.happyFrom === '' || body.happyFrom == null ? null : stock.parseDec(body.happyFrom),
      happyTo: body.happyTo === '' || body.happyTo == null ? null : stock.parseDec(body.happyTo),
      comboIds: catalog.parseComboIds(body.comboIds),
      course: catalog.courseOf({ course: body.course, stationId: stationId }),
      barcode: catalog.cleanBarcode(body.barcode),
      prices: {}
    };
    const code = settings.branchStamp().code;
    if (code && body.branchPrice != null && String(body.branchPrice).trim() !== '') {
      const bp = stock.parseDec(body.branchPrice);
      if (Number.isFinite(bp) && bp >= 0 && bp <= 10000) {
        product.prices[code] = Number(bp.toFixed(2));
      }
    }
    if (product.barcode && store.products.some(function (item) {
      return item.barcode === product.barcode;
    })) {
      reject(400, 'Bu barkod başqa məhsuldadır.');
    }
    if (users.hasPermission(req.staff && req.staff.role, 'cost.edit')) {
      stock.applyRecipe(product);
    }
    store.nextProductId += 1;

    if (body.imageData) {
      const saved = catalog.saveProductImage(product.id, body.imageData);
      if (saved.error) {
        reject(400, saved.error);
      }
      product.image = saved.path + '?t=' + Date.now();
    }

    store.products.push(product);
    catalog.writeCatalog(store);
    return product;
  }).then(function (product) {
    res.status(201).json({ success: true, data: product });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Məhsulu yeniləyirik
app.put('/api/products/:id', function (req, res) {
  if (!needPerm(req, res, 'products.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const id = Number(req.params.id);
    const body = req.body || {};
    const store = catalog.readCatalog();
    const product = store.products.find(function (item) { return item.id === id; });
    if (!product) {
      reject(404, 'Məhsul tapılmadı.');
    }
    if (body.name) {
      product.name = sanitize(body.name, 60);
    }
    if (body.groupId != null) {
      const groupId = Number(body.groupId);
      const group = store.groups.find(function (item) { return item.id === groupId; });
      if (!group) {
        reject(400, 'Qrup tapılmadı.');
      }
      product.groupId = groupId;
    }
    if (body.stationId != null) {
      const stationId = Number(body.stationId);
      const station = store.stations.find(function (item) { return item.id === stationId; });
      if (!station) {
        reject(400, 'Sifarişin gedəcəyi yeri seçin.');
      }
      product.stationId = stationId;
    }
    if (body.salePrice != null) {
      const salePrice = stock.parseDec(body.salePrice);
      if (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > 10000) {
        reject(400, 'Satış qiyməti düzgün deyil.');
      }
      product.salePrice = Number(salePrice.toFixed(2));
    }
    if (body.imageData) {
      const saved = catalog.saveProductImage(product.id, body.imageData);
      if (saved.error) {
        reject(400, saved.error);
      }
      product.image = saved.path + '?t=' + Date.now();
    }
    if (users.hasPermission(req.staff && req.staff.role, 'cost.edit')) {
      if (body.buyPrice != null) {
        product.buyPrice = stock.parseDec(body.buyPrice);
      }
      if (body.ingredients) {
        product.ingredients = stock.parseRecipe(body.ingredients);
      }
      stock.applyRecipe(product);
    }
    if (body.portions != null || body.extras != null) {
      const mods = catalog.parseModifiers(body);
      product.portions = mods.portions;
      product.extras = mods.extras;
    }
    if (body.blocked != null) {
      product.blocked = !!body.blocked;
    }
    if (body.course != null) {
      product.course = catalog.courseOf({ course: body.course, stationId: product.stationId });
    }
    if (body.allergens != null) {
      product.allergens = catalog.parseAllergens(body.allergens);
    }
    if (body.soldOut != null) {
      product.soldOut = !!body.soldOut;
    }
    if (body.happyPrice != null) {
      product.happyPrice = body.happyPrice === '' ? null : stock.parseDec(body.happyPrice);
    }
    if (body.happyFrom != null) {
      product.happyFrom = body.happyFrom === '' ? null : stock.parseDec(body.happyFrom);
      if (!Number.isFinite(product.happyFrom)) {
        product.happyFrom = null;
      }
    }
    if (body.happyTo != null) {
      product.happyTo = body.happyTo === '' ? null : stock.parseDec(body.happyTo);
      if (!Number.isFinite(product.happyTo)) {
        product.happyTo = null;
      }
    }
    if (body.comboIds != null) {
      product.comboIds = catalog.parseComboIds(body.comboIds);
    }
    if (body.barcode != null) {
      const code = catalog.cleanBarcode(body.barcode);
      if (code && store.products.some(function (item) {
        return item.id !== product.id && item.barcode === code;
      })) {
        reject(400, 'Bu barkod başqa məhsuldadır.');
      }
      product.barcode = code;
    }
    if (body.branchPrice !== undefined) {
      const branchCode = settings.branchStamp().code;
      if (branchCode) {
        product.prices = product.prices && typeof product.prices === 'object' ? product.prices : {};
        if (body.branchPrice === '' || body.branchPrice == null) {
          delete product.prices[branchCode];
        } else {
          const bp = stock.parseDec(body.branchPrice);
          if (!Number.isFinite(bp) || bp < 0 || bp > 10000) {
            reject(400, 'Filial qiyməti düzgün deyil.');
          }
          product.prices[branchCode] = Number(bp.toFixed(2));
        }
      }
    }
    catalog.writeCatalog(store);
    return { product: product, body: body };
  }).then(function (result) {
    const product = result.product;
    const body = result.body;
    if (body.blocked != null) {
      audit(req, 'block', (product.blocked ? 'Bloklandı: ' : 'Açıldı: ') + product.name);
    }
    if (body.soldOut != null) {
      audit(req, 'block', (product.soldOut ? '86: ' : 'Var: ') + product.name);
    }
    res.json({ success: true, data: product });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Məhsulu silirik
app.delete('/api/products/:id', function (req, res) {
  if (!needAnyPerm(req, res, ['products.delete', 'products.edit'])) {
    return;
  }
  lock.withLock('write', function () {
    const id = Number(req.params.id);
    const store = catalog.readCatalog();
    const product = store.products.find(function (item) { return item.id === id; });
    if (!product) {
      reject(404, 'Məhsul tapılmadı.');
    }
    if (orders.hasProductSales(id)) {
      reject(400, '"' + product.name + '" satışda olub. Silmək olmaz.');
    }
    store.products = store.products.filter(function (item) { return item.id !== id; });
    catalog.writeCatalog(store);
  }).then(function () {
    res.json({ success: true });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Printerləri qaytarırıq
app.get('/api/printers', function (req, res) {
  try {
    if (!needPerm(req, res, 'printers.view')) {
      return;
    }
    res.json({ success: true, data: printers.readStore() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Yeni printer əlavə edirik
app.post('/api/printers', function (req, res) {
  if (!needPerm(req, res, 'printers.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const store = printers.readStore();
    const parsed = printers.normalizePrinter(req.body || {}, null);
    if (parsed.error) {
      reject(400, parsed.error);
    }
    if (parsed.printer.role === 'station') {
      const station = catalog.readCatalog().stations.find(function (item) {
        return item.id === parsed.printer.stationId;
      });
      if (!station) {
        reject(400, 'Stansiya tapılmadı.');
      }
    }
    parsed.printer.id = store.nextPrinterId;
    store.nextPrinterId += 1;
    store.printers.push(parsed.printer);
    printers.writeStore(store);
    return parsed.printer;
  }, true);
});

// Printeri yeniləyirik
app.put('/api/printers/:id', function (req, res) {
  if (!needPerm(req, res, 'printers.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = printers.readStore();
    const current = store.printers.find(function (item) { return item.id === id; });
    if (!current) {
      reject(404, 'Printer tapılmadı.');
    }
    const parsed = printers.normalizePrinter(req.body || {}, current);
    if (parsed.error) {
      reject(400, parsed.error);
    }
    if (parsed.printer.role === 'station') {
      const station = catalog.readCatalog().stations.find(function (item) {
        return item.id === parsed.printer.stationId;
      });
      if (!station) {
        reject(400, 'Stansiya tapılmadı.');
      }
    }
    parsed.printer.id = current.id;
    store.printers = store.printers.map(function (item) {
      return item.id === id ? parsed.printer : item;
    });
    printers.writeStore(store);
    return parsed.printer;
  });
});

// Printeri silirik
app.delete('/api/printers/:id', function (req, res) {
  if (!needPerm(req, res, 'printers.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = printers.readStore();
    store.printers = store.printers.filter(function (item) { return item.id !== id; });
    printers.writeStore(store);
  });
});

// Printerə qoşulmanı yoxlayırıq
app.post('/api/printers/:id/test-connection', async function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['printers.test', 'printers.edit'])) {
      return;
    }
    const result = await printers.testConnection(Number(req.params.id));
    if (result.error) {
      res.status(404).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Test çekini çap edirik
app.post('/api/printers/:id/test-print', async function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['printers.test', 'printers.edit'])) {
      return;
    }
    const id = Number(req.params.id);
    const printer = printers.readStore().printers.find(function (item) { return item.id === id; });
    let stationName = 'Stansiya';
    if (printer && printer.stationId) {
      const station = catalog.readCatalog().stations.find(function (item) {
        return item.id === printer.stationId;
      });
      if (station) {
        stationName = station.name;
      }
    }
    const result = await printers.testPrint(id, stationName);
    if (result.error) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Açıq sifarişləri qaytarırıq
// Satış hesabatını tarixə görə yığırıq
app.get('/api/reports/sales', function (req, res) {
  try {
    const staff = users.canUser(Number(req.query.waiterId), 'reports.view');
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Hesabata icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    function parseBound(value, end) {
      if (!value) {
        return null;
      }
      const raw = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const stamp = new Date(raw + (end ? 'T23:59:59.999' : 'T00:00:00'));
        return Number.isNaN(stamp.getTime()) ? null : stamp;
      }
      const stamp = new Date(raw);
      return Number.isNaN(stamp.getTime()) ? null : stamp;
    }
    const from = parseBound(req.query.from, false) || new Date(new Date().setHours(0, 0, 0, 0));
    const to = parseBound(req.query.to, true) || new Date(new Date().setHours(23, 59, 59, 999));
    if (from.getTime() > to.getTime()) {
      res.status(400).json({ success: false, message: 'Tarix aralığı səhvdir.' });
      return;
    }
    const branchName = settings.readSettings().branchName || '';
    const wantBranch = String(req.query.branch || '').trim();
    function inRange(value) {
      const at = new Date(value);
      return !Number.isNaN(at.getTime()) && at >= from && at <= to;
    }
    function money2(value) {
      return Number((Number(value) || 0).toFixed(2));
    }
    const sales = [];
    const productMap = {};
    const summary = { count: 0, total: 0, cash: 0, card: 0, prepaid: 0, gift: 0, service: 0, bonus: 0, cost: 0 };
    const waiterMap = {};
    const hours = [];
    for (let h = 0; h < 24; h += 1) {
      hours.push({ hour: h, count: 0, total: 0 });
    }
    const voids = [];
    const discounts = [];
    const refunds = [];
    const control = {
      voidCount: 0, voidTotal: 0,
      discountCount: 0, discountTotal: 0,
      refundCount: 0, refundTotal: 0
    };
    const showCost = users.hasPermission(req.staff && req.staff.role, 'cost.view') &&
      settings.isStockMode();
    const catalogStore = catalog.readCatalog();
    const stockStore = stock.readStock();
    orders.readAllOrders().orders.forEach(function (order) {
      if (!settings.matchesBranch(order, wantBranch)) {
        return;
      }
      const tableName = order.tableName || ('Masa ' + order.tableId);
      (order.items || []).forEach(function (item) {
        if (!item.voided || !inRange(item.voidedAt || order.updatedAt)) {
          return;
        }
        const amount = money2((Number(item.salePrice) || 0) * (Number(item.qty) || 0));
        control.voidCount += 1;
        control.voidTotal += amount;
        voids.push({
          at: item.voidedAt || order.updatedAt,
          tableName: tableName,
          name: item.name || ('#' + item.productId),
          qty: Number(item.qty) || 0,
          total: amount,
          by: item.voidedBy || ''
        });
      });
      if (order.status === 'refunded' && order.refund && inRange(order.refund.at)) {
        const refundTotal = money2(order.refund.total);
        control.refundCount += 1;
        control.refundTotal += refundTotal;
        refunds.push({
          at: order.refund.at,
          tableName: tableName,
          waiterName: order.refund.waiterName || order.waiterName || '',
          total: refundTotal,
          reason: order.refund.reason || ''
        });
      }
      if (order.status !== 'paid' || !order.payment) {
        return;
      }
      const at = new Date(order.payment.at || order.updatedAt);
      if (Number.isNaN(at.getTime()) || at < from || at > to) {
        return;
      }
      const pay = order.payment;
      const total = Number(pay.total) || 0;
      const prepaid = Number(pay.prepaid) || 0;
      const service = Number(pay.serviceCharge) || 0;
      const itemsTotal = Number(pay.itemsTotal) || Number((total - service).toFixed(2));
      let bonus = Number(pay.bonusAmount) || 0;
      if (bonus === 0 && Number(pay.bonusPercent) > 0) {
        const base = Number.isFinite(Number(pay.afterDiscount)) ? Number(pay.afterDiscount) : itemsTotal;
        bonus = Number((base * Number(pay.bonusPercent) / 100).toFixed(2));
      }
      let cash = Number(pay.cashAmount);
      let card = Number(pay.cardAmount);
      if (!Number.isFinite(cash)) {
        cash = pay.method === 'cash' ? total : 0;
      }
      if (!Number.isFinite(card)) {
        card = pay.method === 'card' ? total : 0;
      }
      summary.count += 1;
      summary.total += total;
      summary.cash += cash;
      summary.card += card;
      summary.prepaid += prepaid;
      summary.gift += Number(pay.giftAmount) || 0;
      summary.service += service;
      summary.bonus += bonus;
      if (showCost) {
        (order.items || []).forEach(function (item) {
          if (item.voided) {
            return;
          }
          const product = catalogStore.products.find(function (row) {
            return row.id === Number(item.productId);
          });
          const unit = item.costPrice != null ? Number(item.costPrice) : stock.lineCost(product, stockStore, item);
          summary.cost += unit * (Number(item.qty) || 0);
        });
      }
      const waiterName = pay.waiterName || order.waiterName || '';
      const waiterKey = String(pay.waiterId || waiterName || '0');
      if (!waiterMap[waiterKey]) {
        waiterMap[waiterKey] = { name: waiterName || '—', count: 0, total: 0, service: 0, bonus: 0 };
      }
      waiterMap[waiterKey].count += 1;
      waiterMap[waiterKey].total += total;
      waiterMap[waiterKey].service += service;
      waiterMap[waiterKey].bonus += bonus;
      hours[at.getHours()].count += 1;
      hours[at.getHours()].total += total;
      const disc = money2(pay.discountAmount);
      if (disc > 0) {
        control.discountCount += 1;
        control.discountTotal += disc;
        discounts.push({
          at: at.toISOString(),
          tableName: tableName,
          waiterName: waiterName,
          total: disc,
          reason: pay.discountReason || (order.discount && order.discount.reason) || ''
        });
      }
      sales.push({
        id: order.id,
        at: at.toISOString(),
        tableName: order.tableName || ('Masa ' + order.tableId),
        waiterName: waiterName,
        method: pay.method || '',
        total: Number(total.toFixed(2)),
        cash: Number(cash.toFixed(2)),
        card: Number(card.toFixed(2)),
        prepaid: Number(prepaid.toFixed(2)),
        service: Number(service.toFixed(2)),
        bonus: Number(bonus.toFixed(2))
      });
      (order.items || []).forEach(function (item) {
        if (item.voided) {
          return;
        }
        const key = item.name || ('#' + item.productId);
        if (!productMap[key]) {
          productMap[key] = { name: key, qty: 0, total: 0 };
        }
        productMap[key].qty += Number(item.qty) || 0;
        productMap[key].total += (Number(item.salePrice) || 0) * (Number(item.qty) || 0);
      });
    });
    sales.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    voids.sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; });
    discounts.sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; });
    refunds.sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; });
    hours.forEach(function (row) {
      row.total = money2(row.total);
    });
    const rawProducts = Object.keys(productMap).map(function (key) {
      return {
        name: productMap[key].name,
        qty: productMap[key].qty,
        total: money2(productMap[key].total)
      };
    }).sort(function (a, b) { return b.total - a.total; });
    const grand = rawProducts.reduce(function (sum, row) { return sum + row.total; }, 0);
    let running = 0;
    const products = rawProducts.map(function (row) {
      const before = running;
      running += row.total;
      let abc = 'C';
      if (grand > 0) {
        if (before < grand * 0.8) {
          abc = 'A';
        } else if (before < grand * 0.95) {
          abc = 'B';
        }
      }
      return {
        name: row.name,
        qty: row.qty,
        total: row.total,
        share: grand > 0 ? Number((row.total / grand * 100).toFixed(1)) : 0,
        abc: abc
      };
    });
    const waiters = Object.keys(waiterMap).map(function (key) {
      return {
        name: waiterMap[key].name,
        count: waiterMap[key].count,
        total: Number(waiterMap[key].total.toFixed(2)),
        service: Number(waiterMap[key].service.toFixed(2)),
        bonus: Number(waiterMap[key].bonus.toFixed(2))
      };
    }).sort(function (a, b) { return b.bonus - a.bonus; });
    res.json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        summary: {
          count: summary.count,
          total: Number(summary.total.toFixed(2)),
          cash: Number(summary.cash.toFixed(2)),
          card: Number(summary.card.toFixed(2)),
          prepaid: Number(summary.prepaid.toFixed(2)),
          gift: Number(summary.gift.toFixed(2)),
          service: Number(summary.service.toFixed(2)),
          bonus: Number(summary.bonus.toFixed(2)),
          cost: showCost ? Number(summary.cost.toFixed(2)) : null,
          profit: showCost ? Number((summary.total - summary.cost).toFixed(2)) : null,
          voidCount: control.voidCount,
          voidTotal: money2(control.voidTotal),
          discountCount: control.discountCount,
          discountTotal: money2(control.discountTotal),
          refundCount: control.refundCount,
          refundTotal: money2(control.refundTotal)
        },
        hours: hours,
        sales: sales,
        products: products,
        waiters: waiters,
        voids: voids,
        discounts: discounts,
        refunds: refunds,
        branchName: branchName,
        branches: settings.collectBranches(orders.readAllOrders().orders)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/reports/books', function (req, res) {
  try {
    const staff = req.staff;
    if (!staff || !users.hasPermission(staff.role, 'reports.view')) {
      res.status(403).json({
        success: false,
        message: staff ? 'Hesabata icazəniz yoxdur.' : 'PIN ilə daxil olun.'
      });
      return;
    }
    const from = books.parseBound(req.query.from, false) || new Date(new Date().setHours(0, 0, 0, 0));
    const to = books.parseBound(req.query.to, true) || new Date(new Date().setHours(23, 59, 59, 999));
    if (from.getTime() > to.getTime()) {
      res.status(400).json({ success: false, message: 'Tarix aralığı səhvdir.' });
      return;
    }
    const showCost = users.hasPermission(staff.role, 'cost.view');
    const showStock = showCost || users.hasPermission(staff.role, 'stock.view');
    res.json({
      success: true,
      data: books.report(from, to, {
        showCost: showCost,
        showStock: showStock,
        branch: String(req.query.branch || '').trim()
      })
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/orders', function (req, res) {
  try {
    res.json({
      success: true,
      data: {
        orders: orders.readOrders().orders,
        reservations: reservations.readReservations().reservations,
        settings: settings.forPos(),
        locks: terminals.listLocks(),
        lowStock: req.staff && users.hasPermission(req.staff.role, 'stock.view')
          ? stock.lowItems()
          : []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Xidmət haqqı və ofisiant bonuslarını qaytarırıq
app.get('/api/settings', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['settings.view', 'users.view'])) {
      return;
    }
    res.json({
      success: true,
      data: {
        settings: settings.readSettings(),
        version: updater.version(),
        lan: {
          live: LIVE_HOST,
          urls: settings.lanUrls(PORT)
        },
        terminals: terminals.listAll(),
        roles: users.readStore().roles,
        users: users.readStore().users.filter(function (item) {
          return item.active !== false;
        }).map(users.publicUser)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Xidmət haqqı və bonus faizlərini yazırıq
app.put('/api/settings', function (req, res) {
  const body = req.body || {};
  let staff = users.canUser(Number(body.waiterId), 'settings.edit');
  if (!staff || !staff.ok) {
    staff = users.canUser(Number(body.waiterId), 'users.edit');
  }
  if (!staff || !staff.ok) {
    res.status(403).json({ success: false, message: staff ? 'Ayarlara icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
    return;
  }
  lockedWrite(res, function () {
    const prev = settings.readSettings();
    const next = settings.writeSettings({
      serviceChargePercent: body.serviceChargePercent,
      waiterBonuses: body.waiterBonuses,
      backupFolder: body.backupFolder,
      ekassa: body.ekassa,
      delivery: body.delivery,
      opsMode: body.opsMode,
      listenLan: body.listenLan,
      branchName: body.branchName,
      branchCode: body.branchCode,
      sms: body.sms,
      update: body.update,
      backupGithub: body.backupGithub,
      orderCardScale: body.orderCardScale,
      vatPercent: body.vatPercent,
      tillLocked: body.tillLocked
    });
    if (next.tillLocked && !prev.tillLocked) {
      sessions.dropOthers(users.adminIds());
      journal.append({
        userId: staff.user.id,
        userName: staff.user.name,
        kind: 'lock',
        text: 'Kassa bağlandı'
      });
    }
    return next;
  });
});

app.put('/api/prefs', function (req, res) {
  const body = req.body || {};
  if (body.orderCardScale == null) {
    res.status(400).json({ success: false, message: 'Ölçü göndərilmədi.' });
    return;
  }
  if (body.waiterId) {
    const staff = users.canUser(Number(body.waiterId));
    if (!staff || !staff.user) {
      res.status(403).json({ success: false, message: 'PIN ilə daxil olun.' });
      return;
    }
  }
  lockedWrite(res, function () {
    return settings.writeSettings({
      orderCardScale: body.orderCardScale
    });
  });
});

app.get('/api/license/status', function (req, res) {
  try {
    res.json({ success: true, data: license.status() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Lisenziya oxunmadı.' });
  }
});

app.post('/api/license/activate', function (req, res) {
  lock.withLock('write', function () {
    const out = license.activate((req.body || {}).key);
    if (out.error) {
      reject(400, out.error);
    }
    return out;
  }).then(function (out) {
    res.json({ success: true, data: out.status || license.status() });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/sms/test', function (req, res) {
  const body = req.body || {};
  let staff = users.canUser(Number(body.waiterId), 'settings.edit');
  if (!staff || !staff.ok) {
    staff = users.canUser(Number(body.waiterId), 'users.edit');
  }
  if (!staff || !staff.ok) {
    res.status(403).json({ success: false, message: 'Ayarlara icazəniz yoxdur.' });
    return;
  }
  sms.send(body.phone, body.text || 'POS sınaq').then(function (out) {
    if (out.skipped) {
      res.status(400).json({ success: false, message: out.error || 'SMS bağlıdır və ya ünvan boşdur.' });
      return;
    }
    res.json({ success: true, data: { ok: true } });
  }).catch(function (error) {
    res.status(400).json({ success: false, message: error.message || 'SMS getmədi.' });
  });
});

app.get('/api/update/check', function (req, res) {
  if (!needAnyPerm(req, res, ['settings.view', 'users.view'])) {
    return;
  }
  updater.check().then(function (info) {
    res.json({ success: true, data: info });
  }).catch(function (error) {
    res.status(400).json({ success: false, message: error.message || 'Yoxlama alınmadı.' });
  });
});

app.post('/api/update/apply', function (req, res) {
  const body = req.body || {};
  let staff = users.canUser(Number(body.waiterId), 'settings.edit');
  if (!staff || !staff.ok) {
    staff = users.canUser(Number(body.waiterId), 'users.edit');
  }
  if (!staff || !staff.ok) {
    res.status(403).json({ success: false, message: 'Yeniləməyə icazəniz yoxdur.' });
    return;
  }
  updater.apply({ confirm: body.confirm === true }).then(function (out) {
    if (!out.ok) {
      res.status(400).json({ success: false, message: out.message || 'Yenilənmədi.' });
      return;
    }
    res.json({ success: true, data: out });
  }).catch(function (error) {
    res.status(400).json({ success: false, message: error.message || 'Yeniləmə alınmadı.' });
  });
});

// PIN ilə daxil oluruq
function issueLogin(user, pinText) {
  const store = users.readStore();
  const live = store.users.find(function (item) { return item.id === user.id; });
  const pin = String(pinText || '').replace(/\D/g, '');
  const mustChange = pin !== '0000' && pin.length > 0 && (users.isDefaultPin(user) || pin.length < 6);
  if (live && mustChange && !live.mustChangePin) {
    live.mustChangePin = true;
    users.writeStore(store);
  }
  journal.append({
    userId: user.id,
    userName: user.name,
    kind: 'login',
    text: 'Daxil oldu'
  });
  const role = store.roles.find(function (item) { return item.id === user.roleId; });
  return {
    user: users.publicUser(user),
    permissions: role ? role.permissions : [],
    token: sessions.create(user.id),
    mustChangePin: mustChange || !!(live && live.mustChangePin),
    opsMode: settings.readSettings().opsMode
  };
}

function denyLockedUser(user, res) {
  if (user && user.locked) {
    res.status(403).json({ success: false, message: 'Hesab kilidlənib.', locked: true });
    return true;
  }
  return false;
}

function denyTillUser(user, res) {
  if (settings.readSettings().tillLocked && !users.isAdminUser(user)) {
    res.status(403).json({
      success: false,
      message: 'Kassa bağlanıb. Admin daxil olsun.',
      tillLocked: true
    });
    return true;
  }
  return false;
}

app.post('/api/login', function (req, res) {
  try {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'local';
    const pinText = req.body && req.body.pin;
    const wait = users.pinWait(ip, pinText);
    if (wait > 0) {
      res.status(429).json({ success: false, message: '5 səhv. ' + wait + ' saniyə gözləyin.' });
      return;
    }
    const user = users.verifyPin(pinText);
    if (!user) {
      const locked = users.failPin(ip, pinText);
      res.status(401).json({
        success: false,
        message: locked > 0 ? ('5 səhv. ' + locked + ' saniyə gözləyin.') : 'PIN səhvdir.'
      });
      return;
    }
    users.clearPinFail(ip, pinText);
    const when = users.scheduleOk(user);
    if (!when.ok) {
      res.status(403).json({ success: false, message: when.error });
      return;
    }
    if (denyLockedUser(user, res) || denyTillUser(user, res)) {
      return;
    }
    if (user.totpEnabled && user.totpSecret) {
      res.json({
        success: true,
        data: {
          needTotp: true,
          totpToken: users.putPendingTotp(user.id),
          user: { id: user.id, name: user.name }
        }
      });
      return;
    }
    res.json({ success: true, data: issueLogin(user, pinText) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/login/totp', function (req, res) {
  try {
    const userId = users.takePendingTotp(req.body && req.body.totpToken);
    if (!userId) {
      res.status(401).json({ success: false, message: 'Kodun vaxtı bitdi. PIN-i yenidən yazın.' });
      return;
    }
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === userId; });
    if (!user || user.active === false) {
      res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
      return;
    }
    if (denyLockedUser(user, res) || denyTillUser(user, res)) {
      return;
    }
    if (!user.totpEnabled || !user.totpSecret || !totp.verify(user.totpSecret, req.body && req.body.code)) {
      res.status(401).json({ success: false, message: 'Tətbiq kodu səhvdir.' });
      return;
    }
    res.json({ success: true, data: issueLogin(user, '') });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/pin', function (req, res) {
  try {
    if (!req.staff) {
      res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
      return;
    }
    const pin = String((req.body && req.body.pin) || '');
    if (!users.validPin(pin)) {
      res.status(400).json({ success: false, message: 'PIN 6-8 rəqəm olmalıdır.' });
      return;
    }
    if (users.forbiddenPin(pin)) {
      res.status(400).json({ success: false, message: '0000 olmaz. Başqa PIN yazın.' });
      return;
    }
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === req.staff.user.id; });
    if (!user) {
      res.status(404).json({ success: false, message: 'İstifadəçi tapılmadı.' });
      return;
    }
    users.setPin(user, pin);
    user.mustChangePin = false;
    users.writeStore(store);
    res.json({ success: true, data: { mustChangePin: false } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/logout', function (req, res) {
  audit(req, 'logout', 'Çıxdı');
  sessions.drop(req.get('X-Session'));
  res.json({ success: true });
});

app.get('/api/journal', function (req, res) {
  try {
    if (!needPerm(req, res, 'logs.view')) {
      return;
    }
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ success: false, message: 'Tarix seçin.' });
      return;
    }
    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      res.status(400).json({ success: false, message: 'Tarix aralığı səhvdir.' });
      return;
    }
    const span = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (span > 62) {
      res.status(400).json({ success: false, message: 'Ən çox 62 gün seçin.' });
      return;
    }
    res.json({
      success: true,
      data: { from: from, to: to, rows: journal.readRange(from, to) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Stansiyalara çek göndəririk
async function dispatchTickets(catalogStore, items, tableName, waiterName, title) {
  const grouped = {};
  const warnings = [];
  items.forEach(function (item) {
    const key = String(item.stationId || 0);
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  });
  const stationIds = Object.keys(grouped);
  for (let s = 0; s < stationIds.length; s += 1) {
    const stationId = Number(stationIds[s]);
    const station = catalogStore.stations.find(function (item) { return item.id === stationId; });
    if (!stationId || !station) {
      warnings.push('Təyinatı olmayan məhsul çap olunmadı.');
      continue;
    }
    const printed = await printers.sendStationTickets(stationId, {
      stationName: station.name,
      tableName: tableName,
      waiterName: waiterName,
      title: title || '',
      items: grouped[stationIds[s]]
    });
    if (printed.warning) {
      warnings.push(printed.warning);
    }
  }
  return warnings;
}

function reject(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function sendFail(res, error) {
  const status = Number(error.status) || 500;
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Xəta: ' + error.message : error.message
  });
}

function lockedWrite(res, fn, created) {
  lock.withLock('write', fn).then(function (data) {
    if (created) {
      res.status(201).json({ success: true, data: data });
    } else if (data === undefined) {
      res.json({ success: true });
    } else {
      res.json({ success: true, data: data });
    }
  }).catch(function (error) {
    sendFail(res, error);
  });
}

function audit(req, kind, text) {
  const user = req && req.staff && req.staff.user;
  journal.append({
    userId: user ? user.id : 0,
    userName: user ? user.name : '',
    kind: kind,
    text: text
  });
}

function needTerminal(body) {
  const terminal = terminals.getById(body && body.terminalId);
  if (!terminal) {
    reject(400, 'Terminal seçin.');
  }
  return terminal;
}

function needTableOwner(tableId, terminal) {
  const id = Number(tableId);
  if (id === -1 || id === -2) {
    return;
  }
  const taken = terminals.claim(id, terminal, terminal.name);
  if (taken.error) {
    reject(409, taken.error);
  }
}

function lockIdsOf(order) {
  const ids = orders.tableIdsOf(order).slice();
  const tid = Number(order && order.tableId);
  if (orders.isServiceTable(tid) && tid !== -1 && tid !== -2 && ids.indexOf(tid) === -1) {
    ids.push(tid);
  }
  return ids;
}

function needOrderTables(order, terminal, waiterName) {
  const ids = lockIdsOf(order);
  const name = waiterName || (terminal && terminal.name) || '';
  ids.forEach(function (id) {
    const taken = terminals.claim(id, terminal, name, ids);
    if (taken.error) {
      reject(409, taken.error);
    }
  });
}

function seatFromBody(layout, store, tableId) {
  const id = Number(tableId);
  if (id === -1 || id === -2) {
    const channel = id === -2 ? 'delivery' : 'takeaway';
    const realId = id === -2 ? -(2000 + store.nextOrderId) : -(1000 + store.nextOrderId);
    const name = (channel === 'delivery' ? 'Çatdırılma' : 'Takeaway') + ' #' + store.nextOrderId;
    return { service: true, channel: channel, tableId: realId, tableName: name };
  }
  if (id < 0) {
    const existing = orders.findOpenForTable(store, id);
    const channel = existing && existing.channel
      ? existing.channel
      : orders.channelOfId(id);
    return {
      service: true,
      channel: channel,
      tableId: id,
      tableName: existing
        ? existing.tableName
        : (channel === 'delivery' ? 'Çatdırılma' : 'Takeaway')
    };
  }
  const table = layout.tables.find(function (item) { return item.id === id; });
  if (!table) {
    return null;
  }
  return {
    service: false,
    channel: 'dine',
    tableId: table.id,
    tableName: table.name || ('Masa ' + table.number),
    table: table
  };
}

function tipPoolOf(orderList, current) {
  if (!current) {
    return { total: 0, heads: 0, share: 0 };
  }
  const from = current.openedAt;
  const term = current.terminalId;
  let total = 0;
  (orderList || []).forEach(function (order) {
    if (Number(order.terminalId) !== Number(term)) {
      return;
    }
    if (order.status !== 'paid') {
      return;
    }
    const at = order.payment && order.payment.at;
    if (!at || String(at) < String(from)) {
      return;
    }
    total += Number(order.tipAmount || (order.payment && order.payment.tipAmount) || 0);
  });
  const heads = clock.listToday().today.filter(function (row) {
    if (row.outAt) {
      return false;
    }
    const staff = users.canUser(row.userId, 'payments.take');
    return !!(staff && staff.ok);
  }).length || 1;
  const sum = settings.money(total);
  return { total: sum, heads: heads, share: settings.money(sum / heads) };
}

function freeOrderTables(order, terminalId) {
  const layout = readLayout();
  const book = reservations.readReservations();
  orders.tableIdsOf(order).forEach(function (id) {
    const table = layout.tables.find(function (item) { return item.id === id; });
    if (table) {
      const stillBooked = reservations.activeForTable(book, table.id);
      table.status = stillBooked ? 'rezerv' : 'boş';
    }
    if (terminalId) {
      terminals.release(id, terminalId);
    }
  });
  if (orders.isServiceTable(order.tableId) && terminalId) {
    terminals.release(order.tableId, terminalId);
  }
  writeLayout(layout);
}

// Sifarişi qəbul edirik və stansiyalara göndəririk
app.post('/api/orders/guests', function (req, res) {
  if (!needPerm(req, res, 'orders.create')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const terminal = needTerminal(body);
    const tableId = Number(body.tableId);
    const guests = Math.max(0, Math.min(99, Math.round(Number(body.guests) || 0)));
    const guestName = sanitize(body.guestName, 40);
    const guestPhone = sanitize(body.guestPhone, 20);
    const guestAddress = sanitize(body.guestAddress, 80);
    const courierName = sanitize(body.courierName, 40);
    if (!orders.isServiceTable(tableId)) {
      const layout = readLayout();
      const table = layout.tables.find(function (item) { return item.id === tableId; });
      if (!table) {
        reject(400, 'Masa seçin.');
      }
    } else if (!tableId) {
      reject(400, 'Masa seçin.');
    }
    const store = orders.readOrders();
    const order = orders.findOpenForTable(store, tableId);
    if (!order) {
      return { guests: guests, pending: true };
    }
    needOrderTables(order, terminal);
    order.guests = guests;
    if (guestName || body.guestName != null) {
      order.guestName = guestName;
    }
    if (guestPhone || body.guestPhone != null) {
      order.guestPhone = guestPhone;
    }
    if (guestAddress || body.guestAddress != null) {
      order.guestAddress = guestAddress;
    }
    if (courierName || body.courierName != null) {
      order.courierName = courierName;
    }
    order.updatedAt = new Date().toISOString();
    orders.writeOrders(store);
    return { guests: guests };
  }).then(function (data) {
    res.json({ success: true, data: data });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/delivery/webhook/:provider', function (req, res) {
  try {
    const secret = req.get('X-Delivery-Secret') || '';
    const packed = delivery.handleWebhook(req.params.provider, secret, req.body || {});
    res.status(packed.status).json(packed.body);
    if (packed.status === 201 && packed.packed && packed.packed.autoPrintKitchen) {
      dispatchTickets(
        packed.packed.catalogStore,
        packed.packed.fresh,
        packed.packed.order.tableName,
        packed.packed.order.waiterName,
        'CATDIRILMA'
      ).catch(function (error) {
        logger.warn({
          method: 'POST',
          path: '/api/delivery/webhook',
          message: error.message || 'Mətbəx çapı gözləməyə düşdü'
        });
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta.' });
  }
});

app.post('/api/delivery/sample', function (req, res) {
  if (!needPerm(req, res, 'settings.edit')) {
    return;
  }
  lock.withLock('write', function () {
    const packed = delivery.sampleOrder();
    if (!packed.ok) {
      reject(packed.status || 400, packed.message || 'Nümunə yazılmadı.');
    }
    return packed;
  }).then(function (packed) {
    res.status(201).json({
      success: true,
      data: { orderId: packed.order.id, tableName: packed.order.tableName }
    });
    if (packed.autoPrintKitchen) {
      dispatchTickets(
        packed.catalogStore,
        packed.fresh,
        packed.order.tableName,
        packed.order.waiterName,
        'CATDIRILMA'
      ).catch(function (error) {
        logger.warn({
          method: 'POST',
          path: '/api/delivery/sample',
          message: error.message || 'Mətbəx çapı gözləməyə düşdü'
        });
      });
    }
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.get('/api/delivery/board', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['orders.create', 'payments.take'])) {
      return;
    }
    res.json({
      success: true,
      data: {
        orders: delivery.openDelivery(),
        delivery: settings.forPos().delivery
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/delivery/patch', function (req, res) {
  if (!needAnyPerm(req, res, ['orders.create', 'payments.take'])) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const packed = delivery.patchOpen(body.orderId, {
      runStatus: body.runStatus,
      courierName: body.courierName
    });
    if (!packed.ok) {
      reject(packed.status || 400, packed.message);
    }
    return packed.order;
  }).then(function (order) {
    res.json({ success: true, data: { order: order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/run-status', function (req, res) {
  if (!needPerm(req, res, 'orders.create')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    if (order.channel !== 'delivery' && order.channel !== 'takeaway') {
      reject(400, 'Yalnız götür / çatdır.');
    }
    needOrderTables(order, terminal);
    order.runStatus = orders.cleanRunStatus(order.channel, body.runStatus);
    order.updatedAt = new Date().toISOString();
    orders.writeOrders(store);
    return { order: order };
  }).then(function (data) {
    res.json({ success: true, data: data });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/accept', async function (req, res) {
  let packed;
  try {
    packed = await lock.withLock('write', function () {
      const body = req.body || {};
      const staff = users.canUser(Number(body.waiterId), 'orders.create');
      if (!staff || !staff.ok) {
        reject(403, staff ? 'Sifariş yazmağa icazəniz yoxdur.' : 'PIN ilə daxil olun.');
      }
      const terminal = needTerminal(body);
      const tableId = Number(body.tableId);
      const lines = Array.isArray(body.items) ? body.items : [];
      const layout = readLayout();
      const store = orders.readOrders();
      const seat = seatFromBody(layout, store, tableId);
      if (!seat) {
        reject(400, 'Masa seçin.');
      }
      if (!lines.length) {
        reject(400, 'Məhsul əlavə edin.');
      }
      const catalogStore = catalog.readCatalog();
      const order = orders.openForTable(store, seat.tableId, seat.tableName, {
        channel: seat.channel,
        guestName: sanitize(body.guestName, 40),
        guestPhone: sanitize(body.guestPhone, 20),
        guestAddress: sanitize(body.guestAddress, 80),
        courierName: sanitize(body.courierName, 40)
      });
      needOrderTables(order, terminal, staff.user.name);
      order.channel = seat.channel || order.channel || 'dine';
      if (body.guestName != null) {
        order.guestName = sanitize(body.guestName, 40);
      }
      if (body.guestPhone != null) {
        order.guestPhone = sanitize(body.guestPhone, 20);
      }
      if (body.guestAddress != null) {
        order.guestAddress = sanitize(body.guestAddress, 80);
      }
      if (body.courierName != null) {
        order.courierName = sanitize(body.courierName, 40);
      }
      const stamp = settings.branchStamp();
      order.branchCode = stamp.code;
      order.branchName = stamp.name;
      const fresh = [];
      const added = [];

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const product = catalogStore.products.find(function (item) {
          return item.id === Number(line.productId);
        });
        if (!product) {
          reject(400, 'Məhsul tapılmadı.');
        }
        if (product.blocked) {
          reject(400, '"' + product.name + '" bloklanıb.');
        }
        if (product.soldOut) {
          reject(400, '"' + product.name + '" bitib (86).');
        }
        const qty = Number(line.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
          reject(400, 'Miqdar düzgün deyil.');
        }
        const chosen = catalog.resolveQuotedPrice(product, {
          portionId: line.portionId,
          extraIds: line.extraIds
        }, line.salePrice);
        if (chosen.error) {
          reject(400, chosen.error);
        }
        const course = catalog.courseOf({
          course: line.course != null ? line.course : product.course,
          stationId: product.stationId
        });
        if (!order.firedCourse) {
          order.firedCourse = 1;
        }
        const sendNow = course === 0 || course <= Number(order.firedCourse);
        const complimentary = !!line.complimentary;
        const item = {
          id: store.nextItemId,
          productId: product.id,
          name: product.name,
          qty: qty,
          salePrice: complimentary ? 0 : chosen.salePrice,
          stationId: Number(product.stationId) || 0,
          note: sanitize(line.note, 80),
          modifiers: chosen.modifiers,
          course: course,
          complimentary: complimentary,
          allergens: catalog.parseAllergens(product.allergens),
          sent: sendNow,
          sentAt: sendNow ? new Date().toISOString() : '',
          costPrice: stock.lineCost(product, null, { modifiers: chosen.modifiers }),
          kitchenDone: false,
          voided: false,
          waiterId: staff.user.id,
          waiterName: staff.user.name,
          seatTableId: seat.tableId
        };
        store.nextItemId += 1;
        order.items.push(item);
        added.push(item);
        if (sendNow) {
          fresh.push(item);
        }
        (product.comboIds || []).forEach(function (cid) {
          const child = catalogStore.products.find(function (row) { return row.id === Number(cid); });
          if (!child) {
            reject(400, '"' + product.name + '" kombosunda məhsul #' + cid + ' tapılmadı.');
          }
          if (child.blocked) {
            reject(400, '"' + child.name + '" bloklanıb (kombo).');
          }
          if (child.soldOut) {
            reject(400, '"' + child.name + '" bitib (kombo).');
          }
          const sub = {
            id: store.nextItemId,
            productId: child.id,
            name: child.name,
            qty: qty,
            salePrice: 0,
            stationId: Number(child.stationId) || 0,
            note: '',
            modifiers: [],
            course: catalog.courseOf(child),
            complimentary: true,
            allergens: catalog.parseAllergens(child.allergens),
            sent: catalog.courseOf(child) === 0 || catalog.courseOf(child) <= Number(order.firedCourse),
            sentAt: '',
            costPrice: stock.lineCost(child, null, { modifiers: [] }),
            kitchenDone: false,
            voided: false,
            waiterId: staff.user.id,
            waiterName: staff.user.name,
            comboOf: item.id,
            seatTableId: seat.tableId
          };
          if (sub.sent) {
            sub.sentAt = new Date().toISOString();
            fresh.push(sub);
          }
          store.nextItemId += 1;
          order.items.push(sub);
          added.push(sub);
        });
      }

      const useStock = settings.isStockMode();
      if (useStock) {
        const lack = stock.lackMessage(catalogStore, added);
        if (lack) {
          reject(400, lack);
        }
      }

      if (!order.waiterId) {
        order.waiterId = staff.user.id;
        order.waiterName = staff.user.name;
      }
      if (body.guests != null) {
        order.guests = Math.max(0, Math.min(99, Math.round(Number(body.guests) || 0)));
      } else if (order.guests == null) {
        order.guests = 0;
      }
      order.terminalId = terminal.id;
      order.updatedAt = new Date().toISOString();
      if (seat.table) {
        seat.table.status = 'dolu';
        writeLayout(layout);
      }
      orders.writeOrders(store);
      if (!seat.service) {
        const book = reservations.readReservations();
        const seated = reservations.activeForTable(book, seat.tableId);
        if (seated) {
          seated.status = 'seated';
          reservations.writeReservations(book);
        }
      }
      const stockWarns = useStock
        ? stock.deductLines(catalogStore, fresh, { orderId: order.id })
        : [];
      return { order: order, fresh: fresh, staff: staff, catalogStore: catalogStore, stockWarns: stockWarns };
    });
  } catch (error) {
    sendFail(res, error);
    return;
  }
  audit(req, 'accept', packed.order.tableName + ' #' + packed.order.id + ' — ' +
    (packed.fresh ? packed.fresh.length : 0) + ' sətir');
  res.status(201).json({
    success: true,
    data: { order: packed.order, warnings: packed.stockWarns || [] }
  });
  dispatchTickets(
    packed.catalogStore,
    packed.fresh,
    packed.order.tableName,
    packed.staff.user.name,
    'SIFARIS'
  ).catch(function (error) {
    logger.warn({
      method: 'POST',
      path: '/api/orders/accept',
      message: error.message || 'Mətbəx çapı gözləməyə düşdü'
    });
  });
});

function kitchenBoard(stationId, pass) {
  const catalogStore = catalog.readCatalog();
  const store = orders.readOrders();
  const lines = [];
  store.orders.forEach(function (order) {
    if (order.status !== 'open') {
      return;
    }
    (order.items || []).forEach(function (item) {
      if (item.voided || !item.sent) {
        return;
      }
      if (pass) {
        if (!item.kitchenDone || item.served) {
          return;
        }
      } else if (item.kitchenDone) {
        return;
      }
      if (!pass && stationId && Number(item.stationId) !== stationId) {
        return;
      }
      const station = catalogStore.stations.find(function (row) {
        return row.id === Number(item.stationId);
      });
      lines.push({
        orderId: order.id,
        itemId: item.id,
        tableId: order.tableId,
        tableName: order.tableName || ('Masa ' + order.tableId),
        channel: order.channel || 'dine',
        stationId: Number(item.stationId) || 0,
        stationName: station ? station.name : '—',
        name: item.name,
        qty: item.qty,
        course: item.course,
        note: catalog.markText(item),
        waiterName: item.waiterName || order.waiterName || '',
        at: item.sentAt || order.updatedAt,
        pass: !!pass
      });
    });
  });
  lines.sort(function (a, b) {
    return String(a.at) < String(b.at) ? -1 : 1;
  });
  return { stations: catalogStore.stations, lines: lines };
}

app.get('/api/kitchen', function (req, res) {
  try {
    if (!needPerm(req, res, 'kitchen.view')) {
      return;
    }
    const stationId = Number(req.query.stationId) || 0;
    const pass = req.query.pass === '1' || stationId === -1;
    res.json({
      success: true,
      data: Object.assign(kitchenBoard(pass ? 0 : stationId, pass), {
        opsMode: settings.readSettings().opsMode
      })
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/kitchen/done', function (req, res) {
  try {
    if (!needPerm(req, res, 'kitchen.done')) {
      return;
    }
    const body = req.body || {};
    lock.withLock('write', function () {
      const store = orders.readOrders();
      const order = store.orders.find(function (item) { return item.id === Number(body.orderId); });
      if (!order) {
        reject(404, 'Sifariş tapılmadı.');
      }
      const item = (order.items || []).find(function (row) { return row.id === Number(body.itemId); });
      if (!item) {
        reject(404, 'Sətir tapılmadı.');
      }
      if (item.voided) {
        reject(400, 'Sətir ləğv olunub.');
      }
      item.kitchenDone = true;
      item.kitchenDoneAt = new Date().toISOString();
      item.kitchenDoneBy = req.staff.user.id;
      order.updatedAt = new Date().toISOString();
      orders.writeOrders(store);
      return item;
    }).then(function () {
      const stationId = Number(body.stationId) || 0;
      const pass = !!body.pass || stationId === -1;
      res.json({ success: true, data: kitchenBoard(pass ? 0 : stationId, pass) });
    }).catch(function (error) {
      sendFail(res, error);
    });
  } catch (error) {
    sendFail(res, error);
  }
});

app.post('/api/kitchen/serve', function (req, res) {
  try {
    if (!needPerm(req, res, 'kitchen.done')) {
      return;
    }
    const body = req.body || {};
    lock.withLock('write', function () {
      const store = orders.readOrders();
      const order = store.orders.find(function (item) { return item.id === Number(body.orderId); });
      if (!order) {
        reject(404, 'Sifariş tapılmadı.');
      }
      const item = (order.items || []).find(function (row) { return row.id === Number(body.itemId); });
      if (!item || item.voided || !item.kitchenDone) {
        reject(400, 'Sətir çıxışa hazır deyil.');
      }
      item.served = true;
      item.servedAt = new Date().toISOString();
      order.updatedAt = new Date().toISOString();
      orders.writeOrders(store);
      return item;
    }).then(function () {
      res.json({ success: true, data: kitchenBoard(0, true) });
    }).catch(function (error) {
      sendFail(res, error);
    });
  } catch (error) {
    sendFail(res, error);
  }
});

// Göndərilmiş sətri ləğv edirik
app.post('/api/orders/void', async function (req, res) {
  let packed;
  try {
    packed = await lock.withLock('write', function () {
      const body = req.body || {};
      const staff = users.canUser(Number(body.waiterId), 'orders.void');
      if (!staff || !staff.ok) {
        reject(403, staff ? 'Ləğvə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
      }
      const terminal = needTerminal(body);
      const store = orders.readOrders();
      const order = store.orders.find(function (item) { return item.id === Number(body.orderId); });
      if (!order) {
        reject(404, 'Sifariş tapılmadı.');
      }
      if (order.status !== 'open') {
        reject(400, 'Yalnız açıq hesab ləğv oluna bilər.');
      }
      needOrderTables(order, terminal);
      const line = order.items.find(function (item) { return item.id === Number(body.itemId); });
      if (!line || line.voided) {
        reject(400, 'Sətir ləğv oluna bilməz.');
      }
      line.voided = true;
      line.voidedAt = new Date().toISOString();
      line.voidedBy = staff.user.name;
      const extra = (order.items || []).filter(function (row) {
        return Number(row.comboOf) === Number(line.id) && !row.voided;
      });
      extra.forEach(function (child) {
        child.voided = true;
        child.voidedAt = line.voidedAt;
        child.voidedBy = staff.user.name;
      });
      order.updatedAt = new Date().toISOString();
      orders.writeOrders(store);
      const restock = [line].concat(extra).filter(function (row) { return row.sent; });
      if (restock.length && settings.isStockMode()) {
        stock.restockLines(catalog.readCatalog(), restock, { orderId: order.id });
      }
      return {
        order: order,
        line: line,
        extra: extra,
        staff: staff,
        skipTicket: !line.sent && !extra.some(function (row) { return row.sent; })
      };
    });
  } catch (error) {
    sendFail(res, error);
    return;
  }
  try {
    const warnings = packed.skipTicket
      ? []
      : await dispatchTickets(
        catalog.readCatalog(),
        [packed.line].concat(packed.extra || []),
        packed.order.tableName,
        packed.staff.user.name,
        'LEGV'
      );
    audit(req, 'void', packed.order.tableName + ' — ' + packed.line.name);
    res.json({ success: true, data: { order: packed.order, warnings: warnings } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Stansiyaya təkrar çap göndəririk
app.post('/api/orders/reprint', async function (req, res) {
  try {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Çapa icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const store = orders.readOrders();
    const order = store.orders.find(function (item) { return item.id === Number(body.orderId); });
    if (!order) {
      res.status(404).json({ success: false, message: 'Sifariş tapılmadı.' });
      return;
    }
    let lines = order.items.filter(function (item) { return !item.voided && item.sent; });
    if (body.itemId) {
      lines = lines.filter(function (item) { return item.id === Number(body.itemId); });
    }
    if (!lines.length) {
      res.status(400).json({ success: false, message: 'Çap olunacaq sətir yoxdur.' });
      return;
    }
    const warnings = await dispatchTickets(
      catalog.readCatalog(),
      lines,
      order.tableName,
      staff.user.name,
      'TEKRAR CAPI'
    );
    res.json({ success: true, data: { warnings: warnings } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/orders/fire', async function (req, res) {
  let packed;
  try {
    packed = await lock.withLock('write', function () {
      const body = req.body || {};
      const staff = users.canUser(Number(body.waiterId), 'orders.create');
      if (!staff || !staff.ok) {
        reject(403, staff ? 'Kurs göndərməyə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
      }
      const terminal = needTerminal(body);
      const store = orders.readOrders();
      const order = store.orders.find(function (item) {
        return item.id === Number(body.orderId) && item.status === 'open';
      });
      if (!order) {
        reject(404, 'Açıq hesab tapılmadı.');
      }
      needOrderTables(order, terminal);
      const course = Number(body.course) === 1 ? 1 : 2;
      order.firedCourse = Math.max(Number(order.firedCourse) || 1, course);
      const fresh = [];
      const catalogStore = catalog.readCatalog();
      (order.items || []).forEach(function (item) {
        if (item.voided || item.sent) {
          return;
        }
        if (item.course === 0 || item.course <= order.firedCourse) {
          item.sent = true;
          item.sentAt = new Date().toISOString();
          fresh.push(item);
        }
      });
      if (!fresh.length) {
        reject(400, 'Göndəriləcək kurs yoxdur.');
      }
      if (settings.isStockMode()) {
        const lack = stock.lackMessage(catalogStore, fresh);
        if (lack) {
          reject(400, lack);
        }
      }
      order.updatedAt = new Date().toISOString();
      orders.writeOrders(store);
      const stockWarns = settings.isStockMode()
        ? stock.deductLines(catalogStore, fresh, { orderId: order.id })
        : [];
      return {
        order: order,
        fresh: fresh,
        staff: staff,
        catalogStore: catalogStore,
        stockWarns: stockWarns
      };
    });
  } catch (error) {
    sendFail(res, error);
    return;
  }
  audit(req, 'accept', packed.order.tableName + ' — kurs ' + packed.order.firedCourse);
  res.json({
    success: true,
    data: { order: packed.order, warnings: packed.stockWarns || [] }
  });
  dispatchTickets(
    packed.catalogStore,
    packed.fresh,
    packed.order.tableName,
    packed.staff.user.name,
    packed.order.firedCourse === 2 ? 'ISTI KURS' : 'SOYUQ KURS'
  ).catch(function () {
    return null;
  });
});

app.post('/api/orders/comp', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.discount');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Pulsuz sətirə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    needOrderTables(order, terminal);
    const line = order.items.find(function (item) { return item.id === Number(body.itemId); });
    if (!line || line.voided) {
      reject(400, 'Sətir tapılmadı.');
    }
    if (order.payments && order.payments.length) {
      reject(400, 'Ödənişdən sonra pulsuz olmaz.');
    }
    line.complimentary = true;
    line.salePrice = 0;
    order.updatedAt = new Date().toISOString();
    orders.writeOrders(store);
    return { order: order, line: line };
  }).then(function (result) {
    audit(req, 'discount', result.order.tableName + ' — pulsuz: ' + result.line.name);
    res.json({ success: true, data: { order: result.order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/handoff', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Hesabı verməyə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    needOrderTables(order, terminal);
    const next = users.verifyPin(String(body.pin || '').replace(/\D/g, ''));
    if (!next) {
      reject(400, 'Yeni ofisiantın PIN-i səhvdir.');
    }
    const dest = users.canUser(next.id, 'orders.create');
    if (!dest || !dest.ok) {
      reject(403, 'Bu PIN ilə sifarişə girilməz.');
    }
    order.waiterId = dest.user.id;
    order.waiterName = dest.user.name;
    order.updatedAt = new Date().toISOString();
    orders.writeOrders(store);
    return { order: order, fromName: staff.user.name, toName: dest.user.name };
  }).then(function (result) {
    audit(req, 'move', result.order.tableName + ' — ' + result.fromName + ' → ' + result.toName);
    res.json({ success: true, data: { order: result.order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Sifarişi nağd və ya kartla bağlayırıq
app.post('/api/orders/pay', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'payments.take');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Satışa icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) { return item.id === Number(body.orderId) && item.status === 'open'; });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    needOrderTables(order, terminal);
    if (!shifts.currentFor(shifts.readStore(), terminal.id)) {
      reject(400, 'Əvvəlcə növbə açın.');
    }
    const held = (order.items || []).some(function (item) {
      return !item.voided && !item.sent;
    });
    if (held) {
      reject(400, 'Əvvəlcə isti kursu göndərin.');
    }
    order.terminalId = terminal.id;
    const bonusWaiterId = order.waiterId || staff.user.id;
    const parts = settings.billParts(orders.orderTotal(order), bonusWaiterId, null, order.discount);
    const total = parts.total;
    const book = reservations.readReservations();
    const booking = reservations.latestForTable(book, order.tableId);
    const prepaid = booking && booking.prepay ? Number(booking.prepay.total) : 0;
    const already = orders.paidTotal(order);
    if (body.tipAmount != null && !(order.payments && order.payments.length)) {
      const tip = stock.parseDec(body.tipAmount);
      if (!Number.isFinite(tip) || tip < 0 || tip > 10000) {
        reject(400, 'Bəxşiş düzgün deyil.');
      }
      order.tipAmount = settings.money(tip);
    }
    const buyerVoen = sanitize(body.buyerVoen, 12).replace(/\D/g, '');
    const buyerName = sanitize(body.buyerName, 40);
    if (buyerVoen && (buyerVoen.length < 5 || buyerVoen.length > 12)) {
      reject(400, 'VÖEN 5–12 rəqəm olmalıdır.');
    }
    if (buyerVoen) {
      order.buyerVoen = buyerVoen;
      order.buyerName = buyerName;
    }
    const tip = Number(order.tipAmount) || 0;
    const picked = orders.pickPayLines(order, body.itemIds, body.seatTableId);
    const wantPick = (Array.isArray(body.itemIds) && body.itemIds.length) || Number(body.seatTableId);
    if (wantPick && !picked.length) {
      reject(400, 'Seçilmiş sətir tapılmadı.');
    }
    const picking = picked.length > 0;
    if (picking && order.splitCount && order.payments && order.payments.length) {
      reject(400, 'Bölünmüş pay bitməyənə qədər sətir seçilməz.');
    }
    const hasSettled = (order.items || []).some(function (item) { return item.settled; });
    if (!picking && hasSettled && Number(body.splitCount) > 1) {
      reject(400, 'Sətir ödənişindən sonra nəfərə bölünməz.');
    }
    let remaining;
    let share;
    let splitCount = Number(body.splitCount);
    if (!Number.isInteger(splitCount) || splitCount < 1) {
      splitCount = 1;
    }
    if (splitCount > 10) {
      splitCount = 10;
    }
    remaining = minor.fromMinor(Math.max(0, minor.subMinor(
      minor.subMinor(minor.addMinor(minor.toMinor(total), minor.toMinor(tip)), minor.toMinor(prepaid)),
      minor.toMinor(already)
    )));
    if (picking) {
      const pickM = picked.reduce(function (sum, item) {
        return minor.addMinor(sum, minor.mulQty(minor.toMinor(item.salePrice), item.qty));
      }, 0);
      const openM = minor.toMinor(orders.openTotal(order));
      const lastPick = picked.length === (order.items || []).filter(orders.isOpenLine).length;
      share = lastPick || openM <= 0
        ? remaining
        : minor.fromMinor(Math.round(minor.toMinor(remaining) * pickM / openM));
      if (minor.subMinor(minor.toMinor(remaining), minor.toMinor(share)) <= 1) {
        share = remaining;
      }
    } else {
      if (order.payments && order.payments.length && order.splitCount) {
        splitCount = order.splitCount;
      } else if (splitCount > 1 && !order.splitCount) {
        order.splitCount = splitCount;
        order.splitShare = minor.fromMinor(Math.round(minor.toMinor(remaining) / splitCount));
      }
      share = splitCount === 1
        ? remaining
        : (order.splitShare || minor.fromMinor(Math.round(minor.toMinor(remaining) / splitCount)));
      if (minor.subMinor(minor.toMinor(remaining), minor.toMinor(share)) <= 1) {
        share = remaining;
      }
    }
    const giftCode = sanitize(body.giftCode, 16);
    let giftWanted = Number(body.giftAmount);
    if (giftCode && (!Number.isFinite(giftWanted) || giftWanted < 0)) {
      giftWanted = share;
    }
    const cashRaw = stock.parseDec(body.cashAmount);
    const cardRaw = stock.parseDec(body.cardAmount);
    if (!Number.isFinite(cashRaw) || !Number.isFinite(cardRaw) || cashRaw < 0 || cardRaw < 0) {
      reject(400, 'Nağd və kart məbləği düzgün deyil.');
    }
    const cashAmount = minor.fromMinor(minor.toMinor(cashRaw));
    const cardAmount = minor.fromMinor(minor.toMinor(cardRaw));
    let giftOnShare = 0;
    if (giftCode) {
      giftOnShare = minor.fromMinor(Math.min(
        minor.toMinor(Number.isFinite(giftWanted) ? giftWanted : share),
        minor.toMinor(share)
      ));
    }
    if (minor.addMinor(minor.addMinor(minor.toMinor(cashAmount), minor.toMinor(cardAmount)), minor.toMinor(giftOnShare)) !==
        minor.toMinor(share)) {
      reject(400, 'Nağd + kart + hədiyyə bu paya bərabər olmalıdır.');
    }
    let tendered = cashAmount;
    let change = 0;
    if (cashAmount > 0) {
      const tendRaw = Number(body.tendered);
      if (!Number.isFinite(tendRaw) || minor.toMinor(tendRaw) < minor.toMinor(cashAmount)) {
        reject(400, 'Verilən nağd, nağd hissədən az ola bilməz.');
      }
      tendered = minor.fromMinor(minor.toMinor(tendRaw));
      change = minor.fromMinor(minor.subMinor(minor.toMinor(tendered), minor.toMinor(cashAmount)));
    }
    if (giftOnShare > 0) {
      const used = gifts.redeem(giftCode, giftOnShare);
      if (used.error) {
        reject(400, used.error);
      }
      order.giftCode = giftCode;
    }
    const shareRow = {
      cashAmount: cashAmount,
      cardAmount: cardAmount,
      giftAmount: giftOnShare,
      giftCode: giftOnShare ? giftCode : '',
      tipAmount: tip,
      tendered: tendered,
      change: change,
      share: share,
      at: new Date().toISOString(),
      waiterId: staff.user.id,
      waiterName: staff.user.name
    };
    if (!order.payments) {
      order.payments = [];
    }
    order.payments.push(shareRow);
    if (picking) {
      picked.forEach(function (item) {
        item.settled = true;
      });
    }
    const stillOpen = (order.items || []).some(orders.isOpenLine);
    const left = picking
      ? (stillOpen ? minor.fromMinor(Math.max(0, minor.subMinor(minor.toMinor(remaining), minor.toMinor(share)))) : 0)
      : minor.fromMinor(Math.max(0, minor.subMinor(minor.toMinor(remaining), minor.toMinor(share))));
    const closed = picking ? !stillOpen : minor.toMinor(left) < 1;
    const cashSum = minor.fromMinor((order.payments || []).reduce(function (sum, row) {
      return minor.addMinor(sum, minor.toMinor(row.cashAmount));
    }, 0));
    const cardSum = minor.fromMinor((order.payments || []).reduce(function (sum, row) {
      return minor.addMinor(sum, minor.toMinor(row.cardAmount));
    }, 0));
    const giftSum = minor.fromMinor((order.payments || []).reduce(function (sum, row) {
      return minor.addMinor(sum, minor.toMinor(row.giftAmount));
    }, 0));
    const method = remaining === 0 && share === 0
      ? 'prepaid'
      : (giftSum > 0 && cashSum === 0 && cardSum === 0
        ? 'gift'
        : ((cashSum > 0 && cardSum > 0) || (giftSum > 0 && (cashSum > 0 || cardSum > 0))
          ? 'mixed'
          : (cardSum > 0 && cashSum === 0 ? 'card' : 'cash')));
    const payment = {
      method: method,
      itemsTotal: parts.itemsTotal,
      discountAmount: parts.discountAmount,
      discountType: parts.discountType,
      discountValue: parts.discountValue,
      discountReason: parts.discountReason,
      afterDiscount: parts.afterDiscount,
      servicePercent: parts.servicePercent,
      serviceCharge: parts.serviceCharge,
      bonusPercent: parts.bonusPercent,
      bonusAmount: parts.bonusAmount,
      total: minor.fromMinor(minor.addMinor(minor.toMinor(total), minor.toMinor(tip))),
      tipAmount: minor.fromMinor(minor.toMinor(tip)),
      prepaid: minor.fromMinor(minor.toMinor(prepaid)),
      due: remaining,
      share: share,
      remaining: left,
      splitCount: splitCount,
      cashAmount: shareRow.cashAmount,
      cardAmount: shareRow.cardAmount,
      giftAmount: giftOnShare,
      tendered: shareRow.tendered,
      change: change,
      at: shareRow.at,
      waiterId: staff.user.id,
      waiterName: staff.user.name,
      buyerVoen: order.buyerVoen || '',
      buyerName: order.buyerName || ''
    };
    order.updatedAt = shareRow.at;
    if (closed) {
      order.status = 'paid';
      order.payment = {
        method: method,
        itemsTotal: parts.itemsTotal,
        discountAmount: parts.discountAmount,
        discountType: parts.discountType,
        discountValue: parts.discountValue,
        discountReason: parts.discountReason,
        afterDiscount: parts.afterDiscount,
        servicePercent: parts.servicePercent,
        serviceCharge: parts.serviceCharge,
        bonusPercent: parts.bonusPercent,
        bonusAmount: parts.bonusAmount,
        total: minor.fromMinor(minor.addMinor(minor.toMinor(total), minor.toMinor(tip))),
        tipAmount: tip,
        prepaid: prepaid,
        due: minor.fromMinor(Math.max(0, minor.subMinor(
          minor.addMinor(minor.toMinor(total), minor.toMinor(tip)),
          minor.toMinor(prepaid)
        ))),
        cashAmount: cashSum,
        cardAmount: cardSum,
        giftAmount: giftSum,
        tendered: minor.fromMinor((order.payments || []).reduce(function (sum, row) {
          return minor.addMinor(sum, minor.toMinor(row.tendered));
        }, 0)),
        change: minor.fromMinor((order.payments || []).reduce(function (sum, row) {
          return minor.addMinor(sum, minor.toMinor(row.change));
        }, 0)),
        at: shareRow.at,
        waiterId: staff.user.id,
        waiterName: staff.user.name,
        shares: order.payments.length,
        branchName: settings.branchStamp().name || '',
        branchCode: settings.branchStamp().code || '',
        buyerVoen: order.buyerVoen || '',
        buyerName: order.buyerName || ''
      };
      if (booking) {
        booking.status = 'done';
        reservations.writeReservations(book);
      }
      freeOrderTables(order, terminal.id);
      fiscal.enqueue(order, order.payment);
    } else {
      order.payment = null;
    }
    orders.writeOrders(store);
    return { order: order, payment: payment, closed: closed, remaining: left };
  }).then(function (result) {
    audit(req, 'pay', result.order.tableName + ' #' + result.order.id + ' — ' +
      Number(result.payment && result.payment.total || 0).toFixed(2) + ' AZN');
    res.json({ success: true, data: result });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Ödənilmiş çeki kassa printerinə göndəririk
app.post('/api/orders/receipt', async function (req, res) {
  try {
    const body = req.body || {};
    let staff = users.canUser(Number(body.waiterId), 'payments.take');
    if (!staff || !staff.ok) {
      staff = users.canUser(Number(body.waiterId), 'reports.view');
    }
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Çapa icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const store = orders.readOrders();
    const order = store.orders.find(function (item) { return item.id === Number(body.orderId) && item.status === 'paid'; });
    if (!order) {
      res.status(404).json({ success: false, message: 'Çek tapılmadı.' });
      return;
    }
    const printed = await printers.sendReceiptTickets(order);
    res.json({ success: true, data: { order: order, warnings: printed.warning ? [printed.warning] : [] } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Rezerv yaradırıq
app.post('/api/reservations', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Rezervə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const tableId = Number(body.tableId);
    needTableOwner(tableId, terminal);
    const layout = readLayout();
    const table = layout.tables.find(function (item) { return item.id === tableId; });
    if (!table) {
      reject(400, 'Masa seçin.');
    }
    const open = !!orders.findOpenForTable(orders.readOrders(), tableId);
    if (open) {
      reject(400, 'Bu masada açıq hesab var.');
    }
    const book = reservations.readReservations();
    if (reservations.activeForTable(book, tableId)) {
      reject(400, 'Bu masa artıq rezervdir.');
    }
    if (waitlist.seatedAt(waitlist.readStore(), tableId)) {
      reject(400, 'Bu masada növbə oturdulub.');
    }
    const name = sanitize(body.name, 40);
    if (!name) {
      reject(400, 'Qonağın adını yazın.');
    }
    const guests = Number(body.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > 20) {
      reject(400, 'Nəfər sayı 1-20 olmalıdır.');
    }
    const at = String(body.at || '').trim();
    if (!at) {
      reject(400, 'Rezerv vaxtını seçin.');
    }
    const row = {
      id: book.nextReservationId,
      tableId: tableId,
      tableName: table.name || ('Masa ' + table.number),
      name: name,
      phone: sanitize(body.phone, 20),
      guests: guests,
      at: at,
      note: sanitize(body.note, 80),
      status: 'active',
      waiterName: staff.user.name
    };
    book.nextReservationId += 1;
    book.reservations.push(row);
    reservations.writeReservations(book);
    table.status = 'rezerv';
    writeLayout(layout);
    return row;
  }).then(function (row) {
    audit(req, 'reserve', row.tableName + ' — ' + row.name);
    sms.notifyReserve(row).catch(function () { return null; });
    res.status(201).json({ success: true, data: row });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Rezerv üçün ilkin ödəniş qəbul edirik
app.post('/api/reservations/:id/prepay', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'payments.take');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Ödənişə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const book = reservations.readReservations();
    const row = book.reservations.find(function (item) { return item.id === Number(req.params.id); });
    if (!row || (row.status !== 'active' && row.status !== 'seated')) {
      reject(404, 'Aktiv rezerv tapılmadı.');
    }
    const terminal = terminals.getById(body.terminalId);
    if (!terminal) {
      reject(400, 'Terminal seçin.');
    }
    if (!shifts.currentFor(shifts.readStore(), terminal.id)) {
      reject(400, 'Əvvəlcə növbə açın.');
    }
    const cashAmount = stock.parseDec(body.cashAmount);
    const cardAmount = stock.parseDec(body.cardAmount);
    if (!Number.isFinite(cashAmount) || !Number.isFinite(cardAmount) || cashAmount < 0 || cardAmount < 0) {
      reject(400, 'Nağd və kart məbləği düzgün deyil.');
    }
    const total = Number((cashAmount + cardAmount).toFixed(2));
    if (total <= 0) {
      reject(400, 'İlkin məbləğ 0-dan böyük olmalıdır.');
    }
    let tendered = cashAmount;
    let change = 0;
    if (cashAmount > 0) {
      tendered = Number(body.tendered);
      if (!Number.isFinite(tendered) || tendered < cashAmount) {
        reject(400, 'Verilən nağd, nağd hissədən az ola bilməz.');
      }
      change = Number((tendered - cashAmount).toFixed(2));
    }
    const prev = row.prepay && row.prepay.total ? Number(row.prepay.total) : 0;
    row.prepay = {
      total: Number((prev + total).toFixed(2)),
      cashAmount: Number(((row.prepay && row.prepay.cashAmount || 0) + cashAmount).toFixed(2)),
      cardAmount: Number(((row.prepay && row.prepay.cardAmount || 0) + cardAmount).toFixed(2)),
      lastTendered: Number(tendered.toFixed(2)),
      lastChange: change,
      at: new Date().toISOString(),
      waiterName: staff.user.name,
      terminalId: terminal.id
    };
    reservations.writeReservations(book);
    return { row: row, total: total };
  }).then(function (result) {
    audit(req, 'pay', result.row.tableName + ' — ilkin ' + result.total.toFixed(2) + ' AZN');
    res.json({ success: true, data: result.row });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

// Rezervi ləğv edirik
app.delete('/api/reservations/:id', function (req, res) {
  try {
    const staff = users.canUser(Number(req.body && req.body.waiterId || req.query.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Rezerv ləğvinə icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const id = Number(req.params.id);
    const book = reservations.readReservations();
    const row = book.reservations.find(function (item) { return item.id === id; });
    if (!row || row.status !== 'active') {
      res.status(404).json({ success: false, message: 'Aktiv rezerv tapılmadı.' });
      return;
    }
    if (row.prepay && Number(row.prepay.total) > 0) {
      res.status(400).json({
        success: false,
        message: 'İlkin ödəniş var. Əvvəlcə qaytarın və ya masaya oturdun.'
      });
      return;
    }
    row.status = 'cancelled';
    reservations.writeReservations(book);
    const layout = readLayout();
    const table = layout.tables.find(function (item) { return item.id === row.tableId; });
    const stillOpen = !!orders.findOpenForTable(orders.readOrders(), row.tableId);
    if (table && !stillOpen) {
      table.status = 'boş';
      writeLayout(layout);
    }
    audit(req, 'reserve', row.tableName + ' — rezerv ləğv');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// İstifadəçi, rol və icazə kataloqunu qaytarırıq
app.get('/api/acl', function (req, res) {
  try {
    if (!needPerm(req, res, 'users.view')) {
      return;
    }
    const store = users.readStore();
    res.json({
      success: true,
      data: {
        permissions: users.PERMISSIONS,
        roles: store.roles,
        users: store.users.map(users.publicUser)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Yeni rol yaradırıq
app.post('/api/roles', function (req, res) {
  if (!needPerm(req, res, 'users.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const name = sanitize(req.body && req.body.name, 40);
    if (!name) {
      reject(400, 'Rol adı vacibdir.');
    }
    const store = users.readStore();
    const role = {
      id: store.nextRoleId,
      name: name,
      system: false,
      permissions: []
    };
    store.nextRoleId += 1;
    store.roles.push(role);
    users.writeStore(store);
    return role;
  }, true);
});

// Rolun adını və ya icazələrini dəyişirik
app.put('/api/roles/:id', function (req, res) {
  if (!needPerm(req, res, 'users.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const body = req.body || {};
    const store = users.readStore();
    const role = store.roles.find(function (item) { return item.id === id; });
    if (!role) {
      reject(404, 'Rol tapılmadı.');
    }
    if (body.name) {
      role.name = sanitize(body.name, 40);
    }
    if (Array.isArray(body.permissions)) {
      role.permissions = users.cleanPins(body.permissions);
    }
    users.writeStore(store);
    return role;
  });
});

// Rolu silirik
app.delete('/api/roles/:id', function (req, res) {
  if (!needPerm(req, res, 'users.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = users.readStore();
    const role = store.roles.find(function (item) { return item.id === id; });
    if (!role) {
      reject(404, 'Rol tapılmadı.');
    }
    if (role.system) {
      reject(400, 'Sistem rolunu silmək olmaz.');
    }
    const used = store.users.filter(function (item) { return item.roleId === id; }).length;
    if (used) {
      reject(400, 'Bu rolda ' + used + ' istifadəçi var. Əvvəlcə onları dəyişin.');
    }
    store.roles = store.roles.filter(function (item) { return item.id !== id; });
    users.writeStore(store);
  });
});

// Yeni istifadəçi yaradırıq
app.post('/api/users', function (req, res) {
  if (!needPerm(req, res, 'users.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const body = req.body || {};
    const name = sanitize(body.name, 40);
    const roleId = Number(body.roleId);
    const store = users.readStore();
    const role = store.roles.find(function (item) { return item.id === roleId; });
    if (!name) {
      reject(400, 'İstifadəçi adı vacibdir.');
    }
    if (!role) {
      reject(400, 'Rol seçin.');
    }
    if (!users.validPin(body.pin)) {
      reject(400, 'PIN 6-8 rəqəm olmalıdır.');
    }
    if (users.forbiddenPin(body.pin)) {
      reject(400, '0000 olmaz. Başqa PIN yazın.');
    }
    const user = {
      id: store.nextUserId,
      name: name,
      roleId: roleId,
      active: body.active !== false,
      system: false
    };
    users.setPin(user, body.pin);
    user.hourlyWage = users.moneyWage(body.hourlyWage);
    if (body.scheduleDays != null || body.scheduleFrom != null) {
      user.schedule = {
        days: Array.isArray(body.scheduleDays)
          ? body.scheduleDays.map(Number).filter(function (d) { return d >= 0 && d <= 6; }).slice(0, 7)
          : [],
        from: sanitize(body.scheduleFrom, 5),
        to: sanitize(body.scheduleTo, 5)
      };
    }
    store.nextUserId += 1;
    store.users.push(user);
    users.writeStore(store);
    return users.publicUser(user);
  }, true);
});

// İstifadəçini yeniləyirik
app.put('/api/users/:id', function (req, res) {
  if (!needPerm(req, res, 'users.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const body = req.body || {};
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === id; });
    if (!user) {
      reject(404, 'İstifadəçi tapılmadı.');
    }
    if (body.name) {
      user.name = sanitize(body.name, 40);
    }
    if (body.roleId != null) {
      const role = store.roles.find(function (item) { return item.id === Number(body.roleId); });
      if (!role) {
        reject(400, 'Rol tapılmadı.');
      }
      user.roleId = role.id;
    }
    if (body.active != null) {
      if (user.system && body.active === false) {
        reject(400, 'Sistem adminini söndürmək olmaz.');
      }
      user.active = Boolean(body.active);
    }
    if (body.pin) {
      if (!users.validPin(body.pin)) {
        reject(400, 'PIN 6-8 rəqəm olmalıdır.');
      }
      if (users.forbiddenPin(body.pin)) {
        reject(400, '0000 olmaz. Başqa PIN yazın.');
      }
      users.setPin(user, body.pin);
    }
    if (body.hourlyWage != null) {
      user.hourlyWage = users.moneyWage(body.hourlyWage);
    }
    if (body.scheduleDays != null || body.scheduleFrom != null || body.scheduleTo != null) {
      const days = Array.isArray(body.scheduleDays)
        ? body.scheduleDays.map(Number).filter(function (d) { return d >= 0 && d <= 6; }).slice(0, 7)
        : [];
      user.schedule = {
        days: days,
        from: sanitize(body.scheduleFrom, 5),
        to: sanitize(body.scheduleTo, 5)
      };
    }
    users.writeStore(store);
    return users.publicUser(user);
  });
});

function canSelfOrUsersEdit(req, res, id) {
  if (!req.staff) {
    res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
    return false;
  }
  if (Number(req.staff.user.id) === Number(id)) {
    return true;
  }
  return needPerm(req, res, 'users.edit');
}

app.post('/api/users/:id/lock', function (req, res) {
  if (!needPerm(req, res, 'users.edit')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const want = (req.body || {}).locked !== false && (req.body || {}).locked !== 0;
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === id; });
    if (!user) {
      reject(404, 'İstifadəçi tapılmadı.');
    }
    if (user.system && want) {
      reject(400, 'Sistem adminini kilidləmək olmaz.');
    }
    user.locked = Boolean(want);
    users.writeStore(store);
    if (user.locked) {
      sessions.dropUser(user.id);
      journal.append({
        userId: req.staff.user.id,
        userName: req.staff.user.name,
        kind: 'lock',
        text: user.name + ' kilidləndi'
      });
    }
    return users.publicUser(user);
  });
});

app.post('/api/users/:id/totp/start', function (req, res) {
  if (!canSelfOrUsersEdit(req, res, req.params.id)) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === id; });
    if (!user) {
      reject(404, 'İstifadəçi tapılmadı.');
    }
    const out = users.startTotp(user);
    users.writeStore(store);
    return out;
  });
});

app.post('/api/users/:id/totp/confirm', function (req, res) {
  if (!canSelfOrUsersEdit(req, res, req.params.id)) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === id; });
    if (!user) {
      reject(404, 'İstifadəçi tapılmadı.');
    }
    if (!users.confirmTotp(user, (req.body || {}).code)) {
      reject(400, 'Tətbiq kodu səhvdir.');
    }
    users.writeStore(store);
    return users.publicUser(user);
  });
});

app.post('/api/users/:id/totp/off', function (req, res) {
  if (!canSelfOrUsersEdit(req, res, req.params.id)) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === id; });
    if (!user) {
      reject(404, 'İstifadəçi tapılmadı.');
    }
    if (!users.offTotp(user, (req.body || {}).code)) {
      reject(400, 'Tətbiq kodu səhvdir.');
    }
    users.writeStore(store);
    return users.publicUser(user);
  });
});

// İstifadəçini silirik
app.delete('/api/users/:id', function (req, res) {
  if (!needPerm(req, res, 'users.delete')) {
    return;
  }
  lockedWrite(res, function () {
    const id = Number(req.params.id);
    const store = users.readStore();
    const user = store.users.find(function (item) { return item.id === id; });
    if (!user) {
      reject(404, 'İstifadəçi tapılmadı.');
    }
    if (user.system) {
      reject(400, 'Sistem adminini silmək olmaz.');
    }
    store.users = store.users.filter(function (item) { return item.id !== id; });
    users.writeStore(store);
  });
});

// Brauzerdən gələn xətanı loqa yazırıq
app.post('/api/logs', function (req, res) {
  try {
    const message = sanitize(req.body && req.body.message, 400);
    if (!message) {
      res.status(400).json({ success: false, message: 'Loq mətni vacibdir.' });
      return;
    }
    logger.error({
      method: 'CLIENT',
      path: sanitize(req.body && req.body.page, 80) || 'browser',
      message: message,
      stack: req.body && req.body.stack ? String(req.body.stack).slice(0, 4000) : ''
    });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

// Ehtiyat nüsxələri — 404 tutucusundan əvvəl olmalıdır
app.get('/api/backups', function (req, res) {
  try {
    let staff = users.canUser(Number(req.query.waiterId), 'settings.view');
    if (!staff || !staff.ok) {
      staff = users.canUser(Number(req.query.waiterId), 'users.edit');
    }
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Nüsxəyə icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    res.json({ success: true, data: backup.listBackups() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/backups', function (req, res) {
  try {
    const body = req.body || {};
    let staff = users.canUser(Number(body.waiterId), 'settings.edit');
    if (!staff || !staff.ok) {
      staff = users.canUser(Number(body.waiterId), 'users.edit');
    }
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Nüsxəyə icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    if (body.backupFolder !== undefined) {
      settings.writeSettings({ backupFolder: body.backupFolder });
    }
    const row = backup.createBackup('manual');
    backup.openFolder();
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/backups/browse', function (req, res) {
  const body = req.body || {};
  let staff = users.canUser(Number(body.waiterId), 'settings.edit');
  if (!staff || !staff.ok) {
    staff = users.canUser(Number(body.waiterId), 'users.edit');
  }
  if (!staff || !staff.ok) {
    res.status(403).json({ success: false, message: staff ? 'Nüsxəyə icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
    return;
  }
  backup.pickFolder().then(function (folder) {
    if (!folder) {
      res.json({ success: true, data: { cancelled: true } });
      return;
    }
    res.json({ success: true, data: { folder: folder } });
  }).catch(function (error) {
    res.status(500).json({ success: false, message: error.message });
  });
});

app.post('/api/backups/:id/restore', function (req, res) {
  try {
    const body = req.body || {};
    let staff = users.canUser(Number(body.waiterId), 'settings.edit');
    if (!staff || !staff.ok) {
      staff = users.canUser(Number(body.waiterId), 'users.edit');
    }
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Bərpaya icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const result = backup.restoreBackup(req.params.id);
    if (result.error) {
      res.status(404).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/terminals', function (req, res) {
  try {
    res.json({ success: true, data: terminals.listAll() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/terminals', function (req, res) {
  try {
    const body = req.body || {};
    let staff = users.canUser(Number(body.waiterId), 'settings.edit');
    if (!staff || !staff.ok) {
      staff = users.canUser(Number(body.waiterId), 'users.edit');
    }
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Terminal yazmağa icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const result = terminals.create(body.name);
    if (result.error) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }
    res.status(201).json({ success: true, data: result.terminal });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.delete('/api/terminals/:id', function (req, res) {
  try {
    const waiterId = Number(req.body && req.body.waiterId || req.query.waiterId);
    let staff = users.canUser(waiterId, 'settings.edit');
    if (!staff || !staff.ok) {
      staff = users.canUser(waiterId, 'users.edit');
    }
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Terminal silməyə icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const result = terminals.remove(req.params.id);
    if (result.error) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/orders/discount', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.discount');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Endirimə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    needOrderTables(order, terminal);
    const type = body.type === 'amount' ? 'amount' : 'percent';
    const value = Number(body.value);
    if (!Number.isFinite(value) || value <= 0) {
      reject(400, 'Endirim məbləği düzgün deyil.');
    }
    if (type === 'percent' && value > 100) {
      reject(400, 'Faiz 100-dən çox ola bilməz.');
    }
    const items = orders.orderTotal(order);
    if (items <= 0) {
      reject(400, 'Endirim üçün məhsul yoxdur.');
    }
    const trial = {
      type: type,
      value: settings.money(value),
      reason: sanitize(body.reason, 40)
    };
    const already = orders.paidTotal(order);
    const book = reservations.readReservations();
    const booking = reservations.latestForTable(book, order.tableId);
    const prepaid = booking && booking.prepay ? Number(booking.prepay.total) : 0;
    const parts = settings.billParts(items, order.waiterId || staff.user.id, null, trial);
    if (parts.total + 0.009 < prepaid + already) {
      reject(400, 'Ödənilən məbləğdən böyük endirim olmaz.');
    }
    order.discount = {
      type: type,
      value: settings.money(value),
      reason: sanitize(body.reason, 40),
      by: staff.user.name,
      at: new Date().toISOString()
    };
    order.updatedAt = order.discount.at;
    orders.writeOrders(store);
    return order;
  }).then(function (order) {
    const disc = order.discount || {};
    audit(req, 'discount', order.tableName + ' — ' +
      (disc.type === 'percent' ? (disc.value + '%') : (disc.value + ' AZN')));
    res.json({ success: true, data: { order: order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/discount/clear', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.discount');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Endirimə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    needOrderTables(order, terminal);
    delete order.discount;
    order.updatedAt = new Date().toISOString();
    orders.writeOrders(store);
    return order;
  }).then(function (order) {
    audit(req, 'discount', order.tableName + ' — endirim silindi');
    res.json({ success: true, data: { order: order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/move', async function (req, res) {
  let packed;
  try {
    packed = await lock.withLock('write', function () {
      const body = req.body || {};
      let staff = users.canUser(Number(body.waiterId), 'orders.move');
      if (!staff || !staff.ok) {
        staff = users.canUser(Number(body.waiterId), 'orders.create');
      }
      if (!staff || !staff.ok) {
        reject(403, staff ? 'Köçürməyə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
      }
      const terminal = needTerminal(body);
      const store = orders.readOrders();
      const order = store.orders.find(function (item) {
        return item.id === Number(body.orderId) && item.status === 'open';
      });
      if (!order) {
        reject(404, 'Açıq hesab tapılmadı.');
      }
      needOrderTables(order, terminal);
      const destId = Number(body.tableId);
      if (!destId || destId === order.tableId) {
        reject(400, 'Başqa masa seçin.');
      }
      const layout = readLayout();
      const fromService = orders.isServiceTable(order.tableId);
      const from = fromService ? null : layout.tables.find(function (item) { return item.id === order.tableId; });
      const dest = layout.tables.find(function (item) { return item.id === destId; });
      if (!dest || (!fromService && !from)) {
        reject(400, 'Masa tapılmadı.');
      }
      if ((order.linkedTableIds || []).length) {
        reject(400, 'Əvvəl birləşmiş masaları ayırın.');
      }
      const destBusy = orders.findOpenForTable(store, dest.id);
      if (destBusy) {
        reject(400, 'Yeni masada açıq hesab var.');
      }
      const book = reservations.readReservations();
      if (reservations.activeForTable(book, dest.id)) {
        reject(400, 'Yeni masa rezervdir.');
      }
      const taken = terminals.claim(dest.id, terminal, staff.user.name, [dest.id]);
      if (taken.error) {
        reject(409, taken.error);
      }
      if (fromService) {
        terminals.release(order.tableId, terminal.id);
      } else {
        terminals.release(from.id, terminal.id);
      }
      const fromName = order.tableName || (from && (from.name || ('Masa ' + from.number))) ||
        (order.channel === 'delivery' ? 'Çatdırılma' : 'Takeaway');
      const destName = dest.name || ('Masa ' + dest.number);
      if (from) {
        const booking = reservations.latestForTable(book, from.id);
        if (booking && (booking.status === 'active' || booking.status === 'seated')) {
          booking.tableId = dest.id;
          booking.tableName = destName;
          reservations.writeReservations(book);
        }
      }
      order.tableId = dest.id;
      order.tableName = destName;
      order.channel = 'dine';
      order.updatedAt = new Date().toISOString();
      dest.status = 'dolu';
      if (from) {
        const stillBooked = reservations.activeForTable(reservations.readReservations(), from.id);
        from.status = stillBooked ? 'rezerv' : 'boş';
      }
      orders.writeOrders(store);
      writeLayout(layout);
      const items = (order.items || []).filter(function (item) { return !item.voided; });
      return {
        order: order,
        staff: staff,
        fromName: fromName,
        destName: destName,
        items: items,
        catalogStore: catalog.readCatalog()
      };
    });
  } catch (error) {
    sendFail(res, error);
    return;
  }
  audit(req, 'move', packed.fromName + ' → ' + packed.destName);
  res.json({
    success: true,
    data: { order: packed.order, warnings: [] }
  });
  if (packed.items.length) {
    dispatchTickets(
      packed.catalogStore,
      packed.items,
      packed.fromName + ' → ' + packed.destName,
      packed.staff.user.name,
      'MASA DEYISDI'
    ).catch(function () {
      return null;
    });
  }
});

app.post('/api/orders/merge', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Birləşdirməyə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    if (orders.isServiceTable(order.tableId) || order.channel === 'takeaway' || order.channel === 'delivery') {
      reject(400, 'Takeaway/çatdırılma hesabı birləşməz.');
    }
    needOrderTables(order, terminal);
    const destId = Number(body.tableId);
    if (!destId || destId === order.tableId || (order.linkedTableIds || []).indexOf(destId) !== -1) {
      reject(400, 'Başqa masa seçin.');
    }
    const layout = readLayout();
    const dest = layout.tables.find(function (item) { return item.id === destId; });
    if (!dest) {
      reject(400, 'Masa tapılmadı.');
    }
    const destOrder = orders.findOpenForTable(store, dest.id);
    if (destOrder && destOrder.id === order.id) {
      reject(400, 'Bu masa artıq bu hesabdadır.');
    }
    if (destOrder && destOrder.payments && destOrder.payments.length) {
      reject(400, 'O masada ödəniş var. Birləşdirmək olmaz.');
    }
    if (!destOrder && reservations.activeForTable(reservations.readReservations(), dest.id)) {
      reject(400, 'O masa rezervdir.');
    }
    const keep = lockIdsOf(order).concat([dest.id]);
    const taken = terminals.claim(dest.id, terminal, staff.user.name, keep);
    if (taken.error) {
      reject(409, taken.error);
    }
    if (!order.linkedTableIds) {
      order.linkedTableIds = [];
    }
    if (destOrder) {
      (destOrder.items || []).forEach(function (item) {
        if (item.seatTableId == null) {
          item.seatTableId = destOrder.tableId;
        }
        order.items.push(item);
      });
      order.guests = Math.max(0, Math.min(99, Number(order.guests || 0) + Number(destOrder.guests || 0)));
      [destOrder.tableId].concat(destOrder.linkedTableIds || []).forEach(function (id) {
        const n = Number(id);
        if (n > 0 && n !== order.tableId && order.linkedTableIds.indexOf(n) === -1) {
          order.linkedTableIds.push(n);
        }
      });
      destOrder.status = 'merged';
      destOrder.mergedInto = order.id;
      destOrder.updatedAt = new Date().toISOString();
    } else {
      order.linkedTableIds.push(dest.id);
    }
    dest.status = 'dolu';
    order.updatedAt = new Date().toISOString();
    needOrderTables(order, terminal, staff.user.name);
    orders.writeOrders(store);
    writeLayout(layout);
    return { order: order, destName: dest.name || ('Masa ' + dest.number) };
  }).then(function (result) {
    audit(req, 'move', result.order.tableName + ' + ' + result.destName);
    res.json({ success: true, data: { order: result.order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/unmerge', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Ayırmağa icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const terminal = needTerminal(body);
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId) && item.status === 'open';
    });
    if (!order) {
      reject(404, 'Açıq hesab tapılmadı.');
    }
    needOrderTables(order, terminal);
    const splitId = Number(body.tableId);
    const linked = order.linkedTableIds || [];
    if (splitId === order.tableId || linked.indexOf(splitId) === -1) {
      reject(400, 'Yalnız birləşmiş masanı ayırmaq olar.');
    }
    const layout = readLayout();
    const table = layout.tables.find(function (item) { return item.id === splitId; });
    if (!table) {
      reject(400, 'Masa tapılmadı.');
    }
    if (order.payments && order.payments.length) {
      reject(400, 'Ödəniş var. Ayırmaq olmaz.');
    }
    const moved = (order.items || []).filter(function (item) {
      return Number(item.seatTableId) === splitId;
    });
    order.items = (order.items || []).filter(function (item) {
      return Number(item.seatTableId) !== splitId;
    });
    order.linkedTableIds = linked.filter(function (id) { return Number(id) !== splitId; });
    const stillBooked = reservations.activeForTable(reservations.readReservations(), table.id);
    const liveLeft = (order.items || []).some(function (item) { return !item.voided; });
    if (moved.length) {
      const splitGuests = liveLeft ? 0 : (Number(order.guests) || 0);
      store.orders.push({
        id: store.nextOrderId,
        tableId: splitId,
        tableName: table.name || ('Masa ' + table.number),
        status: 'open',
        guests: splitGuests,
        items: moved,
        channel: 'dine',
        linkedTableIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        waiterId: order.waiterId,
        waiterName: order.waiterName,
        terminalId: order.terminalId,
        firedCourse: order.firedCourse || 1
      });
      store.nextOrderId += 1;
      table.status = 'dolu';
      const taken = terminals.claim(splitId, terminal, staff.user.name);
      if (taken.error) {
        reject(409, taken.error);
      }
    } else {
      table.status = stillBooked ? 'rezerv' : 'boş';
      terminals.release(table.id, terminal.id);
    }
    if (!liveLeft) {
      order.status = 'cancelled';
      const primary = layout.tables.find(function (item) { return item.id === order.tableId; });
      if (primary) {
        const booked = reservations.activeForTable(reservations.readReservations(), primary.id);
        primary.status = booked ? 'rezerv' : 'boş';
      }
      terminals.release(order.tableId, terminal.id);
      (order.linkedTableIds || []).forEach(function (id) {
        const left = layout.tables.find(function (item) { return item.id === Number(id); });
        if (left) {
          const booked = reservations.activeForTable(reservations.readReservations(), left.id);
          left.status = booked ? 'rezerv' : 'boş';
        }
        terminals.release(id, terminal.id);
      });
      order.linkedTableIds = [];
    }
    order.updatedAt = new Date().toISOString();
    orders.writeOrders(store);
    writeLayout(layout);
    return { order: order, splitName: table.name || ('Masa ' + table.number) };
  }).then(function (result) {
    audit(req, 'move', result.order.tableName + ' — ayrıldı: ' + result.splitName);
    res.json({ success: true, data: { order: result.order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/orders/refund', function (req, res) {
  lock.withLock('write', function () {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'payments.refund');
    if (!staff || !staff.ok) {
      reject(403, staff ? 'Geri ödənişə icazəniz yoxdur.' : 'PIN ilə daxil olun.');
    }
    const store = orders.readOrders();
    const order = store.orders.find(function (item) {
      return item.id === Number(body.orderId);
    });
    if (!order || !order.payment) {
      reject(404, 'Ödənilmiş çek tapılmadı.');
    }
    if (order.status === 'refunded') {
      reject(400, 'Bu çek artıq qaytarılıb.');
    }
    if (order.status !== 'paid') {
      reject(400, 'Yalnız ödənilmiş çeki qaytarmaq olar.');
    }
    const reason = sanitize(body.reason, 40);
    if (!reason) {
      reject(400, 'Səbəbi yazın.');
    }
    if (settings.isStockMode()) {
      const lines = (order.items || []).filter(function (item) { return !item.voided && item.sent; });
      stock.restockLines(catalog.readCatalog(), lines, { orderId: order.id });
    }
    const pay = order.payment;
    let giftBack = 0;
    (order.payments || []).forEach(function (row) {
      const giftSum = minor.toMinor(row.giftAmount);
      if (row.giftCode && giftSum > 0) {
        const back = gifts.restore(row.giftCode, minor.fromMinor(giftSum));
        if (!back.error) {
          giftBack = minor.addMinor(giftBack, giftSum);
        }
      }
    });
    order.status = 'refunded';
    order.refund = {
      at: new Date().toISOString(),
      waiterId: staff.user.id,
      waiterName: staff.user.name,
      reason: reason,
      cashAmount: minor.fromMinor(minor.toMinor(pay.cashAmount)),
      cardAmount: minor.fromMinor(minor.toMinor(pay.cardAmount)),
      giftAmount: minor.fromMinor(giftBack),
      total: minor.fromMinor(minor.toMinor(pay.total))
    };
    order.updatedAt = order.refund.at;
    orders.writeOrders(store);
    return order;
  }).then(function (order) {
    audit(req, 'refund', order.tableName + ' #' + order.id + ' — ' +
      Number(order.refund && order.refund.total || 0).toFixed(2) + ' AZN');
    res.json({ success: true, data: { order: order } });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.get('/api/shifts', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['payments.take', 'reports.view'])) {
      return;
    }
    const list = terminals.listAll();
    let terminalId = Number(req.query.terminalId);
    if (!terminalId && list[0]) {
      terminalId = list[0].id;
    }
    if (!terminalId) {
      res.json({
        success: true,
        data: { current: null, openTables: [], history: [], terminals: [] }
      });
      return;
    }
    const store = shifts.readStore();
    const orderList = orders.readOrders().orders;
    const book = reservations.readReservations();
    const current = shifts.currentFor(store, terminalId);
    const history = store.shifts.filter(function (row) {
      return row.terminalId === terminalId && row.status === 'closed';
    }).sort(function (a, b) {
      return String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
    }).slice(0, 20).map(function (row) {
      return shifts.withExpected(row, orderList, book);
    });
    res.json({
      success: true,
      data: {
        current: current ? shifts.withExpected(current, orderList, book) : null,
        openTables: shifts.openTableNames(orderList, terminalId),
        history: history,
        terminals: terminals.listAll(),
        tipPool: tipPoolOf(orderList, current)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/shifts/drop', function (req, res) {
  if (!needPerm(req, res, 'payments.take')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const terminal = terminals.getById(body.terminalId);
    if (!terminal) {
      reject(400, 'Terminal seçin.');
    }
    const amount = stock.parseDec(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      reject(400, 'Məbləğ düzgün deyil.');
    }
    const store = shifts.readStore();
    const row = shifts.currentFor(store, terminal.id);
    if (!row) {
      reject(404, 'Açıq növbə yoxdur.');
    }
    if (!row.drops) {
      row.drops = [];
    }
    row.drops.push({
      amount: shifts.money(amount),
      note: sanitize(body.note, 40),
      at: new Date().toISOString(),
      userId: req.staff.user.id,
      userName: req.staff.user.name
    });
    shifts.writeStore(store);
    return {
      terminalName: terminal.name,
      amount: shifts.money(amount),
      packed: shifts.withExpected(row, orders.readOrders().orders, reservations.readReservations())
    };
  }).then(function (result) {
    audit(req, 'shift', result.terminalName + ' — nağd çıxarış ' + result.amount);
    res.json({ success: true, data: result.packed });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.get('/api/waitlist', function (req, res) {
  try {
    if (!needPerm(req, res, 'orders.create')) {
      return;
    }
    const box = waitlist.readStore();
    res.json({ success: true, data: { items: waitlist.waiting(box), seated: waitlist.seated(box) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/waitlist', function (req, res) {
  if (!needPerm(req, res, 'orders.create')) {
    return;
  }
  lock.withLock('write', function () {
    const out = waitlist.add(req.body || {});
    if (out.error) {
      reject(400, out.error);
    }
    return out;
  }).then(function (out) {
    audit(req, 'reserve', 'Növbə: ' + out.item.name);
    sms.notifyWait(out.item).catch(function () { return null; });
    res.status(201).json({ success: true, data: out });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/waitlist/:id/seat', function (req, res) {
  if (!needPerm(req, res, 'orders.create')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const tableId = Number(body.tableId);
    const layout = readLayout();
    const table = layout.tables.find(function (item) { return item.id === tableId; });
    if (!table) {
      reject(400, 'Masa seçin.');
    }
    if (orders.findOpenForTable(orders.readOrders(), tableId)) {
      reject(400, 'Bu masada açıq hesab var.');
    }
    if (reservations.activeForTable(reservations.readReservations(), tableId)) {
      reject(400, 'Bu masa rezervdir.');
    }
    if (waitlist.seatedAt(waitlist.readStore(), tableId)) {
      reject(400, 'Bu masada növbə oturdulub.');
    }
    const hold = terminals.lockOf(tableId);
    const terminal = terminals.getById(body.terminalId);
    if (hold && (!terminal || hold.terminalId !== terminal.id)) {
      reject(409, 'Bu masa ' + hold.terminalName + '-dədir.');
    }
    if (terminal) {
      const taken = terminals.claim(tableId, terminal, terminal.name);
      if (taken.error) {
        reject(409, taken.error);
      }
    }
    const out = waitlist.setStatus(req.params.id, 'seated', { tableId: tableId });
    if (out.error) {
      reject(400, out.error);
    }
    return out;
  }).then(function (out) {
    audit(req, 'reserve', 'Növbə oturdu: ' + out.item.name);
    res.json({ success: true, data: out });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/waitlist/:id/gone', function (req, res) {
  try {
    if (!needPerm(req, res, 'orders.create')) {
      return;
    }
    const out = waitlist.setStatus(req.params.id, 'gone');
    if (out.error) {
      res.status(400).json({ success: false, message: out.error });
      return;
    }
    audit(req, 'reserve', 'Növbə getdi: ' + out.item.name);
    res.json({ success: true, data: out });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/clock', function (req, res) {
  try {
    if (!req.staff) {
      res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
      return;
    }
    res.json({ success: true, data: clock.listToday() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/clock', function (req, res) {
  try {
    if (!req.staff) {
      res.status(401).json({ success: false, message: 'PIN ilə daxil olun.' });
      return;
    }
    const out = clock.toggle(req.staff.user);
    if (out.error) {
      res.status(400).json({ success: false, message: out.error });
      return;
    }
    audit(req, 'shift', out.action === 'in' ? 'İşə girdi' : 'İşdən çıxdı');
    res.json({ success: true, data: out });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/gifts', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['payments.take', 'reports.view'])) {
      return;
    }
    const out = gifts.lookup(req.query && req.query.code);
    if (out.error) {
      res.status(404).json({ success: false, message: out.error });
      return;
    }
    res.json({ success: true, data: out.card });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/gifts', function (req, res) {
  if (!needPerm(req, res, 'payments.take')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const out = gifts.add(body.code, body.amount, req.staff.user.name);
    if (out.error) {
      reject(400, out.error);
    }
    return out.card;
  }).then(function (card) {
    audit(req, 'pay', 'Hədiyyə kartı ' + card.code + ' +' + card.balance);
    res.status(201).json({ success: true, data: card });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.get('/api/display', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['orders.create', 'payments.take', 'kitchen.view'])) {
      return;
    }
    const terminalId = Number(req.query.terminalId);
    const focusId = terminals.focusTable(terminalId);
    const box = orders.readOrders();
    let order = null;
    if (focusId) {
      order = box.orders.find(function (item) {
        return item.status === 'open' && orders.coversTable(item, focusId);
      }) || box.orders.filter(function (item) {
        return item.status === 'paid' && Number(item.tableId) === Number(focusId);
      }).sort(function (a, b) {
        return String((b.payment && b.payment.at) || b.updatedAt) <
          String((a.payment && a.payment.at) || a.updatedAt) ? -1 : 1;
      })[0] || null;
    }
    if (!order) {
      res.json({ success: true, data: { empty: true } });
      return;
    }
    res.json({
      success: true,
      data: {
        empty: false,
        tableName: order.tableName,
        status: order.status,
        items: (order.items || []).filter(function (item) { return !item.voided; }).map(function (item) {
          return { name: item.name, qty: item.qty, salePrice: item.salePrice };
        }),
        total: order.payment ? order.payment.total : orders.orderTotal(order)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/shifts/open', function (req, res) {
  if (!needPerm(req, res, 'payments.take')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const terminal = terminals.getById(body.terminalId);
    if (!terminal) {
      reject(400, 'Terminal seçin.');
    }
    const startingCash = Number(body.startingCash);
    if (!Number.isFinite(startingCash) || startingCash < 0) {
      reject(400, 'Başlanğıc nağd düzgün deyil.');
    }
    const store = shifts.readStore();
    if (shifts.currentFor(store, terminal.id)) {
      reject(400, 'Bu terminaldə növbə artıq açıqdır.');
    }
    const row = {
      id: store.nextId,
      terminalId: terminal.id,
      terminalName: terminal.name,
      status: 'open',
      startingCash: shifts.money(startingCash),
      openedAt: new Date().toISOString(),
      openedBy: req.staff.user.id,
      openedByName: req.staff.user.name
    };
    store.nextId += 1;
    store.shifts.push(row);
    shifts.writeStore(store);
    return {
      terminalName: terminal.name,
      packed: shifts.withExpected(row, orders.readOrders().orders, reservations.readReservations())
    };
  }).then(function (result) {
    audit(req, 'shift', result.terminalName + ' — növbə açıldı');
    res.status(201).json({ success: true, data: result.packed });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/shifts/close', function (req, res) {
  if (!needPerm(req, res, 'payments.take')) {
    return;
  }
  lock.withLock('write', function () {
    const body = req.body || {};
    const terminal = terminals.getById(body.terminalId);
    if (!terminal) {
      reject(400, 'Terminal seçin.');
    }
    const countedCash = Number(body.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      reject(400, 'Sayılan nağd düzgün deyil.');
    }
    const openTables = shifts.openTableNames(orders.readOrders().orders, terminal.id);
    if (openTables.length) {
      reject(400, 'Açıq masa var: ' + openTables.join(', ') + '.');
    }
    const store = shifts.readStore();
    const row = shifts.currentFor(store, terminal.id);
    if (!row) {
      reject(404, 'Açıq növbə yoxdur.');
    }
    row.status = 'closed';
    row.closedAt = new Date().toISOString();
    row.closedBy = req.staff.user.id;
    row.closedByName = req.staff.user.name;
    row.countedCash = shifts.money(countedCash);
    row.note = sanitize(body.note, 80);
    const packed = shifts.withExpected(row, orders.readOrders().orders, reservations.readReservations());
    row.snapshot = {
      totals: packed.totals,
      expectedCash: packed.expectedCash,
      difference: packed.difference
    };
    shifts.writeStore(store);
    return { terminalName: terminal.name, packed: packed };
  }).then(function (result) {
    audit(req, 'shift', result.terminalName + ' — növbə bağlandı');
    const packed = result.packed;
    packed.terminalName = result.terminalName;
    packed.branchName = settings.readSettings().branchName || '';
    printers.sendZTickets(packed).then(function (print) {
      res.json({
        success: true,
        data: packed,
        warning: print && print.warning ? print.warning : ''
      });
    }).catch(function () {
      res.json({ success: true, data: packed, warning: 'Z çapı getmədi.' });
    });
  }).catch(function (error) {
    sendFail(res, error);
  });
});

app.post('/api/shifts/print-z', function (req, res) {
  if (!needPerm(req, res, 'payments.take')) {
    return;
  }
  const body = req.body || {};
  const terminal = terminals.getById(body.terminalId);
  if (!terminal) {
    res.status(400).json({ success: false, message: 'Terminal seçin.' });
    return;
  }
  const store = shifts.readStore();
  let row = null;
  if (body.shiftId) {
    row = store.shifts.find(function (item) {
      return item.id === Number(body.shiftId) && item.terminalId === terminal.id;
    });
  } else {
    row = store.shifts.filter(function (item) {
      return item.terminalId === terminal.id && item.status === 'closed';
    }).sort(function (a, b) {
      return String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
    })[0];
  }
  if (!row) {
    res.status(404).json({ success: false, message: 'Bağlanmış növbə yoxdur.' });
    return;
  }
  const packed = shifts.withExpected(row, orders.readOrders().orders, reservations.readReservations());
  packed.terminalName = terminal.name;
  packed.branchName = settings.readSettings().branchName || '';
  printers.sendZTickets(packed).then(function (print) {
    if (print && print.warning && !print.anyOk) {
      res.status(400).json({ success: false, message: print.warning });
      return;
    }
    res.json({ success: true, data: packed, warning: print && print.warning ? print.warning : '' });
  }).catch(function (error) {
    res.status(500).json({ success: false, message: error.message || 'Z çapı getmədi.' });
  });
});

app.post('/api/terminals/claim', function (req, res) {
  try {
    const body = req.body || {};
    const staff = users.canUser(Number(body.waiterId), 'orders.create');
    if (!staff || !staff.ok) {
      res.status(403).json({ success: false, message: staff ? 'Masaya icazəniz yoxdur.' : 'PIN ilə daxil olun.' });
      return;
    }
    const terminal = terminals.getById(body.terminalId);
    if (!terminal) {
      res.status(400).json({ success: false, message: 'Terminal seçin.' });
      return;
    }
    const tableId = Number(body.tableId);
    if (!tableId) {
      res.status(400).json({ success: false, message: 'Masa seçin.' });
      return;
    }
    const open = orders.findOpenForTable(orders.readOrders(), tableId);
    const keepIds = open ? lockIdsOf(open).concat([tableId]) : [];
    const result = terminals.claim(tableId, terminal, staff.user.name, keepIds);
    if (result.error) {
      res.status(409).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: { lock: result.lock, locks: terminals.listLocks() } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/terminals/ping', function (req, res) {
  try {
    const body = req.body || {};
    const result = terminals.touch(body.tableId, body.terminalId);
    if (result.error) {
      res.status(409).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: { locks: terminals.listLocks() } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/terminals/release', function (req, res) {
  try {
    const body = req.body || {};
    if (body.all) {
      terminals.releaseByTerminal(body.terminalId);
    } else {
      terminals.release(body.tableId, body.terminalId);
    }
    res.json({ success: true, data: { locks: terminals.listLocks() } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.get('/api/print-queue', function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['printers.view', 'orders.create', 'kitchen.view', 'payments.take'])) {
      return;
    }
    res.json({ success: true, data: printers.listQueue() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/print-queue/:id/retry', async function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['printers.edit', 'printers.test', 'orders.create', 'payments.take', 'kitchen.done'])) {
      return;
    }
    const result = await printers.retryJob(req.params.id);
    if (result.error) {
      res.status(404).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: result.jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.post('/api/print-queue/flush', async function (req, res) {
  try {
    if (!needAnyPerm(req, res, ['printers.edit', 'printers.test', 'orders.create', 'payments.take', 'kitchen.done'])) {
      return;
    }
    const jobs = await printers.flushQueue();
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
  }
});

app.use(function (req, res) {
  res.status(404).json({ success: false, message: 'Səhifə tapılmadı.' });
});

app.use(function (error, req, res, next) {
  logger.error({
    method: req.method,
    path: req.originalUrl,
    status: 500,
    message: error.message,
    stack: error.stack
  });
  res.status(500).json({ success: false, message: 'Xəta: ' + error.message });
});

process.on('uncaughtException', function (error) {
  logger.error({ message: error.message, stack: error.stack, path: 'uncaughtException' });
});

process.on('unhandledRejection', function (reason) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ message: error.message, stack: error.stack, path: 'unhandledRejection' });
});

const httpServer = http.createServer(app);
httpServer.on('error', function (error) {
  console.log('HTTP açılmadı: ' + error.message);
});
httpServer.listen(PORT, '127.0.0.1', function () {
  backup.ensureDaily();
  setInterval(function () {
    backup.ensureDaily();
  }, 60 * 60 * 1000);
  printers.processQueue();
  setInterval(function () {
    printers.processQueue();
  }, 15 * 1000);
  version.ensure();
  console.log('Arpos Restoran ' + version.current());
  if (db.migrated()) {
    console.log('Baza: SQLite');
  } else {
    console.log('Baza: JSON');
  }
  if (!license.isLicensed()) {
    console.log('Lisenziya: gözləyir. Maşın: ' + license.machineText());
  }
  console.log('Admin: http://127.0.0.1:' + PORT);
  if (LIVE_HOST === '0.0.0.0') {
    try {
      const tls = settings.ensureTls();
      const httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, app);
      httpsServer.on('error', function (error) {
        console.log('TLS açılmadı: ' + error.message);
        console.log('Şəbəkə bağlı qaldı (yalnız http://127.0.0.1:' + PORT + ').');
      });
      httpsServer.listen(tls.port, '0.0.0.0', function () {
        if (tls.generated) {
          console.log('TLS: yeni self-signed sertifikat yazıldı — ' + tls.certPath);
        } else {
          console.log('TLS: mövcud sertifikat — ' + tls.certPath);
        }
        const urls = settings.lanUrls(PORT);
        if (urls.length) {
          console.log('Şəbəkə (HTTPS): ' + urls.join('  '));
        } else {
          console.log('Şəbəkə (HTTPS): https://<bu-komputer-ip>:' + tls.port);
        }
      });
    } catch (error) {
      console.log('TLS açılmadı: ' + error.message);
      console.log('Şəbəkə bağlı qaldı (yalnız http://127.0.0.1:' + PORT + ').');
    }
  } else {
    console.log('Şəbəkə bağlıdır (yalnız bu kompüter).');
  }
  console.log('Məhsullar: http://127.0.0.1:' + PORT + '/products.html');
  console.log('Sifariş: http://127.0.0.1:' + PORT + '/orders.html');
  console.log('Loqlar: ' + path.join(db.dataDir(), 'logs'));
});
