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
    function headers() {
      const h = {
        'User-Agent': 'ArposRestoran',
        Accept: 'application/octet-stream'
      };
      if (token) {
        h.Authorization = 'Bearer ' + token;
      }
      return h;
    }
    function go(href, hops) {
      if (hops > 5) {
        reject(new Error('Çox yönləndirmə.'));
        return;
      }
      https.get(href, { headers: headers() }, function (res) {
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
    let setup = '';
    (json.assets || []).forEach(function (asset) {
      const n = String(asset.name || '').toLowerCase();
      if (n.indexOf('setup') >= 0 && n.slice(-4) === '.exe' && asset.browser_download_url) {
        setup = asset.browser_download_url;
      }
    });
    return {
      local: local,
      remote: stripV(tag),
      tag: tag,
      zip: zip,
      setup: setup,
      newer: newer(tag, local),
      name: json.name || tag
    };
  });
}

function apply() {
  return check().then(function (info) {
    if (!info.newer) {
      return { ok: false, message: info.message || 'Yeni versiya yoxdur.' };
    }
    const cfg = settings.readSettings().update || {};
    if (info.setup) {
      const exe = path.join(UPD_DIR, 'ArposRestoran-Setup.exe');
      return download(info.setup, exe, cfg.token).then(function () {
        const st = fs.statSync(exe);
        const fd = fs.openSync(exe, 'r');
        const head = Buffer.alloc(2);
        fs.readSync(fd, head, 0, 2, 0);
        fs.closeSync(fd);
        if (st.size < 1000000 || head[0] !== 0x4d || head[1] !== 0x5a) {
          throw new Error('GitHub-dan Setup düzgün endirilmədi.');
        }
        try {
          fs.unlinkSync(exe + ':Zone.Identifier');
        } catch (error) {
          /* Windows blokunu açmaq mümkün olmasa da davam */
        }
        fs.writeFileSync(path.join(UPD_DIR, 'install-dir.txt'), ROOT, 'utf8');
        const cmd = 'start "" "' + exe.replace(/"/g, '') + '" /update "' + ROOT.replace(/"/g, '') + '"';
        execFile('cmd.exe', ['/c', cmd], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }).unref();
        const ver = require('./version');
        ver.record('update', 'GitHub Setup ' + info.remote);
        return {
          ok: true,
          local: info.local,
          remote: info.remote,
          message: 'Yeniləmə başladı. Proqram bağlanacaq və yenidən açılacaq.'
        };
      });
    }
    if (!info.zip) {
      return { ok: false, message: 'Release-də Setup.exe yoxdur.' };
    }
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
      if (!fs.existsSync(path.join(ROOT, 'keys', 'arpos-private.pem'))) {
        ['make-license.js', 'license-owner.js'].forEach(function (name) {
          try { fs.unlinkSync(path.join(ROOT, 'scripts', name)); } catch (error) { /* keç */ }
        });
      }
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
