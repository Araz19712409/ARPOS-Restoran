const types = require('./types');

function create() {
  return {
    id: 'none',
    label: 'Heç biri',
    isConfigured: function () { return true; },
    listExternal: function () {
      return Promise.resolve([]);
    },
    createFromWebhook: function () {
      return types.result(false, null, 'Yalnız daxili sifariş. Aqreqator bağlı deyil.');
    }
  };
}

module.exports = { create: create };
