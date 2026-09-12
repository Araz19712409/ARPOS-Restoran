const types = require('./types');

function create() {
  return {
    id: 'manual',
    label: 'Manual',
    isConfigured: function () { return true; },
    listExternal: function () {
      return Promise.resolve([]);
    },
    createFromWebhook: function () {
      return types.result(false, null, 'Manual rejim: yalnız kassada Çatdırılma.');
    }
  };
}

module.exports = { create: create };
