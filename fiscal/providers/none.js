const types = require('./types');

function create() {
  const msg = types.noneMsg();
  function ok() {
    return Promise.resolve(types.result(true, '', msg, { provider: 'none' }));
  }
  return {
    id: 'none',
    label: 'Heç biri',
    mode: 'none',
    isConfigured: function () { return true; },
    testConnection: ok,
    getShiftStatus: ok,
    openShift: ok,
    closeShiftZ: ok,
    registerSale: ok,
    registerMoneyBack: ok
  };
}

module.exports = { create: create };
