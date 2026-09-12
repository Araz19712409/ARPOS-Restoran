const types = require('./types');
const num = require('../../num');

const STUB = 'AzSmart real HTTP bu versiyada yoxdur. Emulyatoru yandırın.';

function vatMap(vatPercent) {
  const p = Number(vatPercent) || 0;
  if (p >= 17.5) {
    return { taxCode: 4, percent: 18, calcType: 1 };
  }
  return { taxCode: 6, percent: 0, calcType: 1 };
}

function toCents(azn) {
  return num.toMinor(azn);
}

function saleBody(payload) {
  const tax = vatMap(payload && payload.vatPercent);
  return {
    items: ((payload && payload.items) || []).map(function (row) {
      const sum = num.mulQty(num.toMinor(row.salePrice), row.qty);
      return {
        itemName: row.name,
        itemQuantity: Number(row.qty) || 0,
        itemPrice: num.toMinor(row.salePrice),
        itemSum: sum,
        itemTaxes: [{ taxCode: tax.taxCode, percent: tax.percent, calcType: tax.calcType }]
      };
    }),
    payments: {
      cashAmount: toCents(payload && payload.cashAmount),
      cashlessAmount: toCents(payload && payload.cardAmount)
    }
  };
}

function stub() {
  return Promise.resolve(types.result(false, '', STUB, { stub: true, port: 8008 }));
}

function create(cfg) {
  const row = (cfg && cfg.azsmart) || {};
  return {
    id: 'azsmart',
    label: 'AzSmart (SmartOne)',
    mode: 'stub',
    isConfigured: function () {
      if (types.isEmulator(cfg)) {
        return true;
      }
      return !!(String(row.host || '').trim() && String(row.merchantId || '').trim());
    },
    testConnection: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'azsmart', port: 8008 }));
      }
      return stub();
    },
    getShiftStatus: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'azsmart', path: '/check_shift' }));
      }
      return stub();
    },
    openShift: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'azsmart', path: '/open_shift' }));
      }
      return stub();
    },
    closeShiftZ: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'azsmart', path: '/close_shift' }));
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

module.exports = {
  create: create,
  vatMap: vatMap,
  toCents: toCents,
  saleBody: saleBody
};
