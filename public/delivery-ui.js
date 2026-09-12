(function () {
  var waiter = null;
  var pinBuffer = '';
  var timer = 0;

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

  function setWaiter(data) {
    waiter = data;
    if (data) {
      window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
      hideLock();
      document.getElementById('waiter-line').textContent =
        data.user.name + ' • Prep / Yolda / Bitdi';
      load();
    } else {
      if (window.PosNav) {
        window.PosNav.forget();
      }
      showLock();
    }
  }

  function runOf(order) {
    return order && order.runStatus ? order.runStatus : 'prep';
  }

  function patch(order, fields) {
    return api('/api/delivery/patch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ orderId: order.id }, fields))
    }).then(function () {
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function card(order) {
    var el = document.createElement('article');
    el.className = 'delivery-card';
    var title = document.createElement('h3');
    title.textContent = order.tableName || ('#' + order.id);
    var guest = document.createElement('p');
    guest.textContent = [order.guestName, order.guestPhone].filter(Boolean).join(' • ') || 'Qonaq yoxdur';
    var addr = document.createElement('p');
    addr.textContent = order.guestAddress || '';
    var courier = document.createElement('input');
    courier.type = 'text';
    courier.maxLength = 40;
    courier.placeholder = 'Kuryer';
    courier.value = order.courierName || '';
    courier.addEventListener('change', function () {
      patch(order, { courierName: courier.value });
    });
    var actions = document.createElement('div');
    actions.className = 'actions';
    var status = runOf(order);
    if (status === 'prep') {
      var way = document.createElement('button');
      way.type = 'button';
      way.textContent = 'Yolda';
      way.addEventListener('click', function () {
        patch(order, { runStatus: 'way' });
      });
      actions.appendChild(way);
    } else if (status === 'way') {
      var done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Bitdi';
      done.addEventListener('click', function () {
        patch(order, { runStatus: 'done' });
      });
      actions.appendChild(done);
    }
    var pay = document.createElement('a');
    pay.href = '/orders.html';
    pay.textContent = 'Ödəniş';
    el.appendChild(title);
    el.appendChild(guest);
    if (order.guestAddress) {
      el.appendChild(addr);
    }
    el.appendChild(courier);
    el.appendChild(actions);
    el.appendChild(pay);
    return el;
  }

  function fill(id, list) {
    var box = document.getElementById(id);
    box.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'delivery-empty';
      empty.textContent = 'Boş';
      box.appendChild(empty);
      return;
    }
    list.forEach(function (order) {
      box.appendChild(card(order));
    });
  }

  function load() {
    if (!waiter) {
      return Promise.resolve();
    }
    return api('/api/delivery/board').then(function (body) {
      var list = (body.data && body.data.orders) || [];
      fill('col-prep', list.filter(function (row) { return runOf(row) === 'prep'; }));
      fill('col-way', list.filter(function (row) { return runOf(row) === 'way'; }));
      fill('col-done', list.filter(function (row) { return runOf(row) === 'done'; }));
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
      body.data.fromLogin = true;
      setWaiter(body.data);
    }).catch(function (error) {
      document.getElementById('pin-error').textContent = error.message;
      if (clearOnFail) {
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
      document.getElementById('pin-error').textContent = '';
      if (key === 'C') {
        pinBuffer = '';
        drawPin();
        return;
      }
      if (key === 'OK') {
        tryLogin(true);
        return;
      }
      if (pinBuffer.length >= 8) {
        return;
      }
      pinBuffer += key;
      drawPin();
      if (pinBuffer.length >= 6) {
        tryLogin(pinBuffer.length >= 8);
      }
    });
    pinPad.appendChild(btn);
  });

  document.getElementById('logout').addEventListener('click', function () {
    setWaiter(null);
  });

  window.addEventListener('pos-auth-lost', function () {
    setWaiter(null);
  });

  var saved = window.PosNav ? window.PosNav.session() : null;
  if (saved && window.PosNav.guard()) {
    setWaiter(saved);
  } else if (!saved) {
    showLock();
  }

  timer = window.setInterval(function () {
    if (waiter) {
      load();
    }
  }, 5000);
})();
