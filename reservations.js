const path = require('path');
const store = require('./store');

const FILE = path.join(__dirname, 'data', 'reservations.json');

function readReservations() {
  const raw = store.readJson(FILE);
  return {
    nextReservationId: Number(raw.nextReservationId) || 1,
    reservations: Array.isArray(raw.reservations) ? raw.reservations : []
  };
}

function writeReservations(data) {
  store.writeJson(FILE, data);
}

function activeForTable(store, tableId) {
  return store.reservations.find(function (item) {
    return item.tableId === tableId && item.status === 'active';
  }) || null;
}

function latestForTable(store, tableId) {
  const list = store.reservations.filter(function (item) {
    return item.tableId === tableId && (item.status === 'active' || item.status === 'seated');
  });
  return list.length ? list[list.length - 1] : null;
}

module.exports = {
  readReservations: readReservations,
  writeReservations: writeReservations,
  activeForTable: activeForTable,
  latestForTable: latestForTable
};
