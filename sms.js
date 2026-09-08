const http = require('http');
const https = require('https');
const settings = require('./settings');

function fillTpl(tpl, map) {
  return String(tpl || '').replace(/\{(\w+)\}/g, function (_, key) {
    return map[key] != null ? String(map[key]) : '';
  });
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function requestUrl(url) {
  return new Promise(function (resolve, reject) {
    const lib = String(url).indexOf('https:') === 0 ? https : http;
    const req = lib.get(url, function (res) {
      let buf = '';
      res.on('data', function (chunk) {
        buf += chunk;
      });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, body: buf.slice(0, 200) });
          return;
        }
        reject(new Error('SMS cavabı ' + res.statusCode));
      });
    });
    req.on('error', function (error) {
      reject(error);
    });
    req.setTimeout(8000, function () {
      req.destroy();
      reject(new Error('SMS vaxtı bitdi.'));
    });
  });
}

function send(phone, text) {
  const cfg = settings.readSettings().sms || {};
  const dest = digits(phone);
  const body = String(text || '').trim().slice(0, 300);
  if (!cfg.enabled) {
    return Promise.resolve({ skipped: true });
  }
  if (dest.length < 9) {
    return Promise.resolve({ skipped: true, error: 'Telefon düzgün deyil.' });
  }
  if (!cfg.url) {
    return Promise.resolve({ skipped: true, error: 'SMS ünvanı boşdur.' });
  }
  const built = fillTpl(cfg.url, {
    phone: dest,
    text: encodeURIComponent(body),
    login: encodeURIComponent(cfg.login || ''),
    password: encodeURIComponent(cfg.password || ''),
    sender: encodeURIComponent(cfg.sender || '')
  });
  const sep = built.indexOf('?') >= 0 ? '&' : '?';
  const url = /\{phone\}|\{text\}/.test(cfg.url)
    ? built
    : built + sep + 'dest=' + dest + '&text=' + encodeURIComponent(body) +
      (cfg.login ? '&user=' + encodeURIComponent(cfg.login) : '') +
      (cfg.password ? '&password=' + encodeURIComponent(cfg.password) : '') +
      (cfg.sender ? '&sender=' + encodeURIComponent(cfg.sender) : '');
  return requestUrl(url).then(function () {
    return { ok: true };
  });
}

function notifyReserve(row) {
  const cfg = settings.readSettings().sms || {};
  const text = fillTpl(cfg.reserveText, {
    name: row.name || '',
    table: row.tableName || '',
    time: row.at || '',
    guests: row.guests || '',
    phone: row.phone || ''
  });
  return send(row.phone, text);
}

function notifyWait(row) {
  const cfg = settings.readSettings().sms || {};
  const text = fillTpl(cfg.waitText, {
    name: row.name || '',
    guests: row.guests || '',
    phone: row.phone || ''
  });
  return send(row.phone, text);
}

module.exports = {
  fillTpl: fillTpl,
  send: send,
  notifyReserve: notifyReserve,
  notifyWait: notifyWait
};
