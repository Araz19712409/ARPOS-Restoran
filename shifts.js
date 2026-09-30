const db = require('./db');
const num = require('./num');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function readStore() {
  const raw = db.readOffice('shifts.json');
  return {
    nextId: Number(raw.nextId) || 1,
    shifts: Array.isArray(raw.shifts) ? raw.shifts : []
  };
}

function writeStore(data) {
  db.writeOffice('shifts.json', data);
}

function stampIn(iso, fromMs, toMs) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

function totals(orderList, fromIso, toIso, terminalId) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = toIso ? new Date(toIso).getTime() : Date.now();
  const out = {
    count: 0,
    cash: 0,
    card: 0,
    gift: 0,
    loyalty: 0,
    tip: 0,
    prepaid: 0,
    refundCash: 0,
    refundCard: 0,
    total: 0
  };
  (orderList || []).forEach(function (order) {
    if (terminalId && Number(order.terminalId) !== Number(terminalId)) {
      return;
    }
    const pay = order.payment;
    if (!pay) {
      return;
    }
    if ((order.status === 'paid' || order.status === 'refunded') &&
        stampIn(pay.at || order.updatedAt, fromMs, toMs)) {
      const gift = Number(pay.giftAmount) || (order.payments || []).reduce(function (sum, row) {
        return sum + (Number(row.giftAmount) || 0);
      }, 0);
      out.count += 1;
      out.cash += Number(pay.cashAmount) || 0;
      out.card += Number(pay.cardAmount) || 0;
      out.gift += gift;
      var loy = Number(pay.loyaltyAmount);
      if (!(loy > 0)) {
        loy = (order.payments || []).reduce(function (sum, row) {
          return sum + (Number(row.loyaltyAmount) || 0);
        }, 0);
      }
      out.loyalty += loy || 0;
      var tip = Number(pay.tipAmount);
      if (!(tip > 0)) {
        tip = (order.payments || []).reduce(function (sum, row) {
          return sum + (Number(row.tipAmount) || 0);
        }, 0);
      }
      out.tip += tip || 0;
      out.prepaid += Number(pay.prepaid) || 0;
      out.total += Number(pay.total) || 0;
    }
    if (order.status === 'refunded' && order.refund &&
        stampIn(order.refund.at, fromMs, toMs)) {
      out.refundCash += Number(order.refund.cashAmount) || 0;
      out.refundCard += Number(order.refund.cardAmount) || 0;
    }
  });
  return {
    count: out.count,
    cash: money(out.cash),
    card: money(out.card),
    gift: money(out.gift),
    loyalty: money(out.loyalty),
    tip: money(out.tip),
    prepaid: money(out.prepaid),
    refundCash: money(out.refundCash),
    refundCard: money(out.refundCard),
    total: money(out.total)
  };
}

function lineQty(item) {
  return Number(item && item.qty) || 0;
}

function lineAmt(item) {
  if (!item || item.voided || item.comboOf || item.complimentary) {
    return 0;
  }
  return num.fromMinor(num.mulQty(num.toMinor(item.salePrice), item.qty));
}

function salesByStation(orderList, fromIso, toIso, terminalId, catalog) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = toIso ? new Date(toIso).getTime() : Date.now();
  const cat = catalog || require('./catalog').readCatalog();
  const products = (cat && cat.products) || [];
  const stations = (cat && cat.stations) || [];
  const productOf = {};
  products.forEach(function (row) {
    productOf[Number(row.id)] = row;
  });
  const stationName = {};
  stations.forEach(function (row) {
    stationName[Number(row.id)] = String(row.name || '').trim();
  });
  const groups = {};
  function bump(sid, name, qty, sum) {
    const key = String(Number(sid) || 0);
    if (!groups[key]) {
      groups[key] = {
        stationId: Number(sid) || 0,
        stationName: Number(sid) > 0 ? (stationName[Number(sid)] || ('Stansiya ' + sid)) : 'Stansiyasız',
        items: {},
        qty: 0,
        sum: 0
      };
    }
    const g = groups[key];
    const itemKey = String(name || '');
    if (!g.items[itemKey]) {
      g.items[itemKey] = { name: itemKey, qty: 0, sum: 0 };
    }
    g.items[itemKey].qty = money(g.items[itemKey].qty + qty);
    g.items[itemKey].sum = money(g.items[itemKey].sum + sum);
    g.qty = money(g.qty + qty);
    g.sum = money(g.sum + sum);
  }
  (orderList || []).forEach(function (order) {
    if (terminalId && Number(order.terminalId) !== Number(terminalId)) {
      return;
    }
    const pay = order.payment;
    if (!pay) {
      return;
    }
    if (!((order.status === 'paid' || order.status === 'refunded') &&
        stampIn(pay.at || order.updatedAt, fromMs, toMs))) {
      return;
    }
    (order.items || []).forEach(function (item) {
      if (!item || item.voided || item.comboOf) {
        return;
      }
      const qty = lineQty(item);
      if (!(qty > 0)) {
        return;
      }
      const prod = productOf[Number(item.productId) || 0];
      let sid = Number(item.stationId);
      if (!(sid > 0) && prod) {
        sid = Number(prod.stationId) || 0;
      }
      if (!(sid > 0)) {
        sid = 0;
      }
      const name = String((item && item.name) || (prod && prod.name) || '').trim() ||
        ('#' + (Number(item.productId) || 0));
      bump(sid, name, qty, lineAmt(item));
    });
  });
  return Object.keys(groups).map(function (key) {
    const g = groups[key];
    const items = Object.keys(g.items).map(function (ik) {
      const it = g.items[ik];
      return { name: it.name, qty: money(it.qty), sum: money(it.sum) };
    }).sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'az');
    });
    return {
      stationId: g.stationId,
      stationName: g.stationName,
      items: items,
      qty: money(g.qty),
      sum: money(g.sum)
    };
  }).sort(function (a, b) {
    if (!a.stationId && b.stationId) {
      return 1;
    }
    if (a.stationId && !b.stationId) {
      return -1;
    }
    return String(a.stationName).localeCompare(String(b.stationName), 'az');
  });
}

function byStationSum(rows) {
  return money((rows || []).reduce(function (acc, row) {
    return acc + (Number(row && row.sum) || 0);
  }, 0));
}

function openTableNames(orderList, terminalId) {
  return (orderList || []).filter(function (order) {
    if (order.status !== 'open') {
      return false;
    }
    if (terminalId && order.terminalId && Number(order.terminalId) !== Number(terminalId)) {
      return false;
    }
    return true;
  }).map(function (order) {
    return order.tableName || ('Masa ' + order.tableId);
  });
}

function currentFor(store, terminalId) {
  return store.shifts.find(function (row) {
    return row.terminalId === Number(terminalId) && row.status === 'open';
  }) || null;
}

function packedFromSnapshot(row) {
  const snap = row && row.snapshot ? row.snapshot : {};
  const packed = {
    shift: row,
    totals: snap.totals,
    drops: snap.drops || (row && row.drops) || [],
    expectedCash: snap.expectedCash,
    difference: snap.difference
  };
  if (Array.isArray(snap.byStation)) {
    packed.byStation = snap.byStation;
  }
  return packed;
}

function packedForPrint(row, orderList, book) {
  if (row && row.status === 'closed' && row.snapshot && row.snapshot.totals) {
    return packedFromSnapshot(row);
  }
  return withExpected(row, orderList, book);
}

function withExpected(row, orderList, book) {
  const parts = totals(orderList, row.openedAt, row.closedAt || null, row.terminalId);
  const fromMs = new Date(row.openedAt).getTime();
  const toMs = row.closedAt ? new Date(row.closedAt).getTime() : Date.now();
  let prepayCash = 0;
  (((book && book.reservations) || [])).forEach(function (res) {
    if (!res.prepay || !stampIn(res.prepay.at, fromMs, toMs)) {
      return;
    }
    if (Number(res.prepay.terminalId) !== Number(row.terminalId)) {
      return;
    }
    prepayCash += Number(res.prepay.cashAmount) || 0;
  });
  const dropSum = (row.drops || []).reduce(function (sum, item) {
    if (item && item.fromZ) {
      return sum;
    }
    return sum + (Number(item.amount) || 0);
  }, 0);
  const expectedCash = money(
    Number(row.startingCash || 0) + parts.cash + prepayCash - parts.refundCash - dropSum
  );
  const counted = row.countedCash == null ? null : money(row.countedCash);
  return {
    shift: row,
    totals: parts,
    drops: row.drops || [],
    expectedCash: expectedCash,
    difference: counted == null ? null : money(counted - expectedCash),
    byStation: salesByStation(orderList, row.openedAt, row.closedAt || null, row.terminalId)
  };
}

function openShiftForTill(store, terminalId) {
  const id = Number(terminalId) || 0;
  if (id) {
    return currentFor(store, id);
  }
  const open = (store.shifts || []).filter(function (row) {
    return row.status === 'open';
  });
  return open.length === 1 ? open[0] : null;
}

function closeBlockMessage(orderList, terminalId) {
  const names = openTableNames(orderList, terminalId);
  if (!names.length) {
    return '';
  }
  return 'Açıq masa var: ' + names.join(', ') + '.';
}

function lastClosedFor(store, terminalId) {
  return (store && store.shifts || []).filter(function (row) {
    return Number(row.terminalId) === Number(terminalId) && row.status === 'closed';
  }).sort(function (a, b) {
    return String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
  })[0] || null;
}

function nextStartingCash(store, terminalId, shiftCfg) {
  const fallback = money(shiftCfg && shiftCfg.defaultStartingCash);
  const last = lastClosedFor(store, terminalId);
  if (last && last.removeCash === true) {
    return fallback;
  }
  if (shiftCfg && shiftCfg.carryCountedCash === false) {
    return fallback;
  }
  if (!last || last.countedCash == null || last.countedCash === '') {
    return fallback;
  }
  const n = money(last.countedCash);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function maybeAutoOpen(store, terminal, user, shiftCfg) {
  const have = currentFor(store, terminal && terminal.id);
  if (have) {
    return { shift: have, created: false };
  }
  if (shiftCfg && shiftCfg.autoOpenOnSale === false) {
    return { error: 'Əvvəlcə növbə açın.' };
  }
  return ensureOpen(store, terminal, user, nextStartingCash(store, terminal && terminal.id, shiftCfg));
}

function ensureOpen(store, terminal, user, startingCash) {
  const term = terminal || {};
  const tid = Number(term.id);
  if (!tid) {
    return { error: 'Terminal seçin.' };
  }
  const have = currentFor(store, tid);
  if (have) {
    return { shift: have, created: false };
  }
  const cash = money(startingCash);
  if (!Number.isFinite(cash) || cash < 0) {
    return { error: 'Başlanğıc nağd düzgün deyil.' };
  }
  const row = {
    id: store.nextId,
    terminalId: tid,
    terminalName: String(term.name || '').slice(0, 40),
    status: 'open',
    startingCash: cash,
    openedAt: new Date().toISOString(),
    openedBy: user && user.id ? user.id : 0,
    openedByName: user && user.name ? String(user.name).slice(0, 40) : '',
    autoOpened: true
  };
  store.nextId += 1;
  store.shifts.push(row);
  return { shift: row, created: true };
}

function addCashDrop(store, terminalId, amount, note, user) {
  const pay = money(amount);
  if (!Number.isFinite(pay) || pay <= 0) {
    return null;
  }
  const row = openShiftForTill(store, terminalId);
  if (!row) {
    return null;
  }
  if (!row.drops) {
    row.drops = [];
  }
  row.drops.push({
    amount: pay,
    note: String(note || '').trim().slice(0, 40),
    at: new Date().toISOString(),
    userId: user && user.id ? user.id : 0,
    userName: user && user.name ? String(user.name).slice(0, 40) : ''
  });
  return row;
}

module.exports = {
  money: money,
  readStore: readStore,
  writeStore: writeStore,
  totals: totals,
  openTableNames: openTableNames,
  currentFor: currentFor,
  withExpected: withExpected,
  packedFromSnapshot: packedFromSnapshot,
  packedForPrint: packedForPrint,
  openShiftForTill: openShiftForTill,
  closeBlockMessage: closeBlockMessage,
  lastClosedFor: lastClosedFor,
  nextStartingCash: nextStartingCash,
  maybeAutoOpen: maybeAutoOpen,
  ensureOpen: ensureOpen,
  addCashDrop: addCashDrop,
  salesByStation: salesByStation,
  byStationSum: byStationSum
};
