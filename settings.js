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

function emptyStock() {
  return { salesWarehouseId: 1, blockSaleIfShort: true };
}

function cleanStock(raw) {
  const src = raw && raw.stock && typeof raw.stock === 'object' ? raw.stock : {};
  const n = Math.round(Number(src.salesWarehouseId));
  return {
    salesWarehouseId: Number.isInteger(n) && n >= 1 ? n : 1,
    blockSaleIfShort: src.blockSaleIfShort !== false
  };
}

function emptyLoyalty() {
  return {
    enabled: false,
    earnPer100: 1,
    pointValueMinor: 1,
    minRedeem: 1
  };
}

function cleanLoyalty(raw) {
  const src = raw && raw.loyalty && typeof raw.loyalty === 'object' ? raw.loyalty : {};
  const earn = Math.round(Number(src.earnPer100));
  const value = Math.round(Number(src.pointValueMinor));
  const minR = Math.round(Number(src.minRedeem));
  return {
    enabled: src.enabled === true || src.enabled === 1 || src.enabled === '1' || src.enabled === 'true',
    earnPer100: Number.isInteger(earn) && earn >= 0 && earn <= 100 ? earn : 1,
    pointValueMinor: Number.isInteger(value) && value >= 1 && value <= 10000 ? value : 1,
    minRedeem: Number.isInteger(minR) && minR >= 1 && minR <= 100000 ? minR : 1
  };
}

function publicLoyalty(row) {
  const src = row && typeof row === 'object' ? row : emptyLoyalty();
  return {
    enabled: src.enabled === true,
    earnPer100: src.earnPer100,
    pointValueMinor: src.pointValueMinor,
    minRedeem: src.minRedeem
  };
}

function shiftFlagOn(src, key) {
  const v = src && src[key];
  return !(v === false || v === 0 || v === '0' || v === 'false');
}

function emptyShift() {
  return {
    autoOpenOnSale: true,
    autoPrintZ: true,
    showCashOnOrders: true,
    carryCountedCash: true,
    defaultStartingCash: 0
  };
}

function cleanShift(raw) {
  const src = raw && raw.shift && typeof raw.shift === 'object' ? raw.shift : {};
  const cash = Number(src.defaultStartingCash);
  return {
    autoOpenOnSale: src.autoOpenOnSale !== false,
    autoPrintZ: shiftFlagOn(src, 'autoPrintZ'),
    showCashOnOrders: shiftFlagOn(src, 'showCashOnOrders'),
    carryCountedCash: shiftFlagOn(src, 'carryCountedCash'),
    defaultStartingCash: Number.isFinite(cash) && cash >= 0 ? Number(cash.toFixed(2)) : 0
  };
}

function emptyDelivery() {
  return {
    provider: 'manual',
    autoPrintKitchen: true,
    webhookSecret: ''
  };
}

function cleanDelivery(raw) {
  const src = raw && raw.delivery && typeof raw.delivery === 'object' ? raw.delivery : {};
  const provider = ['none', 'manual', 'wolt', 'bolt', 'glovo'].indexOf(String(src.provider || '')) >= 0
    ? String(src.provider)
    : 'manual';
  return {
    provider: provider,
    autoPrintKitchen: src.autoPrintKitchen !== false,
    webhookSecret: String(src.webhookSecret || '').replace(/[\r\n]/g, '').trim().slice(0, 80)
  };
}

function publicDelivery(row) {
  const src = row && typeof row === 'object' ? row : emptyDelivery();
  return {
    provider: src.provider || 'manual',
    autoPrintKitchen: src.autoPrintKitchen !== false
  };
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

function publicSms(row) {
  const src = row && typeof row === 'object' ? row : emptySms();
  return {
    enabled: src.enabled === true,
    sender: src.sender || '',
    reserveText: src.reserveText || '',
    waitText: src.waitText || ''
  };
}

function cleanPrintCopies(raw) {
  const n = Number(raw);
  return n === 2 ? 2 : 1;
}

function cleanAutoPrintOnPay(raw) {
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') {
    return false;
  }
  return true;
}

function emptyReceipt() {
  return {
    title: '',
    address: '',
    phone: '',
    headerLines: [],
    footerLines: [],
    showBranchCode: false,
    logo: '',
    printCopies: 1,
    autoPrintOnPay: true
  };
}

function cleanLineList(list, maxCount, maxLen) {
  const out = [];
  (Array.isArray(list) ? list : String(list || '').split(/\r?\n/)).forEach(function (row) {
    if (out.length >= maxCount) {
      return;
    }
    const text = String(row == null ? '' : row).trim().slice(0, maxLen);
    if (text) {
      out.push(text);
    }
  });
  return out;
}

function cleanReceiptLogo(raw) {
  const s = String(raw || '').trim();
  if (!s || /^data:/i.test(s)) {
    return '';
  }
  const m = s.match(/^\/uploads\/receipt-logo\.(png|jpe?g|webp)(?:\?.*)?$/i);
  if (!m) {
    return '';
  }
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') {
    ext = 'jpg';
  }
  return '/uploads/receipt-logo.' + ext;
}

function cleanReceipt(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    title: String(src.title || '').trim().slice(0, 80),
    address: String(src.address || '').trim().slice(0, 80),
    phone: String(src.phone || '').trim().slice(0, 40),
    headerLines: cleanLineList(src.headerLines, 2, 60),
    footerLines: cleanLineList(src.footerLines, 3, 60),
    showBranchCode: src.showBranchCode === true || src.showBranchCode === 1 ||
      src.showBranchCode === '1' || src.showBranchCode === 'true',
    logo: cleanReceiptLogo(src.logo),
    printCopies: cleanPrintCopies(src.printCopies),
    autoPrintOnPay: cleanAutoPrintOnPay(src.autoPrintOnPay)
  };
}

function receiptPrintCopies(cfg) {
  const row = cfg || readSettings();
  return cleanPrintCopies((row.receipt || emptyReceipt()).printCopies);
}

function receiptAutoPrintOnPay(cfg) {
  const row = cfg || readSettings();
  return cleanAutoPrintOnPay((row.receipt || emptyReceipt()).autoPrintOnPay);
}

function receiptTitle(cfg) {
  const row = cfg || readSettings();
  const r = row.receipt || emptyReceipt();
  const title = String(r.title || '').trim();
  if (title) {
    return title;
  }
  const branch = String(row.branchName || '').trim();
  return branch || 'Arpos Restoran';
}

function publicReceipt(cfg) {
  const row = cfg || readSettings();
  const cleaned = cleanReceipt(row.receipt || emptyReceipt());
  const logo = cleaned.logo || '';
  return Object.assign({}, cleaned, {
    logoUrl: logo,
    hasLogo: !!logo
  });
}

const RECEIPT_LOGO_DIR = path.join(__dirname, 'public', 'uploads');
const RECEIPT_LOGO_MAX = 200 * 1024;

function ensureReceiptUploadDir() {
  fs.mkdirSync(RECEIPT_LOGO_DIR, { recursive: true });
}

function clearReceiptLogoFiles() {
  ensureReceiptUploadDir();
  ['png', 'jpg', 'webp'].forEach(function (ext) {
    try {
      fs.unlinkSync(path.join(RECEIPT_LOGO_DIR, 'receipt-logo.' + ext));
    } catch (error) {
      /* yoxdur */
    }
  });
}

function saveReceiptLogo(imageData) {
  const match = String(imageData || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    return { error: 'Logo PNG, JPG və ya WEBP olmalıdır.' };
  }
  let ext = match[1].toLowerCase();
  if (ext === 'jpeg') {
    ext = 'jpg';
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch (error) {
    return { error: 'Logo oxunmadı.' };
  }
  if (!buffer.length) {
    return { error: 'Logo boşdur.' };
  }
  if (buffer.length > RECEIPT_LOGO_MAX) {
    return { error: 'Logo 200 KB-dan böyük ola bilməz.' };
  }
  ensureReceiptUploadDir();
  clearReceiptLogoFiles();
  const fileName = 'receipt-logo.' + ext;
  fs.writeFileSync(path.join(RECEIPT_LOGO_DIR, fileName), buffer);
  return { path: '/uploads/' + fileName };
}

function removeReceiptLogo() {
  clearReceiptLogoFiles();
  const next = writeSettings({
    receipt: Object.assign({}, readSettings().receipt || emptyReceipt(), { logo: '' })
  });
  return next.receipt;
}

function emptyPay() {
  return { simpleMode: true, nextTableAfterClose: true };
}

function cleanPay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    simpleMode: !(src.simpleMode === false || src.simpleMode === 0 ||
      src.simpleMode === '0' || src.simpleMode === 'false'),
    nextTableAfterClose: !(src.nextTableAfterClose === false || src.nextTableAfterClose === 0 ||
      src.nextTableAfterClose === '0' || src.nextTableAfterClose === 'false')
  };
}

function publicPay(cfg) {
  const row = cfg || readSettings();
  return cleanPay(row.pay || emptyPay());
}

function officeSms(row) {
  const src = row && row.sms && typeof row.sms === 'object' ? row.sms : emptySms();
  return {
    enabled: src.enabled === true,
    url: String(src.url || ''),
    login: String(src.login || ''),
    hasPassword: !!String(src.password || ''),
    sender: src.sender || '',
    reserveText: src.reserveText || '',
    waitText: src.waitText || ''
  };
}

function officeUpdate(row) {
  const src = row && row.update && typeof row.update === 'object' ? row.update : emptyUpdate();
  return {
    repo: String(src.repo || ''),
    hasToken: !!String(src.token || '')
  };
}

function officeBackupGithub(row) {
  const src = row && row.backupGithub && typeof row.backupGithub === 'object' ? row.backupGithub : emptyBackupGithub();
  return {
    repo: String(src.repo || ''),
    hasToken: !!String(src.token || '')
  };
}

function officeEkassa(row) {
  const ek = cleanEkassa({ ekassa: row && row.ekassa });
  return {
    provider: ek.provider,
    emulator: ek.emulator,
    voen: ek.voen,
    objectName: ek.objectName,
    objectCode: ek.objectCode,
    operator: ek.operator,
    note: ek.note,
    wizarpos: {
      host: ek.wizarpos.host,
      port: ek.wizarpos.port,
      cashier: ek.wizarpos.cashier,
      hasApiKey: !!ek.wizarpos.apiKey
    },
    omnitech: {
      host: ek.omnitech.host,
      port: ek.omnitech.port,
      user: ek.omnitech.user,
      hasPassword: !!ek.omnitech.password
    },
    azsmart: {
      host: ek.azsmart.host,
      port: ek.azsmart.port,
      merchantId: ek.azsmart.merchantId
    }
  };
}

function officeDelivery(row) {
  const src = row && row.delivery && typeof row.delivery === 'object' ? row.delivery : emptyDelivery();
  return {
    provider: src.provider || 'manual',
    autoPrintKitchen: src.autoPrintKitchen !== false,
    hasWebhookSecret: !!String(src.webhookSecret || '')
  };
}

function forOffice(cfg) {
  const row = cfg || readSettings();
  const shift = row.shift && typeof row.shift === 'object' ? row.shift : emptyShift();
  const stock = row.stock && typeof row.stock === 'object' ? row.stock : emptyStock();
  const cash = Number(shift.defaultStartingCash);
  return {
    serviceChargePercent: Number(row.serviceChargePercent) || 0,
    waiterBonuses: Object.assign({}, row.waiterBonuses || {}),
    backupFolder: String(row.backupFolder || ''),
    ekassa: officeEkassa(row),
    delivery: officeDelivery(row),
    stock: {
      salesWarehouseId: Number(stock.salesWarehouseId) >= 1 ? Number(stock.salesWarehouseId) : 1,
      blockSaleIfShort: stock.blockSaleIfShort !== false
    },
    autoSendAllOnAccept: row.autoSendAllOnAccept !== false,
    shift: {
      autoOpenOnSale: shift.autoOpenOnSale !== false,
      autoPrintZ: shift.autoPrintZ !== false,
      showCashOnOrders: shift.showCashOnOrders !== false,
      carryCountedCash: shift.carryCountedCash !== false,
      defaultStartingCash: Number.isFinite(cash) && cash >= 0 ? Number(cash.toFixed(2)) : 0
    },
    loyalty: publicLoyalty(row.loyalty),
    opsMode: row.opsMode === 'sales' ? 'sales' : 'full',
    listenLan: row.listenLan !== false,
    httpsPort: Number(row.httpsPort) || 3443,
    branchName: String(row.branchName || '').slice(0, 80),
    branchCode: String(row.branchCode || '').slice(0, 12),
    sms: officeSms(row),
    update: officeUpdate(row),
    backupGithub: officeBackupGithub(row),
    orderCardScale: clampScale(row.orderCardScale),
    vatPercent: Number(row.vatPercent) || 0,
    tillLocked: row.tillLocked === true,
    receipt: publicReceipt(row),
    pay: publicPay(row)
  };
}

function forPos(cfg) {
  const row = cfg || readSettings();
  const shift = row.shift && typeof row.shift === 'object' ? row.shift : emptyShift();
  const stock = row.stock && typeof row.stock === 'object' ? row.stock : emptyStock();
  const cash = Number(shift.defaultStartingCash);
  return {
    serviceChargePercent: Number(row.serviceChargePercent) || 0,
    waiterBonuses: Object.assign({}, row.waiterBonuses || {}),
    autoSendAllOnAccept: row.autoSendAllOnAccept !== false,
    shift: {
      autoOpenOnSale: shift.autoOpenOnSale !== false,
      autoPrintZ: shift.autoPrintZ !== false,
      showCashOnOrders: shift.showCashOnOrders !== false,
      carryCountedCash: shift.carryCountedCash !== false,
      defaultStartingCash: Number.isFinite(cash) && cash >= 0 ? Number(cash.toFixed(2)) : 0
    },
    stock: {
      salesWarehouseId: Number(stock.salesWarehouseId) >= 1 ? Number(stock.salesWarehouseId) : 1,
      blockSaleIfShort: stock.blockSaleIfShort !== false
    },
    opsMode: row.opsMode === 'sales' ? 'sales' : 'full',
    branchName: String(row.branchName || '').slice(0, 80),
    branchCode: String(row.branchCode || '').slice(0, 12),
    orderCardScale: clampScale(row.orderCardScale),
    vatPercent: Number(row.vatPercent) || 0,
    tillLocked: row.tillLocked === true,
    ekassa: publicEkassa(row.ekassa),
    delivery: publicDelivery(row.delivery),
    sms: publicSms(row.sms),
    loyalty: publicLoyalty(row.loyalty),
    receipt: publicReceipt(row),
    pay: publicPay(row)
  };
}

function defaults() {
  return {
    serviceChargePercent: 0,
    waiterBonuses: {},
    backupFolder: defaultBackupFolder(),
    ekassa: emptyEkassa(),
    delivery: emptyDelivery(),
    stock: emptyStock(),
    autoSendAllOnAccept: true,
    shift: emptyShift(),
    loyalty: emptyLoyalty(),
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
    tillLocked: false,
    receipt: emptyReceipt(),
    pay: emptyPay()
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
    delivery: cleanDelivery(raw),
    stock: cleanStock(raw),
    autoSendAllOnAccept: raw && raw.autoSendAllOnAccept === false ? false : true,
    shift: cleanShift(raw),
    loyalty: cleanLoyalty(raw),
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
    tillLocked: raw && (raw.tillLocked === true || raw.tillLocked === 1 || raw.tillLocked === '1' || raw.tillLocked === 'true'),
    receipt: cleanReceipt(raw && raw.receipt),
    pay: cleanPay(raw && raw.pay)
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
    delivery: data.delivery !== undefined ? data.delivery : prev.delivery,
    stock: data.stock !== undefined ? data.stock : prev.stock,
    autoSendAllOnAccept: data.autoSendAllOnAccept !== undefined ? data.autoSendAllOnAccept : prev.autoSendAllOnAccept,
    shift: data.shift !== undefined ? data.shift : prev.shift,
    loyalty: data.loyalty !== undefined ? data.loyalty : prev.loyalty,
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
    tillLocked: data.tillLocked !== undefined ? data.tillLocked : prev.tillLocked,
    receipt: data.receipt !== undefined ? data.receipt : prev.receipt,
    pay: data.pay !== undefined ? data.pay : prev.pay
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

function autoSendAllOnAccept(cfg) {
  const row = cfg || readSettings();
  return row.autoSendAllOnAccept !== false;
}

function unsentPayHint(cfg) {
  return autoSendAllOnAccept(cfg)
    ? 'Əvvəlcə sətirləri qəbul edin.'
    : 'Əvvəlcə isti kursu göndərin.';
}

function blockSaleIfShort(cfg) {
  const row = cfg || readSettings();
  const stock = row.stock && typeof row.stock === 'object' ? row.stock : emptyStock();
  return stock.blockSaleIfShort !== false;
}

function nextFiredCourse(firedCourse, cfg) {
  const cur = Math.max(1, Number(firedCourse) || 1);
  return autoSendAllOnAccept(cfg) ? Math.max(cur, 2) : cur;
}

function kitchenSendNow(course, firedCourse, cfg) {
  if (autoSendAllOnAccept(cfg)) {
    return true;
  }
  const n = Number(course);
  return n === 0 || n <= Number(firedCourse || 1);
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
  forOffice: forOffice,
  publicEkassa: publicEkassa,
  publicDelivery: publicDelivery,
  emptyDelivery: emptyDelivery,
  emptyReceipt: emptyReceipt,
  cleanReceipt: cleanReceipt,
  cleanReceiptLogo: cleanReceiptLogo,
  cleanPrintCopies: cleanPrintCopies,
  receiptPrintCopies: receiptPrintCopies,
  receiptAutoPrintOnPay: receiptAutoPrintOnPay,
  cleanAutoPrintOnPay: cleanAutoPrintOnPay,
  receiptTitle: receiptTitle,
  publicReceipt: publicReceipt,
  saveReceiptLogo: saveReceiptLogo,
  removeReceiptLogo: removeReceiptLogo,
  emptyPay: emptyPay,
  cleanPay: cleanPay,
  publicPay: publicPay,
  autoSendAllOnAccept: autoSendAllOnAccept,
  unsentPayHint: unsentPayHint,
  blockSaleIfShort: blockSaleIfShort,
  nextFiredCourse: nextFiredCourse,
  kitchenSendNow: kitchenSendNow
};
