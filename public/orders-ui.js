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

  function dec(value) {
    return window.PosNav && window.PosNav.parseDec
      ? window.PosNav.parseDec(value)
      : Number(String(value == null ? '' : value).replace(',', '.'));
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
  var locks = [];
  var lastReceipt = null;
  var pinBuffer = '';
  var pingTimer = 0;
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
      return;
    }
    var box = document.getElementById('message');
    if (box) {
      box.textContent = text || '';
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

  function drawWaiterLine() {
    if (waiter && terminal) {
      document.getElementById('waiter-line').textContent = waiter.user.name + ' • ' + terminal.name;
    } else if (waiter) {
      document.getElementById('waiter-line').textContent = waiter.user.name;
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
    }
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
    render();
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
    } else {
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
  }

  function load() {
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
      render();
    }).catch(function (error) {
      say(error.message, 'err');
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
    orders.filter(function (item) {
      return item.status === 'open' && (item.channel === 'takeaway' || item.channel === 'delivery' || Number(item.tableId) < 0);
    }).forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'table-tile busy' + (item.tableId === tableId ? ' selected' : '');
      var label = document.createElement('span');
      label.textContent = item.tableName || (item.channel === 'delivery' ? 'Çatdırılma' : 'Takeaway');
      var small = document.createElement('small');
      small.textContent = item.guestName || (item.channel === 'delivery' ? 'Çatdırılma' : 'Takeaway');
      btn.appendChild(label);
      btn.appendChild(small);
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
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'table-tile ' + (table.shape === 'round' ? 'round' : '') + ' ' + state + (table.id === tableId ? ' selected' : '');
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
          small.textContent = linked
            ? 'Birləşib'
            : (state === 'busy' ? 'Hesab' : (state === 'reserved' ? 'Rezerv' : table.capacity + ' nəfər'));
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
        return normalize(item.name).indexOf(q) !== -1;
      }
      return item.groupId === groupId;
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
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'order-card';
      card.innerHTML = '<div class="photo"></div><div class="body"><h3></h3><p class="price"></p></div>';
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
      card.addEventListener('click', function () {
        addProduct(item);
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
    var sum = livePrice(product);
    if (product.portions) {
      var portion = product.portions.find(function (row) { return row.id === portionId; });
      if (portion) {
        sum += Number(portion.price) || 0;
      }
    }
    (extraIds || []).forEach(function (id) {
      var extra = (product.extras || []).find(function (row) { return row.id === id; });
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
      var portion = product.portions.find(function (row) { return row.id === portionId; });
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
    document.getElementById('option-title').textContent = product.name;
    document.getElementById('option-base').textContent = 'Satış: ' + Number(livePrice(product)).toFixed(2) + ' AZN';
    var portionBox = document.getElementById('option-portions');
    portionBox.innerHTML = '';
    (product.portions || []).forEach(function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt-chip' + (row.id === optionPortionId ? ' active' : '');
      btn.textContent = row.name + (Number(row.price) ? ' +' + Number(row.price).toFixed(2) : '');
      btn.addEventListener('click', function () {
        optionPortionId = row.id;
        drawOptionChips();
      });
      portionBox.appendChild(btn);
    });
    var extraBox = document.getElementById('option-extras');
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
    document.getElementById('option-modal').classList.remove('hidden');
  }

  function drawOptionChips() {
    if (!optionProduct) {
      return;
    }
    var portionBtns = document.querySelectorAll('#option-portions .opt-chip');
    (optionProduct.portions || []).forEach(function (row, i) {
      if (portionBtns[i]) {
        portionBtns[i].classList.toggle('active', row.id === optionPortionId);
      }
    });
    var extraBtns = document.querySelectorAll('#option-extras .opt-chip');
    (optionProduct.extras || []).forEach(function (row, i) {
      if (extraBtns[i]) {
        extraBtns[i].classList.toggle('active', optionExtraIds.indexOf(row.id) !== -1);
      }
    });
    document.getElementById('option-sum').textContent =
      linePrice(optionProduct, optionPortionId, optionExtraIds).toFixed(2) + ' AZN';
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

  function renderCheck() {
    var table = tableById(tableId);
    var order = openOrder();
    var hasSeat = !!table || isServiceId(tableId);
    document.getElementById('check-table').textContent = checkTitle(order, table);
    var guestsBox = document.getElementById('order-guests');
    var orderGuests = order ? Number(order.guests) || 0 : pendingGuests;
    if (!hasSeat) {
      pendingGuests = 0;
      orderGuests = 0;
    } else if (order) {
      pendingGuests = orderGuests;
    }
    guestsBox.disabled = !hasSeat;
    var svc = document.getElementById('service-guest');
    var showSvc = isServiceId(tableId) || !!(order && (order.channel === 'takeaway' || order.channel === 'delivery'));
    svc.classList.toggle('hidden', !showSvc);
    if (showSvc) {
      var nameBox = document.getElementById('order-guest-name');
      var phoneBox = document.getElementById('order-guest-phone');
      if (document.activeElement !== nameBox) {
        nameBox.value = order ? (order.guestName || pendingGuestName) : pendingGuestName;
      }
      if (document.activeElement !== phoneBox) {
        phoneBox.value = order ? (order.guestPhone || pendingGuestPhone) : pendingGuestPhone;
      }
      var isDeliv = tableId === -2 || tableId <= -2000 ||
        !!(order && order.channel === 'delivery');
      document.querySelectorAll('.svc-deliv').forEach(function (el) {
        el.classList.toggle('hidden', !isDeliv);
      });
      if (isDeliv) {
        var addr = document.getElementById('order-guest-address');
        var cour = document.getElementById('order-courier');
        if (document.activeElement !== addr) {
          addr.value = order ? (order.guestAddress || pendingGuestAddress) : pendingGuestAddress;
        }
        if (document.activeElement !== cour) {
          cour.value = order ? (order.courierName || pendingCourier) : pendingCourier;
        }
      }
    }
    if (document.activeElement !== guestsBox) {
      guestsBox.value = String(orderGuests);
    }
    var booked = table ? bookingFor(table.id) : null;
    var info = document.getElementById('reserve-info');
    var prepaidText = booked && booked.prepay
      ? (' • İlkin: ' + Number(booked.prepay.total).toFixed(2) + ' AZN')
      : '';
    info.textContent = booked
      ? (booked.name + ' • ' + booked.guests + ' nəfər • ' + String(booked.at).replace('T', ' ') + prepaidText)
      : '';
    var state = table ? tableState(table) : 'empty';
    document.getElementById('reserve-table').style.display = table && state === 'empty' ? '' : 'none';
    document.getElementById('cancel-reserve').style.display = table && state === 'reserved' ? '' : 'none';
    document.getElementById('prepay-open').style.display =
      booked && can('payments.take') && (state === 'reserved' || state === 'busy') ? '' : 'none';
    var canPay = !!(order && can('payments.take'));
    document.getElementById('pay-open').style.display = canPay ? '' : 'none';
    document.getElementById('reprint-order').style.display = order && order.items && order.items.length ? '' : 'none';
    document.getElementById('discount-open').style.display =
      order && can('orders.discount') ? '' : 'none';
    document.getElementById('move-open').style.display =
      order && !(order.linkedTableIds || []).length &&
      (table || order.channel === 'takeaway' || order.channel === 'delivery' ||
        (Number(order.tableId) < 0 && !isDraftSeat(order.tableId))) &&
      (can('orders.move') || can('orders.create')) ? '' : 'none';
    var held = !!(order && (order.items || []).some(function (item) {
      return !item.voided && !item.sent;
    }));
    document.getElementById('fire-course').style.display =
      held && can('orders.create') ? '' : 'none';
    document.getElementById('handoff-open').style.display =
      order && can('orders.create') ? '' : 'none';
    document.getElementById('merge-open').style.display =
      order && table && can('orders.create') ? '' : 'none';
    document.getElementById('unmerge-open').style.display =
      order && (order.linkedTableIds || []).length && can('orders.create') ? '' : 'none';

    var box = document.getElementById('check-list');
    box.innerHTML = '';
    var sent = order ? order.items : [];
    if (!sent.length && !pending.length) {
      box.innerHTML = '<p class="hint">Məhsula basın.</p>';
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
        if (item.sent) {
          var reprintBtn = document.createElement('button');
          reprintBtn.type = 'button';
          reprintBtn.textContent = 'Çap';
          reprintBtn.addEventListener('click', function () {
            runAction('/api/orders/reprint', { orderId: order.id, itemId: item.id }, 'Təkrar çap göndərilsin?');
          });
          actions.appendChild(reprintBtn);
        }
        if (can('orders.void')) {
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
        '<button type="button" data-act="note">Qeyd</button>' +
        '<button type="button" data-act="comp">Pulsuz</button></div>';
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
      row.querySelector('[data-act="comp"]').addEventListener('click', function () {
        item.complimentary = !item.complimentary;
        item.salePrice = item.complimentary ? 0 : (item.basePrice || item.salePrice);
        renderCheck();
      });
      box.appendChild(row);
    });

    var items = 0;
    sent.forEach(function (item) {
      if (!item.voided) {
        items += Number(item.salePrice) * Number(item.qty);
      }
    });
    pending.forEach(function (item) { items += Number(item.salePrice) * Number(item.qty); });
    var order = openOrder();
    var off = discountOff(order, items);
    var after = Number((Math.max(0, items - off)).toFixed(2));
    var service = serviceOf(after);
    document.getElementById('check-items').textContent = items.toFixed(2) + ' AZN';
    var discRow = document.getElementById('check-discount-row');
    if (off > 0) {
      discRow.classList.remove('hidden');
      document.getElementById('check-discount-label').textContent =
        'Endirim' + (order.discount && order.discount.type === 'percent' ? ' (' + order.discount.value + '%)' : '');
      document.getElementById('check-discount').textContent = '-' + off.toFixed(2) + ' AZN';
    } else {
      discRow.classList.add('hidden');
    }
    document.getElementById('check-service').textContent = service.toFixed(2) + ' AZN';
    document.getElementById('check-service-label').textContent =
      'Xidmət' + (settings.serviceChargePercent ? ' (' + settings.serviceChargePercent + '%)' : '');
    document.getElementById('check-service-row').style.display = '';
    var tip = Number(order && order.tipAmount) || 0;
    var tipRow = document.getElementById('check-tip-row');
    if (tip > 0) {
      tipRow.classList.remove('hidden');
      document.getElementById('check-tip').textContent = tip.toFixed(2) + ' AZN';
    } else {
      tipRow.classList.add('hidden');
    }
    document.getElementById('check-total').textContent = (after + service + tip).toFixed(2) + ' AZN';
  }

  function render() {
    renderFloor();
    renderGroups();
    renderProducts();
    renderCheck();
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
    renderGroups();
    renderProducts();
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
    runAction('/api/orders/reprint', { orderId: order.id }, 'Bütün göndərilmiş sətirlər təkrar çap olunsun?');
  });

  document.getElementById('accept-order').addEventListener('click', function () {
    if (busy) {
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
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    }).then(function () {
      busy = false;
    });
  });

  function serviceOf(items) {
    var pct = Number(settings.serviceChargePercent) || 0;
    return Number((items * pct / 100).toFixed(2));
  }

  function billItems(order) {
    var total = 0;
    (order && order.items || []).forEach(function (item) {
      if (!item.voided) {
        total += Number(item.salePrice) * Number(item.qty);
      }
    });
    return Number(total.toFixed(2));
  }

  function discountOff(order, items) {
    var d = order && order.discount;
    if (!d) {
      return 0;
    }
    if (d.type === 'percent') {
      return Number((items * Number(d.value) / 100).toFixed(2));
    }
    return Number(Math.min(items, Math.max(0, Number(d.value) || 0)).toFixed(2));
  }

  function billAfter(order) {
    var items = billItems(order);
    var off = discountOff(order, items);
    var after = Number(Math.max(0, items - off).toFixed(2));
    var service = serviceOf(after);
    return {
      items: items,
      off: off,
      after: after,
      service: service,
      tip: Number(order && order.tipAmount) || 0,
      total: Number((after + service + (Number(order && order.tipAmount) || 0)).toFixed(2))
    };
  }

  function paidShares(order) {
    return (order && order.payments || []).reduce(function (sum, row) {
      return sum + Number(row.cashAmount || 0) + Number(row.cardAmount || 0) +
        Number(row.giftAmount || 0);
    }, 0);
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

  function pickingPay() {
    return payPickIds.length > 0 || paySeatId > 0;
  }

  function selectedPayLines(order) {
    return openLines(order).filter(function (item) {
      var home = Number(item.seatTableId || order.tableId);
      if (paySeatId && home !== paySeatId) {
        return false;
      }
      if (payPickIds.length && payPickIds.indexOf(item.id) === -1) {
        return false;
      }
      return true;
    });
  }

  function pickDueAmount(order, remaining) {
    if (!pickingPay()) {
      return remaining;
    }
    var lines = selectedPayLines(order);
    if (!lines.length) {
      return 0;
    }
    if (lines.length === openLines(order).length) {
      return remaining;
    }
    var pickSum = lines.reduce(function (sum, item) {
      return sum + Number(item.salePrice) * Number(item.qty);
    }, 0);
    var openSum = openLines(order).reduce(function (sum, item) {
      return sum + Number(item.salePrice) * Number(item.qty);
    }, 0);
    var raw = openSum > 0 ? Number((remaining * pickSum / openSum).toFixed(2)) : 0;
    if (remaining - raw <= 0.01) {
      return remaining;
    }
    return raw;
  }

  function fillPayPicks(order) {
    var wrap = document.getElementById('pay-pick-wrap');
    var seatBox = document.getElementById('pay-seats');
    var pickBox = document.getElementById('pay-pick');
    var splitBusy = !!(order.payments && order.payments.length && order.splitCount);
    if (!wrap || payMode !== 'order' || splitBusy) {
      if (wrap) {
        wrap.classList.add('hidden');
      }
      payPickIds = [];
      paySeatId = 0;
      return;
    }
    wrap.classList.remove('hidden');
    var lines = openLines(order);
    var seats = [];
    lines.forEach(function (item) {
      var id = Number(item.seatTableId || order.tableId);
      if (id > 0 && seats.indexOf(id) === -1) {
        seats.push(id);
      }
    });
    seatBox.innerHTML = '';
    if (seats.length > 1) {
      seats.forEach(function (id) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pay-seat' + (paySeatId === id ? ' active' : '');
        btn.textContent = tableTitle(id);
        btn.addEventListener('click', function () {
          paySeatId = paySeatId === id ? 0 : id;
          payPickIds = paySeatId
            ? openLines(order).filter(function (item) {
              return Number(item.seatTableId || order.tableId) === paySeatId;
            }).map(function (item) { return item.id; })
            : [];
          openPay();
        });
        seatBox.appendChild(btn);
      });
    }
    pickBox.innerHTML = '';
    lines.forEach(function (item) {
      var lab = document.createElement('label');
      lab.className = 'pay-pick-row';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = payPickIds.indexOf(item.id) !== -1;
      box.addEventListener('change', function () {
        if (box.checked) {
          if (payPickIds.indexOf(item.id) === -1) {
            payPickIds.push(item.id);
          }
        } else {
          payPickIds = payPickIds.filter(function (id) { return id !== item.id; });
          paySeatId = 0;
        }
        openPay();
      });
      lab.appendChild(box);
      var text = document.createElement('span');
      text.textContent = item.qty + '× ' + item.name + ' · ' +
        (Number(item.salePrice) * Number(item.qty)).toFixed(2);
      lab.appendChild(text);
      pickBox.appendChild(lab);
    });
  }

  function splitFrozen(order) {
    return !!(order && order.payments && order.payments.length && order.splitCount);
  }

  function currentShare(remaining, order) {
    if (splitFrozen(order)) {
      var frozenN = Number(order.splitCount);
      var frozen = Number(order.splitShare);
      if (!Number.isFinite(frozen) || frozen <= 0) {
        frozen = Number((remaining / frozenN).toFixed(2));
      }
      if (remaining - frozen <= 0.01) {
        frozen = remaining;
      }
      return { n: frozenN, share: frozen };
    }
    var n = Number(document.getElementById('pay-split').value);
    if (!Number.isInteger(n) || n < 1) {
      n = 1;
    }
    if (n > 10) {
      n = 10;
    }
    var share = n === 1 ? remaining : Number((remaining / n).toFixed(2));
    if (remaining - share <= 0.01) {
      share = remaining;
    }
    return { n: n, share: share };
  }

  function setSplitLocked(order) {
    var settled = !!(order && (order.items || []).some(function (item) { return item.settled; }));
    var locked = payMode === 'order' && (splitFrozen(order) || pickingPay() || settled);
    var el = document.getElementById('pay-split');
    el.disabled = locked;
    document.getElementById('pay-split-minus').disabled = locked;
    document.getElementById('pay-split-plus').disabled = locked;
    if (locked) {
      el.value = String(order.splitCount || 1);
    }
  }

  function setPayDueView() {
    document.getElementById('pay-due-amt').textContent = payDue.toFixed(2);
    var splitN = Number(document.getElementById('pay-split').value) || 1;
    document.getElementById('pay-due-label').textContent = payMode === 'reserve'
      ? 'İlkin məbləğ'
      : (splitN > 1 ? 'Bu pay' : 'Ödəniləcək');
  }

  function setPayRow(wrapId, valueId, amount) {
    var wrap = document.getElementById(wrapId);
    var value = document.getElementById(valueId);
    var show = amount > 0.001;
    wrap.classList.toggle('hidden', !show);
    if (show) {
      value.textContent = amount.toFixed(2);
    }
  }

  function fillPayBreakdown(parts, prepaid, already, remaining) {
    document.getElementById('pay-row-items').textContent = parts.items.toFixed(2);
    setPayRow('pay-row-off-wrap', 'pay-row-off', parts.off);
    setPayRow('pay-row-svc-wrap', 'pay-row-svc', parts.service);
    setPayRow('pay-row-tip-wrap', 'pay-row-tip', parts.tip || 0);
    setPayRow('pay-row-pre-wrap', 'pay-row-pre', prepaid);
    setPayRow('pay-row-paid-wrap', 'pay-row-paid', already);
    document.getElementById('pay-row-remain').textContent = remaining.toFixed(2);
  }

  function fillPayQuick(cash) {
    var box = document.getElementById('pay-quick');
    var steps = [1, 5, 10, 20, 50, 100, 200];
    var vals = [Number(cash.toFixed(2))];
    steps.forEach(function (step) {
      var next = Number((Math.ceil(cash / step) * step).toFixed(2));
      if (next > cash + 0.001 && vals.indexOf(next) < 0) {
        vals.push(next);
      }
    });
    vals = vals.slice(0, 6);
    box.innerHTML = vals.map(function (amount) {
      var label = Math.abs(amount - cash) < 0.001 ? 'Tam' : String(amount);
      return '<button type="button" data-tender="' + amount.toFixed(2) + '">' + label + '</button>';
    }).join('');
  }

  function setPayMethod(method) {
    payMethod = method;
    document.getElementById('pay-method-cash').classList.toggle('active', method === 'cash');
    document.getElementById('pay-method-card').classList.toggle('active', method === 'card');
    document.getElementById('pay-method-mix').classList.toggle('active', method === 'mix');
    document.getElementById('pay-mix-fields').classList.toggle('hidden', method !== 'mix');
    if (method === 'cash') {
      document.getElementById('pay-cash-amt').value = payDue.toFixed(2);
      document.getElementById('pay-card-amt').value = '0.00';
      document.getElementById('pay-tendered').value = payDue.toFixed(2);
      syncPayFields('cash');
    } else if (method === 'card') {
      document.getElementById('pay-cash-amt').value = '0.00';
      document.getElementById('pay-card-amt').value = payDue.toFixed(2);
      syncPayFields('card');
    } else {
      syncPayFields('cash');
    }
  }

  function bumpSplit(delta) {
    if (payMode === 'order' && splitFrozen(openOrder())) {
      return;
    }
    var el = document.getElementById('pay-split');
    var n = Number(el.value) || 1;
    n = Math.min(10, Math.max(1, n + delta));
    el.value = String(n);
    if (payMode === 'order') {
      openPay();
    }
  }

  function syncPayFields(source) {
    if (payLock) {
      return;
    }
    if (payMode === 'order' && !openOrder()) {
      return;
    }
    payLock = true;
    var total = payDue;
    var cashInput = document.getElementById('pay-cash-amt');
    var cardInput = document.getElementById('pay-card-amt');
    var cash = dec(cashInput.value);
    var card = dec(cardInput.value);
    var changeEl = document.getElementById('pay-change');
    if (!Number.isFinite(cash)) {
      cash = 0;
    }
    if (!Number.isFinite(card)) {
      card = 0;
    }
    if (source === 'cash') {
      cash = Math.min(total, Math.max(0, cash));
      card = Number((total - cash).toFixed(2));
    } else if (source === 'card') {
      card = Math.min(total, Math.max(0, card));
      cash = Number((total - card).toFixed(2));
    }
    cashInput.value = cash.toFixed(2);
    cardInput.value = card.toFixed(2);
    document.getElementById('tender-wrap').style.display = cash > 0 ? '' : 'none';
    if (cash > 0) {
      var given = dec(document.getElementById('pay-tendered').value);
      if (!Number.isFinite(given) || given < cash) {
        document.getElementById('pay-tendered').value = cash.toFixed(2);
        given = cash;
      }
      var leftover = Number((given - cash).toFixed(2));
      changeEl.textContent = leftover > 0 ? ('Qalıq: ' + leftover.toFixed(2) + ' AZN') : 'Tam ödənir';
      changeEl.classList.toggle('is-zero', leftover <= 0);
      fillPayQuick(cash);
    } else {
      changeEl.textContent = (payMode === 'order' && payDue === 0)
        ? 'Tam ilkin ödəniş'
        : 'Tam kart';
      changeEl.classList.add('is-zero');
    }
    setPayDueView();
    payLock = false;
  }

  function openPay() {
    var order = openOrder();
    if (!order) {
      say('Açıq hesab yoxdur.', 'err');
      return;
    }
    if (pending.length) {
      say('Əvvəlcə yeni sətirləri qəbul edin.', 'err');
      return;
    }
    if (document.getElementById('pay-modal').classList.contains('hidden')) {
      payPickIds = [];
      paySeatId = 0;
    }
    var tipBox = document.getElementById('pay-tip');
    var hasShares = !!(order.payments && order.payments.length);
    tipBox.disabled = hasShares;
    if (hasShares) {
      tipBox.value = Number(order.tipAmount || 0).toFixed(2);
    } else if (document.getElementById('pay-modal').classList.contains('hidden')) {
      tipBox.value = Number(order.tipAmount || 0).toFixed(2);
    }
    order.tipAmount = dec(tipBox.value) || 0;
    document.getElementById('pay-voen').value = order.buyerVoen || '';
    document.getElementById('pay-buyer').value = order.buyerName || '';
    var parts = billAfter(order);
    var booked = bookingFor(tableId);
    var prepaid = booked && booked.prepay ? Number(booked.prepay.total) : 0;
    var already = paidShares(order);
    var remaining = Number(Math.max(0, parts.total - prepaid - already).toFixed(2));
    if ((order.items || []).some(function (item) { return !item.voided && !item.sent; })) {
      say('Əvvəlcə isti kursu göndərin.', 'err');
      return;
    }
    var keepMethod = document.getElementById('pay-modal').classList.contains('hidden') ? 'cash' : payMethod;
    payMode = 'order';
    document.getElementById('pay-title').textContent = 'Ödəniş';
    document.getElementById('pay-table-label').textContent =
      document.getElementById('check-table').textContent || '';
    document.getElementById('prepay-amt-wrap').classList.add('hidden');
    document.getElementById('pay-tip-wrap').classList.remove('hidden');
    document.getElementById('pay-breakdown').classList.remove('hidden');
    document.getElementById('split-wrap').classList.remove('hidden');
    if (!document.getElementById('pay-split').value) {
      document.getElementById('pay-split').value = '1';
    }
    fillPayPicks(order);
    setSplitLocked(order);
    var cut = currentShare(remaining, order);
    payDue = pickingPay() ? pickDueAmount(order, remaining) : cut.share;
    document.getElementById('pay-submit').textContent = remaining - payDue > 0.01 ? 'Payı ödə' : 'Satışı bitir';
    fillPayBreakdown(parts, prepaid, already, remaining);
    document.getElementById('pay-share').textContent = pickingPay()
      ? 'Seçilmiş sətirlər'
      : (cut.n > 1 ? (cut.n + ' nəfər • hər pay ' + payDue.toFixed(2) + ' AZN') : '');
    setPayDueView();
    setPayMethod(keepMethod);
    document.getElementById('pay-modal').classList.remove('hidden');
  }

  function openPrepay() {
    var booked = bookingFor(tableId);
    if (!booked || !can('payments.take')) {
      say('Aktiv rezerv yoxdur.', 'err');
      return;
    }
    var already = booked.prepay ? Number(booked.prepay.total) : 0;
    payMode = 'reserve';
    payDue = 10;
    document.getElementById('pay-title').textContent = 'İlkin ödəniş';
    document.getElementById('pay-table-label').textContent = booked.name || '';
    document.getElementById('split-wrap').classList.add('hidden');
    document.getElementById('pay-share').textContent = '';
    document.getElementById('pay-breakdown').classList.add('hidden');
    document.getElementById('pay-tip-wrap').classList.add('hidden');
    document.getElementById('prepay-amt-wrap').classList.remove('hidden');
    document.getElementById('pay-prepay-amt').value = '10.00';
    document.getElementById('pay-submit').textContent = 'Qəbul et';
    if (already > 0) {
      document.getElementById('pay-share').textContent = 'Artıq alındı: ' + already.toFixed(2) + ' AZN';
    }
    setPayDueView();
    setPayMethod('cash');
    document.getElementById('pay-modal').classList.remove('hidden');
  }

  document.getElementById('pay-cash-amt').addEventListener('input', function () { syncPayFields('cash'); });
  document.getElementById('pay-card-amt').addEventListener('input', function () { syncPayFields('card'); });
  document.getElementById('pay-tendered').addEventListener('input', function () { syncPayFields('tender'); });
  document.getElementById('pay-prepay-amt').addEventListener('input', function () {
    if (payMode !== 'reserve') {
      return;
    }
    var amt = dec(document.getElementById('pay-prepay-amt').value);
    payDue = Number.isFinite(amt) && amt > 0 ? Number(amt.toFixed(2)) : 0;
    setPayDueView();
    setPayMethod(payMethod);
  });
  document.getElementById('pay-split').addEventListener('input', function () {
    if (payMode === 'order' && !splitFrozen(openOrder())) {
      openPay();
    }
  });
  document.getElementById('pay-split-minus').addEventListener('click', function () { bumpSplit(-1); });
  document.getElementById('pay-split-plus').addEventListener('click', function () { bumpSplit(1); });
  document.getElementById('pay-method-cash').addEventListener('click', function () { setPayMethod('cash'); });
  document.getElementById('pay-method-card').addEventListener('click', function () { setPayMethod('card'); });
  document.getElementById('pay-method-mix').addEventListener('click', function () { setPayMethod('mix'); });
  document.getElementById('pay-quick').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-tender]');
    if (!btn) {
      return;
    }
    document.getElementById('pay-tendered').value = btn.getAttribute('data-tender');
    syncPayFields('tender');
  });
  document.getElementById('pay-open').addEventListener('click', openPay);
  document.getElementById('prepay-open').addEventListener('click', openPrepay);

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
    var box = document.getElementById('move-table');
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
    document.getElementById('move-modal').classList.remove('hidden');
  });
  document.getElementById('cancel-move').addEventListener('click', function () {
    document.getElementById('move-modal').classList.add('hidden');
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
    document.getElementById('handoff-pin').value = '';
    document.getElementById('handoff-modal').classList.remove('hidden');
  });
  document.getElementById('cancel-handoff').addEventListener('click', function () {
    document.getElementById('handoff-modal').classList.add('hidden');
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
  document.getElementById('pay-tip').addEventListener('input', function () {
    if (payMode === 'order' && !document.getElementById('pay-modal').classList.contains('hidden')) {
      openPay();
    }
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
    document.getElementById('discount-type').value = (order.discount && order.discount.type) || 'percent';
    document.getElementById('discount-value').value = order.discount ? String(order.discount.value) : '';
    document.getElementById('discount-reason').value = (order.discount && order.discount.reason) || '';
    document.getElementById('discount-modal').classList.remove('hidden');
    document.getElementById('discount-value').focus();
  });
  document.getElementById('cancel-discount').addEventListener('click', function () {
    document.getElementById('discount-modal').classList.add('hidden');
  });
  document.getElementById('discount-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var order = openOrder();
    if (!order || !waiter) {
      return;
    }
    api('/api/orders/discount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0,
        type: document.getElementById('discount-type').value,
        value: dec(document.getElementById('discount-value').value),
        reason: document.getElementById('discount-reason').value
      })
    }).then(function () {
      document.getElementById('discount-modal').classList.add('hidden');
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
  document.getElementById('cancel-pay').addEventListener('click', function () {
    document.getElementById('pay-modal').classList.add('hidden');
  });
  document.getElementById('receipt-close').addEventListener('click', function () {
    document.getElementById('receipt-modal').classList.add('hidden');
  });
  document.getElementById('receipt-print').addEventListener('click', function () {
    function printPaper() {
      window.ReceiptView.printNow(document.getElementById('receipt-paper'));
    }
    if (!lastReceipt || !waiter) {
      printPaper();
      return;
    }
    api('/api/orders/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: lastReceipt.id,
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0
      })
    }).then(function (body) {
      var warns = (body.data && body.data.warnings) || [];
      document.getElementById('receipt-msg').textContent = warns.length ? warns.join(' ') : 'Çek göndərildi.';
      if (warns.length) {
        printPaper();
      }
    }).catch(function (error) {
      document.getElementById('receipt-msg').textContent = error.message;
      printPaper();
    });
  });

  document.getElementById('pay-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!waiter) {
      return;
    }
    var cashAmount = dec(document.getElementById('pay-cash-amt').value);
    var cardAmount = dec(document.getElementById('pay-card-amt').value);
    var tendered = dec(document.getElementById('pay-tendered').value);
    if (payMode === 'reserve') {
      var booked = bookingFor(tableId);
      if (!booked) {
        say('Aktiv rezerv yoxdur.', 'err');
        return;
      }
      window.askYes('İlkin ödəniş', 'İlkin ödəniş qəbul edilsin?').then(function (ok) {
        if (!ok) {
          return;
        }
        busy = true;
        return api('/api/reservations/' + booked.id + '/prepay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waiterId: waiter.user.id,
          terminalId: terminal ? terminal.id : 0,
          cashAmount: cashAmount,
          cardAmount: cardAmount,
          tendered: tendered
        })
      }).then(function () {
        document.getElementById('pay-modal').classList.add('hidden');
        say('İlkin ödəniş qəbul edildi.');
        return load();
      }).catch(function (error) {
        say(error.message, 'err');
      }).then(function () {
          busy = false;
        });
      }).catch(function (error) {
        say(error.message, 'err');
        busy = false;
      });
      return;
    }
    var order = openOrder();
    if (!order) {
      return;
    }
    var splitN = Number(document.getElementById('pay-split').value) || 1;
    var hasShares = (order.payments || []).length > 0;
    var payText = payDue <= 0.01 && !hasShares
      ? 'Hesab 0 AZN-dir. Masa bağlansın?'
      : (splitN === 1 && !hasShares
        ? 'Satış bitiriləcək və masa boşalacaq. Davam?'
        : 'Bu pay ödənsin?');
    window.askYes('Ödəniş', payText).then(function (ok) {
      if (!ok) {
        return;
      }
      busy = true;
      var giftCode = document.getElementById('pay-gift').value.trim();
      var giftAmount = 0;
      if (giftCode) {
        giftAmount = payDue;
        cashAmount = 0;
        cardAmount = 0;
        tendered = 0;
      }
      return api('/api/orders/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0,
        splitCount: Number(document.getElementById('pay-split').value) || 1,
        tipAmount: dec(document.getElementById('pay-tip').value) || 0,
        buyerVoen: document.getElementById('pay-voen').value,
        buyerName: document.getElementById('pay-buyer').value,
        giftCode: giftCode,
        giftAmount: giftAmount,
        itemIds: payPickIds,
        seatTableId: paySeatId,
        cashAmount: cashAmount,
        cardAmount: cardAmount,
        tendered: tendered
      })
    }).then(function (body) {
      document.getElementById('pay-modal').classList.add('hidden');
      pending = [];
      var result = body.data || {};
      var view = result.order || null;
      if (view && result.payment) {
        view = Object.assign({}, view, { payment: result.payment });
      }
      lastReceipt = view;
      if (lastReceipt && settings.branchName) {
        lastReceipt.branchName = settings.branchName;
      }
      if (result.closed && lastReceipt && window.ReceiptView) {
        window.ReceiptView.fill(document.getElementById('receipt-paper'), lastReceipt);
        document.getElementById('receipt-msg').textContent = 'Çapdan qabaq görünüş. Çap et və ya bağla.';
        document.getElementById('receipt-modal').classList.remove('hidden');
      }
      if (result.closed && isServiceId(tableId)) {
        tableId = 0;
      }
      say(result.closed ? 'Satış bitdi. Masa boşdur.' : ('Pay alındı. Qalıq: ' + Number(result.remaining || 0).toFixed(2) + ' AZN'));
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    }).then(function () {
      busy = false;
    });
    });
  });

  function fillWaitlistTables() {
    var sel = document.getElementById('wl-table');
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
    var box = document.getElementById('waitlist-rows');
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
        var dest = Number(document.getElementById('wl-table').value) || tableId;
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
          document.getElementById('waitlist-modal').classList.add('hidden');
          writePendingGuests(dest, pendingGuests);
          say(row.name + ' oturduldu.');
          return selectSeat(dest);
        }).then(function () {
          document.getElementById('order-guests').value = String(pendingGuests);
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
    document.getElementById('waitlist-modal').classList.remove('hidden');
    document.getElementById('wl-name').focus();
  });
  document.getElementById('waitlist-close').addEventListener('click', function () {
    document.getElementById('waitlist-modal').classList.add('hidden');
  });
  document.getElementById('waitlist-form').addEventListener('submit', function (event) {
    event.preventDefault();
    api('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('wl-name').value,
        phone: document.getElementById('wl-phone').value,
        guests: Number(document.getElementById('wl-guests').value)
      })
    }).then(function () {
      document.getElementById('waitlist-form').reset();
      document.getElementById('wl-guests').value = '2';
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
    document.getElementById('reserve-modal').classList.remove('hidden');
    var at = document.getElementById('res-at');
    if (window.PosDates && !at.value) {
      window.PosDates.fillSoon(at, 60);
    } else if (window.PosDates) {
      window.PosDates.refresh(at);
    }
    document.getElementById('res-name').focus();
  });
  document.getElementById('cancel-res-modal').addEventListener('click', function () {
    document.getElementById('reserve-modal').classList.add('hidden');
  });
  document.getElementById('reserve-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!waiter) {
      showLock();
      return;
    }
    api('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waiterId: waiter.user.id,
        terminalId: terminal ? terminal.id : 0,
        tableId: tableId,
        name: document.getElementById('res-name').value,
        phone: document.getElementById('res-phone').value,
        at: document.getElementById('res-at').value,
        guests: Number(document.getElementById('res-guests').value),
        note: document.getElementById('res-note').value
      })
    }).then(function () {
      document.getElementById('reserve-modal').classList.add('hidden');
      document.getElementById('reserve-form').reset();
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
    }
  });

  window.setInterval(function () {
    if (waiter && products.length) {
      renderProducts();
    }
  }, 30000);
  load();
})();
