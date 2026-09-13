(function () {
  var busy = false;

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

  function load(q) {
    var url = '/api/customers';
    if (q) {
      url += '?q=' + encodeURIComponent(q);
    }
    return api(url).then(function (body) {
      var box = document.getElementById('cust-list');
      box.innerHTML = '';
      ((body.data && body.data.customers) || []).forEach(function (row) {
        var card = document.createElement('article');
        card.className = 'user-card';
        card.innerHTML = '<strong></strong><p></p>';
        card.querySelector('strong').textContent = row.phone + (row.name ? ' · ' + row.name : '');
        card.querySelector('p').textContent = row.points + ' ball • ' + (row.visits || 0) + ' gəliş';
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = '+ball';
        plus.addEventListener('click', function () { adjust(row.id, 1); });
        var minus = document.createElement('button');
        minus.type = 'button';
        minus.textContent = '−ball';
        minus.addEventListener('click', function () { adjust(row.id, -1); });
        card.appendChild(plus);
        card.appendChild(minus);
        box.appendChild(card);
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function adjust(id, sign) {
    if (busy) {
      return;
    }
    var raw = window.prompt(sign > 0 ? 'Neçə ball əlavə?' : 'Neçə ball çıx?', '1');
    if (raw == null) {
      return;
    }
    var n = Math.round(Number(raw) || 0);
    if (!n) {
      return;
    }
    var reason = window.prompt('Səbəb (məcburi)', '');
    if (!reason || !String(reason).trim()) {
      say('Səbəbi yazın.', 'err');
      return;
    }
    busy = true;
    api('/api/customers/' + id + '/points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: sign * Math.abs(n), reason: reason })
    }).then(function () {
      say('Ball yeniləndi.');
      return load(document.getElementById('cust-q').value);
    }).catch(function (error) {
      say(error.message, 'err');
    }).then(function () {
      busy = false;
    });
  }

  document.getElementById('cust-search').addEventListener('click', function () {
    load(document.getElementById('cust-q').value);
  });
  document.getElementById('cust-q').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      load(document.getElementById('cust-q').value);
    }
  });
  document.getElementById('cust-add').addEventListener('click', function () {
    if (busy) {
      return;
    }
    busy = true;
    api('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: document.getElementById('cust-phone').value,
        name: document.getElementById('cust-name').value
      })
    }).then(function () {
      say('Müştəri saxlandı.');
      document.getElementById('cust-phone').value = '';
      document.getElementById('cust-name').value = '';
      return load(document.getElementById('cust-q').value);
    }).catch(function (error) {
      say(error.message, 'err');
    }).then(function () {
      busy = false;
    });
  });

  load('');
})();
