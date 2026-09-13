(function (global) {
  function bind(ctx) {
    if (!ctx) {
      return;
    }

    function setOrderZone(zone) {
      var page = document.querySelector('.order-page');
      var bar = document.getElementById('order-zones');
      if (!page || !bar) {
        return;
      }
      page.setAttribute('data-zone', zone);
      bar.querySelectorAll('button').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-zone') === zone);
      });
      if (zone === 'menu' && ctx.maybeFocusBarcode) {
        ctx.maybeFocusBarcode(true);
      }
    }

    ctx.setOrderZone = setOrderZone;

    var zoneBar = document.getElementById('order-zones');
    if (zoneBar) {
      zoneBar.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-zone]');
        if (!btn) {
          return;
        }
        setOrderZone(btn.getAttribute('data-zone'));
      });
    }
  }

  global.OrdersZones = { bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
