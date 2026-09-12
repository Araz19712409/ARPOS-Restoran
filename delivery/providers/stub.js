const types = require('./types');

function asDraft(payload, providerId) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const nest = src.order && typeof src.order === 'object' ? src.order : src;
  const items = Array.isArray(nest.items) ? nest.items : [];
  if (!items.length && Array.isArray(src.items)) {
    return asDraft({ order: src }, providerId);
  }
  const draft = {
    guestName: String(nest.guestName || nest.name || nest.customerName || '').trim().slice(0, 40),
    guestPhone: String(nest.guestPhone || nest.phone || nest.customerPhone || '').trim().slice(0, 20),
    guestAddress: String(nest.guestAddress || nest.address || '').trim().slice(0, 80),
    externalId: String(nest.externalId || nest.id || nest.orderId || '').trim().slice(0, 40),
    items: items.map(function (row) {
      const line = row && typeof row === 'object' ? row : {};
      return {
        name: String(line.name || line.title || '').trim().slice(0, 80),
        barcode: String(line.barcode || line.sku || '').trim().slice(0, 32),
        qty: line.qty != null ? line.qty : line.quantity,
        price: line.price != null ? line.price : line.salePrice
      };
    })
  };
  if (!draft.items.length) {
    return types.result(false, null, 'Sətir yoxdur (stub JSON).');
  }
  return types.result(true, draft, 'Stub. Real ' + providerId + ' API yoxdur.');
}

function create(id, label) {
  return {
    id: id,
    label: label,
    isConfigured: function () { return true; },
    listExternal: function () {
      return Promise.resolve([]);
    },
    createFromWebhook: function (payload) {
      return asDraft(payload, id);
    },
    samplePayload: function () {
      return types.sampleDraft(id);
    }
  };
}

module.exports = { create: create, asDraft: asDraft };
