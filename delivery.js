const crypto = require('crypto');
const catalog = require('./catalog');
const orders = require('./orders');
const settings = require('./settings');
const stock = require('./stock');
const num = require('./num');
const providers = require('./delivery/providers');

function sanitize(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .trim()
    .slice(0, maxLength || 80);
}

function secretsEqual(got, stored) {
  const want = String(stored || '');
  const have = String(got == null ? '' : got);
  if (!want) {
    return false;
  }
  const a = Buffer.from(have, 'utf8');
  const b = Buffer.from(want, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function secretFromHeaders(headers) {
  if (!headers) {
    return '';
  }
  if (typeof headers.get === 'function') {
    return String(headers.get('X-Delivery-Secret') || headers.get('x-delivery-secret') || '');
  }
  return String(
    headers['x-delivery-secret'] ||
    headers['X-Delivery-Secret'] ||
    ''
  );
}

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findProduct(catalogStore, line) {
  const products = (catalogStore && catalogStore.products) || [];
  const code = catalog.cleanBarcode(line && (line.barcode || line.sku));
  if (code) {
    const hit = products.find(function (row) {
      return catalog.cleanBarcode(row.barcode).toLowerCase() === code.toLowerCase();
    });
    if (hit) {
      return hit;
    }
  }
  const want = normName(line && line.name);
  if (!want) {
    return null;
  }
  const matches = products.filter(function (row) {
    return normName(row.name) === want;
  });
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function mapLine(catalogStore, raw) {
  const line = raw && typeof raw === 'object' ? raw : {};
  const qtyN = Math.round(Number(line.qty != null ? line.qty : line.quantity) || 0);
  const qty = Number.isInteger(qtyN) && qtyN >= 1 && qtyN <= 99 ? qtyN : 1;
  const label = sanitize(line.name || line.title, 80) || 'Sətir';
  const code = catalog.cleanBarcode(line.barcode || line.sku);
  const product = findProduct(catalogStore, line);
  if (product && !product.blocked && !product.soldOut) {
    const chosen = catalog.resolveQuotedPrice(product, {}, line.price != null ? line.price : line.salePrice);
    return {
      mapped: true,
      product: product,
      qty: qty,
      salePrice: chosen && !chosen.error ? chosen.salePrice : catalog.salePriceNow(product),
      note: sanitize(line.note, 80)
    };
  }
  const miss = code || label;
  const priceN = num.fromMinor(num.toMinor(line.price != null ? line.price : line.salePrice));
  return {
    mapped: false,
    product: null,
    qty: qty,
    salePrice: Number.isFinite(priceN) ? priceN : 0,
    note: sanitize('Kataloqda yox: ' + miss, 80),
    name: label
  };
}

function mapItems(catalogStore, items) {
  return (Array.isArray(items) ? items : []).map(function (row) {
    return mapLine(catalogStore, row);
  });
}

function nextServiceSeat(store) {
  const tableId = -(2000 + store.nextOrderId);
  const tableName = 'Çatdırılma #' + store.nextOrderId;
  return { tableId: tableId, tableName: tableName, channel: 'delivery' };
}

function materialize(draft, providerId, cfg) {
  const catalogStore = catalog.readCatalog();
  const store = orders.readOrders();
  const seat = nextServiceSeat(store);
  const stamp = settings.branchStamp();
  const mapped = mapItems(catalogStore, draft && draft.items);
  if (!mapped.length) {
    return { ok: false, status: 400, message: 'Sətir yoxdur.' };
  }
  const order = orders.openForTable(store, seat.tableId, seat.tableName, {
    channel: 'delivery',
    guestName: sanitize(draft && draft.guestName, 40),
    guestPhone: sanitize(draft && draft.guestPhone, 20),
    guestAddress: sanitize(draft && draft.guestAddress, 80),
    courierName: ''
  });
  order.channel = 'delivery';
  order.runStatus = 'prep';
  order.deliveryProvider = String(providerId || '');
  order.deliveryExternalId = sanitize(draft && draft.externalId, 40);
  order.branchCode = stamp.code;
  order.branchName = stamp.name;
  order.waiterId = 0;
  order.waiterName = String(providerId || 'delivery');
  const added = [];
  const fresh = [];
  const now = new Date().toISOString();
  mapped.forEach(function (row) {
    const sendNow = true;
    const item = {
      id: store.nextItemId,
      productId: row.product ? row.product.id : 0,
      name: row.product ? row.product.name : row.name,
      qty: row.qty,
      salePrice: row.salePrice,
      stationId: row.product ? (Number(row.product.stationId) || 0) : 0,
      note: row.note || '',
      modifiers: [],
      course: row.product ? catalog.courseOf(row.product) : 0,
      complimentary: false,
      allergens: row.product ? catalog.parseAllergens(row.product.allergens) : '',
      sent: sendNow,
      sentAt: now,
      costPrice: row.product ? stock.lineCost(row.product, null, { modifiers: [] }) : 0,
      kitchenDone: false,
      voided: false,
      waiterId: 0,
      waiterName: order.waiterName,
      seatTableId: seat.tableId
    };
    store.nextItemId += 1;
    order.items.push(item);
    added.push(item);
    fresh.push(item);
  });
  const useStock = settings.isStockMode();
  const stockLines = added.filter(function (item) { return item.productId; });
  if (useStock && stockLines.length) {
    const lack = stock.lackMessage(catalogStore, stockLines);
    if (lack) {
      return { ok: false, status: 400, message: lack };
    }
  }
  order.updatedAt = now;
  orders.writeOrders(store);
  if (useStock && stockLines.length) {
    stock.deductLines(catalogStore, stockLines, { orderId: order.id });
  }
  return {
    ok: true,
    status: 201,
    order: order,
    fresh: fresh,
    catalogStore: catalogStore,
    autoPrintKitchen: !cfg || cfg.autoPrintKitchen !== false
  };
}

function ingest(providerId, payload, opts) {
  const cfg = settings.readSettings().delivery || {};
  const id = String(providerId || '');
  if (['wolt', 'bolt', 'glovo'].indexOf(id) < 0) {
    return { ok: false, status: 400, message: 'Provider stub deyil.' };
  }
  if (!opts || !opts.sample) {
    if (providers.idOf(cfg) !== id) {
      return { ok: false, status: 400, message: 'Ayarlarda bu provider seçilməyib.' };
    }
  } else if (['wolt', 'bolt', 'glovo'].indexOf(providers.idOf(cfg)) < 0 && !opts.force) {
    return { ok: false, status: 400, message: 'Nümunə üçün Wolt/Bolt/Glovo seçin.' };
  }
  const adapter = providers.get({ provider: id });
  const parsed = adapter.createFromWebhook(payload || (adapter.samplePayload && adapter.samplePayload()));
  if (!parsed.ok || !parsed.orderDraft) {
    return { ok: false, status: 400, message: parsed.message || 'JSON oxunmadı.' };
  }
  return materialize(parsed.orderDraft, id, cfg);
}

function handleWebhook(providerId, secretHeader, payload) {
  const cfg = settings.readSettings().delivery || {};
  if (!secretsEqual(secretHeader, cfg.webhookSecret)) {
    return {
      status: 401,
      body: { success: false, message: 'Secret səhvdir.' }
    };
  }
  const packed = ingest(providerId, payload, {});
  if (!packed.ok) {
    return {
      status: packed.status || 400,
      body: { success: false, message: packed.message || 'Sifariş yazılmadı.' }
    };
  }
  return {
    status: 201,
    body: {
      success: true,
      data: { orderId: packed.order.id, tableName: packed.order.tableName }
    },
    packed: packed
  };
}

function sampleOrder() {
  const cfg = settings.readSettings().delivery || {};
  const id = providers.idOf(cfg);
  const adapter = providers.get(cfg);
  const payload = adapter.samplePayload ? adapter.samplePayload() : null;
  return ingest(id, payload, { sample: true });
}

function openDelivery() {
  const store = orders.readOrders();
  return store.orders.filter(function (row) {
    return row.status === 'open' && row.channel === 'delivery';
  });
}

function patchOpen(orderId, fields) {
  const store = orders.readOrders();
  const order = store.orders.find(function (row) {
    return row.id === Number(orderId) && row.status === 'open' && row.channel === 'delivery';
  });
  if (!order) {
    return { ok: false, status: 404, message: 'Açıq çatdırılma tapılmadı.' };
  }
  if (fields && fields.runStatus != null) {
    order.runStatus = orders.cleanRunStatus('delivery', fields.runStatus);
  }
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'courierName')) {
    order.courierName = sanitize(fields.courierName, 40);
  }
  order.updatedAt = new Date().toISOString();
  orders.writeOrders(store);
  return { ok: true, status: 200, order: order };
}

module.exports = {
  providers: providers,
  secretsEqual: secretsEqual,
  secretFromHeaders: secretFromHeaders,
  mapItems: mapItems,
  findProduct: findProduct,
  ingest: ingest,
  handleWebhook: handleWebhook,
  sampleOrder: sampleOrder,
  openDelivery: openDelivery,
  patchOpen: patchOpen
};
