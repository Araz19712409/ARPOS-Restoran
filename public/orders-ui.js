(function () {
  var tables = [];
  var floors = [];
  var rooms = [];
  var groups = [];
  var products = [];
  var stations = [];
  var orders = [];
  var reservations = [];
  var settings = { serviceChargePercent: 0, waiterBonuses: {} };
  var tableId = 0;
  var floorId = 0;
  var tableQuery = '';
  var tableFilter = 'all';
  var payLock = false;

  var M = window.PosMoney;
  var Dom = window.PosDom || {};

  function el(id) {
    return Dom.el ? Dom.el(id) : document.getElementById(id);
  }

  function isWaiterMode() {
    return !!(document.body && document.body.classList.contains('waiter-mode'));
  }

  function setText(id, text) {
    if (Dom.setText) {
      Dom.setText(id, text);
      return;
    }
    var n = document.getElementById(id);
    if (n) {
      n.textContent = text == null ? '' : String(text);
    }
  }

  function setVal(id, val) {
    if (Dom.setVal) {
      Dom.setVal(id, val);
      return;
    }
    var n = document.getElementById(id);
    if (n) {
      n.value = val == null ? '' : String(val);
    }
  }

  function dec(value) {
    return M && M.parseDec
      ? M.parseDec(value)
      : (window.PosNav && window.PosNav.parseDec
        ? window.PosNav.parseDec(value)
        : Number(String(value == null ? '' : value).replace(',', '.')));
  }
  var payMode = 'order';
  var payDue = 0;
  var payMethod = 'cash';
  var payPickIds = [];
  var paySeatId = 0;
  var groupId = 0;
  var searchQuery = '';
  var pending = [];
  var pendingGuests = 0;
  var pendingGuestName = '';
  var pendingGuestPhone = '';
  var pendingGuestAddress = '';
  var pendingCourier = '';
  var waitlist = [];
  var seatedWait = [];
  var optionProduct = null;
  var optionPortionId = 0;
  var optionExtraIds = [];
  var busy = false;
  var waiter = null;
  var terminal = null;
  var shiftPack = null;
  var locks = [];
  var lastReceipt = null;
  var ctx = {};
  var pinBuffer = '';
  var pingTimer = 0;
  var ordersPollTimer = 0;
  var ordersLightBusy = false;
  var ordersPollWanted = false;
  var ORDERS_POLL_MS = 4000;
  var switching = false;
  function storedScale() {
    try {
      var raw = window.localStorage.getItem('orderCardScale');
      if (raw == null || raw === '') {
        return null;
      }
      var saved = Number(raw);
      if (Number.isFinite(saved) && saved >= 1 && saved <= 5) {
        return Math.round(saved);
      }
    } catch (error) {}
    return null;
  }

  function readCardScale() {
    var saved = storedScale();
    return saved != null ? saved : 2;
  }

  var cardScale = readCardScale();
  var scaleTimer = 0;
  var scaleHydrated = false;
  var lowTold = false;

  function api(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().then(function (body) {
        if (!body.success) {
          throw new Error(body.message || 'Xəta baş verdi.');
        }
        return body;
      });
    });
  }

  function say(text, kind) {
    if (window.PosNav && window.PosNav.banner) {
      window.PosNav.banner(text, kind);
    }
    setText('message', text || '');
  }

  function payFail(msg) {
    say(msg, 'err');
    setText('check-hint', msg);
    setText('message', msg);
    if (window.PosNav && window.PosNav.banner) {
      window.PosNav.banner(msg, 'err');
    }
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('az').trim();
  }

  function isServiceId(id) {
    return Number(id) < 0;
  }

  function coversTable(order, id) {
    if (!order || order.status !== 'open') {
      return false;
    }
    if (Number(order.tableId) === Number(id)) {
      return true;
    }
    return (order.linkedTableIds || []).indexOf(Number(id)) !== -1;
  }

  var AGE_WARN_MIN = 30;
  var AGE_ALERT_MIN = 60;

  function orderOpenMs(order) {
    if (!order) {
      return 0;
    }
    var t = NaN;
    var raw = order.openedAt || order.createdAt;
    if (raw) {
      t = Date.parse(raw);
    }
    if (!Number.isFinite(t)) {
      (order.items || []).forEach(function (item) {
        var cand = item && (item.createdAt || item.acceptedAt || item.sentAt);
        if (!cand) {
          return;
        }
        var tt = Date.parse(cand);
        if (Number.isFinite(tt) && (!Number.isFinite(t) || tt < t)) {
          t = tt;
        }
      });
    }
    if (!Number.isFinite(t) && order.updatedAt) {
      t = Date.parse(order.updatedAt);
    }
    return Number.isFinite(t) ? t : 0;
  }

  function ageMinutesFromMs(openMs, nowMs) {
    if (!openMs) {
      return -1;
    }
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    return Math.max(0, Math.floor((now - openMs) / 60000));
  }

  function ageClass(mins) {
    if (!(mins >= 0)) {
      return '';
    }
    if (mins >= AGE_ALERT_MIN) {
      return 'age-alert';
    }
    if (mins >= AGE_WARN_MIN) {
      return 'age-warn';
    }
    return 'age-ok';
  }

  function formatOpenAge(mins) {
    if (!(mins >= 0)) {
      return '';
    }
    if (mins < 60) {
      return mins + ' dəq';
    }
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h + 's ' + (m < 10 ? '0' : '') + m + 'd';
  }

  function openOrderForTable(id) {
    return orders.find(function (item) {
      return coversTable(item, id);
    }) || null;
  }

  function busyAgeParts(order, nowMs) {
    var mins = ageMinutesFromMs(orderOpenMs(order), nowMs);
    return {
      mins: mins,
      cls: ageClass(mins),
      text: formatOpenAge(mins)
    };
  }

  if (typeof window !== 'undefined') {
    window.PosFloorAge = {
      WARN_MIN: AGE_WARN_MIN,
      ALERT_MIN: AGE_ALERT_MIN,
      orderOpenMs: orderOpenMs,
      ageMinutesFromMs: ageMinutesFromMs,
      ageClass: ageClass,
      formatOpenAge: formatOpenAge
    };
  }

  var FAV_KEY = 'arpos-favorites';
  var FAV_MAX = 12;

  function normalizeFavIds(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (id) {
      var n = Number(id);
      if (!(n >= 1) || out.indexOf(n) >= 0) {
        return;
      }
      if (out.length < FAV_MAX) {
        out.push(n);
      }
    });
    return out;
  }

  function toggleFavId(list, id) {
    var n = Number(id);
    if (!(n >= 1)) {
      return normalizeFavIds(list);
    }
    var next = normalizeFavIds(list).slice();
    var i = next.indexOf(n);
    if (i >= 0) {
      next.splice(i, 1);
    } else if (next.length < FAV_MAX) {
      next.unshift(n);
    }
    return next;
  }

  function readFavorites() {
    try {
      var raw = window.localStorage.getItem(FAV_KEY);
      if (!raw) {
        return [];
      }
      return normalizeFavIds(JSON.parse(raw));
    } catch (error) {
      return [];
    }
  }

  function writeFavorites(ids) {
    var next = normalizeFavIds(ids);
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch (error) {}
    return next;
  }

  var favoriteIds = readFavorites();

  function isFavorite(id) {
    return favoriteIds.indexOf(Number(id)) >= 0;
  }

  function toggleFavorite(id) {
    var before = favoriteIds.length;
    favoriteIds = writeFavorites(toggleFavId(favoriteIds, id));
    if (favoriteIds.length === before && !isFavorite(id) && before >= FAV_MAX) {
      say('Favorit limiti: ' + FAV_MAX, 'warn');
    }
    renderFavRow();
    renderProducts();
  }

  if (typeof window !== 'undefined') {
    window.PosFavorites = {
      KEY: FAV_KEY,
      MAX: FAV_MAX,
      normalizeFavIds: normalizeFavIds,
      toggleFavId: toggleFavId
    };
  }

  function openOrder() {
    if (tableId === -1 || tableId === -2) {
      return null;
    }
    return orders.find(function (item) {
      return coversTable(item, tableId);
    }) || null;
  }

  function tableById(id) {
    return tables.find(function (item) { return item.id === id; });
  }

  function can(key) {
    return waiter && waiter.permissions && waiter.permissions.indexOf(key) !== -1;
  }

  function pendingGuestMap() {
    try {
      var raw = JSON.parse(window.sessionStorage.getItem('posPendingGuests') || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (error) {
      return {};
    }
  }

  function readPendingGuests(id) {
    return Math.max(0, Math.min(99, Number(pendingGuestMap()[String(id)]) || 0));
  }

  function writePendingGuests(id, n) {
    if (!id) {
      return;
    }
    var map = pendingGuestMap();
    map[String(id)] = Math.max(0, Math.min(99, Number(n) || 0));
    window.sessionStorage.setItem('posPendingGuests', JSON.stringify(map));
  }

  function clearPendingGuests(id) {
    var map = pendingGuestMap();
    delete map[String(id)];
    window.sessionStorage.setItem('posPendingGuests', JSON.stringify(map));
  }

  function showLock() {
    document.getElementById('pin-lock').classList.remove('hidden');
    if (window.PosNav && window.PosNav.hideBanner) {
      window.PosNav.hideBanner();
    }
    pinBuffer = '';
    drawPin();
  }

  function hideLock() {
    document.getElementById('pin-lock').classList.add('hidden');
  }

  function pinEyebrow() {
    var el = document.querySelector('#pin-lock .eyebrow');
    return el;
  }

  function startSwitch() {
    if (!waiter) {
      return;
    }
    switching = true;
    pinBuffer = '';
    drawPin();
    document.getElementById('pin-error').textContent = '';
    document.getElementById('pin-switch-back').classList.remove('hidden');
    var eye = pinEyebrow();
    if (eye) {
      eye.textContent = 'Ofisiantı dəyiş';
    }
    showLock();
  }

  function cancelSwitch() {
    switching = false;
    pinBuffer = '';
    drawPin();
    document.getElementById('pin-error').textContent = '';
    document.getElementById('pin-switch-back').classList.add('hidden');
    var eye = pinEyebrow();
    if (eye) {
      eye.textContent = 'Ofisiant girişi';
    }
    hideLock();
  }

  function finishSwitch() {
    document.getElementById('pin-switch-back').classList.add('hidden');
    var eye = pinEyebrow();
    if (eye) {
      eye.textContent = 'Ofisiant girişi';
    }
    switching = false;
  }

  function drawPin() {
    document.getElementById('pin-dots').textContent = pinBuffer ? new Array(pinBuffer.length + 1).join('•') : '○ ○ ○ ○ ○ ○';
  }

  function terminalPayload(extra) {
    extra.waiterId = waiter.user.id;
    extra.terminalId = terminal ? terminal.id : 0;
    return extra;
  }

  function readSavedTerminal() {
    try {
      return JSON.parse(window.localStorage.getItem('posTerminal') || 'null');
    } catch (error) {
      return null;
    }
  }

  function setTerminal(row) {
    terminal = row || null;
    if (row) {
      window.localStorage.setItem('posTerminal', JSON.stringify(row));
      document.getElementById('terminal-lock').classList.add('hidden');
    } else {
      window.localStorage.removeItem('posTerminal');
    }
    drawWaiterLine();
  }

  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function refreshShiftBadge() {
    if (typeof ctx.refreshShiftBadge === 'function') {
      return ctx.refreshShiftBadge();
    }
    return Promise.resolve();
  }

  function openShiftModal() {
    if (typeof ctx.openShiftModal === 'function') {
      ctx.openShiftModal();
    }
  }

  function setOrderZone(zone) {
    if (typeof ctx.setOrderZone === 'function') {
      ctx.setOrderZone(zone);
    }
  }

  function openPay() {
    if (typeof ctx.openPay === 'function') {
      ctx.openPay();
    }
  }

  function drawWaiterLine() {
    if (isWaiterMode()) {
      setText('order-title', 'Ofisiant');
      var seat = tableId ? tableTitle(tableId) : '';
      setText('waiter-line', seat || (waiter && waiter.user && waiter.user.name) || 'Masa seçin');
      var zBtn = el('shift-z-open');
      if (zBtn) {
        zBtn.style.display = 'none';
      }
      var cashEl = el('shift-cash');
      if (cashEl) {
        cashEl.style.display = 'none';
      }
      return;
    }
    if (waiter && terminal) {
      setText('waiter-line', waiter.user.name + ' • ' + terminal.name);
    } else if (waiter) {
      setText('waiter-line', waiter.user.name);
    } else {
      setText('waiter-line', 'PIN ilə daxil olun.');
    }
    refreshShiftBadge();
  }

  function showTerminalPick(list) {
    var box = document.getElementById('terminal-pick');
    box.innerHTML = '';
    list.forEach(function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = row.name;
      btn.addEventListener('click', function () {
        setTerminal(row);
      });
      box.appendChild(btn);
    });
    document.getElementById('terminal-lock').classList.remove('hidden');
  }

  function ensureTerminal(force) {
    return api('/api/terminals').then(function (body) {
      var list = body.data || [];
      if (!list.length) {
        say('Ayarlarda terminal yaradın.', 'err');
        return;
      }
      if (!force) {
        var saved = readSavedTerminal();
        var found = saved && list.find(function (item) { return item.id === saved.id; });
        if (found) {
          setTerminal(found);
          return;
        }
        if (list.length === 1) {
          setTerminal(list[0]);
          return;
        }
      }
      showTerminalPick(list);
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function tableLock(id) {
    return locks.find(function (item) { return item.tableId === id; }) || null;
  }

  function isDraftSeat(id) {
    return Number(id) === -1 || Number(id) === -2;
  }

  function releaseTable(id) {
    if (!terminal || !id || isDraftSeat(id)) {
      return Promise.resolve();
    }
    return api('/api/terminals/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalId: terminal.id, tableId: id })
    }).catch(function () {
      return null;
    });
  }

  function claimTable(id) {
    if (!id || isDraftSeat(id)) {
      return Promise.resolve();
    }
    return api('/api/terminals/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(terminalPayload({ tableId: id }))
    }).then(function (body) {
      locks = (body.data && body.data.locks) || locks;
    });
  }

  function applySeat(id) {
    tableId = id;
    pending = [];
    var existing = openOrder();
    pendingGuests = existing ? Number(existing.guests) || 0 : (id > 0 ? readPendingGuests(id) : 0);
    pendingGuestName = existing ? (existing.guestName || '') : '';
    pendingGuestPhone = existing ? (existing.guestPhone || '') : '';
    pendingGuestAddress = existing ? (existing.guestAddress || '') : '';
    pendingCourier = existing ? (existing.courierName || '') : '';
    say('');
    if (id && (isWaiterMode() || (window.matchMedia && window.matchMedia('(max-width: 980px)').matches))) {
      setOrderZone('menu');
    }
    drawWaiterLine();
    render();
    maybeFocusBarcode();
  }

  function orderForId(id) {
    return orders.find(function (item) {
      return coversTable(item, id);
    }) || null;
  }

  function selectSeat(id) {
    function go() {
      var prev = tableId;
      if (prev && !isDraftSeat(prev) && prev !== id) {
        var next = id && !isDraftSeat(id) ? claimTable(id) : Promise.resolve();
        return next.then(function () {
          if (!orderForId(prev)) {
            return releaseTable(prev);
          }
        }).then(function () {
          applySeat(id);
        });
      }
      if (id && !isDraftSeat(id)) {
        return claimTable(id).then(function () {
          applySeat(id);
        });
      }
      applySeat(id);
      return Promise.resolve();
    }
    if (pending.length && tableId && tableId !== id) {
      return window.askYes('Masa', 'Qəbul olunmamış sətirlər silinəcək. Davam?').then(function (ok) {
        if (!ok) {
          return;
        }
        return go();
      });
    }
    return go();
  }

  function setWaiter(data) {
    waiter = data;
    if (data && window.PosNav && !window.PosNav.can('orders.create', data) &&
        window.PosNav.can('kitchen.view', data)) {
      window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
      window.location.replace('/kitchen.html');
      return;
    }
    var switchBtn = document.getElementById('switch-waiter');
    if (switchBtn) {
      switchBtn.classList.toggle('hidden', !data);
    }
    if (data) {
      window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
      hideLock();
      drawWaiterLine();
      ensureTerminal(false);
      startOrdersPoll();
    } else {
      stopOrdersPoll();
      (terminal ? api('/api/terminals/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminalId: terminal.id, all: true })
      }).catch(function () { return null; }) : Promise.resolve()).then(function () {
        if (window.PosNav) {
          window.PosNav.forget();
        }
        window.sessionStorage.removeItem('posWaiter');
      });
      drawWaiterLine();
      showLock();
    }
    if (window.PosNav) {
      window.PosNav.afterLogin(data);
    }
    if (typeof ctx.syncPaidReceiptsBtn === 'function') {
      ctx.syncPaidReceiptsBtn();
    }
    if (typeof ctx.syncLastReceiptBtn === 'function') {
      ctx.syncLastReceiptBtn();
    }
    if (typeof ctx.syncReceiptCopiesHint === 'function') {
      ctx.syncReceiptCopiesHint();
    }
  }

  function load() {
    if (!waiter) {
      return Promise.resolve();
    }
    return Promise.all([
      api('/api/layout'),
      api('/api/catalog'),
      api('/api/orders'),
      api('/api/waitlist').catch(function () { return { data: { items: [] } }; })
    ]).then(function (parts) {
      floors = parts[0].data.floors || [];
      rooms = parts[0].data.rooms || [];
      tables = parts[0].data.tables || [];
      groups = parts[1].data.groups || [];
      products = parts[1].data.products || [];
      stations = parts[1].data.stations || [];
      orders = parts[2].data.orders || [];
      reservations = parts[2].data.reservations || [];
      settings = parts[2].data.settings || { serviceChargePercent: 0, waiterBonuses: {} };
      locks = parts[2].data.locks || [];
      waitlist = (parts[3] && parts[3].data && parts[3].data.items) || [];
      seatedWait = (parts[3] && parts[3].data && parts[3].data.seated) || [];
      if (typeof ctx.syncReceiptCopiesHint === 'function') {
        ctx.syncReceiptCopiesHint();
      }
      if (window.PosNav && settings.opsMode) {
        window.PosNav.rememberOps(settings.opsMode);
      }
      if (!scaleHydrated) {
        scaleHydrated = true;
        if (settings.orderCardScale != null) {
          applyScale(settings.orderCardScale, false);
        } else {
          var localScale = storedScale();
          if (localScale != null) {
            applyScale(localScale, false);
          }
        }
      }
      if (!floorId && floors[0]) {
        floorId = floors[0].id;
      }
      if (floorId && floors.every(function (item) { return item.id !== floorId; })) {
        floorId = floors[0] ? floors[0].id : 0;
      }
      if (!groupId && groups[0]) {
        groupId = groups[0].id;
      }
      var low = parts[2].data.lowStock || [];
      if (!lowTold && low.length) {
        lowTold = true;
        say(low.length + ' xammal az qalıb: ' +
          low.slice(0, 6).map(function (row) { return row.name; }).join(', '), 'warn');
      }
      render();
      refreshShiftBadge();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function stopOrdersPoll() {
    if (ordersPollTimer) {
      window.clearInterval(ordersPollTimer);
      ordersPollTimer = 0;
    }
  }

  function startOrdersPoll() {
    stopOrdersPoll();
    if (!waiter) {
      return;
    }
    ordersPollTimer = window.setInterval(function () {
      if (document.visibilityState === 'hidden') {
        return;
      }
      refreshOrdersLight();
    }, ORDERS_POLL_MS);
  }

  function onOrdersVisible() {
    if (!waiter) {
      return;
    }
    refreshOrdersLight();
    startOrdersPoll();
  }

  function orderFootprint(order) {
    if (!order) {
      return '';
    }
    var items = order.items || [];
    var pays = order.payments || [];
    return [
      order.id,
      order.status,
      order.tableId,
      items.length,
      pays.length,
      order.discountType || '',
      order.discountValue || 0,
      items.map(function (it) {
        return (it.id || '') + ':' + (it.qty || 0) + ':' + (it.voided ? 1 : 0) + ':' + (it.sent ? 1 : 0);
      }).join(',')
    ].join('/');
  }

  function floorBusyFootprint() {
    return tables.map(function (t) {
      return t.id + ':' + tableState(t);
    }).join('|');
  }

  function patchLocalOrder(order) {
    if (!order || !order.id) {
      return;
    }
    var i = 0;
    for (i = 0; i < orders.length; i += 1) {
      if (orders[i].id === order.id) {
        orders[i] = order;
        return;
      }
    }
    orders.push(order);
  }

  function applyOrdersPayload(data) {
    orders = data.orders || [];
    reservations = data.reservations || [];
    if (data.settings) {
      settings = data.settings;
      if (window.PosNav && settings.opsMode) {
        window.PosNav.rememberOps(settings.opsMode);
      }
    }
    if (data.locks) {
      locks = data.locks;
    }
  }

  function refreshOrdersLight(opts) {
    var force = !!(opts && opts.force);
    if (!waiter) {
      return Promise.resolve();
    }
    if (!force && busy) {
      ordersPollWanted = true;
      return Promise.resolve();
    }
    if (ordersLightBusy) {
      return Promise.resolve();
    }
    ordersLightBusy = true;
    return Promise.all([
      api('/api/orders'),
      api('/api/waitlist').catch(function () { return { data: { items: [] } }; })
    ]).then(function (parts) {
      var data = (parts[0] && parts[0].data) || {};
      var prevFloor = floorBusyFootprint();
      var prevCheck = orderFootprint(openOrder());
      waitlist = (parts[1] && parts[1].data && parts[1].data.items) || [];
      seatedWait = (parts[1] && parts[1].data && parts[1].data.seated) || [];
      applyOrdersPayload(data);
      var low = data.lowStock || [];
      if (!lowTold && low.length) {
        lowTold = true;
        say(low.length + ' xammal az qalıb: ' +
          low.slice(0, 6).map(function (row) { return row.name; }).join(', '), 'warn');
      }
      if (typeof uiBlockedForBarcode === 'function' && uiBlockedForBarcode()) {
        return;
      }
      if (prevFloor !== floorBusyFootprint()) {
        renderFloor();
      }
      if (tableId && prevCheck !== orderFootprint(openOrder())) {
        renderCheck();
      }
      drawWaiterLine();
    }).catch(function () {
      return null;
    }).then(function () {
      ordersLightBusy = false;
      if (ordersPollWanted && !busy) {
        ordersPollWanted = false;
        return refreshOrdersLight();
      }
    });
  }

  function reservationFor(id) {
    return reservations.find(function (item) {
      return item.tableId === id && item.status === 'active';
    }) || null;
  }

  function bookingFor(id) {
    var list = reservations.filter(function (item) {
      return item.tableId === id && (item.status === 'active' || item.status === 'seated');
    });
    return list.length ? list[list.length - 1] : null;
  }

  function tableState(table) {
    var open = orders.some(function (item) {
      return coversTable(item, table.id);
    });
    if (open) {
      return 'busy';
    }
    if (seatedWait.some(function (row) { return Number(row.tableId) === table.id; })) {
      return 'busy';
    }
    if (reservationFor(table.id)) {
      return 'reserved';
    }
    return 'empty';
  }

  function renderServiceBoard() {
    var box = document.getElementById('service-board');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    var nowMs = Date.now();
    orders.filter(function (item) {
      return item.status === 'open' && (item.channel === 'takeaway' || item.channel === 'delivery' || Number(item.tableId) < 0);
    }).forEach(function (item) {
      var age = busyAgeParts(item, nowMs);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'table-tile busy'
        + (age.cls ? ' ' + age.cls : '')
        + (item.tableId === tableId ? ' selected' : '');
      var label = document.createElement('span');
      label.textContent = item.tableName || (item.channel === 'delivery' ? 'Çatdırılma' : 'Takeaway');
      var small = document.createElement('small');
      var base = item.guestName || (item.channel === 'delivery' ? 'Çatdırılma' : 'Takeaway');
      small.textContent = age.text ? (base + ' · ' + age.text) : base;
      btn.appendChild(label);
      btn.appendChild(small);
      var badge = document.createElement('span');
      badge.className = 'run-badge';
      badge.textContent = runStatusLabel(item.channel, runStatusOf(item));
      btn.appendChild(badge);
      btn.addEventListener('click', function () {
        if (!waiter) {
          showLock();
          return;
        }
        selectSeat(item.tableId).catch(function (error) {
          say(error.message, 'err');
        });
      });
      box.appendChild(btn);
    });
  }

  function renderFloor() {
    var tabs = document.getElementById('floor-tabs');
    var board = document.getElementById('table-board');
    tabs.innerHTML = '';
    board.innerHTML = '';
    renderServiceBoard();
    var nowMs = Date.now();
    floors.forEach(function (floor) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = floor.id === floorId ? 'active' : '';
      btn.textContent = floor.name;
      btn.addEventListener('click', function () {
        floorId = floor.id;
        renderFloor();
      });
      tabs.appendChild(btn);
    });

    var q = normalize(tableQuery);
    var list = rooms.filter(function (room) { return room.floorId === floorId; });
    var shown = 0;
    list.forEach(function (room) {
      var roomTables = tables.filter(function (item) {
        if (item.roomId !== room.id) {
          return false;
        }
        var state = tableState(item);
        if (tableFilter !== 'all' && state !== tableFilter) {
          return false;
        }
        if (!q) {
          return true;
        }
        return normalize(item.name).indexOf(q) !== -1
          || normalize(room.name).indexOf(q) !== -1
          || String(item.number).indexOf(q) !== -1;
      });
      if (!roomTables.length) {
        return;
      }
      shown += 1;
      var section = document.createElement('section');
      section.className = 'hall-section';
      var heading = document.createElement('h3');
      heading.textContent = room.name + ' · ' + roomTables.length;
      var grid = document.createElement('div');
      grid.className = 'table-grid';
      roomTables.forEach(function (table) {
        var state = tableState(table);
        var open = state === 'busy' ? openOrderForTable(table.id) : null;
        var age = open ? busyAgeParts(open, nowMs) : { cls: '', text: '' };
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'table-tile '
          + (table.shape === 'round' ? 'round ' : '')
          + state
          + (age.cls ? ' ' + age.cls : '')
          + (table.id === tableId ? ' selected' : '');
        var label = document.createElement('span');
        label.textContent = table.name || ('Masa ' + table.number);
        var hold = tableLock(table.id);
        var small = document.createElement('small');
        if (hold && terminal && hold.terminalId !== terminal.id) {
          small.textContent = hold.terminalName;
          btn.className += ' locked';
        } else {
          var linked = orders.some(function (item) {
            return item.status === 'open' && (item.linkedTableIds || []).indexOf(table.id) !== -1;
          });
          if (state === 'busy') {
            small.textContent = linked
              ? (age.text ? ('Birləşib · ' + age.text) : 'Birləşib')
              : (age.text || 'Hesab');
          } else if (state === 'reserved') {
            small.textContent = 'Rezerv';
          } else {
            small.textContent = table.capacity + ' nəfər';
          }
        }
        btn.appendChild(label);
        btn.appendChild(small);
        btn.addEventListener('click', function () {
          if (!waiter) {
            showLock();
            return;
          }
          if (!terminal) {
            say('Terminal seçin.', 'err');
            ensureTerminal(true);
            return;
          }
          var other = tableLock(table.id);
          if (other && other.terminalId !== terminal.id) {
            say('Bu masa ' + other.terminalName + '-dədir.', 'err');
            return;
          }
          selectSeat(table.id).catch(function (error) {
            say(error.message, 'err');
            return load();
          });
        });
        grid.appendChild(btn);
      });
      section.appendChild(heading);
      section.appendChild(grid);
      board.appendChild(section);
    });
    if (!shown) {
      board.innerHTML = '<p class="hint">Masa tapılmadı.</p>';
    }
  }

  function renderGroups() {
    var box = document.getElementById('group-tabs');
    box.innerHTML = '';
    var list = groups.filter(function (group) {
      return products.some(function (item) {
        return item.groupId === group.id && !item.blocked && !item.soldOut;
      });
    });
    if (list.length && list.every(function (group) { return group.id !== groupId; })) {
      groupId = list[0].id;
    }
    list.forEach(function (group) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = group.id === groupId && !searchQuery ? 'active' : '';
      btn.textContent = group.name;
      btn.addEventListener('click', function () {
        groupId = group.id;
        searchQuery = '';
        document.getElementById('order-search').value = '';
        renderProducts();
        renderGroups();
      });
      box.appendChild(btn);
    });
  }

  function visibleProducts() {
    var q = normalize(searchQuery);
    return products.filter(function (item) {
      if (item.blocked || item.soldOut) {
        return false;
      }
      if (q) {
        return normalize(item.name).indexOf(q) !== -1 ||
          normalize(item.barcode).indexOf(q) !== -1;
      }
      return item.groupId === groupId;
    });
  }

  function productByBarcode(raw) {
    var code = String(raw || '').replace(/[^0-9A-Za-z\-]/g, '');
    if (!code) {
      return null;
    }
    var hits = products.filter(function (item) {
      return !item.blocked && !item.soldOut &&
        String(item.barcode || '').toUpperCase() === code.toUpperCase();
    });
    return hits.length === 1 ? hits[0] : null;
  }

  function takeBarcodeHit(raw) {
    var hit = productByBarcode(raw);
    if (!hit) {
      return false;
    }
    addProduct(hit);
    searchQuery = '';
    var searchEl = el('order-search') || document.getElementById('order-search');
    if (searchEl) {
      searchEl.value = '';
    }
    renderGroups();
    renderProducts();
    maybeFocusBarcode(true);
    return true;
  }

  function renderFavRow() {
    var row = el('fav-row') || document.getElementById('fav-row');
    if (!row) {
      return;
    }
    row.innerHTML = '';
    var list = favoriteIds.map(function (id) {
      return products.find(function (p) {
        return Number(p.id) === Number(id) && !p.blocked && !p.soldOut;
      });
    }).filter(Boolean);
    if (!list.length) {
      row.classList.add('hidden');
      return;
    }
    row.classList.remove('hidden');
    list.forEach(function (item) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fav-chip';
      chip.textContent = item.name;
      chip.title = item.name;
      chip.addEventListener('click', function () {
        addProduct(item);
      });
      row.appendChild(chip);
    });
  }

  function bindFavLongPress(card, product) {
    var timer = 0;
    var moved = false;
    var didToggle = false;
    var added = false;
    var startX = 0;
    var startY = 0;
    function clear() {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    }
    function start(event) {
      moved = false;
      didToggle = false;
      added = false;
      startX = event.clientX;
      startY = event.clientY;
      clear();
      timer = window.setTimeout(function () {
        timer = 0;
        didToggle = true;
        toggleFavorite(product.id);
      }, 550);
    }
    card.addEventListener('pointerdown', function (event) {
      if (event.target && event.target.closest && event.target.closest('.fav-star')) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      start(event);
    });
    card.addEventListener('pointermove', function (event) {
      var dx = (event.clientX || 0) - startX;
      var dy = (event.clientY || 0) - startY;
      if (Math.hypot(dx, dy) >= 14) {
        moved = true;
        clear();
      }
    });
    card.addEventListener('pointerup', function (event) {
      clear();
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (didToggle || moved || added) {
        return;
      }
      if (event.target && event.target.closest && event.target.closest('.fav-star')) {
        return;
      }
      added = true;
      addProduct(product);
    });
    card.addEventListener('pointercancel', clear);
    card.addEventListener('pointerleave', clear);
    card.addEventListener('click', function (event) {
      if (didToggle || added || moved) {
        event.preventDefault();
        event.stopPropagation();
        didToggle = false;
        return;
      }
      addProduct(product);
    });
  }

  function renderProducts() {
    var grid = document.getElementById('product-grid');
    grid.setAttribute('data-scale', String(cardScale));
    grid.innerHTML = '';
    var list = visibleProducts();
    if (!list.length) {
      grid.innerHTML = '<div class="empty-card">Məhsul yoxdur.</div>';
      return;
    }
    list.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'order-card';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.innerHTML = '<button type="button" class="fav-star" aria-label="Favorit">★</button>' +
        '<div class="photo"></div><div class="body"><h3></h3><p class="price"></p></div>';
      var star = card.querySelector('.fav-star');
      if (star) {
        star.classList.toggle('on', isFavorite(item.id));
        star.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          toggleFavorite(item.id);
        });
      }
      var photo = card.querySelector('.photo');
      var group = groups.find(function (row) { return row.id === item.groupId; });
      if (item.image) {
        var img = document.createElement('img');
        img.src = item.image;
        img.alt = item.name;
        img.onerror = function () {
          if (window.PosGroupIcons) {
            window.PosGroupIcons.mount(photo, group || '');
          }
        };
        photo.appendChild(img);
      } else if (window.PosGroupIcons) {
        window.PosGroupIcons.mount(photo, group || '');
      }
      card.querySelector('h3').textContent = item.name + (item.allergens ? ' ⚠' : '');
      card.title = item.allergens || item.name;
      card.querySelector('.price').textContent = Number(livePrice(item)).toFixed(2) + ' AZN' +
        (hasOptions(item) ? ' · seçim' : '');
      bindFavLongPress(card, item);
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          addProduct(item);
        }
      });
      grid.appendChild(card);
    });
  }

  function addProduct(product) {
    if (!tableId) {
      say('Əvvəlcə masa seçin.', 'err');
      return;
    }
    if (hasOptions(product)) {
      openOptions(product);
      return;
    }
    pushPending(product, livePrice(product), 0, [], '');
  }

  function salePriceNow(product) {
    var base = Number(product && product.salePrice) || 0;
    var happy = Number(product && product.happyPrice);
    if (!Number.isFinite(happy) || happy < 0 || happy > 10000) {
      return Number(base.toFixed(2));
    }
    var from = Number(product && product.happyFrom);
    var to = Number(product && product.happyTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      return Number(base.toFixed(2));
    }
    var now = new Date();
    var h = now.getHours() + now.getMinutes() / 60;
    var inRange = from <= to ? (h >= from && h < to) : (h >= from || h < to);
    return Number((inRange ? happy : base).toFixed(2));
  }

  function livePrice(product) {
    if (product && product.nowPrice != null && Number.isFinite(Number(product.nowPrice))) {
      return Number(Number(product.nowPrice).toFixed(2));
    }
    return salePriceNow(product);
  }

  function hasOptions(product) {
    return !!(product.portions && product.portions.length) || !!(product.extras && product.extras.length);
  }

  function choiceKey(portionId, extraIds, note) {
    return String(portionId || 0) + '|' + (extraIds || []).slice().sort(function (a, b) {
      return a - b;
    }).join(',') + '|' + (note || '');
  }

  function linePrice(product, portionId, extraIds) {
    var portion = (product.portions || []).find(function (row) {
      return Number(row.id) === Number(portionId);
    });
    var sum = portion ? (Number(portion.price) || 0) : livePrice(product);
    (extraIds || []).forEach(function (id) {
      var extra = (product.extras || []).find(function (row) {
        return Number(row.id) === Number(id);
      });
      if (extra) {
        sum += Number(extra.price) || 0;
      }
    });
    return Number(sum.toFixed(2));
  }

  function courseOf(product) {
    if (product && (product.course === 0 || product.course === '0')) {
      return 0;
    }
    var n = Number(product && product.course);
    if (n === 1 || n === 2) {
      return n;
    }
    if (Number(product && product.stationId) === 3) {
      return 0;
    }
    return 2;
  }

  function courseLabel(course) {
    if (course === 1) {
      return 'Soyuq';
    }
    if (course === 2) {
      return 'İsti';
    }
    return 'Dərhal';
  }

  function markNames(product, portionId, extraIds) {
    var names = [];
    if (product.portions) {
    var portion = (product.portions || []).find(function (row) {
      return Number(row.id) === Number(portionId);
    });
      if (portion) {
        names.push(portion.name);
      }
    }
    (extraIds || []).forEach(function (id) {
      var extra = (product.extras || []).find(function (row) { return row.id === id; });
      if (extra) {
        names.push(extra.name);
      }
    });
    return names;
  }

  function lineNote(item) {
    var names = (item.modifiers || []).map(function (row) { return row.name; });
    if (!names.length && item.mark) {
      names = String(item.mark).split(', ');
    }
    if (item.note) {
      names.push(item.note);
    }
    if (item.allergens) {
      names.push(item.allergens);
    }
    return names.join(', ');
  }

  function pushPending(product, salePrice, portionId, extraIds, note) {
    var key = choiceKey(portionId, extraIds, note);
    var row = pending.find(function (item) {
      return item.productId === product.id && item.choiceKey === key;
    });
    if (row) {
      row.qty += 1;
    } else {
      pending.push({
        productId: product.id,
        name: product.name,
        qty: 1,
        salePrice: salePrice,
        basePrice: salePrice,
        stationId: product.stationId,
        note: note || '',
        portionId: portionId || 0,
        extraIds: extraIds || [],
        choiceKey: key,
        complimentary: false,
        course: courseOf(product),
        modifiers: markNames(product, portionId, extraIds).map(function (name) {
          return { name: name };
        })
      });
    }
    renderCheck();
  }

  function openOptions(product) {
    optionProduct = product;
    optionPortionId = product.portions && product.portions[0] ? product.portions[0].id : 0;
    optionExtraIds = [];
    setText('option-title', product.name);
    setText('option-base', 'Satış: ' + Number(livePrice(product)).toFixed(2) + ' AZN');
    var portionBox = el('option-portions');
    if (!portionBox) {
      return;
    }
    portionBox.innerHTML = '';
    (product.portions || []).forEach(function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt-chip' + (row.id === optionPortionId ? ' active' : '');
      btn.textContent = row.name + ' ' + (Number(row.price) || 0).toFixed(2);
      btn.addEventListener('click', function () {
        optionPortionId = row.id;
        drawOptionChips();
      });
      portionBox.appendChild(btn);
    });
    var extraBox = el('option-extras');
    if (!extraBox) {
      return;
    }
    extraBox.innerHTML = '';
    (product.extras || []).forEach(function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt-chip';
      btn.textContent = row.name + (Number(row.price) ? ' +' + Number(row.price).toFixed(2) : '');
      btn.addEventListener('click', function () {
        var at = optionExtraIds.indexOf(row.id);
        if (at === -1) {
          optionExtraIds.push(row.id);
        } else {
          optionExtraIds.splice(at, 1);
        }
        drawOptionChips();
      });
      extraBox.appendChild(btn);
    });
    drawOptionChips();
    var modal = el('option-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function drawOptionChips() {
    if (!optionProduct) {
      return;
    }
    var portionBtns = document.querySelectorAll('#option-portions .opt-chip');
    (optionProduct.portions || []).forEach(function (row, i) {
      if (portionBtns[i]) {
        portionBtns[i].classList.toggle('active', Number(row.id) === Number(optionPortionId));
      }
    });
    var extraBtns = document.querySelectorAll('#option-extras .opt-chip');
    (optionProduct.extras || []).forEach(function (row, i) {
      if (extraBtns[i]) {
        extraBtns[i].classList.toggle('active', optionExtraIds.indexOf(row.id) !== -1);
      }
    });
    setText('option-sum',
      linePrice(optionProduct, optionPortionId, optionExtraIds).toFixed(2) + ' AZN');
  }

  function closeOptions() {
    document.getElementById('option-modal').classList.add('hidden');
    optionProduct = null;
  }

  function checkTitle(order, table) {
    if (tableId === -1) {
      return 'Takeaway';
    }
    if (tableId === -2) {
      return 'Yeni çatdırılma';
    }
    if (order && (order.channel === 'takeaway' || order.channel === 'delivery')) {
      return order.tableName || (order.channel === 'delivery' ? 'Çatdırılma' : 'Takeaway');
    }
    if (order && (order.linkedTableIds || []).length) {
      var names = [order.tableName || (table && (table.name || ('Masa ' + table.number)))];
      (order.linkedTableIds || []).forEach(function (id) {
        var row = tableById(id);
        names.push(row ? (row.name || ('Masa ' + row.number)) : ('#' + id));
      });
      return names.join(' + ');
    }
    return table ? (table.name || ('Masa ' + table.number)) : 'Masa seçin';
  }

  function runStatusOf(order) {
    if (!order) {
      return '';
    }
    if (order.channel === 'delivery' || order.channel === 'takeaway') {
      return order.runStatus || 'prep';
    }
    return '';
  }

  function runStatusLabel(channel, status) {
    if (channel === 'delivery') {
      if (status === 'way') {
        return 'Yolda';
      }
      if (status === 'done') {
        return 'Çatdı';
      }
      return 'Mətbəxdə';
    }
    if (channel === 'takeaway') {
      if (status === 'ready') {
        return 'Hazır';
      }
      if (status === 'done') {
        return 'Verildi';
      }
      return 'Mətbəxdə';
    }
    return '';
  }

  function renderRunStatus(order) {
    var box = document.getElementById('run-status');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    var ch = order && order.channel;
    var show = !!(order && (ch === 'delivery' || ch === 'takeaway'));
    box.classList.toggle('hidden', !show);
    if (!show) {
      return;
    }
    var cur = runStatusOf(order);
    var steps = ch === 'delivery'
      ? [{ id: 'prep', name: 'Mətbəxdə' }, { id: 'way', name: 'Yolda' }, { id: 'done', name: 'Çatdı' }]
      : [{ id: 'prep', name: 'Mətbəxdə' }, { id: 'ready', name: 'Hazır' }, { id: 'done', name: 'Verildi' }];
    steps.forEach(function (step) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = step.name;
      btn.className = step.id === cur ? 'active' : '';
      btn.addEventListener('click', function () {
        if (step.id === cur) {
          return;
        }
        runAction('/api/orders/run-status', { orderId: order.id, runStatus: step.id });
      });
      box.appendChild(btn);
    });
  }

  function renderCheck() {
    var table = tableById(tableId);
    var order = openOrder();
    var hasSeat = !!table || isServiceId(tableId);
    setText('check-table', checkTitle(order, table));
    var guestsBox = el('order-guests');
    var orderGuests = order ? Number(order.guests) || 0 : pendingGuests;
    if (!hasSeat) {
      pendingGuests = 0;
      orderGuests = 0;
    } else if (order) {
      pendingGuests = orderGuests;
    }
    if (guestsBox) {
      guestsBox.disabled = !hasSeat;
    }
    var svc = el('service-guest');
    var showSvc = isServiceId(tableId) || !!(order && (order.channel === 'takeaway' || order.channel === 'delivery'));
    if (svc) {
      svc.classList.toggle('hidden', !showSvc);
    }
    if (showSvc) {
      var nameBox = el('order-guest-name');
      var phoneBox = el('order-guest-phone');
      if (nameBox && document.activeElement !== nameBox) {
        setVal('order-guest-name', order ? (order.guestName || pendingGuestName) : pendingGuestName);
      }
      if (phoneBox && document.activeElement !== phoneBox) {
        setVal('order-guest-phone', order ? (order.guestPhone || pendingGuestPhone) : pendingGuestPhone);
      }
      var isDeliv = tableId === -2 || tableId <= -2000 ||
        !!(order && order.channel === 'delivery');
      document.querySelectorAll('.svc-deliv').forEach(function (node) {
        node.classList.toggle('hidden', !isDeliv);
      });
      if (isDeliv) {
        var addr = el('order-guest-address');
        var cour = el('order-courier');
        if (addr && document.activeElement !== addr) {
          setVal('order-guest-address', order ? (order.guestAddress || pendingGuestAddress) : pendingGuestAddress);
        }
        if (cour && document.activeElement !== cour) {
          setVal('order-courier', order ? (order.courierName || pendingCourier) : pendingCourier);
        }
      }
    }
    renderRunStatus(order);
    if (guestsBox && document.activeElement !== guestsBox) {
      setVal('order-guests', String(orderGuests));
    }
    var booked = table ? bookingFor(table.id) : null;
    var prepaidText = booked && booked.prepay
      ? (' • İlkin: ' + Number(booked.prepay.total).toFixed(2) + ' AZN')
      : '';
    setText('reserve-info', booked
      ? (booked.name + ' • ' + booked.guests + ' nəfər • ' + String(booked.at).replace('T', ' ') + prepaidText)
      : '');
    var state = table ? tableState(table) : 'empty';
    var reserveBtn = el('reserve-table');
    if (reserveBtn) {
      reserveBtn.style.display = table && state === 'empty' ? '' : 'none';
    }
    var cancelRes = el('cancel-reserve');
    if (cancelRes) {
      cancelRes.style.display = table && state === 'reserved' ? '' : 'none';
    }
    var prepayOpen = el('prepay-open');
    if (prepayOpen) {
      prepayOpen.style.display =
        booked && can('payments.take') && (state === 'reserved' || state === 'busy') ? '' : 'none';
    }
    var canPay = !!(order && can('payments.take'));
    var payOpen = el('pay-open');
    if (payOpen) {
      payOpen.style.display = canPay ? '' : 'none';
    }
    var reprintOrder = el('reprint-order');
    if (reprintOrder) {
      reprintOrder.style.display = order && order.items && order.items.length ? '' : 'none';
    }
    var discountOpen = el('discount-open');
    if (discountOpen) {
      discountOpen.style.display =
        order && can('orders.discount') && !(order.payments && order.payments.length) ? '' : 'none';
    }
    var moveOpen = el('move-open');
    if (moveOpen) {
      moveOpen.style.display =
        order && !(order.linkedTableIds || []).length &&
        (table || order.channel === 'takeaway' || order.channel === 'delivery' ||
          (Number(order.tableId) < 0 && !isDraftSeat(order.tableId))) &&
        (can('orders.move') || can('orders.create')) ? '' : 'none';
    }
    var held = !!(order && (order.items || []).some(function (item) {
      return !item.voided && !item.sent;
    }));
    var fireBtn = el('fire-course');
    var autoAll = settings.autoSendAllOnAccept !== false;
    if (fireBtn) {
      if (autoAll) {
        fireBtn.style.display = 'none';
        fireBtn.disabled = true;
        fireBtn.title = 'Qəbulda bütün kurslar mətbəxə gedir.';
      } else {
        fireBtn.disabled = false;
        fireBtn.title = '';
        fireBtn.style.display = held && can('orders.create') ? '' : 'none';
      }
    }
    var handoffOpen = el('handoff-open');
    if (handoffOpen) {
      handoffOpen.style.display = order && can('orders.create') ? '' : 'none';
    }
    var mergeOpen = el('merge-open');
    if (mergeOpen) {
      mergeOpen.style.display = order && table && can('orders.create') ? '' : 'none';
    }
    var unmergeOpen = el('unmerge-open');
    if (unmergeOpen) {
      unmergeOpen.style.display =
        order && (order.linkedTableIds || []).length && can('orders.create') ? '' : 'none';
    }

    if (!tableId) {
      setText('check-hint', 'Masa seçin.');
    } else if (pending.length) {
      setText('check-hint', 'Qəbul et: ' + pending.length + ' sətir.');
    } else {
      setText('check-hint', '');
    }

    var box = el('check-list');
    if (!box) {
      return;
    }
    box.textContent = '';
    var sent = order ? order.items : [];
    if (!sent.length && !pending.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = tableId ? 'Məhsula basın.' : 'Masa seçin.';
      box.appendChild(empty);
    }

    sent.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'check-row' + (item.voided ? ' voided' : '') + (item.settled ? ' settled' : '');
      row.innerHTML = '<div><p class="name"></p><p class="note"></p><p class="sent"></p></div><div class="qty"></div>';
      row.querySelector('.name').textContent = item.qty + '× ' + item.name;
      row.querySelector('.note').textContent = lineNote(item);
      row.querySelector('.sent').textContent = item.voided
        ? ('Ləğv: ' + (item.voidedBy || ''))
        : (item.settled
          ? 'Ödənildi'
          : ((item.sent ? 'Göndərildi' : 'Gözləyir • ' + courseLabel(item.course)) +
            (item.complimentary ? ' • Pulsuz' : '') +
            (item.waiterName ? ' • ' + item.waiterName : '')));
      if (!item.voided && !item.settled) {
        var actions = row.querySelector('.qty');
        if (item.sent && can('orders.create')) {
          var reprintBtn = document.createElement('button');
          reprintBtn.type = 'button';
          reprintBtn.textContent = 'Çap';
          reprintBtn.addEventListener('click', function () {
            runAction('/api/orders/reprint', { orderId: order.id, itemId: item.id }, 'Təkrar çap göndərilsin?');
          });
          actions.appendChild(reprintBtn);
        }
        if (can('orders.void') && !(order.payments && order.payments.length)) {
          var voidBtn = document.createElement('button');
          voidBtn.type = 'button';
          voidBtn.textContent = 'Ləğv';
          voidBtn.addEventListener('click', function () {
            runAction('/api/orders/void', { orderId: order.id, itemId: item.id }, '"' + item.name + '" ləğv edilsin və stansiyaya getsin?');
          });
          actions.appendChild(voidBtn);
        }
        if (can('orders.discount') && !item.complimentary && !(order.payments && order.payments.length)) {
          var compBtn = document.createElement('button');
          compBtn.type = 'button';
          compBtn.textContent = 'Pulsuz';
          compBtn.addEventListener('click', function () {
            runAction('/api/orders/comp', { orderId: order.id, itemId: item.id }, '"' + item.name + '" pulsuz olsun?');
          });
          actions.appendChild(compBtn);
        }
      }
      box.appendChild(row);
    });

    pending.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'check-row';
      row.innerHTML =
        '<div><p class="name"></p><p class="note"></p></div>' +
        '<div class="qty"><button type="button" data-act="minus">−</button>' +
        '<span></span><button type="button" data-act="plus">+</button>' +
        '<button type="button" data-act="note">Qeyd</button></div>';
      row.querySelector('.name').textContent = item.name + (item.complimentary ? ' • pulsuz' : '');
      row.querySelector('.note').textContent = lineNote(item) || courseLabel(item.course);
      row.querySelector('span').textContent = String(item.qty);
      row.querySelector('[data-act="minus"]').addEventListener('click', function () {
        item.qty -= 1;
        if (item.qty < 1) {
          pending.splice(index, 1);
        }
        renderCheck();
      });
      row.querySelector('[data-act="plus"]').addEventListener('click', function () {
        item.qty += 1;
        renderCheck();
      });
      row.querySelector('[data-act="note"]').addEventListener('click', function () {
        var note = window.prompt('Qeyd', item.note || '');
        if (note == null) {
          return;
        }
        item.note = note.trim().slice(0, 80);
        item.choiceKey = choiceKey(item.portionId, item.extraIds, item.note);
        renderCheck();
      });
      if (can('orders.discount')) {
        var compBtn = document.createElement('button');
        compBtn.type = 'button';
        compBtn.setAttribute('data-act', 'comp');
        compBtn.textContent = 'Pulsuz';
        compBtn.addEventListener('click', function () {
          item.complimentary = !item.complimentary;
          item.salePrice = item.complimentary ? 0 : (item.basePrice || item.salePrice);
          renderCheck();
        });
        row.querySelector('.qty').appendChild(compBtn);
      }
      box.appendChild(row);
    });

    order = openOrder();
    var view = {
      items: sent.concat(pending),
      discount: order && order.discount,
      tipAmount: order && order.tipAmount
    };
    var parts = billAfter(view);
    setText('check-items', parts.items.toFixed(2) + ' AZN');
    var discRow = el('check-discount-row');
    if (parts.off > 0) {
      if (discRow) {
        discRow.classList.remove('hidden');
      }
      setText('check-discount-label',
        'Endirim' + (order && order.discount && order.discount.type === 'percent' ? ' (' + order.discount.value + '%)' : ''));
      setText('check-discount', '-' + parts.off.toFixed(2) + ' AZN');
    } else if (discRow) {
      discRow.classList.add('hidden');
    }
    setText('check-service', parts.service.toFixed(2) + ' AZN');
    setText('check-service-label',
      'Xidmət' + (settings.serviceChargePercent ? ' (' + settings.serviceChargePercent + '%)' : ''));
    var serviceRow = el('check-service-row');
    if (serviceRow) {
      serviceRow.style.display = '';
    }
    var tipRow = el('check-tip-row');
    if (parts.tip > 0) {
      if (tipRow) {
        tipRow.classList.remove('hidden');
      }
      setText('check-tip', parts.tip.toFixed(2) + ' AZN');
    } else if (tipRow) {
      tipRow.classList.add('hidden');
    }
    setText('check-total', parts.total.toFixed(2) + ' AZN');
  }

  function render() {
    renderFloor();
    renderGroups();
    renderFavRow();
    renderProducts();
    renderCheck();
  }

  function uiBlockedForBarcode() {
    if (document.querySelector('.modal:not(.hidden)')) {
      return true;
    }
    if (document.querySelector('.pos-ask:not(.hidden)')) {
      return true;
    }
    var pin = el('pin-lock') || document.getElementById('pin-lock');
    if (pin && !pin.classList.contains('hidden')) {
      return true;
    }
    var term = el('terminal-lock') || document.getElementById('terminal-lock');
    if (term && !term.classList.contains('hidden')) {
      return true;
    }
    return false;
  }

  function maybeFocusBarcode(force) {
    if (!force) {
      var page = document.querySelector('.order-page');
      var zone = page && page.getAttribute('data-zone');
      if (zone && zone !== 'menu') {
        return;
      }
    }
    if (!tableId || !waiter) {
      return;
    }
    if (uiBlockedForBarcode()) {
      return;
    }
    var searchEl = el('order-search') || document.getElementById('order-search');
    if (!searchEl) {
      return;
    }
    window.setTimeout(function () {
      if (uiBlockedForBarcode()) {
        return;
      }
      searchEl.focus();
      if (searchEl.select) {
        searchEl.select();
      }
    }, 30);
  }

  document.getElementById('table-search').addEventListener('input', function (event) {
    tableQuery = event.target.value;
    renderFloor();
  });
  document.getElementById('table-filters').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-filter]');
    if (!btn) {
      return;
    }
    tableFilter = btn.getAttribute('data-filter');
    document.querySelectorAll('#table-filters button').forEach(function (item) {
      item.className = item === btn ? 'active' : '';
    });
    renderFloor();
  });

  document.getElementById('order-search').addEventListener('input', function (event) {
    searchQuery = event.target.value;
    var code = String(searchQuery || '').replace(/[^0-9A-Za-z\-]/g, '');
    if (code.length >= 4 && takeBarcodeHit(searchQuery)) {
      return;
    }
    renderGroups();
    renderProducts();
  });
  document.getElementById('order-search').addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (takeBarcodeHit(event.target.value)) {
      return;
    }
    var hits = visibleProducts();
    if (hits.length === 1) {
      addProduct(hits[0]);
      searchQuery = '';
      event.target.value = '';
      renderGroups();
      renderProducts();
    }
  });
  var searchFocus = document.getElementById('search-focus');
  if (searchFocus) {
    searchFocus.addEventListener('click', function () {
      document.getElementById('order-search').focus();
    });
  }
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/') {
      return;
    }
    var t = event.target;
    var tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) {
      return;
    }
    if (uiBlockedForBarcode()) {
      return;
    }
    event.preventDefault();
    var searchEl = el('order-search') || document.getElementById('order-search');
    if (searchEl) {
      searchEl.focus();
      if (searchEl.select) {
        searchEl.select();
      }
    }
  });

  function runAction(url, extra, question) {
    if (busy || !waiter) {
      return;
    }
    function go() {
      extra.waiterId = waiter.user.id;
      extra.terminalId = terminal ? terminal.id : 0;
      busy = true;
      api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extra)
      }).then(function (body) {
        var warns = (body.data && body.data.warnings) || [];
        say(warns.length ? warns.join(' ') : 'Hazırdır.');
        return load();
      }).catch(function (error) {
        say(error.message, 'err');
      }).then(function () {
        busy = false;
      });
    }
    if (!question) {
      go();
      return;
    }
    window.askYes('Təsdiq', question).then(function (ok) {
      if (ok) {
        go();
      }
    });
  }

  function tryLogin(clearOnFail) {
    if (pinBuffer.length < 4) {
      return;
    }
    api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinBuffer })
    }).then(function (body) {
      var perms = (body.data && body.data.permissions) || [];
      if (switching && perms.indexOf('orders.create') === -1) {
        document.getElementById('pin-error').textContent = 'Bu PIN ilə sifarişə girilməz.';
        pinBuffer = '';
        drawPin();
        return;
      }
      if (switching && waiter && window.PosNav) {
        window.PosNav.forget();
      }
      document.getElementById('pin-error').textContent = '';
      body.data.fromLogin = true;
      setWaiter(body.data);
      finishSwitch();
      pinBuffer = '';
      drawPin();
      return load();
    }).catch(function (error) {
      document.getElementById('pin-error').textContent = error.message;
      if (clearOnFail || pinBuffer.length >= 8) {
        pinBuffer = '';
        drawPin();
      }
    });
  }

  var pad = document.getElementById('pin-pad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].forEach(function (key) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = key;
    btn.addEventListener('click', function () {
      if (key === 'C') {
        pinBuffer = '';
      } else if (key === 'OK') {
        tryLogin(true);
        return;
      } else if (pinBuffer.length < 8) {
        pinBuffer += key;
      }
      drawPin();
      if (pinBuffer.length >= 6 && key !== 'C') {
        tryLogin(false);
      }
    });
    pad.appendChild(btn);
  });

  document.getElementById('logout').addEventListener('click', function () {
    switching = false;
    setWaiter(null);
  });

  document.getElementById('switch-waiter').addEventListener('click', startSwitch);
  document.getElementById('pin-switch-back').addEventListener('click', cancelSwitch);

  document.getElementById('switch-terminal').addEventListener('click', function () {
    ensureTerminal(true);
  });
  pingTimer = window.setInterval(function () {
    if (!waiter || !terminal || !tableId || isDraftSeat(tableId)) {
      return;
    }
    api('/api/terminals/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalId: terminal.id, tableId: tableId })
    }).then(function (body) {
      locks = (body.data && body.data.locks) || locks;
    }).catch(function (error) {
      say(error && error.message ? error.message : 'Masa kilidi itdi.', 'err');
    });
  }, 20000);

  document.getElementById('option-cancel').addEventListener('click', closeOptions);
  document.getElementById('option-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!optionProduct) {
      return;
    }
    if (optionProduct.portions && optionProduct.portions.length && !optionPortionId) {
      say('Porsiya seçin.', 'err');
      return;
    }
    var product = optionProduct;
    var price = linePrice(product, optionPortionId, optionExtraIds);
    pushPending(product, price, optionPortionId, optionExtraIds.slice(), '');
    closeOptions();
  });

  document.getElementById('reprint-order').addEventListener('click', function () {
    var order = openOrder();
    if (!order) {
      say('Açıq sifariş yoxdur.', 'err');
      return;
    }
    if (!can('orders.create')) {
      say('Çapa icazəniz yoxdur.', 'err');
      return;
    }
    runAction('/api/orders/reprint', { orderId: order.id }, 'Bütün göndərilmiş sətirlər təkrar çap olunsun?');
  });

  document.getElementById('accept-order').addEventListener('click', function () {
    if (busy) {
      return;
    }
    if (!can('orders.create')) {
      say('Sifariş yazmağa icazəniz yoxdur.', 'err');
      return;
    }
    if (!tableId) {
      say('Əvvəlcə masa seçin.', 'err');
      return;
    }
    if (!terminal) {
      say('Terminal seçin.', 'err');
      ensureTerminal(true);
      return;
    }
    if (!pending.length) {
      say('Əlavə edilən məhsul yoxdur.', 'err');
      return;
    }
    if (!waiter) {
      showLock();
      return;
    }
    window.askYes('Qəbul', 'Sifariş qəbul edilsin və stansiyalara göndərilsin?').then(function (ok) {
      if (!ok) {
        return;
      }
      return postAccept();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  function postAccept() {
    busy = true;
    say('Göndərilir...', 'warn');
    return api('/api/orders/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId: tableId,
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0,
        guests: pendingGuests,
        guestName: pendingGuestName,
        guestPhone: pendingGuestPhone,
        guestAddress: pendingGuestAddress,
        courierName: pendingCourier,
        items: pending.map(function (item) {
          return {
            productId: item.productId,
            qty: item.qty,
            note: item.note,
            portionId: item.portionId,
            extraIds: item.extraIds,
            course: item.course,
            complimentary: item.complimentary,
            salePrice: item.salePrice
          };
        })
      })
    }).then(function (body) {
      pending = [];
      if (body.data && body.data.order && body.data.order.tableId) {
        tableId = body.data.order.tableId;
      }
      clearPendingGuests(tableId);
      var warns = (body.data && body.data.warnings) || [];
      say(warns.length ? warns.join(' ') : 'Sifariş qəbul olundu.');
      function afterAcceptUi() {
        if (isWaiterMode()) {
          setOrderZone('check');
        }
        return body;
      }
      var accepted = body.data && body.data.order;
      if (accepted) {
        patchLocalOrder(accepted);
        var needLayout = accepted.tableId && !isServiceId(accepted.tableId) && !tableById(accepted.tableId);
        if (needLayout) {
          return load().then(afterAcceptUi);
        }
        return refreshOrdersLight({ force: true }).then(afterAcceptUi);
      }
      return load().then(afterAcceptUi);
    }).then(function (body) {
      busy = false;
      return body;
    }, function (error) {
      busy = false;
      throw error;
    });
  }

  function lineMinor(item) {
    return M.mulQty(M.toMinor(item && item.salePrice), item && item.qty);
  }

  function sumItemsMinor(items) {
    var total = 0;
    (items || []).forEach(function (item) {
      if (!item.voided) {
        total = M.addMinor(total, lineMinor(item));
      }
    });
    return total;
  }

  function serviceOfMinor(afterM) {
    var pct = Number(settings.serviceChargePercent) || 0;
    return Math.round(afterM * pct / 100);
  }

  function serviceOf(items) {
    return M.fromMinor(serviceOfMinor(M.toMinor(items)));
  }

  function billItemsMinor(order) {
    return sumItemsMinor(order && order.items);
  }

  function billItems(order) {
    return M.fromMinor(billItemsMinor(order));
  }

  function discountOffMinor(order, itemsM) {
    var d = order && order.discount;
    if (!d || d.cleared) {
      return 0;
    }
    if (d.type === 'percent') {
      var pct = M.parseDec(d.value);
      if (!Number.isFinite(pct)) {
        pct = 0;
      }
      pct = Math.min(100, Math.max(0, pct));
      return Math.round(itemsM * pct / 100);
    }
    var amt = M.toMinor(d.value != null ? d.value : d.amount);
    return Math.min(itemsM, Math.max(0, amt));
  }

  function discountOff(order, items) {
    return M.fromMinor(discountOffMinor(order, M.toMinor(items)));
  }

  function billAfter(order) {
    var itemsM = billItemsMinor(order);
    var offM = discountOffMinor(order, itemsM);
    var afterM = Math.max(0, M.subMinor(itemsM, offM));
    var serviceM = serviceOfMinor(afterM);
    var tipM = M.toMinor(order && order.tipAmount);
    return {
      items: M.fromMinor(itemsM),
      off: M.fromMinor(offM),
      after: M.fromMinor(afterM),
      service: M.fromMinor(serviceM),
      tip: M.fromMinor(tipM),
      total: M.fromMinor(M.addMinor(M.addMinor(afterM, serviceM), tipM))
    };
  }

  function paidSharesMinor(order) {
    var sum = 0;
    (order && order.payments || []).forEach(function (row) {
      sum = M.addMinor(sum, M.toMinor(row.cashAmount));
      sum = M.addMinor(sum, M.toMinor(row.cardAmount));
      sum = M.addMinor(sum, M.toMinor(row.giftAmount));
      sum = M.addMinor(sum, M.toMinor(row.loyaltyAmount));
    });
    return sum;
  }

  function paidShares(order) {
    return M.fromMinor(paidSharesMinor(order));
  }

  function billTotal(order) {
    return billAfter(order).total;
  }

  function tableTitle(id) {
    var t = tables.find(function (row) { return row.id === Number(id); });
    return t && t.name ? t.name : ('Masa ' + id);
  }

  function openLines(order) {
    return (order.items || []).filter(function (item) {
      return !item.voided && !item.settled;
    });
  }

  document.getElementById('move-open').addEventListener('click', function () {
    var order = openOrder();
    if (!order) {
      say('Açıq hesab yoxdur.', 'err');
      return;
    }
    if (!(can('orders.move') || can('orders.create'))) {
      say('Köçürməyə icazəniz yoxdur.', 'err');
      return;
    }
    var box = el('move-table');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    tables.filter(function (table) {
      return table.id !== tableId && tableState(table) === 'empty';
    }).forEach(function (table) {
      var room = rooms.find(function (item) { return item.id === table.roomId; });
      var opt = document.createElement('option');
      opt.value = String(table.id);
      opt.textContent = (table.name || ('Masa ' + table.number)) + (room ? ' • ' + room.name : '');
      box.appendChild(opt);
    });
    if (!box.options.length) {
      say('Boş masa yoxdur.', 'err');
      return;
    }
    var modal = el('move-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  });
  document.getElementById('cancel-move').addEventListener('click', function () {
    var modal = el('move-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  });
  document.getElementById('fire-course').addEventListener('click', function () {
    var order = openOrder();
    if (!order) {
      return;
    }
    runAction('/api/orders/fire', { orderId: order.id, course: 2 }, 'İsti kurs mətbəxə göndərilsin?');
  });
  document.getElementById('handoff-open').addEventListener('click', function () {
    if (!openOrder()) {
      say('Açıq hesab yoxdur.', 'err');
      return;
    }
    setVal('handoff-pin', '');
    var modal = el('handoff-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  });
  document.getElementById('cancel-handoff').addEventListener('click', function () {
    var modal = el('handoff-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  });
  document.getElementById('handoff-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var order = openOrder();
    var pin = document.getElementById('handoff-pin').value;
    if (!order || !pin) {
      return;
    }
    api('/api/orders/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        pin: pin,
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0
      })
    }).then(function (body) {
      document.getElementById('handoff-modal').classList.add('hidden');
      say('Hesab ' + ((body.data && body.data.order && body.data.order.waiterName) || '') + ' adına keçdi.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('move-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var order = openOrder();
    var destId = Number(document.getElementById('move-table').value);
    if (!order || !waiter || !destId) {
      return;
    }
    api('/api/orders/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(terminalPayload({
        orderId: order.id,
        tableId: destId
      }))
    }).then(function (body) {
      document.getElementById('move-modal').classList.add('hidden');
      tableId = destId;
      var warns = (body.data && body.data.warnings) || [];
      say(warns.length ? warns.join(' ') : 'Hesab köçürüldü.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('discount-open').addEventListener('click', function () {
    var order = openOrder();
    if (!order) {
      say('Açıq hesab yoxdur.', 'err');
      return;
    }
    if (!can('orders.discount')) {
      say('Endirimə icazəniz yoxdur.', 'err');
      return;
    }
    setVal('discount-type', (order.discount && order.discount.type) || 'percent');
    setVal('discount-value', order.discount ? String(order.discount.value) : '');
    setVal('discount-reason', (order.discount && order.discount.reason) || '');
    var modal = el('discount-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    var valBox = el('discount-value');
    if (valBox) {
      valBox.focus();
    }
  });
  document.getElementById('cancel-discount').addEventListener('click', function () {
    var modal = el('discount-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  });
  document.getElementById('discount-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var order = openOrder();
    if (!order || !waiter) {
      return;
    }
    var typeEl = el('discount-type');
    var valueEl = el('discount-value');
    var reasonEl = el('discount-reason');
    api('/api/orders/discount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0,
        type: typeEl ? typeEl.value : 'percent',
        value: dec(valueEl ? valueEl.value : 0),
        reason: reasonEl ? reasonEl.value : ''
      })
    }).then(function () {
      var modal = el('discount-modal');
      if (modal) {
        modal.classList.add('hidden');
      }
      say('Endirim tətbiq olundu.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('discount-clear').addEventListener('click', function () {
    var order = openOrder();
    if (!order || !waiter) {
      return;
    }
    window.askYes('Endirim', 'Endirim ləğv edilsin?').then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/orders/discount/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          waiterId: waiter.user.id,
          terminalId: terminal ? terminal.id : 0
        })
      }).then(function () {
        document.getElementById('discount-modal').classList.add('hidden');
        say('Endirim ləğv olundu.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  function fillWaitlistTables() {
    var sel = el('wl-table');
    if (!sel) {
      return;
    }
    var keep = sel.value;
    sel.innerHTML = '<option value="">Seçin</option>';
    tables.forEach(function (table) {
      if (tableState(table) !== 'empty') {
        return;
      }
      var opt = document.createElement('option');
      opt.value = String(table.id);
      opt.textContent = table.name || ('Masa ' + table.number);
      sel.appendChild(opt);
    });
    if (tableId > 0 && sel.querySelector('option[value="' + tableId + '"]')) {
      sel.value = String(tableId);
    } else if (keep && sel.querySelector('option[value="' + keep + '"]')) {
      sel.value = keep;
    }
  }

  function renderWaitlist() {
    fillWaitlistTables();
    var box = el('waitlist-rows');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    if (!waitlist.length) {
      box.innerHTML = '<p class="hint">Növbə boşdur.</p>';
      return;
    }
    waitlist.forEach(function (row) {
      var p = document.createElement('p');
      var text = document.createElement('span');
      text.textContent = row.name + ' • ' + row.guests + ' nəfər' + (row.phone ? ' • ' + row.phone : '');
      var seatBtn = document.createElement('button');
      seatBtn.type = 'button';
      seatBtn.textContent = 'Oturtdu';
      seatBtn.addEventListener('click', function () {
        var wlTable = el('wl-table');
        var dest = Number(wlTable && wlTable.value) || tableId;
        if (!(dest > 0)) {
          say('Əvvəlcə masa seçin.', 'err');
          return;
        }
        api('/api/waitlist/' + row.id + '/seat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: dest, terminalId: terminal ? terminal.id : 0 })
        }).then(function () {
          pendingGuests = row.guests;
          pendingGuestName = row.name;
          pendingGuestPhone = row.phone || '';
          var modal = el('waitlist-modal');
          if (modal) {
            modal.classList.add('hidden');
          }
          writePendingGuests(dest, pendingGuests);
          say(row.name + ' oturduldu.');
          return selectSeat(dest);
        }).then(function () {
          setVal('order-guests', String(pendingGuests));
          return load();
        }).catch(function (error) {
          say(error.message, 'err');
        });
      });
      var goneBtn = document.createElement('button');
      goneBtn.type = 'button';
      goneBtn.textContent = 'Getdi';
      goneBtn.addEventListener('click', function () {
        api('/api/waitlist/' + row.id + '/gone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).then(function () {
          return load();
        }).then(function () {
          renderWaitlist();
        }).catch(function (error) {
          say(error.message, 'err');
        });
      });
      p.appendChild(text);
      p.appendChild(seatBtn);
      p.appendChild(goneBtn);
      box.appendChild(p);
    });
  }

  document.getElementById('new-takeaway').addEventListener('click', function () {
    if (!waiter) {
      showLock();
      return;
    }
    selectSeat(-1).catch(function (error) { say(error.message, 'err'); });
  });
  document.getElementById('new-delivery').addEventListener('click', function () {
    if (!waiter) {
      showLock();
      return;
    }
    selectSeat(-2).catch(function (error) { say(error.message, 'err'); });
  });
  document.getElementById('waitlist-open').addEventListener('click', function () {
    renderWaitlist();
    var modal = el('waitlist-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    var nameBox = el('wl-name');
    if (nameBox) {
      nameBox.focus();
    }
  });
  document.getElementById('waitlist-close').addEventListener('click', function () {
    var modal = el('waitlist-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  });
  document.getElementById('waitlist-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var nameEl = el('wl-name');
    var phoneEl = el('wl-phone');
    var guestsEl = el('wl-guests');
    api('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameEl ? nameEl.value : '',
        phone: phoneEl ? phoneEl.value : '',
        guests: Number(guestsEl ? guestsEl.value : 0)
      })
    }).then(function () {
      var form = el('waitlist-form');
      if (form) {
        form.reset();
      }
      setVal('wl-guests', '2');
      return load();
    }).then(function () {
      renderWaitlist();
      say('Növbəyə yazıldı.');
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('merge-open').addEventListener('click', function () {
    var order = openOrder();
    if (!order) {
      say('Açıq hesab yoxdur.', 'err');
      return;
    }
    var box = document.getElementById('merge-table');
    box.innerHTML = '';
    tables.filter(function (table) {
      return table.id !== order.tableId &&
        (order.linkedTableIds || []).indexOf(table.id) === -1;
    }).forEach(function (table) {
      var room = rooms.find(function (item) { return item.id === table.roomId; });
      var opt = document.createElement('option');
      opt.value = String(table.id);
      var state = tableState(table);
      opt.textContent = (table.name || ('Masa ' + table.number)) +
        (room ? ' • ' + room.name : '') +
        (state === 'busy' ? ' • hesab' : '');
      box.appendChild(opt);
    });
    if (!box.options.length) {
      say('Birləşdiriləcək masa yoxdur.', 'err');
      return;
    }
    document.getElementById('merge-modal').classList.remove('hidden');
  });
  document.getElementById('cancel-merge').addEventListener('click', function () {
    document.getElementById('merge-modal').classList.add('hidden');
  });
  document.getElementById('merge-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var order = openOrder();
    var destId = Number(document.getElementById('merge-table').value);
    if (!order || !destId) {
      return;
    }
    api('/api/orders/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(terminalPayload({
        orderId: order.id,
        tableId: destId
      }))
    }).then(function () {
      document.getElementById('merge-modal').classList.add('hidden');
      say('Masalar birləşdirildi.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('unmerge-open').addEventListener('click', function () {
    var order = openOrder();
    if (!order || !(order.linkedTableIds || []).length) {
      say('Ayrılacaq masa yoxdur.', 'err');
      return;
    }
    var box = document.getElementById('unmerge-table');
    box.innerHTML = '';
    (order.linkedTableIds || []).forEach(function (id) {
      var table = tableById(id);
      var opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = table ? (table.name || ('Masa ' + table.number)) : ('Masa ' + id);
      box.appendChild(opt);
    });
    document.getElementById('unmerge-modal').classList.remove('hidden');
  });
  document.getElementById('cancel-unmerge').addEventListener('click', function () {
    document.getElementById('unmerge-modal').classList.add('hidden');
  });
  document.getElementById('unmerge-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var order = openOrder();
    var splitId = Number(document.getElementById('unmerge-table').value);
    if (!order || !splitId) {
      return;
    }
    api('/api/orders/unmerge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(terminalPayload({
        orderId: order.id,
        tableId: splitId
      }))
    }).then(function () {
      document.getElementById('unmerge-modal').classList.add('hidden');
      say('Masa ayrıldı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  function saveGuestExtras() {
    pendingGuestName = document.getElementById('order-guest-name').value.trim();
    pendingGuestPhone = document.getElementById('order-guest-phone').value.trim();
    pendingGuestAddress = document.getElementById('order-guest-address').value.trim();
    pendingCourier = document.getElementById('order-courier').value.trim();
    var order = openOrder();
    if (!tableId || !waiter || !order) {
      return;
    }
    api('/api/orders/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(terminalPayload({
        tableId: tableId,
        guests: pendingGuests,
        guestName: pendingGuestName,
        guestPhone: pendingGuestPhone,
        guestAddress: pendingGuestAddress,
        courierName: pendingCourier
      }))
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }
  document.getElementById('order-guest-name').addEventListener('change', saveGuestExtras);
  document.getElementById('order-guest-phone').addEventListener('change', saveGuestExtras);
  document.getElementById('order-guest-address').addEventListener('change', saveGuestExtras);
  document.getElementById('order-courier').addEventListener('change', saveGuestExtras);

  document.getElementById('reserve-table').addEventListener('click', function () {
    if (!tableId) {
      say('Masa seçin.', 'err');
      return;
    }
    var modal = el('reserve-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    var at = el('res-at');
    if (window.PosDates && at && !at.value) {
      window.PosDates.fillSoon(at, 60);
    } else if (window.PosDates && at) {
      window.PosDates.refresh(at);
    }
    var nameBox = el('res-name');
    if (nameBox) {
      nameBox.focus();
    }
  });
  document.getElementById('cancel-res-modal').addEventListener('click', function () {
    var modal = el('reserve-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  });
  document.getElementById('reserve-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!waiter) {
      showLock();
      return;
    }
    var nameEl = el('res-name');
    var phoneEl = el('res-phone');
    var atEl = el('res-at');
    var guestsEl = el('res-guests');
    var noteEl = el('res-note');
    api('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0,
        tableId: tableId,
        name: nameEl ? nameEl.value : '',
        phone: phoneEl ? phoneEl.value : '',
        at: atEl ? atEl.value : '',
        guests: Number(guestsEl ? guestsEl.value : 0),
        note: noteEl ? noteEl.value : ''
      })
    }).then(function () {
      var modal = el('reserve-modal');
      if (modal) {
        modal.classList.add('hidden');
      }
      var form = el('reserve-form');
      if (form) {
        form.reset();
      }
      say('Rezerv yazıldı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('cancel-reserve').addEventListener('click', function () {
    var booked = reservationFor(tableId);
    if (!booked || !waiter) {
      return;
    }
    window.askDelete(booked.name, 'Rezerv ləğv olunacaq.').then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/reservations/' + booked.id + '?waiterId=' + waiter.user.id, { method: 'DELETE' })
        .then(function () {
          say('Rezerv ləğv olundu.');
          return load();
        });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('order-guests').addEventListener('change', function () {
    pendingGuests = Math.max(0, Math.min(99, Math.round(Number(this.value) || 0)));
    this.value = String(pendingGuests);
    var order = openOrder();
    if (!tableId || !waiter) {
      return;
    }
    if (!order) {
      writePendingGuests(tableId, pendingGuests);
      return;
    }
    api('/api/orders/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(terminalPayload({
        tableId: tableId,
        guests: pendingGuests,
        guestName: pendingGuestName,
        guestPhone: pendingGuestPhone,
        guestAddress: pendingGuestAddress,
        courierName: pendingCourier
      }))
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  try {
    var saved = window.sessionStorage.getItem('posWaiter');
    if (saved) {
      setWaiter(JSON.parse(saved));
    } else {
      setWaiter(null);
    }
  } catch (error) {
    setWaiter(null);
  }

  function readFloorWidth() {
    try {
      var savedW = Number(window.localStorage.getItem('orderFloorWidth'));
      return Number.isFinite(savedW) && savedW >= 180 ? savedW : 0;
    } catch (error) {
      return 0;
    }
  }

  function setFloorWidth(width, persist) {
    var max = Math.max(220, window.innerWidth - 360);
    var next = Math.min(max, Math.max(180, Math.round(width)));
    document.body.style.setProperty('--floor-w', next + 'px');
    if (persist) {
      try {
        window.localStorage.setItem('orderFloorWidth', String(next));
      } catch (error) {}
    }
    return next;
  }

  var savedFloorW = readFloorWidth();
  if (savedFloorW) {
    setFloorWidth(savedFloorW, false);
  }
  var resizer = document.getElementById('floor-resizer');
  resizer.addEventListener('mousedown', function (event) {
    event.preventDefault();
    resizer.classList.add('drag');
    var startX = event.clientX;
    var startW = document.querySelector('.floor-col').offsetWidth;

    function move(ev) {
      setFloorWidth(startW + ev.clientX - startX, false);
    }

    function stop() {
      resizer.classList.remove('drag');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      setFloorWidth(document.querySelector('.floor-col').offsetWidth, true);
    }

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
  });

  window.addEventListener('resize', function () {
    var kept = readFloorWidth() || document.querySelector('.floor-col').offsetWidth;
    var max = Math.max(220, window.innerWidth - 360);
    setFloorWidth(kept, kept > max);
  });
  window.addEventListener('pos-auth-lost', function () {
    setWaiter(null);
  });
  window.addEventListener('pos-pin-changed', function () {
    if (waiter) {
      load();
    }
  });
  function scalePayload() {
    var body = { orderCardScale: cardScale };
    if (waiter && waiter.user) {
      body.waiterId = waiter.user.id;
    }
    return JSON.stringify(body);
  }

  function sendScale(keepalive) {
    var opts = {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: scalePayload()
    };
    if (keepalive) {
      opts.keepalive = true;
    }
    return api('/api/prefs', opts).catch(function () {});
  }

  function persistScale() {
    try {
      window.localStorage.setItem('orderCardScale', String(cardScale));
    } catch (error) {}
    if (scaleTimer) {
      window.clearTimeout(scaleTimer);
    }
    scaleTimer = window.setTimeout(function () {
      scaleTimer = 0;
      sendScale(false);
    }, 150);
  }

  function flushScale() {
    if (scaleTimer) {
      window.clearTimeout(scaleTimer);
      scaleTimer = 0;
    }
    try {
      window.localStorage.setItem('orderCardScale', String(cardScale));
    } catch (error) {}
    sendScale(true);
  }

  function applyScale(value, persist) {
    var next = Number(value);
    if (!Number.isFinite(next)) {
      next = readCardScale();
    }
    cardScale = Math.min(5, Math.max(1, Math.round(next)));
    var range = document.getElementById('order-card-scale');
    var grid = document.getElementById('product-grid');
    if (range) {
      range.value = String(cardScale);
    }
    if (grid) {
      grid.setAttribute('data-scale', String(cardScale));
    }
    if (persist !== false) {
      persistScale();
    }
  }

  document.getElementById('order-card-scale').addEventListener('input', function (event) {
    applyScale(event.target.value);
  });
  document.getElementById('scale-down').addEventListener('click', function () {
    applyScale(cardScale - 1);
  });
  document.getElementById('scale-up').addEventListener('click', function () {
    applyScale(cardScale + 1);
  });
  window.addEventListener('pagehide', flushScale);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flushScale();
      stopOrdersPoll();
    } else {
      onOrdersVisible();
    }
  });
  window.addEventListener('focus', onOrdersVisible);
  window.addEventListener('pageshow', onOrdersVisible);

  window.setInterval(function () {
    if (waiter && products.length) {
      renderFavRow();
      renderProducts();
    }
    if (waiter) {
      renderFloor();
    }
  }, 30000);

  Object.defineProperties(ctx, {
    waiter: { get: function () { return waiter; }, set: function (v) { waiter = v; }, enumerable: true, configurable: true },
    tableId: { get: function () { return tableId; }, set: function (v) { tableId = v; }, enumerable: true, configurable: true },
    pending: { get: function () { return pending; }, set: function (v) { pending = v; }, enumerable: true, configurable: true },
    settings: { get: function () { return settings; }, enumerable: true, configurable: true },
    terminal: { get: function () { return terminal; }, enumerable: true, configurable: true },
    busy: { get: function () { return busy; }, set: function (v) { busy = v; }, enumerable: true, configurable: true },
    lastReceipt: { get: function () { return lastReceipt; }, set: function (v) { lastReceipt = v; }, enumerable: true, configurable: true },
    payDue: { get: function () { return payDue; }, set: function (v) { payDue = v; }, enumerable: true, configurable: true },
    payMode: { get: function () { return payMode; }, set: function (v) { payMode = v; }, enumerable: true, configurable: true },
    payMethod: { get: function () { return payMethod; }, set: function (v) { payMethod = v; }, enumerable: true, configurable: true },
    payPickIds: { get: function () { return payPickIds; }, set: function (v) { payPickIds = v; }, enumerable: true, configurable: true },
    paySeatId: { get: function () { return paySeatId; }, set: function (v) { paySeatId = v; }, enumerable: true, configurable: true },
    payLock: { get: function () { return payLock; }, set: function (v) { payLock = v; }, enumerable: true, configurable: true },
    shiftPack: { get: function () { return shiftPack; }, set: function (v) { shiftPack = v; }, enumerable: true, configurable: true }
  });
  ctx.M = M;
  ctx.el = el;
  ctx.setText = setText;
  ctx.setVal = setVal;
  ctx.api = api;
  ctx.say = say;
  ctx.payFail = payFail;
  ctx.dec = dec;
  ctx.money = money;
  ctx.can = can;
  ctx.showLock = showLock;
  ctx.ensureTerminal = ensureTerminal;
  ctx.openOrder = openOrder;
  ctx.isServiceId = isServiceId;
  ctx.bookingFor = bookingFor;
  ctx.billAfter = billAfter;
  ctx.paidSharesMinor = paidSharesMinor;
  ctx.lineMinor = lineMinor;
  ctx.openLines = openLines;
  ctx.tableTitle = tableTitle;
  ctx.maybeFocusBarcode = maybeFocusBarcode;
  ctx.load = function () { return load(); };
  ctx.refreshOrdersLight = function (opts) { return refreshOrdersLight(opts); };
  ctx.postAccept = function () { return postAccept(); };
  window.OrdersUiCtx = ctx;
  if (window.OrdersZones) {
    window.OrdersZones.bind(ctx);
  }
  if (window.OrdersShift) {
    window.OrdersShift.bind(ctx);
  }
  if (window.OrdersPay) {
    window.OrdersPay.bind(ctx);
  }

  load();
})();