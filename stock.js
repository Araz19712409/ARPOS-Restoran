const path = require('path');
const store = require('./store');
const num = require('./num');
const db = require('./db');

function stockFile() {
  return path.join(db.dataDir(), 'stock.json');
}

function money(value) {
  const n = num.parseDec(value);
  return Number(((Number.isFinite(n) ? n : 0)).toFixed(2));
}

function qtyOf(value) {
  const n = num.parseDec(value);
  return Number(((Number.isFinite(n) ? n : 0)).toFixed(3));
}

const UNIT_BASE = {
  kq: { kind: 'mass', toBase: 1000 },
  qr: { kind: 'mass', toBase: 1 },
  l: { kind: 'vol', toBase: 1000 },
  ml: { kind: 'vol', toBase: 1 },
  'əd': { kind: 'each', toBase: 1 }
};

function cleanUnit(value, fallback) {
  const unit = String(value || '').trim();
  if (UNIT_BASE[unit]) {
    return unit;
  }
  const fb = String(fallback || '').trim();
  return UNIT_BASE[fb] ? fb : '';
}

function toStockQty(qty, fromUnit, stockUnit) {
  const from = UNIT_BASE[cleanUnit(fromUnit, stockUnit)];
  const to = UNIT_BASE[cleanUnit(stockUnit, 'əd')];
  if (!from || !to) {
    return { error: 'Vahid tapılmadı.' };
  }
  if (from.kind !== to.kind) {
    return { error: fromUnit + ' → ' + stockUnit + ' çevrilmir.' };
  }
  return { qty: qtyOf(Number(qty) * from.toBase / to.toBase) };
}

function recipeStockQty(ing, item) {
  if (!item) {
    return { error: 'Xammal tapılmadı.' };
  }
  const from = cleanUnit(ing && ing.unit, '');
  if (!from) {
    return { error: (item.name || 'Xammal') + ': resept vahidi yazılmayıb.' };
  }
  return toStockQty(ing.qty, from, item.unit);
}

function lotQty(lots) {
  return qtyOf((lots || []).reduce(function (sum, lot) {
    return sum + (Number(lot.qty) || 0);
  }, 0));
}

function fifoValue(item) {
  ensureLots(item);
  return money((item.lots || []).reduce(function (sum, lot) {
    return sum + (Number(lot.qty) || 0) * (Number(lot.buyPrice) || 0);
  }, 0));
}

function fifoAvg(item) {
  const qty = lotQty(item && item.lots);
  if (qty <= 0) {
    return money(item && item.buyPrice);
  }
  return money(fifoValue(item) / qty);
}

function ensureLots(item) {
  if (!item) {
    return item;
  }
  if (!Array.isArray(item.lots)) {
    item.lots = [];
  }
  if (!item.lots.length) {
    const qty = qtyOf(item.qty);
    if (qty > 0) {
      item.lots = [{ qty: qty, buyPrice: money(item.buyPrice), at: '' }];
    }
  }
  return item;
}

function fifoAdd(item, qty, price, at) {
  const add = qtyOf(qty);
  if (!item || add <= 0) {
    return;
  }
  ensureLots(item);
  item.lots.push({
    qty: add,
    buyPrice: money(price),
    at: at || ''
  });
  item.qty = lotQty(item.lots);
  item.buyPrice = fifoAvg(item);
}

function fifoConsume(item, qty) {
  let need = qtyOf(qty);
  let cost = 0;
  if (!item || need <= 0) {
    return 0;
  }
  ensureLots(item);
  while (need > 0 && item.lots.length) {
    const lot = item.lots[0];
    const take = qtyOf(Math.min(qtyOf(lot.qty), need));
    cost += take * money(lot.buyPrice);
    lot.qty = qtyOf(lot.qty - take);
    need = qtyOf(need - take);
    if (lot.qty <= 0) {
      item.lots.shift();
    }
  }
  item.qty = lotQty(item.lots);
  item.buyPrice = fifoAvg(item);
  return money(cost);
}

function fifoSetQty(item, qty) {
  const next = qtyOf(qty);
  const price = fifoAvg(item);
  item.lots = next > 0 ? [{ qty: next, buyPrice: price, at: '' }] : [];
  item.qty = next;
  item.buyPrice = price;
}

function paidOf(row, to) {
  const total = money(row && row.total);
  const limit = to ? new Date(to) : null;
  if (limit && Number.isNaN(limit.getTime())) {
    return 0;
  }
  if (Array.isArray(row && row.payments) && row.payments.length) {
    let paid = 0;
    row.payments.forEach(function (pay) {
      if (limit && new Date(pay.at) > limit) {
        return;
      }
      paid += Number(pay.amount) || 0;
    });
    return money(Math.min(total, paid));
  }
  if (row && row.paidAmount != null && Number.isFinite(Number(row.paidAmount))) {
    if (limit && new Date(row.at) > limit) {
      return 0;
    }
    return money(Math.min(total, Number(row.paidAmount)));
  }
  if (row && row.credit) {
    return 0;
  }
  if (limit && row && new Date(row.at) > limit) {
    return 0;
  }
  return total;
}

function dueOf(row, to) {
  return money(Math.max(0, money(row && row.total) - paidOf(row, to)));
}

function creditorsAsOf(purchases, to) {
  const by = {};
  const open = [];
  (purchases || []).forEach(function (row) {
    if (to && new Date(row.at) > new Date(to)) {
      return;
    }
    const due = dueOf(row, to);
    if (due <= 0) {
      return;
    }
    const paid = paidOf(row, to);
    const total = money(row.total);
    const name = String(row.supplier || '').trim() || '—';
    if (!by[name]) {
      by[name] = { supplier: name, total: 0, paid: 0, due: 0, count: 0 };
    }
    by[name].total = money(by[name].total + total);
    by[name].paid = money(by[name].paid + paid);
    by[name].due = money(by[name].due + due);
    by[name].count += 1;
    open.push({
      id: row.id || 0,
      at: row.at || '',
      supplier: name,
      docNo: row.docNo || '',
      total: total,
      paid: paid,
      due: due
    });
  });
  const suppliers = Object.keys(by).sort().map(function (key) {
    return by[key];
  });
  const due = money(suppliers.reduce(function (sum, row) {
    return sum + row.due;
  }, 0));
  open.sort(function (a, b) {
    return String(a.at) < String(b.at) ? 1 : -1;
  });
  return { suppliers: suppliers, open: open.slice(0, 80), due: due };
}

function purchaseLinePrice(purchases, purchaseId, itemId) {
  const doc = (purchases || []).find(function (row) {
    return Number(row.id) === Number(purchaseId);
  });
  if (!doc) {
    return null;
  }
  const line = (doc.lines || []).find(function (row) {
    return Number(row.itemId) === Number(itemId);
  });
  return line ? money(line.buyPrice) : null;
}

function inventoryAsOf(stockStore, at) {
  const to = at instanceof Date ? at : new Date(at);
  const items = (stockStore.items || []).map(function (row) {
    return {
      id: row.id,
      name: row.name,
      unit: row.unit || 'əd',
      minQty: row.minQty,
      buyPrice: money(row.buyPrice),
      qty: 0,
      lots: []
    };
  });
  const byId = {};
  items.forEach(function (item) {
    byId[item.id] = item;
  });
  const moved = {};
  (stockStore.moves || []).filter(function (move) {
    const stamp = new Date(move.at);
    return !Number.isNaN(stamp.getTime()) && stamp <= to;
  }).sort(function (a, b) {
    const cmp = String(a.at).localeCompare(String(b.at));
    return cmp !== 0 ? cmp : (Number(a.id) || 0) - (Number(b.id) || 0);
  }).forEach(function (move) {
    const item = byId[Number(move.itemId)];
    if (!item) {
      return;
    }
    moved[item.id] = true;
    const qty = qtyOf(move.qty);
    if (move.type === 'in' || move.type === 'void') {
      let price = money(item.buyPrice);
      if (move.purchaseId) {
        const fromBuy = purchaseLinePrice(stockStore.purchases, move.purchaseId, item.id);
        if (fromBuy != null) {
          price = fromBuy;
        }
      } else if (move.buyPrice != null) {
        price = money(move.buyPrice);
      }
      fifoAdd(item, qty, price, move.at);
    } else if (move.type === 'sale' || move.type === 'out') {
      fifoConsume(item, qty);
    } else if (move.type === 'count' || move.type === 'adjust') {
      fifoSetQty(item, qty);
    }
  });
  items.forEach(function (item) {
    if (moved[item.id]) {
      return;
    }
    const src = (stockStore.items || []).find(function (row) {
      return row.id === item.id;
    });
    if (!src) {
      return;
    }
    item.qty = qtyOf(src.qty);
    item.lots = JSON.parse(JSON.stringify(src.lots || []));
    ensureLots(item);
    item.qty = lotQty(item.lots);
    item.buyPrice = fifoAvg(item);
  });
  const rows = items.map(function (item) {
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      qty: qtyOf(item.qty),
      buyPrice: fifoAvg(item),
      value: fifoValue(item)
    };
  }).filter(function (row) {
    return row.qty > 0 || row.value > 0;
  });
  const total = money(rows.reduce(function (sum, row) {
    return sum + row.value;
  }, 0));
  return {
    at: Number.isNaN(to.getTime()) ? '' : to.toISOString(),
    items: rows,
    total: total
  };
}

function defaults() {
  return { nextItemId: 1, nextMoveId: 1, nextPurchaseId: 1, items: [], moves: [], purchases: [], suppliers: [] };
}

function packStock(raw) {
  return {
    nextItemId: Number(raw.nextItemId) || 1,
    nextMoveId: Number(raw.nextMoveId) || 1,
    nextPurchaseId: Number(raw.nextPurchaseId) || 1,
    items: (Array.isArray(raw.items) ? raw.items : []).map(function (item) {
      return ensureLots(item);
    }),
    moves: Array.isArray(raw.moves) ? raw.moves : [],
    purchases: Array.isArray(raw.purchases) ? raw.purchases : [],
    suppliers: cleanSuppliers(raw.suppliers)
  };
}

function readStock() {
  if (db.migrated()) {
    return packStock(db.loadStock());
  }
  try {
    return packStock(store.readJson(stockFile()));
  } catch (error) {
    return defaults();
  }
}

function writeStock(data) {
  data.suppliers = cleanSuppliers(data && data.suppliers);
  if (db.migrated()) {
    db.saveStock(data);
    return;
  }
  const all = data.purchases || [];
  const byId = {};
  all.slice(-80).forEach(function (row) {
    if (row && row.id != null) {
      byId[row.id] = row;
    }
  });
  all.forEach(function (row) {
    if (row && row.id != null && dueOf(row) > 0) {
      byId[row.id] = row;
    }
  });
  data.purchases = Object.keys(byId).map(function (id) { return byId[id]; });
  data.moves = (data.moves || []).slice(-300);
  store.writeJson(stockFile(), data);
}

function parseRecipe(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map(function (row) {
    return {
      itemId: Number(row.itemId),
      qty: qtyOf(row.qty),
      unit: cleanUnit(row.unit, '')
    };
  }).filter(function (row) {
    return row.itemId > 0 && Number.isFinite(row.qty) && row.qty > 0;
  });
}

function lineIngredients(product, line) {
  const list = parseRecipe(product && product.ingredients);
  (line && line.modifiers || []).forEach(function (mod) {
    parseRecipe(mod.ingredients).forEach(function (ing) {
      list.push(ing);
    });
  });
  return list;
}

function productAllIngredients(product) {
  const list = parseRecipe(product && product.ingredients);
  ['portions', 'extras'].forEach(function (key) {
    ((product && product[key]) || []).forEach(function (mod) {
      parseRecipe(mod.ingredients).forEach(function (ing) {
        list.push(ing);
      });
    });
  });
  return list;
}

function recipeCost(product, stockStore) {
  const box = stockStore || readStock();
  let sum = 0;
  parseRecipe(product && product.ingredients).forEach(function (line) {
    const item = box.items.find(function (row) { return row.id === line.itemId; });
    if (item) {
      const conv = recipeStockQty(line, item);
      if (!conv.error) {
        sum += fifoAvg(item) * conv.qty;
      }
    }
  });
  return money(sum);
}

function lineCost(product, stockStore, line) {
  const box = stockStore || readStock();
  if (line && (line.modifiers || []).length) {
    let sum = 0;
    lineIngredients(product, line).forEach(function (ing) {
      const item = box.items.find(function (row) { return row.id === ing.itemId; });
      if (!item) {
        return;
      }
      const conv = recipeStockQty(ing, item);
      if (!conv.error) {
        sum += fifoAvg(item) * conv.qty;
      }
    });
    return money(sum);
  }
  if (product && product.costPrice != null && Number.isFinite(Number(product.costPrice))) {
    return money(product.costPrice);
  }
  const recipe = parseRecipe(product && product.ingredients);
  if (recipe.length) {
    return recipeCost(product, stockStore);
  }
  return money(product && product.buyPrice);
}

function applyRecipe(product, stockStore) {
  product.ingredients = parseRecipe(product.ingredients);
  const calc = product.ingredients.length
    ? recipeCost(product, stockStore)
    : money(product.buyPrice);
  const given = Number(product.buyPrice);
  if (product.ingredients.length) {
    product.buyPrice = Number.isFinite(given) ? money(given) : calc;
  } else {
    product.buyPrice = Number.isFinite(given) ? money(given) : 0;
  }
  product.costPrice = money(product.buyPrice);
  return product;
}

function publicItem(item) {
  const qty = qtyOf(item.qty);
  const minQty = qtyOf(item.minQty);
  return {
    id: item.id,
    name: item.name,
    unit: item.unit || 'əd',
    qty: qty,
    minQty: minQty,
    buyPrice: money(item.buyPrice),
    low: minQty > 0 && qty <= minQty
  };
}

function upsertItem(body, current) {
  const name = String((body && body.name) || (current && current.name) || '').trim().slice(0, 40);
  if (!name) {
    return { error: 'Xammal adını yazın.' };
  }
  const unit = String((body && body.unit) || (current && current.unit) || 'əd').trim().slice(0, 8);
  const allowed = { 'əd': 1, 'kq': 1, 'l': 1, 'qr': 1, 'ml': 1 };
  if (!allowed[unit]) {
    return { error: 'Vahid: əd, kq, l, qr, ml.' };
  }
  return {
    item: {
      id: current ? current.id : 0,
      name: name,
      unit: unit,
      qty: body && body.qty != null ? qtyOf(body.qty) : (current ? qtyOf(current.qty) : 0),
      minQty: body && body.minQty != null ? qtyOf(body.minQty) : (current ? qtyOf(current.minQty) : 0),
      buyPrice: body && body.buyPrice != null ? money(body.buyPrice) : (current ? money(current.buyPrice) : 0),
      lots: current && Array.isArray(current.lots) ? current.lots : []
    }
  };
}

function nameTaken(box, name, exceptId) {
  const needle = String(name || '').trim().toLowerCase();
  return (box.items || []).some(function (row) {
    return row.id !== Number(exceptId) && String(row.name || '').trim().toLowerCase() === needle;
  });
}

function itemLinks(itemId, box, catalogStore) {
  const id = Number(itemId);
  const item = (box.items || []).find(function (row) { return row.id === id; });
  const recipes = [];
  ((catalogStore && catalogStore.products) || []).forEach(function (product) {
    productAllIngredients(product).forEach(function (ing) {
      if (ing.itemId === id && recipes.indexOf(product.name) === -1) {
        recipes.push(product.name);
      }
    });
  });
  const hasMoves = !!(item && item.touched) || (box.moves || []).some(function (row) {
    return row.itemId === id;
  }) || (box.purchases || []).some(function (row) {
    return (row.lines || []).some(function (line) {
      return line.itemId === id;
    });
  });
  return { inRecipe: recipes.length > 0, recipes: recipes, hasMoves: hasMoves };
}

function publicItemLinked(item, box, catalogStore) {
  const pub = publicItem(item);
  const links = itemLinks(item.id, box, catalogStore);
  pub.inRecipe = links.inRecipe;
  pub.recipes = links.recipes;
  pub.hasMoves = links.hasMoves;
  return pub;
}

function recipeLockText(recipes) {
  const names = (recipes || []).slice(0, 4).join(', ');
  const more = (recipes || []).length > 4 ? '…' : '';
  return 'Reseptdədir: ' + names + more + '. Əvvəl tərkibdən çıxarın.';
}

function supplierNameOf(row) {
  if (typeof row === 'string') {
    return row.trim().slice(0, 40);
  }
  if (row && typeof row === 'object' && row.name) {
    return String(row.name).trim().slice(0, 40);
  }
  return '';
}

function cleanSuppliers(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach(function (row) {
    const n = supplierNameOf(row);
    if (!n) {
      return;
    }
    const key = n.toLowerCase();
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    out.push(n);
  });
  return out;
}

function rememberSupplier(box, name) {
  box.suppliers = cleanSuppliers((box.suppliers || []).concat([name]));
}

function createItem(body, who) {
  const parsed = upsertItem(Object.assign({}, body || {}, { qty: 0 }), null);
  if (parsed.error) {
    return parsed;
  }
  const box = readStock();
  if (nameTaken(box, parsed.item.name, 0)) {
    return { error: '"' + parsed.item.name + '" artıq var.' };
  }
  parsed.item.id = box.nextItemId;
  box.nextItemId += 1;
  box.items.push(parsed.item);
  writeStock(box);
  return { item: publicItem(parsed.item) };
}

function updateItem(itemId, body, catalogStore) {
  const box = readStock();
  const current = box.items.find(function (row) { return row.id === Number(itemId); });
  if (!current) {
    return { error: 'Xammal tapılmadı.' };
  }
  const parsed = upsertItem(body, current);
  if (parsed.error) {
    return parsed;
  }
  if (nameTaken(box, parsed.item.name, current.id)) {
    return { error: '"' + parsed.item.name + '" artıq var.' };
  }
  const links = itemLinks(current.id, box, catalogStore);
  if (parsed.item.unit !== current.unit &&
      (qtyOf(current.qty) !== 0 || links.hasMoves || links.inRecipe)) {
    return { error: 'Vahid dəyişmir: qalıq və ya hərəkət var.' };
  }
  current.name = parsed.item.name;
  current.unit = parsed.item.unit;
  current.minQty = parsed.item.minQty;
  current.buyPrice = parsed.item.buyPrice;
  writeStock(box);
  return { item: publicItemLinked(current, box, catalogStore) };
}

function removeItem(itemId, opts) {
  const box = readStock();
  const current = box.items.find(function (row) { return row.id === Number(itemId); });
  if (!current) {
    return { error: 'Xammal tapılmadı.' };
  }
  const links = itemLinks(current.id, box, opts && opts.catalog);
  if (links.inRecipe) {
    return { error: recipeLockText(links.recipes) };
  }
  if (links.hasMoves && !(opts && opts.force)) {
    return { error: 'Hərəkət var. Silmək üçün Anbar → Sil icazəsi lazımdır.' };
  }
  box.items = box.items.filter(function (row) { return row.id !== current.id; });
  writeStock(box);
  return { item: publicItem(current) };
}

function moveStock(itemId, type, amount, note) {
  const qty = qtyOf(amount);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: 'Miqdar düzgün deyil.' };
  }
  if (['in', 'out', 'adjust', 'count'].indexOf(type) === -1) {
    return { error: 'Hərəkət növü səhvdir.' };
  }
  const box = readStock();
  const item = box.items.find(function (row) { return row.id === Number(itemId); });
  if (!item) {
    return { error: 'Xammal tapılmadı.' };
  }
  item.touched = true;
  ensureLots(item);
  if (type === 'in') {
    fifoAdd(item, qty, item.buyPrice, new Date().toISOString());
  } else if (type === 'out') {
    if (qtyOf(item.qty) < qty) {
      return { error: item.name + ' çatmır. Qalıq: ' + item.qty + ' ' + item.unit };
    }
    fifoConsume(item, qty);
  } else {
    fifoSetQty(item, qty);
  }
  box.moves.push({
    id: box.nextMoveId,
    itemId: item.id,
    type: type,
    qty: qty,
    buyPrice: money(item.buyPrice),
    note: String(note || '').trim().slice(0, 80),
    at: new Date().toISOString()
  });
  box.nextMoveId += 1;
  writeStock(box);
  return { item: publicItem(item) };
}

function publicPurchase(row) {
  return {
    id: row.id,
    at: row.at,
    supplier: row.supplier || '',
    docNo: row.docNo || '',
    total: money(row.total),
    paid: paidOf(row),
    due: dueOf(row),
    credit: dueOf(row) > 0,
    by: row.by || '',
    lines: (row.lines || []).map(function (line) {
      return {
        itemId: line.itemId,
        name: line.name,
        unit: line.unit,
        qty: qtyOf(line.qty),
        buyPrice: money(line.buyPrice),
        total: money(line.total)
      };
    })
  };
}

function addPurchase(body, who) {
  const supplier = String((body && body.supplier) || '').trim().slice(0, 40);
  const docNo = String((body && body.docNo) || '').trim().slice(0, 20);
  const rawLines = body && Array.isArray(body.lines) ? body.lines : [];
  const box = readStock();
  const lines = [];
  rawLines.forEach(function (row) {
    const item = box.items.find(function (it) { return it.id === Number(row.itemId); });
    const qty = qtyOf(row.qty);
    const price = money(row.buyPrice);
    if (!item || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      return;
    }
    lines.push({ item: item, qty: qty, buyPrice: price });
  });
  if (!lines.length) {
    return { error: 'Alış sətri yazın.' };
  }
  const saved = [];
  let total = 0;
  const at = new Date().toISOString();
  const purchaseId = box.nextPurchaseId;
  const credit = body.credit === true || body.credit === 1 || body.credit === '1';
  lines.forEach(function (line) {
    const item = line.item;
    const lineTotal = money(line.qty * line.buyPrice);
    fifoAdd(item, line.qty, line.buyPrice, at);
    item.touched = true;
    total += lineTotal;
    saved.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      qty: line.qty,
      buyPrice: line.buyPrice,
      total: lineTotal
    });
    box.moves.push({
      id: box.nextMoveId,
      itemId: item.id,
      type: 'in',
      qty: line.qty,
      buyPrice: line.buyPrice,
      note: ('Alış' + (docNo ? ' ' + docNo : '')).slice(0, 80),
      purchaseId: purchaseId,
      at: at
    });
    box.nextMoveId += 1;
  });
  const paid = credit ? 0 : money(total);
  const purchase = {
    id: purchaseId,
    at: at,
    supplier: supplier,
    docNo: docNo,
    total: money(total),
    paidAmount: paid,
    credit: credit,
    payments: paid > 0 ? [{ at: at, amount: paid, by: String(who || '').trim().slice(0, 40) }] : [],
    by: String(who || '').trim().slice(0, 40),
    lines: saved
  };
  box.nextPurchaseId += 1;
  box.purchases.push(purchase);
  rememberSupplier(box, supplier);
  writeStock(box);
  return { purchase: publicPurchase(purchase) };
}

function payPurchase(id, amount, who) {
  const box = readStock();
  const row = (box.purchases || []).find(function (item) {
    return Number(item.id) === Number(id);
  });
  if (!row) {
    return { error: 'Alış tapılmadı.' };
  }
  const due = dueOf(row);
  if (due <= 0) {
    return { error: 'Bu sənəd ödənilib.' };
  }
  const pay = amount == null || amount === '' ? due : money(amount);
  if (!Number.isFinite(pay) || pay <= 0) {
    return { error: 'Məbləğ düzgün deyil.' };
  }
  const take = money(Math.min(due, pay));
  if (!Array.isArray(row.payments) || !row.payments.length) {
    const already = paidOf(row);
    row.payments = already > 0 ? [{ at: row.at, amount: already, by: row.by || '' }] : [];
  }
  row.payments.push({
    at: new Date().toISOString(),
    amount: take,
    by: String(who || '').trim().slice(0, 40)
  });
  row.paidAmount = paidOf(row);
  row.credit = dueOf(row) > 0;
  writeStock(box);
  return { purchase: publicPurchase(row), paid: take };
}

function collectNeed(catalogStore, lines) {
  const box = readStock();
  const need = {};
  let error = '';
  (lines || []).forEach(function (line) {
    if (error || line.voided) {
      return;
    }
    const product = (catalogStore.products || []).find(function (row) {
      return row.id === Number(line.productId);
    });
    if (!product) {
      return;
    }
    lineIngredients(product, line).forEach(function (ing) {
      if (error) {
        return;
      }
      const item = box.items.find(function (row) { return row.id === ing.itemId; });
      const key = String(ing.itemId);
      if (!item) {
        need[key] = qtyOf((need[key] || 0) + 0.001);
        return;
      }
      const conv = recipeStockQty(ing, item);
      if (conv.error) {
        error = conv.error;
        return;
      }
      need[key] = qtyOf((need[key] || 0) + conv.qty * Number(line.qty || 0));
    });
  });
  return { need: need, error: error };
}

function needMap(catalogStore, lines) {
  return collectNeed(catalogStore, lines).need;
}

function lackMessage(catalogStore, lines) {
  const collected = collectNeed(catalogStore, lines);
  if (collected.error) {
    return collected.error;
  }
  const box = readStock();
  const need = collected.need;
  const keys = Object.keys(need);
  for (let i = 0; i < keys.length; i += 1) {
    const item = box.items.find(function (row) { return row.id === Number(keys[i]); });
    if (!item) {
      return 'Resept xammalı tapılmadı.';
    }
    if (qtyOf(item.qty) < need[keys[i]]) {
      return item.name + ' çatmır. Lazım: ' + need[keys[i]] + ' ' + item.unit +
        ', qalıq: ' + item.qty;
    }
  }
  return '';
}

function changeLines(catalogStore, lines, sign, meta) {
  const box = readStock();
  const warns = [];
  (lines || []).forEach(function (line) {
    if (line.voided) {
      return;
    }
    const product = (catalogStore.products || []).find(function (row) {
      return row.id === Number(line.productId);
    });
    if (!product) {
      return;
    }
    lineIngredients(product, line).forEach(function (ing) {
      const item = box.items.find(function (row) { return row.id === ing.itemId; });
      if (!item) {
        warns.push('Resept xammalı tapılmadı.');
        return;
      }
      const conv = recipeStockQty(ing, item);
      if (conv.error) {
        warns.push(item.name + ': ' + conv.error);
        return;
      }
      const need = qtyOf(conv.qty * Number(line.qty || 0));
      if (sign > 0 && qtyOf(item.qty) < need) {
        warns.push(item.name + ' çatmır');
        return;
      }
      const at = new Date().toISOString();
      const price = fifoAvg(item);
      if (sign > 0) {
        fifoConsume(item, need);
      } else {
        fifoAdd(item, need, price, at);
      }
      item.touched = true;
      box.moves.push({
        id: box.nextMoveId,
        itemId: item.id,
        type: sign > 0 ? 'sale' : 'void',
        qty: need,
        buyPrice: price,
        orderId: meta && meta.orderId,
        productId: product.id,
        at: at
      });
      box.nextMoveId += 1;
      if (qtyOf(item.minQty) > 0 && item.qty <= qtyOf(item.minQty)) {
        warns.push(item.name + ' az qalıb');
      }
    });
  });
  writeStock(box);
  return warns;
}

function listPurchasesForApi(box, limit) {
  const cap = Number(limit) || 80;
  const all = box.purchases || [];
  const byId = {};
  all.slice(-40).forEach(function (row) {
    if (row && row.id != null) {
      byId[row.id] = row;
    }
  });
  all.forEach(function (row) {
    if (row && row.id != null && dueOf(row) > 0) {
      byId[row.id] = row;
    }
  });
  return Object.keys(byId).map(function (id) {
    return byId[id];
  }).sort(function (a, b) {
    return String(a.at) < String(b.at) ? 1 : -1;
  }).slice(0, cap).map(publicPurchase);
}

function lowItems() {
  return readStock().items.map(publicItem).filter(function (item) {
    return item.low;
  });
}

function deductLines(catalogStore, lines, meta) {
  return changeLines(catalogStore, lines, 1, meta);
}

function restockLines(catalogStore, lines, meta) {
  return changeLines(catalogStore, lines, -1, meta);
}

module.exports = {
  parseDec: num.parseDec,
  readStock: readStock,
  writeStock: writeStock,
  parseRecipe: parseRecipe,
  recipeCost: recipeCost,
  lineCost: lineCost,
  applyRecipe: applyRecipe,
  publicItem: publicItem,
  publicItemLinked: publicItemLinked,
  publicPurchase: publicPurchase,
  listPurchasesForApi: listPurchasesForApi,
  upsertItem: upsertItem,
  itemLinks: itemLinks,
  createItem: createItem,
  updateItem: updateItem,
  removeItem: removeItem,
  moveStock: moveStock,
  addPurchase: addPurchase,
  payPurchase: payPurchase,
  fifoAdd: fifoAdd,
  fifoConsume: fifoConsume,
  fifoAvg: fifoAvg,
  inventoryAsOf: inventoryAsOf,
  creditorsAsOf: creditorsAsOf,
  paidOf: paidOf,
  dueOf: dueOf,
  lowItems: lowItems,
  deductLines: deductLines,
  restockLines: restockLines,
  lackMessage: lackMessage
};
