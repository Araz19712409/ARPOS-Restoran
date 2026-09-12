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

function lotQty(lots, warehouseId) {
  const want = warehouseId == null ? 0 : warehouseIdOf(warehouseId);
  return qtyOf((lots || []).reduce(function (sum, lot) {
    if (want && warehouseIdOf(lot.warehouseId) !== want) {
      return sum;
    }
    return sum + (Number(lot.qty) || 0);
  }, 0));
}

function warehouseIdOf(value) {
  const n = Math.round(Number(value));
  if (!Number.isInteger(n) || n < 1) {
    return 1;
  }
  return n;
}

function defaultWarehouses() {
  return [{ id: 1, name: 'Əsas', active: true }];
}

function qtyAt(item, warehouseId) {
  ensureLots(item);
  if (warehouseId == null) {
    return lotQty(item && item.lots);
  }
  return lotQty(item && item.lots, warehouseId);
}

function fifoValue(item, warehouseId) {
  ensureLots(item);
  const want = warehouseId == null ? 0 : warehouseIdOf(warehouseId);
  return money((item.lots || []).reduce(function (sum, lot) {
    if (want && warehouseIdOf(lot.warehouseId) !== want) {
      return sum;
    }
    return sum + (Number(lot.qty) || 0) * (Number(lot.buyPrice) || 0);
  }, 0));
}

function fifoAvg(item, warehouseId) {
  const qty = warehouseId == null ? lotQty(item && item.lots) : lotQty(item && item.lots, warehouseId);
  if (qty <= 0) {
    return money(item && item.buyPrice);
  }
  const val = fifoValue(item, warehouseId);
  return money(val / qty);
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
      item.lots = [{ qty: qty, buyPrice: money(item.buyPrice), at: '', warehouseId: 1 }];
    }
  }
  item.lots.forEach(function (lot) {
    lot.warehouseId = warehouseIdOf(lot.warehouseId);
  });
  return item;
}

function fifoAdd(item, qty, price, at, warehouseId) {
  const add = qtyOf(qty);
  if (!item || add <= 0) {
    return;
  }
  ensureLots(item);
  item.lots.push({
    qty: add,
    buyPrice: money(price),
    at: at || '',
    warehouseId: warehouseIdOf(warehouseId)
  });
  item.qty = lotQty(item.lots);
  item.buyPrice = fifoAvg(item);
}

function fifoConsume(item, qty, warehouseId) {
  let need = qtyOf(qty);
  let cost = 0;
  if (!item || need <= 0) {
    return 0;
  }
  ensureLots(item);
  const wid = warehouseIdOf(warehouseId);
  while (need > 0) {
    let idx = -1;
    for (let i = 0; i < item.lots.length; i += 1) {
      if (warehouseIdOf(item.lots[i].warehouseId) === wid) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      break;
    }
    const lot = item.lots[idx];
    const take = qtyOf(Math.min(qtyOf(lot.qty), need));
    cost += take * money(lot.buyPrice);
    lot.qty = qtyOf(lot.qty - take);
    need = qtyOf(need - take);
    if (lot.qty <= 0) {
      item.lots.splice(idx, 1);
    }
  }
  item.qty = lotQty(item.lots);
  item.buyPrice = fifoAvg(item);
  return money(cost);
}

function fifoSetQty(item, qty, warehouseId) {
  const next = qtyOf(qty);
  const wid = warehouseIdOf(warehouseId);
  const price = fifoAvg(item, wid);
  ensureLots(item);
  item.lots = (item.lots || []).filter(function (lot) {
    return warehouseIdOf(lot.warehouseId) !== wid;
  });
  if (next > 0) {
    item.lots.push({ qty: next, buyPrice: price, at: '', warehouseId: wid });
  }
  item.qty = lotQty(item.lots);
  item.buyPrice = fifoAvg(item);
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
    if (move.type === 'in' || move.type === 'void' || move.type === 'inv_plus' || move.type === 'prod_in' || move.type === 'xfer_in') {
      let price = money(item.buyPrice);
      if (move.purchaseId) {
        const fromBuy = purchaseLinePrice(stockStore.purchases, move.purchaseId, item.id);
        if (fromBuy != null) {
          price = fromBuy;
        }
      } else if (move.buyPrice != null) {
        price = money(move.buyPrice);
      }
      fifoAdd(item, qty, price, move.at, move.warehouseId);
    } else if (move.type === 'sale' || move.type === 'out' || move.type === 'inv_minus' || move.type === 'prod_use' || move.type === 'xfer_out') {
      fifoConsume(item, qty, move.warehouseId);
    } else if (move.type === 'count' || move.type === 'adjust') {
      fifoSetQty(item, qty, move.warehouseId);
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

function packWarehouses(raw) {
  const src = Array.isArray(raw && raw.warehouses) ? raw.warehouses : [];
  const out = [];
  const seen = {};
  src.forEach(function (row) {
    const id = Number(row && row.id);
    if (!Number.isInteger(id) || id < 1 || seen[id]) {
      return;
    }
    seen[id] = true;
    out.push({
      id: id,
      name: String((row && row.name) || ('Sklad ' + id)).trim().slice(0, 40) || ('Sklad ' + id),
      active: row && row.active === false ? false : true
    });
  });
  if (!out.length) {
    return defaultWarehouses();
  }
  return out;
}

function maxWarehouseId(list) {
  return (list || []).reduce(function (max, row) {
    return Math.max(max, Number(row.id) || 0);
  }, 0);
}

function findWarehouse(box, id) {
  const wid = warehouseIdOf(id);
  const list = (box && box.warehouses) || [];
  return list.find(function (row) { return row.id === wid; }) || list.find(function (row) { return row.id === 1; }) || list[0] || defaultWarehouses()[0];
}

function salesWarehouseId(box) {
  let want = 1;
  try {
    const cfg = require('./settings').readSettings();
    want = warehouseIdOf(cfg && cfg.stock && cfg.stock.salesWarehouseId);
  } catch (error) {
    want = 1;
  }
  const list = (box && box.warehouses) || [];
  if (!list.length) {
    return want;
  }
  const hit = list.find(function (row) {
    return row.id === want && row.active !== false;
  });
  if (hit) {
    return hit.id;
  }
  const main = list.find(function (row) {
    return row.id === 1;
  });
  return main ? main.id : list[0].id;
}

function requireWarehouse(box, id, opts) {
  const wid = warehouseIdOf(id);
  const row = ((box && box.warehouses) || []).find(function (item) {
    return item.id === wid;
  });
  if (!row) {
    return { error: 'Sklad tapılmadı.' };
  }
  if (!(opts && opts.allowInactive) && row.active === false) {
    return { error: 'Sklad aktiv deyil.' };
  }
  return { warehouse: row };
}

function warehouseName(box, id) {
  const row = ((box && box.warehouses) || []).find(function (item) {
    return item.id === warehouseIdOf(id);
  });
  return row ? row.name : ('#' + warehouseIdOf(id));
}

function activeWarehouseCount(box) {
  return ((box && box.warehouses) || []).filter(function (row) {
    return row.active !== false;
  }).length;
}

function defaults() {
  return {
    nextItemId: 1,
    nextMoveId: 1,
    nextPurchaseId: 1,
    nextInventoryId: 1,
    nextProductionId: 1,
    nextWarehouseId: 2,
    nextTransferId: 1,
    warehouses: defaultWarehouses(),
    items: [],
    moves: [],
    purchases: [],
    inventories: [],
    productions: [],
    transfers: [],
    suppliers: []
  };
}

function packStock(raw) {
  const warehouses = packWarehouses(raw);
  const packed = {
    nextItemId: Number(raw.nextItemId) || 1,
    nextMoveId: Number(raw.nextMoveId) || 1,
    nextPurchaseId: Number(raw.nextPurchaseId) || 1,
    nextInventoryId: Number(raw.nextInventoryId) || 1,
    nextProductionId: Number(raw.nextProductionId) || 1,
    nextWarehouseId: Math.max(Number(raw.nextWarehouseId) || 1, maxWarehouseId(warehouses) + 1),
    nextTransferId: Number(raw.nextTransferId) || 1,
    warehouses: warehouses,
    items: (Array.isArray(raw.items) ? raw.items : []).map(function (item) {
      return ensureLots(item);
    }),
    moves: Array.isArray(raw.moves) ? raw.moves : [],
    purchases: Array.isArray(raw.purchases) ? raw.purchases : [],
    inventories: Array.isArray(raw.inventories) ? raw.inventories : [],
    productions: Array.isArray(raw.productions) ? raw.productions : [],
    transfers: Array.isArray(raw.transfers) ? raw.transfers : [],
    suppliers: cleanSuppliers(raw.suppliers)
  };
  packed.moves.forEach(function (move) {
    if (move.fromId) {
      move.fromId = warehouseIdOf(move.fromId);
    }
    if (move.toId) {
      move.toId = warehouseIdOf(move.toId);
    }
    move.warehouseId = warehouseIdOf(move.warehouseId);
  });
  packed.inventories.forEach(function (row) {
    row.warehouseId = warehouseIdOf(row.warehouseId);
  });
  packed.productions.forEach(function (row) {
    row.fromWarehouseId = warehouseIdOf(row.fromWarehouseId || row.warehouseId);
    row.toWarehouseId = warehouseIdOf(row.toWarehouseId || row.warehouseId);
  });
  packed.purchases.forEach(function (row) {
    row.warehouseId = warehouseIdOf(row.warehouseId);
  });
  packed.transfers.forEach(function (row) {
    row.fromId = warehouseIdOf(row.fromId);
    row.toId = warehouseIdOf(row.toId);
  });
  return packed;
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

function itemKind(item) {
  return item && item.kind === 'semi' ? 'semi' : 'raw';
}

function clampLossPct(value) {
  const n = Number(num.parseDec(value));
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.min(20, Number(n.toFixed(2)));
}

function applyKindRecipe(item, body, box) {
  const kind = String((body && body.kind) != null ? body.kind : (item && item.kind) || 'raw') === 'semi'
    ? 'semi'
    : 'raw';
  item.kind = kind;
  if (kind !== 'semi') {
    item.recipe = [];
    return null;
  }
  const src = body && Object.prototype.hasOwnProperty.call(body, 'recipe')
    ? body.recipe
    : (item.recipe || []);
  const rec = parseRecipe(src);
  if (!rec.length) {
    return { error: 'Yarımfabrikat resepti yazın.' };
  }
  for (let i = 0; i < rec.length; i += 1) {
    const ing = rec[i];
    if (Number(ing.itemId) === Number(item.id)) {
      return { error: 'Özünə istinad olmaz.' };
    }
    const raw = (box.items || []).find(function (row) {
      return row.id === Number(ing.itemId);
    });
    if (!raw) {
      return { error: 'Resept xammalı tapılmadı.' };
    }
    if (itemKind(raw) === 'semi') {
      return { error: 'Resept yalnız xammal (1 səviyyə).' };
    }
    const conv = recipeStockQty(ing, raw);
    if (conv.error) {
      return { error: conv.error };
    }
  }
  item.recipe = rec;
  return null;
}

function expandProductionLines(box, output, outputQty, lossPct) {
  const factor = 1 + clampLossPct(lossPct) / 100;
  const lines = [];
  const rec = parseRecipe(output && output.recipe);
  for (let i = 0; i < rec.length; i += 1) {
    const ing = rec[i];
    const raw = (box.items || []).find(function (row) {
      return row.id === Number(ing.itemId);
    });
    if (!raw || itemKind(raw) === 'semi') {
      return { error: 'Resept yalnız xammal (1 səviyyə).' };
    }
    if (Number(raw.id) === Number(output.id)) {
      return { error: 'Özünə istinad olmaz.' };
    }
    const conv = recipeStockQty(ing, raw);
    if (conv.error) {
      return { error: conv.error };
    }
    lines.push({
      itemId: raw.id,
      name: raw.name,
      unit: raw.unit || 'əd',
      needQty: qtyOf(conv.qty * outputQty * factor)
    });
  }
  if (!lines.length) {
    return { error: 'Yarımfabrikat resepti yazın.' };
  }
  return { lines: lines };
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

function publicItem(item, warehouseId) {
  ensureLots(item);
  const filter = warehouseId == null || warehouseId === '' || warehouseId === 'all' ? null : warehouseIdOf(warehouseId);
  const qty = filter ? qtyAt(item, filter) : qtyOf(item.qty);
  const minQty = qtyOf(item.minQty);
  return {
    id: item.id,
    name: item.name,
    unit: item.unit || 'əd',
    qty: qty,
    minQty: minQty,
    buyPrice: fifoAvg(item, filter),
    kind: item.kind === 'semi' ? 'semi' : 'raw',
    recipe: parseRecipe(item.recipe),
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
      kind: current && current.kind === 'semi' ? 'semi' : 'raw',
      recipe: current && Array.isArray(current.recipe) ? current.recipe : [],
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

function publicItemLinked(item, box, catalogStore, warehouseId) {
  const pub = publicItem(item, warehouseId);
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
  const kindErr = applyKindRecipe(parsed.item, body || {}, box);
  if (kindErr) {
    return kindErr;
  }
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
  const kindErr = applyKindRecipe(current, body || {}, box);
  if (kindErr) {
    return kindErr;
  }
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

function moveStock(itemId, type, amount, note, warehouseId) {
  const qty = qtyOf(amount);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: 'Miqdar düzgün deyil.' };
  }
  if (['in', 'out', 'adjust', 'count'].indexOf(type) === -1) {
    return { error: 'Hərəkət növü səhvdir.' };
  }
  const box = readStock();
  const wh = requireWarehouse(box, warehouseId);
  if (wh.error) {
    return wh;
  }
  const wid = wh.warehouse.id;
  const item = box.items.find(function (row) { return row.id === Number(itemId); });
  if (!item) {
    return { error: 'Xammal tapılmadı.' };
  }
  item.touched = true;
  ensureLots(item);
  const at = new Date().toISOString();
  if (type === 'in') {
    fifoAdd(item, qty, fifoAvg(item, wid), at, wid);
  } else if (type === 'out') {
    if (qtyAt(item, wid) < qty) {
      return { error: item.name + ' çatmır. Qalıq: ' + qtyAt(item, wid) + ' ' + item.unit };
    }
    fifoConsume(item, qty, wid);
  } else {
    fifoSetQty(item, qty, wid);
  }
  box.moves.push({
    id: box.nextMoveId,
    itemId: item.id,
    type: type,
    qty: qty,
    buyPrice: money(item.buyPrice),
    warehouseId: wid,
    note: String(note || '').trim().slice(0, 80),
    at: at
  });
  box.nextMoveId += 1;
  writeStock(box);
  return { item: publicItem(item, wid) };
}

function cleanReasonCode(value) {
  const id = String(value || '').trim();
  if (id === 'spoil' || id === 'break' || id === 'staff' || id === 'other') {
    return id;
  }
  return '';
}

function reasonLabel(code) {
  if (code === 'spoil') {
    return 'xarab';
  }
  if (code === 'break') {
    return 'töküldü';
  }
  if (code === 'staff') {
    return 'ev';
  }
  if (code === 'other') {
    return 'digər';
  }
  return '';
}

function writeOff(itemId, amount, reasonCode, note, warehouseId) {
  const code = cleanReasonCode(reasonCode);
  if (!code) {
    return { error: 'Səbəb seçin.' };
  }
  const prefix = reasonLabel(code);
  const extra = String(note || '').trim();
  const text = (prefix + (extra ? ': ' + extra : '')).slice(0, 80);
  const out = moveStock(itemId, 'out', amount, text, warehouseId);
  if (out.error) {
    return out;
  }
  const box = readStock();
  const last = box.moves[box.moves.length - 1];
  if (last && last.itemId === Number(itemId) && last.type === 'out') {
    last.reasonCode = code;
    writeStock(box);
  }
  return out;
}

function publicInventory(row) {
  return {
    id: row.id,
    status: row.status === 'done' ? 'done' : 'draft',
    at: row.at || '',
    confirmedAt: row.confirmedAt || '',
    by: row.by || '',
    warehouseId: warehouseIdOf(row.warehouseId),
    counts: (row.counts || []).map(function (line) {
      return {
        itemId: Number(line.itemId),
        name: line.name || '',
        unit: line.unit || 'əd',
        systemQty: qtyOf(line.systemQty),
        countedQty: qtyOf(line.countedQty)
      };
    })
  };
}

function listInventories(box) {
  const store = box || readStock();
  return (store.inventories || []).slice().reverse().map(publicInventory);
}

function createInventoryDraft(who, warehouseId) {
  const box = readStock();
  const wh = requireWarehouse(box, warehouseId);
  if (wh.error) {
    return wh;
  }
  const wid = wh.warehouse.id;
  const counts = (box.items || []).map(function (item) {
    ensureLots(item);
    const q = qtyAt(item, wid);
    return {
      itemId: item.id,
      name: item.name,
      unit: item.unit || 'əd',
      systemQty: q,
      countedQty: q
    };
  });
  if (!counts.length) {
    return { error: 'Xammal yoxdur.' };
  }
  const doc = {
    id: box.nextInventoryId,
    status: 'draft',
    at: new Date().toISOString(),
    confirmedAt: '',
    by: String(who || '').trim().slice(0, 40),
    warehouseId: wid,
    counts: counts
  };
  box.nextInventoryId += 1;
  box.inventories = box.inventories || [];
  box.inventories.push(doc);
  writeStock(box);
  return { inventory: publicInventory(doc) };
}

function updateInventoryLines(id, lines) {
  const box = readStock();
  const doc = (box.inventories || []).find(function (row) {
    return row.id === Number(id);
  });
  if (!doc) {
    return { error: 'Sayım tapılmadı.' };
  }
  if (doc.status !== 'draft') {
    return { error: 'Təsdiq olunmuş sənəd dəyişmir.' };
  }
  const incoming = Array.isArray(lines) ? lines : [];
  incoming.forEach(function (row) {
    const line = (doc.counts || []).find(function (item) {
      return item.itemId === Number(row.itemId);
    });
    if (!line) {
      return;
    }
    if (row.countedQty == null || row.countedQty === '') {
      return;
    }
    const counted = qtyOf(row.countedQty);
    if (!Number.isFinite(counted) || counted < 0) {
      return;
    }
    line.countedQty = counted;
  });
  writeStock(box);
  return { inventory: publicInventory(doc) };
}

function confirmInventory(id, who) {
  const box = readStock();
  const doc = (box.inventories || []).find(function (row) {
    return row.id === Number(id);
  });
  if (!doc) {
    return { error: 'Sayım tapılmadı.' };
  }
  if (doc.status !== 'draft') {
    return { error: 'Artıq təsdiqlənib.' };
  }
  const wid = warehouseIdOf(doc.warehouseId);
  const at = new Date().toISOString();
  const ops = [];
  for (let i = 0; i < (doc.counts || []).length; i += 1) {
    const line = doc.counts[i];
    const systemQty = qtyOf(line.systemQty);
    const countedQty = qtyOf(line.countedQty);
    const diff = qtyOf(countedQty - systemQty);
    if (diff === 0) {
      continue;
    }
    const item = box.items.find(function (row) {
      return row.id === Number(line.itemId);
    });
    if (!item) {
      return { error: (line.name || 'Xammal') + ' tapılmadı.' };
    }
    ensureLots(item);
    if (diff < 0 && qtyAt(item, wid) < qtyOf(-diff)) {
      return { error: item.name + ' çatmır. Qalıq: ' + qtyAt(item, wid) + ' ' + item.unit };
    }
    ops.push({ item: item, diff: diff, line: line });
  }
  ops.forEach(function (op) {
    const item = op.item;
    const diff = op.diff;
    const qty = qtyOf(Math.abs(diff));
    item.touched = true;
    ensureLots(item);
    const type = diff > 0 ? 'inv_plus' : 'inv_minus';
    let price = fifoAvg(item, wid);
    if (type === 'inv_plus') {
      fifoAdd(item, qty, price, at, wid);
    } else {
      fifoConsume(item, qty, wid);
      price = money(item.buyPrice);
    }
    box.moves.push({
      id: box.nextMoveId,
      itemId: item.id,
      type: type,
      qty: qty,
      buyPrice: money(price),
      warehouseId: wid,
      inventoryId: doc.id,
      note: ('İnventar #' + doc.id).slice(0, 80),
      at: at
    });
    box.nextMoveId += 1;
  });
  doc.status = 'done';
  doc.confirmedAt = at;
  if (who) {
    doc.by = String(who || '').trim().slice(0, 40);
  }
  writeStock(box);
  return { inventory: publicInventory(doc) };
}

function publicProduction(row) {
  return {
    id: row.id,
    status: row.status === 'done' ? 'done' : 'draft',
    at: row.at || '',
    confirmedAt: row.confirmedAt || '',
    by: row.by || '',
    fromWarehouseId: warehouseIdOf(row.fromWarehouseId),
    toWarehouseId: warehouseIdOf(row.toWarehouseId),
    outputItemId: Number(row.outputItemId) || 0,
    outputName: row.outputName || '',
    outputUnit: row.outputUnit || 'əd',
    outputQty: qtyOf(row.outputQty),
    lossPct: clampLossPct(row.lossPct),
    lines: (row.lines || []).map(function (line) {
      return {
        itemId: Number(line.itemId),
        name: line.name || '',
        unit: line.unit || 'əd',
        needQty: qtyOf(line.needQty)
      };
    })
  };
}

function listProductions(box) {
  const store = box || readStock();
  return (store.productions || []).slice().reverse().map(publicProduction);
}

function createProductionDraft(body, who) {
  const outputQty = qtyOf(body && body.outputQty);
  if (!Number.isFinite(outputQty) || outputQty <= 0) {
    return { error: 'İstehsal miqdarı düzgün deyil.' };
  }
  const lossPct = clampLossPct(body && body.lossPct);
  const box = readStock();
  const fromWh = requireWarehouse(box, body && body.fromWarehouseId);
  if (fromWh.error) {
    return fromWh;
  }
  const toWh = requireWarehouse(box, body && body.toWarehouseId);
  if (toWh.error) {
    return toWh;
  }
  const output = box.items.find(function (row) {
    return row.id === Number(body && body.outputItemId);
  });
  if (!output || itemKind(output) !== 'semi') {
    return { error: 'Yarımfabrikat seçin.' };
  }
  const built = expandProductionLines(box, output, outputQty, lossPct);
  if (built.error) {
    return built;
  }
  const doc = {
    id: box.nextProductionId,
    status: 'draft',
    at: new Date().toISOString(),
    confirmedAt: '',
    by: String(who || '').trim().slice(0, 40),
    outputItemId: output.id,
    outputName: output.name,
    outputUnit: output.unit || 'əd',
    outputQty: outputQty,
    lossPct: lossPct,
    fromWarehouseId: fromWh.warehouse.id,
    toWarehouseId: toWh.warehouse.id,
    lines: built.lines
  };
  box.nextProductionId += 1;
  box.productions = box.productions || [];
  box.productions.push(doc);
  writeStock(box);
  return { production: publicProduction(doc) };
}

function updateProductionDraft(id, body) {
  const box = readStock();
  const doc = (box.productions || []).find(function (row) {
    return row.id === Number(id);
  });
  if (!doc) {
    return { error: 'Akt tapılmadı.' };
  }
  if (doc.status !== 'draft') {
    return { error: 'Təsdiq olunmuş akt dəyişmir.' };
  }
  if (body && body.outputQty != null) {
    const q = qtyOf(body.outputQty);
    if (!Number.isFinite(q) || q <= 0) {
      return { error: 'İstehsal miqdarı düzgün deyil.' };
    }
    doc.outputQty = q;
  }
  if (body && body.lossPct != null) {
    doc.lossPct = clampLossPct(body.lossPct);
  }
  if (body && body.fromWarehouseId != null) {
    const fromWh = requireWarehouse(box, body.fromWarehouseId);
    if (fromWh.error) {
      return fromWh;
    }
    doc.fromWarehouseId = fromWh.warehouse.id;
  }
  if (body && body.toWarehouseId != null) {
    const toWh = requireWarehouse(box, body.toWarehouseId);
    if (toWh.error) {
      return toWh;
    }
    doc.toWarehouseId = toWh.warehouse.id;
  }
  const output = box.items.find(function (row) {
    return row.id === Number(doc.outputItemId);
  });
  if (!output || itemKind(output) !== 'semi') {
    return { error: 'Yarımfabrikat tapılmadı.' };
  }
  doc.outputName = output.name;
  doc.outputUnit = output.unit || 'əd';
  const built = expandProductionLines(box, output, doc.outputQty, doc.lossPct);
  if (built.error) {
    return built;
  }
  doc.lines = built.lines;
  writeStock(box);
  return { production: publicProduction(doc) };
}

function confirmProduction(id, who) {
  const box = readStock();
  const doc = (box.productions || []).find(function (row) {
    return row.id === Number(id);
  });
  if (!doc) {
    return { error: 'Akt tapılmadı.' };
  }
  if (doc.status !== 'draft') {
    return { error: 'Artıq təsdiqlənib.' };
  }
  const outputQty = qtyOf(doc.outputQty);
  if (!Number.isFinite(outputQty) || outputQty <= 0) {
    return { error: 'İstehsal miqdarı düzgün deyil.' };
  }
  const output = box.items.find(function (row) {
    return row.id === Number(doc.outputItemId);
  });
  if (!output || itemKind(output) !== 'semi') {
    return { error: 'Yarımfabrikat tapılmadı.' };
  }
  const fromId = warehouseIdOf(doc.fromWarehouseId);
  const toId = warehouseIdOf(doc.toWarehouseId);
  const lines = doc.lines || [];
  if (!lines.length) {
    return { error: 'Yarımfabrikat resepti yazın.' };
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const need = qtyOf(line.needQty);
    if (!Number.isFinite(need) || need <= 0) {
      return { error: 'Sərf miqdarı düzgün deyil.' };
    }
    const raw = box.items.find(function (row) {
      return row.id === Number(line.itemId);
    });
    if (!raw) {
      return { error: (line.name || 'Xammal') + ' tapılmadı.' };
    }
    if (itemKind(raw) === 'semi' || Number(raw.id) === Number(output.id)) {
      return { error: 'Resept yalnız xammal (1 səviyyə).' };
    }
    ensureLots(raw);
    if (qtyAt(raw, fromId) < need) {
      return { error: raw.name + ' çatmır. Lazım: ' + need + ' ' + raw.unit + ', qalıq: ' + qtyAt(raw, fromId) };
    }
  }
  const at = new Date().toISOString();
  const note = ('İstehsal #' + doc.id).slice(0, 80);
  let costSum = 0;
  lines.forEach(function (line) {
    const raw = box.items.find(function (row) {
      return row.id === Number(line.itemId);
    });
    const need = qtyOf(line.needQty);
    raw.touched = true;
    ensureLots(raw);
    const cost = fifoConsume(raw, need, fromId);
    costSum += Number(cost) || 0;
    box.moves.push({
      id: box.nextMoveId,
      itemId: raw.id,
      type: 'prod_use',
      qty: need,
      buyPrice: money(raw.buyPrice),
      warehouseId: fromId,
      productionId: doc.id,
      note: note,
      at: at
    });
    box.nextMoveId += 1;
  });
  const unitCost = money(costSum / outputQty);
  output.touched = true;
  ensureLots(output);
  fifoAdd(output, outputQty, unitCost, at, toId);
  box.moves.push({
    id: box.nextMoveId,
    itemId: output.id,
    type: 'prod_in',
    qty: outputQty,
    buyPrice: unitCost,
    warehouseId: toId,
    productionId: doc.id,
    note: note,
    at: at
  });
  box.nextMoveId += 1;
  doc.status = 'done';
  doc.confirmedAt = at;
  if (who) {
    doc.by = String(who || '').trim().slice(0, 40);
  }
  writeStock(box);
  return { production: publicProduction(doc) };
}

function publicPurchase(row) {
  return {
    id: row.id,
    at: row.at,
    supplier: row.supplier || '',
    docNo: row.docNo || '',
    warehouseId: warehouseIdOf(row.warehouseId),
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
  const wh = requireWarehouse(box, body && body.warehouseId);
  if (wh.error) {
    return wh;
  }
  const wid = wh.warehouse.id;
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
    fifoAdd(item, line.qty, line.buyPrice, at, wid);
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
      warehouseId: wid,
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
    warehouseId: wid,
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
  const wid = salesWarehouseId(box);
  const need = collected.need;
  const keys = Object.keys(need);
  for (let i = 0; i < keys.length; i += 1) {
    const item = box.items.find(function (row) { return row.id === Number(keys[i]); });
    if (!item) {
      return 'Resept xammalı tapılmadı.';
    }
    if (qtyAt(item, wid) < need[keys[i]]) {
      return item.name + ' çatmır. Lazım: ' + need[keys[i]] + ' ' + item.unit +
        ', qalıq: ' + qtyAt(item, wid);
    }
  }
  return '';
}

function changeLines(catalogStore, lines, sign, meta) {
  const box = readStock();
  const wid = salesWarehouseId(box);
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
      if (sign > 0 && qtyAt(item, wid) < need) {
        warns.push(item.name + ' çatmır');
        return;
      }
      const at = new Date().toISOString();
      const price = fifoAvg(item, wid);
      if (sign > 0) {
        fifoConsume(item, need, wid);
      } else {
        fifoAdd(item, need, price, at, wid);
      }
      item.touched = true;
      box.moves.push({
        id: box.nextMoveId,
        itemId: item.id,
        type: sign > 0 ? 'sale' : 'void',
        qty: need,
        buyPrice: price,
        warehouseId: wid,
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

function publicWarehouse(row) {
  return {
    id: Number(row.id),
    name: row.name || '',
    active: row.active !== false
  };
}

function listWarehouses(box) {
  const store = box || readStock();
  return (store.warehouses || []).map(publicWarehouse);
}

function createWarehouse(body) {
  const name = String((body && body.name) || '').trim().slice(0, 40);
  if (!name) {
    return { error: 'Sklad adını yazın.' };
  }
  const box = readStock();
  const dup = (box.warehouses || []).some(function (row) {
    return String(row.name || '').trim().toLowerCase() === name.toLowerCase();
  });
  if (dup) {
    return { error: '"' + name + '" artıq var.' };
  }
  const row = { id: box.nextWarehouseId, name: name, active: true };
  box.nextWarehouseId += 1;
  box.warehouses.push(row);
  writeStock(box);
  return { warehouse: publicWarehouse(row) };
}

function updateWarehouse(id, body) {
  const box = readStock();
  const row = (box.warehouses || []).find(function (item) {
    return item.id === Number(id);
  });
  if (!row) {
    return { error: 'Sklad tapılmadı.' };
  }
  if (body && body.name != null) {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) {
      return { error: 'Sklad adını yazın.' };
    }
    const dup = (box.warehouses || []).some(function (item) {
      return item.id !== row.id && String(item.name || '').trim().toLowerCase() === name.toLowerCase();
    });
    if (dup) {
      return { error: '"' + name + '" artıq var.' };
    }
    row.name = name;
  }
  if (body && body.active === false) {
    if (activeWarehouseCount(box) <= 1) {
      return { error: 'Son aktiv skladu bağlamaq olmaz.' };
    }
    row.active = false;
  } else if (body && (body.active === true || body.active === 1 || body.active === '1')) {
    row.active = true;
  }
  writeStock(box);
  return { warehouse: publicWarehouse(row) };
}

function warehouseInUse(box, wid) {
  const id = warehouseIdOf(wid);
  const qtyHit = (box.items || []).some(function (item) {
    return qtyAt(item, id) > 0;
  });
  if (qtyHit) {
    return true;
  }
  if ((box.moves || []).some(function (row) {
    return warehouseIdOf(row.warehouseId) === id ||
      (row.fromId && warehouseIdOf(row.fromId) === id) ||
      (row.toId && warehouseIdOf(row.toId) === id);
  })) {
    return true;
  }
  if ((box.purchases || []).some(function (row) { return warehouseIdOf(row.warehouseId) === id; })) {
    return true;
  }
  if ((box.inventories || []).some(function (row) { return warehouseIdOf(row.warehouseId) === id; })) {
    return true;
  }
  if ((box.productions || []).some(function (row) {
    return warehouseIdOf(row.fromWarehouseId) === id || warehouseIdOf(row.toWarehouseId) === id;
  })) {
    return true;
  }
  if ((box.transfers || []).some(function (row) {
    return warehouseIdOf(row.fromId) === id || warehouseIdOf(row.toId) === id;
  })) {
    return true;
  }
  return false;
}

function removeWarehouse(id) {
  const box = readStock();
  const row = (box.warehouses || []).find(function (item) {
    return item.id === Number(id);
  });
  if (!row) {
    return { error: 'Sklad tapılmadı.' };
  }
  if ((box.warehouses || []).length <= 1) {
    return { error: 'Son skladu silmək olmaz.' };
  }
  if (row.active !== false && activeWarehouseCount(box) <= 1) {
    return { error: 'Son aktiv skladu silmək olmaz.' };
  }
  if (salesWarehouseId(box) === row.id) {
    return { error: 'Satış anbarını silmək olmaz.' };
  }
  if (warehouseInUse(box, row.id)) {
    return { error: 'Qalıq və ya hərəkət var.' };
  }
  box.warehouses = box.warehouses.filter(function (item) {
    return item.id !== row.id;
  });
  writeStock(box);
  return { warehouse: publicWarehouse(row) };
}

function publicTransfer(row, box) {
  return {
    id: row.id,
    status: row.status === 'done' ? 'done' : 'draft',
    at: row.at || '',
    confirmedAt: row.confirmedAt || '',
    by: row.by || '',
    fromId: warehouseIdOf(row.fromId),
    toId: warehouseIdOf(row.toId),
    fromName: warehouseName(box, row.fromId),
    toName: warehouseName(box, row.toId),
    lines: (row.lines || []).map(function (line) {
      return {
        itemId: Number(line.itemId),
        name: line.name || '',
        unit: line.unit || 'əd',
        qty: qtyOf(line.qty)
      };
    })
  };
}

function listTransfers(box) {
  const store = box || readStock();
  return (store.transfers || []).slice().reverse().map(function (row) {
    return publicTransfer(row, store);
  });
}

function parseTransferLines(box, rawLines) {
  const lines = [];
  (Array.isArray(rawLines) ? rawLines : []).forEach(function (row) {
    const item = box.items.find(function (it) { return it.id === Number(row.itemId); });
    const qty = qtyOf(row.qty);
    if (!item || !Number.isFinite(qty) || qty <= 0) {
      return;
    }
    lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit || 'əd',
      qty: qty
    });
  });
  return lines;
}

function createTransferDraft(body, who) {
  const box = readStock();
  const fromWh = requireWarehouse(box, body && body.fromId);
  if (fromWh.error) {
    return fromWh;
  }
  const toWh = requireWarehouse(box, body && body.toId);
  if (toWh.error) {
    return toWh;
  }
  if (fromWh.warehouse.id === toWh.warehouse.id) {
    return { error: 'Eyni sklada köçürmə olmaz.' };
  }
  const lines = parseTransferLines(box, body && body.lines);
  if (!lines.length) {
    return { error: 'Köçürmə sətri yazın.' };
  }
  const doc = {
    id: box.nextTransferId,
    status: 'draft',
    at: new Date().toISOString(),
    confirmedAt: '',
    by: String(who || '').trim().slice(0, 40),
    fromId: fromWh.warehouse.id,
    toId: toWh.warehouse.id,
    lines: lines
  };
  box.nextTransferId += 1;
  box.transfers = box.transfers || [];
  box.transfers.push(doc);
  writeStock(box);
  return { transfer: publicTransfer(doc, box) };
}

function updateTransferDraft(id, body) {
  const box = readStock();
  const doc = (box.transfers || []).find(function (row) {
    return row.id === Number(id);
  });
  if (!doc) {
    return { error: 'Köçürmə tapılmadı.' };
  }
  if (doc.status !== 'draft') {
    return { error: 'Təsdiq olunmuş sənəd dəyişmir.' };
  }
  if (body && body.fromId != null) {
    const fromWh = requireWarehouse(box, body.fromId);
    if (fromWh.error) {
      return fromWh;
    }
    doc.fromId = fromWh.warehouse.id;
  }
  if (body && body.toId != null) {
    const toWh = requireWarehouse(box, body.toId);
    if (toWh.error) {
      return toWh;
    }
    doc.toId = toWh.warehouse.id;
  }
  if (doc.fromId === doc.toId) {
    return { error: 'Eyni sklada köçürmə olmaz.' };
  }
  if (body && body.lines) {
    const lines = parseTransferLines(box, body.lines);
    if (!lines.length) {
      return { error: 'Köçürmə sətri yazın.' };
    }
    doc.lines = lines;
  }
  writeStock(box);
  return { transfer: publicTransfer(doc, box) };
}

function fifoShift(item, qty, fromId, toId, at) {
  const parts = [];
  let need = qtyOf(qty);
  const wid = warehouseIdOf(fromId);
  ensureLots(item);
  while (need > 0) {
    let idx = -1;
    for (let i = 0; i < item.lots.length; i += 1) {
      if (warehouseIdOf(item.lots[i].warehouseId) === wid) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      break;
    }
    const lot = item.lots[idx];
    const take = qtyOf(Math.min(qtyOf(lot.qty), need));
    parts.push({ qty: take, buyPrice: money(lot.buyPrice) });
    lot.qty = qtyOf(lot.qty - take);
    need = qtyOf(need - take);
    if (lot.qty <= 0) {
      item.lots.splice(idx, 1);
    }
  }
  item.qty = lotQty(item.lots);
  item.buyPrice = fifoAvg(item);
  parts.forEach(function (part) {
    fifoAdd(item, part.qty, part.buyPrice, at, toId);
  });
  return parts;
}

function confirmTransfer(id, who) {
  const box = readStock();
  const doc = (box.transfers || []).find(function (row) {
    return row.id === Number(id);
  });
  if (!doc) {
    return { error: 'Köçürmə tapılmadı.' };
  }
  if (doc.status !== 'draft') {
    return { error: 'Artıq təsdiqlənib.' };
  }
  const fromWh = requireWarehouse(box, doc.fromId);
  if (fromWh.error) {
    return fromWh;
  }
  const toWh = requireWarehouse(box, doc.toId);
  if (toWh.error) {
    return toWh;
  }
  if (fromWh.warehouse.id === toWh.warehouse.id) {
    return { error: 'Eyni sklada köçürmə olmaz.' };
  }
  const fromId = fromWh.warehouse.id;
  const toId = toWh.warehouse.id;
  const lines = doc.lines || [];
  if (!lines.length) {
    return { error: 'Köçürmə sətri yazın.' };
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const qty = qtyOf(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: 'Miqdar düzgün deyil.' };
    }
    const item = box.items.find(function (row) {
      return row.id === Number(line.itemId);
    });
    if (!item) {
      return { error: (line.name || 'Xammal') + ' tapılmadı.' };
    }
    if (qtyAt(item, fromId) < qty) {
      return { error: item.name + ' çatmır. Qalıq: ' + qtyAt(item, fromId) + ' ' + item.unit };
    }
  }
  const at = new Date().toISOString();
  const note = ('Köçürmə #' + doc.id).slice(0, 80);
  lines.forEach(function (line) {
    const item = box.items.find(function (row) {
      return row.id === Number(line.itemId);
    });
    const qty = qtyOf(line.qty);
    item.touched = true;
    const parts = fifoShift(item, qty, fromId, toId, at);
    parts.forEach(function (part) {
      box.moves.push({
        id: box.nextMoveId,
        itemId: item.id,
        type: 'xfer_out',
        qty: part.qty,
        buyPrice: part.buyPrice,
        warehouseId: fromId,
        fromId: fromId,
        toId: toId,
        transferId: doc.id,
        note: note,
        at: at
      });
      box.nextMoveId += 1;
      box.moves.push({
        id: box.nextMoveId,
        itemId: item.id,
        type: 'xfer_in',
        qty: part.qty,
        buyPrice: part.buyPrice,
        warehouseId: toId,
        fromId: fromId,
        toId: toId,
        transferId: doc.id,
        note: note,
        at: at
      });
      box.nextMoveId += 1;
    });
  });
  doc.status = 'done';
  doc.confirmedAt = at;
  if (who) {
    doc.by = String(who || '').trim().slice(0, 40);
  }
  writeStock(box);
  return { transfer: publicTransfer(doc, box) };
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
  writeOff: writeOff,
  listInventories: listInventories,
  createInventoryDraft: createInventoryDraft,
  updateInventoryLines: updateInventoryLines,
  confirmInventory: confirmInventory,
  listProductions: listProductions,
  createProductionDraft: createProductionDraft,
  updateProductionDraft: updateProductionDraft,
  confirmProduction: confirmProduction,
  listWarehouses: listWarehouses,
  createWarehouse: createWarehouse,
  updateWarehouse: updateWarehouse,
  removeWarehouse: removeWarehouse,
  listTransfers: listTransfers,
  createTransferDraft: createTransferDraft,
  updateTransferDraft: updateTransferDraft,
  confirmTransfer: confirmTransfer,
  salesWarehouseId: salesWarehouseId,
  qtyAt: qtyAt,
  itemKind: itemKind,
  cleanReasonCode: cleanReasonCode,
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
