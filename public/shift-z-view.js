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
    function setWarn(text) {
      var warn = el('z-sum-warn');
      if (!warn) {
        return;
      }
      warn.textContent = text == null ? '' : String(text);
      warn.classList.remove('hidden');
    }

    var closeBtn = el('z-sum-close');
    if (closeBtn && !closeBtn.getAttribute('data-bound')) {
      closeBtn.setAttribute('data-bound', '1');
      closeBtn.addEventListener('click', hide);
    }
    var printBtn = el('z-sum-print');
    if (printBtn && !printBtn.getAttribute('data-bound')) {
      printBtn.setAttribute('data-bound', '1');
      printBtn.addEventListener('click', function () {
        printBtn.disabled = true;
        setWarn('Çap edilir…');
        if (!lastPacked || !lastTerminalId) {
          setWarn('Növbə məlumatı yoxdur.');
          printBtn.disabled = false;
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
          var msg = (body && body.warning) || 'Z çapıldı.';
          setWarn(msg);
          if (sayFn) {
            sayFn(msg, (body && body.warning) ? 'warn' : 'ok');
          }
        }).catch(function (error) {
          var msg = (error && error.message) || 'Z çapı getmədi.';
          setWarn(msg);
          if (sayFn) {
            sayFn(msg, 'err');
          }
        }).then(function () {
          printBtn.disabled = false;
        });
      });
    }
  }

  global.ShiftZView = { fill: fill, show: show, hide: hide, bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
