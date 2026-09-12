const types = require('./types');
const none = require('./none');
const wizarpos = require('./wizarpos');
const omnitech = require('./omnitech');
const azsmart = require('./azsmart');

const IDS = ['none', 'wizarpos', 'omnitech', 'azsmart'];

function idOf(cfg) {
  const id = cfg && cfg.provider ? String(cfg.provider) : 'none';
  return IDS.indexOf(id) >= 0 ? id : 'none';
}

function get(cfg) {
  const id = idOf(cfg);
  if (id === 'wizarpos') {
    return wizarpos.create(cfg);
  }
  if (id === 'omnitech') {
    return omnitech.create(cfg);
  }
  if (id === 'azsmart') {
    return azsmart.create(cfg);
  }
  return none.create(cfg);
}

module.exports = {
  IDS: IDS,
  get: get,
  idOf: idOf,
  types: types,
  wizarpos: wizarpos,
  omnitech: omnitech,
  azsmart: azsmart
};
