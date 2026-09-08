const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const settings = require('./settings');

const ROOT = __dirname;
const PKG = path.join(ROOT, 'package.json');
const UPD_DIR = path.join(ROOT, 'data', 'updates');

function version() {
  try {
    return String(require(PKG).version || '0.0.0');
  } catch (error) {
    return '0.0.0';
  }
}

function stripV(value) {
  return String(value || '').replace(/^v/i, '').trim();
}

function newer(remote, local) {
  const a = stripV(remote).split('.').map(function (n) { return Number(n) || 0; });
  const b = stripV(local).split('.').map(function (n) { return Number(n) || 0; });
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) {
      return true;
    }
    if ((a[i] || 0) < (b[i] || 0)) {
      return false;
    }
  }
  return false;
}

function httpsJson(url, token) {
  return new Promise(function (resolve, reject) {
    const opts = {
      headers: {
        'User-Agent': 'ArposRestoran',
        Accept: 'application/vnd.github+json'
      }
    };
    if (token) {
      opts.headers.Authorization = 'Bearer ' + token;
    }
    https.get(url, opts, function (res) {
      let buf = '';
      res.on('data', function (chunk) { buf += chunk; });
      res.on('end', function () {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('GitHub ' + res.statusCode));
          return;
        }
        try {
          resolve(JSON.parse(buf));
        } catch (error) {
          reject(new Error('GitHub cavabı oxunmadı.'));
        }
      });
    }).on('error', reject);
  });
}

function download(url, dest, token) {
  return new Promise(function (resolve, reject) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const opts = { headers: { 'User-Agent': 'pos-restoran' } };
    if (token) {
      opts.headers.Authorization = 'Bearer ' + token;
    }
    function go(href, hops) {
      if (hops > 5) {
        reject(new Error('Çox yönləndirmə.'));
        return;
      }
      https.get(href, opts, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          go(res.headers.location, hops + 1);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('Yükləmə ' + res.statusCode));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', function () {
          file.close(function () { resolve(dest); });
        });
        file.on('error', reject);
      }).on('error', reject);
    }
    go(url, 0);
  });
}

function runPs(args) {
  return new Promise(function (resolve, reject) {
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass'].concat(args), {
      windowsHide: true
    }, function (error, stdout, stderr) {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function check() {
  const cfg = settings.readSettings().update || {};
  const repo = String(cfg.repo || '').trim();
  const local = version();
  if (!repo || repo.indexOf('/') < 0) {
    return Promise.resolve({
      local: local,
      remote: '',
      newer: false,
        message: 'GitHub repo yazın (məs. ad/ARPOS-Restoran).'
    });
  }
  const url = 'https://api.github.com/repos/' + repo + '/releases/latest';
  return httpsJson(url, cfg.token).then(function (json) {
    const tag = json.tag_name || json.name || '';
    const zip = json.zipball_url || '';
    return {
      local: local,
      remote: stripV(tag),
      tag: tag,
      zip: zip,
      newer: newer(tag, local),
      name: json.name || tag
    };
  });
}

function apply() {
  return check().then(function (info) {
    if (!info.newer || !info.zip) {
      return { ok: false, message: info.message || 'Yeni versiya yoxdur.' };
    }
    const cfg = settings.readSettings().update || {};
    const zip = path.join(UPD_DIR, 'latest.zip');
    const extract = path.join(UPD_DIR, 'extract');
    fs.rmSync(extract, { recursive: true, force: true });
    fs.mkdirSync(extract, { recursive: true });
    return download(info.zip, zip, cfg.token).then(function () {
      return runPs([
        '-Command',
        "Expand-Archive -Force -Path '" + zip.replace(/'/g, "''") +
          "' -DestinationPath '" + extract.replace(/'/g, "''") + "'"
      ]);
    }).then(function () {
      const kids = fs.readdirSync(extract);
      const inner = kids.length === 1 ? path.join(extract, kids[0]) : extract;
      const skip = { data: true, node_modules: true, '.git': true, keys: true, dist: true };
      fs.readdirSync(inner).forEach(function (name) {
        if (skip[name]) {
          return;
        }
        const from = path.join(inner, name);
        const to = path.join(ROOT, name);
        fs.cpSync(from, to, { recursive: true, force: true });
      });
      const ver = require('./version');
      ver.record('update', 'GitHub ' + info.remote);
      return {
        ok: true,
        local: info.local,
        remote: info.remote,
        message: 'Yeniləndi ' + info.remote + '. Serveri yeniləyin.'
      };
    });
  });
}

module.exports = {
  version: version,
  check: check,
  apply: apply
};
