const crypto = require('crypto');
const http = require('http');
const types = require('./types');

function sign(dt, nonce, apiKey) {
  return crypto.createHash('sha256')
    .update(String(dt || '') + String(nonce || '') + String(apiKey || ''), 'utf8')
    .digest('hex');
}

function nowDt() {
  const d = new Date();
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function rowOf(cfg) {
  return (cfg && cfg.wizarpos) || {};
}

function request(cfg, path, body) {
  const row = rowOf(cfg);
  const host = String(row.host || '').trim();
  const port = Number(row.port) || 9876;
  if (!host) {
    return Promise.resolve(types.result(false, '', 'WizarPOS host boşdur.'));
  }
  const payload = JSON.stringify(body || {});
  const dt = nowDt();
  const nonce = crypto.randomBytes(8).toString('hex');
  const token = sign(dt, nonce, row.apiKey || '');
  return new Promise(function (resolve) {
    const req = http.request({
      host: host,
      port: port,
      path: path,
      method: 'POST',
      timeout: 4000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        dt: dt,
        nonce: nonce,
        token: token
      }
    }, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { raw += chunk; });
      res.on('end', function () {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          parsed = null;
        }
        const fiscalId = parsed && (parsed.fiscalId || parsed.fiscal_id || parsed.docId);
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve(types.result(
          ok,
          fiscalId,
          ok ? 'WizarPOS qəbul etdi.' : ('WizarPOS xəta: ' + res.statusCode),
          { status: res.statusCode }
        ));
      });
    });
    req.on('timeout', function () {
      req.destroy();
      resolve(types.result(false, '', 'WizarPOS cavab vermədi.'));
    });
    req.on('error', function () {
      resolve(types.result(false, '', 'WizarPOS bağlana bilmədi.'));
    });
    req.write(payload);
    req.end();
  });
}

function create(cfg) {
  const row = rowOf(cfg);
  return {
    id: 'wizarpos',
    label: 'WizarPOS',
    mode: 'skeleton',
    isConfigured: function () {
      if (types.isEmulator(cfg)) {
        return true;
      }
      return !!(String(row.host || '').trim() && String(row.apiKey || '').trim());
    },
    testConnection: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'wizarpos' }));
      }
      return request(cfg, '/kas_status', { ping: true });
    },
    getShiftStatus: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'wizarpos', shift: 'open' }));
      }
      return request(cfg, '/kas_shift', { action: 'status' });
    },
    openShift: function (cashier) {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'wizarpos' }));
      }
      return request(cfg, '/kas_shift', { action: 'open', cashier: cashier || row.cashier || '' });
    },
    closeShiftZ: function () {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuOk({ provider: 'wizarpos' }));
      }
      return request(cfg, '/kas_z', { action: 'close' });
    },
    registerSale: function (payload) {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuSale(payload && payload.job));
      }
      return request(cfg, '/kas_sale', payload || {});
    },
    registerMoneyBack: function (payload) {
      if (types.isEmulator(cfg)) {
        return Promise.resolve(types.emuSale(payload && payload.job));
      }
      return request(cfg, '/kas_refund', payload || {});
    }
  };
}

module.exports = {
  create: create,
  sign: sign
};
