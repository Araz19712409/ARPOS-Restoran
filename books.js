const catalog = require('./catalog');
const clock = require('./clock');
const orders = require('./orders');
const reservations = require('./reservations');
const settings = require('./settings');
const shifts = require('./shifts');
const stock = require('./stock');
const terminals = require('./terminals');
const users = require('./users');

const WASTE_KEYS = ['xarab', 'töküldü', 'ev', 'digər'];

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
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

function inRange(value, from, to) {
  const at = new Date(value);
  return !Number.isNaN(at.getTime()) && at >= from && at <= to;
}

function dayKey(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return '';
  }
  const m = at.getMonth() + 1;
  const d = at.getDate();
  return at.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function wasteKind(note) {
  const text = String(note || '').trim().toLocaleLowerCase('az');
  for (let i = 0; i < WASTE_KEYS.length; i += 1) {
    if (text === WASTE_KEYS[i] || text.indexOf(WASTE_KEYS[i] + ':') === 0) {
      return WASTE_KEYS[i];
    }
  }
  return 'çıxış';
}

function emptyPayDay() {
  return {
    date: '', cash: 0, card: 0, gift: 0, prepaid: 0, total: 0,
    refundCash: 0, refundCard: 0, count: 0,
    discount: 0, complimentary: 0, waste: 0, purchases: 0,
    drops: 0, difference: 0, cost: 0
  };
}

function ensureDay(days, dk) {
  if (!dk) {
    return null;
  }
  if (!days[dk]) {
    days[dk] = emptyPayDay();
    days[dk].date = dk;
  }
  return days[dk];
}

function build(input) {
  const from = input.from;
  const to = input.to;
  const orderList = input.orders || [];
  const showCost = !!input.showCost;
  const showStock = !!input.showStock;
  const catalogStore = input.catalog || { products: [] };
  const stockStore = input.stock || { items: [], moves: [], purchases: [] };
  const book = input.book || { reservations: [] };
  const termList = input.terminals || [];
  const vatPercent = Number.isFinite(Number(input.vatPercent))
    ? Number(input.vatPercent)
    : 0;
  const userList = input.users || [];
  const punches = input.punches || [];

  function termName(id) {
    const row = termList.find(function (item) {
      return Number(item.id) === Number(id);
    });
    return (row && row.name) || ('Kassa ' + id);
  }

  const days = {};
  const cashbook = [];
  (input.shifts || []).forEach(function (row) {
    const opened = new Date(row.openedAt);
    const closed = row.closedAt ? new Date(row.closedAt) : null;
    const hit = (opened >= from && opened <= to) ||
      (closed && closed >= from && closed <= to) ||
      (row.status === 'open' && opened <= to);
    if (!hit) {
      return;
    }
    const packed = shifts.withExpected(row, orderList, book);
    const dropSum = (row.drops || []).reduce(function (sum, item) {
      return sum + (Number(item.amount) || 0);
    }, 0);
    cashbook.push({
      id: row.id || 0,
      terminalId: row.terminalId,
      terminalName: termName(row.terminalId),
      status: row.status || '',
      openedAt: row.openedAt,
      closedAt: row.closedAt || '',
      start: money(row.startingCash),
      cash: packed.totals.cash,
      card: packed.totals.card,
      gift: packed.totals.gift,
      prepaid: packed.totals.prepaid,
      refundCash: packed.totals.refundCash,
      refundCard: packed.totals.refundCard,
      drops: money(dropSum),
      expected: packed.expectedCash,
      counted: row.countedCash == null ? null : money(row.countedCash),
      difference: packed.difference
    });
    const day = ensureDay(days, dayKey(row.closedAt || row.openedAt));
    if (day) {
      day.drops += dropSum;
      if (packed.difference != null) {
        day.difference += packed.difference;
      }
    }
  });
  cashbook.sort(function (a, b) {
    return String(a.openedAt) < String(b.openedAt) ? 1 : -1;
  });
  const cashSum = {
    start: 0, cash: 0, card: 0, gift: 0, prepaid: 0, drops: 0,
    expected: 0, counted: 0, difference: 0, refundCash: 0
  };
  let countedN = 0;
  cashbook.forEach(function (row) {
    cashSum.start += row.start;
    cashSum.cash += row.cash;
    cashSum.card += row.card;
    cashSum.gift += row.gift;
    cashSum.prepaid += row.prepaid;
    cashSum.drops += row.drops;
    cashSum.expected += row.expected;
    cashSum.refundCash += row.refundCash;
    if (row.counted != null) {
      cashSum.counted += row.counted;
      countedN += 1;
      cashSum.difference += Number(row.difference) || 0;
    }
  });
  Object.keys(cashSum).forEach(function (key) {
    cashSum[key] = money(cashSum[key]);
  });
  cashSum.countedN = countedN;

  const methods = {
    cash: { method: 'cash', count: 0, total: 0 },
    card: { method: 'card', count: 0, total: 0 },
    gift: { method: 'gift', count: 0, total: 0 },
    mixed: { method: 'mixed', count: 0, total: 0 },
    prepaid: { method: 'prepaid', count: 0, total: 0 }
  };
  const pay = { count: 0, cash: 0, card: 0, gift: 0, prepaid: 0, total: 0, refundCash: 0, refundCard: 0, refundCount: 0 };
  let cost = 0;
  let compTotal = 0;
  let discountTotal = 0;
  orderList.forEach(function (order) {
    const payRow = order.payment;
    if (order.status === 'refunded' && order.refund && inRange(order.refund.at, from, to)) {
      pay.refundCount += 1;
      pay.refundCash += Number(order.refund.cashAmount) || 0;
      pay.refundCard += Number(order.refund.cardAmount) || 0;
      const dk = dayKey(order.refund.at);
      const refundDay = ensureDay(days, dk);
      if (refundDay) {
        refundDay.refundCash += Number(order.refund.cashAmount) || 0;
        refundDay.refundCard += Number(order.refund.cardAmount) || 0;
      }
    }
    if ((order.status !== 'paid' && order.status !== 'refunded') || !payRow) {
      return;
    }
    const at = payRow.at || order.updatedAt;
    if (!inRange(at, from, to)) {
      return;
    }
    const cash = Number(payRow.cashAmount) || (payRow.method === 'cash' ? Number(payRow.total) || 0 : 0);
    const card = Number(payRow.cardAmount) || (payRow.method === 'card' ? Number(payRow.total) || 0 : 0);
    const gift = Number(payRow.giftAmount) || 0;
    const prepaid = Number(payRow.prepaid) || 0;
    const total = Number(payRow.total) || 0;
    pay.count += 1;
    pay.cash += cash;
    pay.card += card;
    pay.gift += gift;
    pay.prepaid += prepaid;
    pay.total += total;
    const disc = Number(payRow.discountAmount) || 0;
    discountTotal += disc;
    const key = payRow.method === 'card' || payRow.method === 'gift' ||
      payRow.method === 'mixed' || payRow.method === 'prepaid'
      ? payRow.method
      : 'cash';
    if (methods[key]) {
      methods[key].count += 1;
      methods[key].total += total;
    }
    const dk = dayKey(at);
    const saleDay = ensureDay(days, dk);
    if (saleDay) {
      saleDay.count += 1;
      saleDay.cash += cash;
      saleDay.card += card;
      saleDay.gift += gift;
      saleDay.prepaid += prepaid;
      saleDay.total += total;
      saleDay.discount += disc;
    }
    (order.items || []).forEach(function (item) {
      if (item.voided) {
        return;
      }
      if (item.complimentary) {
        const base = Number(item.basePrice != null ? item.basePrice : item.salePrice) || 0;
        const comp = base * (Number(item.qty) || 0);
        compTotal += comp;
        if (saleDay) {
          saleDay.complimentary += comp;
        }
      }
      if (showCost) {
        const product = catalogStore.products.find(function (row) {
          return row.id === Number(item.productId);
        });
        const unit = item.costPrice != null ? Number(item.costPrice) : stock.lineCost(product, stockStore, item);
        const lineCost = unit * (Number(item.qty) || 0);
        cost += lineCost;
        if (saleDay) {
          saleDay.cost += lineCost;
        }
      }
    });
  });
  Object.keys(pay).forEach(function (key) {
    if (key !== 'count' && key !== 'refundCount') {
      pay[key] = money(pay[key]);
    }
  });
  const methodList = ['cash', 'card', 'gift', 'mixed', 'prepaid'].map(function (key) {
    return {
      method: key,
      count: methods[key].count,
      total: money(methods[key].total)
    };
  });

  let wasteTotal = 0;
  const wasteBy = { xarab: 0, 'töküldü': 0, ev: 0, 'digər': 0, 'çıxış': 0 };
  const wasteRows = [];
  let purchaseTotal = 0;
  if (showStock) {
    const items = stockStore.items || [];
    (stockStore.moves || []).forEach(function (move) {
      if (move.type !== 'out' || !inRange(move.at, from, to)) {
        return;
      }
      const item = items.find(function (row) {
        return row.id === Number(move.itemId);
      });
      const price = Number((item && item.buyPrice) || 0);
      const amount = money((Number(move.qty) || 0) * price);
      const kind = wasteKind(move.note);
      wasteTotal += amount;
      wasteBy[kind] = money((wasteBy[kind] || 0) + amount);
      const wasteDay = ensureDay(days, dayKey(move.at));
      if (wasteDay) {
        wasteDay.waste += amount;
      }
      wasteRows.push({
        at: move.at,
        name: (item && item.name) || ('#' + move.itemId),
        qty: Number(move.qty) || 0,
        kind: kind,
        total: amount
      });
    });
    wasteRows.sort(function (a, b) {
      return String(a.at) < String(b.at) ? 1 : -1;
    });
    (stockStore.purchases || []).forEach(function (row) {
      if (inRange(row.at, from, to)) {
        purchaseTotal += Number(row.total) || 0;
        const buyDay = ensureDay(days, dayKey(row.at));
        if (buyDay) {
          buyDay.purchases += Number(row.total) || 0;
        }
      }
    });
  }

  const dayList = Object.keys(days).sort().reverse().map(function (key) {
    const row = days[key];
    return {
      date: row.date,
      count: row.count,
      cash: money(row.cash),
      card: money(row.card),
      gift: money(row.gift),
      prepaid: money(row.prepaid),
      total: money(row.total),
      refundCash: money(row.refundCash),
      refundCard: money(row.refundCard)
    };
  });
  const ledger = Object.keys(days).sort().reverse().map(function (key) {
    const row = days[key];
    return {
      date: row.date,
      cash: money(row.cash),
      card: money(row.card),
      gift: money(row.gift),
      prepaid: money(row.prepaid),
      refundCash: money(row.refundCash),
      refundCard: money(row.refundCard),
      drops: money(row.drops),
      purchases: showStock ? money(row.purchases) : null,
      waste: showStock ? money(row.waste) : null,
      discount: money(row.discount),
      complimentary: money(row.complimentary),
      difference: money(row.difference)
    };
  });

  const cred = stock.creditorsAsOf(stockStore.purchases, to);
  const inv = stock.inventoryAsOf(stockStore, to);
  const payRows = clock.payroll(userList, from, to, punches);
  const wageTotal = payRows.reduce(function (sum, row) {
    return sum + (Number(row.amount) || 0);
  }, 0);

  const pnl = {
    sales: pay.total,
    cost: showCost ? money(cost) : null,
    waste: showStock ? money(wasteTotal) : null,
    wasteBy: showStock ? wasteBy : null,
    purchases: showStock ? money(purchaseTotal) : null,
    discount: money(discountTotal),
    complimentary: money(compTotal),
    refund: money(pay.refundCash + pay.refundCard),
    vatRate: vatPercent,
    vat: vatPercent > 0 ? money(pay.total * vatPercent / (100 + vatPercent)) : 0,
    wages: money(wageTotal),
    inventory: showStock ? inv.total : null,
    creditors: showStock ? cred.due : null,
    profit: showCost ? money(pay.total - cost - (showStock ? wasteTotal : 0) - wageTotal) : null
  };

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    cashbook: cashbook,
    cashSum: cashSum,
    payments: pay,
    methods: methodList,
    days: dayList,
    ledger: ledger,
    pnl: pnl,
    waste: wasteRows.slice(0, 80),
    creditors: showStock ? cred : { suppliers: [], open: [], due: 0 },
    inventory: showStock ? inv : { items: [], total: null, at: to.toISOString() },
    payroll: { rows: payRows, total: money(wageTotal) }
  };
}

function report(from, to, opts) {
  const showCost = !!(opts && opts.showCost) && settings.isStockMode();
  const showStock = !!(opts && opts.showStock) && settings.isStockMode();
  const all = orders.readAllOrders().orders || [];
  const data = build({
    from: from,
    to: to,
    showCost: showCost,
    showStock: showStock,
    orders: all.filter(function (order) {
      return settings.matchesBranch(order, opts && opts.branch);
    }),
    shifts: shifts.readStore().shifts,
    catalog: catalog.readCatalog(),
    stock: stock.readStock(),
    book: reservations.readReservations(),
    terminals: terminals.listAll(),
    vatPercent: settings.readSettings().vatPercent || 0,
    users: users.readStore().users.map(users.publicUser),
    punches: clock.readStore().punches
  });
  data.branches = settings.collectBranches(all);
  return data;
}

module.exports = {
  money: money,
  parseBound: parseBound,
  build: build,
  report: report
};
