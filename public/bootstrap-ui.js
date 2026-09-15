(function () {
  var DRAFT_KEY = 'arpos-bootstrap-draft';
  var COLS = ['groupName', 'productName', 'salePrice', 'qty', 'buyPrice', 'stationName', 'unit'];
  var rows = [];
  var catalog = { groups: [], products: [], stations: [] };
  var localGroups = [];
  var localStations = [];
  var localProducts = [];
  var busy = false;
  var draftTimer = null;

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

  function same(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
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

  function mergeByName(serverList, localList) {
    var out = [];
    var seen = {};
    function add(row) {
      var key = String((row && row.name) || '').trim().toLowerCase();
      if (!key || seen[key]) {
        return;
      }
      seen[key] = true;
      out.push({ name: String(row.name).trim() });
    }
    (serverList || []).forEach(add);
    (localList || []).forEach(add);
    out.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'az');
    });
    return out;
  }

  function mergeProducts() {
    var out = [];
    var seen = {};
    function keyOf(name, groupName) {
      return String(groupName || '').trim().toLowerCase() + '\0' +
        String(name || '').trim().toLowerCase();
    }
    function add(name, groupName) {
      var n = String(name || '').trim();
      if (!n) {
        return;
      }
      var key = keyOf(n, groupName);
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      out.push({ name: n, groupName: String(groupName || '').trim() });
    }
    (catalog.products || []).forEach(function (p) {
      var g = (catalog.groups || []).find(function (gr) {
        return Number(gr.id) === Number(p.groupId);
      });
      add(p.name, g && g.name);
    });
    (localProducts || []).forEach(function (p) {
      add(p.name, p.groupName);
    });
    out.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'az');
    });
    return out;
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
    fill('boot-groups', mergeByName(catalog.groups, localGroups));
    fill('boot-stations', mergeByName(catalog.stations, localStations));
    fill('boot-products', mergeProducts());
  }

  function rememberLocal(row) {
    if (!row) {
      return;
    }
    var g = String(row.groupName || '').trim();
    if (g && !nameIn(catalog.groups, g) && !nameIn(localGroups, g)) {
      localGroups.push({ name: g });
    }
    var s = String(row.stationName || '').trim();
    if (s && !nameIn(catalog.stations, s) && !nameIn(localStations, s)) {
      localStations.push({ name: s });
    }
    var p = String(row.productName || '').trim();
    if (p) {
      var onServer = (catalog.products || []).some(function (prod) {
        var gr = (catalog.groups || []).find(function (x) {
          return Number(x.id) === Number(prod.groupId);
        });
        return same(prod.name, p) && same(gr && gr.name, g);
      });
      var onLocal = (localProducts || []).some(function (prod) {
        return same(prod.name, p) && same(prod.groupName, g);
      });
      if (!onServer && !onLocal) {
        localProducts.push({ name: p, groupName: g });
      }
    }
    fillDatalists();
  }

  function syncLocalsFromRows() {
    localGroups = [];
    localStations = [];
    localProducts = [];
    rows.forEach(function (row) {
      rememberLocal(row);
    });
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

  function saveDraftSilent() {
    readCells();
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(rows));
    } catch (e) {}
  }

  function scheduleDraft() {
    if (draftTimer) {
      window.clearTimeout(draftTimer);
    }
    draftTimer = window.setTimeout(function () {
      draftTimer = null;
      saveDraftSilent();
    }, 400);
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

  function clearRowMarks() {
    var body = document.getElementById('boot-body');
    if (!body) {
      return;
    }
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr) {
      tr.classList.remove('boot-err', 'boot-done');
    });
  }

  function applyWarningMarks(warnings) {
    clearRowMarks();
    var body = document.getElementById('boot-body');
    if (!body || !warnings || !warnings.length) {
      return;
    }
    var hit = {};
    warnings.forEach(function (w) {
      var m = String(w || '').match(/S[əe]tir\s+(\d+)/i);
      if (!m) {
        return;
      }
      var idx = Number(m[1]) - 1;
      if (idx < 0) {
        return;
      }
      hit[idx] = true;
      var tr = body.querySelectorAll('tr')[idx];
      if (tr) {
        tr.classList.add('boot-err');
      }
    });
    return hit;
  }

  function markDoneRows(data, errHit) {
    var body = document.getElementById('boot-body');
    if (!body) {
      return;
    }
    errHit = errHit || {};
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr, i) {
      if (errHit[i]) {
        return;
      }
      var row = rows[i];
      if (!row) {
        return;
      }
      var filled = String(row.groupName || '').trim() && String(row.productName || '').trim();
      if (filled) {
        tr.classList.add('boot-done');
      }
    });
  }

  function bindInput(input, row, tr, i, key) {
    input.addEventListener('input', function () {
      row[key] = input.value;
      if (key === 'groupName' || key === 'productName' || key === 'stationName') {
        rememberLocal(row);
      }
      updateNewFlags(tr, row);
      maybeAddRow(i);
      scheduleDraft();
    });
    input.addEventListener('change', function () {
      row[key] = input.value;
      if (key === 'groupName' || key === 'productName' || key === 'stationName') {
        rememberLocal(row);
      }
      scheduleDraft();
    });
    input.addEventListener('keydown', function (event) {
      onKey(event, i, key);
    });
  }

  function render() {
    var body = document.getElementById('boot-body');
    if (!body) {
      return;
    }
    body.innerHTML = '';
    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');
      if (row._err) {
        tr.classList.add('boot-err');
      }
      if (row._done) {
        tr.classList.add('boot-done');
      }
      var num = document.createElement('td');
      num.className = 'num';
      num.textContent = String(i + 1);
      tr.appendChild(num);

      function addCell(key, listId) {
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
        bindInput(input, row, tr, i, key);
        td.appendChild(input);
        tr.appendChild(td);
      }

      addCell('groupName', 'boot-groups');
      addCell('productName', 'boot-products');
      addCell('salePrice', '');
      addCell('qty', '');
      addCell('buyPrice', '');
      addCell('stationName', 'boot-stations');
      addCell('unit', 'boot-units');
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
    rows[rows.length - 1] = empty;
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
      bindInput(input, empty, tr, rows.length - 1, key);
      td.appendChild(input);
      tr.appendChild(td);
    });
    body.appendChild(tr);
    scheduleDraft();
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
    saveDraftSilent();
    say('Draft saxlanıldı.', 'ok');
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

  function resetGrid() {
    rows = [];
    localGroups = [];
    localStations = [];
    localProducts = [];
    ensureRows(12);
    clearRowMarks();
    fillDatalists();
    render();
    var box = document.getElementById('boot-preview-box');
    if (box) {
      box.classList.add('hidden');
      box.textContent = '';
    }
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
  }

  function postBootstrap(doConfirm) {
    if (busy) {
      return Promise.resolve(null);
    }
    busy = true;
    return api('/api/catalog/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirm: !!doConfirm,
        warehouseId: 1,
        lines: payloadLines()
      })
    }).then(function (body) {
      var data = body.data || {};
      showPreview(data);
      var errHit = applyWarningMarks(data.warnings) || {};
      if (doConfirm) {
        var applied = Number(data.applied) || 0;
        say(applied + ' sətir tətbiq olundu.', 'ok');
        return load().then(function () {
          var clearAfter = document.getElementById('boot-clear-after');
          if (clearAfter && clearAfter.checked) {
            resetGrid();
            return body;
          }
          syncLocalsFromRows();
          fillDatalists();
          saveDraftSilent();
          render();
          var hit = applyWarningMarks(data.warnings) || errHit;
          markDoneRows(data, hit);
          return body;
        });
      }
      say('Önizləmə hazırdır.', 'ok');
      return body;
    }).catch(function (error) {
      say(error.message, 'err');
      return null;
    }).then(function (body) {
      busy = false;
      return body;
    });
  }

  function load() {
    return api('/api/catalog/manage').then(function (body) {
      catalog = body.data || { groups: [], products: [], stations: [] };
      fillDatalists();
    });
  }

  function summaryText(data) {
    var msg = (data.newGroups || 0) + ' qrup, ' +
      (data.newProducts || 0) + ' mal, ' +
      (data.newStations || 0) + ' stansiya yaranacaq — davam?';
    if (data.updatedProducts) {
      msg += ' Yenilənəcək mal: ' + data.updatedProducts + '.';
    }
    return msg;
  }

  document.getElementById('boot-add-10').addEventListener('click', function () {
    readCells();
    ensureRows(rows.length + 10);
    render();
    scheduleDraft();
  });
  document.getElementById('boot-draft').addEventListener('click', saveDraft);
  document.getElementById('boot-preview').addEventListener('click', function () {
    postBootstrap(false);
  });
  document.getElementById('boot-commit').addEventListener('click', function () {
    if (busy) {
      return;
    }
    postBootstrap(false).then(function (body) {
      if (!body || !body.data) {
        return;
      }
      var d = body.data;
      var hasWork = (d.newGroups || 0) + (d.newStations || 0) +
        (d.newProducts || 0) + (d.updatedProducts || 0) + (d.applied || 0);
      if (!hasWork) {
        say((d.warnings && d.warnings[0]) || 'Dolu sətir yoxdur.', 'err');
        return;
      }
      var msg = summaryText(d);
      function go() {
        return postBootstrap(true);
      }
      if (!window.askYes) {
        return go();
      }
      return window.askYes('Təsdiq', msg).then(function (ok) {
        if (ok) {
          return go();
        }
      });
    });
  });
  document.getElementById('boot-clear').addEventListener('click', function () {
    function wipe() {
      resetGrid();
      say('Cədvəl təmizləndi.');
    }
    if (!window.askYes) {
      wipe();
      return;
    }
    window.askYes('Cədvəli təmizlə', 'Bütün sətirlər və draft silinsin?').then(function (ok) {
      if (ok) {
        wipe();
      }
    });
  });
  document.getElementById('logout').addEventListener('click', function () {
    saveDraftSilent();
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
  syncLocalsFromRows();
  load().then(function () {
    syncLocalsFromRows();
    render();
  }).catch(function (error) {
    say(error.message, 'err');
    render();
  });
})();
