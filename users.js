const path = require('path');
const crypto = require('crypto');
const fileStore = require('./store');
const db = require('./db');
const totp = require('./totp');
const logger = require('./logger');

function lockFile() {
  return db.dataFile('pin-lock.json');
}
const FAIL_LIMIT = 5;
const LOCK_MS = 15 * 60 * 1000;
const LOCK_MS_MAX = 60 * 60 * 1000;
const PIN_SCHEME = 'pbkdf2';
// TODO: admin unlock / TOTP bu kilidi açmır — ayrıca.

// Gələcək işlər üçün icazə kataloqu
const PERMISSIONS = [
  { key: 'layout.view', group: 'Çertyoj', label: 'Bax' },
  { key: 'layout.edit', group: 'Çertyoj', label: 'Dəyiş' },
  { key: 'layout.delete', group: 'Çertyoj', label: 'Sil' },
  { key: 'products.view', group: 'Məhsullar', label: 'Bax' },
  { key: 'products.edit', group: 'Məhsullar', label: 'Dəyiş' },
  { key: 'products.delete', group: 'Məhsullar', label: 'Sil' },
  { key: 'printers.view', group: 'Printerlər', label: 'Bax' },
  { key: 'printers.edit', group: 'Printerlər', label: 'Dəyiş' },
  { key: 'printers.test', group: 'Printerlər', label: 'Test' },
  { key: 'users.view', group: 'İstifadəçilər', label: 'Bax' },
  { key: 'users.edit', group: 'İstifadəçilər', label: 'Dəyiş' },
  { key: 'users.delete', group: 'İstifadəçilər', label: 'Sil' },
  { key: 'orders.create', group: 'Sifariş', label: 'Yaz' },
  { key: 'orders.void', group: 'Sifariş', label: 'Ləğv' },
  { key: 'orders.discount', group: 'Sifariş', label: 'Endirim' },
  { key: 'orders.move', group: 'Sifariş', label: 'Köçür' },
  { key: 'payments.take', group: 'Ödəniş', label: 'Qəbul' },
  { key: 'payments.refund', group: 'Ödəniş', label: 'Geri' },
  { key: 'kitchen.view', group: 'Stansiya', label: 'Bax' },
  { key: 'kitchen.done', group: 'Stansiya', label: 'Hazır' },
  { key: 'reports.view', group: 'Hesabat', label: 'Bax' },
  { key: 'settings.view', group: 'Ayarlar', label: 'Bax' },
  { key: 'settings.edit', group: 'Ayarlar', label: 'Dəyiş' },
  { key: 'logs.view', group: 'Loqlar', label: 'Bax' },
  { key: 'cost.view', group: 'Maya dəyəri', label: 'Bax' },
  { key: 'cost.edit', group: 'Maya dəyəri', label: 'Dəyiş' },
  { key: 'stock.view', group: 'Anbar', label: 'Bax' },
  { key: 'stock.edit', group: 'Anbar', label: 'Dəyiş' },
  { key: 'stock.delete', group: 'Anbar', label: 'Sil' }
];

function allKeys() {
  return PERMISSIONS.map(function (item) { return item.key; });
}

// Köhnə sha256 qalır, yeni PIN pbkdf2 olur
function hashPin(pin, salt, scheme) {
  if (scheme === 'pbkdf2') {
    return crypto.pbkdf2Sync(String(pin), String(salt), 60000, 32, 'sha256').toString('hex');
  }
  return crypto.createHash('sha256').update(String(pin) + ':' + salt).digest('hex');
}

function pinSchemeOf(user) {
  return (user && user.pinScheme) || 'sha256';
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function setPin(user, pin) {
  user.pinSalt = newSalt();
  user.pinScheme = PIN_SCHEME;
  user.pinHash = hashPin(pin, user.pinSalt, PIN_SCHEME);
}

function clientKey(ip) {
  return String(ip || 'local').replace(/^::ffff:/, '').slice(0, 64);
}

function pinStamp(pin) {
  const raw = String(pin == null ? '' : pin).replace(/\D/g, '').slice(0, 8);
  if (!raw) {
    return '';
  }
  return crypto.createHash('sha256').update('arpos-pin-lock:' + raw).digest('hex').slice(0, 16);
}

function ipLockKey(ip) {
  return 'ip:' + clientKey(ip);
}

function pinLockKey(pin) {
  const stamp = pinStamp(pin);
  return stamp ? 'pin:' + stamp : '';
}

function lockDurationMs(lockCount) {
  const n = Math.max(1, Number(lockCount) || 1);
  const ms = LOCK_MS * Math.pow(2, n - 1);
  return ms > LOCK_MS_MAX ? LOCK_MS_MAX : ms;
}

function waitLeft(row, now) {
  if (!row || !row.until) {
    return 0;
  }
  const left = Math.ceil((row.until - now) / 1000);
  return left > 0 ? left : 0;
}

function lockKeys(ip, pin) {
  const keys = [ipLockKey(ip)];
  const pinKey = pinLockKey(pin);
  if (pinKey) {
    keys.push(pinKey);
  }
  const legacy = clientKey(ip);
  if (legacy && keys.indexOf('ip:' + legacy) >= 0) {
    keys.push(legacy);
  }
  return keys;
}

function migrateKey(key) {
  if (String(key).indexOf('ip:') === 0 || String(key).indexOf('pin:') === 0) {
    return key;
  }
  return 'ip:' + clientKey(key);
}

function readLocks() {
  try {
    const raw = fileStore.readJson(lockFile());
    const fails = raw && raw.fails && typeof raw.fails === 'object' ? raw.fails : {};
    const out = {};
    Object.keys(fails).forEach(function (key) {
      const next = migrateKey(key);
      const row = fails[key] || {};
      const prev = out[next] || { n: 0, until: 0, locks: 0 };
      out[next] = {
        n: Math.max(Number(prev.n) || 0, Number(row.n) || 0),
        until: Math.max(Number(prev.until) || 0, Number(row.until) || 0),
        locks: Math.max(Number(prev.locks) || 0, Number(row.locks) || 0)
      };
    });
    return out;
  } catch (error) {
    return {};
  }
}

function writeLocks(fails) {
  const now = Date.now();
  const clean = {};
  Object.keys(fails).forEach(function (key) {
    const row = fails[key];
    if (row && ((row.until && row.until > now) || Number(row.n) > 0 || Number(row.locks) > 0)) {
      clean[key] = {
        n: Number(row.n) || 0,
        until: Number(row.until) || 0,
        locks: Number(row.locks) || 0
      };
    }
  });
  fileStore.writeJson(lockFile(), { fails: clean });
}

function pinWait(ip, pin) {
  const fails = readLocks();
  const now = Date.now();
  let max = 0;
  lockKeys(ip, pin).forEach(function (key) {
    const left = waitLeft(fails[migrateKey(key)] || fails[key], now);
    if (left > max) {
      max = left;
    }
  });
  return max;
}

function failPin(ip, pin) {
  const fails = readLocks();
  const now = Date.now();
  const keys = lockKeys(ip, pin).map(migrateKey).filter(function (key, i, all) {
    return all.indexOf(key) === i;
  });
  let lockedWait = 0;
  keys.forEach(function (key) {
    const left = waitLeft(fails[key], now);
    if (left > lockedWait) {
      lockedWait = left;
    }
  });
  if (lockedWait > 0) {
    return lockedWait;
  }
  let resultWait = 0;
  keys.forEach(function (key) {
    const row = fails[key] || { n: 0, until: 0, locks: 0 };
    row.n = Number(row.n || 0) + 1;
    row.until = 0;
    if (row.n >= FAIL_LIMIT) {
      row.locks = Number(row.locks || 0) + 1;
      row.until = now + lockDurationMs(row.locks);
      row.n = 0;
      const kind = String(key).indexOf('pin:') === 0 ? 'pin' : 'ip';
      logger.warn({
        path: 'pin-lock',
        message: 'PIN seriyası bağlandı. ip=' + clientKey(ip) +
          ' açar=' + kind + ' say=' + FAIL_LIMIT +
          ' until=' + new Date(row.until).toISOString()
      });
    }
    fails[key] = row;
    const left = waitLeft(row, now);
    if (left > resultWait) {
      resultWait = left;
    }
  });
  writeLocks(fails);
  return resultWait;
}

function clearPinFail(ip, pin) {
  const fails = readLocks();
  let changed = false;
  lockKeys(ip, pin).forEach(function (key) {
    const k = migrateKey(key);
    if (fails[k]) {
      delete fails[k];
      changed = true;
    }
    if (fails[key]) {
      delete fails[key];
      changed = true;
    }
  });
  if (changed) {
    writeLocks(fails);
  }
}

function loginPin(pin) {
  return /^\d{4,8}$/.test(String(pin || ''));
}

function validPin(pin) {
  return /^\d{6,8}$/.test(String(pin || ''));
}

// Hazır rolları qururuq
function defaultRoles() {
  const all = allKeys();
  return [
    { id: 1, name: 'Admin', system: true, permissions: all.slice() },
    { id: 2, name: 'Menecer', system: true, permissions: all.filter(function (key) {
      return key !== 'users.delete' && key !== 'cost.edit' && key !== 'stock.delete';
    }) },
    { id: 3, name: 'Ofisiant', system: true, permissions: [
      'layout.view', 'products.view', 'orders.create', 'orders.void',
      'orders.move', 'payments.take', 'kitchen.view'
    ] },
    { id: 4, name: 'Kassir', system: true, permissions: [
      'layout.view', 'products.view', 'orders.create', 'orders.void',
      'orders.move', 'payments.take', 'payments.refund', 'reports.view'
    ] },
    { id: 5, name: 'Mətbəx', system: true, permissions: ['products.view', 'kitchen.view', 'kitchen.done'] },
    { id: 6, name: 'Bar', system: true, permissions: ['products.view', 'kitchen.view', 'kitchen.done'] },
    { id: 7, name: 'Manqal', system: true, permissions: ['products.view', 'kitchen.view', 'kitchen.done'] }
  ];
}

// İlk admini qururuq — PIN: 0000
function defaultAdmin() {
  const salt = newSalt();
  return {
    id: 1,
    name: 'Admin',
    roleId: 1,
    pinSalt: salt,
    pinHash: hashPin('0000', salt),
    active: true,
    system: true
  };
}

// Anbarı oxuyuruq, boşdursa toxum əkirik
function readStore() {
  const raw = db.readOffice('users.json');
  const store = {
    nextUserId: Number(raw.nextUserId) || 1,
    nextRoleId: Number(raw.nextRoleId) || 1,
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    users: Array.isArray(raw.users) ? raw.users : []
  };
  if (!store.roles.length) {
    store.roles = defaultRoles();
    store.nextRoleId = 8;
    store.users = [defaultAdmin()];
    store.nextUserId = 2;
    writeStore(store);
  }
  var changed = false;
  const waiter = store.roles.find(function (item) { return item.id === 3; });
  if (waiter) {
    ['orders.void', 'payments.take', 'orders.move'].forEach(function (key) {
      if (waiter.permissions.indexOf(key) === -1) {
        waiter.permissions.push(key);
        changed = true;
      }
    });
  }
  store.roles.forEach(function (role) {
    if ((role.id === 1 || role.id === 2 || role.id === 4) &&
        role.permissions.indexOf('orders.move') === -1) {
      role.permissions.push('orders.move');
      changed = true;
    }
  });
  store.roles.forEach(function (role) {
    if (role.id === 1 || role.id === 2) {
      ['settings.view', 'settings.edit', 'stock.view', 'stock.edit', 'cost.view'].forEach(function (key) {
        if (role.permissions.indexOf(key) === -1) {
          role.permissions.push(key);
          changed = true;
        }
      });
    }
    if (role.id === 1 && role.permissions.indexOf('cost.edit') === -1) {
      role.permissions.push('cost.edit');
      changed = true;
    }
    if (role.id === 1 && role.permissions.indexOf('stock.delete') === -1) {
      role.permissions.push('stock.delete');
      changed = true;
    }
  });
  if (changed) {
    writeStore(store);
  }
  return store;
}

// PIN-ə görə aktiv istifadəçini tapırıq
function verifyPin(pin) {
  pin = String(pin || '').replace(/\D/g, '');
  if (!loginPin(pin)) {
    return null;
  }
  const store = readStore();
  return store.users.find(function (item) {
    if (item.active === false || !item.pinSalt || !item.pinHash) {
      return false;
    }
    const scheme = pinSchemeOf(item);
    if (item.pinHash === hashPin(pin, item.pinSalt, scheme)) {
      return true;
    }
    if (scheme === 'pbkdf2' && item.pinHash === hashPin(pin, item.pinSalt, 'sha256')) {
      return true;
    }
    if (scheme !== 'pbkdf2' && item.pinHash === hashPin(pin, item.pinSalt, 'pbkdf2')) {
      return true;
    }
    return false;
  }) || null;
}

// İstifadəçinin icazəsini yoxlayırıq
function canUser(userId, key) {
  const staff = findStaff(userId);
  if (!staff) {
    return null;
  }
  return {
    user: staff.user,
    role: staff.role,
    ok: !key || hasPermission(staff.role, key)
  };
}

function findStaff(userId) {
  const store = readStore();
  const user = store.users.find(function (item) {
    return item.id === Number(userId) && item.active !== false && !item.locked;
  });
  if (!user) {
    return null;
  }
  const role = store.roles.find(function (item) { return item.id === user.roleId; });
  return {
    user: user,
    role: role,
    permissions: role ? role.permissions : []
  };
}

function isDefaultPin(user) {
  return !!(user && user.pinSalt &&
    user.pinHash === hashPin('0000', user.pinSalt, pinSchemeOf(user)));
}

function needsPinChange(user) {
  return !!(user && user.mustChangePin);
}

function forbiddenPin(pin) {
  return /^0+$/.test(String(pin || ''));
}

function writeStore(data) {
  db.writeOffice('users.json', data);
}

// İstifadəçini API-yə çıxarırıq — PIN hash getmir
function minutesOf(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const min = Number(match[2]);
  if (hour > 23 || min > 59) {
    return null;
  }
  return hour * 60 + min;
}

function scheduleOk(user, at) {
  const sch = user && user.schedule;
  if (!sch || !Array.isArray(sch.days) || !sch.days.length) {
    return { ok: true };
  }
  const now = at || new Date();
  const day = now.getDay();
  if (sch.days.map(Number).indexOf(day) === -1) {
    return { ok: false, error: 'Bu gün iş qrafikiniz yoxdur.' };
  }
  const from = minutesOf(sch.from);
  const to = minutesOf(sch.to);
  if (from == null && to == null) {
    return { ok: true };
  }
  const cur = now.getHours() * 60 + now.getMinutes();
  if (from != null && to != null && from !== to) {
    const inRange = from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
    if (!inRange) {
      return { ok: false, error: 'İş saatınız ' + sch.from + '–' + sch.to + ' arasındadır.' };
    }
  } else if (from != null && cur < from) {
    return { ok: false, error: 'İş saatınız ' + sch.from + '-dən başlayır.' };
  }
  return { ok: true };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    roleId: user.roleId,
    active: user.active !== false,
    system: Boolean(user.system),
    hasPin: Boolean(user.pinHash),
    locked: Boolean(user.locked),
    totpEnabled: Boolean(user.totpEnabled && user.totpSecret),
    schedule: user.schedule || { days: [], from: '', to: '' },
    hourlyWage: moneyWage(user.hourlyWage)
  };
}

function moneyWage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Number(Math.min(9999, n).toFixed(2));
}

function hasPermission(role, key) {
  if (!role || !Array.isArray(role.permissions)) {
    return false;
  }
  return role.permissions.indexOf(key) !== -1;
}

function cleanPins(list) {
  return list.filter(function (key) {
    return PERMISSIONS.some(function (item) { return item.key === key; });
  });
}

const pendingTotp = {};

function sweepPendingTotp() {
  const now = Date.now();
  Object.keys(pendingTotp).forEach(function (token) {
    if (now - pendingTotp[token].at > 180000) {
      delete pendingTotp[token];
    }
  });
}

function putPendingTotp(userId) {
  sweepPendingTotp();
  const token = crypto.randomBytes(16).toString('hex');
  pendingTotp[token] = { userId: Number(userId), at: Date.now() };
  return token;
}

function takePendingTotp(token) {
  sweepPendingTotp();
  const key = String(token || '');
  const row = pendingTotp[key];
  delete pendingTotp[key];
  if (!row) {
    return null;
  }
  return row.userId;
}

function startTotp(user) {
  const secret = totp.makeSecret();
  user.totpPending = secret;
  return {
    secret: secret,
    otpauth: totp.otpauth(user.name, secret)
  };
}

function confirmTotp(user, code) {
  if (!user.totpPending || !totp.verify(user.totpPending, code)) {
    return false;
  }
  user.totpSecret = user.totpPending;
  user.totpEnabled = true;
  delete user.totpPending;
  return true;
}

function offTotp(user, code) {
  if (!user.totpEnabled || !user.totpSecret || !totp.verify(user.totpSecret, code)) {
    return false;
  }
  user.totpEnabled = false;
  delete user.totpSecret;
  delete user.totpPending;
  return true;
}

function adminIds() {
  return readStore().users.filter(function (item) {
    return item.roleId === 1 && item.active !== false && !item.locked;
  }).map(function (item) {
    return item.id;
  });
}

function isAdminUser(user) {
  return Boolean(user && Number(user.roleId) === 1);
}

module.exports = {
  PERMISSIONS: PERMISSIONS,
  readStore: readStore,
  writeStore: writeStore,
  publicUser: publicUser,
  hashPin: hashPin,
  setPin: setPin,
  newSalt: newSalt,
  loginPin: loginPin,
  validPin: validPin,
  pinWait: pinWait,
  failPin: failPin,
  clearPinFail: clearPinFail,
  lockDurationMs: lockDurationMs,
  FAIL_LIMIT: FAIL_LIMIT,
  hasPermission: hasPermission,
  cleanPins: cleanPins,
  verifyPin: verifyPin,
  canUser: canUser,
  findStaff: findStaff,
  isDefaultPin: isDefaultPin,
  needsPinChange: needsPinChange,
  forbiddenPin: forbiddenPin,
  scheduleOk: scheduleOk,
  moneyWage: moneyWage,
  putPendingTotp: putPendingTotp,
  takePendingTotp: takePendingTotp,
  startTotp: startTotp,
  confirmTotp: confirmTotp,
  offTotp: offTotp,
  adminIds: adminIds,
  isAdminUser: isAdminUser
};
