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

module.exports = {
  money: money,
  readStore: readStore,
  writeStore: writeStore,
  totals: totals,
  openTableNames: openTableNames,
  currentFor: currentFor,
  withExpected: withExpected
};
