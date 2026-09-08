(function () {
  var waiter = null;
  var pinBuffer = '';
  var mode = 'day';

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

  function twoDigits(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toInputDate(date) {
    return date.getFullYear() + '-' + twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate());
  }

  function lastDayOfMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function kindLabel(kind) {
    var map = {
      login: 'Giriş',
      logout: 'Çıxış',
      accept: 'Sifariş',
      pay: 'Ödəniş',
      void: 'Ləğv',
      discount: 'Endirim',
      move: 'Köçür',
      refund: 'Geri',
      reserve: 'Rezerv',
      stock: 'Anbar',
      block: 'Blok',
      shift: 'Növbə'
    };
    return map[kind] || kind || '—';
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

  function drawPin() {
    document.getElementById('pin-dots').textContent = pinBuffer
      ? new Array(pinBuffer.length + 1).join('•')
      : '○ ○ ○ ○ ○ ○';
  }

  function canOpen() {
    return !!(waiter && can('logs.view'));
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
    if (data && canOpen()) {
      document.getElementById('waiter-line').textContent = data.user.name;
      hideLock();
      loadJournal();
    } else if (data) {
      document.getElementById('pin-error').textContent = 'Jurnala icazəniz yoxdur.';
      document.getElementById('waiter-line').textContent = data.user.name;
      showLock();
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
      showLock();
    }
  }

  function setMode(next) {
    mode = next;
    document.getElementById('jr-day-wrap').classList.toggle('hidden', mode !== 'day');
    document.getElementById('jr-month-wrap').classList.toggle('hidden', mode !== 'month');
    document.getElementById('jr-from-wrap').classList.toggle('hidden', mode !== 'range');
    document.getElementById('jr-to-wrap').classList.toggle('hidden', mode !== 'range');
    document.querySelectorAll('.report-presets button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
  }

  function bounds() {
    if (mode === 'month') {
      var month = document.getElementById('jr-month').value;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new Error('Ay seçin.');
      }
      var year = Number(month.slice(0, 4));
      var mon = Number(month.slice(5, 7));
      return {
        from: month + '-01',
        to: month + '-' + twoDigits(lastDayOfMonth(year, mon))
      };
    }
    if (mode === 'range') {
      return {
        from: document.getElementById('jr-from').value,
        to: document.getElementById('jr-to').value
      };
    }
    var day = document.getElementById('jr-day').value;
    return { from: day, to: day };
  }

  function loadJournal() {
    var range;
    try {
      range = bounds();
    } catch (error) {
      say(error.message, 'err');
      return;
    }
    if (!range.from || !range.to) {
      say('Tarix seçin.', 'err');
      return;
    }
    api('/api/journal?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to))
      .then(function (body) {
        var rows = (body.data && body.data.rows) || [];
        var box = document.getElementById('jr-body');
        box.innerHTML = '';
        if (!rows.length) {
          box.innerHTML = '<tr><td colspan="4">Bu aralıqda əməliyyat yoxdur.</td></tr>';
          say('');
          return;
        }
        rows.slice().reverse().forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = formatWhen(row.at);
          cells[1].textContent = row.userName || '—';
          cells[2].textContent = kindLabel(row.kind);
          cells[3].textContent = row.text || '';
          box.appendChild(tr);
        });
        say(rows.length + ' əməliyyat.');
      })
      .catch(function (error) {
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

  document.querySelectorAll('.report-presets button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setMode(btn.getAttribute('data-mode'));
      loadJournal();
    });
  });
  document.getElementById('jr-load').addEventListener('click', loadJournal);
  document.getElementById('logout').addEventListener('click', function () {
    setWaiter(null);
  });

  var today = new Date();
  document.getElementById('jr-day').value = toInputDate(today);
  document.getElementById('jr-month').value = today.getFullYear() + '-' + twoDigits(today.getMonth() + 1);
  document.getElementById('jr-from').value = toInputDate(today);
  document.getElementById('jr-to').value = toInputDate(today);
  if (window.PosDates) {
    window.PosDates.refresh(document.getElementById('jr-day'));
    window.PosDates.refresh(document.getElementById('jr-month'));
    window.PosDates.refresh(document.getElementById('jr-from'));
    window.PosDates.refresh(document.getElementById('jr-to'));
  }
  setMode('day');

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
      loadJournal();
    }
  });
})();
