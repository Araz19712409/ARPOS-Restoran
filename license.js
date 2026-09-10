const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const store = require('./store');
const version = require('./version');

function file() {
  return path.join(require('./db').dataDir(), 'license.json');
}

function stampFile() {
  return path.join(require('./db').dataDir(), 'machine.json');
}
const PUB_FILE = path.join(__dirname, 'license-public.pem');

function publicKeyPem() {
  if (fs.existsSync(PUB_FILE)) {
    return fs.readFileSync(PUB_FILE, 'utf8');
  }
  throw new Error('Lisenziya açarı tapılmadı.');
}

function windowsMachineGuid() {
  if (process.platform !== 'win32') {
    return '';
  }
  try {
    const out = execFileSync('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid'
    ], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const match = String(out).match(/MachineGuid\s+REG_\w+\s+([0-9a-fA-F-]{8,})/i);
    return match ? match[1].trim() : '';
  } catch (error) {
    return '';
  }
}

function hashId(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function liveId() {
  const guid = windowsMachineGuid();
  if (guid) {
    return hashId('guid|' + guid);
  }
  return hashId([os.hostname(), os.platform(), os.arch()].join('|'));
}

function legacyMacId() {
  const macs = [];
  const nets = os.networkInterfaces() || {};
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (row) {
      if (row && row.mac && row.mac !== '00:00:00:00:00:00') {
        macs.push(row.mac);
      }
    });
  });
  macs.sort();
  return hashId([os.hostname(), os.platform(), os.arch(), macs[0] || ''].join('|'));
}

function readStamp() {
  try {
    const row = store.readJson(stampFile());
    return row && row.bound && row.live ? row : null;
  } catch (error) {
    return null;
  }
}

function rememberBinding(tokenM) {
  const live = liveId();
  store.writeJson(stampFile(), {
    bound: String(tokenM || live).toLowerCase(),
    live: live
  });
}

function machineMatches(tokenM) {
  const want = String(tokenM || '').toLowerCase();
  if (!want) {
    return true;
  }
  const live = liveId();
  if (want === live || want === legacyMacId()) {
    rememberBinding(want);
    return true;
  }
  const stamp = readStamp();
  if (stamp && String(stamp.bound).toLowerCase() === want && String(stamp.live).toLowerCase() === live) {
    return true;
  }
  return false;
}

function machineId() {
  return liveId();
}

function machineText() {
  const id = machineId();
  return (id.slice(0, 4) + '-' + id.slice(4, 8) + '-' + id.slice(8, 12) + '-' + id.slice(12, 16)).toUpperCase();
}

function decodeToken(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, '');
  const parts = text.split('.');
  if (parts.length !== 4 || parts[0] !== 'ARPOS' || parts[1] !== 'v1') {
    return { error: 'Lisenziya kodu düzgün deyil.' };
  }
  let payload;
  let sig;
  try {
    payload = Buffer.from(parts[2], 'base64url');
    sig = Buffer.from(parts[3], 'base64url');
  } catch (error) {
    return { error: 'Lisenziya kodu oxunmadı.' };
  }
  if (!payload.length || sig.length !== 64) {
    return { error: 'Lisenziya kodu düzgün deyil.' };
  }
  try {
    const ok = crypto.verify(null, payload, publicKeyPem(), sig);
    if (!ok) {
      return { error: 'Lisenziya imzası saxtadır.' };
    }
  } catch (error) {
    return { error: 'Lisenziya yoxlanılmadı.' };
  }
  let data;
  try {
    data = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    return { error: 'Lisenziya içi oxunmadı.' };
  }
  if (!data || data.p !== 'ARPOS') {
    return { error: 'Bu kod Arpos Restoran üçün deyil.' };
  }
  return { data: data, token: 'ARPOS.v1.' + parts[2] + '.' + parts[3] };
}

function readLicense() {
  try {
    return store.readJson(file());
  } catch (error) {
    return null;
  }
}

function currentStatus() {
  const info = {
    product: 'Arpos Restoran',
    version: version.current(),
    machine: machineText(),
    licensed: false
  };
  const row = readLicense();
  if (!row || !row.token) {
    return info;
  }
  const parsed = decodeToken(row.token);
  if (parsed.error) {
    info.error = parsed.error;
    return info;
  }
  const data = parsed.data;
  if (data.e && Number(data.e) > 0 && Number(data.e) * 1000 < Date.now()) {
    info.error = 'Lisenziyanın müddəti bitib.';
    return info;
  }
  if (!machineMatches(data.m)) {
    info.error = 'Bu kod başqa kompüterə yazılıb.';
    return info;
  }
  info.licensed = true;
  info.name = data.n || '';
  info.expires = data.e ? Number(data.e) : 0;
  return info;
}

function activateFromOwner() {
  const ownerFile = path.join(__dirname, 'scripts', 'license-owner.js');
  const priv = path.join(__dirname, 'keys', 'arpos-private.pem');
  if (!fs.existsSync(ownerFile) || !fs.existsSync(priv)) {
    return false;
  }
  let owner;
  try {
    owner = require('./scripts/license-owner');
  } catch (error) {
    return false;
  }
  const made = owner.issue({ name: 'Arpos Restoran', machine: machineId() });
  if (made.error || !made.token) {
    return false;
  }
  const out = activate(made.token);
  return !out.error;
}

let ownerAttempted = false;

function status() {
  const info = currentStatus();
  if (info.licensed) {
    return info;
  }
  if (!ownerAttempted) {
    ownerAttempted = true;
    if (activateFromOwner()) {
      return currentStatus();
    }
  }
  return info;
}

function isLicensed() {
  return status().licensed === true;
}

function activate(raw) {
  const parsed = decodeToken(raw);
  if (parsed.error) {
    return { error: parsed.error };
  }
  const data = parsed.data;
  if (data.e && Number(data.e) > 0 && Number(data.e) * 1000 < Date.now()) {
    return { error: 'Lisenziyanın müddəti bitib.' };
  }
  if (data.m && !machineMatches(data.m)) {
    return { error: 'Bu kod bu kompüter üçün deyil. Maşın kodunu göndərin.' };
  }
  rememberBinding(data.m);
  const row = {
    token: parsed.token,
    machine: liveId(),
    name: String(data.n || '').slice(0, 60),
    activatedAt: new Date().toISOString(),
    version: version.current()
  };
  store.writeJson(file(), row);
  version.record('license', 'Lisenziya aktiv oldu');
  return { ok: true, status: status() };
}

module.exports = {
  machineId: machineId,
  machineText: machineText,
  status: status,
  isLicensed: isLicensed,
  activate: activate,
  decodeToken: decodeToken
};
