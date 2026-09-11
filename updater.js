const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
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

function httpsText(url, token) {
  return new Promise(function (resolve, reject) {
    const opts = {
      headers: {
        'User-Agent': 'ArposRestoran',
        Accept: 'application/octet-stream'
      }
    };
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
        let buf = '';
        res.on('data', function (chunk) { buf += chunk; });
        res.on('end', function () {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error('GitHub ' + res.statusCode));
            return;
          }
          resolve(buf);
        });
      }).on('error', reject);
    }
    go(url, 0);
  });
}

function parseChecksums(text) {
  const map = {};
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const t = line.trim();
    if (!t || t.charAt(0) === '#') {
      return;
    }
    let m = t.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (m) {
      map[path.basename(m[2].trim().replace(/\\/g, '/'))] = m[1].toLowerCase();
      return;
    }
    m = t.match(/^SHA256\s+(\S+)\s+([a-fA-F0-9]{64})$/i);
    if (m) {
      map[path.basename(m[1])] = m[2].toLowerCase();
    }
  });
  return map;
}

function expectedHashFor(fileName, map) {
  const name = path.basename(String(fileName || ''));
  if (!name || !map) {
    return '';
  }
  if (map[name]) {
    return map[name];
  }
  const lower = name.toLowerCase();
  const keys = Object.keys(map);
  var i;
  for (i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === lower) {
      return map[keys[i]];
    }
  }
  return '';
}

function hashMatches(got, expected) {
  const a = String(got || '').trim().toLowerCase();
  const b = String(expected || '').trim().toLowerCase();
  return a.length === 64 && b.length === 64 && a === b;
}

function fileSha256(file) {
  return new Promise(function (resolve, reject) {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', function (chunk) { h.update(chunk); });
    s.on('end', function () { resolve(h.digest('hex')); });
  });
}

function pickAssets(json) {
  let setup = '';
  let setupName = '';
  let sumsUrl = '';
  (json.assets || []).forEach(function (asset) {
    const n = String(asset.name || '').toLowerCase();
    const href = asset.browser_download_url || '';
    if (!href) {
      return;
    }
    if (n.indexOf('setup') >= 0 && n.slice(-4) === '.exe') {
      setup = href;
      setupName = asset.name;
    }
    if (n === 'sha256sums.txt' || n.slice(-7) === '.sha256') {
      sumsUrl = href;
    }
  });
  return { setup: setup, setupName: setupName, sumsUrl: sumsUrl };
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    /* keç */
  }
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
    const picked = pickAssets(json);
    const checksums = parseChecksums(json.body);
    const setupName = picked.setupName || 'ArposRestoran-Setup.exe';
    const checksum = expectedHashFor(setupName, checksums);
    return {
      local: local,
      remote: stripV(tag),
      tag: tag,
      setup: picked.setup,
      setupName: setupName,
      sumsUrl: picked.sumsUrl,
      checksums: checksums,
      checksum: checksum,
      newer: newer(tag, local),
      name: json.name || tag
    };
  });
}

function loadExpectedHash(info, token) {
  const name = info.setupName || 'ArposRestoran-Setup.exe';
  const have = expectedHashFor(name, info.checksums || {});
  if (have) {
    return Promise.resolve(have);
  }
  if (!info.sumsUrl) {
    return Promise.resolve('');
  }
  return httpsText(info.sumsUrl, token).then(function (text) {
    return expectedHashFor(name, parseChecksums(text));
  });
}

function isConfirmed(opts) {
  return !!(opts && (opts.confirm === true || opts.confirm === 1 || opts.confirm === 'true'));
}

function apply(opts) {
  // TODO: Authenticode (code signing) bu versiyada yoxdur — checksum kifayətdir.
  if (!isConfirmed(opts)) {
    return Promise.resolve({
      ok: false,
      message: 'Yeniləmə üçün təsdiq lazımdır.'
    });
  }
  return check().then(function (info) {
    if (!info.newer) {
      return { ok: false, message: info.message || 'Yeni versiya yoxdur.' };
    }
    if (!info.setup) {
      return { ok: false, message: 'Release-də Setup.exe yoxdur. Zip avtomatik yazılmır.' };
    }
    const cfg = settings.readSettings().update || {};
    const token = cfg.token;
    return loadExpectedHash(info, token).then(function (expected) {
      if (!expected) {
        return {
          ok: false,
          message: 'Checksum yoxdur. SHA256SUMS.txt və ya reliz mətnində SHA256 yazın.'
        };
      }
      fs.mkdirSync(UPD_DIR, { recursive: true });
      const exe = path.join(UPD_DIR, 'ArposRestoran-Setup.exe');
      return download(info.setup, exe, token).then(function () {
        return fileSha256(exe).then(function (got) {
          if (!hashMatches(got, expected)) {
            safeUnlink(exe);
            throw new Error('Checksum uyğun gəlmir. Quraşdırma ləğv olundu.');
          }
          const st = fs.statSync(exe);
          const fd = fs.openSync(exe, 'r');
          const head = Buffer.alloc(2);
          fs.readSync(fd, head, 0, 2, 0);
          fs.closeSync(fd);
          if (st.size < 1000000 || head[0] !== 0x4d || head[1] !== 0x5a) {
            safeUnlink(exe);
            throw new Error('GitHub-dan Setup düzgün endirilmədi.');
          }
          try {
            fs.unlinkSync(exe + ':Zone.Identifier');
          } catch (error) {
            /* Windows blokunu açmaq mümkün olmasa da davam */
          }
          fs.writeFileSync(path.join(UPD_DIR, 'install-dir.txt'), ROOT, 'utf8');
          const bat = path.join(UPD_DIR, 'start-update.cmd');
          fs.writeFileSync(bat,
            '@echo off\r\n' +
            'timeout /t 1 /nobreak >nul\r\n' +
            'start "" "' + exe.replace(/"/g, '') + '"\r\n');
          execFile('cmd.exe', ['/c', 'start', '', bat], {
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
            setupPath: exe,
            message: 'Yeniləmə pəncərəsi açılır. «Bəli» / «Yenilə» basın. Açılmasa: ' + exe
          };
        });
      });
    });
  });
}

module.exports = {
  version: version,
  check: check,
  apply: apply,
  isConfirmed: isConfirmed,
  parseChecksums: parseChecksums,
  expectedHashFor: expectedHashFor,
  hashMatches: hashMatches
};

