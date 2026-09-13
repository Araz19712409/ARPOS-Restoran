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

    function refreshShiftBadge() {
      var btn = document.getElementById('shift-z-open');
      if (!btn) {
        return Promise.resolve();
      }
      var waiter = ctx.waiter;
      var terminal = ctx.terminal;
      var show = !!(waiter && ctx.can('payments.take') && terminal);
      btn.style.display = show ? '' : 'none';
      if (!show) {
        btn.textContent = 'Növbə / Z';
        return Promise.resolve();
      }
      return api('/api/shifts?terminalId=' + encodeURIComponent(terminal.id)).then(function (body) {
        ctx.shiftPack = body.data || {};
        btn.textContent = ctx.shiftPack.current ? 'Növbə açıq' : 'Növbə bağlı';
      }).catch(function () {
        btn.textContent = 'Növbə / Z';
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
      var closeBtn = el('shift-z-close');
      if (closeBtn) {
        closeBtn.disabled = !cur || openList.length > 0 || !ctx.can('payments.take');
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
          return;
        }
        var openList = (ctx.shiftPack && ctx.shiftPack.openTables) || [];
        if (openList.length) {
          say('Açıq masa var: ' + openList.join(', ') + '.', 'err');
          return;
        }
        api('/api/shifts/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: terminal.id,
            countedCash: dec(document.getElementById('shift-z-counted').value)
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
        });
      });
    }

    if (window.ShiftZView) {
      window.ShiftZView.bind(api, say);
    }
  }

  global.OrdersShift = { bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
