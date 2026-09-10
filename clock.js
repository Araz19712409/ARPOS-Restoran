const path = require('path');
const store = require('./store');

const FILE = path.join(__dirname, 'data', 'clock.json');

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

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
  data.punches = (data.punches || []).slice(-4000);
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

function clipHours(inAt, outAt, from, to) {
  const start = new Date(inAt).getTime();
  const stop = outAt ? new Date(outAt).getTime() : Date.now();
  const a = Math.max(start, from.getTime());
  const b = Math.min(stop, to.getTime());
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    return 0;
  }
  return (b - a) / 3600000;
}

function payroll(userList, from, to, punchList) {
  const map = {};
  (userList || []).forEach(function (user) {
    map[Number(user.id)] = {
      userId: Number(user.id),
      name: user.name || '',
      wage: money(user.hourlyWage),
      hours: 0,
      amount: 0
    };
  });
  (punchList || readStore().punches).forEach(function (row) {
    const hours = clipHours(row.inAt, row.outAt, from, to);
    if (hours <= 0) {
      return;
    }
    const id = Number(row.userId);
    if (!map[id]) {
      map[id] = {
        userId: id,
        name: row.userName || '',
        wage: 0,
        hours: 0,
        amount: 0
      };
    }
    map[id].hours += hours;
    if (!map[id].name && row.userName) {
      map[id].name = row.userName;
    }
  });
  return Object.keys(map).map(function (key) {
    const row = map[key];
    row.hours = Number(row.hours.toFixed(2));
    row.amount = money(row.hours * row.wage);
    return row;
  }).filter(function (row) {
    return row.hours > 0;
  }).sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), 'az');
  });
}

module.exports = {
  toggle: toggle,
  listToday: listToday,
  payroll: payroll,
  clipHours: clipHours,
  readStore: readStore
};
