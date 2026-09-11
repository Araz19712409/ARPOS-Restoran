(function () {
  var waiter = null;
  var pinBuffer = '';
  var rangeKey = 'today';
  var lastReport = null;

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

  function formatWhen(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return twoDigits(d.getDate()) + '.' + twoDigits(d.getMonth() + 1) + ' ' + twoDigits(d.getHours()) + ':' + twoDigits(d.getMinutes());
  }

  function emptyRow(box, cols, text) {
    box.innerHTML = '<tr><td colspan="' + cols + '"></td></tr>';
    box.querySelector('td').textContent = text;
  }

  function drawHours(hours) {
    var box = document.getElementById('hour-strip');
    box.innerHTML = '';
    var list = hours || [];
    var max = 0;
    list.forEach(function (row) {
      if (Number(row.total) > max) {
        max = Number(row.total);
      }
    });
    if (max <= 0) {
      max = 1;
    }
    list.forEach(function (row) {
      var col = document.createElement('div');
      col.className = 'hour-col' + (row.count ? '' : ' empty');
      var bar = document.createElement('i');
      var height = row.count ? Math.max(8, Math.round(Number(row.total) / max * 72)) : 2;
      bar.style.height = height + 'px';
      var label = document.createElement('span');
      label.textContent = twoDigits(row.hour);
      col.title = twoDigits(row.hour) + ':00 — ' + (row.count || 0) + ' çek, ' + Number(row.total || 0).toFixed(2) + ' AZN';
      col.appendChild(bar);
      col.appendChild(label);
      box.appendChild(col);
    });
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
    var branch = document.getElementById('rep-branch').value;
    var q = '/api/reports/sales?waiterId=' + waiter.user.id +
      '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    if (branch) {
      q += '&branch=' + encodeURIComponent(branch);
    }
    api(q)
      .then(function (body) {
        var data = body.data;
        lastReport = data;
        var sum = data.summary;
        var branchBox = document.getElementById('rep-branch');
        var keep = branchBox.value;
        branchBox.innerHTML = '<option value="">Hamısı</option>';
        (data.branches || []).forEach(function (row) {
          var opt = document.createElement('option');
          opt.value = row.id;
          opt.textContent = row.name;
          branchBox.appendChild(opt);
        });
        if (keep) {
          branchBox.value = keep;
        }
        window.PosDom.kpis(document.getElementById('report-kpis'), [
          { label: 'Satış', value: String(sum.count) },
          { label: 'Cəm', value: money(sum.total) },
          { label: 'Nağd', value: money(sum.cash) },
          { label: 'Kart', value: money(sum.card) },
          { label: 'İlkin', value: money(sum.prepaid) },
          { label: 'Hədiyyə', value: money(sum.gift) },
          { label: 'Xidmət', value: money(sum.service) },
          { label: 'Bonus', value: money(sum.bonus) },
          sum.cost != null ? { label: 'Maya', value: money(sum.cost) } : null,
          sum.cost != null ? { label: 'Mənfəət', value: money(sum.profit) } : null,
          { label: 'Endirim', value: money(sum.discountTotal) },
          { label: 'Ləğv', value: money(sum.voidTotal) },
          { label: 'Geri', value: money(sum.refundTotal) }
        ]);

        drawHours(data.hours);

        var salesBox = document.getElementById('sales-body');
        salesBox.innerHTML = '';
        if (!data.sales.length) {
          salesBox.innerHTML = '<tr><td colspan="10">Bu aralıqda satış yoxdur.</td></tr>';
        }
        data.sales.forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = formatWhen(row.at);
          cells[1].textContent = row.tableName;
          cells[2].textContent = row.waiterName;
          cells[3].textContent = methodLabel(row.method);
          cells[4].textContent = Number(row.cash).toFixed(2);
          cells[5].textContent = Number(row.card).toFixed(2);
          cells[6].textContent = Number(row.prepaid).toFixed(2);
          cells[7].textContent = Number(row.service || 0).toFixed(2);
          cells[8].textContent = Number(row.bonus || 0).toFixed(2);
          cells[9].textContent = Number(row.total).toFixed(2);
          salesBox.appendChild(tr);
        });

        var waiterBox = document.getElementById('waiter-body');
        waiterBox.innerHTML = '';
        var waiters = data.waiters || [];
        if (!waiters.length) {
          waiterBox.innerHTML = '<tr><td colspan="5">Ofisiant yoxdur.</td></tr>';
        }
        waiters.forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = row.name;
          cells[1].textContent = String(row.count);
          cells[2].textContent = Number(row.total).toFixed(2) + ' AZN';
          cells[3].textContent = Number(row.service).toFixed(2) + ' AZN';
          cells[4].textContent = Number(row.bonus).toFixed(2) + ' AZN';
          waiterBox.appendChild(tr);
        });

        var prodBox = document.getElementById('product-body');
        prodBox.innerHTML = '';
        if (!data.products.length) {
          emptyRow(prodBox, 5, 'Məhsul yoxdur.');
        }
        data.products.forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = row.name;
          var tag = document.createElement('span');
          tag.className = 'abc-tag abc-' + String(row.abc || 'c').toLowerCase();
          tag.textContent = row.abc || 'C';
          cells[1].appendChild(tag);
          cells[2].textContent = row.qty;
          cells[3].textContent = Number(row.total).toFixed(2) + ' AZN';
          cells[4].textContent = Number(row.share || 0).toFixed(1) + '%';
          prodBox.appendChild(tr);
        });

        var voidBox = document.getElementById('void-body');
        voidBox.innerHTML = '';
        var voidRows = data.voids || [];
        if (!voidRows.length) {
          emptyRow(voidBox, 6, 'Ləğv yoxdur.');
        }
        voidRows.forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = formatWhen(row.at);
          cells[1].textContent = row.tableName;
          cells[2].textContent = row.name;
          cells[3].textContent = String(row.qty);
          cells[4].textContent = Number(row.total).toFixed(2);
          cells[5].textContent = row.by || '';
          voidBox.appendChild(tr);
        });

        var discBox = document.getElementById('discount-body');
        discBox.innerHTML = '';
        var discRows = data.discounts || [];
        if (!discRows.length) {
          emptyRow(discBox, 5, 'Endirim yoxdur.');
        }
        discRows.forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = formatWhen(row.at);
          cells[1].textContent = row.tableName;
          cells[2].textContent = row.waiterName;
          cells[3].textContent = Number(row.total).toFixed(2);
          cells[4].textContent = row.reason || '';
          discBox.appendChild(tr);
        });

        var refundBox = document.getElementById('refund-body');
        refundBox.innerHTML = '';
        var refundRows = data.refunds || [];
        if (!refundRows.length) {
          emptyRow(refundBox, 5, 'Qaytarma yoxdur.');
        }
        refundRows.forEach(function (row) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
          var cells = tr.querySelectorAll('td');
          cells[0].textContent = formatWhen(row.at);
          cells[1].textContent = row.tableName;
          cells[2].textContent = row.waiterName;
          cells[3].textContent = Number(row.total).toFixed(2);
          cells[4].textContent = row.reason || '';
          refundBox.appendChild(tr);
        });
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
      applyRange(btn.getAttribute('data-range'));
      loadReport();
    });
  });
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

  document.getElementById('rep-csv').addEventListener('click', function () {
    if (!lastReport || !lastReport.sales) {
      say('Əvvəl Göstər basın.', 'warn');
      return;
    }
    var from = document.getElementById('rep-from').value;
    var to = document.getElementById('rep-to').value;
    var rows = [['Vaxt', 'Masa', 'Ofisiant', 'Üsul', 'Nağd', 'Kart', 'İlkin', 'Xidmət', 'Bonus', 'Cəm']];
    lastReport.sales.forEach(function (row) {
      rows.push([
        formatWhen(row.at),
        row.tableName,
        row.waiterName,
        methodLabel(row.method),
        Number(row.cash).toFixed(2),
        Number(row.card).toFixed(2),
        Number(row.prepaid).toFixed(2),
        Number(row.service || 0).toFixed(2),
        Number(row.bonus || 0).toFixed(2),
        Number(row.total).toFixed(2)
      ]);
    });
    var sum = lastReport.summary || {};
    rows.push([]);
    rows.push(['Cəm', '', '', '', Number(sum.cash || 0).toFixed(2), Number(sum.card || 0).toFixed(2), Number(sum.prepaid || 0).toFixed(2), '', '', Number(sum.total || 0).toFixed(2)]);
    downloadCsv('satis-' + from + '-' + to + '.csv', rows);
    say('CSV yükləndi.', 'ok');
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
