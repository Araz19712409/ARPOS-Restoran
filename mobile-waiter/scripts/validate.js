'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));

if (cap.appId !== 'az.arpos.waiter') {
  throw new Error('appId az.arpos.waiter olmalıdır');
}
if (cap.appName !== 'Arpos Ofisiant') {
  throw new Error('appName Arpos Ofisiant olmalıdır');
}
if (cap.webDir !== 'www') {
  throw new Error('webDir www olmalıdır');
}
if (cap.server && cap.server.url) {
  throw new Error('capacitor server.url olmamalıdır (runtime redirect)');
}
if (!cap.server || !Array.isArray(cap.server.allowNavigation) || cap.server.allowNavigation.indexOf('*') < 0) {
  throw new Error('server.allowNavigation * lazımdır (LAN WebView)');
}

const html = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
if (html.indexOf('arpos-server-url') < 0) {
  throw new Error('www/index.html localStorage açarı yoxdur');
}
if (html.indexOf('orders.html?mode=waiter') < 0) {
  throw new Error('www/index.html waiter URL yoxdur');
}
if (html.indexOf('^http:') < 0) {
  throw new Error('HTTP rəddi yoxdur');
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '1.0.0') {
  throw new Error('mobile-waiter version 1.0.0 olmalıdır');
}

if (!fs.existsSync(path.join(root, 'README.md'))) {
  throw new Error('README.md yoxdur');
}

const icon192 = path.join(root, 'www', 'icons', 'icon-192.png');
const icon512 = path.join(root, 'www', 'icons', 'icon-512.png');
if (!fs.existsSync(icon192) || !fs.existsSync(icon512)) {
  throw new Error('www/icons 192/512 yoxdur');
}

console.log('mobile-waiter config OK');
