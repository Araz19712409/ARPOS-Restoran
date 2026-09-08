const path = require('path');
const store = require('./store');
const num = require('./num');

const FILE = path.join(__dirname, 'data', 'stock.json');

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

function defaults() {
  return { nextItemId: 1, nextMoveId: 1, nextPurchaseId: 1, items: [], moves: [], purchases: [], suppliers: [] };
}

function readStock() {
  try {
    const raw = store.readJson(FILE);
    return {
      nextItemId: Number(raw.nextItemId) || 1,
      nextMoveId: Number(raw.nextMoveId) || 1,
      nextPurchaseId: Number(raw.nextPurchaseId) || 1,
      items: Array.isArray(raw.items) ? raw.items : [],
      moves: Array.isArray(raw.moves) ? raw.moves : [],
      purchases: Array.isArray(raw.purchases) ? raw.purchases : [],
      suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : []
    };
  } catch (error) {
    return defaults();
  }
}

function writeStock(data) {
  data.moves = (data.moves || []).slice(-300);
  data.purchases = (data.purchases || []).slice(-80);
  store.writeJson(FILE, data);
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
        sum += money(item.buyPrice) * conv.qty;
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
        sum += money(item.buyPrice) * conv.qty;
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
    low: qty <= minQty
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
      buyPrice: body && body.buyPrice != null ? money(body.buyPrice) : (current ? money(current.buyPrice) : 0)
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

function rememberSupplier(box, name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) {
    return;
  }
  box.suppliers = Array.isArray(box.suppliers) ? box.suppliers : [];
  const low = n.toLowerCase();
  if (!box.suppliers.some(function (row) { return String(row).toLowerCase() === low; })) {
    box.suppliers.push(n);
  }
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
  if (type === 'in') {
    item.qty = qtyOf(item.qty + qty);
  } else if (type === 'out') {
    if (qtyOf(item.qty) < qty) {
      return { error: item.name + ' çatmır. Qalıq: ' + item.qty + ' ' + item.unit };
    }
    item.qty = qtyOf(item.qty - qty);
  } else {
    item.qty = qty;
    if (type === 'count') {
      type = 'count';
    }
  }
  box.moves.push({
    id: box.nextMoveId,
    itemId: item.id,
    type: type,
    qty: qty,
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
  lines.forEach(function (line) {
    const item = line.item;
    const oldQty = qtyOf(item.qty);
    const oldPrice = money(item.buyPrice);
    const lineTotal = money(line.qty * line.buyPrice);
    if (oldQty > 0) {
      item.buyPrice = money((oldQty * oldPrice + line.qty * line.buyPrice) / (oldQty + line.qty));
    } else {
      item.buyPrice = line.buyPrice;
    }
    item.qty = qtyOf(oldQty + line.qty);
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
      note: ('Alış' + (docNo ? ' ' + docNo : '')).slice(0, 80),
      purchaseId: purchaseId,
      at: at
    });
    box.nextMoveId += 1;
  });
  const purchase = {
    id: purchaseId,
    at: at,
    supplier: supplier,
    docNo: docNo,
    total: money(total),
    by: String(who || '').trim().slice(0, 40),
    lines: saved
  };
  box.nextPurchaseId += 1;
  box.purchases.push(purchase);
  rememberSupplier(box, supplier);
  writeStock(box);
  return { purchase: publicPurchase(purchase) };
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
      item.qty = qtyOf(Number(item.qty) - need * sign);
      item.touched = true;
      box.moves.push({
        id: box.nextMoveId,
        itemId: item.id,
        type: sign > 0 ? 'sale' : 'void',
        qty: need,
        orderId: meta && meta.orderId,
        productId: product.id,
        at: new Date().toISOString()
      });
      box.nextMoveId += 1;
      if (item.qty <= qtyOf(item.minQty)) {
        warns.push(item.name + ' az qalıb');
      }
    });
  });
  writeStock(box);
  return warns;
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
  upsertItem: upsertItem,
  itemLinks: itemLinks,
  createItem: createItem,
  updateItem: updateItem,
  removeItem: removeItem,
  moveStock: moveStock,
  addPurchase: addPurchase,
  deductLines: deductLines,
  restockLines: restockLines,
  lackMessage: lackMessage
};
