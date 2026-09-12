const none = require('./none');
const manual = require('./manual');
const stub = require('./stub');
const types = require('./types');

const IDS = ['none', 'manual', 'wolt', 'bolt', 'glovo'];

function idOf(cfg) {
  const id = cfg && cfg.provider ? String(cfg.provider) : 'manual';
  return IDS.indexOf(id) >= 0 ? id : 'manual';
}

function get(cfg) {
  const id = idOf(cfg);
  if (id === 'none') {
    return none.create();
  }
  if (id === 'manual') {
    return manual.create();
  }
  if (id === 'wolt') {
    return stub.create('wolt', 'Wolt (stub)');
  }
  if (id === 'bolt') {
    return stub.create('bolt', 'Bolt (stub)');
  }
  if (id === 'glovo') {
    return stub.create('glovo', 'Glovo (stub)');
  }
  return manual.create();
}

module.exports = {
  IDS: IDS,
  get: get,
  idOf: idOf,
  types: types,
  stub: stub
};
