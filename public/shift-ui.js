(function () {
  var waiter = null;
  var pinBuffer = '';
  var terminalId = 0;
  var switching = false;

  function dec(value) {
    return window.PosNav && window.PosNav.parseDec
      ? window.PosNav.parseDec(value)
      : Number(String(value == null ? '' : value).replace(',', '.'));
  }

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

  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function twoDigits(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatWhen(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return twoDigits(d.getDate()) + '.' + twoDigits(d.getMonth() + 1) + ' ' +
      twoDigits(d.getHours()) + ':' + twoDigits(d.getMinutes());
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
    return document.querySelector('#pin-lock .eyebrow');
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
      eye.textContent = 'Kassa girişi';
    }
    hideLock();
  }

  function finishSwitch() {
    document.getElementById('pin-switch-back').classList.add('hidden');
    var eye = pinEyebrow();
    if (eye) {
      eye.textContent = 'Kassa girişi';
    }
    switching = false;
  }

  function drawPin() {
    document.getElementById('pin-dots').textContent = pinBuffer
      ? new Array(pinBuffer.length + 1).join('•')
      : '○ ○ ○ ○ ○ ○';
  }

  function savedTerminalId() {
    try {
      var row = JSON.parse(window.localStorage.getItem('posTerminal') || 'null');
      return row && row.id ? Number(row.id) : 0;
    } catch (error) {
      return 0;
    }
  }

  function canOpenShift() {
    return !!(waiter && (can('payments.take') || can('reports.view')));
  }

  function setWaiter(data) {
    waiter = data;
    if (data) {
      window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
    } else {
      if (window.PosNav) {
        window.PosNav.forget();
      }
      window.sessionStorage.removeItem('posWaiter');
    }
    var switchBtn = document.getElementById('switch-waiter');
    if (switchBtn) {
      switchBtn.classList.toggle('hidden', !data);
    }
    if (window.PosNav && !window.PosNav.afterLogin(data)) {
      return;
    }
    if (data && canOpenShift()) {
      document.getElementById('waiter-line').textContent = data.user.name;
      hideLock();
      loadShift();
    } else if (data) {
      document.getElementById('pin-error').textContent = 'Kassaya icazəniz yoxdur.';
      document.getElementById('waiter-line').textContent = data.user.name;
      showLock();
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
      showLock();
    }
  }

  function kpi(label, value) {
    return '<div class="report-kpi"><p>' + label + '</p><strong>' + money(value) + '</strong></div>';
  }

  function fillHistory(rows) {
    var box = document.getElementById('shift-history');
    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML = '<tr><td colspan="7">Bağlanmış növbə yoxdur.</td></tr>';
      return;
    }
    rows.forEach(function (row) {
      var snap = row.shift.snapshot || {};
      var tot = row.totals || snap.totals || {};
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = formatWhen(row.shift.openedAt);
      cells[1].textContent = formatWhen(row.shift.closedAt);
      cells[2].textContent = money(tot.cash);
      cells[3].textContent = money(tot.card);
      cells[4].textContent = money(row.expectedCash != null ? row.expectedCash : snap.expectedCash);
      cells[5].textContent = money(row.shift.countedCash);
      cells[6].textContent = money(row.difference != null ? row.difference : snap.difference);
      box.appendChild(tr);
    });
  }

  function loadShift() {
    if (!waiter || !canOpenShift()) {
      return;
    }
    say('');
    api('/api/shifts?terminalId=' + encodeURIComponent(terminalId || savedTerminalId() || 0))
      .then(function (body) {
        var data = body.data || {};
        var sel = document.getElementById('shift-terminal');
        var keep = terminalId || savedTerminalId();
        sel.innerHTML = '';
        (data.terminals || []).forEach(function (row) {
          var opt = document.createElement('option');
          opt.value = String(row.id);
          opt.textContent = row.name;
          sel.appendChild(opt);
        });
        if (!sel.options.length) {
          say('Ayarlarda terminal yaradın.', 'err');
          return;
        }
        if (!keep || !sel.querySelector('option[value="' + keep + '"]')) {
          keep = Number(sel.options[0].value);
        }
        sel.value = String(keep);
        terminalId = keep;
        if (keep !== savedTerminalId()) {
          return api('/api/shifts?terminalId=' + keep).then(function (again) {
            renderShift(again.data || {});
          });
        }
        renderShift(data);
      })
      .catch(function (error) {
        if (!terminalId && !savedTerminalId()) {
          api('/api/terminals').then(function (body) {
            var list = (body.data && body.data.terminals) || body.data || [];
            var sel = document.getElementById('shift-terminal');
            sel.innerHTML = '';
            (Array.isArray(list) ? list : []).forEach(function (row) {
              var opt = document.createElement('option');
              opt.value = String(row.id);
              opt.textContent = row.name;
              sel.appendChild(opt);
            });
            if (sel.options.length) {
              terminalId = Number(sel.value);
              loadShift();
            } else {
              say('Ayarlarda terminal yaradın.', 'err');
            }
          }).catch(function (err) {
            say(err.message, 'err');
          });
          return;
        }
        say(error.message, 'err');
      });
  }

  function renderShift(data) {
    var current = data.current;
    var openBox = document.getElementById('shift-open-box');
    var liveBox = document.getElementById('shift-live-box');
    document.getElementById('shift-open-form').style.display = can('payments.take') ? '' : 'none';
    document.getElementById('shift-close-form').style.display = can('payments.take') ? '' : 'none';
    document.getElementById('shift-drop-form').style.display = can('payments.take') ? '' : 'none';
    if (!current) {
      openBox.classList.remove('hidden');
      liveBox.classList.add('hidden');
    } else {
      openBox.classList.add('hidden');
      liveBox.classList.remove('hidden');
      var tot = current.totals || {};
      document.getElementById('shift-open-meta').textContent =
        current.shift.openedByName + ' • ' + formatWhen(current.shift.openedAt) +
        (data.openTables && data.openTables.length ? ' • Açıq: ' + data.openTables.join(', ') : '');
      document.getElementById('shift-kpis').innerHTML =
        '<div class="report-kpi"><p>Satış</p><strong>' + (tot.count || 0) + '</strong></div>' +
        kpi('Nağd', tot.cash) +
        kpi('Kart', tot.card) +
        kpi('Hədiyyə', tot.gift) +
        kpi('İlkin', tot.prepaid) +
        kpi('Qaytarılan nağd', tot.refundCash) +
        kpi('Gözlənilən çekmece', current.expectedCash);
      var drops = current.drops || current.shift.drops || [];
      document.getElementById('shift-drops').textContent = drops.length
        ? ('Çıxarış: ' + drops.map(function (row) {
          return money(row.amount) + (row.note ? ' ' + row.note : '');
        }).join(' • '))
        : '';
      var counted = document.getElementById('shift-counted');
      var autoCash = money(current.expectedCash);
      if (!counted.value || counted.value === counted.getAttribute('data-auto')) {
        counted.value = autoCash;
      }
      counted.setAttribute('data-auto', autoCash);
    }
    fillHistory(data.history || []);
    var pool = data.tipPool || {};
    var poolBox = document.getElementById('tip-pool');
    if (poolBox) {
      poolBox.textContent = pool.total
        ? ('Bəxşiş hovuzu: ' + money(pool.total) + ' / ' + (pool.heads || 1) +
          ' = ' + money(pool.share) + ' AZN')
        : '';
    }
    loadClock();
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
      if (switching && perms.indexOf('payments.take') === -1 && perms.indexOf('reports.view') === -1) {
        document.getElementById('pin-error').textContent = 'Bu PIN ilə kassaya girilməz.';
        pinBuffer = '';
        drawPin();
        return;
      }
      if (switching && waiter && window.PosNav) {
        window.PosNav.forget();
      }
      body.data.fromLogin = true;
      setWaiter(body.data);
      finishSwitch();
    }).catch(function (error) {
      document.getElementById('pin-error').textContent = error.message;
      if (clearOnFail || pinBuffer.length >= 8) {
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
      if (pinBuffer.length >= 6 && key !== 'C') {
        tryLogin(false);
      }
    });
    pinPad.appendChild(btn);
  });

  document.getElementById('shift-terminal').addEventListener('change', function () {
    terminalId = Number(this.value);
    loadShift();
  });
  document.getElementById('shift-open-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('payments.take')) {
      return;
    }
    api('/api/shifts/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminalId: terminalId,
        startingCash: dec(document.getElementById('shift-start').value)
      })
    }).then(function () {
      say('Növbə açıldı.');
      loadShift();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  function loadClock() {
    var box = document.getElementById('clock-list');
    if (!box) {
      return;
    }
    api('/api/clock').then(function (body) {
      var rows = (body.data && body.data.today) || [];
      box.innerHTML = rows.length
        ? rows.map(function (row) {
          return row.userName + ' ' + formatWhen(row.inAt) +
            (row.outAt ? ' → ' + formatWhen(row.outAt) : ' • işdə');
        }).join('<br>')
        : 'Bu gün giriş yoxdur.';
    }).catch(function () {
      box.textContent = '';
    });
  }

  document.getElementById('shift-drop-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('payments.take')) {
      return;
    }
    api('/api/shifts/drop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminalId: terminalId,
        amount: dec(document.getElementById('shift-drop-amt').value),
        note: document.getElementById('shift-drop-note').value
      })
    }).then(function () {
      document.getElementById('shift-drop-amt').value = '';
      document.getElementById('shift-drop-note').value = '';
      say('Nağd çıxarış yazıldı.');
      loadShift();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('gift-form').addEventListener('submit', function (event) {
    event.preventDefault();
    api('/api/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: document.getElementById('gift-code').value,
        amount: dec(document.getElementById('gift-amt').value)
      })
    }).then(function (body) {
      document.getElementById('gift-form').reset();
      say('Kart yükləndi. Qalıq: ' + money(body.data && body.data.balance));
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('clock-toggle').addEventListener('click', function () {
    api('/api/clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (body) {
        say(body.data && body.data.action === 'in' ? 'İşə giriş yazıldı.' : 'İşdən çıxış yazıldı.');
        loadClock();
      })
      .catch(function (error) {
        say(error.message, 'err');
      });
  });

  document.getElementById('shift-close-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('payments.take')) {
      return;
    }
    api('/api/shifts/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminalId: terminalId,
        countedCash: dec(document.getElementById('shift-counted').value),
        note: document.getElementById('shift-note').value
      })
    }).then(function (body) {
      var diff = body.data && body.data.difference;
      var msg = diff === 0 ? 'Növbə bağlandı. Çekmece tutdu.' : ('Növbə bağlandı. Fərq: ' + money(diff));
      if (body.warning) {
        msg += ' ' + body.warning;
      } else {
        msg += ' Z çapıldı.';
      }
      say(msg, body.warning ? 'warn' : 'ok');
      document.getElementById('shift-counted').value = '';
      document.getElementById('shift-note').value = '';
      loadShift();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('shift-print-z').addEventListener('click', function () {
    if (!can('payments.take')) {
      return;
    }
    api('/api/shifts/print-z', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalId: terminalId })
    }).then(function (body) {
      say(body.warning || 'Z çapıldı.', body.warning ? 'warn' : 'ok');
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('logout').addEventListener('click', function () {
    switching = false;
    setWaiter(null);
  });
  document.getElementById('switch-waiter').addEventListener('click', startSwitch);
  document.getElementById('pin-switch-back').addEventListener('click', cancelSwitch);
  window.addEventListener('pos-pin-changed', function () {
    if (waiter) {
      loadShift();
    }
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
})();
