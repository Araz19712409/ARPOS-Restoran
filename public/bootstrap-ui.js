(function () {
  var DRAFT_KEY = 'arpos-bootstrap-draft';
  var COLS = ['groupName', 'productName', 'salePrice', 'qty', 'buyPrice', 'stationName', 'unit'];
  var rows = [];
  var catalog = { groups: [], products: [], stations: [] };
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

  function emptyRow() {
    return {
      groupName: '',
      productName: '',
      salePrice: '',
      qty: '',
      buyPrice: '',
      stationName: '',
      unit: ''
    };
  }

  function ensureRows(n) {
    while (rows.length < n) {
      rows.push(emptyRow());
    }
  }

  function nameIn(list, name) {
    var needle = String(name || '').trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return (list || []).some(function (row) {
      return String(row.name || '').trim().toLowerCase() === needle;
    });
  }

  function fillDatalists() {
    function fill(id, list) {
      var box = document.getElementById(id);
      if (!box) {
        return;
      }
      box.innerHTML = '';
      (list || []).forEach(function (row) {
        var opt = document.createElement('option');
        opt.value = row.name;
        box.appendChild(opt);
      });
    }
    fill('boot-groups', catalog.groups);
    fill('boot-stations', catalog.stations);
    fill('boot-products', catalog.products);
  }

  function readCells() {
    var body = document.getElementById('boot-body');
    if (!body) {
      return;
    }
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr, i) {
      if (!rows[i]) {
        rows[i] = emptyRow();
      }
      COLS.forEach(function (key) {
        var input = tr.querySelector('[data-col="' + key + '"]');
        if (input) {
          rows[i][key] = input.value;
        }
      });
    });
  }

  function markNew(cell, isNew) {
    if (!cell) {
      return;
    }
    cell.classList.toggle('has-new', !!isNew);
    var badge = cell.querySelector('.boot-new');
    if (isNew) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'boot-new';
        badge.textContent = 'yeni';
        cell.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  function updateNewFlags(tr, row) {
    markNew(tr.querySelector('[data-field="groupName"]'),
      row.groupName && !nameIn(catalog.groups, row.groupName));
    markNew(tr.querySelector('[data-field="productName"]'),
      row.productName && !catalog.products.some(function (p) {
        var g = catalog.groups.find(function (gr) {
          return same(gr.name, row.groupName);
        });
        return g && Number(p.groupId) === Number(g.id) && same(p.name, row.productName);
      }));
    markNew(tr.querySelector('[data-field="stationName"]'),
      row.stationName && !nameIn(catalog.stations, row.stationName));
  }

  function same(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function render() {
    var body = document.getElementById('boot-body');
    if (!body) {
      return;
    }
    body.innerHTML = '';
    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');
      var num = document.createElement('td');
      num.className = 'num';
      num.textContent = String(i + 1);
      tr.appendChild(num);

      function addCell(key, listId, wide) {
        var td = document.createElement('td');
        td.className = 'boot-cell';
        td.setAttribute('data-field', key);
        var input = document.createElement('input');
        input.type = 'text';
        input.value = row[key] || '';
        input.setAttribute('data-col', key);
        input.setAttribute('data-row', String(i));
        if (listId) {
          input.setAttribute('list', listId);
        }
        if (key === 'salePrice' || key === 'qty' || key === 'buyPrice') {
          input.inputMode = 'decimal';
        }
        if (wide) {
          input.style.minWidth = '120px';
        }
        input.addEventListener('input', function () {
          row[key] = input.value;
          updateNewFlags(tr, row);
          maybeAddRow(i);
        });
        input.addEventListener('keydown', function (event) {
          onKey(event, i, key);
        });
        td.appendChild(input);
        tr.appendChild(td);
      }

      addCell('groupName', 'boot-groups', true);
      addCell('productName', 'boot-products', true);
      addCell('salePrice', '', false);
      addCell('qty', '', false);
      addCell('buyPrice', '', false);
      addCell('stationName', 'boot-stations', true);
      addCell('unit', 'boot-units', false);
      body.appendChild(tr);
      updateNewFlags(tr, row);
    });
  }

  function maybeAddRow(i) {
    if (i !== rows.length - 1) {
      return;
    }
    var row = rows[i];
    if (!row) {
      return;
    }
    var filled = COLS.some(function (k) {
      return String(row[k] || '').trim() !== '';
    });
    if (!filled) {
      return;
    }
    rows.push(emptyRow());
    var body = document.getElementById('boot-body');
    if (!body) {
      render();
      return;
    }
    var tr = document.createElement('tr');
    var num = document.createElement('td');
    num.className = 'num';
    num.textContent = String(rows.length);
    tr.appendChild(num);
    var empty = emptyRow();
    COLS.forEach(function (key) {
      var td = document.createElement('td');
      td.className = 'boot-cell';
      td.setAttribute('data-field', key);
      var input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-col', key);
      input.setAttribute('data-row', String(rows.length - 1));
      if (key === 'groupName') {
        input.setAttribute('list', 'boot-groups');
      } else if (key === 'productName') {
        input.setAttribute('list', 'boot-products');
      } else if (key === 'stationName') {
        input.setAttribute('list', 'boot-stations');
      } else if (key === 'unit') {
        input.setAttribute('list', 'boot-units');
      }
      if (key === 'salePrice' || key === 'qty' || key === 'buyPrice') {
        input.inputMode = 'decimal';
      }
      input.addEventListener('input', function () {
        empty[key] = input.value;
        rows[rows.length - 1] = empty;
        updateNewFlags(tr, empty);
        maybeAddRow(rows.length - 1);
      });
      input.addEventListener('keydown', function (event) {
        onKey(event, rows.length - 1, key);
      });
      td.appendChild(input);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }

  function focusCell(rowIdx, col) {
    window.setTimeout(function () {
      var input = document.querySelector(
        '#boot-body tr:nth-child(' + (rowIdx + 1) + ') [data-col="' + col + '"]'
      );
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  function onKey(event, rowIdx, col) {
    if (event.key !== 'Enter' && event.key !== 'Tab') {
      return;
    }
    if (event.key === 'Tab' && event.shiftKey) {
      return;
    }
    var ci = COLS.indexOf(col);
    if (event.key === 'Enter') {
      event.preventDefault();
      if (ci < COLS.length - 1) {
        focusCell(rowIdx, COLS[ci + 1]);
      } else {
        if (rowIdx >= rows.length - 1) {
          rows.push(emptyRow());
          render();
        }
        focusCell(rowIdx + 1, 'groupName');
      }
    }
  }

  function payloadLines() {
    readCells();
    return rows.map(function (row) {
      return {
        groupName: row.groupName,
        productName: row.productName,
        salePrice: row.salePrice,
        qty: row.qty,
        buyPrice: row.buyPrice,
        stationName: row.stationName,
        unit: row.unit
      };
    });
  }

  function saveDraft() {
    readCells();
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(rows));
      say('Draft saxlanıldı.', 'ok');
    } catch (e) {
      say('Draft yazılmadı.', 'err');
    }
  }

  function loadDraft() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
      if (Array.isArray(raw) && raw.length) {
        rows = raw.map(function (row) {
          return Object.assign(emptyRow(), row || {});
        });
        return true;
      }
    } catch (e) {}
    return false;
  }

  function showPreview(data) {
    var box = document.getElementById('boot-preview-box');
    if (!box) {
      return;
    }
    box.classList.remove('hidden');
    var parts = [
      'Yeni qrup: ' + (data.newGroups || 0),
      'Yeni stansiya: ' + (data.newStations || 0),
      'Yeni mal: ' + (data.newProducts || 0),
      'Yenilənən mal: ' + (data.updatedProducts || 0),
      'Anbar sətiri: ' + (data.stockLines || 0)
    ];
    if (data.warnings && data.warnings.length) {
      parts.push('Xəbərdarlıq: ' + data.warnings.join(' | '));
    }
    box.textContent = parts.join('\n');
  }

  function postBootstrap(confirm) {
    if (busy) {
      return Promise.resolve();
    }
    busy = true;
    return api('/api/catalog/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirm: !!confirm,
        warehouseId: 1,
        lines: payloadLines()
      })
    }).then(function (body) {
      showPreview(body.data || {});
      if (confirm) {
        say('İlkin doldurma təsdiqləndi.', 'ok');
        try {
          window.localStorage.removeItem(DRAFT_KEY);
        } catch (e) {}
        return load().then(function () {
          rows = [];
          ensureRows(12);
          render();
        });
      }
      say('Önizləmə hazırdır.', 'ok');
    }).catch(function (error) {
      say(error.message, 'err');
    }).then(function () {
      busy = false;
    });
  }

  function load() {
    return api('/api/catalog/manage').then(function (body) {
      catalog = body.data || { groups: [], products: [], stations: [] };
      fillDatalists();
    });
  }

  document.getElementById('boot-add-10').addEventListener('click', function () {
    readCells();
    ensureRows(rows.length + 10);
    render();
  });
  document.getElementById('boot-draft').addEventListener('click', saveDraft);
  document.getElementById('boot-preview').addEventListener('click', function () {
    postBootstrap(false);
  });
  document.getElementById('boot-commit').addEventListener('click', function () {
    if (!window.askYes) {
      postBootstrap(true);
      return;
    }
    window.askYes('Təsdiq', 'İlkin doldurma yazılsın? Qrup/mal/stansiya yaradıla bilər.').then(function (ok) {
      if (ok) {
        postBootstrap(true);
      }
    });
  });
  document.getElementById('boot-clear').addEventListener('click', function () {
    rows = [];
    ensureRows(12);
    render();
    var box = document.getElementById('boot-preview-box');
    if (box) {
      box.classList.add('hidden');
      box.textContent = '';
    }
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
    say('Cədvəl təmizləndi.');
  });
  document.getElementById('logout').addEventListener('click', function () {
    if (window.PosNav) {
      window.PosNav.forget();
    }
    window.location.href = '/orders.html';
  });

  if (!loadDraft()) {
    ensureRows(12);
  } else {
    ensureRows(Math.max(rows.length, 8));
  }
  load().then(function () {
    render();
  }).catch(function (error) {
    say(error.message, 'err');
    render();
  });
})();
