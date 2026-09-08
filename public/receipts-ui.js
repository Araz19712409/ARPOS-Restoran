(function () {
  var waiter = null;
  var pinBuffer = '';
  var paid = [];
  var lastReceipt = null;

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

  function formatWhen(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return twoDigits(d.getDate()) + '.' + twoDigits(d.getMonth() + 1) + ' ' + twoDigits(d.getHours()) + ':' + twoDigits(d.getMinutes());
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
    if (data && (can('reports.view') || can('payments.take'))) {
      document.getElementById('waiter-line').textContent = data.user.name;
      hideLock();
      loadList();
    } else if (data) {
      document.getElementById('pin-error').textContent = 'Çeklərə icazəniz yoxdur.';
      document.getElementById('waiter-line').textContent = data.user.name;
      showLock();
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
      showLock();
    }
  }

  function applyRange(key) {
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

  function inRange(iso, from, to) {
    var at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
      return false;
    }
    var start = new Date(from + 'T00:00:00');
    var end = new Date(to + 'T23:59:59.999');
    return at >= start && at <= end;
  }

  function openReceipt(order) {
    lastReceipt = order;
    window.ReceiptView.fill(document.getElementById('receipt-paper'), order);
    document.getElementById('receipt-msg').textContent = order.status === 'refunded'
      ? ('Qaytarılıb' + (order.refund && order.refund.reason ? ': ' + order.refund.reason : '.'))
      : 'Çapdan qabaq görünüş.';
    document.getElementById('receipt-refund').style.display =
      can('payments.refund') && order.status === 'paid' ? '' : 'none';
    document.getElementById('receipt-modal').classList.remove('hidden');
  }

  function loadList() {
    if (!waiter || !(can('reports.view') || can('payments.take'))) {
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
    api('/api/orders').then(function (body) {
      paid = (body.data.orders || []).filter(function (order) {
        return (order.status === 'paid' || order.status === 'refunded') && order.payment &&
          inRange(order.payment.at || order.updatedAt, from, to);
      });
      paid.sort(function (a, b) {
        return String(b.payment.at || '') < String(a.payment.at || '') ? -1 : 1;
      });
      var box = document.getElementById('receipt-body');
      box.innerHTML = '';
      if (!paid.length) {
        box.innerHTML = '<tr><td colspan="7">Bu aralıqda çek yoxdur.</td></tr>';
        return;
      }
      paid.forEach(function (order) {
        var pay = order.payment;
        var tr = document.createElement('tr');
        tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
        var cells = tr.querySelectorAll('td');
        cells[0].textContent = '#' + order.id;
        cells[1].textContent = formatWhen(pay.at || order.updatedAt);
        cells[2].textContent = order.tableName || '';
        cells[3].textContent = pay.waiterName || order.waiterName || '';
        cells[4].textContent = Number(pay.serviceCharge || 0).toFixed(2);
        cells[5].textContent = Number(pay.total || 0).toFixed(2) +
          (order.status === 'refunded' ? ' • qaytarılıb' : '');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Bax';
        btn.addEventListener('click', function () { openReceipt(order); });
        cells[6].appendChild(btn);
        box.appendChild(tr);
      });
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
      loadList();
    });
  });
  document.getElementById('rep-load').addEventListener('click', function () {
    document.querySelectorAll('.report-presets button').forEach(function (btn) {
      btn.className = '';
    });
    loadList();
  });
  ['rep-from', 'rep-to'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', function () {
      document.querySelectorAll('.report-presets button').forEach(function (btn) {
        btn.className = '';
      });
    });
  });
  document.getElementById('receipt-close').addEventListener('click', function () {
    document.getElementById('receipt-modal').classList.add('hidden');
  });
  document.getElementById('receipt-refund').addEventListener('click', function () {
    if (!lastReceipt || !can('payments.refund') || lastReceipt.status !== 'paid') {
      return;
    }
    var pay = lastReceipt.payment || {};
    document.getElementById('refund-sum').textContent =
      'Nağd ' + Number(pay.cashAmount || 0).toFixed(2) +
      ' • Kart ' + Number(pay.cardAmount || 0).toFixed(2) +
      ' • Cəm ' + Number(pay.total || 0).toFixed(2) + ' AZN';
    document.getElementById('refund-reason').value = '';
    document.getElementById('refund-modal').classList.remove('hidden');
    document.getElementById('refund-reason').focus();
  });
  document.getElementById('cancel-refund').addEventListener('click', function () {
    document.getElementById('refund-modal').classList.add('hidden');
  });
  document.getElementById('refund-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!lastReceipt || !waiter || !can('payments.refund')) {
      return;
    }
    api('/api/orders/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: lastReceipt.id,
        waiterId: waiter.user.id,
        reason: document.getElementById('refund-reason').value
      })
    }).then(function (body) {
      lastReceipt = body.data.order;
      document.getElementById('refund-modal').classList.add('hidden');
      openReceipt(lastReceipt);
      loadList();
    }).catch(function (error) {
      document.getElementById('receipt-msg').textContent = error.message;
      document.getElementById('refund-modal').classList.add('hidden');
    });
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
      body: JSON.stringify({ orderId: lastReceipt.id, waiterId: waiter.user.id })
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
      loadList();
    }
  });
})();
