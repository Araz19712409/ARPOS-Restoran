const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./store');
const version = require('./version');

const FILE = path.join(__dirname, 'data', 'license.json');
const PUB_FILE = path.join(__dirname, 'license-public.pem');

function publicKeyPem() {
  if (fs.existsSync(PUB_FILE)) {
    return fs.readFileSync(PUB_FILE, 'utf8');
  }
  throw new Error('Lisenziya açarı tapılmadı.');
}

function machineId() {
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
  const raw = [os.hostname(), os.platform(), os.arch(), macs[0] || ''].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
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
    return store.readJson(FILE);
  } catch (error) {
    return null;
  }
}

function status() {
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
  const mine = machineId();
  if (data.m && String(data.m).toLowerCase() !== mine) {
    info.error = 'Bu kod başqa kompüterə yazılıb.';
    return info;
  }
  if (row.machine && String(row.machine).toLowerCase() !== mine) {
    info.error = 'Lisenziya bu kompüterə bağlı deyil.';
    return info;
  }
  info.licensed = true;
  info.name = data.n || '';
  info.expires = data.e ? Number(data.e) : 0;
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
  const mine = machineId();
  if (data.m && String(data.m).toLowerCase() !== mine) {
    return { error: 'Bu kod bu kompüter üçün deyil. Maşın kodunu göndərin.' };
  }
  const row = {
    token: parsed.token,
    machine: mine,
    name: String(data.n || '').slice(0, 60),
    activatedAt: new Date().toISOString(),
    version: version.current()
  };
  store.writeJson(FILE, row);
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
