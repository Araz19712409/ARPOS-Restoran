(function (global) {
  function bind(ctx) {
    if (!ctx) {
      return;
    }

    function isWaiter() {
      return !!(document.body && document.body.classList.contains('waiter-mode'));
    }

    function syncBack(zone) {
      var back = document.getElementById('order-back');
      if (!back) {
        return;
      }
      var show = isWaiter() && zone && zone !== 'floor';
      back.classList.toggle('hidden', !show);
      back.hidden = !show;
    }

    function setOrderZone(zone) {
      var page = document.querySelector('.order-page');
      var bar = document.getElementById('order-zones');
      if (!page || !bar) {
        return;
      }
      var next = String(zone || 'floor');
      if (isWaiter()) {
        if (next !== 'floor' && next !== 'groups' && next !== 'menu' && next !== 'check') {
          next = 'floor';
        }
      } else if (next === 'groups') {
        next = 'menu';
      }
      page.setAttribute('data-zone', next);
      bar.querySelectorAll('button[data-zone]').forEach(function (btn) {
        var z = btn.getAttribute('data-zone');
        btn.classList.toggle('active', z === next || (next === 'groups' && z === 'menu'));
      });
      syncBack(next);
      if (next === 'menu' && ctx.maybeFocusBarcode) {
        ctx.maybeFocusBarcode(true);
      }
      if (typeof ctx.onOrderZone === 'function') {
        ctx.onOrderZone(next);
      }
    }

    function goBack() {
      var page = document.querySelector('.order-page');
      var zone = page && page.getAttribute('data-zone');
      if (zone === 'menu') {
        setOrderZone('groups');
        return;
      }
      if (zone === 'groups' || zone === 'check') {
        setOrderZone('floor');
      }
    }

    ctx.setOrderZone = setOrderZone;
    ctx.orderZoneBack = goBack;

    var zoneBar = document.getElementById('order-zones');
    if (zoneBar) {
      zoneBar.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-zone]');
        if (!btn) {
          return;
        }
        var z = btn.getAttribute('data-zone');
        if (isWaiter() && z === 'menu') {
          setOrderZone('groups');
          return;
        }
        setOrderZone(z);
      });
    }

    var backBtn = document.getElementById('order-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        goBack();
      });
    }

    syncBack(document.querySelector('.order-page') &&
      document.querySelector('.order-page').getAttribute('data-zone'));
  }

  global.OrdersZones = { bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
