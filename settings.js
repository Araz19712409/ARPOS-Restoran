const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const num = require('./num');
const db = require('./db');

function defaultBackupFolder() {
  return path.join(db.dataDir(), 'backups');
}

function cleanPort(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return fallback;
  }
  return n;
}

function cleanHost(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').split('/')[0].slice(0, 80);
}

function emptyEkassa() {
  return {
    provider: 'none',
    emulator: true,
    voen: '',
    objectName: '',
    objectCode: '',
    operator: '',
    note: '',
    wizarpos: { host: '', port: 9876, apiKey: '', cashier: '' },
    omnitech: { host: '', port: 8989, user: '', password: '' },
    azsmart: { host: '', port: 8008, merchantId: '' }
  };
}

function cleanEkassa(raw) {
  const src = raw && raw.ekassa && typeof raw.ekassa === 'object' ? raw.ekassa : {};
  const wz = src.wizarpos && typeof src.wizarpos === 'object' ? src.wizarpos : {};
  const om = src.omnitech && typeof src.omnitech === 'object' ? src.omnitech : {};
  const az = src.azsmart && typeof src.azsmart === 'object' ? src.azsmart : {};
  const provider = ['none', 'wizarpos', 'omnitech', 'azsmart'].indexOf(String(src.provider || '')) >= 0
    ? String(src.provider)
    : 'none';
  return {
    provider: provider,
    emulator: src.emulator !== false,
    voen: String(src.voen || '').replace(/\D/g, '').slice(0, 10),
    objectName: String(src.objectName || '').trim().slice(0, 80),
    objectCode: String(src.objectCode || '').trim().slice(0, 40),
    operator: String(src.operator || '').trim().slice(0, 40),
    note: String(src.note || '').trim().slice(0, 80),
    wizarpos: {
      host: cleanHost(wz.host),
      port: cleanPort(wz.port, 9876),
      apiKey: String(wz.apiKey || '').trim().slice(0, 80),
      cashier: String(wz.cashier || '').trim().slice(0, 40)
    },
    omnitech: {
      host: cleanHost(om.host),
      port: cleanPort(om.port, 8989),
      user: String(om.user || '').trim().slice(0, 40),
      password: String(om.password || '').trim().slice(0, 80)
    },
    azsmart: {
      host: cleanHost(az.host),
      port: cleanPort(az.port, 8008),
      merchantId: String(az.merchantId || '').trim().slice(0, 80)
    }
  };
}

function publicEkassa(ek) {
  const src = ek && typeof ek === 'object' ? ek : emptyEkassa();
  return {
    provider: src.provider || 'none',
    emulator: src.emulator !== false,
    voen: src.voen || '',
    objectName: src.objectName || '',
    objectCode: src.objectCode || '',
    operator: src.operator || '',
    note: src.note || ''
  };
}

function forPos(cfg) {
  const row = cfg || readSettings();
  const copy = Object.assign({}, row);
  copy.ekassa = publicEkassa(row.ekassa);
  return copy;
}

function defaults() {
  return {
    serviceChargePercent: 0,
    waiterBonuses: {},
    backupFolder: defaultBackupFolder(),
    ekassa: emptyEkassa(),
    opsMode: 'full',
    listenLan: true,
    httpsPort: 3443,
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

function cleanHttpsPort(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 65535 || n === 3004) {
    return 3443;
  }
  return n;
}

function httpsPort(cfg) {
  return cleanHttpsPort((cfg || readSettings()).httpsPort);
}

function derLen(n) {
  if (n < 128) {
    return Buffer.from([n]);
  }
  if (n < 256) {
    return Buffer.from([0x81, n]);
  }
  return Buffer.from([0x82, (n >> 8) & 255, n & 255]);
}

function der(tag, chunks) {
  const body = Buffer.concat(Array.isArray(chunks) ? chunks : [chunks]);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

function derInt(buf) {
  if (!Buffer.isBuffer(buf)) {
    buf = Buffer.from(buf);
  }
  if (buf.length && (buf[0] & 0x80)) {
    buf = Buffer.concat([Buffer.from([0]), buf]);
  }
  return der(0x02, buf);
}

function derOid(oid) {
  const p = String(oid).split('.').map(function (x) {
    return parseInt(x, 10);
  });
  const bytes = [p[0] * 40 + p[1]];
  var i;
  for (i = 2; i < p.length; i += 1) {
    var v = p[i];
    const tmp = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      tmp.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    var j;
    for (j = tmp.length - 1; j >= 0; j -= 1) {
      bytes.push(tmp[j]);
    }
  }
  return der(0x06, Buffer.from(bytes));
}

function derUtc(date) {
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  const s = pad(date.getUTCFullYear() % 100) + pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) + 'Z';
  return der(0x17, Buffer.from(s));
}

function derCn(name) {
  return der(0x30, [
    der(0x31, der(0x30, [
      derOid('2.5.4.3'),
      der(0x0c, Buffer.from(String(name), 'utf8'))
    ]))
  ]);
}

function derAlg() {
  return der(0x30, [derOid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00])]);
}

function derSan(ips) {
  const parts = [der(0x82, Buffer.from('localhost'))];
  function addIp(ip) {
    const oct = String(ip).split('.').map(Number);
    if (oct.length !== 4) {
      return;
    }
    if (oct.some(function (n) {
      return !Number.isFinite(n) || n < 0 || n > 255;
    })) {
      return;
    }
    parts.push(der(0x87, Buffer.from(oct)));
  }
  addIp('127.0.0.1');
  (ips || []).forEach(addIp);
  return der(0x30, [
    derOid('2.5.29.17'),
    der(0x04, der(0x30, parts))
  ]);
}

function makeSelfSigned(ips) {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
  const keyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const now = Date.now();
  const serial = crypto.randomBytes(8);
  serial[0] = serial[0] & 0x7f;
  const name = derCn('Arpos Restoran');
  const tbs = der(0x30, [
    der(0xa0, derInt(Buffer.from([2]))),
    derInt(serial),
    derAlg(),
    name,
    der(0x30, [
      derUtc(new Date(now - 86400000)),
      derUtc(new Date(now + 10 * 365 * 86400000))
    ]),
    name,
    spki,
    der(0xa3, der(0x30, derSan(ips)))
  ]);
  const sig = crypto.sign('sha256', tbs, pair.privateKey);
  const certDer = der(0x30, [
    tbs,
    derAlg(),
    der(0x03, Buffer.concat([Buffer.from([0x00]), sig]))
  ]);
  const b64 = certDer.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    keyPem: keyPem,
    certPem: '-----BEGIN CERTIFICATE-----\n' + b64 + '\n-----END CERTIFICATE-----\n'
  };
}

function tlsPaths() {
  const dir = path.join(db.dataDir(), 'tls');
  return {
    dir: dir,
    key: path.join(dir, 'key.pem'),
    cert: path.join(dir, 'cert.pem')
  };
}

function ensureTls() {
  const files = tlsPaths();
  fs.mkdirSync(files.dir, { recursive: true });
  const have = fs.existsSync(files.key) && fs.existsSync(files.cert);
  let generated = false;
  if (!have) {
    const made = makeSelfSigned(lanAddresses());
    fs.writeFileSync(files.key, made.keyPem, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(files.cert, made.certPem, { encoding: 'utf8', mode: 0o644 });
    generated = true;
  }
  return {
    key: fs.readFileSync(files.key),
    cert: fs.readFileSync(files.cert),
    port: httpsPort(),
    generated: generated,
    keyPath: files.key,
    certPath: files.cert
  };
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

function lanUrls(port, cfg) {
  const store = cfg || readSettings();
  const useHttps = cleanListenLan(store.listenLan);
  const p = useHttps ? httpsPort(store) : (Number(port) || 3004);
  const scheme = useHttps ? 'https' : 'http';
  return lanAddresses().map(function (ip) {
    return scheme + '://' + ip + ':' + p;
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
  return num.fromMinor(num.toMinor(value));
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
    httpsPort: cleanHttpsPort(raw && raw.httpsPort),
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
    httpsPort: data.httpsPort !== undefined ? data.httpsPort : prev.httpsPort,
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
  const items = num.toMinor(itemsTotal);
  if (!discount || discount.cleared) {
    return 0;
  }
  if (discount.type === 'percent') {
    return Math.round(items * clampPercent(discount.value) / 100);
  }
  const amt = num.toMinor(discount.value != null ? discount.value : discount.amount);
  return Math.min(items, Math.max(0, amt));
}

// Məhsul cəminə endirim, xidmət və ofisiant bonusunu hesablayırıq
function billParts(itemsTotal, waiterId, cfg, discount) {
  const store = cfg || readSettings();
  const items = num.toMinor(itemsTotal);
  const off = discountOff(itemsTotal, discount);
  const after = Math.max(0, num.subMinor(items, off));
  const servicePercent = store.serviceChargePercent;
  const serviceCharge = Math.round(after * servicePercent / 100);
  const bonusPercent = clampPercent(store.waiterBonuses[String(waiterId)]);
  const bonusAmount = Math.round(after * bonusPercent / 100);
  return {
    itemsTotal: num.fromMinor(items),
    discountAmount: num.fromMinor(off),
    discountType: discount && discount.type ? String(discount.type) : '',
    discountValue: Number(discount && discount.value) || 0,
    discountReason: discount && discount.reason ? String(discount.reason) : '',
    afterDiscount: num.fromMinor(after),
    servicePercent: servicePercent,
    serviceCharge: num.fromMinor(serviceCharge),
    bonusPercent: bonusPercent,
    bonusAmount: num.fromMinor(bonusAmount),
    total: num.fromMinor(num.addMinor(after, serviceCharge))
  };
}

module.exports = {
  readSettings: readSettings,
  writeSettings: writeSettings,
  billParts: billParts,
  money: money,
  isStockMode: isStockMode,
  listenHost: listenHost,
  httpsPort: httpsPort,
  ensureTls: ensureTls,
  lanUrls: lanUrls,
  branchStamp: branchStamp,
  matchesBranch: matchesBranch,
  collectBranches: collectBranches,
  cleanBranchCode: cleanBranchCode,
  forPos: forPos,
  publicEkassa: publicEkassa
};
