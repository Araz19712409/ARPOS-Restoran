(function () {
  var tableId = 0;
  var tableName = '';
  var groups = [];
  var products = [];
  var groupId = 0;
  var cart = [];
  var busy = false;
  var msgTimer = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function show(node, on) {
    if (!node) {
      return;
    }
    node.hidden = !on;
    node.classList.toggle('hidden', !on);
  }

  function setText(id, text) {
    var n = el(id);
    if (n) {
      n.textContent = text == null ? '' : String(text);
    }
  }

  function flashMsg(text) {
    if (msgTimer) {
      window.clearTimeout(msgTimer);
      msgTimer = 0;
    }
    setText('g-msg', text || '');
    if (!text) {
      return;
    }
    msgTimer = window.setTimeout(function () {
      msgTimer = 0;
      setText('g-msg', '');
    }, 3000);
  }

  function money(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2) + ' AZN';
  }

  function fail(msg) {
    var box = el('g-err');
    setText('g-err', msg);
    show(box, true);
    show(el('g-groups'), false);
    show(el('g-products'), false);
    show(el('g-cart'), false);
  }

  function api(url, opt) {
    return fetch(url, opt).then(function (res) {
      return res.json().then(function (body) {
        if (!body.success) {
          throw new Error(body.message || 'Xəta.');
        }
        return body;
      });
    });
  }

  function cartQty(id) {
    var row = cart.find(function (item) { return item.id === id; });
    return row ? row.qty : 0;
  }

  function setQty(prod, qty) {
    qty = Math.max(0, Math.min(20, Math.round(qty)));
    cart = cart.filter(function (item) { return item.id !== prod.id; });
    if (qty) {
      cart.push({ id: prod.id, name: prod.name, price: prod.price, qty: qty });
    }
    drawCart();
  }

  function bindTap(btn, fn) {
    if (!btn || !fn) {
      return;
    }
    var last = 0;
    function down() {
      btn.classList.add('is-down');
    }
    function up() {
      btn.classList.remove('is-down');
    }
    function run(ev) {
      var now = Date.now();
      if (now - last < 400) {
        if (ev && ev.cancelable) {
          ev.preventDefault();
        }
        return;
      }
      last = now;
      if (ev && ev.type === 'touchend' && ev.cancelable) {
        ev.preventDefault();
      }
      up();
      fn();
    }
    btn.addEventListener('touchstart', down, { passive: true });
    btn.addEventListener('touchend', run);
    btn.addEventListener('touchcancel', up);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
    btn.addEventListener('click', run);
  }

  function drawGroups() {
    var box = el('g-groups');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    groups.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = g.name;
      if (g.id === groupId) {
        b.className = 'active';
      }
      bindTap(b, function () {
        groupId = g.id;
        drawGroups();
        drawProducts();
      });
      box.appendChild(b);
    });
    show(box, true);
  }

  function drawProducts() {
    var box = el('g-products');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    products.filter(function (p) {
      return !groupId || p.groupId === groupId;
    }).forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'g-item';
      var info = document.createElement('div');
      var name = document.createElement('strong');
      name.textContent = p.name;
      var price = document.createElement('span');
      price.textContent = money(p.price);
      info.appendChild(name);
      info.appendChild(price);
      var add = document.createElement('button');
      add.type = 'button';
      add.textContent = '+';
      bindTap(add, function () {
        setQty(p, cartQty(p.id) + 1);
      });
      row.appendChild(info);
      row.appendChild(add);
      box.appendChild(row);
    });
    show(box, true);
  }

  function drawCart() {
    var box = el('g-cart-list');
    var wrap = el('g-cart');
    if (!box || !wrap) {
      return;
    }
    box.innerHTML = '';
    var total = 0;
    cart.forEach(function (item) {
      total += item.price * item.qty;
      var line = document.createElement('div');
      line.className = 'g-line';
      var lab = document.createElement('span');
      lab.textContent = item.name + ' × ' + item.qty;
      var minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      bindTap(minus, function () {
        setQty(item, item.qty - 1);
      });
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      bindTap(plus, function () {
        setQty(item, item.qty + 1);
      });
      var del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      bindTap(del, function () {
        setQty(item, 0);
      });
      line.appendChild(lab);
      line.appendChild(minus);
      line.appendChild(plus);
      line.appendChild(del);
      box.appendChild(line);
    });
    setText('g-total', money(total));
    show(wrap, true);
  }

  function bind() {
    var send = el('g-send');
    var call = el('g-call');
    if (send) {
      bindTap(send, function () {
        if (busy || !cart.length) {
          flashMsg(cart.length ? '' : 'Səbət boşdur.');
          return;
        }
        busy = true;
        api('/api/guest/order-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId: tableId,
            items: cart.map(function (item) {
              return { productId: item.id, qty: item.qty };
            })
          })
        }).then(function () {
          cart = [];
          drawCart();
          flashMsg('Göndərildi.');
        }).catch(function (err) {
          flashMsg(err.message);
        }).then(function () {
          busy = false;
        });
      });
    }
    if (call) {
      bindTap(call, function () {
        if (busy) {
          return;
        }
        busy = true;
        api('/api/guest/call-waiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: tableId })
        }).then(function () {
          flashMsg('Ofisiant çağırıldı.');
        }).catch(function (err) {
          flashMsg(err.message);
        }).then(function () {
          busy = false;
        });
      });
    }
  }

  try {
    tableId = Number(new URLSearchParams(location.search).get('table') || 0);
  } catch (e) {
    tableId = 0;
  }
  if (!tableId) {
    fail('Masa seçilməyib. QR kodu yenidən oxudun.');
    return;
  }
  bind();
  api('/api/guest/menu?table=' + encodeURIComponent(tableId)).then(function (body) {
    var data = body.data || {};
    tableName = (data.table && data.table.name) ? String(data.table.name) : '';
    setText('g-table', tableName);
    document.title = tableName || 'Menyu';
    setText('g-sub', 'ödəniş kassada');
    groups = data.groups || [];
    products = data.products || [];
    groupId = groups[0] ? groups[0].id : 0;
    drawGroups();
    drawProducts();
    drawCart();
  }).catch(function (err) {
    fail(err.message || 'Masa tapılmadı.');
  });
}());
