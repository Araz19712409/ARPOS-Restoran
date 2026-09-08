(function () {
  var waiter = null;
  var pinBuffer = '';
  var stationId = 0;
  var stations = [];
  var timer = 0;

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

  function can(key) {
    return waiter && waiter.permissions && waiter.permissions.indexOf(key) !== -1;
  }

  function showLock() {
    document.getElementById('pin-lock').classList.remove('hidden');
    pinBuffer = '';
    drawPin();
  }

  function hideLock() {
    document.getElementById('pin-lock').classList.add('hidden');
  }

  function drawPin() {
    document.getElementById('pin-dots').textContent = pinBuffer
      ? new Array(pinBuffer.length + 1).join('•')
      : '○ ○ ○ ○ ○ ○';
  }

  function ageClass(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) {
      return '';
    }
    if (ms >= 15 * 60 * 1000) {
      return 'age-late';
    }
    if (ms >= 8 * 60 * 1000) {
      return 'age-wait';
    }
    return '';
  }

  function ageText(iso) {
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(mins) || mins < 1) {
      return 'indi';
    }
    return mins + ' dəq';
  }

  function setWaiter(data) {
    waiter = data;
    if (data) {
      window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
      hideLock();
      document.getElementById('waiter-line').textContent = data.user.name + ' • stansiya ekranı';
    } else {
      if (window.PosNav) {
        window.PosNav.forget();
      }
      window.sessionStorage.removeItem('posWaiter');
      document.getElementById('waiter-line').textContent = 'PIN yazın.';
      showLock();
    }
    if (window.PosNav && !window.PosNav.afterLogin(data)) {
      return;
    }
    if (data) {
      load();
    }
  }

  function drawTabs() {
    var box = document.getElementById('station-tabs');
    box.innerHTML = '';
    [{ id: 0, name: 'Hamısı' }, { id: -1, name: 'Çıxış' }].concat(stations).forEach(function (row) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = row.name;
      if (Number(row.id) === stationId) {
        btn.className = 'active';
      }
      btn.addEventListener('click', function () {
        stationId = Number(row.id);
        load();
      });
      box.appendChild(btn);
    });
  }

  function drawBoard(lines) {
    var board = document.getElementById('kitchen-board');
    board.innerHTML = '';
    if (!lines.length) {
      board.innerHTML = '<p class="kitchen-empty">Gözləyən yoxdur.</p>';
      return;
    }
    lines.forEach(function (line) {
      var card = document.createElement('article');
      card.className = 'kitchen-card ' + ageClass(line.at);
      card.innerHTML =
        '<div class="meta"><span></span><span class="when"></span></div>' +
        '<p class="qty"></p><h3></h3><p class="note"></p><p class="who"></p>';
      card.querySelector('.meta span').textContent = line.tableName + ' • ' + line.stationName;
      card.querySelector('.when').textContent = ageText(line.at);
      card.querySelector('.qty').textContent = '× ' + line.qty;
      card.querySelector('h3').textContent = line.name +
        (Number(line.course) === 1 ? ' • soyuq' : (Number(line.course) === 2 ? ' • isti' : ''));
      card.querySelector('.note').textContent = line.note || '';
      card.querySelector('.who').textContent = line.waiterName || '';
      if (can('kitchen.done')) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = stationId === -1 || line.pass ? 'Verildi' : 'Hazır';
        btn.addEventListener('click', function () {
          if (stationId === -1 || line.pass) {
            markServed(line);
          } else {
            markDone(line);
          }
        });
        card.appendChild(btn);
      }
      board.appendChild(card);
    });
  }

  function load() {
    if (!waiter) {
      return Promise.resolve();
    }
    var q = stationId === -1 ? '?pass=1' : (stationId ? ('?stationId=' + stationId) : '');
    return api('/api/kitchen' + q).then(function (body) {
      if (window.PosNav && body.data && body.data.opsMode) {
        window.PosNav.rememberOps(body.data.opsMode);
      }
      stations = (body.data && body.data.stations) || [];
      drawTabs();
      drawBoard((body.data && body.data.lines) || []);
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function markServed(line) {
    api('/api/kitchen/serve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: line.orderId, itemId: line.itemId, pass: true })
    }).then(function (body) {
      say(line.name + ' verildi.', 'ok');
      drawBoard((body.data && body.data.lines) || []);
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function markDone(line) {
    if (!can('kitchen.done')) {
      return;
    }
    api('/api/kitchen/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: line.orderId,
        itemId: line.itemId,
        stationId: stationId
      })
    }).then(function (body) {
      say(line.name + ' hazır.', 'ok');
      stations = (body.data && body.data.stations) || stations;
      drawTabs();
      drawBoard((body.data && body.data.lines) || []);
    }).catch(function (error) {
      say(error.message, 'err');
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
      body.data.fromLogin = true;
      setWaiter(body.data);
    }).catch(function (error) {
      document.getElementById('pin-error').textContent = error.message;
      if (clearOnFail) {
        pinBuffer = '';
        drawPin();
      }
    });
  }

  var pinPad = document.getElementById('pin-pad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].forEach(function (key) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = key;
    btn.addEventListener('click', function () {
      document.getElementById('pin-error').textContent = '';
      if (key === 'C') {
        pinBuffer = '';
        drawPin();
        return;
      }
      if (key === 'OK') {
        tryLogin(true);
        return;
      }
      if (pinBuffer.length >= 8) {
        return;
      }
      pinBuffer += key;
      drawPin();
      if (pinBuffer.length >= 6) {
        tryLogin(pinBuffer.length >= 8);
      }
    });
    pinPad.appendChild(btn);
  });

  document.getElementById('logout').addEventListener('click', function () {
    setWaiter(null);
  });

  window.addEventListener('pos-auth-lost', function () {
    setWaiter(null);
  });

  var saved = window.PosNav ? window.PosNav.session() : null;
  if (saved && window.PosNav.guard()) {
    setWaiter(saved);
  } else if (!saved) {
    showLock();
  }

  timer = window.setInterval(function () {
    if (waiter) {
      load();
    }
  }, 5000);
})();
