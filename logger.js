const fs = require('fs');
const path = require('path');

const db = require('./db');

function logDir() {
  return path.join(db.dataDir(), 'logs');
}

function ensureDir() {
  fs.mkdirSync(logDir(), { recursive: true });
}

// Tarix və saati loq formatında yazırıq
function stamp() {
  const d = new Date();
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// Günlük fayl adını qaytarırıq
function dayFile(prefix) {
  const d = new Date();
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  return prefix + '-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log';
}

// Loq sətrini təmizləyirik
function clean(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 2000);
}

// Sətri fayla əlavə edirik
function write(level, info) {
  const data = info || {};
  ensureDir();
  const parts = [
    stamp(),
    '[' + level + ']',
    data.method || '',
    data.path || '',
    data.status != null ? String(data.status) : '',
    clean(data.message)
  ].filter(function (part) { return part !== ''; });
  let line = parts.join(' ');
  if (data.stack) {
    line += '\n' + String(data.stack).slice(0, 4000);
  }
  line += '\n';
  const fileName = level === 'ERROR' ? dayFile('error') : dayFile('app');
  fs.appendFileSync(path.join(logDir(), fileName), line, 'utf8');
  if (level === 'ERROR') {
    console.error(line.trim());
  }
}

function error(info) {
  write('ERROR', info);
}

function warn(info) {
  write('WARN', info);
}

function info(info) {
  write('INFO', info);
}

module.exports = {
  logDir: logDir,
  error: error,
  warn: warn,
  info: info
};
