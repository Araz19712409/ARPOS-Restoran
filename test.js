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
const db = require('./db');
const totp = require('./totp');
const fs = require('fs');
const os = require('os');
const path = require('path');

function test(name, fn) {
  fn();
  console.log('ok  ' + name);
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

test('PIN qaydaları', function () {
  assert.strictEqual(users.loginPin('1234'), true);
  assert.strictEqual(users.validPin('1234'), false);
  assert.strictEqual(users.validPin('123456'), true);
  assert.strictEqual(users.forbiddenPin('0000'), true);
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
    const warns = stock.deductLines(catalogStore, [{ productId: 1, qty: 2 }], { orderId: 9 });
    assert.strictEqual(warns.length, 0);
    const after = stock.readStock();
    assert.strictEqual(after.items[0].qty, 4.6);
    assert.strictEqual(after.moves.length, 1);
    assert.strictEqual(after.moves[0].type, 'sale');
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

console.log('Bütün testlər keçdi.');
