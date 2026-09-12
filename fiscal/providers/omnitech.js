const types = require('./types');
const num = require('../../num');

const STUB = 'Omnitech real HTTP bu versiyada yoxdur. Emulyatoru yandırın.';

function saleBody(payload) {
  const vat = Number(payload && payload.vatPercent) || 0;
  const items = (payload && payload.items) || [];
  return {
    operationId: 'createDocument',
    version: 1,
    tokenData: {
      doc_type: 'sale',
      data: {
        cashier: (payload && payload.cashier) || '',
        cashSum: num.fromMinor(num.toMinor(payload && payload.cashAmount)),
        cashlessSum: num.fromMinor(num.toMinor(payload && payload.cardAmount)),
        items: items.map(function (row) {
          return {
            itemName: row.name,
            itemQuantity: row.qty,
            itemPrice: num.fromMinor(num.toMinor(row.salePrice)),
            itemSum: num.fromMinor(num.mulQty(num.toMinor(row.salePrice), row.qty)),
            itemVatPercent: vat
          };
        })
      }
    }
  };
}

function stub() {
  return Promise.resolve(types.result(false, '', STUB, { stub: true, port: 8989 }));
}

function create(cfg) {
  const row = (cfg && cfg.omnitech) || {};
  return {
    id: 'omnitech',
    label: 'Omnitech (Omnisoft)',
    mode: 'stub',
    isConfigured: function () {
      if (types.isEmulator(cfg)) {
        return true;
      }
      return !!(String(row.host || '').trim() && String(row.user || '').trim());
    },
    testConnection: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'omnitech', port: 8989 }));
      }
      return stub();
    },
    getShiftStatus: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'omnitech', check_type: 14 }));
      }
      return stub();
    },
    openShift: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'omnitech', check_type: 15 }));
      }
      return stub();
    },
    closeShiftZ: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'omnitech', check_type: 13 }));
      }
      return stub();
    },
    registerSale: function (payload) {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuSale(payload && payload.job));
      }
      saleBody(payload);
      return stub();
    },
    registerMoneyBack: function (payload) {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuSale(payload && payload.job));
      }
      return stub();
    }
  };
}

module.exports = { create: create, saleBody: saleBody };
