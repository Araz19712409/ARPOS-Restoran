(function () {
  var waiter = null;
  var pinBuffer = '';
  var tab = 'satis';
  var HINTS = {
    satis: 'Ödənilmiş satış, saat, ABC, ləğv, endirim və geri.',
    ofisiant: 'Ofisiant satış və bonus.',
    muhasib: 'Kassa, ödəniş, P&L, 1C, borc, qalıq, maaş.',
    jurnal: 'Kim, nə vaxt, nə etdi.'
  };

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

  function can(key) {
    return waiter && waiter.permissions && waiter.permissions.indexOf(key) !== -1;
  }

  function twoDigits(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toInputDate(date) {
    return date.getFullYear() + '-' + twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate());
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

  function parseHash() {
    var raw = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
    if (raw === 'sales' || raw === 'satis') {
      return 'satis';
    }
    if (raw === 'waiter' || raw === 'ofisiant') {
      return 'ofisiant';
    }
    if (raw === 'books' || raw === 'muhasib') {
      return 'muhasib';
    }
    if (raw === 'journal' || raw === 'jurnal' || raw === 'logs') {
      return 'jurnal';
    }
    return '';
  }

  function visibleTabs() {
    var list = [];
    if (can('reports.view')) {
      list.push('satis', 'ofisiant', 'muhasib');
    }
    if (can('logs.view')) {
      list.push('jurnal');
    }
    return list;
  }

  function syncWaiters(data) {
    if (window.PosSales && window.PosSales.setWaiter) {
      window.PosSales.setWaiter(data);
    }
    if (window.PosWaiterRep && window.PosWaiterRep.setWaiter) {
      window.PosWaiterRep.setWaiter(data);
    }
    if (window.PosBooks && window.PosBooks.setWaiter) {
      window.PosBooks.setWaiter(data);
    }
    if (window.PosJournal && window.PosJournal.setWaiter) {
      window.PosJournal.setWaiter(data);
    }
  }

  function loadActive() {
    if (tab === 'satis' && window.PosSales) {
      window.PosSales.load();
    } else if (tab === 'ofisiant' && window.PosWaiterRep) {
      window.PosWaiterRep.load();
    } else if (tab === 'muhasib' && window.PosBooks) {
      window.PosBooks.load();
    } else if (tab === 'jurnal' && window.PosJournal) {
      window.PosJournal.load();
    }
  }

  function applyRange(key) {
    var fromEl = document.getElementById('rep-from');
    var toEl = document.getElementById('rep-to');
    if (window.PosDates) {
      window.PosDates.applyPreset(fromEl, toEl, key);
    } else {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var from = new Date(today);
      var to = new Date(today);
      if (key === 'yesterday') {
        from.setDate(from.getDate() - 1);
        to.setDate(to.getDate() - 1);
      } else if (key === 'week') {
        var day = from.getDay();
        from.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
      } else if (key === 'days7') {
        from.setDate(from.getDate() - 6);
      } else if (key === 'month') {
        from.setDate(1);
      } else if (key === 'lastmonth') {
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
      }
      fromEl.value = toInputDate(from);
      toEl.value = toInputDate(to);
    }
    document.querySelectorAll('.report-presets button').forEach(function (btn) {
      btn.className = btn.getAttribute('data-range') === key ? 'active' : '';
    });
  }

  function showTab(id, opts) {
    opts = opts || {};
    var vis = visibleTabs();
    document.querySelectorAll('.report-tab').forEach(function (btn) {
      var need = btn.getAttribute('data-need');
      btn.hidden = vis.indexOf(btn.getAttribute('data-tab')) === -1;
      if (need === 'logs.view') {
        btn.hidden = !can('logs.view');
      }
      if (need === 'reports.view') {
        btn.hidden = !can('reports.view');
      }
    });
    if (vis.indexOf(id) === -1) {
      id = vis[0] || '';
    }
    if (!id) {
      return;
    }
    tab = id;
    document.body.setAttribute('data-tab', id);
    document.querySelectorAll('.report-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === id);
    });
    document.querySelectorAll('.report-panel').forEach(function (panel) {
      panel.classList.toggle('hidden', panel.getAttribute('data-tab') !== id);
    });
    var hash = '#' + id;
    if (window.location.hash !== hash) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', hash);
      } else {
        window.location.hash = id;
      }
    }
    if (waiter && waiter.user) {
      document.getElementById('waiter-line').textContent =
        waiter.user.name + ' • ' + (HINTS[id] || '');
    }
    if (!opts.skipLoad) {
      loadActive();
    }
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
    syncWaiters(data);
    if (window.PosNav && !window.PosNav.afterLogin(data)) {
      return;
    }
    var vis = visibleTabs();
    if (data && vis.length) {
      hideLock();
      showTab(parseHash() || vis[0]);
    } else if (data) {
      document.getElementById('pin-error').textContent = 'Hesabata icazəniz yoxdur.';
      document.getElementById('waiter-line').textContent = data.user.name;
      showLock();
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
      showLock();
    }
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
      document.getElementById('pin-error').textContent = '';
      pinBuffer = '';
      drawPin();
      body.data.fromLogin = true;
      setWaiter(body.data);
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

  document.getElementById('report-tabs').addEventListener('click', function (event) {
    var btn = event.target.closest('.report-tab');
    if (!btn || btn.hidden) {
      return;
    }
    showTab(btn.getAttribute('data-tab'));
  });

  document.querySelectorAll('.report-presets button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyRange(btn.getAttribute('data-range'));
      loadActive();
    });
  });

  document.getElementById('rep-load').addEventListener('click', function () {
    document.querySelectorAll('.report-presets button').forEach(function (btn) {
      btn.className = '';
    });
    loadActive();
  });

  document.getElementById('rep-csv').addEventListener('click', function () {
    if (tab === 'satis' && window.PosSales && window.PosSales.csv) {
      window.PosSales.csv();
    } else if (tab === 'muhasib' && window.PosBooks && window.PosBooks.csv) {
      window.PosBooks.csv();
    }
  });

  document.getElementById('rep-print').addEventListener('click', function () {
    window.print();
  });

  ['rep-from', 'rep-to'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', function () {
      document.querySelectorAll('.report-presets button').forEach(function (btn) {
        btn.className = '';
      });
    });
  });

  document.getElementById('logout').addEventListener('click', function () {
    setWaiter(null);
  });

  window.addEventListener('hashchange', function () {
    if (!waiter) {
      return;
    }
    showTab(parseHash() || visibleTabs()[0] || 'satis');
  });

  window.addEventListener('pos-pin-changed', function () {
    if (waiter) {
      loadActive();
    }
  });

  applyRange('today');
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
