const path = require('path');
const store = require('./store');

const FILE = path.join(__dirname, 'data', 'clock.json');

function readStore() {
  try {
    const raw = store.readJson(FILE);
    return {
      nextId: Number(raw.nextId) || 1,
      punches: Array.isArray(raw.punches) ? raw.punches : []
    };
  } catch (error) {
    return { nextId: 1, punches: [] };
  }
}

function writeStore(data) {
  data.punches = (data.punches || []).slice(-200);
  store.writeJson(FILE, data);
}

function dayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function today(box) {
  const from = dayStart();
  return (box.punches || []).filter(function (row) {
    return String(row.inAt || '') >= from;
  }).sort(function (a, b) {
    return String(a.inAt) < String(b.inAt) ? 1 : -1;
  });
}

function openFor(box, userId) {
  return (box.punches || []).find(function (row) {
    return Number(row.userId) === Number(userId) && !row.outAt;
  }) || null;
}

function toggle(user) {
  if (!user || !user.id) {
    return { error: 'PIN ilə daxil olun.' };
  }
  const box = readStore();
  const open = openFor(box, user.id);
  const now = new Date().toISOString();
  if (open) {
    open.outAt = now;
    writeStore(box);
    return { punch: open, action: 'out', today: today(box) };
  }
  const row = {
    id: box.nextId,
    userId: user.id,
    userName: user.name || '',
    inAt: now,
    outAt: ''
  };
  box.nextId += 1;
  box.punches.push(row);
  writeStore(box);
  return { punch: row, action: 'in', today: today(box) };
}

function listToday() {
  const box = readStore();
  return { today: today(box) };
}

module.exports = {
  toggle: toggle,
  listToday: listToday
};
