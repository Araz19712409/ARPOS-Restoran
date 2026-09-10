const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const db = require('./db');
const settings = require('./settings');

function dataRoot() {
  return db.dataDir();
}
const KEEP = 14;
const FILES = [
  'layout.json',
  'catalog.json',
  'orders.json',
  'users.json',
  'printers.json',
  'reservations.json',
  'settings.json',
  'tables.json',
  'terminals.json',
  'stock.json',
  'fiscal-queue.json',
  'gifts.json',
  'clock.json',
  'waitlist.json',
  'pin-lock.json',
  'sessions.json',
  'session.key',
  'versions.json'
];
const SQLITE_FILES = ['arpos.sqlite', 'arpos.sqlite-wal', 'arpos.sqlite-shm'];

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function stamp(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function backupDir() {
  const folder = settings.readSettings().backupFolder;
  return folder || path.join(dataRoot(), 'backups');
}

function ensureDir() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readMeta(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(backupDir(), folder, 'meta.json'), 'utf8'));
  } catch (error) {
    return { id: folder, at: '', reason: '' };
  }
}

function listBackups() {
  const root = ensureDir();
  return fs.readdirSync(root).filter(function (name) {
    return fs.statSync(path.join(root, name)).isDirectory();
  }).sort().reverse().map(function (id) {
    const meta = readMeta(id);
    return {
      id: id,
      at: meta.at || '',
      reason: meta.reason || ''
    };
  });
}

function copyJournal(fromRoot, toRoot) {
  const src = path.join(fromRoot, 'journal');
  if (!fs.existsSync(src)) {
    return;
  }
  const dest = path.join(toRoot, 'journal');
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src).forEach(function (name) {
    if (/\.(json|jsonl)$/.test(name)) {
      fs.copyFileSync(path.join(src, name), path.join(dest, name));
    }
  });
}

function copyArchive(fromRoot, toRoot) {
  const src = path.join(fromRoot, 'orders-archive');
  if (!fs.existsSync(src)) {
    return;
  }
  const dest = path.join(toRoot, 'orders-archive');
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src).forEach(function (name) {
    if (name.slice(-5) === '.json') {
      fs.copyFileSync(path.join(src, name), path.join(dest, name));
    }
  });
}

function clearArchive(dir) {
  const box = path.join(dir, 'orders-archive');
  if (!fs.existsSync(box)) {
    return;
  }
  fs.readdirSync(box).forEach(function (name) {
    fs.unlinkSync(path.join(box, name));
  });
  fs.rmdirSync(box);
}

function prune() {
  const list = listBackups();
  const root = backupDir();
  list.slice(KEEP).forEach(function (item) {
    const dir = path.join(root, item.id);
    FILES.concat(SQLITE_FILES).concat(['meta.json']).forEach(function (file) {
      const full = path.join(dir, file);
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
      }
    });
    clearArchive(dir);
    fs.rmdirSync(dir);
  });
}

function createBackup(reason) {
  const root = ensureDir();
  const id = stamp();
  const dest = path.join(root, id);
  fs.mkdirSync(dest);
  FILES.forEach(function (file) {
    const src = path.join(dataRoot(), file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dest, file));
    }
  });
  SQLITE_FILES.forEach(function (file) {
    const src = path.join(dataRoot(), file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dest, file));
    }
  });
  copyArchive(dataRoot(), dest);
  copyJournal(dataRoot(), dest);
  const row = {
    id: id,
    at: new Date().toISOString(),
    reason: String(reason || 'manual').slice(0, 40)
  };
  fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(row, null, 2), 'utf8');
  prune();
  pushGithub(dest, row).catch(function () { return null; });
  return row;
}

function pushGithub(dest, row) {
  const cfg = settings.readSettings().backupGithub || {};
  const repo = String(cfg.repo || '').trim();
  const token = String(cfg.token || '').trim();
  if (!repo || repo.indexOf('/') < 0 || !token) {
    return Promise.resolve({ skipped: true });
  }
  const zip = dest + '.zip';
  return new Promise(function (resolve, reject) {
    execFile('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      "Compress-Archive -Force -Path '" + dest.replace(/'/g, "''") + "\\*' -DestinationPath '" +
        zip.replace(/'/g, "''") + "'"
    ], { windowsHide: true }, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  }).then(function () {
    return githubJson('POST', '/repos/' + repo + '/releases', token, {
      tag_name: 'backup-' + row.id,
      name: 'Ehtiyat ' + row.id,
      body: String(row.reason || 'backup')
    });
  }).then(function (rel) {
    const upload = String(rel.upload_url || '').replace(/\{.*\}$/, '');
    if (!upload) {
      throw new Error('GitHub yükləmə ünvanı yoxdur.');
    }
    const body = fs.readFileSync(zip);
    return githubUpload(upload + '?name=' + encodeURIComponent(row.id + '.zip'), token, body);
  }).then(function () {
    try { fs.unlinkSync(zip); } catch (error) { /* keç */ }
    return { ok: true };
  });
}

function githubJson(method, apiPath, token, payload) {
  return new Promise(function (resolve, reject) {
    const https = require('https');
    const data = Buffer.from(JSON.stringify(payload || {}));
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: method,
      headers: {
        'User-Agent': 'ArposRestoran',
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, function (res) {
      let buf = '';
      res.on('data', function (chunk) { buf += chunk; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf || '{}')); } catch (error) { resolve({}); }
          return;
        }
        reject(new Error('GitHub ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function githubUpload(url, token, body) {
  return new Promise(function (resolve, reject) {
    const https = require('https');
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'ArposRestoran',
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/zip',
        'Content-Length': body.length
      }
    }, function (res) {
      res.resume();
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error('GitHub yükləmə ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function hasToday() {
  const day = stamp().slice(0, 10);
  return listBackups().some(function (item) { return item.id.slice(0, 10) === day; });
}

function ensureDaily() {
  if (!hasToday()) {
    return createBackup('daily');
  }
  return null;
}

function openFolder() {
  execFile('explorer.exe', [ensureDir()], function () {});
}

let picking = false;

function pickFolder() {
  return new Promise(function (resolve, reject) {
    if (picking) {
      reject(new Error('Seçim pəncərəsi artıq açıqdır.'));
      return;
    }
    picking = true;
    const work = path.join(os.tmpdir(), 'pos-folder-pick');
    fs.mkdirSync(work, { recursive: true });
    const outFile = path.join(work, 'result.txt');
    const ps1 = path.join(work, 'pick.ps1');
    const outEscaped = outFile.replace(/'/g, "''");
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '[void][System.Windows.Forms.Application]::EnableVisualStyles()',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "Ehtiyat yerini secin"',
      '$d.ShowNewFolderButton = $true',
      '$w = New-Object System.Windows.Forms.Form',
      '$w.TopMost = $true',
      '$r = $d.ShowDialog($w)',
      '$w.Dispose()',
      '$out = \'' + outEscaped + '\'',
      'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Set-Content -LiteralPath $out -Value $d.SelectedPath -Encoding UTF8 }',
      'else { Set-Content -LiteralPath $out -Value "" -Encoding UTF8 }'
    ].join('\r\n');
    fs.writeFileSync(ps1, script, 'utf8');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
      timeout: 180000,
      windowsHide: false
    }, function (error) {
      picking = false;
      if (error && error.killed) {
        reject(new Error('Seçim vaxtı bitdi.'));
        return;
      }
      try {
        const folder = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '').trim();
        resolve(folder || null);
      } catch (readError) {
        reject(new Error('Qovluq pəncərəsi açılmadı.'));
      }
    });
  });
}

function restoreBackup(id) {
  const safe = String(id || '').replace(/[^0-9-]/g, '');
  const src = path.join(backupDir(), safe);
  if (!safe || !fs.existsSync(src)) {
    return { error: 'Nüsxə tapılmadı.' };
  }
  createBackup('before-restore');
  try {
    require('./db').close();
  } catch (error) {
    /* keç */
  }
  const hasSql = fs.existsSync(path.join(src, 'arpos.sqlite'));
  if (hasSql) {
    SQLITE_FILES.forEach(function (file) {
      const from = path.join(src, file);
      const to = path.join(dataRoot(), file);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, to);
      } else if (fs.existsSync(to)) {
        try { fs.unlinkSync(to); } catch (error) { /* keç */ }
      }
    });
  } else {
    SQLITE_FILES.forEach(function (file) {
      const to = path.join(dataRoot(), file);
      if (fs.existsSync(to)) {
        try { fs.unlinkSync(to); } catch (error) { /* keç */ }
      }
    });
  }
  FILES.forEach(function (file) {
    const from = path.join(src, file);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(dataRoot(), file));
    }
  });
  copyArchive(src, dataRoot());
  copyJournal(src, dataRoot());
  return { ok: true, id: safe };
}

module.exports = {
  createBackup: createBackup,
  listBackups: listBackups,
  restoreBackup: restoreBackup,
  ensureDaily: ensureDaily,
  openFolder: openFolder,
  pickFolder: pickFolder
};
