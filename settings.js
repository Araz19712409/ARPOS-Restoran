const fs = require('fs');
const path = require('path');
const num = require('./num');
const db = require('./db');

function defaultBackupFolder() {
  return path.join(__dirname, 'data', 'backups');
}

function emptyEkassa() {
  return {
    voen: '',
    objectName: '',
    objectCode: '',
    operator: '',
    note: ''
  };
}

function cleanEkassa(raw) {
  const src = raw && raw.ekassa && typeof raw.ekassa === 'object' ? raw.ekassa : {};
  return {
    voen: String(src.voen || '').replace(/\D/g, '').slice(0, 10),
    objectName: String(src.objectName || '').trim().slice(0, 80),
    objectCode: String(src.objectCode || '').trim().slice(0, 40),
    operator: String(src.operator || '').trim().slice(0, 40),
    note: String(src.note || '').trim().slice(0, 80)
  };
}

function defaults() {
  return {
    serviceChargePercent: 0,
    waiterBonuses: {},
    backupFolder: defaultBackupFolder(),
    ekassa: emptyEkassa(),
    opsMode: 'full',
    listenLan: true,
    branchName: '',
    branchCode: '',
    sms: emptySms(),
    update: emptyUpdate(),
    backupGithub: emptyBackupGithub(),
    orderCardScale: 2,
    vatPercent: 0,
    tillLocked: false
  };
}

function clampScale(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return 2;
  }
  return Math.min(5, Math.max(1, n));
}

function emptySms() {
  return {
    enabled: false,
    url: '',
    login: '',
    password: '',
    sender: '',
    reserveText: 'Rezerv: {name}, {table}, {time}',
    waitText: 'Növbə: {name}, {guests} nəfər'
  };
}

function emptyUpdate() {
  return {
    repo: 'Araz19712409/ARPOS-Restoran',
    token: ''
  };
}

function emptyBackupGithub() {
  return {
    repo: '',
    token: ''
  };
}

function cleanBackupGithub(raw, prev) {
  const src = raw && raw.backupGithub && typeof raw.backupGithub === 'object' ? raw.backupGithub : {};
  const old = prev && prev.backupGithub ? prev.backupGithub : emptyBackupGithub();
  const token = String(src.token || '');
  return {
    repo: String(src.repo || '').trim().slice(0, 80).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, ''),
    token: token ? token.slice(0, 120) : String(old.token || '')
  };
}

function cleanSms(raw, prev) {
  const src = raw && raw.sms && typeof raw.sms === 'object' ? raw.sms : {};
  const old = prev && prev.sms ? prev.sms : emptySms();
  const password = String(src.password || '');
  return {
    enabled: src.enabled === true || src.enabled === 1 || src.enabled === '1' || src.enabled === 'true',
    url: String(src.url || '').trim().slice(0, 240),
    login: String(src.login || '').trim().slice(0, 80),
    password: password ? password.slice(0, 80) : String(old.password || ''),
    sender: String(src.sender || '').trim().slice(0, 20),
    reserveText: String(src.reserveText || old.reserveText || emptySms().reserveText).trim().slice(0, 200),
    waitText: String(src.waitText || old.waitText || emptySms().waitText).trim().slice(0, 200)
  };
}

function cleanUpdate(raw, prev) {
  const src = raw && raw.update && typeof raw.update === 'object' ? raw.update : {};
  const old = prev && prev.update ? prev.update : emptyUpdate();
  const token = String(src.token || '');
  return {
    repo: (String(src.repo || '').trim() || 'Araz19712409/ARPOS-Restoran').slice(0, 80).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, ''),
    token: token ? token.slice(0, 120) : String(old.token || '')
  };
}

function cleanBranch(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, 60);
}

function cleanBranchCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 12);
}

function branchStamp(cfg) {
  const row = cfg || readSettings();
  return {
    code: cleanBranchCode(row.branchCode),
    name: cleanBranch(row.branchName)
  };
}

function orderBranch(order) {
  const pay = (order && order.payment) || {};
  return {
    code: String((order && order.branchCode) || pay.branchCode || '').trim(),
    name: String((order && order.branchName) || pay.branchName || '').trim()
  };
}

function matchesBranch(order, want) {
  const w = String(want || '').trim();
  if (!w) {
    return true;
  }
  const b = orderBranch(order);
  return b.code === w || b.name === w;
}

function collectBranches(orderList) {
  const map = {};
  (orderList || []).forEach(function (order) {
    const b = orderBranch(order);
    const key = b.code || b.name;
    if (!key) {
      return;
    }
    map[key] = b.name || b.code;
  });
  const live = branchStamp();
  if (live.code || live.name) {
    map[live.code || live.name] = live.name || live.code;
  }
  return Object.keys(map).sort().map(function (key) {
    return { id: key, name: map[key] };
  });
}

function cleanListenLan(value) {
  if (value === false || value === 0 || value === '0' || value === 'false') {
    return false;
  }
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return true;
  }
  return true;
}

function listenHost(cfg) {
  return cleanListenLan((cfg || readSettings()).listenLan) ? '0.0.0.0' : '127.0.0.1';
}

function lanAddresses() {
  const os = require('os');
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets || {}).forEach(function (name) {
    (nets[name] || []).forEach(function (row) {
      const v4 = row.family === 'IPv4' || row.family === 4;
      if (v4 && !row.internal && row.address) {
        out.push(row.address);
      }
    });
  });
  return out;
}

function lanUrls(port) {
  return lanAddresses().map(function (ip) {
    return 'http://' + ip + ':' + port;
  });
}

function cleanOpsMode(value) {
  return String(value || '') === 'sales' ? 'sales' : 'full';
}

function isStockMode(cfg) {
  return cleanOpsMode((cfg || readSettings()).opsMode) === 'full';
}

function sanitizeFolder(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return defaultBackupFolder();
  }
  if (/[\u0000*?"]/.test(raw)) {
    return defaultBackupFolder();
  }
  return path.resolve(raw).slice(0, 240);
}

function ensureBackupFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
}

function money(value) {
  const n = num.parseDec(value);
  return Number(((Number.isFinite(n) ? n : 0)).toFixed(2));
}

function clampPercent(value) {
  const n = num.parseDec(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(Math.min(100, Math.max(0, n)).toFixed(2));
}

function normalize(raw, prev) {
  const bonuses = {};
  const src = raw && raw.waiterBonuses && typeof raw.waiterBonuses === 'object' ? raw.waiterBonuses : {};
  Object.keys(src).forEach(function (id) {
    bonuses[String(id)] = clampPercent(src[id]);
  });
  return {
    serviceChargePercent: clampPercent(raw && raw.serviceChargePercent),
    waiterBonuses: bonuses,
    backupFolder: sanitizeFolder(raw && raw.backupFolder),
    ekassa: cleanEkassa(raw),
    opsMode: cleanOpsMode(raw && raw.opsMode),
    listenLan: raw && Object.prototype.hasOwnProperty.call(raw, 'listenLan')
      ? cleanListenLan(raw.listenLan)
      : true,
    branchName: cleanBranch(raw && raw.branchName),
    branchCode: cleanBranchCode(raw && raw.branchCode),
    sms: cleanSms(raw, prev || raw),
    update: cleanUpdate(raw, prev || raw),
    backupGithub: cleanBackupGithub(raw, prev || raw),
    orderCardScale: clampScale(raw && raw.orderCardScale != null ? raw.orderCardScale : 2),
    vatPercent: clampPercent(raw && raw.vatPercent),
    tillLocked: raw && (raw.tillLocked === true || raw.tillLocked === 1 || raw.tillLocked === '1' || raw.tillLocked === 'true')
  };
}

function readSettings() {
  try {
    return normalize(db.readOffice('settings.json'));
  } catch (error) {
    return defaults();
  }
}

function writeSettings(data) {
  const prev = readSettings();
  const next = normalize({
    serviceChargePercent: data.serviceChargePercent !== undefined ? data.serviceChargePercent : prev.serviceChargePercent,
    waiterBonuses: data.waiterBonuses !== undefined ? data.waiterBonuses : prev.waiterBonuses,
    backupFolder: data.backupFolder !== undefined ? data.backupFolder : prev.backupFolder,
    ekassa: data.ekassa !== undefined ? data.ekassa : prev.ekassa,
    opsMode: data.opsMode !== undefined ? data.opsMode : prev.opsMode,
    listenLan: data.listenLan !== undefined ? data.listenLan : prev.listenLan,
    branchName: data.branchName !== undefined ? data.branchName : prev.branchName,
    branchCode: data.branchCode !== undefined ? data.branchCode : prev.branchCode,
    sms: data.sms !== undefined ? data.sms : prev.sms,
    update: data.update !== undefined ? data.update : prev.update,
    backupGithub: data.backupGithub !== undefined ? data.backupGithub : prev.backupGithub,
    orderCardScale: data.orderCardScale !== undefined ? data.orderCardScale : prev.orderCardScale,
    vatPercent: data.vatPercent !== undefined ? data.vatPercent : prev.vatPercent,
    tillLocked: data.tillLocked !== undefined ? data.tillLocked : prev.tillLocked
  }, prev);
  if (next.backupFolder !== prev.backupFolder) {
    try {
      ensureBackupFolder(next.backupFolder);
    } catch (error) {
      throw new Error('Ehtiyat yeri yazılmır: ' + next.backupFolder);
    }
  }
  db.writeOffice('settings.json', next);
  return next;
}

function discountOff(itemsTotal, discount) {
  const items = money(itemsTotal);
  if (!discount || discount.cleared) {
    return 0;
  }
  if (discount.type === 'percent') {
    return money(items * clampPercent(discount.value) / 100);
  }
  if (discount.type === 'amount') {
    return money(Math.min(items, Math.max(0, Number(discount.value) || 0)));
  }
  return money(Math.min(items, Math.max(0, Number(discount.amount) || 0)));
}

// Məhsul cəminə endirim, xidmət və ofisiant bonusunu hesablayırıq
function billParts(itemsTotal, waiterId, cfg, discount) {
  const store = cfg || readSettings();
  const items = money(itemsTotal);
  const off = discountOff(items, discount);
  const after = money(Math.max(0, items - off));
  const servicePercent = store.serviceChargePercent;
  const serviceCharge = money(after * servicePercent / 100);
  const bonusPercent = clampPercent(store.waiterBonuses[String(waiterId)]);
  const bonusAmount = money(after * bonusPercent / 100);
  return {
    itemsTotal: items,
    discountAmount: off,
    discountType: discount && discount.type ? String(discount.type) : '',
    discountValue: Number(discount && discount.value) || 0,
    discountReason: discount && discount.reason ? String(discount.reason) : '',
    afterDiscount: after,
    servicePercent: servicePercent,
    serviceCharge: serviceCharge,
    bonusPercent: bonusPercent,
    bonusAmount: bonusAmount,
    total: money(after + serviceCharge)
  };
}

module.exports = {
  readSettings: readSettings,
  writeSettings: writeSettings,
  billParts: billParts,
  money: money,
  isStockMode: isStockMode,
  listenHost: listenHost,
  lanUrls: lanUrls,
  branchStamp: branchStamp,
  matchesBranch: matchesBranch,
  collectBranches: collectBranches,
  cleanBranchCode: cleanBranchCode
};
