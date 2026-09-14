const db = require('./db');

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
  return {
    shift: row,
    totals: snap.totals,
    drops: snap.drops || (row && row.drops) || [],
    expectedCash: snap.expectedCash,
    difference: snap.difference
  };
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
    difference: counted == null ? null : money(counted - expectedCash)
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
  if (shiftCfg && shiftCfg.carryCountedCash === false) {
    return fallback;
  }
  const last = lastClosedFor(store, terminalId);
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
  addCashDrop: addCashDrop
};
