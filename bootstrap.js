'use strict';

const catalog = require('./catalog');
const stock = require('./stock');
const settings = require('./settings');

function cleanName(value, max) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .trim()
    .slice(0, max || 60);
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function findByName(list, name) {
  return (list || []).find(function (row) {
    return sameName(row.name, name);
  }) || null;
}

function findProductInGroup(products, groupId, name) {
  return (products || []).find(function (row) {
    return Number(row.groupId) === Number(groupId) && sameName(row.name, name);
  }) || null;
}

function parseSalePrice(value) {
  const n = stock.parseDec(value);
  if (!Number.isFinite(n) || n < 0 || n > 10000) {
    return null;
  }
  return Number(n.toFixed(2));
}

function parseOptionalQty(value) {
  if (value == null || String(value).trim() === '') {
    return null;
  }
  const n = stock.parseDec(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: 'Miqdar düzgün deyil.' };
  }
  if (n === 0) {
    return null;
  }
  return n;
}

function parseOptionalBuy(value) {
  if (value == null || String(value).trim() === '') {
    return null;
  }
  const n = stock.parseDec(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) {
    return { error: 'Alış qiyməti düzgün deyil.' };
  }
  return Number(n.toFixed(2));
}

function cleanUnit(value) {
  const unit = String(value || '').trim().slice(0, 8);
  if (!unit) {
    return '';
  }
  const allowed = { 'əd': 1, 'kq': 1, 'l': 1, 'qr': 1, 'ml': 1 };
  if (!allowed[unit]) {
    return { error: 'Vahid: əd, kq, l, qr, ml.' };
  }
  return unit;
}

function normalizeLines(rawLines) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  const out = [];
  const warnings = [];
  lines.forEach(function (row, idx) {
    const groupName = cleanName(row && row.groupName, 40);
    const productName = cleanName(row && row.productName, 60);
    const stationName = cleanName(row && row.stationName, 40);
    const empty = !groupName && !productName && !stationName &&
      (row == null || (row.salePrice == null || String(row.salePrice).trim() === '')) &&
      (row.qty == null || String(row.qty).trim() === '') &&
      (row.buyPrice == null || String(row.buyPrice).trim() === '') &&
      !(row.unit && String(row.unit).trim());
    if (empty) {
      return;
    }
    if (!groupName || !productName) {
      warnings.push('Sətir ' + (idx + 1) + ': qrup və mal adı vacibdir.');
      return;
    }
    const salePrice = parseSalePrice(row.salePrice);
    if (salePrice == null) {
      warnings.push('Sətir ' + (idx + 1) + ': satış qiyməti düzgün deyil.');
      return;
    }
    const qty = parseOptionalQty(row.qty);
    if (qty && qty.error) {
      warnings.push('Sətir ' + (idx + 1) + ': ' + qty.error);
      return;
    }
    const buyPrice = parseOptionalBuy(row.buyPrice);
    if (buyPrice && buyPrice.error) {
      warnings.push('Sətir ' + (idx + 1) + ': ' + buyPrice.error);
      return;
    }
    const unit = cleanUnit(row.unit);
    if (unit && unit.error) {
      warnings.push('Sətir ' + (idx + 1) + ': ' + unit.error);
      return;
    }
    out.push({
      index: idx + 1,
      groupName: groupName,
      productName: productName,
      salePrice: salePrice,
      qty: qty == null ? null : qty,
      buyPrice: buyPrice == null ? null : buyPrice,
      stationName: stationName,
      unit: unit || ''
    });
  });
  return { lines: out, warnings: warnings };
}

function openingIn(box, item, qty, buyPrice, warehouseId, note) {
  const wid = Number(warehouseId) || 1;
  const at = new Date().toISOString();
  const price = buyPrice != null ? buyPrice : stock.fifoAvg(item, wid);
  stock.fifoAdd(item, qty, price, at, wid);
  if (buyPrice != null) {
    item.buyPrice = buyPrice;
  }
  item.touched = true;
  if (!Array.isArray(box.moves)) {
    box.moves = [];
  }
  box.moves.push({
    id: box.nextMoveId || 1,
    itemId: item.id,
    type: 'in',
    qty: qty,
    buyPrice: price,
    warehouseId: wid,
    note: String(note || 'İlkin doldurma').trim().slice(0, 80),
    at: at
  });
  box.nextMoveId = (box.nextMoveId || 1) + 1;
}

function applyBootstrapLines(rawLines, opts) {
  opts = opts || {};
  const confirm = opts.confirm === true;
  const warehouseId = Number(opts.warehouseId) || 1;
  const stockMode = opts.stockMode === true;
  const canStockEdit = opts.canStockEdit === true;
  const normalized = normalizeLines(rawLines);
  const warnings = normalized.warnings.slice();
  const lines = normalized.lines;

  const result = {
    newGroups: 0,
    newStations: 0,
    newProducts: 0,
    updatedProducts: 0,
    stockLines: 0,
    warnings: warnings,
    productIds: [],
    applied: 0
  };

  if (!lines.length) {
    if (!warnings.length) {
      warnings.push('Dolu sətir yoxdur.');
    }
    return result;
  }

  const cat = catalog.readCatalog();
  let box = null;
  if (stockMode) {
    box = stock.readStock();
  }

  const createdGroups = {};
  const createdStations = {};

  lines.forEach(function (line) {
    let group = findByName(cat.groups, line.groupName) ||
      createdGroups[line.groupName.toLowerCase()] || null;
    if (!group) {
      result.newGroups += 1;
      if (confirm) {
        group = { id: cat.nextGroupId, name: line.groupName };
        cat.nextGroupId += 1;
        cat.groups.push(group);
      } else {
        group = { id: -1000 - result.newGroups, name: line.groupName };
      }
      createdGroups[line.groupName.toLowerCase()] = group;
    }

    let stationId = 0;
    if (line.stationName) {
      let station = findByName(cat.stations, line.stationName) ||
        createdStations[line.stationName.toLowerCase()] || null;
      if (!station) {
        result.newStations += 1;
        if (confirm) {
          station = { id: cat.nextStationId, name: line.stationName };
          cat.nextStationId += 1;
          cat.stations.push(station);
        } else {
          station = { id: -2000 - result.newStations, name: line.stationName };
        }
        createdStations[line.stationName.toLowerCase()] = station;
      }
      stationId = station.id;
    }

    let product = findProductInGroup(cat.products, group.id, line.productName);
    if (!product) {
      result.newProducts += 1;
      if (confirm) {
        const extra = catalog.emptyCostFields();
        product = {
          id: cat.nextProductId,
          groupId: group.id,
          name: line.productName,
          salePrice: line.salePrice,
          stationId: stationId,
          image: '',
          buyPrice: line.buyPrice != null ? line.buyPrice : extra.buyPrice,
          costPrice: extra.costPrice,
          ingredients: [],
          portions: [],
          extras: [],
          blocked: false,
          soldOut: false,
          allergens: [],
          happyPrice: null,
          happyFrom: null,
          happyTo: null,
          comboIds: [],
          course: catalog.courseOf({ stationId: stationId }),
          barcode: '',
          prices: {}
        };
        cat.nextProductId += 1;
        cat.products.push(product);
      }
    } else if (confirm) {
      result.updatedProducts += 1;
      product.salePrice = line.salePrice;
      if (line.stationName) {
        product.stationId = stationId;
        product.course = catalog.courseOf({
          course: product.course,
          stationId: stationId
        });
      }
      if (line.buyPrice != null) {
        product.buyPrice = line.buyPrice;
      }
    } else {
      result.updatedProducts += 1;
    }

    if (confirm && product) {
      result.productIds.push(product.id);
    }
    result.applied += 1;

    if (line.qty == null) {
      return;
    }
    if (!stockMode) {
      warnings.push('Sətir ' + line.index + ': satış rejimində miqdar yazılmır (yalnız kataloq).');
      return;
    }
    if (!canStockEdit) {
      warnings.push('Sətir ' + line.index + ': miqdar üçün anbar icazəsi (stock.edit) lazımdır.');
      return;
    }
    result.stockLines += 1;
    if (!confirm || !box) {
      return;
    }
    let item = (box.items || []).find(function (row) {
      return sameName(row.name, line.productName);
    });
    if (!item) {
      const created = stock.createItem({
        name: line.productName,
        unit: line.unit || 'əd',
        buyPrice: line.buyPrice != null ? line.buyPrice : 0,
        qty: 0
      }, opts.who || '');
      if (created.error) {
        warnings.push('Sətir ' + line.index + ': ' + created.error);
        result.stockLines -= 1;
        return;
      }
      box = stock.readStock();
      item = (box.items || []).find(function (row) {
        return row.id === created.item.id;
      });
    } else {
      if (line.unit) {
        item.unit = line.unit;
      }
      if (line.buyPrice != null) {
        item.buyPrice = line.buyPrice;
      }
    }
    if (!item) {
      warnings.push('Sətir ' + line.index + ': anbar xammalı yaradılmadı.');
      result.stockLines -= 1;
      return;
    }
    openingIn(box, item, line.qty, line.buyPrice, warehouseId, 'İlkin doldurma');
    stock.writeStock(box);
  });

  if (confirm) {
    catalog.writeCatalog(cat);
  }

  return result;
}

module.exports = {
  applyBootstrapLines: applyBootstrapLines,
  normalizeLines: normalizeLines,
  sameName: sameName
};
