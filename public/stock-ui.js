(function () {
  var waiter = null;
  var pinBuffer = '';
  var items = [];
  var purchases = [];
  var moves = [];
  var suppliers = [];
  var moveId = 0;
  var editId = 0;
  var editQty = 0;
  var stockQuery = '';
  var lowOnly = false;
  var inventories = [];
  var productions = [];
  var transfers = [];
  var warehouses = [];
  var invId = 0;
  var prodId = 0;
  var xferId = 0;
  var offId = 0;
  var warehouseFilter = '';
  var stockTab = 'qty';

  function dec(value) {
    return window.PosNav && window.PosNav.parseDec
      ? window.PosNav.parseDec(value)
      : Number(String(value == null ? '' : value).replace(',', '.'));
  }

  function api(url, options) {
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var body;
        try {
          body = JSON.parse(text);
        } catch (err) {
          throw new Error(res.status === 404
            ? 'Server köhnədir. Səhifəni yeniləyin.'
            : 'Cavab oxunmadı.');
        }
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

  function can(key) {
    return waiter && waiter.permissions && waiter.permissions.indexOf(key) !== -1;
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
      document.getElementById('waiter-line').textContent = data.user.name + ' • anbar';
    } else {
      if (window.PosNav) {
        window.PosNav.forget();
      }
      window.sessionStorage.removeItem('posWaiter');
      showLock();
    }
    if (window.PosNav && !window.PosNav.afterLogin(data)) {
      return;
    }
    if (data && window.PosNav && !window.PosNav.isStockMode(data)) {
      window.location.replace(window.PosNav.homePath());
      return;
    }
    document.getElementById('stock-open-add').style.display = can('stock.edit') ? '' : 'none';
    document.getElementById('stock-tab-buy').style.display = can('stock.edit') ? '' : 'none';
    if (!can('stock.edit') && (stockTab === 'buy' || stockTab === 'inv' || stockTab === 'prod' || stockTab === 'xfer')) {
      showTab('qty');
    }
    if (data) {
      load();
    }
  }

  function showTab(tab) {
    stockTab = tab;
    document.getElementById('stock-qty-panel').classList.toggle('hidden', tab !== 'qty');
    document.getElementById('stock-buy-box').classList.toggle('hidden', tab !== 'buy');
    document.getElementById('stock-hist-panel').classList.toggle('hidden', tab !== 'hist');
    document.getElementById('stock-inv-panel').classList.toggle('hidden', tab !== 'inv');
    document.getElementById('stock-prod-panel').classList.toggle('hidden', tab !== 'prod');
    document.getElementById('stock-xfer-panel').classList.toggle('hidden', tab !== 'xfer');
    document.getElementById('stock-qty-tools').classList.toggle('hidden', tab !== 'qty');
    document.querySelectorAll('.stock-tabs [data-tab]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
  }

  function itemMatches(row) {
    if (lowOnly && !row.low) {
      return false;
    }
    var q = stockQuery.trim().toLocaleLowerCase('az');
    if (!q) {
      return true;
    }
    return String(row.name || '').toLocaleLowerCase('az').indexOf(q) !== -1;
  }

  function unitLocked(row) {
    return Number(row.qty) !== 0 || row.hasMoves || row.inRecipe;
  }

  function addAct(box, label, onClick, opts) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (opts && opts.disabled) {
      btn.disabled = true;
      btn.title = opts.title || '';
    } else {
      btn.addEventListener('click', onClick);
    }
    box.appendChild(btn);
  }

  function openEdit(row) {
    editId = row.id;
    editQty = Number(row.qty) || 0;
    document.getElementById('stock-edit-title').textContent = row.name;
    document.getElementById('stock-edit-qty-line').textContent =
      'Qalıq: ' + row.qty + ' ' + row.unit + ' — buradan dəyişmir, «Qalıq düzəlt» istifadə edin.';
    document.getElementById('stock-edit-name').value = row.name;
    document.getElementById('stock-edit-unit').value = row.unit;
    document.getElementById('stock-edit-unit').disabled = unitLocked(row);
    document.getElementById('stock-edit-unit-hint').classList.toggle('hidden', !unitLocked(row));
    document.getElementById('stock-edit-min').value = String(row.minQty);
    document.getElementById('stock-edit-buy').value = Number(row.buyPrice).toFixed(2);
    document.getElementById('stock-edit-total').value = (editQty * Number(row.buyPrice)).toFixed(2);
    document.getElementById('stock-edit-total').disabled = editQty <= 0;
    document.getElementById('stock-edit-kind').value = row.kind === 'semi' ? 'semi' : 'raw';
    fillRecipeBox('stock-edit-recipe', row.recipe || []);
    toggleRecipeBox('edit');
    document.getElementById('stock-edit-modal').classList.remove('hidden');
  }

  function deleteItem(row) {
    if (row.inRecipe) {
      say('Reseptdədir: ' + (row.recipes || []).join(', ') + '. Əvvəl tərkibdən çıxarın.', 'err');
      return;
    }
    if (row.hasMoves && !can('stock.delete')) {
      say('Hərəkət var. Silmək üçün Anbar → Sil icazəsi lazımdır.', 'err');
      return;
    }
    var extra = row.hasMoves
      ? 'Alış/hərəkət tarixi qalacaq, xammal siyahıdan düşəcək.'
      : (Number(row.qty) > 0 ? 'Qalıq da silinəcək: ' + row.qty + ' ' + row.unit + '.' : '');
    window.askDelete(row.name, extra).then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/stock/' + row.id, { method: 'DELETE' }).then(function () {
        say('"' + row.name + '" silindi.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function render() {
    var low = items.filter(function (row) { return row.low; });
    var banner = document.getElementById('stock-low-banner');
    if (banner) {
      if (low.length) {
        banner.textContent = low.length + ' xammal az qalıb: ' +
          low.slice(0, 8).map(function (row) { return row.name; }).join(', ') +
          (low.length > 8 ? '…' : '');
        banner.classList.remove('hidden');
      } else {
        banner.textContent = '';
        banner.classList.add('hidden');
      }
    }
    var box = document.getElementById('stock-body');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<tr><td colspan="6">Xammal yoxdur.</td></tr>';
      return;
    }
    var shown = items.filter(itemMatches);
    if (!shown.length) {
      box.innerHTML = '<tr><td colspan="6">Uyğun xammal yoxdur.</td></tr>';
      return;
    }
    shown.forEach(function (row) {
      var tr = document.createElement('tr');
      if (row.low) {
        tr.style.color = '#e2b65a';
      }
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = row.name + (row.kind === 'semi' ? ' · Yarımfabrikat' : '');
      cells[1].textContent = row.qty + ' ' + row.unit;
      cells[1].className = 'num';
      cells[2].textContent = row.minQty + ' ' + row.unit;
      cells[2].className = 'num';
      cells[3].textContent = Number(row.buyPrice).toFixed(2);
      cells[3].className = 'num';
      cells[4].textContent = (Number(row.qty) * Number(row.buyPrice)).toFixed(2);
      cells[4].className = 'num';
      var acts = document.createElement('div');
      acts.className = 'stock-acts';
      if (can('stock.edit')) {
        addAct(acts, 'Dəyiş', function () { openEdit(row); });
        addAct(acts, 'Zay', function () {
          offId = row.id;
          document.getElementById('stock-off-title').textContent = row.name;
          document.getElementById('stock-off-qty').value = '';
          document.getElementById('stock-off-note').value = '';
          document.getElementById('stock-off-reason').value = 'spoil';
          document.getElementById('stock-off-modal').classList.remove('hidden');
        });
        addAct(acts, 'Qalıq', function () {
          moveId = row.id;
          document.getElementById('stock-move-title').textContent = row.name;
          document.getElementById('stock-move-qty').value = '';
          document.getElementById('stock-move-note').value = '';
          document.getElementById('stock-waste-reason').value = '';
          document.getElementById('stock-move-type').value = 'count';
          document.getElementById('stock-waste-wrap').style.display = 'none';
          document.getElementById('stock-move-modal').classList.remove('hidden');
        });
      }
      if (can('stock.edit') || can('stock.delete')) {
        addAct(acts, 'Sil', function () { deleteItem(row); });
      }
      cells[5].appendChild(acts);
      box.appendChild(tr);
    });
  }

  function fillWhSelect(select, selectedId, opts) {
    if (!select) {
      return;
    }
    var prev = selectedId != null ? String(selectedId) : select.value;
    select.innerHTML = '';
    if (opts && opts.all) {
      var all = document.createElement('option');
      all.value = '';
      all.textContent = 'Hamısı';
      select.appendChild(all);
    }
    (warehouses || []).forEach(function (row) {
      if (opts && opts.activeOnly && row.active === false) {
        return;
      }
      var opt = document.createElement('option');
      opt.value = String(row.id);
      opt.textContent = row.name + (row.active === false ? ' (bağlı)' : '');
      select.appendChild(opt);
    });
    if (prev && Array.prototype.some.call(select.options, function (opt) { return opt.value === prev; })) {
      select.value = prev;
    }
  }

  function activeWhId() {
    var row = (warehouses || []).find(function (item) { return item.active !== false; });
    return row ? row.id : 1;
  }

  function fillWhFields() {
    fillWhSelect(document.getElementById('stock-wh-filter'), warehouseFilter, { all: true });
    ['buy-warehouse', 'inv-warehouse', 'prod-from', 'prod-to', 'xfer-from', 'xfer-to',
      'stock-move-warehouse', 'stock-off-warehouse'].forEach(function (id) {
      var el = document.getElementById(id);
      fillWhSelect(el, (el && el.value) || activeWhId(), { activeOnly: true });
    });
  }

  function fillItemSelect(select, selectedId) {
    select.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Xammal';
    select.appendChild(blank);
    items.forEach(function (row) {
      var opt = document.createElement('option');
      opt.value = String(row.id);
      opt.textContent = row.name + ' (' + row.unit + ')';
      if (Number(selectedId) === row.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function fillRawSelect(select, selectedId) {
    select.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Xammal';
    select.appendChild(blank);
    items.filter(function (row) {
      return row.kind !== 'semi';
    }).forEach(function (row) {
      var opt = document.createElement('option');
      opt.value = String(row.id);
      opt.textContent = row.name + ' (' + row.unit + ')';
      if (Number(selectedId) === row.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function addRecipeLine(boxId, itemId, qty, unit) {
    var box = document.getElementById(boxId);
    if (!box) {
      return;
    }
    var row = document.createElement('div');
    row.className = 'stock-recipe-line';
    var sel = document.createElement('select');
    fillRawSelect(sel, itemId);
    var qtyIn = document.createElement('input');
    qtyIn.type = 'text';
    qtyIn.inputMode = 'decimal';
    qtyIn.placeholder = 'Miqdar';
    qtyIn.value = qty != null ? String(qty) : '';
    var unitSel = document.createElement('select');
    ['əd', 'kq', 'l', 'qr', 'ml'].forEach(function (u) {
      var opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === (unit || 'əd')) {
        opt.selected = true;
      }
      unitSel.appendChild(opt);
    });
    var del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Sil';
    del.addEventListener('click', function () {
      box.removeChild(row);
    });
    row.appendChild(sel);
    row.appendChild(qtyIn);
    row.appendChild(unitSel);
    row.appendChild(del);
    box.appendChild(row);
  }

  function fillRecipeBox(boxId, list) {
    var box = document.getElementById(boxId);
    if (!box) {
      return;
    }
    box.innerHTML = '';
    (list || []).forEach(function (line) {
      addRecipeLine(boxId, line.itemId, line.qty, line.unit);
    });
  }

  function collectRecipe(boxId) {
    var lines = [];
    var box = document.getElementById(boxId);
    if (!box) {
      return lines;
    }
    Array.prototype.forEach.call(box.querySelectorAll('.stock-recipe-line'), function (row) {
      var itemId = Number(row.querySelector('select').value);
      var qty = dec(row.querySelector('input').value);
      var unit = row.querySelectorAll('select')[1].value;
      if (!itemId || !qty || qty <= 0) {
        return;
      }
      lines.push({ itemId: itemId, qty: qty, unit: unit });
    });
    return lines;
  }

  function toggleRecipeBox(which) {
    var kind = document.getElementById(which === 'edit' ? 'stock-edit-kind' : 'stock-add-kind');
    var box = document.getElementById(which === 'edit' ? 'stock-edit-recipe-box' : 'stock-add-recipe-box');
    if (!kind || !box) {
      return;
    }
    box.classList.toggle('hidden', kind.value !== 'semi');
  }

  function buyLineTotal(row) {
    var qty = dec(row.querySelector('.buy-qty').value) || 0;
    var price = dec(row.querySelector('.buy-price').value) || 0;
    return qty * price;
  }

  function updateBuyTotal() {
    var sum = 0;
    document.querySelectorAll('#buy-lines .buy-line').forEach(function (row) {
      var line = buyLineTotal(row);
      var box = row.querySelector('.buy-sum');
      if (box && document.activeElement !== box) {
        box.value = line ? line.toFixed(2) : '';
      }
      sum += line;
    });
    document.getElementById('buy-total').textContent = sum.toFixed(2) + ' AZN';
  }

  function addBuyLine(itemId, qty, price) {
    var row = document.createElement('div');
    row.className = 'buy-line';
    row.innerHTML =
      '<label>Xammal<select class="buy-item"></select></label>' +
      '<label>Miqdar<input class="buy-qty" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label>Alış, 1 vahid<input class="buy-price" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label>Cəm<input class="buy-sum" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<button class="buy-del" type="button">Sil</button>';
    var select = row.querySelector('.buy-item');
    fillItemSelect(select, itemId);
    if (qty != null) {
      row.querySelector('.buy-qty').value = String(qty);
    }
    if (price != null) {
      row.querySelector('.buy-price').value = String(price);
    } else if (itemId) {
      var found = items.find(function (item) { return item.id === Number(itemId); });
      if (found) {
        row.querySelector('.buy-price').value = String(found.buyPrice);
      }
    }
    select.addEventListener('change', function () {
      var found = items.find(function (item) { return item.id === Number(select.value); });
      row.querySelector('.buy-price').value = found ? String(found.buyPrice) : '';
      updateBuyTotal();
    });
    row.querySelector('.buy-qty').addEventListener('input', updateBuyTotal);
    row.querySelector('.buy-price').addEventListener('input', updateBuyTotal);
    row.querySelector('.buy-sum').addEventListener('input', function () {
      var qty = dec(row.querySelector('.buy-qty').value) || 0;
      var total = dec(row.querySelector('.buy-sum').value) || 0;
      if (qty > 0) {
        row.querySelector('.buy-price').value = (total / qty).toFixed(2);
      }
      var sum = 0;
      document.querySelectorAll('#buy-lines .buy-line').forEach(function (line) {
        sum += buyLineTotal(line);
      });
      document.getElementById('buy-total').textContent = sum.toFixed(2) + ' AZN';
    });
    row.querySelector('.buy-del').addEventListener('click', function () {
      row.remove();
      if (!document.querySelector('#buy-lines .buy-line')) {
        addBuyLine();
      }
      updateBuyTotal();
    });
    document.getElementById('buy-lines').appendChild(row);
    updateBuyTotal();
  }

  function collectBuyLines() {
    var lines = [];
    document.querySelectorAll('#buy-lines .buy-line').forEach(function (row) {
      var itemId = Number(row.querySelector('.buy-item').value);
      var qty = dec(row.querySelector('.buy-qty').value);
      var buyPrice = dec(row.querySelector('.buy-price').value);
      if (!itemId || !qty || qty <= 0) {
        return;
      }
      lines.push({ itemId: itemId, qty: qty, buyPrice: buyPrice });
    });
    return lines;
  }

  function formatWhen(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderPurchases() {
    var box = document.getElementById('buy-body');
    box.innerHTML = '';
    if (!purchases.length) {
      box.innerHTML = '<tr><td colspan="9">Alış yoxdur.</td></tr>';
      return;
    }
    purchases.forEach(function (row) {
      var due = Number(row.due != null ? row.due : 0);
      var paid = Number(row.paid != null ? row.paid : row.total);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = formatWhen(row.at);
      cells[1].textContent = row.supplier || '—';
      cells[2].textContent = row.docNo || '—';
      cells[3].textContent = (row.lines || []).map(function (line) {
        return line.name + ' ' + line.qty + ' ' + line.unit;
      }).join(', ');
      cells[3].className = 'wrap';
      cells[4].textContent = Number(row.total).toFixed(2);
      cells[4].className = 'num';
      cells[5].textContent = paid.toFixed(2);
      cells[5].className = 'num';
      cells[6].textContent = due.toFixed(2);
      cells[6].className = 'num';
      cells[7].textContent = row.by || '';
      if (due > 0 && can('stock.edit')) {
        var payBtn = document.createElement('button');
        payBtn.type = 'button';
        payBtn.textContent = 'Ödə';
        payBtn.addEventListener('click', function () {
          payPurchase(row);
        });
        cells[8].appendChild(payBtn);
      }
      box.appendChild(tr);
    });
  }

  function payPurchase(row) {
    var due = Number(row.due || 0).toFixed(2);
    window.askYes('Ödəniş', (row.supplier || 'Təchizatçı') + ': qalan ' + due + ' AZN ödənilsin?').then(function (ok) {
      if (!ok) {
        return;
      }
      var termId = 0;
      try {
        var term = JSON.parse(window.localStorage.getItem('posTerminal') || 'null');
        termId = term && term.id ? Number(term.id) : 0;
      } catch (error) {
        termId = 0;
      }
      return api('/api/stock/purchases/' + row.id + '/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: row.due, terminalId: termId })
      }).then(function () {
        say('Borc ödənildi.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function moveKind(type) {
    if (type === 'in') {
      return 'Giriş';
    }
    if (type === 'inv_plus') {
      return 'İnventar +';
    }
    if (type === 'inv_minus') {
      return 'İnventar −';
    }
    if (type === 'prod_use') {
      return 'İstehsal sərf';
    }
    if (type === 'prod_in') {
      return 'İstehsal';
    }
    if (type === 'xfer_out') {
      return 'Köçürmə −';
    }
    if (type === 'xfer_in') {
      return 'Köçürmə +';
    }
    if (type === 'out') {
      return 'Çıxış';
    }
    if (type === 'adjust') {
      return 'Düzəliş';
    }
    if (type === 'count') {
      return 'Sayım';
    }
    if (type === 'sale') {
      return 'Satış';
    }
    if (type === 'void') {
      return 'Ləğv';
    }
    return type || '—';
  }

  function itemNameById(id) {
    var row = items.find(function (item) { return item.id === Number(id); });
    return row ? row.name : ('#' + id);
  }

  function renderMoves() {
    var box = document.getElementById('move-body');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    if (!moves.length) {
      box.innerHTML = '<tr><td colspan="5">Hərəkət yoxdur.</td></tr>';
      return;
    }
    moves.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = formatWhen(row.at);
      cells[1].textContent = itemNameById(row.itemId);
      cells[2].textContent = moveKind(row.type);
      cells[3].textContent = String(row.qty);
      cells[4].textContent = row.note || '';
      box.appendChild(tr);
    });
  }

  function fillSuppliers() {
    var list = document.getElementById('supplier-list');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    suppliers.forEach(function (name) {
      var text = typeof name === 'string' ? name : (name && name.name) || '';
      if (!text) {
        return;
      }
      var opt = document.createElement('option');
      opt.value = text;
      list.appendChild(opt);
    });
  }

  function currentInv() {
    return inventories.find(function (row) {
      return row.id === Number(invId);
    }) || null;
  }

  function collectInvCounts() {
    var counts = [];
    document.querySelectorAll('#inv-lines input[data-item]').forEach(function (input) {
      counts.push({
        itemId: Number(input.getAttribute('data-item')),
        countedQty: dec(input.value)
      });
    });
    return counts;
  }

  function renderInv() {
    var docs = document.getElementById('inv-docs');
    var lines = document.getElementById('inv-lines');
    var title = document.getElementById('inv-title');
    if (!docs || !lines) {
      return;
    }
    docs.innerHTML = '';
    if (!inventories.length) {
      docs.innerHTML = '<tr><td colspan="3">Sayım yoxdur.</td></tr>';
    } else {
      inventories.forEach(function (row) {
        var tr = document.createElement('tr');
        tr.className = 'inv-doc-row' + (row.id === invId ? ' active' : '');
        tr.innerHTML = '<td></td><td></td><td></td>';
        var cells = tr.querySelectorAll('td');
        cells[0].textContent = '#' + row.id;
        cells[1].textContent = row.status === 'done' ? 'Təsdiq' : 'Qaralama';
        cells[2].textContent = row.by || '';
        tr.addEventListener('click', function () {
          invId = row.id;
          renderInv();
        });
        docs.appendChild(tr);
      });
    }
    var doc = currentInv();
    lines.innerHTML = '';
    var canEdit = can('stock.edit') && doc && doc.status === 'draft';
    document.getElementById('stock-inv-save').disabled = !canEdit;
    document.getElementById('stock-inv-confirm').disabled = !canEdit;
    document.getElementById('stock-inv-new').style.display = can('stock.edit') ? '' : 'none';
    if (!doc) {
      title.textContent = 'Sənəd seçin.';
      return;
    }
    title.textContent = 'İnventar #' + doc.id + (doc.status === 'done' ? ' (təsdiq)' : ' (qaralama)');
    (doc.counts || []).forEach(function (line) {
      var tr = document.createElement('tr');
      var nameTd = document.createElement('td');
      nameTd.textContent = line.name + ' (' + line.unit + ')';
      var sysTd = document.createElement('td');
      sysTd.className = 'num';
      sysTd.textContent = String(line.systemQty);
      var cntTd = document.createElement('td');
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.setAttribute('data-item', String(line.itemId));
      input.value = String(line.countedQty);
      input.disabled = !canEdit;
      cntTd.appendChild(input);
      tr.appendChild(nameTd);
      tr.appendChild(sysTd);
      tr.appendChild(cntTd);
      lines.appendChild(tr);
    });
  }

  function currentProd() {
    return productions.find(function (row) {
      return row.id === Number(prodId);
    }) || null;
  }

  function fillProdOutput(selectedId) {
    var sel = document.getElementById('prod-output');
    if (!sel) {
      return;
    }
    sel.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Yarımfabrikat';
    sel.appendChild(blank);
    items.filter(function (row) {
      return row.kind === 'semi';
    }).forEach(function (row) {
      var opt = document.createElement('option');
      opt.value = String(row.id);
      opt.textContent = row.name + ' (' + row.unit + ')';
      if (Number(selectedId) === row.id) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  }

  function renderProd() {
    var docs = document.getElementById('prod-docs');
    var lines = document.getElementById('prod-lines');
    var title = document.getElementById('prod-title');
    if (!docs || !lines) {
      return;
    }
    fillProdOutput(currentProd() && currentProd().outputItemId);
    docs.innerHTML = '';
    if (!productions.length) {
      docs.innerHTML = '<tr><td colspan="3">Akt yoxdur.</td></tr>';
    } else {
      productions.forEach(function (row) {
        var tr = document.createElement('tr');
        tr.className = 'inv-doc-row' + (row.id === prodId ? ' active' : '');
        tr.innerHTML = '<td></td><td></td><td></td>';
        var cells = tr.querySelectorAll('td');
        cells[0].textContent = '#' + row.id;
        cells[1].textContent = row.status === 'done' ? 'Təsdiq' : 'Qaralama';
        cells[2].textContent = (row.outputName || '') + ' ' + row.outputQty;
        tr.addEventListener('click', function () {
          prodId = row.id;
          renderProd();
        });
        docs.appendChild(tr);
      });
    }
    var doc = currentProd();
    lines.innerHTML = '';
    var canEdit = can('stock.edit') && doc && doc.status === 'draft';
    document.getElementById('stock-prod-save').disabled = !canEdit;
    document.getElementById('stock-prod-confirm').disabled = !canEdit;
    document.getElementById('stock-prod-new').style.display = can('stock.edit') ? '' : 'none';
    document.getElementById('prod-output').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('prod-qty').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('prod-loss').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('prod-from').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('prod-to').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    if (!doc) {
      title.textContent = 'Akt seçin və ya yeni yazın.';
      document.getElementById('prod-qty').value = '1';
      document.getElementById('prod-loss').value = '0';
      return;
    }
    title.textContent = 'İstehsal #' + doc.id + (doc.status === 'done' ? ' (təsdiq)' : ' (qaralama)');
    document.getElementById('prod-qty').value = String(doc.outputQty);
    document.getElementById('prod-loss').value = String(doc.lossPct || 0);
    fillWhSelect(document.getElementById('prod-from'), doc.fromWarehouseId || activeWhId(), { activeOnly: true });
    fillWhSelect(document.getElementById('prod-to'), doc.toWarehouseId || activeWhId(), { activeOnly: true });
    (doc.lines || []).forEach(function (line) {
      var tr = document.createElement('tr');
      var nameTd = document.createElement('td');
      nameTd.textContent = line.name + ' (' + line.unit + ')';
      var qtyTd = document.createElement('td');
      qtyTd.className = 'num';
      qtyTd.textContent = String(line.needQty);
      tr.appendChild(nameTd);
      tr.appendChild(qtyTd);
      lines.appendChild(tr);
    });
  }

  function currentXfer() {
    return transfers.find(function (row) {
      return row.id === Number(xferId);
    }) || null;
  }

  function addXferLine(itemId, qty) {
    var box = document.getElementById('xfer-lines');
    if (!box) {
      return;
    }
    var row = document.createElement('div');
    row.className = 'buy-line';
    row.innerHTML =
      '<label>Xammal<select class="xfer-item"></select></label>' +
      '<label>Miqdar<input class="xfer-qty" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<button class="buy-del" type="button">Sil</button>';
    fillItemSelect(row.querySelector('.xfer-item'), itemId);
    if (qty != null) {
      row.querySelector('.xfer-qty').value = String(qty);
    }
    row.querySelector('.buy-del').addEventListener('click', function () {
      row.remove();
    });
    box.appendChild(row);
  }

  function collectXferLines() {
    var lines = [];
    document.querySelectorAll('#xfer-lines .buy-line').forEach(function (row) {
      var itemId = Number(row.querySelector('.xfer-item').value);
      var qty = dec(row.querySelector('.xfer-qty').value);
      if (!itemId || !qty || qty <= 0) {
        return;
      }
      lines.push({ itemId: itemId, qty: qty });
    });
    return lines;
  }

  function fillXferLines(doc) {
    var box = document.getElementById('xfer-lines');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    (doc && doc.lines || []).forEach(function (line) {
      addXferLine(line.itemId, line.qty);
    });
    if (!(doc && doc.lines && doc.lines.length) && can('stock.edit') && (!doc || doc.status !== 'done')) {
      addXferLine();
    }
  }

  function renderWh() {
    var box = document.getElementById('wh-body');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    if (!warehouses.length) {
      box.innerHTML = '<tr><td colspan="2">Sklad yoxdur.</td></tr>';
      return;
    }
    warehouses.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td>';
      tr.querySelectorAll('td')[0].textContent = row.name + (row.active === false ? ' (bağlı)' : '');
      var acts = document.createElement('div');
      acts.className = 'stock-acts';
      if (can('stock.edit')) {
        addAct(acts, row.active === false ? 'Aç' : 'Bağla', function () {
          api('/api/stock/warehouses/' + row.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: row.active === false })
          }).then(function () { return load(); }).catch(function (error) {
            say(error.message, 'err');
          });
        });
        addAct(acts, 'Sil', function () {
          api('/api/stock/warehouses/' + row.id, { method: 'DELETE' }).then(function () {
            say('Sklad silindi.');
            return load();
          }).catch(function (error) {
            say(error.message, 'err');
          });
        });
      }
      tr.querySelectorAll('td')[1].appendChild(acts);
      box.appendChild(tr);
    });
  }

  function renderXfer() {
    var docs = document.getElementById('xfer-docs');
    var title = document.getElementById('xfer-title');
    if (!docs || !title) {
      return;
    }
    docs.innerHTML = '';
    if (!transfers.length) {
      docs.innerHTML = '<tr><td colspan="3">Köçürmə yoxdur.</td></tr>';
    } else {
      transfers.forEach(function (row) {
        var tr = document.createElement('tr');
        tr.className = 'inv-doc-row' + (row.id === xferId ? ' active' : '');
        tr.innerHTML = '<td></td><td></td><td></td>';
        var cells = tr.querySelectorAll('td');
        cells[0].textContent = '#' + row.id;
        cells[1].textContent = row.status === 'done' ? 'Təsdiq' : 'Qaralama';
        cells[2].textContent = (row.fromName || '') + ' →';
        tr.addEventListener('click', function () {
          xferId = row.id;
          renderXfer();
        });
        docs.appendChild(tr);
      });
    }
    var doc = currentXfer();
    var canEdit = can('stock.edit') && doc && doc.status === 'draft';
    document.getElementById('stock-xfer-save').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('stock-xfer-confirm').disabled = !canEdit;
    document.getElementById('stock-xfer-new').style.display = can('stock.edit') ? '' : 'none';
    document.getElementById('xfer-from').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('xfer-to').disabled = !can('stock.edit') || (doc && doc.status === 'done');
    document.getElementById('xfer-add-line').style.display = can('stock.edit') && (!doc || doc.status !== 'done') ? '' : 'none';
    if (!doc) {
      title.textContent = 'Sənəd seçin və ya yeni yazın.';
      fillWhSelect(document.getElementById('xfer-from'), activeWhId(), { activeOnly: true });
      fillWhSelect(document.getElementById('xfer-to'), activeWhId(), { activeOnly: true });
      fillXferLines(null);
      return;
    }
    title.textContent = 'Köçürmə #' + doc.id + ' ' + (doc.fromName || '') + ' → ' + (doc.toName || '') +
      (doc.status === 'done' ? ' (təsdiq)' : ' (qaralama)');
    fillWhSelect(document.getElementById('xfer-from'), doc.fromId, { activeOnly: true });
    fillWhSelect(document.getElementById('xfer-to'), doc.toId, { activeOnly: true });
    fillXferLines(doc);
  }

  function load() {
    var url = '/api/stock';
    if (warehouseFilter) {
      url += '?warehouseId=' + encodeURIComponent(warehouseFilter);
    }
    return api(url).then(function (body) {
      items = (body.data && body.data.items) || [];
      purchases = (body.data && body.data.purchases) || [];
      moves = (body.data && body.data.moves) || [];
      suppliers = (body.data && body.data.suppliers) || [];
      inventories = (body.data && body.data.inventories) || [];
      productions = (body.data && body.data.productions) || [];
      transfers = (body.data && body.data.transfers) || [];
      warehouses = (body.data && body.data.warehouses) || [];
      fillWhFields();
      if (xferId && !transfers.some(function (row) { return row.id === xferId; })) {
        xferId = transfers.length ? transfers[0].id : 0;
      }
      if (prodId && !productions.some(function (row) { return row.id === prodId; })) {
        prodId = productions.length ? productions[0].id : 0;
      }
      if (invId && !inventories.some(function (row) { return row.id === invId; })) {
        invId = inventories.length ? inventories[0].id : 0;
      }
      if (waiter && body.data && body.data.permissions) {
        waiter.permissions = body.data.permissions;
        window.sessionStorage.setItem('posWaiter', JSON.stringify(waiter));
      }
      render();
      renderPurchases();
      renderMoves();
      renderInv();
      renderProd();
      renderXfer();
      renderWh();
      fillSuppliers();
      document.querySelectorAll('#buy-lines .buy-item').forEach(function (select) {
        fillItemSelect(select, select.value);
      });
      if (can('stock.edit') && !document.querySelector('#buy-lines .buy-line')) {
        addBuyLine();
      }
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  document.querySelectorAll('.stock-tabs [data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showTab(btn.getAttribute('data-tab'));
    });
  });
  document.getElementById('stock-search').addEventListener('input', function () {
    stockQuery = document.getElementById('stock-search').value;
    render();
  });
  document.getElementById('stock-wh-filter').addEventListener('change', function () {
    warehouseFilter = document.getElementById('stock-wh-filter').value;
    load();
  });
  document.getElementById('stock-low-only').addEventListener('change', function () {
    lowOnly = document.getElementById('stock-low-only').checked;
    render();
  });
  document.getElementById('stock-open-add').addEventListener('click', function () {
    if (!can('stock.edit')) {
      return;
    }
    document.getElementById('stock-add-modal').classList.remove('hidden');
    document.getElementById('stock-add-kind').value = 'raw';
    document.getElementById('stock-add-recipe').innerHTML = '';
    toggleRecipeBox('add');
    document.getElementById('stock-name').focus();
  });
  document.getElementById('cancel-stock-add').addEventListener('click', function () {
    document.getElementById('stock-add-modal').classList.add('hidden');
  });

  document.getElementById('stock-add-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('stock.edit')) {
      return;
    }
    api('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('stock-name').value,
        unit: document.getElementById('stock-unit').value,
        qty: 0,
        minQty: dec(document.getElementById('stock-min').value) || 0,
        buyPrice: dec(document.getElementById('stock-buy').value) || 0,
        kind: document.getElementById('stock-add-kind').value,
        recipe: collectRecipe('stock-add-recipe')
      })
    }).then(function (body) {
      document.getElementById('stock-name').value = '';
      document.getElementById('stock-min').value = '0';
      document.getElementById('stock-buy').value = '0';
      document.getElementById('stock-add-kind').value = 'raw';
      document.getElementById('stock-add-recipe').innerHTML = '';
      toggleRecipeBox('add');
      document.getElementById('stock-add-modal').classList.add('hidden');
      showTab('qty');
      var row = body.data || {};
      say('Yeni xammal: ' + row.name + '. Miqdar Alış tabında yazılır.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('buy-add-line').addEventListener('click', function () {
    addBuyLine();
  });

  document.getElementById('stock-buy-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('stock.edit')) {
      return;
    }
    var lines = collectBuyLines();
    if (!lines.length) {
      say('Alış sətri yazın.', 'warn');
      return;
    }
    api('/api/stock/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplier: document.getElementById('buy-supplier').value,
        docNo: document.getElementById('buy-doc').value,
        credit: document.getElementById('buy-credit').checked,
        warehouseId: Number(document.getElementById('buy-warehouse').value) || undefined,
        lines: lines
      })
    }).then(function (body) {
      document.getElementById('buy-supplier').value = '';
      document.getElementById('buy-doc').value = '';
      document.getElementById('buy-credit').checked = false;
      document.getElementById('buy-lines').innerHTML = '';
      addBuyLine();
      say('Alış yadda saxlandı: ' + Number(body.data.total).toFixed(2) + ' AZN');
      showTab('hist');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('cancel-stock-edit').addEventListener('click', function () {
    document.getElementById('stock-edit-modal').classList.add('hidden');
    editId = 0;
  });

  function syncEdit(from) {
    var buyBox = document.getElementById('stock-edit-buy');
    var totalBox = document.getElementById('stock-edit-total');
    var buy = dec(buyBox.value) || 0;
    var total = dec(totalBox.value) || 0;
    if (from === 'total' && editQty > 0) {
      buyBox.value = (total / editQty).toFixed(2);
      return;
    }
    totalBox.value = (editQty * buy).toFixed(2);
  }

  document.getElementById('stock-edit-buy').addEventListener('input', function () {
    syncEdit('buy');
  });
  document.getElementById('stock-edit-total').addEventListener('input', function () {
    syncEdit('total');
  });

  document.getElementById('stock-edit-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('stock.edit') || !editId) {
      return;
    }
    var row = items.find(function (item) { return item.id === editId; });
    var buy = dec(document.getElementById('stock-edit-buy').value) || 0;
    var total = dec(document.getElementById('stock-edit-total').value) || 0;
    if (editQty > 0 && total > 0 && buy <= 0) {
      buy = total / editQty;
    }
    api('/api/stock/' + editId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('stock-edit-name').value,
        unit: document.getElementById('stock-edit-unit').disabled
          ? (row ? row.unit : document.getElementById('stock-edit-unit').value)
          : document.getElementById('stock-edit-unit').value,
        minQty: dec(document.getElementById('stock-edit-min').value) || 0,
        buyPrice: buy,
        kind: document.getElementById('stock-edit-kind').value,
        recipe: collectRecipe('stock-edit-recipe')
      })
    }).then(function (body) {
      document.getElementById('stock-edit-modal').classList.add('hidden');
      editId = 0;
      var saved = body.data || {};
      say('"' + saved.name + '" dəyişildi.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('cancel-stock-move').addEventListener('click', function () {
    document.getElementById('stock-move-modal').classList.add('hidden');
  });

  document.getElementById('stock-move-type').addEventListener('change', function () {
    document.getElementById('stock-waste-wrap').style.display =
      this.value === 'out' ? '' : 'none';
  });
  document.getElementById('stock-waste-wrap').style.display = 'none';

  document.getElementById('stock-move-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('stock.edit') || !moveId) {
      return;
    }
    var type = document.getElementById('stock-move-type').value;
    var reason = document.getElementById('stock-waste-reason').value;
    var note = document.getElementById('stock-move-note').value.trim();
    if (type === 'out' && reason) {
      note = reason + (note ? ': ' + note : '');
    }
    api('/api/stock/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: moveId,
        type: type,
        qty: dec(document.getElementById('stock-move-qty').value),
        note: note,
        warehouseId: Number(document.getElementById('stock-move-warehouse').value) || undefined
      })
    }).then(function () {
      document.getElementById('stock-move-modal').classList.add('hidden');
      say('Hərəkət yadda saxlandı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('stock-inv-new').addEventListener('click', function () {
    if (!can('stock.edit')) {
      return;
    }
    api('/api/stock/inventories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouseId: Number(document.getElementById('inv-warehouse').value) || undefined
      })
    }).then(function (body) {
      invId = body.data && body.data.id;
      say('Sayım yaradıldı.');
      showTab('inv');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('stock-inv-save').addEventListener('click', function () {
    if (!can('stock.edit') || !invId) {
      return;
    }
    api('/api/stock/inventories/' + invId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counts: collectInvCounts() })
    }).then(function () {
      say('Sayım yadda saxlandı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('stock-inv-confirm').addEventListener('click', function () {
    if (!can('stock.edit') || !invId) {
      return;
    }
    window.askYes('Təsdiq', 'Sayım təsdiqlənsin? Fərq anbara yazılacaq.').then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/stock/inventories/' + invId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts: collectInvCounts() })
      }).then(function () {
        return api('/api/stock/inventories/' + invId + '/confirm', { method: 'POST' });
      }).then(function () {
        say('İnventar təsdiqləndi.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('cancel-stock-off').addEventListener('click', function () {
    document.getElementById('stock-off-modal').classList.add('hidden');
  });
  document.getElementById('stock-off-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!can('stock.edit') || !offId) {
      return;
    }
    api('/api/stock/write-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: offId,
        qty: dec(document.getElementById('stock-off-qty').value),
        reasonCode: document.getElementById('stock-off-reason').value,
        note: document.getElementById('stock-off-note').value.trim(),
        warehouseId: Number(document.getElementById('stock-off-warehouse').value) || undefined
      })
    }).then(function () {
      document.getElementById('stock-off-modal').classList.add('hidden');
      say('Silinmə yazıldı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('stock-add-kind').addEventListener('change', function () {
    toggleRecipeBox('add');
  });
  document.getElementById('stock-edit-kind').addEventListener('change', function () {
    toggleRecipeBox('edit');
  });
  document.getElementById('stock-add-recipe-add').addEventListener('click', function (event) {
    event.preventDefault();
    addRecipeLine('stock-add-recipe');
  });
  document.getElementById('stock-edit-recipe-add').addEventListener('click', function (event) {
    event.preventDefault();
    addRecipeLine('stock-edit-recipe');
  });
  document.getElementById('stock-prod-new').addEventListener('click', function () {
    if (!can('stock.edit')) {
      return;
    }
    var outputId = Number(document.getElementById('prod-output').value);
    if (!outputId) {
      say('Yarımfabrikat seçin.', 'warn');
      return;
    }
    api('/api/stock/productions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputItemId: outputId,
        outputQty: dec(document.getElementById('prod-qty').value),
        lossPct: dec(document.getElementById('prod-loss').value) || 0,
        fromWarehouseId: Number(document.getElementById('prod-from').value) || undefined,
        toWarehouseId: Number(document.getElementById('prod-to').value) || undefined
      })
    }).then(function (body) {
      prodId = body.data && body.data.id;
      say('Akt yaradıldı.');
      showTab('prod');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('stock-prod-save').addEventListener('click', function () {
    if (!can('stock.edit') || !prodId) {
      return;
    }
    api('/api/stock/productions/' + prodId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputQty: dec(document.getElementById('prod-qty').value),
        lossPct: dec(document.getElementById('prod-loss').value) || 0,
        fromWarehouseId: Number(document.getElementById('prod-from').value) || undefined,
        toWarehouseId: Number(document.getElementById('prod-to').value) || undefined
      })
    }).then(function () {
      say('Akt yadda saxlandı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('stock-prod-confirm').addEventListener('click', function () {
    if (!can('stock.edit') || !prodId) {
      return;
    }
    window.askYes('Təsdiq', 'İstehsal təsdiqlənsin? Xammal silinəcək.').then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/stock/productions/' + prodId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputQty: dec(document.getElementById('prod-qty').value),
          lossPct: dec(document.getElementById('prod-loss').value) || 0,
          fromWarehouseId: Number(document.getElementById('prod-from').value) || undefined,
          toWarehouseId: Number(document.getElementById('prod-to').value) || undefined
        })
      }).then(function () {
        return api('/api/stock/productions/' + prodId + '/confirm', { method: 'POST' });
      }).then(function () {
        say('İstehsal təsdiqləndi.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('xfer-add-line').addEventListener('click', function () {
    addXferLine();
  });
  document.getElementById('wh-add').addEventListener('click', function () {
    if (!can('stock.edit')) {
      return;
    }
    var name = document.getElementById('wh-name').value.trim();
    if (!name) {
      say('Sklad adını yazın.', 'warn');
      return;
    }
    api('/api/stock/warehouses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function () {
      document.getElementById('wh-name').value = '';
      say('Sklad əlavə olundu.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('stock-xfer-new').addEventListener('click', function () {
    if (!can('stock.edit')) {
      return;
    }
    var lines = collectXferLines();
    if (!lines.length) {
      say('Köçürmə sətri yazın.', 'warn');
      return;
    }
    api('/api/stock/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromId: Number(document.getElementById('xfer-from').value),
        toId: Number(document.getElementById('xfer-to').value),
        lines: lines
      })
    }).then(function (body) {
      xferId = body.data && body.data.id;
      say('Köçürmə yaradıldı.');
      showTab('xfer');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  function xferPayload() {
    return {
      fromId: Number(document.getElementById('xfer-from').value),
      toId: Number(document.getElementById('xfer-to').value),
      lines: collectXferLines()
    };
  }
  document.getElementById('stock-xfer-save').addEventListener('click', function () {
    if (!can('stock.edit')) {
      return;
    }
    var payload = xferPayload();
    if (!payload.lines.length) {
      say('Köçürmə sətri yazın.', 'warn');
      return;
    }
    if (!xferId) {
      document.getElementById('stock-xfer-new').click();
      return;
    }
    api('/api/stock/transfers/' + xferId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function () {
      say('Köçürmə yadda saxlandı.');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('stock-xfer-confirm').addEventListener('click', function () {
    if (!can('stock.edit') || !xferId) {
      return;
    }
    window.askYes('Təsdiq', 'Köçürmə təsdiqlənsin?').then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/stock/transfers/' + xferId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xferPayload())
      }).then(function () {
        return api('/api/stock/transfers/' + xferId + '/confirm', { method: 'POST' });
      }).then(function () {
        say('Köçürmə təsdiqləndi.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

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

  var saved = window.PosNav ? window.PosNav.session() : null;
  if (saved && window.PosNav.guard()) {
    setWaiter(saved);
  } else if (!saved) {
    showLock();
  }
})();
