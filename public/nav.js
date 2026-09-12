(function (global) {
  var pinSettled = false;
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    var headers = init.headers;
    var token = null;
    try {
      var saved = JSON.parse(window.sessionStorage.getItem('posWaiter') || 'null');
      token = saved && saved.token;
    } catch (error) {
      token = null;
    }
    if (token) {
      if (headers && typeof headers.set === 'function') {
        headers.set('X-Session', token);
      } else {
        init.headers = Object.assign({}, headers || {}, { 'X-Session': token });
      }
    }
    return origFetch.call(this, input, init).then(function (res) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || 'GET').toUpperCase();
      var off = window.PosOffline;
      setNetOk(true);
      if (res.status === 401 && String(url).indexOf('/api/login') === -1) {
        var had = window.sessionStorage.getItem('posWaiter');
        window.sessionStorage.removeItem('posWaiter');
        if (had) {
          window.dispatchEvent(new Event('pos-auth-lost'));
        }
      }
      if (res.status === 403) {
        res.clone().json().then(function (body) {
          if (body && body.mustChangePin && !pinSettled) {
            askPinChange({ mustChangePin: true });
          }
        }).catch(function () {
          return null;
        });
      }
      if (res.status === 423) {
        res.clone().json().then(function (body) {
          if (body && body.tillLocked) {
            banner(body.message || 'Kassa bağlanıb.', 'stay');
            try {
              var savedTill = JSON.parse(window.sessionStorage.getItem('posWaiter') || 'null');
              if (savedTill && savedTill.user && Number(savedTill.user.roleId) !== 1) {
                window.sessionStorage.removeItem('posWaiter');
                window.dispatchEvent(new Event('pos-auth-lost'));
              }
            } catch (err) {
              return null;
            }
          }
        }).catch(function () {
          return null;
        });
      }
      if (off && off.isCacheGet(method, url) && res.ok) {
        res.clone().json().then(function (body) {
          if (body && body.success) {
            saveSnap(off.snapPath(url), body);
          }
        }).catch(function () {
          return null;
        });
      }
      var loginUrl = String(url);
      if (method === 'POST' && /\/api\/login\/?(\?|$)/.test(loginUrl) && loginUrl.indexOf('totp') === -1 && res.ok) {
        return res.clone().json().then(function (body) {
          if (body && body.success && body.data && body.data.needTotp) {
            return askTotp(body.data.totpToken).then(function (full) {
              return jsonRes(full);
            });
          }
          return res;
        });
      }
      return res;
    }).catch(function (error) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || 'GET').toUpperCase();
      var off = window.PosOffline;
      setNetOk(false);
      if (off && off.isCacheGet(method, url)) {
        var snap = readSnap(off.snapPath(url));
        if (snap) {
          banner('Oflayn. Son məlumat göstərilir. Növbə: ' + readQueue().length, 'stay');
          return jsonRes(snap);
        }
      }
      if (off && off.shouldQueue(method, url)) {
        var queued = queueWrite(url, init);
        banner('Oflayn. Əməliyyat növbədə (' + readQueue().length + ').', 'stay');
        var payload = {};
        try {
          payload = JSON.parse((init && init.body) || '{}');
        } catch (err) {
          payload = {};
        }
        return jsonRes(off.fakeResult(url, payload, queued));
      }
      if ((method === 'POST' || method === 'PUT') &&
          (/\/api\/orders\/(accept|pay|fire|move|guests|run-status)\b/.test(url) ||
            /\/api\/kitchen\/(done|serve)\b/.test(url))) {
        queueWrite(url, init);
        banner('Şəbəkə yoxdur. Əməliyyat növbəyə yazıldı.', 'warn');
        throw new Error('Şəbəkə yoxdur. Qayıdanda göndəriləcək.');
      }
      banner('Şəbəkə yoxdur.', 'err');
      throw error;
    });
  };

  var QKEY = 'posOfflineQ';
  var SNAPKEY = 'posSnap';

  function jsonRes(obj) {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function askTotp(totpToken) {
    return new Promise(function (resolve) {
      var box = document.getElementById('totp-lock');
      if (!box) {
        box = document.createElement('div');
        box.id = 'totp-lock';
        box.className = 'pin-lock';
        box.style.zIndex = '40';
        box.innerHTML = '<div class="pin-card"><p class="eyebrow">İkinci addım</p><h2>Tətbiq kodu</h2><p id="totp-dots" class="pin-dots"></p><p id="totp-error" class="message"></p><div id="totp-pad" class="pin-pad"></div></div>';
        document.body.appendChild(box);
      }
      box.classList.remove('hidden');
      var buf = '';
      var dots = document.getElementById('totp-dots');
      var err = document.getElementById('totp-error');
      var pad = document.getElementById('totp-pad');
      err.textContent = '';
      function draw() {
        dots.textContent = buf.replace(/./g, '●');
      }
      function send() {
        origFetch.call(window, '/api/login/totp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ totpToken: totpToken, code: buf })
        }).then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || !body.success) {
              err.textContent = (body && body.message) || 'Kod səhvdir.';
              buf = '';
              draw();
              return;
            }
            box.classList.add('hidden');
            resolve(body);
          });
        }).catch(function () {
          err.textContent = 'Şəbəkə yoxdur.';
          buf = '';
          draw();
        });
      }
      pad.innerHTML = '';
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].forEach(function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = String(key);
        btn.addEventListener('click', function () {
          if (key === 'C') {
            buf = '';
            draw();
            return;
          }
          if (key === 'OK') {
            if (buf.length === 6) {
              send();
            }
            return;
          }
          if (buf.length >= 6) {
            return;
          }
          buf += String(key);
          draw();
          if (buf.length === 6) {
            send();
          }
        });
        pad.appendChild(btn);
      });
      draw();
    });
  }

  function readSnap(path) {
    try {
      var all = JSON.parse(window.localStorage.getItem(SNAPKEY) || '{}');
      return all[path] || null;
    } catch (error) {
      return null;
    }
  }

  function saveSnap(path, body) {
    try {
      var all = JSON.parse(window.localStorage.getItem(SNAPKEY) || '{}');
      all[path] = body;
      window.localStorage.setItem(SNAPKEY, JSON.stringify(all));
    } catch (error) {
      return;
    }
  }

  function patchOrdersSnap(fn) {
    var cur = readSnap('/api/orders') || { success: true, data: { orders: [] } };
    var data = cur.data && typeof cur.data === 'object' ? cur.data : { orders: [] };
    cur.success = true;
    cur.data = fn(data);
    saveSnap('/api/orders', cur);
  }

  function readQueue() {
    try {
      var list = JSON.parse(window.localStorage.getItem(QKEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function writeQueue(list) {
    window.localStorage.setItem(QKEY, JSON.stringify(list.slice(-80)));
  }

  function queueKeyOf(url, body) {
    if (window.PosOffline && window.PosOffline.queueKeyOf) {
      return window.PosOffline.queueKeyOf(url, body);
    }
    return String(url);
  }

  function queueWrite(url, init) {
    var body = init && init.body ? String(init.body) : '';
    var off = window.PosOffline;
    var key = queueKeyOf(url, body);
    var list = readQueue().filter(function (row) { return row.key !== key; });
    var headers = {};
    if (init && init.headers && typeof init.headers === 'object' && !init.headers.forEach) {
      headers = init.headers;
    }
    var payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch (error) {
      payload = {};
    }
    var row = {
      key: key,
      url: url,
      method: String((init && init.method) || 'POST'),
      headers: headers,
      body: body,
      at: Date.now()
    };
    if (off && String(url).indexOf('/accept') >= 0) {
      row.tempOrderId = -Date.now();
      patchOrdersSnap(function (data) {
        return off.applyAccept(data, payload, row.tempOrderId);
      });
    }
    if (off && String(url).indexOf('/pay') >= 0) {
      patchOrdersSnap(function (data) {
        return off.applyPay(data, payload);
      });
    }
    list.push(row);
    writeQueue(list);
    return row;
  }

  var flushing = false;
  var lastNetOk = true;

  function setNetOk(ok) {
    if (ok === lastNetOk) {
      if (ok) {
        flushQueue();
      }
      return;
    }
    lastNetOk = ok;
    if (ok) {
      flushQueue();
    }
  }

  function flushQueue() {
    if (flushing) {
      return;
    }
    var list = readQueue();
    if (!list.length) {
      return;
    }
    flushing = true;
    var row = list[0];
    origFetch.call(window, row.url, {
      method: row.method,
      headers: Object.assign({}, row.headers || {}, { 'Content-Type': 'application/json' }),
      body: row.body
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!body || !body.success) {
          throw new Error((body && body.message) || 'Növbə göndərilmədi.');
        }
        var rest = list.slice(1);
        var realId = body.data && body.data.order && body.data.order.id;
        if (window.PosOffline && row.tempOrderId && realId) {
          rest = window.PosOffline.remapQueue(rest, row.tempOrderId, realId);
        }
        writeQueue(rest);
        flushing = false;
        if (readQueue().length) {
          flushQueue();
        } else {
          banner('Şəbəkə qayıtdı. Növbə göndərildi.', 'ok');
        }
      });
    }).catch(function () {
      flushing = false;
    });
  }

  window.addEventListener('online', flushQueue);
  window.setInterval(function () {
    if (readQueue().length) {
      flushQueue();
    }
  }, 8000);

  function session() {
    try {
      return JSON.parse(window.sessionStorage.getItem('posWaiter') || 'null');
    } catch (error) {
      return null;
    }
  }

  function keysOf(value) {
    return String(value || '').split('|').map(function (item) {
      return item.trim();
    }).filter(Boolean);
  }

  function can(key, data) {
    data = data || session();
    return !!(data && data.permissions && data.permissions.indexOf(key) !== -1);
  }

  function canAny(list, data) {
    data = arguments.length > 1 ? data : session();
    return list.some(function (key) {
      return can(key, data);
    });
  }

  function currentOps(data) {
    return (data && data.opsMode) === 'sales' ? 'sales' : 'full';
  }

  function pageOpsOk(data) {
    var needOps = document.body && document.body.getAttribute('data-ops');
    if (!needOps) {
      return true;
    }
    return needOps === currentOps(data);
  }

  function ensureJournalLink() {
    var lists = document.querySelectorAll('.more-nav-list');
    var path = window.location.pathname;
    var onHub = path === '/reports.html' || path === '/reports' ||
      path === '/books.html' || path === '/books' ||
      path === '/journal.html' || path === '/journal' ||
      path === '/waiter-report.html' || path === '/waiter-report';
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      var reports = list.querySelector('a[href="/reports.html"]');
      if (!reports) {
        continue;
      }
      reports.textContent = 'Hesabatlar';
      reports.setAttribute('data-need', 'reports.view|logs.view');
      if (onHub) {
        reports.classList.add('active');
      }
      var extra = list.querySelectorAll('a[href="/waiter-report.html"], a[href="/books.html"], a[href="/journal.html"]');
      for (var e = 0; e < extra.length; e++) {
        extra[e].parentNode.removeChild(extra[e]);
      }
      if (!list.querySelector('a[href="/delivery.html"]')) {
        var del = document.createElement('a');
        del.href = '/delivery.html';
        del.setAttribute('data-need', 'orders.create|payments.take');
        del.textContent = 'Çatdırılma';
        if (path === '/delivery.html' || path === '/delivery') {
          del.classList.add('active');
        }
        list.insertBefore(del, reports);
      }
    }
  }

  function apply(data) {
    data = arguments.length ? data : session();
    ensureJournalLink();
    var nodes = document.querySelectorAll('.app-nav [data-need]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].hidden = !canAny(keysOf(nodes[i].getAttribute('data-need')), data);
    }
    var ops = currentOps(data);
    var opsNodes = document.querySelectorAll('.app-nav [data-ops]');
    for (var o = 0; o < opsNodes.length; o++) {
      if (opsNodes[o].getAttribute('data-ops') !== ops) {
        opsNodes[o].hidden = true;
      }
    }
    var boxes = document.querySelectorAll('.app-nav details.more-nav');
    for (var j = 0; j < boxes.length; j++) {
      var links = boxes[j].querySelectorAll('a');
      var shown = 0;
      var current = false;
      for (var k = 0; k < links.length; k++) {
        if (!links[k].hidden) {
          shown += 1;
        }
        if (links[k].classList.contains('active')) {
          current = true;
        }
      }
      boxes[j].hidden = shown === 0;
      boxes[j].classList.toggle('nav-current', current);
    }
  }

  function isStockMode(data) {
    data = data || session();
    return !data || data.opsMode !== 'sales';
  }

  function rememberOps(mode, data) {
    data = data || session();
    if (!data) {
      return;
    }
    data.opsMode = mode === 'sales' ? 'sales' : 'full';
    window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
    apply(data);
  }

  function homePath(data) {
    data = data || session();
    if (data && !can('orders.create', data) && can('kitchen.view', data)) {
      return '/kitchen.html';
    }
    return '/orders.html';
  }

  function bounce() {
    window.location.replace(homePath());
  }

  function forget() {
    var cur = session();
    if (cur && cur.token) {
      origFetch.call(window, '/api/logout', {
        method: 'POST',
        headers: { 'X-Session': cur.token }
      }).catch(function () {
        return null;
      });
    }
  }

  function ensurePinModal() {
    if (document.getElementById('pin-change-modal')) {
      return document.getElementById('pin-change-modal');
    }
    var wrap = document.createElement('div');
    wrap.id = 'pin-change-modal';
    wrap.className = 'modal hidden';
    wrap.innerHTML =
      '<form id="pin-change-form" class="modal-card">' +
      '<h3>Yeni PIN</h3>' +
      '<p class="hint">6-8 rəqəm. 0000 olmaz.</p>' +
      '<label>Yeni PIN<input id="pin-change-new" type="password" inputmode="numeric" maxlength="8" required></label>' +
      '<label>Təkrar<input id="pin-change-again" type="password" inputmode="numeric" maxlength="8" required></label>' +
      '<p id="pin-change-msg" class="message"></p>' +
      '<div class="modal-actions"><button class="gold" type="submit">Yadda saxla</button></div>' +
      '</form>';
    document.body.appendChild(wrap);
    document.getElementById('pin-change-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var pin = document.getElementById('pin-change-new').value;
      var again = document.getElementById('pin-change-again').value;
      var msg = document.getElementById('pin-change-msg');
      if (pin !== again) {
        msg.textContent = 'PIN-lər eyni deyil.';
        return;
      }
      if (!/^\d{6,8}$/.test(pin)) {
        msg.textContent = 'PIN 6-8 rəqəm olmalıdır.';
        return;
      }
      if (/^0+$/.test(pin)) {
        msg.textContent = '0000 olmaz.';
        return;
      }
      origFetch.call(window, '/api/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session': (session() || {}).token || '' },
        body: JSON.stringify({ pin: pin })
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!body.success) {
            throw new Error(body.message || 'Xəta.');
          }
          pinSettled = true;
          var cur = session();
          if (cur) {
            cur.mustChangePin = false;
            window.sessionStorage.setItem('posWaiter', JSON.stringify(cur));
          }
          wrap.classList.add('hidden');
          msg.textContent = '';
          window.dispatchEvent(new Event('pos-pin-changed'));
        });
      }).catch(function (error) {
        msg.textContent = error.message;
      });
    });
    return wrap;
  }

  function askPinChange(data) {
    if (pinSettled || !data || !data.mustChangePin) {
      return;
    }
    ensurePinModal().classList.remove('hidden');
  }

  function guard() {
    var need = document.body && document.body.getAttribute('data-need');
    var data = session();
    if (data && data.mustChangePin) {
      askPinChange(data);
    }
    apply(data);
    if (!need) {
      return true;
    }
    var list = keysOf(need);
    if (data) {
      if (!canAny(list, data) || !pageOpsOk(data)) {
        bounce();
        return false;
      }
      return true;
    }
    if (!document.getElementById('pin-lock')) {
      bounce();
      return false;
    }
    return true;
  }

  function watchPrintQueue(boxId) {
    var box = document.getElementById(boxId);
    if (!box) {
      return;
    }
    var busy = false;
    function canSee() {
      return canAny(['printers.view', 'orders.create', 'kitchen.view', 'payments.take']);
    }
    function canRun() {
      return canAny(['printers.edit', 'printers.test', 'orders.create', 'payments.take', 'kitchen.done']);
    }
    function request(url, options) {
      return window.fetch(url, options).then(function (res) {
        return res.json().then(function (body) {
          if (!body.success) {
            throw new Error(body.message || 'Xəta.');
          }
          return body;
        });
      });
    }
    function paint(jobs) {
      var only = box.getAttribute('data-queue');
      jobs = (jobs || []).filter(function (row) {
        return !only || row.kind === only;
      });
      box.innerHTML = '';
      if (!jobs.length) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');
      var head = document.createElement('div');
      head.className = 'print-queue-head';
      var title = document.createElement('strong');
      title.textContent = 'Çap növbəsi: ' + jobs.length;
      head.appendChild(title);
      if (canRun()) {
        var flush = document.createElement('button');
        flush.type = 'button';
        flush.textContent = 'Hamısını göndər';
        flush.addEventListener('click', function () {
          if (busy) {
            return;
          }
          busy = true;
          request('/api/print-queue/flush', { method: 'POST' }).then(function (body) {
            paint(body.data || []);
          }).catch(function () {
            return null;
          }).then(function () {
            busy = false;
          });
        });
        head.appendChild(flush);
      }
      box.appendChild(head);
      var list = document.createElement('div');
      list.className = 'print-queue-list';
      jobs.forEach(function (row) {
        var item = document.createElement('div');
        item.className = 'print-queue-item' + (row.status === 'fail' ? ' fail' : '');
        var info = document.createElement('span');
        var state = row.status === 'fail' ? 'uğursuz' : ((row.tries || 0) + '/' + (row.maxTries || 8));
        info.textContent = (row.title || 'Çap') + ' • ' + (row.tableName || '—') + ' • ' + state +
          (row.lastError ? ' — ' + row.lastError : '');
        item.appendChild(info);
        if (canRun()) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'İndi';
          btn.addEventListener('click', function () {
            if (busy) {
              return;
            }
            busy = true;
            request('/api/print-queue/' + row.id + '/retry', { method: 'POST' }).then(function (body) {
              paint(body.data || []);
            }).catch(function () {
              return null;
            }).then(function () {
              busy = false;
            });
          });
          item.appendChild(btn);
        }
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    function refresh() {
      if (!session() || !canSee()) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
      }
      request('/api/print-queue').then(function (body) {
        paint(body.data || []);
      }).catch(function () {
        return null;
      });
    }
    refresh();
    setInterval(refresh, 15000);
    return refresh;
  }

  var refreshPrintQueue = null;

  function afterLogin(data) {
    hideBanner();
    apply(data);
    if (refreshPrintQueue) {
      refreshPrintQueue();
    }
    if (data && data.mustChangePin && data.fromLogin) {
      askPinChange(data);
    }
    var need = document.body && document.body.getAttribute('data-need');
    if (need && data && !canAny(keysOf(need), data)) {
      bounce();
      return false;
    }
    if (data && !pageOpsOk(data)) {
      bounce();
      return false;
    }
    return true;
  }

  window.addEventListener('pos-auth-lost', function () {
    apply(null);
    if (refreshPrintQueue) {
      refreshPrintQueue();
    }
    if (!document.getElementById('pin-lock')) {
      bounce();
    }
  });

  var bannerTimer = 0;

  function hideBanner() {
    var el = document.getElementById('pos-banner');
    if (el) {
      el.classList.add('hidden');
    }
    document.body.classList.remove('has-banner');
    if (bannerTimer) {
      window.clearTimeout(bannerTimer);
      bannerTimer = 0;
    }
  }

  function ensureBanner() {
    var el = document.getElementById('pos-banner');
    if (el) {
      return el;
    }
    el = document.createElement('div');
    el.id = 'pos-banner';
    el.className = 'pos-banner hidden';
    el.setAttribute('role', 'status');
    var text = document.createElement('p');
    text.id = 'pos-banner-text';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Bağla';
    close.addEventListener('click', function (event) {
      event.stopPropagation();
      hideBanner();
    });
    el.appendChild(text);
    el.appendChild(close);
    el.addEventListener('click', hideBanner);
    document.body.appendChild(el);
    return el;
  }

  function pinLockOpen() {
    var lock = document.getElementById('pin-lock');
    return !!(lock && !lock.classList.contains('hidden'));
  }

  function isLoginPrompt(msg) {
    return /PIN ilə daxil olun/i.test(msg);
  }

  function banner(text, kind) {
    var msg = String(text == null ? '' : text).trim();
    if (!msg) {
      hideBanner();
      return;
    }
    if (isLoginPrompt(msg) && (pinLockOpen() || !session())) {
      return;
    }
    if (kind !== 'ok' && kind !== 'err' && kind !== 'warn' && kind !== 'stay') {
      kind = 'ok';
    }
    var el = ensureBanner();
    el.className = 'pos-banner pos-banner-' + (kind === 'stay' ? 'warn' : kind);
    document.getElementById('pos-banner-text').textContent = msg;
    document.body.classList.add('has-banner');
    if (bannerTimer) {
      window.clearTimeout(bannerTimer);
      bannerTimer = 0;
    }
    if (kind === 'stay') {
      return;
    }
    if (kind === 'ok') {
      bannerTimer = window.setTimeout(hideBanner, 4000);
    } else if (kind === 'warn') {
      bannerTimer = window.setTimeout(hideBanner, 5500);
    }
  }

  function parseDec(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    var raw = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    if (!raw || raw === '.' || raw === '-' || raw === '-.') {
      return NaN;
    }
    var n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  global.PosNav = {
    session: session,
    can: can,
    canAny: canAny,
    apply: apply,
    guard: guard,
    afterLogin: afterLogin,
    askPinChange: askPinChange,
    forget: forget,
    isStockMode: isStockMode,
    rememberOps: rememberOps,
    homePath: homePath,
    banner: banner,
    hideBanner: hideBanner,
    parseDec: parseDec
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function clickPadKey(key) {
    var pad = document.getElementById('pin-pad');
    if (!pad) {
      return false;
    }
    var btns = pad.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent === key) {
        btns[i].click();
        return true;
      }
    }
    return false;
  }

  function isZeroNumber(el) {
    var raw = String(el.value == null ? '' : el.value).trim().replace(',', '.');
    return raw === '' || raw === '0' || raw === '0.0' || raw === '0.00';
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      var tag = event.target && event.target.tagName;
      if (pinLockOpen() && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        var pinKey = event.key;
        if (pinKey === 'Enter') {
          pinKey = 'OK';
        } else if (pinKey === 'Backspace' || pinKey === 'Escape') {
          pinKey = 'C';
        }
        if ((/^\d$/.test(pinKey) || pinKey === 'OK' || pinKey === 'C') && clickPadKey(pinKey)) {
          event.preventDefault();
        }
        return;
      }
      var el = event.target;
      if (!el || el.tagName !== 'INPUT' || el.disabled || el.readOnly) {
        return;
      }
      if (el.type === 'password') {
        return;
      }
      if (el.getAttribute('inputmode') !== 'decimal') {
        return;
      }
      if ((event.key === '.' || event.key === ',') && /[.,]/.test(String(el.value || ''))) {
        event.preventDefault();
        return;
      }
      if (!/^\d$/.test(event.key) || !isZeroNumber(el)) {
        return;
      }
      event.preventDefault();
      el.value = event.key;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, true);
  }

  function ensureLicenseLock() {
    var el = document.getElementById('license-lock');
    if (el) {
      return el;
    }
    el = document.createElement('div');
    el.id = 'license-lock';
    el.className = 'license-lock hidden';
    el.innerHTML =
      '<form class="license-card" id="license-form">' +
      '<p class="eyebrow">Arpos Restoran</p>' +
      '<h2>Lisenziya</h2>' +
      '<p>Proqramı açmaq üçün kodu yazın.</p>' +
      '<p>Maşın kodu: <span id="license-machine"></span></p>' +
      '<label>Lisenziya kodu' +
      '<textarea id="license-key" required maxlength="400" placeholder="ARPOS.v1...."></textarea>' +
      '</label>' +
      '<p id="license-error" class="message"></p>' +
      '<button class="gold" type="submit">Yadda saxla</button>' +
      '</form>';
    document.body.appendChild(el);
    document.getElementById('license-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var err = document.getElementById('license-error');
      err.textContent = '';
      origFetch.call(window, '/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: document.getElementById('license-key').value })
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!body.success) {
            throw new Error(body.message || 'Kod qəbul olunmadı.');
          }
          el.classList.add('hidden');
          banner('Lisenziya aktivdir.', 'ok');
        });
      }).catch(function (error) {
        err.textContent = error.message;
      });
    });
    return el;
  }

  function showVersion(ver) {
    var top = document.querySelector('.top div') || document.querySelector('.top');
    if (!top || document.getElementById('arpos-ver')) {
      return;
    }
    var p = document.createElement('p');
    p.id = 'arpos-ver';
    p.className = 'arpos-ver';
    p.textContent = 'Arpos Restoran ' + (ver || '');
    top.appendChild(p);
  }

  function checkLicense(done) {
    origFetch.call(window, '/api/license/status').then(function (res) {
      return res.json();
    }).then(function (body) {
      var data = (body && body.data) || {};
      showVersion(data.version);
      if (document.title.indexOf('Arpos Restoran') === -1) {
        document.title = 'Arpos Restoran — ' + document.title;
      }
      if (data.licensed) {
        done();
        return;
      }
      var lock = ensureLicenseLock();
      document.getElementById('license-machine').textContent = data.machine || '';
      document.getElementById('license-error').textContent = data.error || '';
      lock.classList.remove('hidden');
      done();
    }).catch(function () {
      var lock = ensureLicenseLock();
      document.getElementById('license-error').textContent = 'Serverə qoşulmadı.';
      lock.classList.remove('hidden');
      done();
    });
  }

  function boot() {
    checkLicense(function () {
      guard();
      bindKeyboard();
      refreshPrintQueue = watchPrintQueue('print-queue-box') || null;
    });
  }
})(window);
