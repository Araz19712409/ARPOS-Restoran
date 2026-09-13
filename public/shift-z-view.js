(function (global) {
  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function whenText(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '—';
    }
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function setText(id, text) {
    var n = document.getElementById(id);
    if (n) {
      n.textContent = text == null ? '' : String(text);
    }
  }

  var lastPacked = null;
  var lastTerminalId = 0;

  function fill(packed) {
    lastPacked = packed || null;
    var row = (packed && packed.shift) || {};
    var tot = (packed && packed.totals) || {};
    setText('z-sum-opened', whenText(row.openedAt));
    setText('z-sum-closed', whenText(row.closedAt));
    setText('z-sum-cashier', row.closedByName || row.openedByName || '—');
    setText('z-sum-count', String(tot.count || 0));
    setText('z-sum-total', money(tot.total) + ' AZN');
    setText('z-sum-cash', money(tot.cash) + ' AZN');
    setText('z-sum-card', money(tot.card) + ' AZN');
    setText('z-sum-gift', money(tot.gift) + ' AZN');
    setText('z-sum-expected', money(packed && packed.expectedCash) + ' AZN');
    setText('z-sum-counted', money(row.countedCash) + ' AZN');
    setText('z-sum-diff', money(packed && packed.difference) + ' AZN');
  }

  function show(packed, opts) {
    opts = opts || {};
    lastTerminalId = Number(opts.terminalId) || 0;
    fill(packed);
    var warn = el('z-sum-warn');
    if (warn) {
      warn.textContent = opts.warning || '';
      warn.classList.toggle('hidden', !opts.warning);
    }
    var modal = el('z-summary-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function hide() {
    var modal = el('z-summary-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function bind(apiFn, sayFn) {
    var closeBtn = el('z-sum-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hide);
    }
    var printBtn = el('z-sum-print');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        if (!lastPacked || !lastTerminalId) {
          if (sayFn) {
            sayFn('Növbə məlumatı yoxdur.', 'err');
          }
          return;
        }
        var shiftId = lastPacked.shift && lastPacked.shift.id;
        apiFn('/api/shifts/print-z', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: lastTerminalId,
            shiftId: shiftId
          })
        }).then(function (body) {
          if (sayFn) {
            sayFn(body.warning || 'Z çapıldı.', body.warning ? 'warn' : 'ok');
          }
          var warn = el('z-sum-warn');
          if (warn && body.warning) {
            warn.textContent = body.warning;
            warn.classList.remove('hidden');
          }
        }).catch(function (error) {
          if (sayFn) {
            sayFn(error.message, 'err');
          }
        });
      });
    }
  }

  global.ShiftZView = { fill: fill, show: show, hide: hide, bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
