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
const path = require('path');

function test(name, fn) {
  fn();
  console.log('ok  ' + name);
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

test('jurnal gün açarı', function () {
  assert.strictEqual(journal.dayKey('2026-09-07'), '2026-09-07');
  assert.strictEqual(journal.dayKey(new Date(2026, 8, 7)), '2026-09-07');
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

test('ödənilib hədiyyəni sayır', function () {
  const order = {
    payments: [
      { cashAmount: 4, cardAmount: 0, giftAmount: 6 },
      { cashAmount: 0, cardAmount: 2, giftAmount: 0 }
    ]
  };
  assert.strictEqual(orders.paidTotal(order), 12);
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

test('qəbulda quoted happy hour saxlanır', function () {
  const product = { salePrice: 10, happyPrice: 7, happyFrom: 3, happyTo: 4, portions: [], extras: [] };
  const quoted = catalog.resolveQuotedPrice(product, {}, 7);
  assert.strictEqual(quoted.salePrice, 7);
});

console.log('Bütün testlər keçdi.');
