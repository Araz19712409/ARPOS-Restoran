(function (global) {
  function bind(ctx) {
    if (!ctx) {
      return;
    }
    var el = ctx.el;
    var setText = ctx.setText;
    var setVal = ctx.setVal;
    var api = ctx.api;
    var say = ctx.say;
    var dec = ctx.dec;

    function hideCashBadge() {
      var cashEl = document.getElementById('shift-cash');
      if (cashEl) {
        cashEl.style.display = 'none';
        cashEl.textContent = 'Kassa —';
      }
    }

    function refreshShiftBadge() {
      var btn = document.getElementById('shift-z-open');
      if (document.body && document.body.classList.contains('waiter-mode')) {
        if (btn) {
          btn.style.display = 'none';
        }
        hideCashBadge();
        return Promise.resolve();
      }
      if (!btn) {
        hideCashBadge();
        return Promise.resolve();
      }
      var waiter = ctx.waiter;
      var terminal = ctx.terminal;
      var show = !!(waiter && ctx.can('payments.take') && terminal);
      btn.style.display = show ? '' : 'none';
      if (!show) {
        btn.textContent = 'Növbə / Z';
        hideCashBadge();
        return Promise.resolve();
      }
      return api('/api/shifts?terminalId=' + encodeURIComponent(terminal.id)).then(function (body) {
        ctx.shiftPack = body.data || {};
        var cur = ctx.shiftPack.current;
        btn.textContent = cur ? 'Növbə açıq' : 'Növbə bağlı';
        var cashEl = document.getElementById('shift-cash');
        var shiftCfg = (ctx.settings && ctx.settings.shift) || {};
        var showCash = !!(cur && shiftCfg.showCashOnOrders !== false);
        if (cashEl) {
          if (showCash) {
            cashEl.style.display = '';
            cashEl.textContent = 'Kassa ' + ctx.money(cur.expectedCash) + ' ₼';
          } else {
            hideCashBadge();
          }
        }
      }).catch(function () {
        btn.textContent = 'Növbə / Z';
        hideCashBadge();
      });
    }

    function fillShiftModal() {
      var shiftPack = ctx.shiftPack;
      var cur = shiftPack && shiftPack.current;
      var openList = (shiftPack && shiftPack.openTables) || [];
      setText('shift-z-status', cur ? 'Növbə açıq' : 'Növbə bağlı');
      setText('shift-z-tables', openList.length ? ('Açıq masa: ' + openList.join(', ') + '. Əvvəl bağlayın.') : '');
      setText('shift-z-expected', cur ? ('Gözlənilən: ' + ctx.money(cur.expectedCash) + ' AZN') : '');
      var counted = el('shift-z-counted');
      if (counted && document.activeElement !== counted) {
        setVal('shift-z-counted', cur ? ctx.money(cur.expectedCash) : '');
      }
      var removeCash = el('shift-z-remove-cash');
      if (removeCash) {
        removeCash.checked = true;
      }
      var closeBtn = el('shift-z-close');
      if (closeBtn) {
        closeBtn.disabled = false;
      }
    }

    function openShiftModal() {
      if (!ctx.can('payments.take') || !ctx.terminal) {
        return;
      }
      refreshShiftBadge().then(function () {
        fillShiftModal();
        var modal = el('shift-z-modal');
        if (modal) {
          modal.classList.remove('hidden');
        }
      });
    }

    ctx.refreshShiftBadge = refreshShiftBadge;
    ctx.openShiftModal = openShiftModal;

    var openBtn = document.getElementById('shift-z-open');
    if (openBtn) {
      openBtn.addEventListener('click', openShiftModal);
    }
    var cancelBtn = document.getElementById('shift-z-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        document.getElementById('shift-z-modal').classList.add('hidden');
      });
    }
    var form = document.getElementById('shift-z-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var terminal = ctx.terminal;
        if (!ctx.can('payments.take') || !terminal) {
          say('Növbəni bağlamaq üçün ödəniş icazəsi və terminal lazımdır.', 'err');
          return;
        }
        var cur = ctx.shiftPack && ctx.shiftPack.current;
        if (!cur) {
          say('Açıq növbə yoxdur.', 'err');
          return;
        }
        var openList = (ctx.shiftPack && ctx.shiftPack.openTables) || [];
        if (openList.length) {
          say('Açıq masa var: ' + openList.join(', ') + '.', 'err');
          return;
        }
        var countedEl = document.getElementById('shift-z-counted');
        var countedCash = dec(countedEl && countedEl.value);
        if (!Number.isFinite(countedCash) || countedCash < 0) {
          say('Sayılan nağd düzgün deyil.', 'err');
          return;
        }
        var closeBtn = document.getElementById('shift-z-close');
        if (closeBtn) {
          closeBtn.disabled = true;
        }
        api('/api/shifts/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: terminal.id,
            countedCash: countedCash,
            removeCash: !!(document.getElementById('shift-z-remove-cash') &&
              document.getElementById('shift-z-remove-cash').checked)
          })
        }).then(function (body) {
          var msg = 'Növbə bağlandı';
          if (body.warning) {
            say(msg + '. ' + body.warning, 'warn');
          } else {
            say(msg);
          }
          document.getElementById('shift-z-modal').classList.add('hidden');
          if (window.ShiftZView && body.data) {
            window.ShiftZView.show(body.data, {
              terminalId: terminal.id,
              warning: body.warning || ''
            });
          }
          return refreshShiftBadge();
        }).catch(function (error) {
          say(error.message, 'err');
        }).then(function () {
          if (closeBtn) {
            closeBtn.disabled = false;
          }
        });
      });
    }

    if (window.ShiftZView) {
      window.ShiftZView.bind(api, say);
    }
  }

  global.OrdersShift = { bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
