(function () {
  var waiter = null;
  var pinBuffer = '';
  var rangeKey = 'today';
  var lastReport = null;
  var tab = 'cash';

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
    if (value == null) {
      return '—';
    }
    return Number(value || 0).toFixed(2) + ' AZN';
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

  function methodLabel(method) {
    if (method === 'card') {
      return 'Kart';
    }
    if (method === 'mixed') {
      return 'Qarışıq';
    }
    if (method === 'prepaid') {
      return 'İlkin';
    }
    if (method === 'gift') {
      return 'Hədiyyə';
    }
    return 'Nağd';
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

  function showTab(name) {
    tab = name;
    document.querySelectorAll('.books-tabs button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
    });
    document.getElementById('tab-cash').classList.toggle('hidden', name !== 'cash');
    document.getElementById('tab-pay').classList.toggle('hidden', name !== 'pay');
    document.getElementById('tab-pnl').classList.toggle('hidden', name !== 'pnl');
    document.getElementById('tab-ledger').classList.toggle('hidden', name !== 'ledger');
  }

  function fillTable(id, cols, rows, emptyText) {
    var box = document.getElementById(id);
    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML = '<tr><td colspan="' + cols + '"></td></tr>';
      box.querySelector('td').textContent = emptyText;
      return;
    }
    rows.forEach(function (cells) {
      var tr = document.createElement('tr');
      cells.forEach(function (text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      box.appendChild(tr);
    });
  }

  function drawKpis(data) {
    var pay = data.payments || {};
    var pnl = data.pnl || {};
    var sum = data.cashSum || {};
    document.getElementById('report-kpis').innerHTML =
      '<div class="report-kpi"><span>Satış</span><strong>' + money(pay.total) + '</strong></div>' +
      '<div class="report-kpi"><span>Nağd</span><strong>' + money(pay.cash) + '</strong></div>' +
      '<div class="report-kpi"><span>Kart</span><strong>' + money(pay.card) + '</strong></div>' +
      '<div class="report-kpi"><span>Hədiyyə</span><strong>' + money(pay.gift) + '</strong></div>' +
      '<div class="report-kpi"><span>Kəsir</span><strong>' + money(sum.difference) + '</strong></div>' +
      (pnl.profit != null
        ? '<div class="report-kpi"><span>Mənfəət</span><strong>' + money(pnl.profit) + '</strong></div>'
        : '');
  }

  function drawCash(data) {
    var rows = (data.cashbook || []).map(function (row) {
      return [
        formatWhen(row.openedAt),
        row.terminalName,
        Number(row.start).toFixed(2),
        Number(row.cash).toFixed(2),
        Number(row.card).toFixed(2),
        Number(row.gift).toFixed(2),
        Number(row.drops).toFixed(2),
        Number(row.expected).toFixed(2),
        row.counted == null ? '—' : Number(row.counted).toFixed(2),
        row.difference == null ? '—' : Number(row.difference).toFixed(2)
      ];
    });
    fillTable('cash-body', 10, rows, 'Bu aralıqda növbə yoxdur.');
  }

  function drawPay(data) {
    var methods = (data.methods || []).map(function (row) {
      return [methodLabel(row.method), String(row.count), Number(row.total).toFixed(2)];
    });
    fillTable('method-body', 3, methods, 'Satış yoxdur.');
    var days = (data.days || []).map(function (row) {
      return [
        row.date,
        String(row.count),
        Number(row.cash).toFixed(2),
        Number(row.card).toFixed(2),
        Number(row.gift).toFixed(2),
        Number(row.prepaid).toFixed(2),
        Number(row.total).toFixed(2),
        Number(row.refundCash).toFixed(2),
        Number(row.refundCard).toFixed(2)
      ];
    });
    fillTable('day-body', 9, days, 'Günlük sətir yoxdur.');
  }

  function addLine(rows, name, value) {
    if (value == null) {
      return;
    }
    rows.push([name, Number(value).toFixed(2)]);
  }

  function drawPnl(data) {
    var pnl = data.pnl || {};
    var rows = [];
    addLine(rows, 'Satış', pnl.sales);
    addLine(rows, 'Maya', pnl.cost);
    addLine(rows, 'Zay', pnl.waste);
    addLine(rows, 'Alış', pnl.purchases);
    addLine(rows, 'Endirim', pnl.discount);
    addLine(rows, 'Pulsuz', pnl.complimentary);
    addLine(rows, 'Geri', pnl.refund);
    addLine(rows, 'Mənfəət', pnl.profit);
    fillTable('pnl-body', 2, rows, 'Məlumat yoxdur.');
    var waste = (data.waste || []).map(function (row) {
      return [
        formatWhen(row.at),
        row.name,
        row.kind,
        String(row.qty),
        Number(row.total).toFixed(2)
      ];
    });
    fillTable('waste-body', 5, waste, 'Zay yoxdur.');
  }

  function dash(value) {
    return value == null ? '—' : Number(value).toFixed(2);
  }

  function drawLedger(data) {
    var rows = (data.ledger || []).map(function (row) {
      return [
        row.date,
        Number(row.cash).toFixed(2),
        Number(row.card).toFixed(2),
        Number(row.gift).toFixed(2),
        Number(row.prepaid).toFixed(2),
        Number(row.refundCash).toFixed(2),
        Number(row.refundCard).toFixed(2),
        Number(row.drops).toFixed(2),
        dash(row.purchases),
        dash(row.waste),
        Number(row.discount).toFixed(2),
        Number(row.complimentary).toFixed(2),
        Number(row.difference).toFixed(2)
      ];
    });
    fillTable('ledger-body', 13, rows, 'Bu aralıqda sətir yoxdur.');
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
      fromEl.value = from.getFullYear() + '-' + twoDigits(from.getMonth() + 1) + '-' + twoDigits(from.getDate());
      toEl.value = to.getFullYear() + '-' + twoDigits(to.getMonth() + 1) + '-' + twoDigits(to.getDate());
    }
    document.querySelectorAll('.report-presets button').forEach(function (btn) {
      btn.className = btn.getAttribute('data-range') === key ? 'active' : '';
    });
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
    say('');
    api('/api/reports/books?waiterId=' + waiter.user.id +
      '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
      .then(function (body) {
        lastReport = body.data;
        drawKpis(lastReport);
        drawCash(lastReport);
        drawPay(lastReport);
        drawPnl(lastReport);
        drawLedger(lastReport);
      })
      .catch(function (error) {
        say(error.message, 'err');
      });
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    if (/[";\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadCsv(name, rows) {
    var text = '\uFEFF' + rows.map(function (row) {
      return row.map(csvCell).join(';');
    }).join('\r\n');
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
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
    pad.appendChild(btn);
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
  });

  document.querySelectorAll('.report-presets button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyRange(btn.getAttribute('data-range'));
      loadReport();
    });
  });
  document.querySelectorAll('.books-tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showTab(btn.getAttribute('data-tab'));
    });
  });
  document.getElementById('rep-load').addEventListener('click', loadReport);
  document.getElementById('rep-csv').addEventListener('click', function () {
    if (!lastReport) {
      say('Əvvəl Göstər basın.', 'warn');
      return;
    }
    var from = document.getElementById('rep-from').value;
    var to = document.getElementById('rep-to').value;
    var rows;
    if (tab === 'ledger') {
      rows = [['Tarix', 'Nağd', 'Kart', 'Hədiyyə', 'İlkin', 'Geri nağd', 'Geri kart', 'Çıxarış', 'Alış', 'Zay', 'Endirim', 'Pulsuz', 'Kəsir']];
      (lastReport.ledger || []).forEach(function (row) {
        rows.push([
          row.date, row.cash, row.card, row.gift, row.prepaid, row.refundCash, row.refundCard,
          row.drops, row.purchases, row.waste, row.discount, row.complimentary, row.difference
        ]);
      });
      downloadCsv('1c-' + from + '-' + to + '.csv', rows);
      return;
    }
    if (tab === 'pay') {
      rows = [['Tarix', 'Çek', 'Nağd', 'Kart', 'Hədiyyə', 'İlkin', 'Cəm', 'Geri nağd', 'Geri kart']];
      (lastReport.days || []).forEach(function (row) {
        rows.push([row.date, row.count, row.cash, row.card, row.gift, row.prepaid, row.total, row.refundCash, row.refundCard]);
      });
      downloadCsv('odenis-' + from + '-' + to + '.csv', rows);
      return;
    }
    if (tab === 'pnl') {
      rows = [['Sətir', 'Məbləğ']];
      var pnl = lastReport.pnl || {};
      rows.push(['Satış', pnl.sales]);
      rows.push(['Maya', pnl.cost]);
      rows.push(['Zay', pnl.waste]);
      rows.push(['Alış', pnl.purchases]);
      rows.push(['Endirim', pnl.discount]);
      rows.push(['Pulsuz', pnl.complimentary]);
      rows.push(['Geri', pnl.refund]);
      rows.push(['Mənfəət', pnl.profit]);
      downloadCsv('pnl-' + from + '-' + to + '.csv', rows);
      return;
    }
    rows = [['Açılıb', 'Kassa', 'Başlanğıc', 'Nağd', 'Kart', 'Hədiyyə', 'Çıxarış', 'Gözlənilən', 'Sayılan', 'Fərq']];
    (lastReport.cashbook || []).forEach(function (row) {
      rows.push([
        formatWhen(row.openedAt), row.terminalName, row.start, row.cash, row.card, row.gift,
        row.drops, row.expected, row.counted, row.difference
      ]);
    });
    downloadCsv('kassa-' + from + '-' + to + '.csv', rows);
  });
  ['rep-from', 'rep-to'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', function () {
      rangeKey = '';
      document.querySelectorAll('.report-presets button').forEach(function (btn) {
        btn.className = '';
      });
    });
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
}());
