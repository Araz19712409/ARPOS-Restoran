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
  var openDrop = null;

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

  function norm(value) {
    return String(value || '').trim().toLowerCase();
  }

  function same(a, b) {
    return norm(a) === norm(b);
  }

  function nameIn(list, name) {
    var needle = norm(name);
    if (!needle) {
      return false;
    }
    return (list || []).some(function (row) {
      return norm(row.name) === needle;
    });
  }

  function findExact(list, name) {
    var needle = norm(name);
    if (!needle) {
      return null;
    }
    return (list || []).find(function (row) {
      return norm(row.name) === needle;
    }) || null;
  }

  function mergeByName(serverList, localList) {
    var out = [];
    var seen = {};
    function add(row, fromLocal) {
      var key = norm(row && row.name);
      if (!key || seen[key]) {
        return;
      }
      seen[key] = true;
      out.push({
        name: String(row.name).trim(),
        local: !!fromLocal
      });
    }
    (serverList || []).forEach(function (row) {
      add(row, false);
    });
    (localList || []).forEach(function (row) {
      add(row, true);
    });
    out.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'az');
    });
    return out;
  }

  function groupNameOfProduct(p) {
    var g = (catalog.groups || []).find(function (gr) {
      return Number(gr.id) === Number(p.groupId);
    });
    return g ? g.name : '';
  }

  function mergeProducts(groupFilter) {
    var out = [];
    var seen = {};
    function keyOf(name, groupName) {
      return norm(groupName) + '\0' + norm(name);
    }
    function add(name, groupName, fromLocal) {
      var n = String(name || '').trim();
      if (!n) {
        return;
      }
      var g = String(groupName || '').trim();
      if (groupFilter && g && !same(g, groupFilter)) {
        return;
      }
      var key = keyOf(n, g);
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      out.push({ name: n, groupName: g, local: !!fromLocal });
    }
    (catalog.products || []).forEach(function (p) {
      add(p.name, groupNameOfProduct(p), false);
    });
    (localProducts || []).forEach(function (p) {
      add(p.name, p.groupName, true);
    });
    out.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'az');
    });
    return out;
  }

  function optionsFor(kind, row) {
    if (kind === 'group') {
      return mergeByName(catalog.groups, localGroups);
    }
    if (kind === 'station') {
      return mergeByName(catalog.stations, localStations);
    }
    return mergeProducts(row && row.groupName);
  }

  function isResolved(kind, name, groupName) {
    var n = String(name || '').trim();
    if (!n) {
      return false;
    }
    if (kind === 'group') {
      return nameIn(catalog.groups, n) || nameIn(localGroups, n);
    }
    if (kind === 'station') {
      return nameIn(catalog.stations, n) || nameIn(localStations, n);
    }
    if (nameIn(localProducts.filter(function (p) {
      return same(p.groupName, groupName);
    }), n)) {
      return true;
    }
    return (catalog.products || []).some(function (p) {
      return same(p.name, n) && same(groupNameOfProduct(p), groupName);
    });
  }

  function isLocalOnly(kind, name, groupName) {
    var n = String(name || '').trim();
    if (!n) {
      return false;
    }
    if (kind === 'group') {
      return nameIn(localGroups, n) && !nameIn(catalog.groups, n);
    }
    if (kind === 'station') {
      return nameIn(localStations, n) && !nameIn(catalog.stations, n);
    }
    var onLocal = (localProducts || []).some(function (p) {
      return same(p.name, n) && same(p.groupName, groupName);
    });
    if (!onLocal) {
      return false;
    }
    return !(catalog.products || []).some(function (p) {
      return same(p.name, n) && same(groupNameOfProduct(p), groupName);
    });
  }

  function createLocal(kind, rawName, groupName) {
    var name = String(rawName || '').trim();
    if (!name) {
      say('Ad boşdur.', 'err');
      return false;
    }
    if (kind === 'group') {
      if (nameIn(catalog.groups, name) || nameIn(localGroups, name)) {
        say('Qrup artıq siyahıdadır.', 'ok');
        return true;
      }
      localGroups.push({ name: name });
      say('Qrup əlavə olundu (təsdiqə qədər lokal)', 'ok');
      return true;
    }
    if (kind === 'station') {
      if (nameIn(catalog.stations, name) || nameIn(localStations, name)) {
        say('Stansiya artıq siyahıdadır.', 'ok');
        return true;
      }
      localStations.push({ name: name });
      say('Stansiya əlavə olundu (təsdiqə qədər lokal)', 'ok');
      return true;
    }
    var g = String(groupName || '').trim();
    if (!g) {
      say('Əvvəl qrup seçin və ya yaradın.', 'err');
      return false;
    }
    if (!isResolved('group', g)) {
      say('Əvvəl qrupu + ilə yaradın və ya siyahıdan seçin.', 'err');
      return false;
    }
    if (isResolved('product', name, g)) {
      say('Mal artıq siyahıdadır.', 'ok');
      return true;
    }
    localProducts.push({ name: name, groupName: g });
    say('Mal əlavə olundu (təsdiqə qədər lokal)', 'ok');
    return true;
  }

  function removeLocal(kind, name, groupName) {
    var n = norm(name);
    if (kind === 'group') {
      localGroups = localGroups.filter(function (row) {
        return norm(row.name) !== n;
      });
      return;
    }
    if (kind === 'station') {
      localStations = localStations.filter(function (row) {
        return norm(row.name) !== n;
      });
      return;
    }
    localProducts = localProducts.filter(function (row) {
      return !(norm(row.name) === n && same(row.groupName, groupName));
    });
  }

  function closeDrop() {
    if (openDrop) {
      openDrop.classList.add('hidden');
      openDrop = null;
    }
  }

  function saveDraftSilent() {
    readCells();
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        rows: rows,
        localGroups: localGroups,
        localStations: localStations,
        localProducts: localProducts
      }));
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
      isLocalOnly('group', row.groupName));
    markNew(tr.querySelector('[data-field="productName"]'),
      isLocalOnly('product', row.productName, row.groupName));
    markNew(tr.querySelector('[data-field="stationName"]'),
      isLocalOnly('station', row.stationName));
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
      return {};
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

  function markDoneRows(errHit) {
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
      if (String(row.groupName || '').trim() && String(row.productName || '').trim()) {
        tr.classList.add('boot-done');
      }
    });
  }

  function tryResolveInput(kind, input, row) {
    var typed = String(input.value || '').trim();
    if (!typed) {
      return true;
    }
    var list = optionsFor(kind, row);
    var hit = findExact(list, typed);
    if (hit) {
      input.value = hit.name;
      if (kind === 'group') {
        row.groupName = hit.name;
      } else if (kind === 'station') {
        row.stationName = hit.name;
      } else {
        row.productName = hit.name;
        if (hit.groupName && !String(row.groupName || '').trim()) {
          row.groupName = hit.groupName;
        }
      }
      return true;
    }
    return false;
  }

  function buildDrop(kind, input, row, tr, wrap) {
    var drop = wrap.querySelector('.boot-drop');
    if (!drop) {
      drop = document.createElement('ul');
      drop.className = 'boot-drop hidden';
      wrap.appendChild(drop);
    }
    drop.innerHTML = '';
    var q = String(input.value || '').trim();
    var qn = norm(q);
    var list = optionsFor(kind, row).filter(function (item) {
      if (!qn) {
        return true;
      }
      return norm(item.name).indexOf(qn) >= 0;
    }).slice(0, 40);

    list.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'boot-drop-item';
      var label = document.createElement('button');
      label.type = 'button';
      label.className = 'boot-drop-pick';
      label.textContent = item.name;
      label.addEventListener('mousedown', function (event) {
        event.preventDefault();
        input.value = item.name;
        if (kind === 'group') {
          row.groupName = item.name;
        } else if (kind === 'station') {
          row.stationName = item.name;
        } else {
          row.productName = item.name;
        }
        closeDrop();
        updateNewFlags(tr, row);
        scheduleDraft();
        maybeAddRow(Number(input.getAttribute('data-row')) || 0);
      });
      li.appendChild(label);
      if (item.local) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'boot-drop-del';
        del.title = 'Lokal sil';
        del.textContent = '✕';
        del.addEventListener('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
          removeLocal(kind, item.name, kind === 'product' ? row.groupName : '');
          if (same(input.value, item.name)) {
            input.value = '';
            if (kind === 'group') {
              row.groupName = '';
            } else if (kind === 'station') {
              row.stationName = '';
            } else {
              row.productName = '';
            }
          }
          buildDrop(kind, input, row, tr, wrap);
          drop.classList.remove('hidden');
          openDrop = drop;
          updateNewFlags(tr, row);
          scheduleDraft();
        });
        li.appendChild(del);
      }
      drop.appendChild(li);
    });

    var exact = q && findExact(optionsFor(kind, row), q);
    if (q && !exact) {
      var createLi = document.createElement('li');
      createLi.className = 'boot-drop-item boot-drop-create';
      var createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'boot-drop-pick';
      createBtn.textContent = 'Yarat: ' + q;
      createBtn.addEventListener('mousedown', function (event) {
        event.preventDefault();
        if (!createLocal(kind, q, row.groupName)) {
          return;
        }
        input.value = q;
        if (kind === 'group') {
          row.groupName = q;
        } else if (kind === 'station') {
          row.stationName = q;
        } else {
          row.productName = q;
        }
        closeDrop();
        updateNewFlags(tr, row);
        scheduleDraft();
        maybeAddRow(Number(input.getAttribute('data-row')) || 0);
      });
      createLi.appendChild(createBtn);
      drop.appendChild(createLi);
    }

    if (!drop.children.length) {
      var empty = document.createElement('li');
      empty.className = 'boot-drop-empty';
      empty.textContent = q ? 'Tapılmadı — + və ya Yarat' : 'Siyahı boş';
      drop.appendChild(empty);
    }
    return drop;
  }

  function openComboDrop(kind, input, row, tr, wrap) {
    var drop = buildDrop(kind, input, row, tr, wrap);
    if (openDrop && openDrop !== drop) {
      openDrop.classList.add('hidden');
    }
    drop.classList.remove('hidden');
    openDrop = drop;
  }

  function bindCombo(input, kind, row, tr, i, wrap) {
    var plus = wrap.querySelector('.boot-plus');
    input.addEventListener('focus', function () {
      openComboDrop(kind, input, row, tr, wrap);
    });
    input.addEventListener('input', function () {
      if (kind === 'group') {
        row.groupName = input.value;
      } else if (kind === 'station') {
        row.stationName = input.value;
      } else {
        row.productName = input.value;
      }
      openComboDrop(kind, input, row, tr, wrap);
      updateNewFlags(tr, row);
      maybeAddRow(i);
      scheduleDraft();
    });
    input.addEventListener('blur', function () {
      window.setTimeout(function () {
        tryResolveInput(kind, input, row);
        updateNewFlags(tr, row);
        scheduleDraft();
        if (openDrop && !wrap.contains(document.activeElement)) {
          closeDrop();
        }
      }, 120);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeDrop();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        var resolved = tryResolveInput(kind, input, row);
        if (!resolved) {
          var typed = String(input.value || '').trim();
          var exact = typed && findExact(optionsFor(kind, row), typed);
          if (!exact && typed) {
            say('Siyahıdan seçin və ya + / Yarat ilə əlavə edin.', 'err');
            openComboDrop(kind, input, row, tr, wrap);
            return;
          }
        }
        closeDrop();
        updateNewFlags(tr, row);
        onKey(event, i, input.getAttribute('data-col'));
        return;
      }
      if (event.key === 'Tab') {
        tryResolveInput(kind, input, row);
        closeDrop();
        return;
      }
      onKey(event, i, input.getAttribute('data-col'));
    });
    if (plus) {
      plus.addEventListener('mousedown', function (event) {
        event.preventDefault();
        var typed = String(input.value || '').trim();
        if (!typed) {
          say('Əvvəl ad yazın.', 'err');
          input.focus();
          return;
        }
        if (!createLocal(kind, typed, row.groupName)) {
          return;
        }
        input.value = typed;
        if (kind === 'group') {
          row.groupName = typed;
        } else if (kind === 'station') {
          row.stationName = typed;
        } else {
          row.productName = typed;
        }
        closeDrop();
        updateNewFlags(tr, row);
        scheduleDraft();
        maybeAddRow(i);
      });
    }
  }

  function bindPlain(input, row, tr, i, key) {
    input.addEventListener('input', function () {
      row[key] = input.value;
      maybeAddRow(i);
      scheduleDraft();
    });
    input.addEventListener('keydown', function (event) {
      onKey(event, i, key);
    });
  }

  function addComboCell(tr, row, i, key, kind) {
    var td = document.createElement('td');
    td.className = 'boot-cell boot-combo-cell';
    td.setAttribute('data-field', key);
    var wrap = document.createElement('div');
    wrap.className = 'boot-combo-wrap';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = row[key] || '';
    input.setAttribute('data-col', key);
    input.setAttribute('data-row', String(i));
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    var plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'boot-plus';
    plus.title = 'Yarat';
    plus.textContent = '+';
    wrap.appendChild(input);
    wrap.appendChild(plus);
    td.appendChild(wrap);
    tr.appendChild(td);
    bindCombo(input, kind, row, tr, i, wrap);
  }

  function addPlainCell(tr, row, i, key, listId) {
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
    bindPlain(input, row, tr, i, key);
    td.appendChild(input);
    tr.appendChild(td);
  }

  function render() {
    var body = document.getElementById('boot-body');
    if (!body) {
      return;
    }
    closeDrop();
    body.innerHTML = '';
    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');
      var num = document.createElement('td');
      num.className = 'num';
      num.textContent = String(i + 1);
      tr.appendChild(num);
      addComboCell(tr, row, i, 'groupName', 'group');
      addComboCell(tr, row, i, 'productName', 'product');
      addPlainCell(tr, row, i, 'salePrice', '');
      addPlainCell(tr, row, i, 'qty', '');
      addPlainCell(tr, row, i, 'buyPrice', '');
      addComboCell(tr, row, i, 'stationName', 'station');
      addPlainCell(tr, row, i, 'unit', 'boot-units');
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
    var empty = emptyRow();
    rows.push(empty);
    var body = document.getElementById('boot-body');
    if (!body) {
      render();
      scheduleDraft();
      return;
    }
    var tr = document.createElement('tr');
    var num = document.createElement('td');
    num.className = 'num';
    num.textContent = String(rows.length);
    tr.appendChild(num);
    var ni = rows.length - 1;
    addComboCell(tr, empty, ni, 'groupName', 'group');
    addComboCell(tr, empty, ni, 'productName', 'product');
    addPlainCell(tr, empty, ni, 'salePrice', '');
    addPlainCell(tr, empty, ni, 'qty', '');
    addPlainCell(tr, empty, ni, 'buyPrice', '');
    addComboCell(tr, empty, ni, 'stationName', 'station');
    addPlainCell(tr, empty, ni, 'unit', 'boot-units');
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

  function rowIsEmpty(row) {
    return !COLS.some(function (k) {
      return String(row[k] || '').trim() !== '';
    });
  }

  function validateForCommit() {
    readCells();
    clearRowMarks();
    var body = document.getElementById('boot-body');
    var errors = [];
    var lines = [];
    rows.forEach(function (row, i) {
      if (rowIsEmpty(row)) {
        return;
      }
      var g = String(row.groupName || '').trim();
      var p = String(row.productName || '').trim();
      var s = String(row.stationName || '').trim();
      var bad = false;
      if (!g || !p) {
        bad = true;
        errors.push('Sətir ' + (i + 1) + ': qrup və mal vacibdir.');
      } else {
        if (!isResolved('group', g)) {
          bad = true;
          errors.push('Sətir ' + (i + 1) + ': qrupu seçin və ya + ilə yaradın.');
        }
        if (!isResolved('product', p, g)) {
          bad = true;
          errors.push('Sətir ' + (i + 1) + ': malı seçin və ya + ilə yaradın.');
        }
      }
      if (s && !isResolved('station', s)) {
        bad = true;
        errors.push('Sətir ' + (i + 1) + ': stansiyanı seçin və ya + ilə yaradın.');
      }
      if (bad) {
        if (body && body.querySelectorAll('tr')[i]) {
          body.querySelectorAll('tr')[i].classList.add('boot-err');
        }
        return;
      }
      lines.push({
        groupName: g,
        productName: p,
        salePrice: row.salePrice,
        qty: row.qty,
        buyPrice: row.buyPrice,
        stationName: s,
        unit: row.unit,
        _rowIndex: i
      });
    });
    return { errors: errors, lines: lines };
  }

  function payloadLines(forConfirm) {
    if (forConfirm) {
      return validateForCommit().lines.map(function (line) {
        return {
          groupName: line.groupName,
          productName: line.productName,
          salePrice: line.salePrice,
          qty: line.qty,
          buyPrice: line.buyPrice,
          stationName: line.stationName,
          unit: line.unit
        };
      });
    }
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
      if (!raw) {
        return false;
      }
      if (Array.isArray(raw) && raw.length) {
        rows = raw.map(function (row) {
          return Object.assign(emptyRow(), row || {});
        });
        return true;
      }
      if (raw && Array.isArray(raw.rows) && raw.rows.length) {
        rows = raw.rows.map(function (row) {
          return Object.assign(emptyRow(), row || {});
        });
        localGroups = Array.isArray(raw.localGroups) ? raw.localGroups.slice() : [];
        localStations = Array.isArray(raw.localStations) ? raw.localStations.slice() : [];
        localProducts = Array.isArray(raw.localProducts) ? raw.localProducts.slice() : [];
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

  function remapWarnings(warnings, sourceIndexes) {
    return (warnings || []).map(function (w) {
      var m = String(w || '').match(/S([əe])tir\s+(\d+)/i);
      if (!m) {
        return w;
      }
      var payloadIdx = Number(m[2]) - 1;
      if (sourceIndexes && sourceIndexes[payloadIdx] != null) {
        return String(w).replace(/S[əe]tir\s+\d+/i, 'Sətir ' + (sourceIndexes[payloadIdx] + 1));
      }
      return w;
    });
  }

  function postBootstrap(doConfirm, lines, sourceIndexes) {
    if (busy) {
      return Promise.resolve(null);
    }
    busy = true;
    var payload = lines || payloadLines(!!doConfirm);
    return api('/api/catalog/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirm: !!doConfirm,
        warehouseId: 1,
        lines: payload
      })
    }).then(function (body) {
      var data = body.data || {};
      if (sourceIndexes && data.warnings) {
        data.warnings = remapWarnings(data.warnings, sourceIndexes);
      }
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
          localGroups = localGroups.filter(function (g) {
            return !nameIn(catalog.groups, g.name);
          });
          localStations = localStations.filter(function (s) {
            return !nameIn(catalog.stations, s.name);
          });
          localProducts = localProducts.filter(function (p) {
            return !(catalog.products || []).some(function (prod) {
              return same(prod.name, p.name) && same(groupNameOfProduct(prod), p.groupName);
            });
          });
          saveDraftSilent();
          render();
          var hit = applyWarningMarks(data.warnings) || errHit;
          markDoneRows(hit);
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

  function toPayload(check) {
    var sourceIndexes = [];
    var lines = check.lines.map(function (line) {
      sourceIndexes.push(line._rowIndex);
      return {
        groupName: line.groupName,
        productName: line.productName,
        salePrice: line.salePrice,
        qty: line.qty,
        buyPrice: line.buyPrice,
        stationName: line.stationName,
        unit: line.unit
      };
    });
    return { lines: lines, sourceIndexes: sourceIndexes };
  }

  document.addEventListener('mousedown', function (event) {
    if (openDrop && !event.target.closest('.boot-combo-wrap')) {
      closeDrop();
    }
  });

  document.getElementById('boot-add-10').addEventListener('click', function () {
    readCells();
    ensureRows(rows.length + 10);
    render();
    scheduleDraft();
  });
  document.getElementById('boot-draft').addEventListener('click', saveDraft);
  document.getElementById('boot-preview').addEventListener('click', function () {
    var check = validateForCommit();
    if (check.errors.length) {
      say(check.errors[0], 'err');
      return;
    }
    if (!check.lines.length) {
      say('Dolu sətir yoxdur.', 'err');
      return;
    }
    var pack = toPayload(check);
    postBootstrap(false, pack.lines, pack.sourceIndexes);
  });
  document.getElementById('boot-commit').addEventListener('click', function () {
    if (busy) {
      return;
    }
    var check = validateForCommit();
    if (check.errors.length) {
      say(check.errors[0], 'err');
      return;
    }
    if (!check.lines.length) {
      say('Dolu sətir yoxdur.', 'err');
      return;
    }
    var pack = toPayload(check);
    postBootstrap(false, pack.lines, pack.sourceIndexes).then(function (body) {
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
        return postBootstrap(true, pack.lines, pack.sourceIndexes);
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
  load().then(function () {
    render();
  }).catch(function (error) {
    say(error.message, 'err');
    render();
  });
})();
