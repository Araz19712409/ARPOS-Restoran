const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const logger = require('./logger');
const store = require('./store');
const db = require('./db');

function printersFile() {
  return db.dataFile('printers.json');
}

function queueFile() {
  return db.dataFile('print-queue.json');
}

function isWin32() {
  return process.platform === 'win32';
}

function printerPath(printer) {
  if (printer && printer.connectionType === 'windows') {
    return 'win:' + String(printer.windowsName || '');
  }
  return String((printer && printer.host) || '') + ':' + String((printer && printer.port) || '');
}

// Azərbaycan hərflərini termal printer üçün oxunaqlı edirik
function toPrinterText(value) {
  return String(value || '')
    .replace(/ə/g, 'e').replace(/Ə/g, 'E')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C');
}

// IP və ya host adını yoxlayırıq
function isHost(value) {
  const host = String(value || '').trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host.split('.').every(function (part) {
      const n = Number(part);
      return n >= 0 && n <= 255;
    });
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,250}$/.test(host);
}

function cleanWindowsName(value) {
  return String(value || '')
    .replace(/[\r\n\0]/g, '')
    .trim()
    .slice(0, 120);
}

function migratePrinterRow(row) {
  const item = row && typeof row === 'object' ? Object.assign({}, row) : {};
  if (item.connectionType !== 'windows') {
    item.connectionType = 'tcp';
  }
  item.windowsName = cleanWindowsName(item.windowsName);
  if (item.connectionType === 'windows') {
    item.host = '';
    item.port = 0;
  } else {
    item.port = Number(item.port) || 9100;
  }
  return item;
}

// Printer anbarını oxuyuruq
function readStore() {
  const raw = store.readJson(printersFile());
  return {
    nextPrinterId: Number(raw.nextPrinterId) || 1,
    printers: (Array.isArray(raw.printers) ? raw.printers : []).map(migratePrinterRow)
  };
}

// Printer anbarını yazırıq
function writeStore(data) {
  store.writeJson(printersFile(), data);
}

// Printer məlumatını təmizləyirik
function normalizePrinter(body, current) {
  const src = current || {};
  const name = String(body.name || src.name || '').trim().slice(0, 40);
  const connectionType = (body.connectionType || src.connectionType) === 'windows' ? 'windows' : 'tcp';
  let host = String(body.host != null ? body.host : (src.host || '')).trim();
  let port = Number(body.port != null ? body.port : (src.port != null ? src.port : 9100));
  let windowsName = cleanWindowsName(body.windowsName != null ? body.windowsName : src.windowsName);
  const paperWidth = Number(body.paperWidth != null ? body.paperWidth : src.paperWidth || 80);
  const copies = Number(body.copies != null ? body.copies : src.copies || 1);
  const defaultChars = paperWidth === 58 ? 32 : 48;
  let charsPerLine = Number(body.charsPerLine != null ? body.charsPerLine : src.charsPerLine || defaultChars);
  let leftMargin = Number(body.leftMargin != null ? body.leftMargin : src.leftMargin || 0);
  const font = (body.font || src.font) === 'B' ? 'B' : 'A';
  const bigTitle = body.bigTitle != null ? Boolean(body.bigTitle) : Boolean(src.bigTitle);
  const role = (body.role || src.role) === 'receipt' ? 'receipt' : 'station';
  let stationId = body.stationId != null ? Number(body.stationId) : Number(src.stationId || 0);
  const enabled = body.enabled != null ? Boolean(body.enabled) : (src.enabled !== false);
  const isBackup = body.isBackup != null ? Boolean(body.isBackup) : Boolean(src.isBackup);

  if (!name) {
    return { error: 'Printer adı vacibdir.' };
  }
  if (connectionType === 'windows') {
    if (!windowsName) {
      return { error: 'Windows printer adı vacibdir.' };
    }
    host = '';
    port = 0;
  } else {
    windowsName = '';
    if (!isHost(host)) {
      return { error: 'IP ünvan və ya host düzgün deyil.' };
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: 'Port 1-65535 arasında olmalıdır.' };
    }
  }
  if (paperWidth !== 58 && paperWidth !== 80) {
    return { error: 'Kağız eni 58 və ya 80 mm olmalıdır.' };
  }
  if (!Number.isInteger(copies) || copies < 1 || copies > 3) {
    return { error: 'Nüsxə sayı 1-3 ola bilər.' };
  }
  if ([32, 42, 48, 64].indexOf(charsPerLine) === -1) {
    charsPerLine = defaultChars;
  }
  if (!Number.isInteger(leftMargin) || leftMargin < 0 || leftMargin > 8) {
    return { error: 'Sol boşluq 0-8 ola bilər.' };
  }
  if (role === 'station' && !stationId) {
    return { error: 'Stansiya seçin: mətbəx, manqal, bar.' };
  }
  if (role === 'receipt') {
    stationId = 0;
  }

  return {
    printer: {
      id: src.id || 0,
      name: name,
      connectionType: connectionType,
      host: host,
      port: port,
      windowsName: windowsName,
      paperWidth: paperWidth,
      copies: copies,
      charsPerLine: charsPerLine,
      leftMargin: leftMargin,
      font: font,
      bigTitle: bigTitle,
      role: role,
      stationId: stationId || 0,
      enabled: enabled,
      isBackup: isBackup,
      lastCheck: src.lastCheck || null
    }
  };
}

// Printerə TCP ilə qoşuluruq
function connectPrinter(host, port, timeoutMs) {
  return new Promise(function (resolve) {
    const started = Date.now();
    const socket = new net.Socket();
    let finished = false;

    function done(ok, message) {
      if (finished) {
        return;
      }
      finished = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        ok: ok,
        message: message,
        ms: Date.now() - started,
        at: new Date().toISOString()
      });
    }

    socket.setTimeout(timeoutMs || 4000);
    socket.connect(port, host, function () {
      done(true, 'Qoşuldu');
    });
    socket.on('timeout', function () {
      done(false, 'Vaxt bitdi. IP, port və şəbəkəni yoxlayın.');
    });
    socket.on('error', function (error) {
      const code = error && error.code ? String(error.code) : '';
      if (code === 'ECONNREFUSED') {
        done(false, 'Printer rədd etdi. Port 9100 açıqdır?');
        return;
      }
      if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        done(false, 'Ünvan əlçatan deyil.');
        return;
      }
      if (code === 'ENOTFOUND') {
        done(false, 'IP və ya host tapılmadı.');
        return;
      }
      done(false, error.message || 'Qoşulmadı');
    });
  });
}

function runPowerShell(script, timeoutMs) {
  return new Promise(function (resolve) {
    if (!isWin32()) {
      resolve({ ok: false, code: 1, stdout: '', stderr: 'not-windows' });
      return;
    }
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(function () {
      if (finished) {
        return;
      }
      finished = true;
      try {
        child.kill();
      } catch (error) {
        /* keç */
      }
      resolve({ ok: false, code: 1, stdout: stdout, stderr: 'timeout' });
    }, timeoutMs || 15000);
    child.stdout.on('data', function (chunk) {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', function (chunk) {
      stderr += String(chunk || '');
    });
    child.on('error', function (error) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, code: 1, stdout: stdout, stderr: error.message || 'spawn' });
    });
    child.on('close', function (code) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code || 0, stdout: stdout, stderr: stderr });
    });
  });
}

function listWindowsPrinters() {
  if (!isWin32()) {
    return Promise.resolve({
      ok: false,
      platform: process.platform,
      names: [],
      message: 'Windows printer siyahısı yalnız Windows kassada.'
    });
  }
  if (process.env.ARPOS_MOCK_WINDOWS_PRINT === '1') {
    return Promise.resolve({
      ok: true,
      platform: 'win32',
      names: ['Mock USB Printer', 'Mock Receipt'],
      message: ''
    });
  }
  const script = "$ErrorActionPreference='Stop'; " +
    "Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object { $_ }";
  return runPowerShell(script, 12000).then(function (out) {
    if (!out.ok) {
      return {
        ok: false,
        platform: 'win32',
        names: [],
        message: (out.stderr || out.stdout || 'Siyahı alınmadı.').trim().slice(0, 200)
      };
    }
    const names = String(out.stdout || '')
      .split(/\r?\n/)
      .map(function (row) { return cleanWindowsName(row); })
      .filter(Boolean);
    const uniq = [];
    names.forEach(function (name) {
      if (uniq.indexOf(name) < 0) {
        uniq.push(name);
      }
    });
    return { ok: true, platform: 'win32', names: uniq, message: '' };
  });
}

function probeWindowsPrinter(windowsName) {
  const name = cleanWindowsName(windowsName);
  const started = Date.now();
  function pack(ok, message) {
    return {
      ok: ok,
      message: message,
      ms: Date.now() - started,
      at: new Date().toISOString()
    };
  }
  if (!name) {
    return Promise.resolve(pack(false, 'Windows printer adı boşdur.'));
  }
  if (!isWin32()) {
    return Promise.resolve(pack(false, 'Windows printer yalnız Windows kassada işləyir.'));
  }
  if (process.env.ARPOS_MOCK_WINDOWS_PRINT === '1') {
    return Promise.resolve(pack(true, 'Mock: printer tapıldı'));
  }
  const safe = name.replace(/'/g, "''");
  const script = "$ErrorActionPreference='Stop'; " +
    "$n='" + safe + "'; " +
    "$p=Get-Printer -Name $n -ErrorAction SilentlyContinue; " +
    "if(-not $p){ Write-Error 'Printer tapilmadi'; exit 1 }; " +
    "Write-Output 'OK'";
  return runPowerShell(script, 10000).then(function (out) {
    if (!out.ok) {
      return pack(false, (out.stderr || 'Printer tapılmadı.').trim().slice(0, 180));
    }
    return pack(true, 'Windows printer tapıldı');
  });
}

function sendWindowsRaw(windowsName, payload, timeoutMs) {
  const name = cleanWindowsName(windowsName);
  const started = Date.now();
  function pack(ok, message) {
    return {
      ok: ok,
      message: message,
      ms: Date.now() - started,
      at: new Date().toISOString()
    };
  }
  if (!name) {
    return Promise.resolve(pack(false, 'Windows printer adı boşdur.'));
  }
  if (!isWin32()) {
    return Promise.resolve(pack(false, 'Windows printer yalnız Windows kassada işləyir.'));
  }
  if (process.env.ARPOS_MOCK_WINDOWS_PRINT === '1') {
    return Promise.resolve(pack(true, 'Mock Windows çap göndərildi'));
  }
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const binPath = path.join(os.tmpdir(), 'arpos-raw-' + stamp + '.bin');
  const psPath = path.join(os.tmpdir(), 'arpos-raw-' + stamp + '.ps1');
  try {
    fs.writeFileSync(binPath, buf);
    const ps = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -TypeDefinition @'",
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class ArposRawPrint {',
      '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]',
      '  public class DOCINFOA {',
      '    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;',
      '    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;',
      '    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;',
      '  }',
      '  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);',
      '  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern bool ClosePrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);',
      '  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern bool EndDocPrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern bool StartPagePrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern bool EndPagePrinter(IntPtr hPrinter);',
      '  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]',
      '  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);',
      '  public static void Send(string printer, string file) {',
      '    IntPtr hPrinter;',
      '    if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero)) throw new Exception("OpenPrinter");',
      '    try {',
      '      DOCINFOA di = new DOCINFOA();',
      '      di.pDocName = "Arpos ESC/POS";',
      '      di.pDataType = "RAW";',
      '      if (StartDocPrinter(hPrinter, 1, di) == 0) throw new Exception("StartDocPrinter");',
      '      try {',
      '        if (!StartPagePrinter(hPrinter)) throw new Exception("StartPagePrinter");',
      '        try {',
      '          byte[] bytes = System.IO.File.ReadAllBytes(file);',
      '          IntPtr p = Marshal.AllocHGlobal(bytes.Length);',
      '          try {',
      '            Marshal.Copy(bytes, 0, p, bytes.Length);',
      '            int written;',
      '            if (!WritePrinter(hPrinter, p, bytes.Length, out written)) throw new Exception("WritePrinter");',
      '          } finally { Marshal.FreeHGlobal(p); }',
      '        } finally { EndPagePrinter(hPrinter); }',
      '      } finally { EndDocPrinter(hPrinter); }',
      '    } finally { ClosePrinter(hPrinter); }',
      '  }',
      '}',
      "'@",
      "$printer = '" + name.replace(/'/g, "''") + "'",
      "$file = '" + binPath.replace(/'/g, "''") + "'",
      '[ArposRawPrint]::Send($printer, $file)',
      "Write-Output 'OK'"
    ].join('\r\n');
    fs.writeFileSync(psPath, ps, 'utf8');
  } catch (error) {
    return Promise.resolve(pack(false, 'Temp fayl yazılmadı.'));
  }
  return new Promise(function (resolve) {
    if (!isWin32()) {
      resolve(pack(false, 'Windows printer yalnız Windows kassada işləyir.'));
      return;
    }
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', psPath
    ], { windowsHide: true });
    let stderr = '';
    let finished = false;
    const timer = setTimeout(function () {
      if (finished) {
        return;
      }
      finished = true;
      try {
        child.kill();
      } catch (error) {
        /* keç */
      }
      cleanup();
      resolve(pack(false, 'Windows çap vaxtı bitdi.'));
    }, timeoutMs || 20000);
    function cleanup() {
      try {
        fs.unlinkSync(binPath);
      } catch (error) {
        /* keç */
      }
      try {
        fs.unlinkSync(psPath);
      } catch (error) {
        /* keç */
      }
    }
    child.stderr.on('data', function (chunk) {
      stderr += String(chunk || '');
    });
    child.on('error', function (error) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolve(pack(false, error.message || 'PowerShell açılmadı'));
    });
    child.on('close', function (code) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        resolve(pack(false, (stderr || 'Windows çap getmədi.').trim().slice(0, 180)));
        return;
      }
      resolve(pack(true, 'Windows çap göndərildi'));
    });
  });
}

function deliverBytes(printer, payload, timeoutMs) {
  if (printer && printer.connectionType === 'windows') {
    return sendWindowsRaw(printer.windowsName, payload, timeoutMs || 8000);
  }
  return sendBytes(printer.host, printer.port, payload, timeoutMs || 5000);
}

function probePrinter(printer) {
  if (printer && printer.connectionType === 'windows') {
    return probeWindowsPrinter(printer.windowsName);
  }
  return connectPrinter(printer.host, printer.port, 4000);
}

// Sətirdə mətni kəsirik və ya doldururuq
function line(width, left, right) {
  const a = toPrinterText(left || '');
  const b = toPrinterText(right || '');
  const space = Math.max(1, width - a.length - b.length);
  return a + new Array(space + 1).join(' ') + b;
}

function dash(width) {
  return new Array(width + 1).join('-');
}

function eq(width) {
  return new Array(width + 1).join('=');
}

function ticketWidth(printer) {
  const n = Number(printer && printer.charsPerLine);
  if (n === 32 || n === 42 || n === 48 || n === 64) {
    return n;
  }
  return Number(printer && printer.paperWidth) === 58 ? 32 : 48;
}

function ticketMargin(printer) {
  const n = Number(printer && printer.leftMargin);
  if (!Number.isInteger(n) || n < 0) {
    return 0;
  }
  return Math.min(8, n);
}

function contentWidth(printer) {
  return Math.max(16, ticketWidth(printer) - ticketMargin(printer));
}

function padLines(printer, lines) {
  const pad = new Array(ticketMargin(printer) + 1).join(' ');
  if (!pad) {
    return lines;
  }
  return lines.map(function (row) {
    return pad + row;
  });
}

function ticketBytes(printer, title, lines) {
  const chunks = [
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x00]),
    Buffer.from([0x1d, 0x21, 0x00]),
    Buffer.from([0x1b, 0x4d, printer && printer.font === 'B' ? 1 : 0])
  ];
  if (printer && printer.bigTitle) {
    chunks.push(Buffer.from([0x1b, 0x61, 0x01]));
    chunks.push(Buffer.from([0x1d, 0x21, 0x11]));
    chunks.push(Buffer.from(toPrinterText(title || '') + '\n', 'ascii'));
    chunks.push(Buffer.from([0x1d, 0x21, 0x00]));
    chunks.push(Buffer.from([0x1b, 0x61, 0x00]));
  }
  chunks.push(Buffer.from(padLines(printer, lines).join('\n') + '\n\n\n', 'ascii'));
  if (printer && printer.openDrawer) {
    chunks.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  }
  chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x10]));
  return Buffer.concat(chunks);
}

// Test çekinin ESC/POS baytlarını hazırlayırıq
function buildTestTicket(printer, stationName) {
  const width = contentWidth(printer);
  const when = new Date();
  const dateText =
    String(when.getDate()).padStart(2, '0') + '.' +
    String(when.getMonth() + 1).padStart(2, '0') + '.' +
    when.getFullYear() + ' ' +
    String(when.getHours()).padStart(2, '0') + ':' +
    String(when.getMinutes()).padStart(2, '0');
  const roleText = printer.role === 'receipt' ? 'Kassa ceki' : toPrinterText(stationName || 'Stansiya');
  const lines = [
    eq(width),
    toPrinterText('ARPOS RESTORAN'),
    toPrinterText('TEST CAPI'),
    eq(width),
    line(width, 'Printer', printer.name),
    line(width, 'Yol', printerPath(printer)),
    line(width, 'Tip', printer.connectionType === 'windows' ? 'Windows' : 'TCP'),
    line(width, 'Rol', roleText),
    line(width, 'Kagiz', printer.paperWidth + ' mm'),
    line(width, 'Setir', String(ticketWidth(printer))),
    line(width, 'Tarix', dateText),
    dash(width),
    toPrinterText('1x  Test yemek'),
    toPrinterText('    Qeyd: printer islekdir'),
    dash(width),
    toPrinterText('*** TEST UGURLUDUR ***'),
    eq(width),
    '',
    ''
  ];

  return ticketBytes(printer, 'TEST CAPI', lines);
}

// Test çekini printerə göndəririk
function sendBytes(host, port, payload, timeoutMs) {
  return new Promise(function (resolve) {
    const started = Date.now();
    const socket = new net.Socket();
    let finished = false;

    function done(ok, message) {
      if (finished) {
        return;
      }
      finished = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        ok: ok,
        message: message,
        ms: Date.now() - started,
        at: new Date().toISOString()
      });
    }

    socket.setTimeout(timeoutMs || 5000);
    socket.connect(port, host, function () {
      socket.write(payload, function (error) {
        if (error) {
          done(false, error.message);
          return;
        }
        setTimeout(function () {
          done(true, 'Test çapı göndərildi');
        }, 250);
      });
    });
    socket.on('timeout', function () {
      done(false, 'Çap vaxtı bitdi.');
    });
    socket.on('error', function (error) {
      done(false, error.message || 'Çap getmədi');
    });
  });
}

// Qoşulmanı yoxlayırıq və nəticəni saxlayırıq
async function testConnection(id) {
  const store = readStore();
  const printer = store.printers.find(function (item) { return item.id === id; });
  if (!printer) {
    return { error: 'Printer tapılmadı.' };
  }
  const result = await probePrinter(printer);
  printer.lastCheck = result;
  writeStore(store);
  if (!result.ok) {
    logger.error({
      path: printerPath(printer),
      message: 'Printer qoşulmadı: ' + printer.name + ' — ' + result.message
    });
  }
  return { data: { printer: printer, result: result } };
}

// Test çekini çap edirik
async function testPrint(id, stationName) {
  const store = readStore();
  const printer = store.printers.find(function (item) { return item.id === id; });
  if (!printer) {
    return { error: 'Printer tapılmadı.' };
  }
  if (!printer.enabled) {
    return { error: 'Printer söndürülüb.' };
  }
  const ticket = buildTestTicket(printer, stationName);
  let last = null;
  for (let i = 0; i < printer.copies; i += 1) {
    last = await deliverBytes(printer, ticket, 8000);
    if (!last.ok) {
      printer.lastCheck = last;
      writeStore(store);
      logger.error({
        path: printerPath(printer),
        message: 'Printer çapı uğursuz: ' + printer.name + ' — ' + last.message
      });
      return { data: { printer: printer, result: last } };
    }
  }
  printer.lastCheck = last;
  writeStore(store);
  return { data: { printer: printer, result: last } };
}

// Sifariş çekini hazırlayırıq
function buildOrderTicket(printer, payload) {
  const width = contentWidth(printer);
  const when = new Date();
  const dateText =
    String(when.getDate()).padStart(2, '0') + '.' +
    String(when.getMonth() + 1).padStart(2, '0') + '.' +
    when.getFullYear() + ' ' +
    String(when.getHours()).padStart(2, '0') + ':' +
    String(when.getMinutes()).padStart(2, '0');
  const lines = [
    eq(width),
    toPrinterText(payload.stationName || 'Stansiya'),
    eq(width),
    line(width, 'Masa', payload.tableName || '-'),
    line(width, 'Ofisiant', payload.waiterName || '-'),
    line(width, 'Vaxt', dateText),
    dash(width)
  ];
  if (payload.title) {
    lines.splice(1, 0, toPrinterText(payload.title));
  }
  (payload.items || []).forEach(function (item) {
    lines.push(toPrinterText(item.qty + 'x  ' + item.name));
    const marks = (item.modifiers || []).map(function (row) { return row.name; });
    if (item.note) {
      marks.push(item.note);
    }
    if (marks.length) {
      lines.push(toPrinterText('    ' + marks.join(', ')));
    }
  });
  lines.push(dash(width));
  lines.push(toPrinterText('Sifaris qebul olundu'));
  lines.push(eq(width));
  lines.push('');
  lines.push('');

  return ticketBytes(printer, payload.stationName || 'SIFARIS', lines);
}

const QUEUE_MAX_TRIES = 8;
const QUEUE_WAIT_MS = 15 * 1000;
let queueBusy = false;

function readQueue() {
  try {
    const raw = store.readJson(queueFile());
    return {
      nextId: Number(raw.nextId) || 1,
      jobs: Array.isArray(raw.jobs) ? raw.jobs : []
    };
  } catch (error) {
    return { nextId: 1, jobs: [] };
  }
}

function writeQueue(data) {
  const wait = data.jobs.filter(function (job) { return job.status !== 'fail'; });
  const fail = data.jobs.filter(function (job) { return job.status === 'fail'; }).slice(-20);
  data.jobs = wait.concat(fail);
  store.writeJson(queueFile(), data);
}

function publicJob(job) {
  const payload = job.payload || {};
  const order = job.order || {};
  let title = payload.stationName || '';
  if (!title) {
    if (job.kind === 'receipt') {
      title = 'Kassa çeki';
    } else if (job.kind === 'z') {
      title = 'Z hesabat';
    } else {
      title = 'Stansiya';
    }
  }
  return {
    id: job.id,
    kind: job.kind,
    title: title,
    tableName: payload.tableName || order.tableName || (job.kind === 'z' ? (payload.terminalName || '') : ''),
    tries: Number(job.tries) || 0,
    maxTries: QUEUE_MAX_TRIES,
    status: job.status || 'wait',
    lastError: job.lastError || '',
    nextAt: job.nextAt || 0,
    createdAt: job.createdAt || ''
  };
}

function enqueue(job) {
  const q = readQueue();
  q.jobs.push({
    id: q.nextId,
    kind: job.kind,
    stationId: job.stationId || 0,
    payload: job.payload || null,
    order: job.order || null,
    tries: 0,
    status: 'wait',
    lastError: job.lastError || '',
    nextAt: Date.now(),
    createdAt: new Date().toISOString()
  });
  q.nextId += 1;
  writeQueue(q);
}

function listQueue() {
  return readQueue().jobs.map(publicJob);
}

async function sendToPrinter(printer, ticket, label, copiesOverride) {
  const results = [];
  let ok = true;
  let copies = Number(printer.copies) || 1;
  if (copiesOverride != null) {
    copies = Number(copiesOverride) || 1;
  }
  if (copies < 1) {
    copies = 1;
  }
  for (let copy = 0; copy < copies; copy += 1) {
    const result = await deliverBytes(printer, ticket, 8000);
    results.push({
      printerId: printer.id,
      name: printer.name,
      ok: result.ok,
      message: result.message
    });
    if (!result.ok) {
      ok = false;
      logger.error({
        path: printerPath(printer),
        message: label + ' uğursuz: ' + printer.name + ' — ' + result.message
      });
      break;
    }
  }
  return { ok: ok, results: results };
}

async function tryPrinters(list, buildTicket, label, copiesOverride) {
  const results = [];
  let anyOk = false;
  let lastError = '';
  for (let i = 0; i < list.length; i += 1) {
    const sent = await sendToPrinter(list[i], buildTicket(list[i]), label, copiesOverride);
    results.push.apply(results, sent.results);
    if (sent.ok) {
      anyOk = true;
    } else if (sent.results[0]) {
      lastError = sent.results[0].message;
    }
  }
  return { anyOk: anyOk, results: results, lastError: lastError };
}

async function deliverStation(stationId, payload) {
  const store = readStore();
  const list = store.printers.filter(function (item) {
    return item.enabled && item.role === 'station' && item.stationId === stationId;
  });
  if (!list.length) {
    logger.warn({
      path: 'station/' + stationId,
      message: 'Stansiya printeri yoxdur: ' + (payload.stationName || stationId)
    });
    return { anyOk: false, results: [], warning: 'Printer yoxdur: ' + (payload.stationName || 'stansiya') };
  }
  const mains = list.filter(function (item) { return !item.isBackup; });
  const backs = list.filter(function (item) { return item.isBackup; });
  const first = mains.length ? mains : backs;
  let out = await tryPrinters(first, function (printer) {
    return buildOrderTicket(printer, payload);
  }, 'Sifariş çapı');
  if (!out.anyOk && mains.length && backs.length) {
    const second = await tryPrinters(backs, function (printer) {
      return buildOrderTicket(printer, payload);
    }, 'Sifariş çapı');
    out.results = out.results.concat(second.results);
    out.anyOk = second.anyOk;
    out.lastError = second.lastError || out.lastError;
  }
  return out;
}

async function deliverReceipt(order) {
  const store = readStore();
  const list = store.printers.filter(function (item) {
    return item.enabled && item.role === 'receipt';
  });
  if (!list.length) {
    return { anyOk: false, results: [], warning: 'Kassa printeri yoxdur. Brauzerdən çap edin.', copies: 1 };
  }
  let copies = 1;
  try {
    copies = require('./settings').receiptPrintCopies();
  } catch (error) {
    copies = 1;
  }
  const out = await tryPrinters(list, function (printer) {
    const cash = Number((order.payment && order.payment.cashAmount) || 0);
    return buildReceiptTicket(Object.assign({}, printer, { openDrawer: cash > 0 }), order);
  }, 'Çek çapı', copies);
  out.copies = copies;
  return out;
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }
  return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}

function appendReceiptBrand(lines, packed) {
  // TODO(Faza 1b+): receipt.logo ESC/POS 1-bit raster — indi yalnız mətn brendi.
  let cfg = {};
  try {
    cfg = require('./settings').readSettings();
  } catch (error) {
    cfg = {};
  }
  const receipt = (packed && packed.receipt) || cfg.receipt || {};
  let title = '';
  try {
    title = require('./settings').receiptTitle({
      branchName: (packed && packed.branchName) || cfg.branchName || '',
      receipt: receipt
    });
  } catch (error) {
    title = (packed && packed.branchName) || 'Arpos Restoran';
  }
  lines.push(toPrinterText(title));
  if (receipt.address) {
    lines.push(toPrinterText(receipt.address));
  }
  if (receipt.phone) {
    lines.push(toPrinterText(receipt.phone));
  }
  if (receipt.showBranchCode) {
    const code = String(cfg.branchCode || (packed && packed.branchCode) || '').trim();
    if (code) {
      lines.push(toPrinterText('Filial: ' + code));
    }
  }
  (Array.isArray(receipt.headerLines) ? receipt.headerLines : []).forEach(function (row) {
    if (row) {
      lines.push(toPrinterText(row));
    }
  });
}

function appendReceiptFooter(lines, packed) {
  let cfg = {};
  try {
    cfg = require('./settings').readSettings();
  } catch (error) {
    cfg = {};
  }
  const receipt = (packed && packed.receipt) || cfg.receipt || {};
  const footers = Array.isArray(receipt.footerLines) ? receipt.footerLines.filter(Boolean) : [];
  if (footers.length) {
    footers.forEach(function (row) {
      lines.push(toPrinterText(row));
    });
  }
}

function buildZTicket(printer, packed) {
  const width = contentWidth(printer);
  const row = packed.shift || {};
  const tot = packed.totals || {};
  const lines = [];
  appendReceiptBrand(lines, packed);
  lines.push(toPrinterText((packed.terminalName || '') + '  Z-hesabat'));
  lines.push(dash(width));
  lines.push(toPrinterText('Acildi  ' + formatWhen(row.openedAt)));
  lines.push(toPrinterText('Baglandi  ' + formatWhen(row.closedAt)));
  lines.push(toPrinterText('Kassir  ' + (row.closedByName || row.openedByName || '')));
  lines.push(dash(width));
  lines.push(line(width, 'Cek', String(tot.count || 0)));
  lines.push(line(width, 'Cem', Number(tot.total || 0).toFixed(2)));
  lines.push(line(width, 'Nagd', Number(tot.cash || 0).toFixed(2)));
  lines.push(line(width, 'Kart', Number(tot.card || 0).toFixed(2)));
  lines.push(line(width, 'Hediye', Number(tot.gift || 0).toFixed(2)));
  if (Number(tot.loyalty) > 0) {
    lines.push(line(width, 'Ball', Number(tot.loyalty).toFixed(2)));
  }
  if (Number(tot.tip) > 0) {
    lines.push(line(width, 'Tip', Number(tot.tip).toFixed(2)));
  }
  lines.push(line(width, 'Ilkin', Number(tot.prepaid || 0).toFixed(2)));
  if (tot.refundCash || tot.refundCard) {
    lines.push(line(width, 'Geri nagd', Number(tot.refundCash || 0).toFixed(2)));
    lines.push(line(width, 'Geri kart', Number(tot.refundCard || 0).toFixed(2)));
  }
  lines.push(dash(width));
  lines.push(line(width, 'Baslangic', Number(row.startingCash || 0).toFixed(2)));
  (packed.drops || []).forEach(function (drop) {
    lines.push(line(width, 'Cixaris ' + toPrinterText(drop.note || ''), Number(drop.amount || 0).toFixed(2)));
  });
  lines.push(line(width, 'Gozlenilen', Number(packed.expectedCash || 0).toFixed(2)));
  lines.push(line(width, 'Sayilan', Number(row.countedCash || 0).toFixed(2)));
  lines.push(line(width, 'Ferq', Number(packed.difference || 0).toFixed(2)));
  lines.push(eq(width));
  appendReceiptFooter(lines, packed);
  return ticketBytes(Object.assign({}, printer, { openDrawer: false }), 'Z', lines);
}

async function deliverZ(packed) {
  const store = readStore();
  const list = store.printers.filter(function (item) {
    return item.enabled && item.role === 'receipt';
  });
  if (!list.length) {
    return { anyOk: false, results: [], warning: 'Kassa printeri yoxdur.', noPrinter: true };
  }
  return tryPrinters(list, function (printer) {
    return buildZTicket(printer, packed);
  }, 'Z capi');
}

async function sendZTickets(packed) {
  const out = await deliverZ(packed);
  if (out.anyOk) {
    return { results: out.results };
  }
  enqueue({
    kind: 'z',
    payload: packed,
    lastError: out.lastError || out.warning || 'Çap getmədi'
  });
  const warn = out.noPrinter
    ? 'Kassa printeri yoxdur. Z növbəyə düşdü.'
    : 'Z növbəyə düşdü.';
  return { results: out.results || [], warning: warn, queued: true };
}

async function sendStationTickets(stationId, payload) {
  const out = await deliverStation(stationId, payload);
  if (out.warning && !out.results.length) {
    return { results: out.results, warning: out.warning };
  }
  if (!out.anyOk) {
    enqueue({
      kind: 'station',
      stationId: stationId,
      payload: payload,
      lastError: out.lastError || 'Çap getmədi'
    });
    return {
      results: out.results,
      warning: (payload.stationName || 'Stansiya') + ' çapı növbəyə düşdü.'
    };
  }
  return { results: out.results };
}

async function sendReceiptTickets(order) {
  const out = await deliverReceipt(order);
  if (out.warning && !out.results.length) {
    return { results: out.results, warning: out.warning, copies: out.copies || 1 };
  }
  if (!out.anyOk) {
    enqueue({
      kind: 'receipt',
      order: order,
      lastError: out.lastError || 'Çap getmədi'
    });
    return {
      results: out.results,
      warning: 'Kassa çeki növbəyə düşdü.',
      copies: out.copies || 1
    };
  }
  return { results: out.results, copies: out.copies || 1 };
}

async function runJob(job) {
  if (job.kind === 'receipt') {
    return deliverReceipt(job.order);
  }
  if (job.kind === 'z') {
    return deliverZ(job.payload || {});
  }
  return deliverStation(job.stationId, job.payload || {});
}

async function processQueue() {
  if (queueBusy) {
    return listQueue();
  }
  queueBusy = true;
  try {
    const q = readQueue();
    const now = Date.now();
    for (let i = 0; i < q.jobs.length; i += 1) {
      const job = q.jobs[i];
      if (job.status === 'fail' || (job.nextAt && job.nextAt > now)) {
        continue;
      }
      job.tries = (Number(job.tries) || 0) + 1;
      const out = await runJob(job);
      if (out.anyOk) {
        job.done = true;
      } else {
        job.lastError = out.warning || out.lastError || 'Çap getmədi';
        job.nextAt = Date.now() + QUEUE_WAIT_MS;
        if (job.tries >= QUEUE_MAX_TRIES) {
          job.status = 'fail';
        }
      }
    }
    q.jobs = q.jobs.filter(function (job) { return !job.done; });
    writeQueue(q);
  } finally {
    queueBusy = false;
  }
  return listQueue();
}

async function retryJob(id) {
  const q = readQueue();
  const job = q.jobs.find(function (item) { return item.id === Number(id); });
  if (!job) {
    return { error: 'Növbə tapılmadı.' };
  }
  job.status = 'wait';
  job.tries = 0;
  job.nextAt = 0;
  writeQueue(q);
  await processQueue();
  return { ok: true, jobs: listQueue() };
}

async function flushQueue() {
  const q = readQueue();
  q.jobs.forEach(function (job) {
    job.status = 'wait';
    job.nextAt = 0;
  });
  writeQueue(q);
  await processQueue();
  return listQueue();
}

// Qonaq çekini hazırlayırıq
function buildReceiptTicket(printer, order) {
  const width = contentWidth(printer);
  const pay = order.payment || {};
  const when = new Date(pay.at || order.updatedAt || Date.now());
  const dateText =
    String(when.getDate()).padStart(2, '0') + '.' +
    String(when.getMonth() + 1).padStart(2, '0') + '.' +
    when.getFullYear() + ' ' +
    String(when.getHours()).padStart(2, '0') + ':' +
    String(when.getMinutes()).padStart(2, '0');
  const itemsTotal = Number(pay.itemsTotal);
  const service = Number(pay.serviceCharge) || 0;
  const total = Number(pay.total) || 0;
  let cfg = null;
  try {
    cfg = require('./settings').readSettings();
  } catch (error) {
    cfg = null;
  }
  const receipt = (order && order.receipt) || (cfg && cfg.receipt) || {};
  const title = (function () {
    try {
      return require('./settings').receiptTitle(cfg || { branchName: order && order.branchName, receipt: receipt });
    } catch (error) {
      return (order && order.branchName) || 'Arpos Restoran';
    }
  }());
  const branchCode = String((cfg && cfg.branchCode) || (order && order.branchCode) || '').trim();
  const lines = [
    eq(width),
    toPrinterText(title),
    (receipt.address ? toPrinterText(receipt.address) : ''),
    (receipt.phone ? toPrinterText(receipt.phone) : ''),
    (receipt.showBranchCode && branchCode ? toPrinterText('Filial: ' + branchCode) : '')
  ].filter(Boolean);
  (Array.isArray(receipt.headerLines) ? receipt.headerLines : []).forEach(function (row) {
    if (row) {
      lines.push(toPrinterText(row));
    }
  });
  lines.push(toPrinterText('CEK #' + order.id));
  lines.push(eq(width));
  lines.push(line(width, 'Masa', order.tableName || '-'));
  lines.push(line(width, 'Ofisiant', pay.waiterName || order.waiterName || '-'));
  if (order.buyerVoen || pay.buyerVoen) {
    lines.push(line(width, 'VOEN', order.buyerVoen || pay.buyerVoen));
  }
  if (order.buyerName || pay.buyerName) {
    lines.push(line(width, 'Sirket', order.buyerName || pay.buyerName));
  }
  lines.push(line(width, 'Vaxt', dateText));
  lines.push(dash(width));
  (order.items || []).forEach(function (item) {
    if (item.voided) {
      return;
    }
    const sum = Number((Number(item.salePrice) * Number(item.qty)).toFixed(2));
    lines.push(toPrinterText(item.qty + 'x  ' + item.name));
    const marks = (item.modifiers || []).map(function (row) { return row.name; });
    if (item.note) {
      marks.push(item.note);
    }
    if (marks.length) {
      lines.push(toPrinterText('    ' + marks.join(', ')));
    }
    lines.push(line(width, '', sum.toFixed(2)));
  });
  lines.push(dash(width));
  lines.push(line(width, 'Mehsul', (Number.isFinite(itemsTotal) ? itemsTotal : total - service).toFixed(2)));
  if (pay.discountAmount) {
    lines.push(line(width, 'Endirim', '-' + Number(pay.discountAmount).toFixed(2)));
  }
  lines.push(line(width, 'Xidmet' + (pay.servicePercent ? ' ' + pay.servicePercent + '%' : ''), service.toFixed(2)));
  lines.push(line(width, 'CEM', total.toFixed(2)));
  if (pay.share && Number(pay.remaining) > 0) {
    lines.push(line(width, 'Bu odenis', Number(pay.share).toFixed(2)));
    lines.push(line(width, 'Qalan', Number(pay.remaining).toFixed(2)));
  }
  if (pay.prepaid) {
    lines.push(line(width, 'Ilkin', Number(pay.prepaid).toFixed(2)));
    lines.push(line(width, 'Qaliq', Number(pay.due || 0).toFixed(2)));
  }
  lines.push(line(width, 'Nagd', Number(pay.cashAmount || 0).toFixed(2)));
  lines.push(line(width, 'Kart', Number(pay.cardAmount || 0).toFixed(2)));
  if (pay.change) {
    lines.push(line(width, 'Qaytarilan', Number(pay.change).toFixed(2)));
  }
  lines.push(eq(width));
  const footers = Array.isArray(receipt.footerLines) ? receipt.footerLines.filter(Boolean) : [];
  if (footers.length) {
    footers.forEach(function (row) {
      lines.push(toPrinterText(row));
    });
  } else {
    lines.push(toPrinterText('Tesekkur edirik'));
  }
  lines.push('');
  lines.push('');
  return ticketBytes(printer, 'CEK', lines);
}

module.exports = {
  readStore: readStore,
  writeStore: writeStore,
  normalizePrinter: normalizePrinter,
  listWindowsPrinters: listWindowsPrinters,
  testConnection: testConnection,
  testPrint: testPrint,
  sendStationTickets: sendStationTickets,
  sendReceiptTickets: sendReceiptTickets,
  sendZTickets: sendZTickets,
  buildZTicket: buildZTicket,
  buildReceiptTicket: buildReceiptTicket,
  toPrinterText: toPrinterText,
  printerPath: printerPath,
  deliverBytes: deliverBytes,
  listQueue: listQueue,
  processQueue: processQueue,
  retryJob: retryJob,
  flushQueue: flushQueue
};
