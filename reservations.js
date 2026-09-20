const db = require('./db');
const store = require('./store');

function file() {
  return db.dataFile('reservations.json');
}

function readReservations() {
  const raw = store.readJson(file());
  return {
    nextReservationId: Number(raw.nextReservationId) || 1,
    reservations: Array.isArray(raw.reservations) ? raw.reservations : []
  };
}

function writeReservations(data) {
  store.writeJson(file(), data);
}

const HOLD_BEFORE_MS = 60 * 60 * 1000;
const HOLD_AFTER_MS = 3 * 60 * 60 * 1000;

function atMs(row) {
  const s = String(row && row.at || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      0,
      0
    ).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function inWindow(row, nowMs) {
  if (!row || row.status !== 'active') {
    return false;
  }
  const at = atMs(row);
  if (!Number.isFinite(at)) {
    return true;
  }
  const now = nowMs != null ? Number(nowMs) : Date.now();
  return now >= at - HOLD_BEFORE_MS && now <= at + HOLD_AFTER_MS;
}

function activeForTable(store, tableId) {
  return store.reservations.find(function (item) {
    return item.tableId === tableId && item.status === 'active';
  }) || null;
}

function blockingForTable(store, tableId, nowMs) {
  const row = activeForTable(store, tableId);
  return row && inWindow(row, nowMs) ? row : null;
}

function latestForTable(store, tableId) {
  const list = store.reservations.filter(function (item) {
    return item.tableId === tableId && (item.status === 'active' || item.status === 'seated');
  });
  return list.length ? list[list.length - 1] : null;
}

module.exports = {
  HOLD_BEFORE_MS: HOLD_BEFORE_MS,
  HOLD_AFTER_MS: HOLD_AFTER_MS,
  atMs: atMs,
  inWindow: inWindow,
  readReservations: readReservations,
  writeReservations: writeReservations,
  activeForTable: activeForTable,
  blockingForTable: blockingForTable,
  latestForTable: latestForTable
};
