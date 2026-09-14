const assert = require('assert');
const catalog = require('./catalog');
const settings = require('./settings');
const users = require('./users');
const journal = require('./journal');
const stock = require('./stock');
const shifts = require('./shifts');
const orders = require('./orders');
const sms = require('./sms');
const license = require('./license');
const licenseOwner = require('./scripts/license-owner');
const version = require('./version');
const store = require('./store');
const terminals = require('./terminals');
const books = require('./books');
const clock = require('./clock');
const offline = require('./public/offline.js');
const fiscal = require('./fiscal');
const crypto = require('crypto');
const num = require('./num');
const money = require('./public/money.js');
const db = require('./db');
const customers = require('./customers');
const totp = require('./totp');
const backup = require('./backup');
const updater = require('./updater');
const posDom = require('./public/dom.js');
const printers = require('./printers');
const fs = require('fs');
const os = require('os');
const path = require('path');

function test(name, fn) {
  fn();
  console.log('ok  ' + name);
}

function ordersUiBundle() {
  return ['orders-zones.js', 'orders-shift.js', 'orders-pay.js', 'orders-ui.js'].map(function (name) {
    return fs.readFileSync(path.join(__dirname, 'public', name), 'utf8');
  }).join('\n');
}

function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arpos-t-'));
  const prev = process.env.ARPOS_DATA_DIR;
  process.env.ARPOS_DATA_DIR = dir;
  db.close();
  try {
    assert.ok(db.open());
    const mig = db.migrateJson();
    assert.ok(mig.ok, mig.error || 'köçürmə');
    fn();
  } finally {
    db.close();
    if (prev) {
      process.env.ARPOS_DATA_DIR = prev;
    } else {
      delete process.env.ARPOS_DATA_DIR;
    }
  }
}

test('kurs: bar dərhal, mətbəx isti, soyuq seçimi', function () {
  assert.strictEqual(catalog.courseOf({ stationId: 3 }), 0);
  assert.strictEqual(catalog.courseOf({ stationId: 1 }), 2);
  assert.strictEqual(catalog.courseOf({ stationId: 1, course: 1 }), 1);
  assert.strictEqual(catalog.courseOf({ stationId: 3, course: '' }), 0);
  assert.strictEqual(catalog.courseOf({ stationId: 1, course: '' }), 2);
  assert.strictEqual(catalog.courseOf({ stationId: 1, course: 0 }), 0);
});

test('hesab: endirim, xidmət, bonus', function () {
  const parts = settings.billParts(100, 1, {
    serviceChargePercent: 10,
    waiterBonuses: { '1': 5 }
  }, { type: 'percent', value: 10 });
  assert.strictEqual(parts.itemsTotal, 100);
  assert.strictEqual(parts.discountAmount, 10);
  assert.strictEqual(parts.afterDiscount, 90);
  assert.strictEqual(parts.serviceCharge, 9);
  assert.strictEqual(parts.total, 99);
  assert.strictEqual(parts.bonusAmount, 4.5);
});

test('qəpik 0.1+0.2 tələsi yoxdur', function () {
  assert.notStrictEqual(0.1 + 0.2, 0.3);
  assert.strictEqual(num.fromMinor(num.addMinor(num.toMinor(0.1), num.toMinor(0.2))), 0.3);
  assert.strictEqual(settings.money(0.1 + 0.2), 0.3);
});

test('qəpik split 3 pay 10 AZN', function () {
  const total = num.toMinor(10);
  const share = Math.round(total / 3);
  const last = num.subMinor(total, num.addMinor(share, share));
  assert.strictEqual(num.fromMinor(share), 3.33);
  assert.strictEqual(num.fromMinor(last), 3.34);
  assert.strictEqual(num.fromMinor(num.addMinor(num.addMinor(share, share), last)), 10);
});

test('qəpik qismən ödəniş qalığı', function () {
  const due = num.toMinor(10.1);
  const paid = num.toMinor(0.2);
  assert.strictEqual(num.fromMinor(num.subMinor(due, paid)), 9.9);
  const order = {
    items: [{ salePrice: 0.1, qty: 1 }, { salePrice: 0.2, qty: 1 }],
    payments: [{ cashAmount: 0.1, cardAmount: 0, giftAmount: 0 }]
  };
  assert.strictEqual(orders.orderTotal(order), 0.3);
  assert.strictEqual(orders.paidTotal(order), 0.1);
});

function clientBillAfter(order, serviceChargePercent) {
  let itemsM = 0;
  (order.items || []).forEach(function (item) {
    if (!item.voided) {
      itemsM = money.addMinor(itemsM, money.mulQty(money.toMinor(item.salePrice), item.qty));
    }
  });
  const d = order.discount;
  let offM = 0;
  if (d && !d.cleared) {
    if (d.type === 'percent') {
      let pct = money.parseDec(d.value);
      if (!Number.isFinite(pct)) {
        pct = 0;
      }
      pct = Math.min(100, Math.max(0, pct));
      offM = Math.round(itemsM * pct / 100);
    } else {
      offM = Math.min(itemsM, Math.max(0, money.toMinor(d.value != null ? d.value : d.amount)));
    }
  }
  const afterM = Math.max(0, money.subMinor(itemsM, offM));
  const serviceM = Math.round(afterM * (Number(serviceChargePercent) || 0) / 100);
  const tipM = money.toMinor(order.tipAmount);
  return {
    items: money.fromMinor(itemsM),
    off: money.fromMinor(offM),
    after: money.fromMinor(afterM),
    service: money.fromMinor(serviceM),
    tip: money.fromMinor(tipM),
    total: money.fromMinor(money.addMinor(money.addMinor(afterM, serviceM), tipM))
  };
}

function clientPaid(order) {
  let sum = 0;
  (order.payments || []).forEach(function (row) {
    sum = money.addMinor(sum, money.toMinor(row.cashAmount));
    sum = money.addMinor(sum, money.toMinor(row.cardAmount));
    sum = money.addMinor(sum, money.toMinor(row.giftAmount));
  });
  return money.fromMinor(sum);
}

function clientRemaining(order, cfg, prepaid) {
  const parts = clientBillAfter(order, cfg.serviceChargePercent);
  return money.fromMinor(Math.max(0, money.subMinor(
    money.subMinor(money.toMinor(parts.total), money.toMinor(prepaid || 0)),
    money.toMinor(clientPaid(order))
  )));
}

function clientShare(remaining, n) {
  const remM = money.toMinor(remaining);
  let shareM = n === 1 ? remM : Math.round(remM / n);
  if (money.subMinor(remM, shareM) <= 1) {
    shareM = remM;
  }
  return money.fromMinor(shareM);
}

function stickMix(cash, card, due) {
  const dueM = money.toMinor(due);
  let cashM = money.toMinor(cash);
  let cardM = money.toMinor(card);
  const gap = money.subMinor(dueM, money.addMinor(cashM, cardM));
  if (gap !== 0) {
    if (cardM > 0) {
      cardM = money.addMinor(cardM, gap);
    } else {
      cashM = money.addMinor(cashM, gap);
    }
  }
  return { cash: money.fromMinor(cashM), card: money.fromMinor(cardM), gift: 0 };
}

test('client money.js num.js ilə eynidir', function () {
  assert.strictEqual(money.fromMinor(money.addMinor(money.toMinor(0.1), money.toMinor(0.2))), 0.3);
  assert.strictEqual(money.toMinor(0.1), num.toMinor(0.1));
  assert.strictEqual(money.mulQty(money.toMinor(0.1), 2), num.mulQty(num.toMinor(0.1), 2));
});

test('client billAfter = billParts + tip (0.1+0.2, xidmət 18%)', function () {
  const order = {
    items: [{ salePrice: 0.1, qty: 1 }, { salePrice: 0.2, qty: 1 }],
    tipAmount: 1,
    payments: []
  };
  const cfg = { serviceChargePercent: 18, waiterBonuses: {} };
  const serverParts = settings.billParts(orders.orderTotal(order), 1, cfg, order.discount);
  const client = clientBillAfter(order, 18);
  assert.strictEqual(client.items, serverParts.itemsTotal);
  assert.strictEqual(client.service, serverParts.serviceCharge);
  assert.strictEqual(client.tip, 1);
  assert.strictEqual(client.total, num.fromMinor(num.addMinor(num.toMinor(serverParts.total), num.toMinor(1))));
  const remaining = clientRemaining(order, cfg, 0);
  const serverRem = num.fromMinor(Math.max(0, num.subMinor(
    num.addMinor(num.toMinor(serverParts.total), num.toMinor(1)),
    0
  )));
  assert.strictEqual(remaining, serverRem);
  assert.strictEqual(remaining, 1.35);
});

test('client payDue mix və 3 pay payDueM-ə yapışır', function () {
  const remaining = 10.01;
  const share = clientShare(remaining, 3);
  assert.strictEqual(share, 3.34);
  const mix = stickMix(1.11, 2.22, share);
  assert.strictEqual(num.addMinor(num.toMinor(mix.cash), num.toMinor(mix.card)), num.toMinor(share));
  const gift = 0;
  assert.strictEqual(
    num.addMinor(num.addMinor(num.toMinor(mix.cash), num.toMinor(mix.card)), num.toMinor(gift)),
    num.toMinor(share)
  );
});

test('PIN qaydaları', function () {
  assert.strictEqual(users.loginPin('1234'), true);
  assert.strictEqual(users.validPin('1234'), false);
  assert.strictEqual(users.validPin('123456'), true);
  assert.strictEqual(users.forbiddenPin('0000'), true);
});

function withTempPinLock(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arpos-pin-'));
  const prev = process.env.ARPOS_DATA_DIR;
  process.env.ARPOS_DATA_DIR = dir;
  try {
    fn(dir);
  } finally {
    if (prev) {
      process.env.ARPOS_DATA_DIR = prev;
    } else {
      delete process.env.ARPOS_DATA_DIR;
    }
  }
}

test('PIN 5 səhvdən sonra 15 dəqiqə kilid', function () {
  withTempPinLock(function () {
    const ip = '10.0.0.9';
    var i;
    for (i = 0; i < 4; i += 1) {
      assert.strictEqual(users.failPin(ip, '111111'), 0);
    }
    const wait = users.failPin(ip, '111111');
    assert.ok(wait >= 15 * 60 - 1);
    assert.ok(wait <= 15 * 60);
    assert.ok(users.pinWait(ip, '111111') >= 15 * 60 - 1);
  });
});

test('PIN kilidi eksponensial 15-30-60', function () {
  assert.strictEqual(users.lockDurationMs(1), 15 * 60 * 1000);
  assert.strictEqual(users.lockDurationMs(2), 30 * 60 * 1000);
  assert.strictEqual(users.lockDurationMs(3), 60 * 60 * 1000);
  assert.strictEqual(users.lockDurationMs(8), 60 * 60 * 1000);
  withTempPinLock(function (dir) {
    const ip = '10.0.0.10';
    var i;
    for (i = 0; i < 5; i += 1) {
      users.failPin(ip, '222222');
    }
    const lockPath = path.join(dir, 'pin-lock.json');
    const box = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    Object.keys(box.fails).forEach(function (key) {
      box.fails[key].until = Date.now() - 1;
    });
    fs.writeFileSync(lockPath, JSON.stringify(box));
    for (i = 0; i < 4; i += 1) {
      assert.strictEqual(users.failPin(ip, '222222'), 0);
    }
    const wait = users.failPin(ip, '222222');
    assert.ok(wait >= 30 * 60 - 1);
    assert.ok(wait <= 30 * 60);
  });
});

test('doğru PIN-dən sonra sayğac sıfırlanır', function () {
  withTempPinLock(function () {
    const ip = '10.0.0.11';
    var i;
    for (i = 0; i < 3; i += 1) {
      users.failPin(ip, '333333');
    }
    users.clearPinFail(ip, '333333');
    assert.strictEqual(users.pinWait(ip, '333333'), 0);
    for (i = 0; i < 4; i += 1) {
      assert.strictEqual(users.failPin(ip, '333333'), 0);
    }
    assert.ok(users.failPin(ip, '333333') >= 15 * 60 - 1);
  });
});

test('eyni IP-də fərqli PIN 5-də kilidlənir', function () {
  withTempPinLock(function () {
    const ip = '10.0.0.12';
    assert.strictEqual(users.failPin(ip, '111111'), 0);
    assert.strictEqual(users.failPin(ip, '222222'), 0);
    assert.strictEqual(users.failPin(ip, '333333'), 0);
    assert.strictEqual(users.failPin(ip, '444444'), 0);
    const wait = users.failPin(ip, '555555');
    assert.ok(wait >= 15 * 60 - 1);
  });
});

test('oflayn növbə açarı və id dəyişməsi', function () {
  assert.strictEqual(offline.shouldQueue('POST', '/api/orders/accept'), true);
  assert.strictEqual(offline.shouldQueue('POST', '/api/orders/void'), true);
  assert.strictEqual(offline.shouldQueue('GET', '/api/orders'), false);
  assert.strictEqual(offline.isCacheGet('GET', '/api/catalog'), true);
  const list = [{
    url: '/api/orders/pay',
    body: JSON.stringify({ orderId: -9, cashAmount: 4 }),
    tempOrderId: -9
  }];
  const mapped = offline.remapQueue(list, -9, 42);
  assert.strictEqual(JSON.parse(mapped[0].body).orderId, 42);
  const data = offline.applyAccept({ orders: [] }, {
    tableId: 3,
    items: [{ productId: 1, qty: 1, salePrice: 2 }]
  }, -5);
  assert.strictEqual(data.orders[0].id, -5);
  assert.strictEqual(data.orders[0].status, 'open');
});

test('jurnal gün açarı', function () {
  assert.strictEqual(journal.dayKey('2026-09-07'), '2026-09-07');
  assert.strictEqual(journal.dayKey(new Date(2026, 8, 7)), '2026-09-07');
});

test('jurnal yalnız əlavə olunur və pozulma görünür', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arpos-jr-'));
  const prev = process.env.ARPOS_DATA_DIR;
  process.env.ARPOS_DATA_DIR = dir;
  journal.append({ userName: 'Ali', kind: 'login', text: 'Daxil oldu' });
  journal.append({ userName: 'Ali', kind: 'pay', text: 'Ödəniş 10' });
  const key = journal.dayKey(new Date());
  const rows = journal.readDay(key);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].tampered, false);
  assert.strictEqual(rows[1].tampered, false);
  assert.strictEqual(rows[1].text, 'Ödəniş 10');
  const file = path.join(dir, 'journal', key + '.jsonl');
  const raw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, raw.replace('Ödəniş 10', 'Silindi 00'));
  const bad = journal.readDay(key);
  assert.strictEqual(bad[1].tampered, true);
  if (prev) {
    process.env.ARPOS_DATA_DIR = prev;
  } else {
    delete process.env.ARPOS_DATA_DIR;
  }
});

test('porsiya mayası əlavə xammalı sayır', function () {
  const box = {
    items: [
      { id: 1, name: 'Ət', unit: 'kq', buyPrice: 10, qty: 5 },
      { id: 2, name: 'Sous', unit: 'kq', buyPrice: 4, qty: 5 }
    ]
  };
  const product = {
    ingredients: [{ itemId: 1, qty: 0.1, unit: 'kq' }]
  };
  const withMod = stock.lineCost(product, box, {
    modifiers: [{ ingredients: [{ itemId: 2, qty: 0.05, unit: 'kq' }] }]
  });
  assert.strictEqual(withMod, 1.2);
});

test('anbar satış sqlite-də qalığı azaldır', function () {
  withTempDb(function () {
    stock.writeStock({
      nextItemId: 2,
      nextMoveId: 1,
      nextPurchaseId: 1,
      items: [{ id: 1, name: 'Ət', unit: 'kq', buyPrice: 10, qty: 5, minQty: 0 }],
      moves: [],
      purchases: [],
      suppliers: []
    });
    const catalogStore = {
      products: [{ id: 1, ingredients: [{ itemId: 1, qty: 0.2, unit: 'kq' }] }]
    };
    const out = stock.deductLines(catalogStore, [{ productId: 1, qty: 2 }], { orderId: 9 });
    assert.ok(!out.error);
    assert.strictEqual(out.warns.length, 0);
    const after = stock.readStock();
    assert.strictEqual(after.items[0].qty, 4.6);
    assert.strictEqual(after.moves.length, 1);
    assert.strictEqual(after.moves[0].type, 'sale');
  });
});

test('blockSaleIfShort true qısa qalıqda error; false soft', function () {
  withTempDb(function () {
    stock.writeStock({
      nextItemId: 2,
      nextMoveId: 1,
      nextPurchaseId: 1,
      items: [{ id: 1, name: 'Ət', unit: 'kq', buyPrice: 10, qty: 0.1, minQty: 0 }],
      moves: [],
      purchases: [],
      suppliers: []
    });
    const catalogStore = {
      products: [{ id: 1, ingredients: [{ itemId: 1, qty: 0.2, unit: 'kq' }] }]
    };
    settings.writeSettings({ stock: { salesWarehouseId: 1, blockSaleIfShort: true } });
    const blocked = stock.deductLines(catalogStore, [{ productId: 1, qty: 2 }], { orderId: 1 });
    assert.ok(blocked.error);
    assert.ok(blocked.error.indexOf('çatmır') >= 0);
    assert.strictEqual(stock.readStock().items[0].qty, 0.1);
    settings.writeSettings({ stock: { salesWarehouseId: 1, blockSaleIfShort: false } });
    const soft = stock.deductLines(catalogStore, [{ productId: 1, qty: 2 }], { orderId: 1 });
    assert.ok(!soft.error);
    assert.ok(soft.warns.some(function (row) { return row.indexOf('çatmır') >= 0; }));
    assert.strictEqual(stock.readStock().items[0].qty, 0.1);
    assert.strictEqual(stock.readStock().moves.length, 0);
  });
});

test('satış anbarını deaktiv etmək olmaz', function () {
  withTempDb(function () {
    const kitchen = stock.createWarehouse({ name: 'Mətbəx' });
    assert.ok(!kitchen.error);
    const off = stock.updateWarehouse(1, { active: false });
    assert.strictEqual(off.error, 'Satış anbarını bağlamaq olmaz.');
    assert.strictEqual(stock.readStock().warehouses[0].active, true);
  });
});

test('ödəniş unsent mesajı autoSend-ə görə', function () {
  withTempDb(function () {
    settings.writeSettings({ autoSendAllOnAccept: true });
    assert.strictEqual(settings.unsentPayHint(), 'Əvvəlcə sətirləri qəbul edin.');
    settings.writeSettings({ autoSendAllOnAccept: false });
    assert.strictEqual(settings.unsentPayHint(), 'Əvvəlcə isti kursu göndərin.');
  });
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const pay = src.slice(src.indexOf("app.post('/api/orders/pay'"), src.indexOf("app.post('/api/reservations"));
  assert.ok(pay.indexOf('unsentPayHint') >= 0);
});

test('loyalty: 100 AZN → 1 ball; redeem; closed-only hesablama', function () {
  withTempDb(function () {
    const cfg = { enabled: true, earnPer100: 1, pointValueMinor: 1, minRedeem: 1 };
    assert.strictEqual(customers.pointsForPaid(10000, 0, cfg), 1);
    assert.strictEqual(customers.pointsForPaid(9999, 0, cfg), 0);
    assert.strictEqual(customers.pointsFromAmount(0.01, cfg), 1);
    const made = customers.findOrCreate('0501234567', 'Test');
    assert.ok(made.customer);
    customers.adjustPoints(made.customer.id, 10, 'test', 'admin');
    const used = customers.redeemPoints('0501234567', 1, cfg);
    assert.ok(!used.error);
    assert.strictEqual(used.points, 1);
    assert.strictEqual(used.customer.points, 9);
    const earned = customers.earnClosed('0501234567', 10000, 0, cfg);
    assert.strictEqual(earned.earned, 1);
    assert.strictEqual(earned.customer.points, 10);
    const byName = customers.search('Tes');
    assert.strictEqual(byName.length, 1);

    const restored = customers.restoreRedeemed('0501234567', 1);
    assert.strictEqual(restored.points, 1);
    assert.strictEqual(restored.customer.points, 11);
    const revoked = customers.revokeEarned('0501234567', 1);
    assert.strictEqual(revoked.points, 1);
    assert.strictEqual(revoked.customer.points, 10);
    customers.revokeEarned('0501234567', 100);
    const after = customers.findByPhone('0501234567');
    assert.strictEqual(after.customer.points, 0);
    assert.strictEqual(customers.revokeEarned('0501234567', 5).points, 0);
  });
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const pay = src.slice(src.indexOf("app.post('/api/orders/pay'"), src.indexOf("app.post('/api/reservations"));
  assert.ok(pay.indexOf('hədiyyə + ball') >= 0);
  assert.ok(pay.indexOf('earnClosed') >= 0);
  assert.ok(pay.indexOf('gifts.redeem') >= 0);
  assert.ok(pay.indexOf('if (closed)') >= 0);
  const refund = src.slice(src.indexOf("app.post('/api/orders/refund'"), src.indexOf("app.get('/api/shifts'"));
  assert.ok(refund.indexOf('restoreRedeemed') >= 0);
  assert.ok(refund.indexOf('revokeEarned') >= 0);
  assert.ok(refund.indexOf('gifts.restore') >= 0);
  assert.ok(refund.indexOf('loyaltyRestored') >= 0);
  assert.ok(refund.indexOf('TODO') === -1);
  const ui = fs.readFileSync(path.join(__dirname, 'public', 'receipts-ui.js'), 'utf8');
  assert.ok(ui.indexOf('loyaltyRestored') >= 0);
  assert.ok(ui.indexOf('ball qaytarıldı') >= 0);
});

test('loyalty refund: redeem→restore; earn→revoke; ≥0', function () {
  withTempDb(function () {
    const cfg = { enabled: true, earnPer100: 1, pointValueMinor: 1, minRedeem: 1 };
    const a = customers.findOrCreate('0509998877', 'A');
    customers.adjustPoints(a.customer.id, 5, 'seed', 't');
    customers.redeemPoints('0509998877', 3, cfg);
    assert.strictEqual(customers.findByPhone('0509998877').customer.points, 2);
    customers.restoreRedeemed('0509998877', 3);
    assert.strictEqual(customers.findByPhone('0509998877').customer.points, 5);
    customers.earnClosed('0509998877', 20000, 0, cfg);
    assert.strictEqual(customers.findByPhone('0509998877').customer.points, 7);
    const rev = customers.revokeEarned('0509998877', 2);
    assert.strictEqual(rev.points, 2);
    assert.strictEqual(customers.findByPhone('0509998877').customer.points, 5);
    const over = customers.revokeEarned('0509998877', 99);
    assert.strictEqual(over.points, 5);
    assert.strictEqual(over.clamped, true);
    assert.strictEqual(customers.findByPhone('0509998877').customer.points, 0);
  });
});

test('növbə yalnız öz terminalını sayır', function () {
  const at = '2026-09-07T12:00:00';
  const list = [
    { status: 'paid', terminalId: 1, payment: { at: at, cashAmount: 10, cardAmount: 0, prepaid: 0, total: 10 } },
    { status: 'paid', terminalId: 2, payment: { at: at, cashAmount: 40, cardAmount: 0, prepaid: 0, total: 40 } }
  ];
  const one = shifts.totals(list, '2026-09-07T00:00:00', '2026-09-07T23:59:59', 1);
  assert.strictEqual(one.cash, 10);
  assert.strictEqual(one.count, 1);
});

test('masa birləşməsi: linkedTableIds örtür', function () {
  const order = { status: 'open', tableId: 3, linkedTableIds: [8, 9] };
  assert.strictEqual(orders.coversTable(order, 3), true);
  assert.strictEqual(orders.coversTable(order, 8), true);
  assert.strictEqual(orders.coversTable({ status: 'paid', tableId: 3 }, 3), false);
});

test('növbə avtomatik açılır; ikinci dəfə toxunmur; açıq masa close blok', function () {
  withTempDb(function () {
    const store = { nextId: 1, shifts: [] };
    const term = { id: 1, name: 'Kassa 1' };
    const user = { id: 2, name: 'Ali' };
    const first = shifts.maybeAutoOpen(store, term, user, { autoOpenOnSale: true, defaultStartingCash: 0 });
    assert.ok(first.created);
    assert.strictEqual(first.shift.startingCash, 0);
    assert.strictEqual(first.shift.autoOpened, true);
    const second = shifts.maybeAutoOpen(store, term, user, { autoOpenOnSale: true, defaultStartingCash: 0 });
    assert.ok(!second.created);
    assert.strictEqual(second.shift.id, first.shift.id);
    const names = shifts.openTableNames([
      { status: 'open', terminalId: 1, tableName: 'M1' }
    ], 1);
    assert.deepStrictEqual(names, ['M1']);
    assert.strictEqual(shifts.closeBlockMessage([
      { status: 'open', terminalId: 1, tableName: 'M1' }
    ], 1), 'Açıq masa var: M1.');
    assert.strictEqual(shifts.closeBlockMessage([], 1), '');
  });
});

test('növbə avto yalnız pay; false-da yox; accept/fire yox', function () {
  withTempDb(function () {
    assert.strictEqual(settings.readSettings().shift.autoOpenOnSale, true);
  });
  const store = { nextId: 1, shifts: [] };
  const term = { id: 1, name: 'Kassa 1' };
  const off = shifts.maybeAutoOpen(store, term, { id: 1, name: 'Ali' }, { autoOpenOnSale: false });
  assert.strictEqual(off.error, 'Əvvəlcə növbə açın.');
  assert.strictEqual(store.shifts.length, 0);
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  function sliceBetween(from, to) {
    const i = src.indexOf(from);
    const j = src.indexOf(to);
    assert.ok(i >= 0 && j > i, from);
    return src.slice(i, j);
  }
  assert.ok(sliceBetween("app.post('/api/orders/accept'", "app.post('/api/orders/fire'").indexOf('ensureShiftAuto') < 0);
  assert.ok(sliceBetween("app.post('/api/orders/fire'", "app.post('/api/orders/pay'").indexOf('ensureShiftAuto') < 0);
  assert.ok(sliceBetween("app.post('/api/orders/pay'", "app.post('/api/reservations/:id/prepay'").indexOf('ensureShiftAuto') >= 0);
  const prepayAt = src.indexOf("app.post('/api/reservations/:id/prepay'");
  assert.ok(prepayAt >= 0);
  assert.ok(src.slice(prepayAt).indexOf('ensureShiftAuto') >= 0);
});

test('növbə Z bağlama gözlənilən nağd', function () {
  const at = '2026-09-13T10:00:00';
  const row = {
    terminalId: 1,
    startingCash: 0,
    openedAt: '2026-09-13T09:00:00',
    drops: []
  };
  const packed = shifts.withExpected(row, [
    { status: 'paid', terminalId: 1, payment: { at: at, cashAmount: 12, cardAmount: 3, prepaid: 0, total: 15 } }
  ], { reservations: [] });
  assert.strictEqual(packed.expectedCash, 12);
  assert.strictEqual(packed.totals.card, 3);
});

test('növbə nağd çıxarışı gözləniləndən düşür', function () {
  const at = '2026-09-07T12:00:00';
  const row = {
    terminalId: 1,
    startingCash: 50,
    openedAt: '2026-09-07T10:00:00',
    drops: [{ amount: 20 }]
  };
  const list = [
    { status: 'paid', terminalId: 1, payment: { at: at, cashAmount: 30, cardAmount: 0, prepaid: 0, total: 30 } }
  ];
  const packed = shifts.withExpected(row, list, { reservations: [] });
  assert.strictEqual(packed.expectedCash, 60);
});

test('növbə geri nağdı gözləniləndən düşür', function () {
  const at = '2026-09-07T12:00:00';
  const row = {
    terminalId: 1,
    startingCash: 50,
    openedAt: '2026-09-07T10:00:00',
    drops: []
  };
  const list = [
    {
      status: 'refunded',
      terminalId: 1,
      payment: { at: at, cashAmount: 30, cardAmount: 0, prepaid: 0, total: 30 },
      refund: { at: '2026-09-07T13:00:00', cashAmount: 10, cardAmount: 0 }
    }
  ];
  const packed = shifts.withExpected(row, list, { reservations: [] });
  assert.strictEqual(packed.expectedCash, 70);
  assert.strictEqual(packed.totals.refundCash, 10);
});

test('ödənilib hədiyyəni sayır', function () {
  const order = {
    payments: [
      { cashAmount: 4, cardAmount: 0, giftAmount: 6 },
      { cashAmount: 0, cardAmount: 2, giftAmount: 0 }
    ]
  };
  assert.strictEqual(orders.paidTotal(order), 12);
});

test('ödəniş qalığı açıq sətirlə paidTotal-dan ayrıdır', function () {
  const order = {
    items: [
      { id: 1, salePrice: 10, qty: 1 },
      { id: 2, salePrice: 5, qty: 1, settled: true }
    ],
    payments: [{ cashAmount: 3, cardAmount: 0, giftAmount: 0 }]
  };
  assert.strictEqual(orders.openTotal(order), 10);
  assert.strictEqual(orders.orderTotal(order), 15);
  assert.strictEqual(orders.paidTotal(order), 3);
});

test('növbə açıq masanı yalnız öz terminalında görür', function () {
  const list = [
    { status: 'open', terminalId: 1, tableName: 'M1' },
    { status: 'open', terminalId: 2, tableName: 'M2' },
    { status: 'open', tableName: 'Takeaway #1' }
  ];
  assert.deepStrictEqual(shifts.openTableNames(list, 1), ['M1', 'Takeaway #1']);
});

test('növbə hədiyyə satışını sayır', function () {
  const at = '2026-09-07T12:00:00';
  const list = [
    {
      status: 'paid',
      terminalId: 1,
      payment: { at: at, cashAmount: 0, cardAmount: 0, giftAmount: 12, prepaid: 0, total: 12 }
    }
  ];
  const one = shifts.totals(list, '2026-09-07T00:00:00', '2026-09-07T23:59:59', 1);
  assert.strictEqual(one.gift, 12);
  assert.strictEqual(one.total, 12);
});

test('qrafik: boş günlər həmişə olar', function () {
  assert.strictEqual(users.scheduleOk({ schedule: { days: [] } }).ok, true);
  const mondayNine = new Date(2026, 8, 7, 9, 0, 0);
  assert.strictEqual(mondayNine.getDay(), 1);
  assert.strictEqual(users.scheduleOk({
    schedule: { days: [1], from: '08:00', to: '18:00' }
  }, mondayNine).ok, true);
  assert.strictEqual(users.scheduleOk({
    schedule: { days: [1], from: '10:00', to: '18:00' }
  }, mondayNine).ok, false);
  assert.strictEqual(users.scheduleOk({
    schedule: { days: [2], from: '08:00', to: '18:00' }
  }, mondayNine).ok, false);
});

test('happy hour aralıq yoxdursa baza qiymət', function () {
  assert.strictEqual(catalog.salePriceNow({ salePrice: 10, happyPrice: 7 }), 10);
  assert.strictEqual(catalog.salePriceNow({ salePrice: 10, happyPrice: 7, happyFrom: 9, happyTo: 9 }), 10);
});

test('sətir ödənişi yalnız seçilənləri götürür', function () {
  const order = {
    tableId: 3,
    items: [
      { id: 1, salePrice: 10, qty: 1, seatTableId: 3 },
      { id: 2, salePrice: 6, qty: 1, seatTableId: 8, voided: false },
      { id: 3, salePrice: 4, qty: 1, settled: true }
    ]
  };
  const lines = orders.pickPayLines(order, [2], 0);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].id, 2);
  const seat = orders.pickPayLines(order, [], 8);
  assert.strictEqual(seat.length, 1);
  assert.strictEqual(seat[0].id, 2);
  assert.strictEqual(orders.orderTotal(order), 20);
  assert.strictEqual(orders.openTotal(order), 16);
});

test('sms şablon doldurulur', function () {
  assert.strictEqual(sms.fillTpl('Rezerv: {name}, {table}', { name: 'Ali', table: '5' }), 'Rezerv: Ali, 5');
});

test('sifariş kart ölçüsü 1–5 saxlanır', function () {
  const prev = settings.readSettings();
  const saved = settings.writeSettings({ orderCardScale: 4 });
  assert.strictEqual(saved.orderCardScale, 4);
  settings.writeSettings({ orderCardScale: prev.orderCardScale });
});

test('ayarlarda filial və sms sahəsi var', function () {
  const cfg = settings.readSettings();
  assert.strictEqual(typeof cfg.branchName, 'string');
  assert.ok(cfg.sms);
  assert.strictEqual(typeof cfg.sms.reserveText, 'string');
  assert.strictEqual(typeof cfg.vatPercent, 'number');
  assert.strictEqual(typeof cfg.branchCode, 'string');
  assert.ok(cfg.receipt);
  assert.strictEqual(typeof cfg.receipt.title, 'string');
  assert.ok(Array.isArray(cfg.receipt.headerLines));
  assert.ok(Array.isArray(cfg.receipt.footerLines));
});

test('çek brendinqi: boş title → branchName; dolu → ticket/view', function () {
  withTempDb(function () {
    settings.writeSettings({ branchName: 'Kafe Test', receipt: settings.emptyReceipt() });
    assert.strictEqual(settings.receiptTitle(), 'Kafe Test');
    settings.writeSettings({ branchName: '', receipt: settings.emptyReceipt() });
    assert.strictEqual(settings.receiptTitle(), 'Arpos Restoran');
    const filled = settings.writeSettings({
      branchName: 'Kafe Test',
      branchCode: 'M1',
      receipt: {
        title: 'My Cafe',
        address: 'Nizami 1',
        phone: '012',
        headerLines: ['Acigdir 10-22', 'WiFi: cafe', 'extra ignore'],
        footerLines: ['Gelin yeniden', 'Instagram @cafe'],
        showBranchCode: true
      }
    });
    assert.strictEqual(filled.receipt.title, 'My Cafe');
    assert.strictEqual(filled.receipt.headerLines.length, 2);
    assert.strictEqual(filled.receipt.footerLines.length, 2);
    assert.strictEqual(settings.receiptTitle(filled), 'My Cafe');
    const pub = settings.forPos(filled);
    assert.strictEqual(pub.receipt.title, 'My Cafe');
    assert.strictEqual(pub.receipt.showBranchCode, true);
    assert.strictEqual(pub.receipt.hasLogo, false);
    assert.strictEqual(pub.receipt.logoUrl, '');

    const ticket = printers.buildReceiptTicket({ paperWidth: 80, charsPerLine: 48, font: 'A' }, {
      id: 7,
      tableName: 'M1',
      branchCode: 'M1',
      receipt: filled.receipt,
      items: [{ name: 'Cay', qty: 1, salePrice: 2 }],
      payment: {
        itemsTotal: 2,
        serviceCharge: 0,
        total: 2,
        cashAmount: 2,
        cardAmount: 0,
        at: '2026-09-13T12:00:00'
      }
    });
    const text = ticket.toString('ascii');
    assert.ok(text.indexOf('My Cafe') >= 0);
    assert.ok(text.indexOf('Nizami 1') >= 0);
    assert.ok(text.indexOf('Acigdir 10-22') >= 0);
    assert.ok(text.indexOf('Gelin yeniden') >= 0);
    assert.ok(text.indexOf('Filial: M1') >= 0);
    assert.ok(text.indexOf('CEK #7') >= 0);

    const viewSrc = fs.readFileSync(path.join(__dirname, 'public', 'receipt-view.js'), 'utf8');
    assert.ok(viewSrc.indexOf('receiptTitle') >= 0);
    assert.ok(viewSrc.indexOf('headerLines') >= 0);
    assert.ok(viewSrc.indexOf('footerLines') >= 0);
    assert.ok(viewSrc.indexOf('rc-logo') >= 0);
    assert.ok(viewSrc.indexOf('receiptLogoUrl') >= 0);
    const html = fs.readFileSync(path.join(__dirname, 'public', 'settings.html'), 'utf8');
    assert.ok(html.indexOf('data-tab="receipt"') >= 0);
    assert.ok(html.indexOf('id="receipt-title"') >= 0);
    assert.ok(html.indexOf('id="receipt-logo-file"') >= 0);
  });
});

test('çek logo: yüklə/sil; forPos path; data URL yox', function () {
  withTempDb(function () {
    assert.strictEqual(settings.cleanReceiptLogo('data:image/png;base64,aaa'), '');
    assert.strictEqual(settings.cleanReceiptLogo('/uploads/receipt-logo.png'), '/uploads/receipt-logo.png');
    assert.strictEqual(settings.cleanReceiptLogo('/uploads/evil.png'), '');
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const dataUrl = 'data:image/png;base64,' + tinyPng.toString('base64');
    const saved = settings.saveReceiptLogo(dataUrl);
    assert.ok(!saved.error, saved.error);
    assert.strictEqual(saved.path, '/uploads/receipt-logo.png');
    const written = settings.writeSettings({
      receipt: Object.assign({}, settings.emptyReceipt(), { title: 'Logo Cafe', logo: saved.path })
    });
    assert.strictEqual(written.receipt.logo, '/uploads/receipt-logo.png');
    const pub = settings.forPos(written);
    assert.strictEqual(pub.receipt.hasLogo, true);
    assert.strictEqual(pub.receipt.logoUrl, '/uploads/receipt-logo.png');
    assert.ok(String(pub.receipt.logoUrl).indexOf('data:') < 0);
    const abs = path.join(__dirname, 'public', 'uploads', 'receipt-logo.png');
    assert.ok(fs.existsSync(abs));
    settings.removeReceiptLogo();
    assert.strictEqual(settings.readSettings().receipt.logo, '');
    assert.strictEqual(settings.forPos().receipt.hasLogo, false);
    assert.ok(!fs.existsSync(abs));
    const tooBig = 'data:image/png;base64,' + Buffer.alloc(201 * 1024).toString('base64');
    const big = settings.saveReceiptLogo(tooBig);
    assert.ok(big.error);
  });
  const pr = fs.readFileSync(path.join(__dirname, 'printers.js'), 'utf8');
  assert.ok(pr.indexOf('TODO(Faza 1b+): receipt.logo ESC/POS') >= 0);
});

test('qəbulda autoSendAllOnAccept isti kursu göndərir', function () {
  const prev = settings.readSettings();
  settings.writeSettings({ autoSendAllOnAccept: true });
  const firedOn = settings.nextFiredCourse(1);
  assert.strictEqual(firedOn, 2);
  assert.strictEqual(settings.kitchenSendNow(2, firedOn), true);
  settings.writeSettings({ autoSendAllOnAccept: false });
  const firedOff = settings.nextFiredCourse(1);
  assert.strictEqual(firedOff, 1);
  assert.strictEqual(settings.kitchenSendNow(2, firedOff), false);
  assert.strictEqual(settings.kitchenSendNow(2, 2), true);
  settings.writeSettings({ autoSendAllOnAccept: prev.autoSendAllOnAccept !== false });
});

test('filial qiyməti və hesabat filtri', function () {
  assert.strictEqual(settings.matchesBranch({ branchCode: 'M1' }, 'M1'), true);
  assert.strictEqual(settings.matchesBranch({ payment: { branchName: 'A' } }, 'B'), false);
  assert.strictEqual(settings.matchesBranch({ payment: { branchName: 'A' } }, ''), true);
  const prev = settings.readSettings();
  settings.writeSettings({ branchCode: 'M1' });
  assert.strictEqual(catalog.salePriceNow({ salePrice: 10, prices: { M1: 12 } }), 12);
  settings.writeSettings({ branchCode: prev.branchCode || '' });
});

test('lisenziya imzası saxta kodu keçirmir', function () {
  licenseOwner.initKeys();
  const bad = license.decodeToken('ARPOS.v1.abc.def');
  assert.ok(bad.error);
  const made = licenseOwner.issue({ name: 'Test Kafe', machine: license.machineId() });
  assert.ok(made.token);
  const ok = license.decodeToken(made.token);
  assert.strictEqual(ok.data.n, 'Test Kafe');
  assert.strictEqual(ok.data.p, 'ARPOS');
  assert.strictEqual(typeof license.issue, 'undefined');
});

test('boş data faylı xəta vermir', function () {
  const missing = path.join(__dirname, 'data', 'no-such-file-' + Date.now() + '.json');
  const raw = store.readJson(missing);
  assert.deepStrictEqual(raw, {});
});

test('versiya oxunur', function () {
  assert.ok(/^\d+\.\d+\.\d+$/.test(version.current()));
});

test('kəsr nöqtə və vergülü qəbul edir', function () {
  assert.strictEqual(stock.parseDec('1,90'), 1.9);
  assert.strictEqual(stock.parseDec('1.90'), 1.9);
  assert.strictEqual(settings.money('1,90'), 1.9);
});

test('ping kilidsiz masanı yenidən götürür', function () {
  const term = terminals.listAll()[0];
  assert.ok(term);
  const out = terminals.touch(99, term.id);
  assert.ok(out.ok);
  assert.strictEqual(terminals.lockOf(99).terminalId, term.id);
  terminals.release(99, term.id);
});

test('86 yeni gündə sıfırlanır və qalır', function () {
  withTempDb(function () {
    const cat = catalog.readCatalog();
    if (!cat.products.length) {
      cat.products.push({
        id: cat.nextProductId,
        name: '86Test',
        salePrice: 1,
        soldOut: true,
        groupId: 1,
        stationId: 1
      });
      cat.nextProductId += 1;
    } else {
      cat.products[0].soldOut = true;
      cat.products[0].name = '86Test';
    }
    cat.soldOutDay = '2020-01-01';
    db.saveCatalog(cat);
    const again = catalog.readCatalog();
    const p = again.products.find(function (row) { return row.name === '86Test'; });
    assert.ok(p);
    assert.strictEqual(p.soldOut, false);
    assert.notStrictEqual(again.soldOutDay, '2020-01-01');
    const third = catalog.readCatalog();
    assert.strictEqual(third.products.find(function (row) { return row.name === '86Test'; }).soldOut, false);
  });
});

test('az qalıq yalnız min yazılanda', function () {
  const emptyMin = stock.publicItem({ id: 1, name: 'Su', unit: 'l', qty: 0, minQty: 0, buyPrice: 1 });
  const low = stock.publicItem({ id: 2, name: 'Un', unit: 'kq', qty: 0.5, minQty: 2, buyPrice: 1 });
  assert.strictEqual(emptyMin.low, false);
  assert.strictEqual(low.low, true);
});

test('porsiya qiyməti tamdır, ekstra əlavə olunur', function () {
  const product = {
    name: 'Pizza',
    salePrice: 10,
    portions: [{ id: 1, name: 'Orta', price: 5 }],
    extras: [{ id: 2, name: 'Sous', price: 2 }]
  };
  assert.strictEqual(catalog.applyLineChoices(product, { portionId: 1 }).salePrice, 5);
  assert.strictEqual(catalog.applyLineChoices(product, { portionId: '1', extraIds: ['2'] }).salePrice, 7);
  assert.strictEqual(catalog.applyLineChoices({
    name: 'Pizza',
    salePrice: 10,
    portions: [],
    extras: []
  }, {}).salePrice, 10);
});

test('barkod təmizlənir', function () {
  assert.strictEqual(catalog.cleanBarcode(' 12 34! '), '1234');
  assert.strictEqual(catalog.cleanBarcode('AB-12'), 'AB-12');
  assert.strictEqual(catalog.cleanBarcode('x'.repeat(40)).length, 32);
});

test('çatdırılma statusu sıxılır', function () {
  assert.strictEqual(orders.cleanRunStatus('delivery', 'way'), 'way');
  assert.strictEqual(orders.cleanRunStatus('delivery', 'bad'), 'prep');
  assert.strictEqual(orders.cleanRunStatus('takeaway', 'ready'), 'ready');
  assert.strictEqual(orders.cleanRunStatus('takeaway', 'way'), 'prep');
  assert.strictEqual(orders.cleanRunStatus('dine', 'way'), '');
});

test('qəbulda quoted happy hour saxlanır', function () {
  const product = { salePrice: 10, happyPrice: 7, happyFrom: 3, happyTo: 4, portions: [], extras: [] };
  const quoted = catalog.resolveQuotedPrice(product, {}, 7);
  assert.strictEqual(quoted.salePrice, 7);
});

test('mühasib: ödəniş və kassa kitabı', function () {
  const from = new Date('2026-09-10T00:00:00');
  const to = new Date('2026-09-10T23:59:59.999');
  const data = books.build({
    from: from,
    to: to,
    showCost: true,
    showStock: true,
    terminals: [{ id: 1, name: 'Kassa 1' }],
    book: { reservations: [] },
    catalog: { products: [{ id: 1, ingredients: [] }] },
    stock: {
      items: [{ id: 5, name: 'Un', buyPrice: 2, qty: 1 }],
      moves: [{ type: 'out', itemId: 5, qty: 3, note: 'xarab', at: '2026-09-10T11:00:00' }],
      purchases: [{ at: '2026-09-10T09:00:00', total: 40 }]
    },
    shifts: [{
      id: 1,
      terminalId: 1,
      status: 'closed',
      startingCash: 20,
      openedAt: '2026-09-10T10:00:00',
      closedAt: '2026-09-10T22:00:00',
      countedCash: 45,
      drops: [{ amount: 5 }]
    }],
    orders: [{
      status: 'paid',
      terminalId: 1,
      items: [{ productId: 1, qty: 1, salePrice: 30, complimentary: false }],
      payment: {
        at: '2026-09-10T12:00:00',
        method: 'mixed',
        cashAmount: 10,
        cardAmount: 20,
        giftAmount: 0,
        prepaid: 0,
        total: 30,
        discountAmount: 0
      }
    }]
  });
  assert.strictEqual(data.payments.cash, 10);
  assert.strictEqual(data.payments.card, 20);
  assert.strictEqual(data.payments.total, 30);
  assert.strictEqual(data.methods.filter(function (row) { return row.method === 'mixed'; })[0].count, 1);
  assert.strictEqual(data.cashbook.length, 1);
  assert.strictEqual(data.cashbook[0].expected, 25);
  assert.strictEqual(data.cashbook[0].difference, 20);
  assert.strictEqual(data.pnl.waste, 6);
  assert.strictEqual(data.pnl.purchases, 40);
  assert.strictEqual(data.ledger.length, 1);
  assert.strictEqual(data.ledger[0].cash, 10);
  assert.strictEqual(data.ledger[0].waste, 6);
  assert.strictEqual(data.ledger[0].purchases, 40);
  assert.strictEqual(data.ledger[0].drops, 5);
});

test('FIFO köhnə partiyanı əvvəl çıxır', function () {
  const item = { qty: 0, buyPrice: 0, lots: [] };
  stock.fifoAdd(item, 2, 10, 'a');
  stock.fifoAdd(item, 2, 20, 'b');
  assert.strictEqual(stock.fifoConsume(item, 3), 40);
  assert.strictEqual(item.qty, 1);
  assert.strictEqual(stock.fifoAvg(item), 20);
});

test('inventar təsdiq sənəd systemQty istifadə edir; writeOff səbəb saxlanır', function () {
  withTempDb(function () {
    const made = stock.createItem({ name: 'Un', unit: 'kq', buyPrice: 10 });
    assert.ok(!made.error);
    const put = stock.moveStock(made.item.id, 'in', 10, 'alış');
    assert.ok(!put.error);
    const draft = stock.createInventoryDraft('Ali');
    assert.ok(draft.inventory);
    const liveOut = stock.moveStock(made.item.id, 'out', 3, 'satış arası');
    assert.ok(!liveOut.error);
    assert.strictEqual(stock.readStock().items[0].qty, 7);
    const saved = stock.updateInventoryLines(draft.inventory.id, [
      { itemId: made.item.id, countedQty: 8 }
    ]);
    const line = saved.inventory.counts[0];
    assert.strictEqual(line.systemQty, 10);
    assert.strictEqual(line.countedQty, 8);
    const done = stock.confirmInventory(draft.inventory.id, 'Ali');
    assert.ok(!done.error, done.error);
    const after = stock.readStock().items[0];
    assert.strictEqual(after.qty, 5);
    const invMove = stock.readStock().moves.filter(function (row) {
      return row.type === 'inv_minus';
    })[0];
    assert.ok(invMove);
    assert.strictEqual(invMove.qty, 2);
    const replay = stock.inventoryAsOf(stock.readStock(), new Date());
    const un = replay.items.find(function (row) { return row.id === made.item.id; });
    assert.strictEqual(un.qty, 5);
    const off = stock.writeOff(made.item.id, 1, 'spoil', 'test');
    assert.ok(!off.error);
    const zay = stock.readStock().moves.filter(function (row) {
      return row.reasonCode === 'spoil';
    })[0];
    assert.ok(zay);
    assert.strictEqual(zay.type, 'out');
    assert.ok(String(zay.note).indexOf('xarab') === 0);
  });
});

test('inventoryAsOf inv_plus fifoAvg', function () {
  const inv = stock.inventoryAsOf({
    items: [{ id: 1, name: 'Un', unit: 'kq', buyPrice: 4, qty: 0, lots: [] }],
    purchases: [],
    moves: [
      { id: 1, itemId: 1, type: 'in', qty: 2, buyPrice: 10, at: '2026-09-01T10:00:00' },
      { id: 2, itemId: 1, type: 'inv_plus', qty: 2, buyPrice: 10, at: '2026-09-02T10:00:00' },
      { id: 3, itemId: 1, type: 'inv_minus', qty: 1, at: '2026-09-03T10:00:00' }
    ]
  }, new Date('2026-09-03T23:59:59'));
  assert.strictEqual(inv.items[0].qty, 3);
  assert.strictEqual(inv.total, 30);
});

test('istehsal 2 raw → 1 semi; çatışmazlıq 400; nested/özünə yox', function () {
  withTempDb(function () {
    const a = stock.createItem({ name: 'Un', unit: 'kq', buyPrice: 4 });
    const b = stock.createItem({ name: 'Su', unit: 'kq', buyPrice: 1 });
    assert.ok(!a.error && !b.error);
    stock.moveStock(a.item.id, 'in', 10, '');
    stock.moveStock(b.item.id, 'in', 10, '');
    const dough = stock.createItem({
      name: 'Xəmir',
      unit: 'kq',
      kind: 'semi',
      recipe: [
        { itemId: a.item.id, qty: 0.5, unit: 'kq' },
        { itemId: b.item.id, qty: 0.2, unit: 'kq' }
      ]
    });
    assert.ok(!dough.error, dough.error);
    const self = stock.updateItem(dough.item.id, {
      name: 'Xəmir',
      unit: 'kq',
      kind: 'semi',
      recipe: [{ itemId: dough.item.id, qty: 1, unit: 'kq' }]
    });
    assert.ok(self.error);
    const nested = stock.createItem({
      name: 'Doldurma',
      unit: 'kq',
      kind: 'semi',
      recipe: [{ itemId: dough.item.id, qty: 1, unit: 'kq' }]
    });
    assert.ok(nested.error);
    const dry = stock.createProductionDraft({
      outputItemId: dough.item.id,
      outputQty: 1000,
      lossPct: 0
    }, 'Ali');
    assert.ok(!dry.error);
    const lack = stock.confirmProduction(dry.production.id, 'Ali');
    assert.ok(lack.error);
    const okDraft = stock.createProductionDraft({
      outputItemId: dough.item.id,
      outputQty: 2,
      lossPct: 0
    }, 'Ali');
    const done = stock.confirmProduction(okDraft.production.id, 'Ali');
    assert.ok(!done.error, done.error);
    const box = stock.readStock();
    const flour = box.items.find(function (row) { return row.id === a.item.id; });
    const water = box.items.find(function (row) { return row.id === b.item.id; });
    const out = box.items.find(function (row) { return row.id === dough.item.id; });
    assert.strictEqual(flour.qty, 9);
    assert.strictEqual(water.qty, 9.6);
    assert.strictEqual(out.qty, 2);
    assert.ok(stock.fifoAvg(out) > 0);
    assert.strictEqual(box.moves.filter(function (row) { return row.type === 'prod_use'; }).length, 2);
    assert.strictEqual(box.moves.filter(function (row) { return row.type === 'prod_in'; }).length, 1);
    const replay = stock.inventoryAsOf(box, new Date());
    const dRow = replay.items.find(function (row) { return row.id === out.id; });
    assert.strictEqual(dRow.qty, 2);
    assert.ok(dRow.value > 0);
  });
});

test('multi-sklad: lots warehouseId=1; köçürmə A→B; istehsal from/to; inventar sklada görə', function () {
  withTempDb(function () {
    const made = stock.createItem({ name: 'Un', unit: 'kq', buyPrice: 10 });
    assert.ok(!made.error);
    stock.moveStock(made.item.id, 'in', 10, 'alış');
    const box0 = stock.readStock();
    assert.ok(box0.warehouses.some(function (row) { return row.id === 1 && row.name === 'Əsas'; }));
    const lot0 = box0.items[0].lots[0];
    assert.strictEqual(lot0.warehouseId, 1);
    const kitchen = stock.createWarehouse({ name: 'Mətbəx' });
    assert.ok(!kitchen.error);
    const kid = kitchen.warehouse.id;
    const xDraft = stock.createTransferDraft({
      fromId: 1,
      toId: kid,
      lines: [{ itemId: made.item.id, qty: 4 }]
    }, 'Ali');
    assert.ok(!xDraft.error);
    const xDone = stock.confirmTransfer(xDraft.transfer.id, 'Ali');
    assert.ok(!xDone.error, xDone.error);
    const afterX = stock.readStock().items[0];
    assert.strictEqual(stock.qtyAt(afterX, 1), 6);
    assert.strictEqual(stock.qtyAt(afterX, kid), 4);
    assert.strictEqual(afterX.qty, 10);
    const xMoves = stock.readStock().moves.filter(function (row) {
      return row.type === 'xfer_out' || row.type === 'xfer_in';
    });
    assert.strictEqual(xMoves.length, 2);
    assert.strictEqual(xMoves[0].buyPrice, 10);

    const water = stock.createItem({ name: 'Su', unit: 'kq', buyPrice: 1 });
    stock.moveStock(water.item.id, 'in', 10, '', 1);
    const dough = stock.createItem({
      name: 'Xəmir',
      unit: 'kq',
      kind: 'semi',
      recipe: [
        { itemId: made.item.id, qty: 1, unit: 'kq' },
        { itemId: water.item.id, qty: 0.5, unit: 'kq' }
      ]
    });
    assert.ok(!dough.error, dough.error);
    const lack = stock.createProductionDraft({
      outputItemId: dough.item.id,
      outputQty: 1,
      fromWarehouseId: kid,
      toWarehouseId: kid
    }, 'Ali');
    assert.ok(!lack.error);
    const lackDone = stock.confirmProduction(lack.production.id, 'Ali');
    assert.ok(lackDone.error);
    const okProd = stock.createProductionDraft({
      outputItemId: dough.item.id,
      outputQty: 1,
      fromWarehouseId: 1,
      toWarehouseId: kid
    }, 'Ali');
    const prodDone = stock.confirmProduction(okProd.production.id, 'Ali');
    assert.ok(!prodDone.error, prodDone.error);
    const box1 = stock.readStock();
    const flour = box1.items.find(function (row) { return row.id === made.item.id; });
    const semi = box1.items.find(function (row) { return row.id === dough.item.id; });
    assert.strictEqual(stock.qtyAt(flour, 1), 5);
    assert.strictEqual(stock.qtyAt(flour, kid), 4);
    assert.strictEqual(stock.qtyAt(semi, kid), 1);
    assert.strictEqual(stock.qtyAt(semi, 1), 0);

    const invDraft = stock.createInventoryDraft('Ali', kid);
    const flourLine = invDraft.inventory.counts.find(function (row) { return row.itemId === made.item.id; });
    assert.strictEqual(flourLine.systemQty, 4);
    stock.updateInventoryLines(invDraft.inventory.id, [{ itemId: made.item.id, countedQty: 3 }]);
    const invDone = stock.confirmInventory(invDraft.inventory.id, 'Ali');
    assert.ok(!invDone.error, invDone.error);
    const flour2 = stock.readStock().items.find(function (row) { return row.id === made.item.id; });
    assert.strictEqual(stock.qtyAt(flour2, kid), 3);
    assert.strictEqual(stock.qtyAt(flour2, 1), 5);

    const replay = stock.inventoryAsOf(stock.readStock(), new Date());
    const replayFlour = replay.items.find(function (row) { return row.id === made.item.id; });
    assert.strictEqual(replayFlour.qty, 8);
  });
});

test('inventoryAsOf prod_use/prod_in', function () {
  const inv = stock.inventoryAsOf({
    items: [
      { id: 1, name: 'Un', unit: 'kq', buyPrice: 4, qty: 0, lots: [] },
      { id: 2, name: 'Xəmir', unit: 'kq', buyPrice: 0, qty: 0, lots: [] }
    ],
    purchases: [],
    moves: [
      { id: 1, itemId: 1, type: 'in', qty: 5, buyPrice: 4, at: '2026-09-01T10:00:00' },
      { id: 2, itemId: 1, type: 'prod_use', qty: 2, at: '2026-09-02T10:00:00' },
      { id: 3, itemId: 2, type: 'prod_in', qty: 1, buyPrice: 8, at: '2026-09-02T10:00:00' }
    ]
  }, new Date('2026-09-02T23:59:59'));
  const flour = inv.items.find(function (row) { return row.id === 1; });
  const doughRow = inv.items.find(function (row) { return row.id === 2; });
  assert.strictEqual(flour.qty, 3);
  assert.strictEqual(doughRow.qty, 1);
  assert.strictEqual(doughRow.value, 8);
});

test('kreditor köhnə alışları ödənilib sayır', function () {
  const cred = stock.creditorsAsOf([
    { at: '2026-09-01T10:00:00', supplier: 'Market', total: 50 },
    { at: '2026-09-02T10:00:00', supplier: 'Market', total: 30, credit: true },
    {
      at: '2026-09-03T10:00:00',
      supplier: 'Market',
      total: 20,
      payments: [{ at: '2026-09-04T10:00:00', amount: 5 }]
    }
  ], new Date('2026-09-10T23:59:59'));
  assert.strictEqual(cred.due, 45);
  assert.strictEqual(cred.suppliers[0].count, 2);
});

test('təchizatçı siyahısı sətir qalır', function () {
  withTempDb(function () {
    stock.writeStock({
      nextItemId: 2,
      nextMoveId: 1,
      nextPurchaseId: 1,
      items: [{ id: 1, name: 'Un', unit: 'kq', qty: 0, minQty: 0, buyPrice: 1, lots: [] }],
      moves: [],
      purchases: [],
      suppliers: [{ name: 'Market' }, 'Market', '  Bazar  ']
    });
    const names = stock.readStock().suppliers.slice().sort();
    assert.deepStrictEqual(names, ['Bazar', 'Market']);
    names.forEach(function (n) {
      assert.strictEqual(typeof n, 'string');
    });
    const first = stock.addPurchase({
      supplier: 'Market',
      lines: [{ itemId: 1, qty: 1, buyPrice: 2 }]
    }, 'test');
    assert.ok(!first.error, first.error);
    const again = stock.addPurchase({
      supplier: 'market',
      lines: [{ itemId: 1, qty: 1, buyPrice: 2 }]
    }, 'test');
    assert.ok(!again.error, again.error);
    const after = stock.readStock().suppliers.filter(function (n) {
      return String(n).toLowerCase() === 'market';
    });
    assert.strictEqual(after.length, 1);
  });
});

test('açıq borc alış siyahısından düşmür', function () {
  const box = {
    purchases: [{ id: 1, at: '2026-01-01T10:00:00', supplier: 'Kohne', total: 15, credit: true }]
  };
  var i;
  for (i = 2; i <= 41; i += 1) {
    box.purchases.push({
      id: i,
      at: '2026-02-01T10:00:00',
      supplier: 'Yeni',
      total: 1,
      paidAmount: 1
    });
  }
  const list = stock.listPurchasesForApi(box);
  const old = list.filter(function (row) { return row.id === 1; })[0];
  assert.ok(old);
  assert.ok(old.due > 0);
});

test('inventar tarixə FIFO dəyəri', function () {
  const inv = stock.inventoryAsOf({
    items: [{ id: 1, name: 'Un', unit: 'kq', buyPrice: 0, qty: 0, lots: [] }],
    purchases: [{ id: 1, lines: [{ itemId: 1, buyPrice: 10 }] }],
    moves: [
      { id: 1, itemId: 1, type: 'in', qty: 5, purchaseId: 1, at: '2026-09-01T10:00:00' },
      { id: 2, itemId: 1, type: 'sale', qty: 2, at: '2026-09-02T10:00:00' }
    ]
  }, new Date('2026-09-02T23:59:59'));
  assert.strictEqual(inv.items[0].qty, 3);
  assert.strictEqual(inv.total, 30);
});

test('əməkhaqqı saat × tarif', function () {
  const rows = clock.payroll(
    [{ id: 1, name: 'Ali', hourlyWage: 10 }],
    new Date('2026-09-10T00:00:00'),
    new Date('2026-09-10T23:59:59'),
    [{ userId: 1, inAt: '2026-09-10T08:00:00', outAt: '2026-09-10T12:00:00' }]
  );
  assert.strictEqual(rows[0].hours, 4);
  assert.strictEqual(rows[0].amount, 40);
});

test('mühasib ƏDV satışdan çıxır', function () {
  const data = books.build({
    from: new Date('2026-09-10T00:00:00'),
    to: new Date('2026-09-10T23:59:59.999'),
    vatPercent: 18,
    showCost: false,
    showStock: false,
    terminals: [],
    book: { reservations: [] },
    catalog: { products: [] },
    stock: { items: [], moves: [], purchases: [] },
    shifts: [],
    orders: [{
      status: 'paid',
      terminalId: 1,
      items: [{ productId: 1, qty: 1, salePrice: 30 }],
      payment: {
        at: '2026-09-10T12:00:00',
        method: 'cash',
        cashAmount: 30,
        cardAmount: 0,
        giftAmount: 0,
        prepaid: 0,
        total: 30
      }
    }]
  });
  assert.strictEqual(data.pnl.vat, 4.58);
});

test('sqlite canlı sifariş müddəti', function () {
  assert.strictEqual(db.isLiveOrder({ status: 'open' }), true);
  assert.strictEqual(db.isLiveOrder({
    status: 'paid',
    updatedAt: '2010-01-01T00:00:00.000Z'
  }), false);
});

test('sqlite json köçürür və ödəniş qalır', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arpos-db-'));
  const prev = process.env.ARPOS_DATA_DIR;
  process.env.ARPOS_DATA_DIR = dir;
  db.close();
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'orders.json'), JSON.stringify({
    nextOrderId: 2,
    nextItemId: 2,
    orders: [{
      id: 1,
      status: 'paid',
      tableId: 1,
      tableName: 'A',
      channel: 'dine',
      createdAt: now,
      updatedAt: now,
      items: [{ id: 1, productId: 9, name: 'Çay', qty: 1, salePrice: 2 }],
      payments: [{ cashAmount: 2, cardAmount: 0, giftAmount: 0, total: 2, method: 'cash', at: now }],
      payment: { total: 2, cashAmount: 2, at: now, method: 'cash' }
    }]
  }));
  fs.writeFileSync(path.join(dir, 'stock.json'), JSON.stringify({
    nextItemId: 2, nextMoveId: 1, nextPurchaseId: 1,
    items: [{ id: 1, name: 'Çay yarpağı', unit: 'kq', qty: 3, minQty: 0, buyPrice: 4 }],
    moves: [], purchases: [], suppliers: []
  }));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({
    nextGroupId: 1, nextProductId: 2, nextStationId: 4,
    products: [{ id: 1, name: 'Çay', salePrice: 2, groupId: 1 }],
    groups: [{ id: 1, name: 'İçki' }],
    stations: [{ id: 1, name: 'Bar' }]
  }));
  assert.strictEqual(db.open(), true);
  const mig = db.migrateJson();
  assert.ok(mig.ok, mig.error || 'köçürmə');
  const all = db.loadAllOrders();
  assert.strictEqual(all.orders.length, 1);
  assert.strictEqual(all.orders[0].items[0].name, 'Çay');
  assert.strictEqual(all.orders[0].payments[0].total, 2);
  const st = db.loadStock();
  assert.strictEqual(st.items[0].name, 'Çay yarpağı');
  const cat = db.loadCatalog();
  assert.strictEqual(cat.products[0].name, 'Çay');
  all.orders[0].payment.total = 2;
  db.saveLiveOrders({ nextOrderId: 3, nextItemId: 3, orders: all.orders });
  const again = db.loadAllOrders();
  assert.strictEqual(again.orders[0].payments[0].cashAmount, 2);
  db.close();
  if (prev) {
    process.env.ARPOS_DATA_DIR = prev;
  } else {
    delete process.env.ARPOS_DATA_DIR;
  }
});

test('sqlite ofis json köçürür', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arpos-off-'));
  const prev = process.env.ARPOS_DATA_DIR;
  process.env.ARPOS_DATA_DIR = dir;
  db.close();
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({
    nextUserId: 3,
    nextRoleId: 8,
    roles: [{ id: 1, name: 'Admin', permissions: ['reports.view'] }],
    users: [{ id: 2, name: 'OfisTest', roleId: 1, active: true }]
  }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ vatPercent: 18, branchName: 'Filial A' }));
  fs.writeFileSync(path.join(dir, 'shifts.json'), JSON.stringify({
    nextId: 2,
    shifts: [{ id: 1, terminalId: 1, status: 'open', openedAt: '2026-09-10T10:00:00', startingCash: 20 }]
  }));
  fs.writeFileSync(path.join(dir, 'terminals.json'), JSON.stringify({
    nextId: 2,
    terminals: [{ id: 1, name: 'Kassa X', active: true }]
  }));
  assert.strictEqual(db.open(), true);
  const mig = db.migrateJson();
  assert.ok(mig.ok, mig.error || 'köçürmə');
  assert.ok(db.officeReady());
  assert.strictEqual(fs.existsSync(path.join(dir, 'users.json')), false);
  assert.strictEqual(users.readStore().users[0].name, 'OfisTest');
  assert.strictEqual(settings.readSettings().vatPercent, 18);
  assert.strictEqual(settings.readSettings().branchName, 'Filial A');
  settings.writeSettings({ vatPercent: 7 });
  assert.strictEqual(settings.readSettings().vatPercent, 7);
  assert.strictEqual(terminals.listAll()[0].name, 'Kassa X');
  assert.strictEqual(shifts.readStore().shifts[0].startingCash, 20);
  db.close();
  if (prev) {
    process.env.ARPOS_DATA_DIR = prev;
  } else {
    delete process.env.ARPOS_DATA_DIR;
  }
});

test('totp və istifadəçi kilidi', function () {
  assert.strictEqual(totp.totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
  const secret = totp.makeSecret();
  const code = totp.totpAt(secret, Date.now());
  assert.strictEqual(code.length, 6);
  assert.strictEqual(totp.verify(secret, code), true);
  withTempDb(function () {
    const store = users.readStore();
    const user = store.users[0];
    const started = users.startTotp(user);
    const okCode = totp.totpAt(started.secret, Date.now());
    assert.strictEqual(users.confirmTotp(user, okCode), true);
    assert.strictEqual(user.totpEnabled, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(users.publicUser(user), 'totpSecret'));
    user.locked = true;
    users.writeStore(store);
    assert.strictEqual(users.findStaff(user.id), null);
    settings.writeSettings({ tillLocked: true });
    assert.strictEqual(settings.readSettings().tillLocked, true);
  });
});

test('əməkhaqqı açıq punch-u 16 saatdan çox saymır', function () {
  const inAt = new Date(Date.now() - 48 * 3600000).toISOString();
  const hours = clock.clipHours(
    inAt,
    '',
    new Date(Date.now() - 72 * 3600000),
    new Date()
  );
  assert.ok(hours <= 16.01);
  assert.ok(hours >= 15.9);
});

test('oflayn saat növbəsi iki toxunuşu saxlayır', function () {
  const a = offline.queueKeyOf('/api/clock', '{}');
  const b = offline.queueKeyOf('/api/clock', '{}');
  assert.notStrictEqual(a, b);
  assert.ok(String(a).indexOf('clock:') === 0);
});

test('alış ödənişi növbə nağdından düşür', function () {
  const store = {
    shifts: [{
      terminalId: 1,
      status: 'open',
      startingCash: 100,
      openedAt: '2026-09-10T10:00:00',
      drops: []
    }]
  };
  const row = shifts.addCashDrop(store, 1, 25, 'Təchizatçı ödənişi', { id: 2, name: 'Ali' });
  assert.ok(row);
  assert.strictEqual(row.drops[0].amount, 25);
  const packed = shifts.withExpected(row, [], { reservations: [] });
  assert.strictEqual(packed.expectedCash, 75);
});

test('GitHub ehtiyat sessiya faylını buraxır', function () {
  assert.strictEqual(backup.githubSkip('session.key'), true);
  assert.strictEqual(backup.githubSkip('sessions.json'), true);
  assert.strictEqual(backup.githubSkip('pin-lock.json'), true);
  assert.strictEqual(backup.githubSkip('clock.json'), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arpos-gh-'));
  const src = path.join(dir, 'src');
  const dest = path.join(dir, 'dest');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'session.key'), 'secret');
  fs.writeFileSync(path.join(src, 'clock.json'), '{}');
  backup.copyGithubTree(src, dest);
  assert.strictEqual(fs.existsSync(path.join(dest, 'session.key')), false);
  assert.strictEqual(fs.existsSync(path.join(dest, 'clock.json')), true);
});

test('HTML qaçışı etiket işlətmir', function () {
  assert.strictEqual(
    posDom.escapeHtml('<img onerror=alert(1)>'),
    '&lt;img onerror=alert(1)&gt;'
  );
  assert.strictEqual(posDom.escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  assert.strictEqual(posDom.escapeHtml("a'b\"c"), 'a&#39;b&quot;c');
  assert.strictEqual(typeof posDom.el, 'function');
  assert.strictEqual(typeof posDom.setText, 'function');
  assert.strictEqual(typeof posDom.setVal, 'function');
});

test('yeniləmə checksum və təsdiq', function () {
  const hex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const map = updater.parseChecksums(hex + '  ArposRestoran-Setup.exe\n');
  assert.strictEqual(updater.expectedHashFor('ArposRestoran-Setup.exe', map), hex);
  const bodyMap = updater.parseChecksums('SHA256 ArposRestoran-Setup.exe ' + hex);
  assert.strictEqual(updater.expectedHashFor('ArposRestoran-Setup.exe', bodyMap), hex);
  assert.strictEqual(updater.hashMatches(hex, hex.toUpperCase()), true);
  assert.strictEqual(updater.hashMatches(hex, hex.replace(/a/g, 'b')), false);
  assert.strictEqual(updater.isConfirmed({}), false);
  assert.strictEqual(updater.isConfirmed({ confirm: true }), true);
  assert.strictEqual(updater.shouldSendGithubAuth('https://api.github.com/repos/a/b/releases/assets/1'), true);
  assert.strictEqual(updater.shouldSendGithubAuth('https://github.com/a/b/releases/download/v1/ArposRestoran-Setup.exe'), true);
  assert.strictEqual(updater.shouldSendGithubAuth('https://objects.githubusercontent.com/github-production-release-asset-2e65be/file'), false);
  assert.strictEqual(updater.shouldSendGithubAuth('https://release-assets.githubusercontent.com/file'), false);
});

test('fiskal provider siyahısı və wizarpos imza', function () {
  assert.deepStrictEqual(fiscal.providers.IDS, ['none', 'wizarpos', 'omnitech', 'azsmart']);
  const dt = '20260101120000';
  const nonce = 'n1';
  const key = 'key1';
  const expect = crypto.createHash('sha256').update(dt + nonce + key).digest('hex');
  assert.strictEqual(fiscal.providers.wizarpos.sign(dt, nonce, key), expect);
});

test('azsmart qəpik map', function () {
  assert.strictEqual(fiscal.providers.azsmart.toCents(1.35), 135);
  assert.strictEqual(fiscal.providers.azsmart.toCents(0.1 + 0.2), 30);
  assert.strictEqual(fiscal.providers.azsmart.vatMap(18).taxCode, 4);
  assert.strictEqual(fiscal.providers.azsmart.vatMap(0).taxCode, 6);
});

test('none və emulator satış; HTTP yoxdur', function () {
  withTempDb(function () {
    settings.writeSettings({
      ekassa: { provider: 'none', voen: '1234567890', objectName: 'Kafe' }
    });
    const noneJob = fiscal.enqueue({ id: 1, tableName: 'A', items: [] }, { total: 2 });
    assert.strictEqual(noneJob.status, 'ready');
    assert.ok(noneJob.message.indexOf('Vergiyə getmədi') >= 0);
    assert.strictEqual(JSON.stringify(noneJob).indexOf('apiKey'), -1);

    settings.writeSettings({
      ekassa: {
        provider: 'wizarpos',
        emulator: true,
        voen: '1234567890',
        objectName: 'Kafe',
        wizarpos: { host: '10.0.0.9', port: 9876, apiKey: 'secret-key' }
      }
    });
    const pub = settings.forPos();
    assert.strictEqual(JSON.stringify(pub).indexOf('secret-key'), -1);
    const http = require('http');
    const orig = http.request;
    let hit = 0;
    http.request = function () {
      hit += 1;
      throw new Error('HTTP olmaz');
    };
    try {
      const job = fiscal.enqueue({
        id: 9,
        tableName: 'M1',
        items: [{ name: 'Çay', qty: 1, salePrice: 1.35 }]
      }, { total: 1.35, cashAmount: 1.35 });
      assert.strictEqual(hit, 0);
      assert.strictEqual(job.status, 'sent');
      assert.ok(String(job.fiscalId).indexOf('emu-') === 0);
      assert.ok(job.message.indexOf('Vergiyə getmədi') >= 0);
    } finally {
      http.request = orig;
    }
  });
});

test('çatdırılma stub webhook və secret', function () {
  withTempDb(function () {
    const delivery = require('./delivery');
    const cat = catalog.readCatalog();
    cat.groups = [{ id: 1, name: 'İçki' }];
    cat.nextGroupId = 2;
    cat.products = [{
      id: 1,
      groupId: 1,
      stationId: 3,
      name: 'Çay',
      salePrice: 2,
      barcode: '12345',
      blocked: false,
      soldOut: false
    }];
    cat.nextProductId = 2;
    catalog.writeCatalog(cat);
    settings.writeSettings({
      opsMode: 'sales',
      delivery: { provider: 'wolt', autoPrintKitchen: false, webhookSecret: 's3cret-key' }
    });
    const pub = settings.forPos();
    assert.strictEqual(JSON.stringify(pub).indexOf('s3cret-key'), -1);
    assert.strictEqual(pub.delivery.provider, 'wolt');
    const bad = delivery.handleWebhook('wolt', 'wrong', { items: [{ name: 'Çay', qty: 1 }] });
    assert.strictEqual(bad.status, 401);
    assert.ok(JSON.stringify(bad).indexOf('s3cret-key') === -1);
    const good = delivery.handleWebhook('wolt', 's3cret-key', delivery.providers.types.sampleDraft('wolt'));
    assert.strictEqual(good.status, 201);
    assert.ok(good.body.success);
    const order = orders.readOrders().orders.find(function (row) {
      return row.id === good.body.data.orderId;
    });
    assert.ok(order);
    assert.strictEqual(order.channel, 'delivery');
    assert.strictEqual(order.runStatus, 'prep');
    const tea = order.items.find(function (row) { return row.productId === 1; });
    assert.ok(tea);
    const miss = order.items.find(function (row) { return !row.productId; });
    assert.ok(miss);
    assert.ok(String(miss.note).indexOf('Kataloqda yox') >= 0);
    const sample = delivery.sampleOrder();
    assert.strictEqual(sample.ok, true);
    settings.writeSettings({
      opsMode: 'sales',
      delivery: { provider: 'manual', webhookSecret: 's3cret-key' }
    });
    const blocked = delivery.handleWebhook('wolt', 's3cret-key', delivery.providers.types.sampleDraft('wolt'));
    assert.strictEqual(blocked.status, 400);
  });
});

test('forPos secret sızdırmır; POS sahələri qalır', function () {
  withTempDb(function () {
    settings.writeSettings({
      autoSendAllOnAccept: true,
      shift: { autoOpenOnSale: true, defaultStartingCash: 0 },
      stock: { salesWarehouseId: 1 },
      sms: {
        enabled: true,
        login: 'sms-user',
        password: 'sms-secret',
        sender: 'ARPOS',
        url: 'https://sms.example/send'
      },
      update: { repo: 'Araz19712409/ARPOS-Restoran', token: 'ghp_update_secret' },
      backupGithub: { repo: 'org/priv', token: 'ghp_backup_secret' },
      ekassa: {
        provider: 'wizarpos',
        emulator: true,
        wizarpos: { apiKey: 'ek-api-key' }
      },
      delivery: { provider: 'manual', webhookSecret: 'del-secret' }
    });
    const pub = settings.forPos();
    const dump = JSON.stringify(pub);
    ['sms-secret', 'sms-user', 'ghp_update_secret', 'ghp_backup_secret', 'ek-api-key', 'del-secret'].forEach(function (secret) {
      assert.strictEqual(dump.indexOf(secret), -1, secret);
    });
    function assertNoSecretKeys(obj) {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      Object.keys(obj).forEach(function (key) {
        assert.ok(key !== 'password' && key !== 'token' && key !== 'apiKey', key);
        assertNoSecretKeys(obj[key]);
      });
    }
    assertNoSecretKeys(pub);
    assert.ok(!pub.update);
    assert.ok(!pub.backupGithub);
    assert.ok(!pub.backupFolder);
    assert.ok(pub.listenLan === undefined);
    assert.strictEqual(pub.autoSendAllOnAccept, true);
    assert.strictEqual(pub.shift.autoOpenOnSale, true);
    assert.strictEqual(pub.shift.autoPrintZ, true);
    assert.strictEqual(pub.stock.salesWarehouseId, 1);
    assert.strictEqual(pub.stock.blockSaleIfShort, true);
    assert.deepStrictEqual(Object.keys(pub.stock).sort(), ['blockSaleIfShort', 'salesWarehouseId']);
    assert.deepStrictEqual(Object.keys(pub.loyalty).sort(), ['earnPer100', 'enabled', 'minRedeem', 'pointValueMinor']);
    assert.strictEqual(pub.loyalty.enabled, false);
    assert.ok(pub.receipt);
    assert.strictEqual(typeof pub.receipt.title, 'string');
    assert.ok(pub.pay);
    assert.strictEqual(pub.pay.simpleMode, true);
    assert.strictEqual(pub.pay.nextTableAfterClose, true);
    assert.strictEqual(pub.sms.enabled, true);
    assert.strictEqual(pub.sms.sender, 'ARPOS');
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const ordersGet = src.slice(src.indexOf("app.get('/api/orders'"), src.indexOf("app.get('/api/settings'"));
    assert.ok(ordersGet.indexOf('settings.forPos()') >= 0);
  });
});

test('GET settings: forOffice sirrsiz; settings.view tələb', function () {
  withTempDb(function () {
    settings.writeSettings({
      sms: {
        enabled: true,
        login: 'sms-user',
        password: 'sms-secret',
        sender: 'ARPOS',
        url: 'https://sms.example/send'
      },
      update: { repo: 'Araz19712409/ARPOS-Restoran', token: 'ghp_update_secret' },
      backupGithub: { repo: 'org/priv', token: 'ghp_backup_secret' },
      ekassa: {
        provider: 'wizarpos',
        emulator: true,
        wizarpos: { apiKey: 'ek-api-key' },
        omnitech: { password: 'om-pass' }
      },
      delivery: { provider: 'manual', webhookSecret: 'del-secret' }
    });
    const office = settings.forOffice();
    const dump = JSON.stringify(office);
    ['sms-secret', 'ghp_update_secret', 'ghp_backup_secret', 'ek-api-key', 'om-pass', 'del-secret'].forEach(function (secret) {
      assert.strictEqual(dump.indexOf(secret), -1, secret);
    });
    function assertNoSecretKeys(obj) {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      Object.keys(obj).forEach(function (key) {
        assert.ok(['password', 'token', 'apiKey', 'webhookSecret', 'secret'].indexOf(key) < 0, key);
        assertNoSecretKeys(obj[key]);
      });
    }
    assertNoSecretKeys(office);
    assert.strictEqual(office.sms.login, 'sms-user');
    assert.strictEqual(office.sms.hasPassword, true);
    assert.strictEqual(office.update.hasToken, true);
    assert.strictEqual(office.delivery.hasWebhookSecret, true);
    const store = users.readStore();
    const waiter = store.roles.find(function (row) { return row.id === 3; });
    const admin = store.roles.find(function (row) { return row.id === 1; });
    const onlyUsers = { permissions: ['users.view'] };
    assert.ok(waiter);
    assert.ok(!users.hasPermission(waiter, 'settings.view'));
    assert.ok(users.hasPermission(onlyUsers, 'users.view'));
    assert.ok(!users.hasPermission(onlyUsers, 'settings.view'));
    assert.ok(users.hasPermission(admin, 'settings.view'));
  });
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const getSet = src.slice(src.indexOf("app.get('/api/settings'"), src.indexOf("app.put('/api/settings'"));
  assert.ok(getSet.indexOf("needPerm(req, res, 'settings.view')") >= 0);
  assert.ok(getSet.indexOf('users.view') < 0);
  assert.ok(getSet.indexOf('forOffice()') >= 0);
  assert.ok(getSet.indexOf('readSettings()') < 0);
});

test('Z loyalty sətiri + snapshot reprint', function () {
  const at = '2026-09-13T12:00:00';
  const list = [{
    status: 'paid',
    terminalId: 1,
    payment: { at: at, cashAmount: 10, cardAmount: 0, prepaid: 0, total: 40, loyaltyAmount: 30 }
  }];
  const tot = shifts.totals(list, '2026-09-13T00:00:00', '2026-09-13T23:59:59', 1);
  assert.strictEqual(tot.loyalty, 30);
  assert.strictEqual(tot.cash, 10);
  assert.strictEqual(tot.total, 40);
  const ticket = printers.buildZTicket({ paperWidth: 80, charsPerLine: 48, font: 'A' }, {
    shift: { openedAt: at, closedAt: at, closedByName: 'Ali', startingCash: 0, countedCash: 10, drops: [] },
    totals: tot,
    drops: [],
    expectedCash: 10,
    difference: 0,
    terminalName: 'K1'
  });
  const text = ticket.toString('ascii');
  assert.ok(text.indexOf('Ball') >= 0);
  assert.ok(text.indexOf('30.00') >= 0);
  const zero = printers.buildZTicket({ paperWidth: 80, charsPerLine: 48, font: 'A' }, {
    shift: { openedAt: at, closedAt: at, startingCash: 0, countedCash: 10, drops: [] },
    totals: { count: 1, total: 10, cash: 10, card: 0, gift: 0, loyalty: 0, prepaid: 0, refundCash: 0, refundCard: 0 },
    drops: [],
    expectedCash: 10,
    difference: 0
  }).toString('ascii');
  assert.ok(zero.indexOf('Ball') < 0);

  const closed = {
    status: 'closed',
    terminalId: 1,
    openedAt: '2026-09-13T09:00:00',
    closedAt: '2026-09-13T22:00:00',
    startingCash: 0,
    countedCash: 10,
    drops: [{ amount: 2, note: 'old' }],
    snapshot: {
      totals: { count: 1, total: 40, cash: 10, card: 0, gift: 0, loyalty: 30, prepaid: 0, refundCash: 0, refundCard: 0 },
      expectedCash: 8,
      difference: 2,
      drops: [{ amount: 2, note: 'snap' }]
    }
  };
  const later = [{
    status: 'paid',
    terminalId: 1,
    payment: { at: at, cashAmount: 99, cardAmount: 0, prepaid: 0, total: 99, loyaltyAmount: 0 }
  }];
  const fromSnap = shifts.packedForPrint(closed, later, { reservations: [] });
  assert.strictEqual(fromSnap.totals.loyalty, 30);
  assert.strictEqual(fromSnap.totals.cash, 10);
  assert.strictEqual(fromSnap.expectedCash, 8);
  assert.strictEqual(fromSnap.drops[0].note, 'snap');
  const legacy = {
    status: 'closed',
    terminalId: 1,
    openedAt: '2026-09-13T09:00:00',
    closedAt: '2026-09-13T22:00:00',
    startingCash: 0,
    drops: []
  };
  const fb = shifts.packedForPrint(legacy, list, { reservations: [] });
  assert.strictEqual(fb.totals.loyalty, 30);
  assert.strictEqual(fb.totals.cash, 10);
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const close = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/shifts/close'"),
    serverSrc.indexOf("app.post('/api/shifts/print-z'")
  );
  assert.ok(close.indexOf('snapshot') >= 0);
  assert.ok(close.indexOf('drops') >= 0);
  const printZ = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/shifts/print-z'"),
    serverSrc.indexOf("app.post('/api/terminals/claim'")
  );
  assert.ok(printZ.indexOf('packedForPrint') >= 0);
  const zView = fs.readFileSync(path.join(__dirname, 'public', 'shift-z-view.js'), 'utf8');
  assert.ok(zView.indexOf('z-sum-loyalty') >= 0);
  assert.ok(fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8').indexOf('id="z-sum-loyalty"') >= 0);
});

test('Z 1.2.49: çekmece yox; tarixdə il; tip; logo settings.edit', function () {
  const at = '2026-09-13T12:00:00';
  const list = [{
    status: 'paid',
    terminalId: 1,
    payment: { at: at, cashAmount: 10, cardAmount: 0, prepaid: 0, total: 15, tipAmount: 5 }
  }];
  const tot = shifts.totals(list, '2026-09-13T00:00:00', '2026-09-13T23:59:59', 1);
  assert.strictEqual(tot.tip, 5);
  assert.strictEqual(tot.cash, 10);
  assert.strictEqual(tot.total, 15);
  const ticket = printers.buildZTicket({ paperWidth: 80, charsPerLine: 48, font: 'A' }, {
    shift: { openedAt: at, closedAt: at, closedByName: 'Ali', startingCash: 0, countedCash: 10, drops: [] },
    totals: tot,
    drops: [],
    expectedCash: 10,
    difference: 0,
    terminalName: 'K1'
  });
  const text = ticket.toString('ascii');
  assert.ok(text.indexOf('Tip') >= 0);
  assert.ok(text.indexOf('5.00') >= 0);
  assert.ok(text.indexOf('2026') >= 0);
  assert.ok(ticket.indexOf(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])) < 0);
  const cashRcpt = printers.buildReceiptTicket({ paperWidth: 80, charsPerLine: 48, font: 'A', openDrawer: true }, {
    id: 1,
    tableName: 'M1',
    items: [{ name: 'Cay', qty: 1, salePrice: 10 }],
    payment: { itemsTotal: 10, serviceCharge: 0, total: 10, cashAmount: 10, cardAmount: 0, at: at }
  });
  assert.ok(cashRcpt.indexOf(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])) >= 0);
  const zeroTip = printers.buildZTicket({ paperWidth: 80, charsPerLine: 48, font: 'A' }, {
    shift: { openedAt: at, closedAt: at, startingCash: 0, countedCash: 10, drops: [] },
    totals: { count: 1, total: 10, cash: 10, card: 0, gift: 0, loyalty: 0, tip: 0, prepaid: 0, refundCash: 0, refundCard: 0 },
    drops: [],
    expectedCash: 10,
    difference: 0
  }).toString('ascii');
  assert.ok(zeroTip.indexOf('Tip') < 0);
  const zView = fs.readFileSync(path.join(__dirname, 'public', 'shift-z-view.js'), 'utf8');
  assert.ok(zView.indexOf('z-sum-tip') >= 0);
  assert.ok(fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8').indexOf('id="z-sum-tip"') >= 0);
  assert.ok(fs.readFileSync(path.join(__dirname, 'public', 'shift.html'), 'utf8').indexOf('id="z-sum-tip"') >= 0);

  withTempDb(function () {
    const store = users.readStore();
    store.nextRoleId = Math.max(Number(store.nextRoleId) || 1, 80);
    store.nextUserId = Math.max(Number(store.nextUserId) || 1, 80);
    store.roles.push({ id: 80, name: 'UsersOnly', permissions: ['users.edit'] });
    store.users.push({
      id: 80,
      name: 'UsersEdit',
      roleId: 80,
      active: true,
      pinSalt: 'x',
      pinHash: 'y'
    });
    users.writeStore(store);
    const staff = users.canUser(80, 'settings.edit');
    assert.ok(staff && !staff.ok);
    assert.ok(users.hasPermission({ permissions: ['users.edit'] }, 'users.edit'));
    assert.ok(!users.hasPermission({ permissions: ['users.edit'] }, 'settings.edit'));
  });
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const postLogo = src.slice(
    src.indexOf("app.post('/api/settings/receipt-logo'"),
    src.indexOf("app.delete('/api/settings/receipt-logo'")
  );
  const delLogo = src.slice(
    src.indexOf("app.delete('/api/settings/receipt-logo'"),
    src.indexOf("app.put('/api/prefs'")
  );
  assert.ok(postLogo.indexOf("settings.edit") >= 0);
  assert.ok(postLogo.indexOf('users.edit') < 0);
  assert.ok(delLogo.indexOf("settings.edit") >= 0);
  assert.ok(delLogo.indexOf('users.edit') < 0);
  const pr = fs.readFileSync(path.join(__dirname, 'printers.js'), 'utf8');
  const zFn = pr.slice(pr.indexOf('function buildZTicket'), pr.indexOf('async function deliverZ'));
  assert.ok(zFn.indexOf('openDrawer: false') >= 0);
  assert.ok(zFn.indexOf('openDrawer: true') < 0);
  assert.ok(pr.indexOf('getFullYear()') >= 0);
});

test('katalog maya strip; void/endirim payments blok', function () {
  const raw = {
    id: 7,
    groupId: 1,
    name: 'Dolma',
    salePrice: 12,
    stationId: 1,
    image: '/uploads/products/p-7.png',
    blocked: false,
    soldOut: false,
    barcode: '123',
    allergens: '',
    happyPrice: 10,
    happyFrom: 12,
    happyTo: 15,
    comboIds: [2],
    course: 2,
    prices: { M1: 11 },
    buyPrice: 4.5,
    costPrice: 4.5,
    ingredients: [{ itemId: 1, qty: 0.2, unit: 'kq' }],
    portions: [{ id: 1, name: 'Tam', price: 12, ingredients: [{ itemId: 1, qty: 0.2, unit: 'kq' }] }],
    extras: [{ id: 1, name: 'Sous', price: 1, ingredients: [{ itemId: 2, qty: 0.01, unit: 'kq' }] }]
  };
  const pub = catalog.publicProduct(raw);
  const dump = JSON.stringify(pub);
  assert.ok(dump.indexOf('buyPrice') < 0);
  assert.ok(dump.indexOf('costPrice') < 0);
  assert.ok(dump.indexOf('ingredients') < 0);
  assert.strictEqual(pub.salePrice, 12);
  assert.strictEqual(pub.name, 'Dolma');
  assert.strictEqual(pub.portions[0].name, 'Tam');
  assert.strictEqual(pub.portions[0].price, 12);
  assert.ok(!('ingredients' in pub.portions[0]));
  const now = catalog.salePriceNow(raw);
  assert.ok(Number.isFinite(now));

  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const sendFn = src.slice(src.indexOf('function sendCatalog'), src.indexOf("app.get('/api/catalog'"));
  assert.ok(sendFn.indexOf('publicProduct') >= 0);
  assert.ok(sendFn.indexOf('nowPrice') >= 0);
  assert.ok(sendFn.indexOf('sold:') >= 0 || sendFn.indexOf('sold: ') >= 0);
  const getCat = src.slice(src.indexOf("app.get('/api/catalog'"), src.indexOf("app.get('/api/catalog/manage'"));
  assert.ok(getCat.indexOf('sendCatalog') >= 0);
  const manage = src.slice(src.indexOf("app.get('/api/catalog/manage'"), src.indexOf("app.get('/api/catalog/prices'"));
  assert.ok(manage.indexOf("products.edit") >= 0);

  const voidFn = src.slice(src.indexOf("app.post('/api/orders/void'"), src.indexOf("app.post('/api/orders/reprint'"));
  assert.ok(voidFn.indexOf('order.payments') >= 0);
  assert.ok(voidFn.indexOf('Ödəniş başlayıb. Sətiri ləğv etmək olmaz.') >= 0);
  const discFn = src.slice(src.indexOf("app.post('/api/orders/discount'"), src.indexOf("app.post('/api/orders/discount/clear'"));
  assert.ok(discFn.indexOf('order.payments') >= 0);
  assert.ok(discFn.indexOf('Ödəniş başlayıb. Endirim dəyişməz.') >= 0);
  const clearFn = src.slice(src.indexOf("app.post('/api/orders/discount/clear'"), src.indexOf("app.post('/api/orders/move'"));
  assert.ok(clearFn.indexOf('Ödəniş başlayıb. Endirim dəyişməz.') >= 0);

  const ui = fs.readFileSync(path.join(__dirname, 'public', 'orders-ui.js'), 'utf8');
  assert.ok(ui.indexOf("can('orders.void') && !(order.payments && order.payments.length)") >= 0);
  assert.ok(ui.indexOf("can('orders.discount') && !(order.payments && order.payments.length)") >= 0);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  assert.ok(html.indexOf('orders-ui.js?v=34') >= 0);
  const prodJs = fs.readFileSync(path.join(__dirname, 'public', 'products.js'), 'utf8');
  assert.ok(prodJs.indexOf('/api/catalog/manage') >= 0);
});

test('orders-pay.js null-safe split/due/cash', function () {
  const pay = fs.readFileSync(path.join(__dirname, 'public', 'orders-pay.js'), 'utf8');
  assert.ok(pay.indexOf('function node(') >= 0);
  assert.ok(pay.indexOf('function valOf(') >= 0);
  assert.ok(pay.indexOf("node('pay-split')") >= 0 || pay.indexOf("valOf('pay-split')") >= 0);
  assert.ok(pay.indexOf("setDisabled('pay-split-minus'") >= 0);
  assert.ok(pay.indexOf("setText('pay-due-amt'") >= 0);
  assert.ok(pay.indexOf("document.getElementById('pay-split').value") < 0);
  assert.ok(pay.indexOf("document.getElementById('pay-cash-amt').value") < 0);
  assert.ok(pay.indexOf("document.getElementById('pay-due-amt').textContent") < 0);
});

test('pulsuz: Endirim yox → accept 403; kataloq 0 OK; pending gizlə; comp', function () {
  withTempDb(function () {
    const store = users.readStore();
    const waiterRole = store.roles.find(function (row) { return row.id === 3; });
    const cashierRole = store.roles.find(function (row) { return row.id === 4; });
    const managerRole = store.roles.find(function (row) { return row.id === 2; });
    const adminRole = store.roles.find(function (row) { return row.id === 1; });
    assert.ok(waiterRole.permissions.indexOf('orders.discount') < 0);
    assert.ok(cashierRole.permissions.indexOf('orders.discount') < 0);
    assert.ok(managerRole.permissions.indexOf('orders.discount') >= 0);
    assert.ok(adminRole.permissions.indexOf('orders.discount') >= 0);
    store.nextUserId = Math.max(Number(store.nextUserId) || 1, 100);
    store.users.push({
      id: 99,
      name: 'OfisTest',
      roleId: 3,
      active: true,
      pinSalt: 'x',
      pinHash: 'y'
    });
    store.users.push({
      id: 98,
      name: 'MgrTest',
      roleId: 2,
      active: true,
      pinSalt: 'x',
      pinHash: 'y'
    });
    users.writeStore(store);
    assert.ok(users.canUser(99, 'orders.discount') && !users.canUser(99, 'orders.discount').ok);
    assert.ok(users.canUser(99, 'orders.create') && users.canUser(99, 'orders.create').ok);
    assert.ok(users.canUser(98, 'orders.discount') && users.canUser(98, 'orders.discount').ok);

    function wantsFree(complimentary, lineSale, chosenSale) {
      return !!complimentary || (Number(lineSale) === 0 && Number(chosenSale) > 0);
    }
    assert.ok(wantsFree(true, 10, 10));
    assert.ok(wantsFree(false, 0, 12));
    assert.ok(!wantsFree(false, 0, 0));
    assert.ok(!wantsFree(false, 12, 12));
    assert.ok(wantsFree(true, 0, 0));
    const noDisc = !users.hasPermission(waiterRole, 'orders.discount');
    assert.ok(noDisc && wantsFree(true, 0, 10));
    assert.ok(noDisc && !wantsFree(false, 0, 0));
  });

  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const accept = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/orders/accept'"),
    serverSrc.indexOf("app.post('/api/orders/fire'")
  );
  assert.ok(accept.indexOf("orders.discount") >= 0);
  assert.ok(accept.indexOf('Pulsuz sətirə icazəniz yoxdur.') >= 0);
  assert.ok(accept.indexOf('Number(line.salePrice) === 0 && Number(chosen.salePrice) > 0') >= 0);
  assert.ok(accept.indexOf('wantsFree') >= 0);
  const discIdx = accept.indexOf("orders.discount");
  const comboIdx = accept.indexOf('comboOf');
  assert.ok(comboIdx > discIdx);
  const childBlock = accept.slice(accept.indexOf('(product.comboIds || [])'), comboIdx + 40);
  assert.ok(childBlock.indexOf('complimentary: true') >= 0);
  assert.ok(childBlock.indexOf('orders.discount') < 0);

  const routes = [
    ["app.post('/api/orders/void'", 'orders.void'],
    ["app.post('/api/orders/comp'", 'orders.discount'],
    ["app.post('/api/orders/discount'", 'orders.discount'],
    ["app.post('/api/orders/pay'", 'payments.take'],
    ["app.post('/api/orders/refund'", 'payments.refund'],
    ["app.post('/api/orders/fire'", 'orders.create'],
    ["app.post('/api/orders/merge'", 'orders.create'],
    ["app.post('/api/orders/handoff'", 'orders.create'],
    ["app.post('/api/orders/accept'", 'orders.create']
  ];
  routes.forEach(function (row) {
    const start = serverSrc.indexOf(row[0]);
    assert.ok(start >= 0, row[0]);
    const chunk = serverSrc.slice(start, start + 500);
    assert.ok(chunk.indexOf("'" + row[1] + "'") >= 0 || chunk.indexOf('"' + row[1] + '"') >= 0, row[0] + ' ' + row[1]);
  });
  assert.ok(serverSrc.indexOf("app.post('/api/shifts/close'") >= 0);
  const shiftClose = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/shifts/close'"),
    serverSrc.indexOf("app.post('/api/shifts/close'") + 120
  );
  assert.ok(shiftClose.indexOf('payments.take') >= 0);

  const compStart = serverSrc.indexOf("app.post('/api/orders/comp'");
  const compEnd = serverSrc.indexOf("app.post('/api/orders/", compStart + 10);
  const comp = serverSrc.slice(compStart, compEnd > compStart ? compEnd : compStart + 900);
  assert.ok(comp.indexOf("orders.discount") >= 0);
  assert.ok(comp.indexOf('Pulsuz sətirə icazəniz yoxdur.') >= 0);

  const ui = fs.readFileSync(path.join(__dirname, 'public', 'orders-ui.js'), 'utf8');
  const pendingStart = ui.indexOf('pending.forEach');
  const pendingEnd = ui.indexOf('order = openOrder()', pendingStart);
  const pending = ui.slice(pendingStart, pendingEnd);
  assert.ok(pending.indexOf("can('orders.discount')") >= 0);
  assert.ok(pending.indexOf("data-act', 'comp'") >= 0);
  assert.ok(pending.indexOf('data-act="comp">Pulsuz') < 0);
  assert.ok(ui.indexOf("can('orders.create')") >= 0);
  assert.ok(fs.existsSync(path.join(__dirname, 'PERMISSIONS.md')));
});

test('kassir UX: simpleMode default; pay-open accept axını; dock CSS', function () {
  withTempDb(function () {
    const cfg = settings.readSettings();
    assert.ok(cfg.pay);
    assert.strictEqual(cfg.pay.simpleMode, true);
    assert.strictEqual(cfg.pay.nextTableAfterClose, true);
    const off = settings.writeSettings({ pay: { simpleMode: false } });
    assert.strictEqual(off.pay.simpleMode, false);
    assert.strictEqual(off.pay.nextTableAfterClose, true);
    const pub = settings.forPos(off);
    assert.strictEqual(pub.pay.simpleMode, false);
    assert.strictEqual(pub.pay.nextTableAfterClose, true);
    const nextOff = settings.writeSettings({ pay: { simpleMode: true, nextTableAfterClose: false } });
    assert.strictEqual(nextOff.pay.nextTableAfterClose, false);
    assert.strictEqual(settings.forPos().pay.nextTableAfterClose, false);
    const back = settings.writeSettings({ pay: { simpleMode: true, nextTableAfterClose: true } });
    assert.strictEqual(back.pay.simpleMode, true);
    assert.strictEqual(back.pay.nextTableAfterClose, true);
    assert.strictEqual(settings.forPos().pay.simpleMode, true);
    assert.strictEqual(settings.forPos().pay.nextTableAfterClose, true);
  });
  const ui = ordersUiBundle();
  assert.ok(ui.indexOf("askYes('Qəbul + ödəniş'") >= 0 || ui.indexOf('Qəbul + ödəniş') >= 0);
  assert.ok(ui.indexOf('postAccept') >= 0);
  assert.ok(ui.indexOf('applyPaySimpleMode') >= 0);
  assert.ok(ui.indexOf('function postAccept') >= 0);
  assert.ok(ui.indexOf('function goNextTable') >= 0);
  assert.ok(ui.indexOf('function nextTableAfterCloseOn') >= 0);
  assert.ok(ui.indexOf("setOrderZone('floor')") >= 0);
  assert.ok(ui.indexOf('wantNext') >= 0);
  const payOpen = ui.slice(ui.indexOf("on('pay-open'"), ui.indexOf("on('prepay-open'"));
  assert.ok(payOpen.indexOf('pending.length') >= 0);
  assert.ok(payOpen.indexOf('postAccept') >= 0);
  assert.ok(payOpen.indexOf('openPay()') >= 0);
  const css = fs.readFileSync(path.join(__dirname, 'public', 'orders.css'), 'utf8');
  assert.ok(css.indexOf('z-index: 25') >= 0);
  assert.ok(css.indexOf('position: fixed') >= 0);
  assert.ok(css.indexOf('receipt-next-actions') >= 0);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'settings.html'), 'utf8');
  assert.ok(html.indexOf('id="pay-simple-mode"') >= 0);
  assert.ok(html.indexOf('id="pay-next-table"') >= 0);
  const ordersHtml = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  assert.ok(ordersHtml.indexOf('id="receipt-next"') >= 0);
  assert.ok(ordersHtml.indexOf('id="post-pay-strip"') >= 0);
});

test('çek paneli: sec-actions main-dən əvvəl; premium kart', function () {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  const foot = html.slice(html.indexOf('class="check-foot"'), html.indexOf('id="option-modal"'));
  const sumAt = foot.indexOf('check-sum-box');
  const hintAt = foot.indexOf('id="check-hint"');
  const msgAt = foot.indexOf('id="message"');
  const secAt = foot.indexOf('class="sec-actions"');
  const mainAt = foot.indexOf('class="main-actions"');
  const moreAt = foot.indexOf('id="check-more"');
  assert.ok(sumAt >= 0 && hintAt > sumAt && msgAt > hintAt && secAt > msgAt && mainAt > secAt && moreAt > mainAt);
  assert.ok(foot.indexOf('id="reprint-order"') >= 0);
  assert.ok(foot.indexOf('id="discount-open"') >= 0);
  assert.ok(foot.indexOf('id="pay-open"') >= 0);
  assert.ok(foot.indexOf('id="accept-order"') >= 0);
  assert.ok(html.indexOf('orders.css?v=26') >= 0);
  const css = fs.readFileSync(path.join(__dirname, 'public', 'orders.css'), 'utf8');
  assert.ok(css.indexOf('#check-total') >= 0);
  assert.ok(css.indexOf('.check-sum-box') >= 0 && css.indexOf('border-radius: 10px') >= 0);
  const sec = css.slice(css.indexOf('.sec-actions {'), css.indexOf('.sec-actions button'));
  assert.ok(sec.indexOf('border-top') >= 0);
  assert.ok(sec.indexOf('margin: 8px 0 10px') >= 0);
  assert.ok(css.indexOf('.check-foot-notes') >= 0);
  assert.ok(css.indexOf('[data-zone="floor"] .sec-actions') >= 0 || css.indexOf('.sec-actions') >= 0);
});

test('kassa qalığı ayar; Z counted növbəti startingCash', function () {
  withTempDb(function () {
    const def = settings.readSettings().shift;
    assert.strictEqual(def.showCashOnOrders, true);
    assert.strictEqual(def.carryCountedCash, true);
    settings.writeSettings({
      shift: { showCashOnOrders: false, carryCountedCash: false, defaultStartingCash: 20 }
    });
    const pub = settings.forPos();
    assert.strictEqual(pub.shift.showCashOnOrders, false);
    assert.strictEqual(pub.shift.carryCountedCash, false);
    assert.strictEqual(pub.shift.defaultStartingCash, 20);
    assert.strictEqual(settings.forOffice().shift.showCashOnOrders, false);
    assert.strictEqual(settings.forOffice().shift.carryCountedCash, false);
  });
  const term = { id: 1, name: 'K1' };
  const user = { id: 1, name: 'Ali' };
  const store = { nextId: 1, shifts: [] };
  const first = shifts.maybeAutoOpen(store, term, user, {
    autoOpenOnSale: true, defaultStartingCash: 40, carryCountedCash: true
  });
  assert.ok(first.created);
  assert.strictEqual(first.shift.startingCash, 40);
  first.shift.status = 'closed';
  first.shift.closedAt = '2026-09-14T22:00:00';
  first.shift.countedCash = 150;
  const second = shifts.maybeAutoOpen(store, term, user, {
    autoOpenOnSale: true, defaultStartingCash: 40, carryCountedCash: true
  });
  assert.ok(second.created);
  assert.strictEqual(second.shift.startingCash, 150);
  const store2 = {
    nextId: 2,
    shifts: [{
      id: 1, terminalId: 1, status: 'closed', closedAt: '2026-09-14T22:00:00', countedCash: 150
    }]
  };
  const noCarry = shifts.maybeAutoOpen(store2, term, user, {
    autoOpenOnSale: true, defaultStartingCash: 40, carryCountedCash: false
  });
  assert.strictEqual(noCarry.shift.startingCash, 40);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  assert.ok(html.indexOf('id="shift-cash"') >= 0);
  assert.ok(html.indexOf('orders-shift.js?v=3') >= 0);
  const shiftJs = fs.readFileSync(path.join(__dirname, 'public', 'orders-shift.js'), 'utf8');
  assert.ok(shiftJs.indexOf('showCashOnOrders') >= 0);
  assert.ok(shiftJs.indexOf('expectedCash') >= 0);
  const setHtml = fs.readFileSync(path.join(__dirname, 'public', 'settings.html'), 'utf8');
  assert.ok(setHtml.indexOf('id="shift-show-cash"') >= 0);
  assert.ok(setHtml.indexOf('id="shift-carry-counted"') >= 0);
  const setUi = fs.readFileSync(path.join(__dirname, 'public', 'settings-ui.js'), 'utf8');
  assert.ok(setUi.indexOf('showCashOnOrders') >= 0);
  assert.ok(setUi.indexOf('carryCountedCash') >= 0);
});

test('PWA ofisiant: manifest mode=waiter; waiter-mode hook', function () {
  const manPath = path.join(__dirname, 'public', 'manifest.webmanifest');
  assert.ok(fs.existsSync(manPath));
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  assert.strictEqual(man.start_url, '/orders.html?mode=waiter');
  assert.strictEqual(man.display, 'standalone');
  assert.strictEqual(man.short_name, 'Arpos');
  assert.ok(fs.existsSync(path.join(__dirname, 'public', 'icons', 'icon-192.png')));
  assert.ok(fs.existsSync(path.join(__dirname, 'public', 'icons', 'icon-512.png')));
  const png = fs.readFileSync(path.join(__dirname, 'public', 'icons', 'icon-192.png'));
  assert.strictEqual(png[0], 0x89);
  assert.strictEqual(png[1], 0x50);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  assert.ok(html.indexOf('rel="manifest"') >= 0);
  assert.ok(html.indexOf('arpos-mode') >= 0);
  assert.ok(html.indexOf('waiter-mode') >= 0);
  assert.ok(html.indexOf('apple-mobile-web-app-capable') >= 0);
  assert.ok(html.indexOf('orders-ui.js?v=34') >= 0);
  const css = fs.readFileSync(path.join(__dirname, 'public', 'orders.css'), 'utf8');
  assert.ok(css.indexOf('.waiter-mode') >= 0);
  assert.ok(css.indexOf('.waiter-mode .order-zones') >= 0);
  const ui = fs.readFileSync(path.join(__dirname, 'public', 'orders-ui.js'), 'utf8');
  assert.ok(ui.indexOf('function isWaiterMode') >= 0);
  assert.ok(ui.indexOf("setOrderZone('check')") >= 0);
  assert.ok(ui.indexOf('function refreshOrdersLight') >= 0);
  assert.ok(ui.indexOf('ORDERS_POLL_MS = 4000') >= 0);
  assert.ok(ui.indexOf('Math.hypot(dx, dy) >= 14') >= 0);
  assert.ok(ui.indexOf('refreshOrdersLight({ force: true })') >= 0);
  assert.ok(!fs.existsSync(path.join(__dirname, 'public', 'sw.js')));
});

test('Capacitor ofisiant Android qabıq: config + HTTPS bootstrap', function () {
  const dir = path.join(__dirname, 'mobile-waiter');
  require(path.join(dir, 'scripts', 'validate.js'));
  const cap = JSON.parse(fs.readFileSync(path.join(dir, 'capacitor.config.json'), 'utf8'));
  assert.strictEqual(cap.appId, 'az.arpos.waiter');
  assert.ok(!cap.server || !cap.server.url);
  const html = fs.readFileSync(path.join(dir, 'www', 'index.html'), 'utf8');
  assert.ok(html.indexOf("localStorage.setItem(KEY, origin)") >= 0 || html.indexOf('arpos-server-url') >= 0);
  assert.ok(html.indexOf('id="ip"') >= 0);
  assert.ok(html.indexOf('function buildOrigin') >= 0);
  assert.ok(html.indexOf('Port: 3443') >= 0);
  assert.ok(html.indexOf('Yadda saxla') >= 0);
  assert.ok(html.indexOf('orders.html?mode=waiter') >= 0);
  const setHtml = fs.readFileSync(path.join(__dirname, 'public', 'settings.html'), 'utf8');
  assert.ok(setHtml.indexOf('Android APK: mobile-waiter') >= 0);
  const setup = fs.readFileSync(path.join(__dirname, 'scripts', 'build-setup.ps1'), 'utf8');
  assert.ok(setup.indexOf("'mobile-waiter'") >= 0);
  const manPath = path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manPath)) {
    const man = fs.readFileSync(manPath, 'utf8');
    assert.ok(man.indexOf('android.permission.INTERNET') >= 0);
    assert.ok(man.indexOf('android:usesCleartextTraffic="false"') >= 0);
    assert.ok(man.indexOf('network_security_config') >= 0);
    const nsc = fs.readFileSync(path.join(dir, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'), 'utf8');
    assert.ok(nsc.indexOf('cleartextTrafficPermitted="false"') >= 0);
    assert.ok(nsc.indexOf('src="user"') >= 0);
    const act = fs.readFileSync(path.join(dir, 'android', 'app', 'src', 'main', 'java', 'az', 'arpos', 'waiter', 'MainActivity.java'), 'utf8');
    assert.ok(act.indexOf('canGoBack') >= 0);
    assert.ok(act.indexOf('goBack') >= 0);
    assert.ok(act.indexOf('onReceivedSslError') >= 0);
    assert.ok(act.indexOf('handler.proceed') >= 0);
    assert.ok(act.indexOf('isPrivateLanHost') >= 0);
  }
});

test('orders-ui Faza 1: zones/shift/pay bind + script sırası', function () {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  const moneyAt = html.indexOf('money.js');
  const zonesAt = html.indexOf('orders-zones.js');
  const shiftAt = html.indexOf('orders-shift.js');
  const payAt = html.indexOf('orders-pay.js');
  const uiAt = html.indexOf('orders-ui.js');
  assert.ok(moneyAt >= 0 && zonesAt > moneyAt && shiftAt > zonesAt && payAt > shiftAt && uiAt > payAt);
  const zones = fs.readFileSync(path.join(__dirname, 'public', 'orders-zones.js'), 'utf8');
  const shift = fs.readFileSync(path.join(__dirname, 'public', 'orders-shift.js'), 'utf8');
  const pay = fs.readFileSync(path.join(__dirname, 'public', 'orders-pay.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, 'public', 'orders-ui.js'), 'utf8');
  assert.ok(zones.indexOf('OrdersZones') >= 0 && zones.indexOf('function bind') >= 0);
  assert.ok(shift.indexOf('OrdersShift') >= 0 && shift.indexOf('function bind') >= 0);
  assert.ok(pay.indexOf('OrdersPay') >= 0 && pay.indexOf('function bind') >= 0);
  assert.ok(ui.indexOf('window.OrdersUiCtx') >= 0);
  assert.ok(ui.indexOf('OrdersZones.bind') >= 0);
  assert.ok(ui.indexOf('OrdersShift.bind') >= 0);
  assert.ok(ui.indexOf('OrdersPay.bind') >= 0);
  assert.ok(ui.indexOf('function postAccept') >= 0);
});

test('Z: autoPrintZ; queue z; receipt brand; açıq masa blok', function () {
  withTempDb(function () {
    assert.strictEqual(settings.readSettings().shift.autoPrintZ, true);
    settings.writeSettings({ shift: { autoPrintZ: false, autoOpenOnSale: true, defaultStartingCash: 0 } });
    assert.strictEqual(settings.readSettings().shift.autoPrintZ, false);
    assert.strictEqual(settings.forPos().shift.autoPrintZ, false);
    settings.writeSettings({
      branchName: 'Kafe Z',
      receipt: {
        title: 'Z Cafe',
        address: 'Nizami 1',
        phone: '012',
        headerLines: ['Hdr'],
        footerLines: ['Ftr']
      },
      shift: { autoPrintZ: true, autoOpenOnSale: true, defaultStartingCash: 0 }
    });
    assert.strictEqual(settings.forPos().shift.autoPrintZ, true);
    printers.writeStore({ nextPrinterId: 1, printers: [] });
    const packed = {
      shift: {
        id: 9,
        openedAt: '2026-09-13T10:00:00',
        closedAt: '2026-09-13T22:00:00',
        closedByName: 'Ali',
        startingCash: 0,
        countedCash: 10,
        drops: []
      },
      totals: { count: 1, total: 10, cash: 10, card: 0, gift: 0, prepaid: 0, refundCash: 0, refundCard: 0 },
      drops: [],
      expectedCash: 10,
      difference: 0,
      terminalName: 'Kassa 1',
      branchName: 'Kafe Z',
      receipt: settings.readSettings().receipt
    };
    const ticket = printers.buildZTicket({ paperWidth: 80, charsPerLine: 48, font: 'A' }, packed);
    const text = ticket.toString('ascii');
    assert.ok(text.indexOf('Z Cafe') >= 0);
    assert.ok(text.indexOf('Nizami 1') >= 0);
    assert.ok(text.indexOf('Hdr') >= 0);
    assert.ok(text.indexOf('Ftr') >= 0);
    assert.ok(text.indexOf('Z-hesabat') >= 0);

    const prSrc = fs.readFileSync(path.join(__dirname, 'printers.js'), 'utf8');
    assert.ok(prSrc.indexOf("kind: 'z'") >= 0);
    assert.ok(prSrc.indexOf("job.kind === 'z'") >= 0);
    assert.ok(prSrc.indexOf('Z növbəyə düşdü') >= 0);
    assert.ok(prSrc.indexOf('appendReceiptBrand') >= 0);

    assert.ok(shifts.closeBlockMessage([
      { status: 'open', terminalId: 1, tableName: 'M1', items: [{ voided: false }] }
    ], 1));
    assert.strictEqual(shifts.closeBlockMessage([
      { status: 'paid', terminalId: 1, tableName: 'M1', items: [] }
    ], 1), '');
  });
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const close = serverSrc.slice(
    serverSrc.indexOf("app.post('/api/shifts/close'"),
    serverSrc.indexOf("app.post('/api/shifts/print-z'")
  );
  assert.ok(close.indexOf('autoPrintZ') >= 0);
  assert.ok(close.indexOf("fiscal.probe('close')") >= 0);
  const ui = ordersUiBundle();
  assert.ok(ui.indexOf('ShiftZView') >= 0);
  assert.ok(fs.existsSync(path.join(__dirname, 'public', 'shift-z-view.js')));
  assert.ok(fs.readFileSync(path.join(__dirname, 'public', 'settings.html'), 'utf8').indexOf('shift-auto-print-z') >= 0);
  const zView = fs.readFileSync(path.join(__dirname, 'public', 'shift-z-view.js'), 'utf8');
  assert.ok(zView.indexOf('Çap edilir') >= 0);
  assert.ok(zView.indexOf('Z hesabat çap edildi.') >= 0);
  assert.ok(zView.indexOf('function printNow') >= 0);
  assert.ok(zView.indexOf('contentWindow.print') >= 0);
  assert.ok(zView.indexOf('Z çapı getmədi.') >= 0);
  assert.ok(zView.indexOf('data-bound') >= 0);
  assert.ok(zView.indexOf('z-sum-warn') >= 0);
  const bannerCss = fs.readFileSync(path.join(__dirname, 'public', 'app.css'), 'utf8');
  const bannerBlock = bannerCss.slice(bannerCss.indexOf('.pos-banner {'), bannerCss.indexOf('.pos-banner-ok'));
  assert.ok(bannerBlock.indexOf('z-index: 90') >= 0);
  assert.ok(bannerBlock.indexOf('z-index: 45') < 0);
});

test('Ofis more-nav: kənar klik + Esc bağlanır', function () {
  const nav = fs.readFileSync(path.join(__dirname, 'public', 'nav.js'), 'utf8');
  assert.ok(nav.indexOf('function closeMoreNav') >= 0);
  assert.ok(nav.indexOf('function bindMoreNav') >= 0);
  assert.ok(nav.indexOf("details.more-nav[open]") >= 0);
  assert.ok(nav.indexOf("event.key === 'Escape'") >= 0);
  assert.ok(nav.indexOf('.more-nav-list a') >= 0);
  assert.ok(nav.indexOf('moreNavBound') >= 0);
  const css = fs.readFileSync(path.join(__dirname, 'public', 'app.css'), 'utf8');
  const box = css.slice(css.indexOf('.more-nav-list {'), css.indexOf('.more-nav-list a'));
  assert.ok(box.indexOf('z-index: 50') >= 0);
  assert.ok(box.indexOf('max-height') >= 0);
  assert.ok(box.indexOf('overflow') >= 0);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  assert.ok(html.indexOf('nav.js?v=1') >= 0);
  assert.ok(html.indexOf('app.css?v=21') >= 0);
});

test('zal yaş: age-ok/warn/alert; vaxt format; boşda age yox', function () {
  function ageClass(mins) {
    if (!(mins >= 0)) {
      return '';
    }
    if (mins >= 60) {
      return 'age-alert';
    }
    if (mins >= 30) {
      return 'age-warn';
    }
    return 'age-ok';
  }
  function formatOpenAge(mins) {
    if (!(mins >= 0)) {
      return '';
    }
    if (mins < 60) {
      return mins + ' dəq';
    }
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h + 's ' + (m < 10 ? '0' : '') + m + 'd';
  }
  function ageMinutesFromMs(openMs, nowMs) {
    if (!openMs) {
      return -1;
    }
    return Math.max(0, Math.floor((nowMs - openMs) / 60000));
  }
  const now = Date.parse('2026-09-13T12:00:00.000Z');
  assert.strictEqual(ageClass(10), 'age-ok');
  assert.strictEqual(ageClass(40), 'age-warn');
  assert.strictEqual(ageClass(70), 'age-alert');
  assert.strictEqual(formatOpenAge(12), '12 dəq');
  assert.strictEqual(formatOpenAge(65), '1s 05d');
  assert.strictEqual(ageClass(ageMinutesFromMs(now - 10 * 60000, now)), 'age-ok');
  assert.strictEqual(ageClass(ageMinutesFromMs(now - 40 * 60000, now)), 'age-warn');
  assert.strictEqual(ageClass(ageMinutesFromMs(now - 70 * 60000, now)), 'age-alert');
  assert.strictEqual(formatOpenAge(ageMinutesFromMs(now - 70 * 60000, now)), '1s 10d');
  assert.strictEqual(ageClass(-1), '');
  assert.strictEqual(formatOpenAge(-1), '');

  const ui = fs.readFileSync(path.join(__dirname, 'public', 'orders-ui.js'), 'utf8');
  assert.ok(ui.indexOf('function ageClass') >= 0);
  assert.ok(ui.indexOf('function formatOpenAge') >= 0);
  assert.ok(ui.indexOf('AGE_WARN_MIN = 30') >= 0);
  assert.ok(ui.indexOf('AGE_ALERT_MIN = 60') >= 0);
  assert.ok(ui.indexOf('busyAgeParts') >= 0);
  assert.ok(ui.indexOf('renderServiceBoard') >= 0);
  assert.ok(ui.indexOf("age.cls ? ' ' + age.cls : ''") >= 0 || ui.indexOf('age.cls') >= 0);
  assert.ok(ui.indexOf("state === 'busy'") >= 0);
  assert.ok(ui.indexOf('renderFloor()') >= 0);
  const css = fs.readFileSync(path.join(__dirname, 'public', 'orders.css'), 'utf8');
  assert.ok(css.indexOf('.table-tile.busy.age-ok') >= 0);
  assert.ok(css.indexOf('.table-tile.busy.age-warn') >= 0);
  assert.ok(css.indexOf('.table-tile.busy.age-alert') >= 0);
  assert.ok(css.indexOf('.table-tile.selected') >= 0);
  const selIdx = css.indexOf('.table-tile.selected');
  const alertIdx = css.indexOf('.table-tile.busy.age-alert');
  assert.ok(selIdx > alertIdx);
  assert.ok(css.indexOf('box-shadow: 0 0 0 2px #e2b65a') >= 0);
});

test('favoritlər + barkod fokus', function () {
  function normalizeFavIds(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (id) {
      var n = Number(id);
      if (!(n >= 1) || out.indexOf(n) >= 0) {
        return;
      }
      if (out.length < 12) {
        out.push(n);
      }
    });
    return out;
  }
  function toggleFavId(list, id) {
    var n = Number(id);
    if (!(n >= 1)) {
      return normalizeFavIds(list);
    }
    var next = normalizeFavIds(list).slice();
    var i = next.indexOf(n);
    if (i >= 0) {
      next.splice(i, 1);
    } else if (next.length < 12) {
      next.unshift(n);
    }
    return next;
  }
  assert.deepStrictEqual(toggleFavId([], 5), [5]);
  assert.deepStrictEqual(toggleFavId([5], 5), []);
  assert.deepStrictEqual(toggleFavId([1, 2], 3), [3, 1, 2]);
  var full = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepStrictEqual(toggleFavId(full, 99), full);
  assert.deepStrictEqual(normalizeFavIds([1, 1, 0, -2, 'x', 3]), [1, 3]);
  assert.strictEqual(normalizeFavIds(full.concat([13])).length, 12);

  const ui = fs.readFileSync(path.join(__dirname, 'public', 'orders-ui.js'), 'utf8');
  assert.ok(ui.indexOf("FAV_KEY = 'arpos-favorites'") >= 0);
  assert.ok(ui.indexOf('FAV_MAX = 12') >= 0);
  assert.ok(ui.indexOf('function toggleFavorite') >= 0);
  assert.ok(ui.indexOf('function renderFavRow') >= 0);
  assert.ok(ui.indexOf('function maybeFocusBarcode') >= 0);
  assert.ok(ui.indexOf('function uiBlockedForBarcode') >= 0);
  assert.ok(ui.indexOf('takeBarcodeHit') >= 0);
  assert.ok(ui.indexOf("event.key !== 'Enter'") >= 0 || ui.indexOf("event.key !== \"Enter\"") >= 0);
  assert.ok(ui.indexOf("event.key !== '/'") >= 0 || ui.indexOf('event.key !== "/"') >= 0);
  assert.ok(ui.indexOf('bindFavLongPress') >= 0);
  assert.ok(ui.indexOf('fav-star') >= 0);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'orders.html'), 'utf8');
  assert.ok(html.indexOf('id="fav-row"') >= 0);
  assert.ok(html.indexOf('id="order-search"') >= 0);
  const css = fs.readFileSync(path.join(__dirname, 'public', 'orders.css'), 'utf8');
  assert.ok(css.indexOf('.fav-row') >= 0);
  assert.ok(css.indexOf('.fav-chip') >= 0);
  assert.ok(css.indexOf('.order-card .fav-star') >= 0);
});

test('printer windows/tcp: normalize; list/UI; mock flags', function () {
  const tcp = printers.normalizePrinter({
    name: 'Net',
    connectionType: 'tcp',
    host: '192.168.1.50',
    port: 9100,
    role: 'receipt',
    paperWidth: 80,
    copies: 1
  }, null);
  assert.ok(!tcp.error, tcp.error);
  assert.strictEqual(tcp.printer.connectionType, 'tcp');
  assert.strictEqual(tcp.printer.host, '192.168.1.50');
  assert.strictEqual(tcp.printer.port, 9100);
  assert.strictEqual(tcp.printer.windowsName, '');

  const badTcp = printers.normalizePrinter({ name: 'X', connectionType: 'tcp', host: '', role: 'receipt' }, null);
  assert.ok(badTcp.error);

  const win = printers.normalizePrinter({
    name: 'USB',
    connectionType: 'windows',
    windowsName: 'POS-80C',
    role: 'receipt',
    paperWidth: 58,
    copies: 1
  }, null);
  assert.ok(!win.error, win.error);
  assert.strictEqual(win.printer.connectionType, 'windows');
  assert.strictEqual(win.printer.windowsName, 'POS-80C');
  assert.strictEqual(win.printer.host, '');
  assert.strictEqual(win.printer.port, 0);

  const badWin = printers.normalizePrinter({
    name: 'USB',
    connectionType: 'windows',
    windowsName: '',
    role: 'receipt'
  }, null);
  assert.ok(badWin.error);

  const legacy = printers.normalizePrinter({
    name: 'Old',
    host: '10.0.0.8',
    port: 9100,
    role: 'receipt'
  }, null);
  assert.strictEqual(legacy.printer.connectionType, 'tcp');

  const html = fs.readFileSync(path.join(__dirname, 'public', 'printers.html'), 'utf8');
  assert.ok(html.indexOf('id="printer-type"') >= 0);
  assert.ok(html.indexOf('id="printer-windows"') >= 0);
  const ui = fs.readFileSync(path.join(__dirname, 'public', 'printers-ui.js'), 'utf8');
  assert.ok(ui.indexOf('syncType') >= 0);
  assert.ok(ui.indexOf('/api/printers/windows-list') >= 0);
  const src = fs.readFileSync(path.join(__dirname, 'printers.js'), 'utf8');
  assert.ok(src.indexOf('sendWindowsRaw') >= 0);
  assert.ok(src.indexOf('deliverBytes') >= 0);
  assert.ok(src.indexOf('listWindowsPrinters') >= 0);
  assert.ok(src.indexOf('ARPOS_MOCK_WINDOWS_PRINT') >= 0);
  assert.ok(src.indexOf('Windows printer yalnız Windows kassada') >= 0);
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(serverSrc.indexOf("/api/printers/windows-list") >= 0);
});

console.log('Bütün testlər keçdi.');
