(function () {
  var store = { groups: [], products: [], stations: [] };
  var stockItems = [];
  var selectedGroupId = 0;
  var editingId = 0;
  var imageData = '';
  var busy = false;
  var cardScale = 2;
  var searchQuery = '';
  var buyTouched = false;
  var editingGroupId = 0;
  var pickedIcon = '';

  // API-yə sorğu göndəririk
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

  // Ekranda qısa mesaj göstəririk
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

  // Kataloqu serverdən oxuyuruq
  function canCost() {
    return window.PosNav && window.PosNav.can('cost.edit') && window.PosNav.isStockMode();
  }

  function load() {
    var jobs = [api('/api/catalog')];
    if (canCost() || (window.PosNav && window.PosNav.isStockMode() &&
        (window.PosNav.can('stock.view') || window.PosNav.can('products.edit')))) {
      jobs.push(api('/api/stock'));
    }
    return Promise.all(jobs).then(function (parts) {
      store = parts[0].data;
      stockItems = parts[1] && parts[1].data ? (parts[1].data.items || []) : [];
      if (!selectedGroupId && store.groups[0]) {
        selectedGroupId = store.groups[0].id;
      }
      if (selectedGroupId && !store.groups.some(function (group) { return group.id === selectedGroupId; })) {
        selectedGroupId = store.groups[0] ? store.groups[0].id : 0;
      }
      render();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function canStockLink() {
    return !!(window.PosNav && window.PosNav.isStockMode() && stockItems.length);
  }

  function addRecipeRow(itemId, qty, unit, box) {
    box = box || document.getElementById('recipe-rows');
    var row = document.createElement('div');
    row.className = 'recipe-row';
    var select = document.createElement('select');
    select.className = 'recipe-item';
    select.innerHTML = '<option value="0">Xammal</option>' + stockItems.map(function (item) {
      return '<option value="' + item.id + '"' + (item.id === itemId ? ' selected' : '') + '>' +
        item.name + ' (' + item.unit + ')</option>';
    }).join('');
    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '0.001';
    qtyInput.step = '0.001';
    qtyInput.value = qty ? String(qty) : '';
    qtyInput.placeholder = 'Miqdar';
    var unitSelect = document.createElement('select');
    unitSelect.className = 'recipe-unit';
    var del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.addEventListener('click', function () {
      box.removeChild(row);
      if (box.id === 'recipe-rows') {
        onRecipeChange();
      }
    });
    function syncUnits(keep) {
      fillRecipeUnits(unitSelect, selectedStockUnit(select.value), keep || unit);
    }
    select.addEventListener('change', function () {
      syncUnits('');
      if (box.id === 'recipe-rows') {
        onRecipeChange();
      }
    });
    qtyInput.addEventListener('input', function () {
      if (box.id === 'recipe-rows') {
        onRecipeChange();
      }
    });
    unitSelect.addEventListener('change', function () {
      if (box.id === 'recipe-rows') {
        onRecipeChange();
      }
    });
    row.appendChild(select);
    row.appendChild(qtyInput);
    row.appendChild(unitSelect);
    row.appendChild(del);
    box.appendChild(row);
    syncUnits(unit);
  }

  function selectedStockUnit(itemId) {
    var item = stockItems.find(function (row) { return row.id === Number(itemId); });
    return item ? item.unit : '';
  }

  function kitchenUnit(stockUnit) {
    if (stockUnit === 'kq') {
      return 'qr';
    }
    if (stockUnit === 'l') {
      return 'ml';
    }
    return stockUnit || 'əd';
  }

  function recipeUnitOptions(stockUnit) {
    if (stockUnit === 'kq' || stockUnit === 'qr') {
      return ['qr', 'kq'];
    }
    if (stockUnit === 'l' || stockUnit === 'ml') {
      return ['ml', 'l'];
    }
    return ['əd'];
  }

  function fillRecipeUnits(select, stockUnit, chosen) {
    var opts = recipeUnitOptions(stockUnit);
    var pick = opts.indexOf(chosen) !== -1 ? chosen : kitchenUnit(stockUnit);
    select.innerHTML = '';
    opts.forEach(function (u) {
      var opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === pick) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function unitBase(u) {
    if (u === 'kq' || u === 'l') {
      return { kind: u === 'kq' ? 'mass' : 'vol', n: 1000 };
    }
    if (u === 'qr') {
      return { kind: 'mass', n: 1 };
    }
    if (u === 'ml') {
      return { kind: 'vol', n: 1 };
    }
    return { kind: 'each', n: 1 };
  }

  function toStockQty(qty, fromUnit, stockUnit) {
    if (!fromUnit) {
      return null;
    }
    var from = unitBase(fromUnit);
    var to = unitBase(stockUnit || 'əd');
    if (from.kind !== to.kind) {
      return null;
    }
    return qty * from.n / to.n;
  }

  function collectRecipe() {
    var rows = document.querySelectorAll('#recipe-rows .recipe-row');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var itemId = Number(rows[i].querySelector('.recipe-item').value);
      var qty = Number(rows[i].querySelector('input[type="number"]').value);
      var unit = rows[i].querySelector('.recipe-unit').value;
      if (!itemId || !(qty > 0)) {
        continue;
      }
      if (!unit) {
        var named = stockItems.find(function (row) { return row.id === itemId; });
        throw new Error((named ? named.name : 'Xammal') + ': resept vahidi seçin.');
      }
      out.push({ itemId: itemId, qty: qty, unit: unit });
    }
    return out;
  }

  function addModRow(boxId, name, price, ingredients) {
    var box = document.getElementById(boxId);
    var block = document.createElement('div');
    block.className = 'mod-block';
    var row = document.createElement('div');
    row.className = 'mod-row';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 40;
    nameInput.placeholder = boxId === 'portion-rows' ? 'məs. Böyük' : 'məs. Göbələk sousu';
    nameInput.value = name || '';
    var priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.step = '0.01';
    priceInput.placeholder = '+ AZN';
    priceInput.value = price != null ? String(price) : '0';
    var del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.addEventListener('click', function () {
      box.removeChild(block);
    });
    row.appendChild(nameInput);
    row.appendChild(priceInput);
    row.appendChild(del);
    block.appendChild(row);
    if (canStockLink()) {
      var stockBox = document.createElement('div');
      stockBox.className = 'mod-stock';
      block.appendChild(stockBox);
      var lines = ingredients && ingredients.length ? ingredients : [{ itemId: 0, qty: '', unit: '' }];
      lines.forEach(function (line) {
        addRecipeRow(line.itemId, line.qty, line.unit, stockBox);
      });
    }
    box.appendChild(block);
  }

  function collectMods(boxId) {
    var out = [];
    document.querySelectorAll('#' + boxId + ' .mod-block').forEach(function (block) {
      var name = block.querySelector('.mod-row input[type="text"]').value.trim();
      var price = Number(block.querySelector('.mod-row input[type="number"]').value);
      if (!name) {
        return;
      }
      var ingredients = [];
      block.querySelectorAll('.mod-stock .recipe-row').forEach(function (ingRow) {
        var itemId = Number(ingRow.querySelector('.recipe-item').value);
        var qty = Number(ingRow.querySelector('input[type="number"]').value);
        var unit = ingRow.querySelector('.recipe-unit').value;
        if (!itemId || !(qty > 0)) {
          return;
        }
        if (!unit) {
          throw new Error(name + ': resept vahidi seçin.');
        }
        ingredients.push({ itemId: itemId, qty: qty, unit: unit });
      });
      out.push({
        name: name,
        price: Number.isFinite(price) ? price : 0,
        ingredients: ingredients
      });
    });
    return out;
  }

  function fillMods(product) {
    document.getElementById('portion-rows').innerHTML = '';
    document.getElementById('extra-rows').innerHTML = '';
    (product && product.portions || []).forEach(function (row) {
      addModRow('portion-rows', row.name, row.price, row.ingredients);
    });
    (product && product.extras || []).forEach(function (row) {
      addModRow('extra-rows', row.name, row.price, row.ingredients);
    });
  }

  function onRecipeChange() {
    buyTouched = false;
    updateCostHint();
  }

  function updateCostHint() {
    var hint = document.getElementById('product-cost');
    var box = document.getElementById('product-buy');
    var recipe;
    try {
      recipe = collectRecipe();
    } catch (error) {
      hint.textContent = error.message;
      return;
    }
    if (!recipe.length) {
      hint.textContent = 'Resept yoxdursa alış əl ilə yazılır.';
      return;
    }
    var sum = 0;
    var parts = [];
    var bad = '';
    recipe.forEach(function (line) {
      var item = stockItems.find(function (row) { return row.id === line.itemId; });
      if (!item) {
        return;
      }
      var used = toStockQty(line.qty, line.unit, item.unit);
      if (used == null) {
        bad = item.name + ' vahidi uyğun gəlmir.';
        return;
      }
      var cost = Number(item.buyPrice || 0) * used;
      sum += cost;
      parts.push(item.name + ' ' + cost.toFixed(2));
    });
    if (bad) {
      hint.textContent = bad;
      return;
    }
    hint.textContent = 'İstehsal: ' + sum.toFixed(2) + ' AZN' + (parts.length ? ' (' + parts.join(', ') + ')' : '');
    if (!buyTouched && box && canCost()) {
      box.value = sum.toFixed(2);
    }
  }

  // Qrup siyahısını çəkirik
  function renderGroups() {
    var box = document.getElementById('group-list');
    box.innerHTML = '';
    store.groups.forEach(function (group) {
      var row = document.createElement('div');
      row.className = 'group-item' + (group.id === selectedGroupId ? ' active' : '');

      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'group-open';
      if (window.PosGroupIcons) {
        var thumb = document.createElement('span');
        thumb.className = 'group-thumb';
        window.PosGroupIcons.mount(thumb, group);
        openBtn.appendChild(thumb);
      }
      var nameSpan = document.createElement('span');
      nameSpan.textContent = group.name;
      openBtn.appendChild(nameSpan);
      openBtn.addEventListener('click', function () {
        selectedGroupId = group.id;
        render();
      });

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Dəyiş';
      editBtn.addEventListener('click', function () {
        openGroupModal(group);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Sil';
      var soldInGroup = store.products.some(function (item) {
        return item.groupId === group.id && item.sold;
      });
      if (soldInGroup) {
        delBtn.disabled = true;
        delBtn.title = 'Qrupda satışı olan məhsul var. Silmək olmaz.';
      } else {
        delBtn.addEventListener('click', function () {
          var count = store.products.filter(function (item) { return item.groupId === group.id; }).length;
          var extra = count ? 'Bu qrupdakı ' + count + ' məhsul da silinəcək.' : '';
          window.askDelete(group.name, extra).then(function (ok) {
            if (!ok) {
              return;
            }
            return api('/api/groups/' + group.id, { method: 'DELETE' })
              .then(function () {
                say('"' + group.name + '" silindi.', 'ok');
                return load();
              });
          }).catch(function (error) { say(error.message, 'err'); });
        });
      }

      row.appendChild(openBtn);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      box.appendChild(row);
    });
  }

  // Axtarış mətnini daxil üçün hazırlayırıq
  function normalize(value) {
    return String(value || '').toLocaleLowerCase('az').trim();
  }

  // Qrup adını tapırıq
  function groupName(id) {
    var group = store.groups.find(function (item) { return item.id === id; });
    return group ? group.name : '';
  }

  // Məhsulun axtarışa uyğun olub-olmadığını yoxlayırıq
  function matchesSearch(item, query) {
    if (!query) {
      return item.groupId === selectedGroupId;
    }
    return normalize(item.name).indexOf(query) !== -1
      || normalize(groupName(item.groupId)).indexOf(query) !== -1
      || normalize(stationName(item.stationId)).indexOf(query) !== -1
      || String(item.salePrice).indexOf(query) !== -1;
  }

  // Seçilmiş qrupun və ya axtarışın məhsullarını çəkirik
  function renderProducts() {
    var title = document.getElementById('group-title');
    var grid = document.getElementById('product-grid');
    var group = store.groups.find(function (item) { return item.id === selectedGroupId; });
    var query = normalize(searchQuery);
    title.textContent = query ? ('Axtarış: ' + searchQuery.trim()) : (group ? group.name : 'Qrup seçin');
    grid.innerHTML = '';

    var items = store.products.filter(function (item) {
      return matchesSearch(item, query);
    });
    if (!query && !group) {
      grid.innerHTML = '<div class="empty-card">Əvvəlcə qrup yaradın.</div>';
      return;
    }
    if (!items.length) {
      grid.innerHTML = query
        ? '<div class="empty-card">Axtarışa uyğun məhsul tapılmadı.</div>'
        : '<div class="empty-card">Bu qrupda hələ məhsul yoxdur.</div>';
      return;
    }

    items.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'product-card' + (item.blocked ? ' blocked' : '') + (item.soldOut ? ' soldout' : '');

      var photo = document.createElement('div');
      photo.className = 'product-photo';
      var g = store.groups.find(function (row) { return row.id === item.groupId; });
      if (item.image) {
        var img = document.createElement('img');
        img.src = item.image;
        img.alt = item.name;
        img.onerror = function () {
          if (window.PosGroupIcons) {
            window.PosGroupIcons.mount(photo, g || '');
          }
        };
        photo.appendChild(img);
      } else if (window.PosGroupIcons) {
        window.PosGroupIcons.mount(photo, g || '');
      }

      var body = document.createElement('div');
      body.className = 'product-body';
      body.innerHTML =
        '<h3></h3><p class="price"></p><p class="station"></p><p class="group-tag"></p><div class="card-actions"></div>';
      body.querySelector('h3').textContent = item.name;
      body.querySelector('.price').textContent = Number(item.salePrice).toFixed(2) + ' AZN';
      body.querySelector('.station').textContent = stationName(item.stationId) +
        (item.blocked ? ' • Bloklanıb' : '') +
        (item.soldOut ? ' • Bitib' : '') +
        (item.allergens ? ' • ' + item.allergens : '');
      body.querySelector('.group-tag').textContent = query ? groupName(item.groupId) : '';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Dəyiş';
      editBtn.addEventListener('click', function () {
        openModal(item);
      });

      var blockBtn = document.createElement('button');
      blockBtn.type = 'button';
      blockBtn.textContent = item.blocked ? 'Aç' : 'Blokla';
      blockBtn.addEventListener('click', function () {
        var next = !item.blocked;
        var text = next
          ? '"' + item.name + '" sifarişdən çıxarılsın?'
          : '"' + item.name + '" yenidən sifarişdə görünsün?';
        window.askYes(next ? 'Blokla' : 'Aç', text).then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/products/' + item.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocked: next })
          }).then(function () {
            say(next ? ('"' + item.name + '" bloklandı.') : ('"' + item.name + '" açıldı.'), 'ok');
            return load();
          });
        }).catch(function (error) { say(error.message, 'err'); });
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Sil';
      if (item.sold) {
        delBtn.disabled = true;
        delBtn.title = 'Satışda olub. Silmək olmaz.';
      } else {
        delBtn.addEventListener('click', function () {
          window.askDelete(item.name).then(function (ok) {
            if (!ok) {
              return;
            }
            return api('/api/products/' + item.id, { method: 'DELETE' })
              .then(function () {
                say('"' + item.name + '" silindi.', 'ok');
                return load();
              });
          }).catch(function (error) { say(error.message, 'err'); });
        });
      }

      var soldBtn = document.createElement('button');
      soldBtn.type = 'button';
      soldBtn.textContent = item.soldOut ? 'Var' : '86';
      soldBtn.addEventListener('click', function () {
        var next = !item.soldOut;
        window.askYes(next ? '86' : 'Var', next
          ? '"' + item.name + '" bitib işarələnsin?'
          : '"' + item.name + '" yenidən satılsın?').then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/products/' + item.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ soldOut: next })
          }).then(function () {
            say(next ? ('"' + item.name + '" 86.') : ('"' + item.name + '" var.'), 'ok');
            return load();
          });
        }).catch(function (error) { say(error.message, 'err'); });
      });

      body.querySelector('.card-actions').appendChild(editBtn);
      body.querySelector('.card-actions').appendChild(blockBtn);
      body.querySelector('.card-actions').appendChild(soldBtn);
      body.querySelector('.card-actions').appendChild(delBtn);
      card.appendChild(photo);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  // Stansiya adını tapırıq
  function stationName(id) {
    var station = (store.stations || []).find(function (item) { return item.id === id; });
    return station ? station.name : 'Təyinat yoxdur';
  }

  // Stansiya siyahısını çəkirik
  function renderStations() {
    var box = document.getElementById('station-list');
    box.innerHTML = '';
    (store.stations || []).forEach(function (station) {
      var row = document.createElement('div');
      row.className = 'group-item';

      var name = document.createElement('button');
      name.type = 'button';
      name.textContent = station.name;

      var renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.textContent = 'Ad';
      renameBtn.addEventListener('click', function () {
        var next = window.prompt('Stansiyanın yeni adı', station.name);
        if (!next || next.trim() === station.name) {
          return;
        }
        window.askChange(station.name).then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/stations/' + station.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: next })
          }).then(function () {
            say('Stansiya adı dəyişildi.', 'ok');
            return load();
          });
        }).catch(function (error) { say(error.message, 'err'); });
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Sil';
      delBtn.addEventListener('click', function () {
        window.askDelete(station.name).then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/stations/' + station.id, { method: 'DELETE' })
            .then(function () {
              say('"' + station.name + '" silindi.', 'ok');
              return load();
            });
        }).catch(function (error) { say(error.message, 'err'); });
      });

      row.appendChild(name);
      row.appendChild(renameBtn);
      row.appendChild(delBtn);
      box.appendChild(row);
    });
  }

  // Məhsul formasındakı stansiya siyahısını doldururuq
  function fillStationSelect(selectedId) {
    var select = document.getElementById('product-station');
    select.innerHTML = (store.stations || []).map(function (station) {
      var chosen = station.id === selectedId ? ' selected' : '';
      return '<option value="' + station.id + '"' + chosen + '>' + station.name + '</option>';
    }).join('');
  }

  // Səhifəni yeniləyirik
  function render() {
    renderGroups();
    renderStations();
    renderProducts();
  }

  // Məhsul pəncərəsini açırıq
  function openModal(product) {
    editingId = product ? product.id : 0;
    imageData = '';
    document.getElementById('modal-title').textContent = product ? 'Məhsulu dəyiş' : 'Yeni məhsul';
    document.getElementById('product-name').value = product ? product.name : '';
    document.getElementById('product-price').value = product ? product.salePrice : '';
    fillStationSelect(product ? product.stationId : (store.stations[0] && store.stations[0].id));
    var courseEl = document.getElementById('product-course');
    if (courseEl) {
      courseEl.value = product && product.course != null ? String(product.course) : '';
    }
    var allergEl = document.getElementById('product-allergens');
    if (allergEl) {
      allergEl.value = product && product.allergens ? product.allergens : '';
    }
    document.getElementById('product-happy').value =
      product && product.happyPrice != null ? String(product.happyPrice) : '';
    document.getElementById('product-happy-from').value =
      product && product.happyFrom != null ? String(product.happyFrom) : '';
    document.getElementById('product-happy-to').value =
      product && product.happyTo != null ? String(product.happyTo) : '';
    document.getElementById('product-combo').value =
      product && product.comboIds ? product.comboIds.join(',') : '';
    var hideCost = !canCost();
    document.getElementById('cost-buy-wrap').classList.toggle('hidden', hideCost);
    document.getElementById('cost-wrap').classList.toggle('hidden', hideCost);
    document.getElementById('recipe-rows').innerHTML = '';
    document.getElementById('product-buy').value = product && product.buyPrice != null ? String(product.buyPrice) : '';
    buyTouched = false;
    if (canCost() && product && product.ingredients) {
        product.ingredients.forEach(function (line) {
          addRecipeRow(line.itemId, line.qty, line.unit);
        });
    }
    if (product && product.ingredients && product.ingredients.length && Number(product.buyPrice) > 0) {
      buyTouched = true;
    }
    updateCostHint();
    fillMods(product);
    document.getElementById('product-image').value = '';
    var preview = document.getElementById('image-preview');
    if (product && product.image) {
      preview.innerHTML = '';
      var img = document.createElement('img');
      img.src = product.image;
      img.alt = product.name;
      preview.appendChild(img);
    } else {
      preview.textContent = 'Şəkil seçilməyib';
    }
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('product-name').focus();
  }

  // Pəncərəni bağlayırıq
  function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    editingId = 0;
    imageData = '';
  }

  function fillIconGrid(selected) {
    var box = document.getElementById('group-icon-grid');
    box.innerHTML = '';
    if (!window.PosGroupIcons) {
      return;
    }
    window.PosGroupIcons.list().forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-pick' + (item.id === selected ? ' active' : '');
      btn.innerHTML = item.svg;
      var cap = document.createElement('span');
      cap.textContent = item.label;
      btn.appendChild(cap);
      btn.addEventListener('click', function () {
        pickedIcon = item.id;
        fillIconGrid(pickedIcon);
      });
      box.appendChild(btn);
    });
  }

  function openGroupModal(group) {
    editingGroupId = group.id;
    pickedIcon = window.PosGroupIcons ? window.PosGroupIcons.resolve(group) : 'meal';
    document.getElementById('group-edit-name').value = group.name;
    fillIconGrid(pickedIcon);
    document.getElementById('group-modal').classList.remove('hidden');
    document.getElementById('group-edit-name').focus();
  }

  function closeGroupModal() {
    document.getElementById('group-modal').classList.add('hidden');
    editingGroupId = 0;
    pickedIcon = '';
  }

  document.getElementById('toggle-group-form').addEventListener('click', function () {
    var row = document.getElementById('group-add-row');
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) {
      document.getElementById('group-name').focus();
    }
  });

  document.getElementById('toggle-station-form').addEventListener('click', function () {
    var row = document.getElementById('station-add-row');
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) {
      document.getElementById('station-name').focus();
    }
  });

  document.getElementById('add-group').addEventListener('click', function () {
    var name = document.getElementById('group-name').value.trim();
    if (!name) {
      say('Qrup adını yazın.', 'warn');
      return;
    }
    api('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function (body) {
      document.getElementById('group-name').value = '';
      document.getElementById('group-add-row').classList.add('hidden');
      selectedGroupId = body.data.id;
      say('Qrup əlavə olundu: ' + name, 'ok');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('add-station').addEventListener('click', function () {
    var name = document.getElementById('station-name').value.trim();
    if (!name) {
      say('Stansiya adını yazın.', 'warn');
      return;
    }
    api('/api/stations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function () {
      document.getElementById('station-name').value = '';
      document.getElementById('station-add-row').classList.add('hidden');
      say('Stansiya əlavə olundu: ' + name, 'ok');
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('add-product').addEventListener('click', function () {
    if (!selectedGroupId) {
      say('Əvvəlcə qrup seçin.', 'warn');
      return;
    }
    openModal(null);
  });

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('cancel-group-modal').addEventListener('click', closeGroupModal);
  document.getElementById('group-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var name = document.getElementById('group-edit-name').value.trim();
    if (!name) {
      say('Qrup adını yazın.', 'warn');
      return;
    }
    if (!pickedIcon) {
      say('İkon seçin.', 'warn');
      return;
    }
    var current = store.groups.find(function (item) { return item.id === editingGroupId; });
    window.askChange(current ? current.name : name).then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/groups/' + editingGroupId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, icon: pickedIcon })
      }).then(function () {
        closeGroupModal();
        say('Qrup yadda saxlandı.', 'ok');
        return load();
      });
    }).catch(function (error) { say(error.message, 'err'); });
  });
  document.getElementById('recipe-add').addEventListener('click', function () {
    addRecipeRow(0, '');
  });
  document.getElementById('portion-add').addEventListener('click', function () {
    addModRow('portion-rows', '', 0);
  });
  document.getElementById('extra-add').addEventListener('click', function () {
    addModRow('extra-rows', '', 0);
  });
  document.getElementById('product-buy').addEventListener('input', function () {
    buyTouched = true;
  });

  document.getElementById('product-image').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      say('Şəkil 2 MB-dan böyük ola bilməz.', 'warn');
      event.target.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      imageData = String(reader.result || '');
      var preview = document.getElementById('image-preview');
      preview.innerHTML = '';
      var img = document.createElement('img');
      img.src = imageData;
      img.alt = 'Önizləmə';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('product-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    var mods;
    try {
      mods = {
        portions: collectMods('portion-rows'),
        extras: collectMods('extra-rows')
      };
    } catch (error) {
      say(error.message, 'err');
      return;
    }
    var payload = {
      groupId: selectedGroupId,
      name: document.getElementById('product-name').value,
      salePrice: document.getElementById('product-price').value,
      stationId: Number(document.getElementById('product-station').value),
      course: document.getElementById('product-course').value === ''
        ? ''
        : Number(document.getElementById('product-course').value),
      allergens: document.getElementById('product-allergens').value,
      happyPrice: document.getElementById('product-happy').value,
      happyFrom: document.getElementById('product-happy-from').value,
      happyTo: document.getElementById('product-happy-to').value,
      comboIds: document.getElementById('product-combo').value,
      portions: mods.portions,
      extras: mods.extras
    };
    if (canCost()) {
      payload.buyPrice = Number(document.getElementById('product-buy').value);
      try {
        payload.ingredients = collectRecipe();
      } catch (error) {
        say(error.message, 'err');
        return;
      }
    }
    if (imageData) {
      payload.imageData = imageData;
    }
    function sendProduct() {
      var url = editingId ? '/api/products/' + editingId : '/api/products';
      var savingName = payload.name;
      var wasEdit = !!editingId;
      busy = true;
      api(url, {
        method: wasEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function () {
        closeModal();
        say(wasEdit ? ('"' + savingName + '" dəyişildi.') : ('Yeni məhsul: ' + savingName), 'ok');
        return load();
      }).catch(function (error) {
        say(error.message, 'err');
      }).then(function () {
        busy = false;
      });
    }
    if (editingId) {
      var current = store.products.find(function (item) { return item.id === editingId; });
      window.askChange(current ? current.name : payload.name).then(function (ok) {
        if (ok) {
          sendProduct();
        }
      });
      return;
    }
    sendProduct();
  });

  // Kart ölçüsünü oxuyuruq və tətbiq edirik
  function applyScale(value) {
    var next = Number(value);
    if (!Number.isFinite(next)) {
      next = 2;
    }
    cardScale = Math.min(5, Math.max(1, Math.round(next)));
    document.getElementById('card-scale').value = String(cardScale);
    document.getElementById('product-grid').setAttribute('data-scale', String(cardScale));
    window.localStorage.setItem('productCardScale', String(cardScale));
  }

  try {
    applyScale(window.localStorage.getItem('productCardScale') || 2);
  } catch (error) {
    applyScale(2);
  }

  document.getElementById('product-search').addEventListener('input', function (event) {
    searchQuery = event.target.value;
    renderProducts();
  });
  document.getElementById('clear-search').addEventListener('click', function () {
    searchQuery = '';
    document.getElementById('product-search').value = '';
    renderProducts();
  });

  document.getElementById('card-scale').addEventListener('input', function (event) {
    applyScale(event.target.value);
  });
  document.getElementById('scale-down').addEventListener('click', function () {
    applyScale(cardScale - 1);
  });
  document.getElementById('scale-up').addEventListener('click', function () {
    applyScale(cardScale + 1);
  });

  document.getElementById('logout').addEventListener('click', function () {
    if (window.PosNav) {
      window.PosNav.forget();
    }
    window.sessionStorage.removeItem('posWaiter');
    window.location.replace('/orders.html');
  });

  load();
})();
