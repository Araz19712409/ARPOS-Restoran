(function () {
  var waiter = null;
  var pinBuffer = '';
  var rangeKey = 'today';

  function inHub() {
    return !!document.getElementById('report-hub');
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
    return Number(value || 0).toFixed(2) + ' AZN';
  }

  function twoDigits(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toInputDate(date) {
    return date.getFullYear() + '-' + twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate());
  }

  function formatDay(value) {
    var p = String(value || '').split('-');
    if (p.length !== 3) {
      return value || '';
    }
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function emptyRow() {
    return { count: 0, cash: 0, card: 0, service: 0, total: 0, bonus: 0 };
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
    document.getElementById('pin-dots').textContent = pinBuffer ? new Array(pinBuffer.length + 1).join('•') : '○ ○ ○ ○ ○ ○';
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
    if (window.PosNav && !window.PosNav.afterLogin(data)) {
      return;
    }
    if (data && can('reports.view')) {
      document.getElementById('waiter-line').textContent = data.user.name;
      hideLock();
      loadReport();
    } else if (data) {
      document.getElementById('pin-error').textContent = 'Hesabata icazəniz yoxdur.';
      document.getElementById('waiter-line').textContent = data.user.name;
      showLock();
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
      showLock();
    }
  }

  function applyRange(key) {
    rangeKey = key;
    var fromEl = document.getElementById('rep-from');
    var toEl = document.getElementById('rep-to');
    if (window.PosDates) {
      window.PosDates.applyPreset(fromEl, toEl, key);
    } else {
      var from = new Date();
      from.setHours(0, 0, 0, 0);
      var to = new Date(from);
      if (key === 'yesterday') {
        from.setDate(from.getDate() - 1);
        to.setDate(to.getDate() - 1);
      } else if (key === 'month') {
        from.setDate(1);
      } else if (key === 'days7') {
        from.setDate(from.getDate() - 6);
      } else if (key === 'week') {
        var day = from.getDay();
        from.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
      } else if (key === 'lastmonth') {
        var today = new Date(from);
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

  function rangeTitle(from, to) {
    if (from === to) {
      return formatDay(from) + ' — ofisiant satışı və bonus';
    }
    return formatDay(from) + ' — ' + formatDay(to) + ' • ofisiant satışı və bonus';
  }

  function loadReport() {
    if (!waiter || !can('reports.view')) {
      return;
    }
    var from = document.getElementById('rep-from').value;
    var to = document.getElementById('rep-to').value;
    if (!from || !to) {
      applyRange('today');
      from = document.getElementById('rep-from').value;
      to = document.getElementById('rep-to').value;
    }
    if (from > to) {
      say('Başlanğıc son tarixdən böyük ola bilməz.', 'err');
      return;
    }
    document.getElementById('day-title').textContent = rangeTitle(from, to);
    say('');
    Promise.all([
      api('/api/reports/sales?waiterId=' + waiter.user.id + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
      api('/api/settings').catch(function () {
        return api('/api/acl');
      })
    ]).then(function (parts) {
      var data = parts[0].data;
      var staff = (parts[1].data.users || []).slice();
      var map = {};
      staff.forEach(function (user) {
        map[user.name] = emptyRow();
        map[user.name].name = user.name;
      });
      (data.sales || []).forEach(function (row) {
        var name = row.waiterName || '—';
        if (!map[name]) {
          map[name] = emptyRow();
          map[name].name = name;
        }
        map[name].count += 1;
        map[name].cash += Number(row.cash) || 0;
        map[name].card += Number(row.card) || 0;
        map[name].service += Number(row.service) || 0;
        map[name].total += Number(row.total) || 0;
        map[name].bonus += Number(row.bonus) || 0;
      });
      var rows = Object.keys(map).map(function (key) { return map[key]; });
      rows.sort(function (a, b) { return b.bonus - a.bonus || b.total - a.total; });

      var foot = emptyRow();
      rows.forEach(function (row) {
        foot.count += row.count;
        foot.cash += row.cash;
        foot.card += row.card;
        foot.service += row.service;
        foot.total += row.total;
        foot.bonus += row.bonus;
      });

      window.PosDom.kpis(document.getElementById('waiter-kpis') || document.getElementById('report-kpis'), [
        { label: 'Ofisiant', value: String(rows.length) },
        { label: 'Satış', value: String(foot.count) },
        { label: 'Cəm', value: money(foot.total) },
        { label: 'Xidmət', value: money(foot.service) },
        { label: 'Bonus', value: money(foot.bonus) }
      ]);

      var box = document.getElementById('waiter-rep-body') || document.getElementById('waiter-body');
      box.innerHTML = '';
      if (!rows.length) {
        box.innerHTML = '<tr><td colspan="7">Bu aralıqda ofisiant satışı yoxdur.</td></tr>';
      }
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
        var cells = tr.querySelectorAll('td');
        cells[0].textContent = row.name;
        cells[1].textContent = String(row.count);
        cells[2].textContent = Number(row.cash).toFixed(2);
        cells[3].textContent = Number(row.card).toFixed(2);
        cells[4].textContent = Number(row.service).toFixed(2);
        cells[5].textContent = Number(row.total).toFixed(2);
        cells[6].textContent = Number(row.bonus).toFixed(2);
        box.appendChild(tr);
      });

      var footRow = document.createElement('tr');
      [
        'Cəm',
        String(foot.count),
        Number(foot.cash).toFixed(2),
        Number(foot.card).toFixed(2),
        Number(foot.service).toFixed(2),
        Number(foot.total).toFixed(2),
        Number(foot.bonus).toFixed(2)
      ].forEach(function (cell) {
        var td = document.createElement('td');
        td.textContent = cell;
        footRow.appendChild(td);
      });
      document.getElementById('waiter-foot').textContent = '';
      document.getElementById('waiter-foot').appendChild(footRow);
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

  window.PosWaiterRep = {
    load: loadReport,
    setWaiter: function (data) { waiter = data; }
  };

  if (inHub()) {
    return;
  }

  var pinPad = document.getElementById('pin-pad');
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
    pinPad.appendChild(btn);
  });

  document.querySelectorAll('.report-presets button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyRange(btn.getAttribute('data-range'));
      loadReport();
    });
  });
  document.getElementById('rep-load').addEventListener('click', function () {
    rangeKey = '';
    document.querySelectorAll('.report-presets button').forEach(function (btn) {
      btn.className = '';
    });
    loadReport();
  });
  ['rep-from', 'rep-to'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', function () {
      rangeKey = '';
      document.querySelectorAll('.report-presets button').forEach(function (btn) {
        btn.className = '';
      });
    });
  });
  document.getElementById('rep-print').addEventListener('click', function () {
    window.print();
  });
  document.getElementById('logout').addEventListener('click', function () {
    setWaiter(null);
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
  window.addEventListener('pos-pin-changed', function () {
    if (waiter) {
      loadReport();
    }
  });
})();
