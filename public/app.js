(function () {
  const floorList = document.getElementById('floor-list');
  const blueprint = document.getElementById('blueprint');
  const tableRoom = document.getElementById('table-room');
  let layout = { floors: [], rooms: [], tables: [] };
  let floorId = null;
  let roomId = null;
  let pickedTableId = 0;
  let guestOrigin = '';
  let guestHttpUp = false;
  let guestLanOn = false;
  let settingsBrand = '';
  const GRID = 32;

  function snap(value, min, max) {
    var n = Math.round(Number(value) / GRID) * GRID;
    if (!Number.isFinite(n)) {
      n = min || 0;
    }
    if (min != null) {
      n = Math.max(min, n);
    }
    if (max != null) {
      n = Math.min(max, n);
    }
    return n;
  }

  function stylePx(el, name, fallback) {
    var n = parseInt(String((el && el.style && el.style[name]) || ''), 10);
    if (!Number.isFinite(n) || n <= 0) {
      n = Number(fallback) || 0;
    }
    return n;
  }

  function toastBox(payload) {
    say('Saxlandı — ' + payload.w + '×' + payload.h + ' (' + payload.x + ',' + payload.y + ')', 'ok');
  }

  function canLayout(key) {
    return window.PosNav && window.PosNav.can(key);
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

  // Mətni ekranda təhlükəsiz göstəririk
  function esc(value) {
    return window.PosDom.escapeHtml(value);
  }

  // API sorğusu göndəririk
  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Xəta baş verdi');
    }
    return data.data;
  }

  // Çertyojı yükləyirik
  async function load() {
    try {
      layout = await api('/api/layout');
      if (!floorId && layout.floors[0]) {
        floorId = layout.floors[0].id;
      }
      if (layout.floors.every(function (floor) { return floor.id !== floorId; })) {
        floorId = layout.floors[0] ? layout.floors[0].id : null;
      }
      render();
      syncQrPanel();
    } catch (error) {
      say(error.message, 'err');
    }
  }

  // Cari mərtəbənin otaqlarını tapırıq
  function roomsOnFloor() {
    return layout.rooms.filter(function (room) {
      return room.floorId === floorId;
    });
  }

  // Növbəti boş masa nömrəsini tapırıq
  function nextTableNumber() {
    const used = layout.tables.map(function (table) { return table.number; });
    let n = 1;
    while (used.indexOf(n) !== -1) {
      n += 1;
    }
    return n;
  }

  // Otaqdakı masaları tapırıq
  function tablesInRoom(id) {
    return layout.tables.filter(function (table) {
      return table.roomId === id;
    });
  }

  // Masanın enini və hündürlüyünü oxuyuruq
  function tableW(table) {
    return Number(table.w) || 80;
  }

  function tableH(table) {
    return Number(table.h) || 80;
  }

  function roomMinSize(tables) {
    let w = GRID * 5;
    let h = GRID * 5;
    tables.forEach(function (table) {
      w = Math.max(w, Number(table.x || 0) + tableW(table) + GRID);
      h = Math.max(h, GRID + Number(table.y || 0) + tableH(table) + GRID);
    });
    return { w: snap(w, GRID * 5), h: snap(h, GRID * 4) };
  }

  function roomBox(room, tables) {
    const min = roomMinSize(tables);
    return {
      x: snap(room.x || 0, 0),
      y: snap(room.y || 0, 0),
      w: snap(Math.max(min.w, Number(room.w) || min.w), min.w),
      h: snap(Math.max(min.h, Number(room.h) || min.h), min.h)
    };
  }

  function nextRoomSlot() {
    const rooms = roomsOnFloor();
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const x = col * (GRID * 13);
        const y = row * (GRID * 9);
        const hit = rooms.some(function (room) {
          return snap(room.x || 0) === x && snap(room.y || 0) === y;
        });
        if (!hit) {
          return { x: x, y: y };
        }
      }
    }
    return { x: 0, y: 0 };
  }

  // Otaqda boş yer tapırıq ki, masalar üst-üstə düşməsin
  function nextSlot(tables) {
    const size = GRID * 2;
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 10; col += 1) {
        const x = col * size;
        const y = row * size;
        const busy = tables.some(function (table) {
          return Math.abs(Number(table.x || 0) - x) < size && Math.abs(Number(table.y || 0) - y) < size;
        });
        if (!busy) {
          return { x: x, y: y };
        }
      }
    }
    return { x: 0, y: 0 };
  }

  function spreadRooms(rooms) {
    const seen = {};
    rooms.forEach(function (room, index) {
      let x = snap(room.x || 0, 0);
      let y = snap(room.y || 0, 0);
      let key = x + ',' + y;
      if (seen[key]) {
        x = (index % 4) * GRID * 13;
        y = Math.floor(index / 4) * GRID * 9;
        key = x + ',' + y;
        room.x = x;
        room.y = y;
        api('/api/rooms/' + room.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: x, y: y })
        }).catch(function () {});
      }
      seen[key] = true;
    });
  }

  // Ekranı çəkirik
  function render() {
    floorList.innerHTML = layout.floors.map(function (floor) {
      const active = floor.id === floorId ? ' active' : '';
      return (
        '<div class="floor-btn' + active + '" data-floor="' + floor.id + '">' +
          '<span>' + esc(floor.name) + '</span>' +
          '<button class="tiny" type="button" data-del-floor="' + floor.id + '">Sil</button>' +
        '</div>'
      );
    }).join('') || '<p class="hint">Əvvəlcə mərtəbə əlavə edin.</p>';

    const rooms = roomsOnFloor();
    if (!roomId || rooms.every(function (room) { return room.id !== roomId; })) {
      roomId = rooms[0] ? rooms[0].id : null;
    }
    tableRoom.innerHTML = rooms.map(function (room) {
      const selected = room.id === roomId ? ' selected' : '';
      return '<option value="' + room.id + '"' + selected + '>' + esc(room.name) + '</option>';
    }).join('');
    if (roomId) {
      tableRoom.value = String(roomId);
    }

    spreadRooms(rooms);
    let mapW = 1280;
    let mapH = 768;
    blueprint.innerHTML = rooms.map(function (room) {
      const list = tablesInRoom(room.id);
      const box = roomBox(room, list);
      mapW = Math.max(mapW, box.x + box.w + GRID * 2);
      mapH = Math.max(mapH, box.y + box.h + GRID * 2);
      const tables = list.map(function (table) {
        const title = table.name || ('Masa ' + table.number);
        const w = snap(tableW(table), GRID * 2, GRID * 12);
        const h = snap(tableH(table), GRID * 2, GRID * 12);
        const left = snap(table.x || 0, 0);
        const top = snap(table.y || 0, 0);
        return (
          '<div class="table ' + table.shape + (table.id === pickedTableId ? ' picked' : '') + '" data-table="' + table.id + '" style="left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px">' +
            '<button class="del" type="button" data-del-table="' + table.id + '">×</button>' +
            '<button class="btn-rename" type="button" data-rename="' + table.id + '">Ad</button>' +
            '<span class="tname">' + esc(title) + '</span>' +
            '<small>' + table.capacity + ' nəfər</small>' +
            '<i class="rz e" data-rz="e"></i>' +
            '<i class="rz s" data-rz="s"></i>' +
            '<i class="rz se" data-rz="se"></i>' +
          '</div>'
        );
      }).join('');

      return (
        '<article class="room' + (list.length ? '' : ' empty') + '" data-room="' + room.id + '" style="left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.w + 'px;height:' + box.h + 'px">' +
          '<div class="room-title">' +
            '<span class="rname">' + esc(room.name) + '</span>' +
            '<button class="tiny" type="button" data-rename-room="' + room.id + '">Ad</button>' +
            '<button class="tiny" type="button" data-del-room="' + room.id + '">Sil</button>' +
          '</div>' +
          '<div class="floor">' + (tables || '<p class="hint">Boş</p>') + '</div>' +
          '<i class="rz e" data-room-rz="e"></i>' +
          '<i class="rz s" data-room-rz="s"></i>' +
          '<i class="rz se" data-room-rz="se"></i>' +
        '</article>'
      );
    }).join('') || '<p class="hint">Bu mərtəbədə otaq yoxdur. Soldan otaq əlavə edin.</p>';
    if (rooms.length) {
      blueprint.style.width = snap(mapW, 1280) + 'px';
      blueprint.style.height = snap(mapH, 768) + 'px';
    }

    bindDrags();
    fillQrTablePick();
    syncQrPanel();
  }

  function renameRoom(id) {
    const room = layout.rooms.find(function (item) { return item.id === id; });
    const card = blueprint.querySelector('[data-room="' + id + '"]');
    if (!room || !card) {
      return;
    }
    const label = card.querySelector('.rname');
    if (!label || card.querySelector('.name-input')) {
      return;
    }
    const input = document.createElement('input');
    input.className = 'name-input';
    input.type = 'text';
    input.maxLength = 40;
    input.value = room.name || '';
    label.replaceWith(input);
    input.focus();
    input.select();

    function finish(ok) {
      const name = input.value.trim();
      const oldName = room.name || '';
      if (!ok || !name) {
        render();
        return;
      }
      function save() {
        room.name = name;
        api('/api/rooms/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        }).then(function () {
          say('Otaq adı dəyişildi.', 'ok');
          render();
        }).catch(function (error) {
          say(error.message, 'err');
          render();
        });
      }
      if (name !== oldName) {
        window.askChange(oldName).then(function (yes) {
          if (!yes) {
            render();
            return;
          }
          save();
        });
        return;
      }
      save();
    }

    input.addEventListener('mousedown', function (event) {
      event.stopPropagation();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        finish(true);
      }
      if (event.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', function () {
      finish(true);
    });
  }

  // Masanın adını dəyişirik
  function renameTable(id) {
    const table = layout.tables.find(function (item) { return item.id === id; });
    const card = blueprint.querySelector('[data-table="' + id + '"]');
    if (!table || !card) {
      return;
    }
    const label = card.querySelector('.tname');
    if (!label || card.querySelector('.name-input')) {
      return;
    }
    const input = document.createElement('input');
    input.className = 'name-input';
    input.type = 'text';
    input.maxLength = 40;
    input.value = table.name || ('Masa ' + table.number);
    label.replaceWith(input);
    input.focus();
    input.select();

    function finish(ok) {
      const name = input.value.trim();
      const oldName = table.name || ('Masa ' + table.number);
      if (!ok || !name) {
        render();
        return;
      }
      if (name !== oldName) {
        window.askChange(oldName).then(function (yes) {
          if (!yes) {
            render();
            return;
          }
          table.name = name;
          api('/api/tables/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          }).then(function () {
            say('Masa adı dəyişildi.', 'ok');
            render();
          }).catch(function (error) {
            say(error.message, 'err');
            render();
          });
        });
        return;
      }
      table.name = name;
      api('/api/tables/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      }).then(function () {
        say('Masa adı dəyişildi.', 'ok');
        render();
      }).catch(function (error) {
        say(error.message, 'err');
        render();
      });
    }

    input.addEventListener('mousedown', function (event) {
      event.stopPropagation();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        finish(true);
      }
      if (event.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', function () {
      finish(true);
    });
  }

  function saveRoomBox(el) {
    const id = Number(el.dataset.room);
    const list = tablesInRoom(id);
    const min = roomMinSize(list);
    const payload = {
      x: snap(el.offsetLeft, 0),
      y: snap(el.offsetTop, 0),
      w: snap(el.offsetWidth, min.w),
      h: snap(el.offsetHeight, min.h)
    };
    el.style.left = payload.x + 'px';
    el.style.top = payload.y + 'px';
    el.style.width = payload.w + 'px';
    el.style.height = payload.h + 'px';
    const room = layout.rooms.find(function (item) { return item.id === id; });
    if (room) {
      room.x = payload.x;
      room.y = payload.y;
      room.w = payload.w;
      room.h = payload.h;
    }
    api('/api/rooms/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  // Masanın yerini və ölçüsünü saxlayırıq
  function saveTableBox(el) {
    const id = Number(el.dataset.table);
    const payload = {
      x: snap(stylePx(el, 'left', el.offsetLeft), 0),
      y: snap(stylePx(el, 'top', el.offsetTop), 0),
      w: snap(stylePx(el, 'width', el.offsetWidth), GRID * 2, GRID * 12),
      h: snap(stylePx(el, 'height', el.offsetHeight), GRID * 2, GRID * 12)
    };
    el.style.left = payload.x + 'px';
    el.style.top = payload.y + 'px';
    el.style.width = payload.w + 'px';
    el.style.height = payload.h + 'px';
    const table = layout.tables.find(function (item) { return item.id === id; });
    if (table) {
      table.x = payload.x;
      table.y = payload.y;
      table.w = payload.w;
      table.h = payload.h;
    }
    api('/api/tables/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: payload.x, y: payload.y, w: payload.w, h: payload.h })
    }).then(function () {
      toastBox(payload);
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  // Masaları sürükləyirik və ölçüsünü dəyişirik
  function bindDrags() {
    blueprint.querySelectorAll('.room').forEach(function (el) {
      const title = el.querySelector('.room-title');
      function startRoom(event, mode) {
        if (event.target.closest('button') || event.target.closest('input')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const left = el.offsetLeft;
        const top = el.offsetTop;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        const min = roomMinSize(tablesInRoom(Number(el.dataset.room)));

        function move(ev) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (mode === 'move') {
            el.style.left = snap(Math.max(0, left + dx), 0) + 'px';
            el.style.top = snap(Math.max(0, top + dy), 0) + 'px';
            return;
          }
          let w = startW;
          let h = startH;
          if (mode === 'e' || mode === 'se') {
            w = snap(startW + dx, min.w, GRID * 40);
          }
          if (mode === 's' || mode === 'se') {
            h = snap(startH + dy, min.h, GRID * 30);
          }
          el.style.width = w + 'px';
          el.style.height = h + 'px';
        }

        function stop() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', stop);
          saveRoomBox(el);
        }

        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
      }
      if (title) {
        title.addEventListener('mousedown', function (event) {
          startRoom(event, 'move');
        });
      }
      el.querySelectorAll('[data-room-rz]').forEach(function (handle) {
        handle.addEventListener('mousedown', function (event) {
          startRoom(event, handle.dataset.roomRz);
        });
      });
    });
    blueprint.querySelectorAll('.table').forEach(function (el) {
      function startTable(event, mode) {
        if (event.target.closest('button')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        pickTable(Number(el.dataset.table));
        const floor = el.parentElement;
        const startX = event.clientX;
        const startY = event.clientY;
        const left = stylePx(el, 'left', el.offsetLeft);
        const top = stylePx(el, 'top', el.offsetTop);
        const startW = stylePx(el, 'width', el.offsetWidth);
        const startH = stylePx(el, 'height', el.offsetHeight);

        function move(ev) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (mode === 'move') {
            const maxX = Math.max(0, floor.clientWidth - el.offsetWidth);
            const maxY = Math.max(0, floor.clientHeight - el.offsetHeight);
            el.style.left = snap(Math.min(maxX, Math.max(0, left + dx)), 0) + 'px';
            el.style.top = snap(Math.min(maxY, Math.max(0, top + dy)), 0) + 'px';
            return;
          }
          let w = startW;
          let h = startH;
          if (mode === 'e' || mode === 'se') {
            w = snap(startW + dx, GRID * 2, GRID * 12);
          }
          if (mode === 's' || mode === 'se') {
            h = snap(startH + dy, GRID * 2, GRID * 12);
          }
          el.style.width = w + 'px';
          el.style.height = h + 'px';
        }

        function stop() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', stop);
          saveTableBox(el);
        }

        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
      }

      el.querySelectorAll('[data-rz]').forEach(function (handle) {
        handle.addEventListener('mousedown', function (event) {
          startTable(event, handle.dataset.rz);
        });
      });
      el.addEventListener('mousedown', function (event) {
        if (event.target.closest('[data-rz]')) {
          return;
        }
        startTable(event, 'move');
      });
    });
    var selApply = document.getElementById('sel-apply');
    if (selApply && selApply.getAttribute('data-bound') !== '1') {
      selApply.setAttribute('data-bound', '1');
      selApply.addEventListener('click', function () {
        var picked = blueprint.querySelector('.table');
        if (!picked) {
          return;
        }
        saveTableBox(picked);
      });
    }
  }

  document.getElementById('add-floor').addEventListener('click', async function () {
    try {
      const name = document.getElementById('floor-name').value;
      const floor = await api('/api/floors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      });
      document.getElementById('floor-name').value = '';
      floorId = floor.id;
      say('Mərtəbə əlavə olundu: ' + (floor.name || name), 'ok');
      await load();
    } catch (error) {
      say(error.message, 'err');
    }
  });

  document.getElementById('add-room').addEventListener('click', async function () {
    try {
      if (!floorId) {
        throw new Error('Əvvəlcə mərtəbə seçin.');
      }
      const slot = nextRoomSlot();
      const created = await api('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floorId: floorId,
          name: document.getElementById('room-name').value,
          x: slot.x,
          y: slot.y,
          w: GRID * 12,
          h: GRID * 8
        })
      });
      document.getElementById('room-name').value = '';
      roomId = created.id;
      say('Otaq əlavə olundu: ' + (created.name || ''), 'ok');
      await load();
    } catch (error) {
      say(error.message, 'err');
    }
  });

  tableRoom.addEventListener('change', function () {
    roomId = Number(tableRoom.value) || null;
  });

  document.getElementById('add-table').addEventListener('click', async function () {
    try {
      roomId = Number(tableRoom.value) || roomId;
      const name = document.getElementById('table-name').value.trim();
      if (!name) {
        throw new Error('Masa adını yazın.');
      }
      const slot = nextSlot(tablesInRoom(roomId));
      await api('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: roomId,
          number: nextTableNumber(),
          name: name,
          shape: document.getElementById('table-shape').value,
          capacity: Number(document.getElementById('table-capacity').value),
          x: slot.x,
          y: slot.y,
          w: GRID * 2,
          h: GRID * 2
        })
      });
      document.getElementById('table-name').value = '';
      say('Masa əlavə olundu: ' + name, 'ok');
      await load();
    } catch (error) {
      say(error.message, 'err');
    }
  });

  floorList.addEventListener('click', async function (event) {
    try {
      const delId = Number(event.target.dataset.delFloor);
      const selectId = Number(event.target.closest('[data-floor]') && event.target.closest('[data-floor]').dataset.floor);
      if (delId) {
        const floor = layout.floors.find(function (item) { return item.id === delId; });
        const rooms = layout.rooms.filter(function (room) { return room.floorId === delId; });
        const roomIds = rooms.map(function (room) { return room.id; });
        const tables = layout.tables.filter(function (table) { return roomIds.indexOf(table.roomId) !== -1; });
        const extra = rooms.length || tables.length
          ? 'Bu mərtəbədə ' + rooms.length + ' otaq və ' + tables.length + ' masa da silinəcək.'
          : '';
        if (!(await window.askDelete(floor ? floor.name : 'Mərtəbə', extra))) {
          return;
        }
        await api('/api/floors/' + delId, { method: 'DELETE' });
        say((floor ? floor.name : 'Mərtəbə') + ' silindi.', 'ok');
        await load();
        return;
      }
      if (selectId) {
        floorId = selectId;
        render();
      }
    } catch (error) {
      say(error.message, 'err');
    }
  });

  blueprint.addEventListener('click', async function (event) {
    try {
      const renameId = Number(event.target.dataset.rename);
      const renameRoomId = Number(event.target.dataset.renameRoom);
      const delRoom = Number(event.target.dataset.delRoom);
      const delTable = Number(event.target.dataset.delTable);
      if (renameRoomId) {
        renameRoom(renameRoomId);
        return;
      }
      if (renameId) {
        renameTable(renameId);
        return;
      }
      if (delRoom) {
        const room = layout.rooms.find(function (item) { return item.id === delRoom; });
        const count = tablesInRoom(delRoom).length;
        const extra = count ? 'Bu otaqdakı ' + count + ' masa da silinəcək.' : '';
        if (!(await window.askDelete(room ? room.name : 'Otaq', extra))) {
          return;
        }
        const payload = {};
        if (count && !canLayout('layout.delete')) {
          const pin = await window.askPin(
            'Xüsusi icazə',
            'Otaqda masa var. «Çertyoj → Sil» icazəsi olan PIN yazın.'
          );
          if (!pin) {
            return;
          }
          payload.confirmPin = pin;
        }
        await api('/api/rooms/' + delRoom, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        say((room ? room.name : 'Otaq') + ' silindi.', 'ok');
        await load();
      }
      if (delTable) {
        const table = layout.tables.find(function (item) { return item.id === delTable; });
        const title = table ? (table.name || ('Masa ' + table.number)) : 'Masa';
        if (!(await window.askDelete(title))) {
          return;
        }
        await api('/api/tables/' + delTable, { method: 'DELETE' });
        say(title + ' silindi.', 'ok');
        await load();
      }
    } catch (error) {
      say(error.message, 'err');
    }
  });

  document.getElementById('logout').addEventListener('click', function () {
    if (window.PosNav) {
      window.PosNav.forget();
    }
    window.sessionStorage.removeItem('posWaiter');
    window.location.replace('/orders.html');
  });

  function pickTable(id) {
    pickedTableId = Number(id) || 0;
    if (blueprint) {
      blueprint.querySelectorAll('.table').forEach(function (node) {
        node.classList.toggle('picked', Number(node.dataset.table) === pickedTableId);
      });
    }
    var sel = document.getElementById('qr-table-pick');
    if (sel && sel.value !== (pickedTableId ? String(pickedTableId) : '')) {
      sel.value = pickedTableId ? String(pickedTableId) : '';
    }
    syncQrPanel();
  }

  function fillQrTablePick() {
    var sel = document.getElementById('qr-table-pick');
    if (!sel) {
      return;
    }
    var keep = pickedTableId;
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = 'Masa seçin';
    sel.appendChild(first);
    (layout.tables || []).slice().sort(function (a, b) {
      return (Number(a.number) || 0) - (Number(b.number) || 0) || (a.id - b.id);
    }).forEach(function (table) {
      var opt = document.createElement('option');
      opt.value = String(table.id);
      opt.textContent = table.name || ('Masa ' + table.number);
      sel.appendChild(opt);
    });
    if (keep && (layout.tables || []).some(function (row) { return row.id === keep; })) {
      sel.value = String(keep);
    } else {
      pickedTableId = 0;
      sel.value = '';
    }
  }

  function isLoopbackOrigin(raw) {
    var s = String(raw || '').toLowerCase();
    return !s || s.indexOf('127.0.0.1') >= 0 || s.indexOf('localhost') >= 0 || s.indexOf('[::1]') >= 0;
  }

  function guestLink() {
    if (!guestHttpUp || !pickedTableId || isLoopbackOrigin(guestOrigin)) {
      return '';
    }
    return String(guestOrigin).replace(/\/$/, '') + '/guest.html?table=' + pickedTableId;
  }

  function setQrActive(on) {
    var copy = document.getElementById('qr-copy');
    var dl = document.getElementById('qr-download');
    if (copy) {
      copy.disabled = !on;
    }
    if (dl) {
      dl.disabled = !on;
    }
  }

  function syncGuestHttpWarn() {
    var warn = document.getElementById('guest-http-warn');
    var lanOn = guestLanOn;
    if (warn) {
      if (lanOn && !guestHttpUp) {
        warn.hidden = false;
        warn.textContent = 'Qonaq HTTP 3005 açıq deyil — serveri yenidən aç';
      } else {
        warn.hidden = true;
        warn.textContent = '';
      }
    }
    setQrActive(guestHttpUp && !isLoopbackOrigin(guestOrigin));
  }

  function syncQrPanel() {
    var lab = document.getElementById('qr-table-label');
    var table = layout.tables.find(function (item) { return item.id === pickedTableId; });
    if (lab) {
      lab.textContent = table
        ? ((table.name || ('Masa ' + table.number)) + ' · ' + (guestLink() || (guestHttpUp ? 'LAN IP gözlənilir (127.0.0.1 olmaz)' : 'Qonaq HTTP 3005 açıq deyil')))
        : 'Çertyojda masa seçin.';
    }
    var idHint = table
      ? ((table.name || ('Masa ' + table.number)) + ' · id=' + table.id)
      : '';
    if (window.PosDom && window.PosDom.setText) {
      window.PosDom.setText('qr-id-hint', idHint);
    } else {
      var hint = document.getElementById('qr-id-hint');
      if (hint) {
        hint.textContent = idHint;
      }
    }
    syncGuestHttpWarn();
    fillQrPreview();
  }

  function pngCrc32(buf) {
    var tab = pngCrc32.t;
    if (!tab) {
      tab = pngCrc32.t = new Uint32Array(256);
      var n;
      var k;
      var c;
      for (n = 0; n < 256; n += 1) {
        c = n;
        for (k = 0; k < 8; k += 1) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        tab[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    var i;
    for (i = 0; i < buf.length; i += 1) {
      crc = tab[(crc ^ buf[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function pngU32(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  function pngChunk(type, data) {
    var len = data.length;
    var out = new Uint8Array(12 + len);
    out[0] = (len >>> 24) & 255;
    out[1] = (len >>> 16) & 255;
    out[2] = (len >>> 8) & 255;
    out[3] = len & 255;
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    out.set(data, 8);
    var crcBuf = new Uint8Array(4 + len);
    crcBuf[0] = out[4];
    crcBuf[1] = out[5];
    crcBuf[2] = out[6];
    crcBuf[3] = out[7];
    crcBuf.set(data, 4);
    var crc = pngCrc32(crcBuf);
    var o = 8 + len;
    out[o] = (crc >>> 24) & 255;
    out[o + 1] = (crc >>> 16) & 255;
    out[o + 2] = (crc >>> 8) & 255;
    out[o + 3] = crc & 255;
    return out;
  }

  function pngAdler(buf) {
    var a = 1;
    var b = 0;
    var i;
    for (i = 0; i < buf.length; i += 1) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function pngDeflate(raw) {
    var parts = [];
    var off = 0;
    while (off < raw.length) {
      var n = Math.min(65535, raw.length - off);
      var last = off + n >= raw.length ? 1 : 0;
      var block = new Uint8Array(5 + n);
      block[0] = last;
      block[1] = n & 255;
      block[2] = (n >>> 8) & 255;
      block[3] = (~n) & 255;
      block[4] = ((~n) >>> 8) & 255;
      block.set(raw.subarray(off, off + n), 5);
      parts.push(block);
      off += n;
    }
    var ad = pngAdler(raw);
    var total = 2;
    var p;
    for (p = 0; p < parts.length; p += 1) {
      total += parts[p].length;
    }
    var out = new Uint8Array(total + 4);
    out[0] = 0x78;
    out[1] = 0x01;
    var at = 2;
    for (p = 0; p < parts.length; p += 1) {
      out.set(parts[p], at);
      at += parts[p].length;
    }
    out[at] = (ad >>> 24) & 255;
    out[at + 1] = (ad >>> 16) & 255;
    out[at + 2] = (ad >>> 8) & 255;
    out[at + 3] = ad & 255;
    return out;
  }

  function pngB64(u8) {
    var s = '';
    var i;
    for (i = 0; i < u8.length; i += 1) {
      s += String.fromCharCode(u8[i]);
    }
    return btoa(s);
  }

  function grayPngDataUrl(w, h, gray) {
    var raw = new Uint8Array((w + 1) * h);
    var y;
    var x;
    var i = 0;
    var j = 0;
    for (y = 0; y < h; y += 1) {
      raw[i] = 0;
      i += 1;
      for (x = 0; x < w; x += 1) {
        raw[i] = gray[j];
        i += 1;
        j += 1;
      }
    }
    var ihdr = new Uint8Array(13);
    ihdr.set(pngU32(w), 0);
    ihdr.set(pngU32(h), 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    var cIhdr = pngChunk('IHDR', ihdr);
    var cIdat = pngChunk('IDAT', pngDeflate(raw));
    var cIend = pngChunk('IEND', new Uint8Array(0));
    var out = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
    out.set(sig, 0);
    out.set(cIhdr, sig.length);
    out.set(cIdat, sig.length + cIhdr.length);
    out.set(cIend, sig.length + cIhdr.length + cIdat.length);
    return 'data:image/png;base64,' + pngB64(out);
  }

  function rgbPngDataUrl(img) {
    var w = img.width;
    var h = img.height;
    var p = img.data;
    var n = w * h;
    var sum = 0;
    var k;
    for (k = 0; k < p.length; k += 4) {
      sum += 0.299 * p[k] + 0.587 * p[k + 1] + 0.114 * p[k + 2];
    }
    if (n && sum / n < 140) {
      for (k = 0; k < p.length; k += 4) {
        p[k] = 255 - p[k];
        p[k + 1] = 255 - p[k + 1];
        p[k + 2] = 255 - p[k + 2];
        p[k + 3] = 255;
      }
    }
    var raw = new Uint8Array((w * 3 + 1) * h);
    var y;
    var x;
    var i = 0;
    var j = 0;
    for (y = 0; y < h; y += 1) {
      raw[i] = 0;
      i += 1;
      for (x = 0; x < w; x += 1) {
        raw[i] = p[j];
        raw[i + 1] = p[j + 1];
        raw[i + 2] = p[j + 2];
        i += 3;
        j += 4;
      }
    }
    var ihdr = new Uint8Array(13);
    ihdr.set(pngU32(w), 0);
    ihdr.set(pngU32(h), 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    var cIhdr = pngChunk('IHDR', ihdr);
    var cIdat = pngChunk('IDAT', pngDeflate(raw));
    var cIend = pngChunk('IEND', new Uint8Array(0));
    var out = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
    out.set(sig, 0);
    out.set(cIhdr, sig.length);
    out.set(cIdat, sig.length + cIhdr.length);
    out.set(cIend, sig.length + cIhdr.length + cIdat.length);
    return 'data:image/png;base64,' + pngB64(out);
  }

  function fitCardText(ctx, text, maxW, size) {
    var t = String(text || '');
    var s = size;
    ctx.font = '700 ' + s + 'px Georgia, "Times New Roman", serif';
    while (s > 18 && ctx.measureText(t).width > maxW) {
      s -= 1;
      ctx.font = '700 ' + s + 'px Georgia, "Times New Roman", serif';
    }
    return s;
  }

  function strokeRound(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function fillRound(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
    }
    ctx.closePath();
    ctx.fill();
  }

  function makeQrPng(text, tableName) {
    if (!text || typeof QRCode === 'undefined') {
      return '';
    }
    var hold = document.createElement('div');
    hold.style.cssText = 'position:fixed;left:-9999px;top:0;background:#ffffff;color-scheme:light';
    document.body.appendChild(hold);
    var inst;
    try {
      inst = new QRCode(hold, {
        text: text,
        width: 8,
        height: 8,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : 1
      });
    } catch (error) {
      document.body.removeChild(hold);
      return '';
    }
    var code = inst && inst._oQRCode;
    document.body.removeChild(hold);
    if (!code || typeof code.getModuleCount !== 'function' || typeof code.isDark !== 'function') {
      return '';
    }
    var n = code.getModuleCount();
    var quiet = 4;
    var cell = 6;
    var qrSize = (n + quiet * 2) * cell;
    var W = 640;
    var H = 860;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.style.colorScheme = 'light';
    var ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!ctx) {
      return '';
    }
    ctx.fillStyle = '#fbf6ec';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#c9842a';
    ctx.lineWidth = 10;
    strokeRound(ctx, 22, 22, W - 44, H - 44, 28);
    ctx.lineWidth = 2;
    strokeRound(ctx, 38, 38, W - 76, H - 76, 20);
    var maxW = W - 100;
    var brand = qrBrandText();
    ctx.fillStyle = '#1b140c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var titleY = 108;
    if (brand) {
      fitCardText(ctx, brand, maxW, 40);
      ctx.fillText(brand, W / 2, titleY);
    }
    ctx.strokeStyle = '#c9842a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 70, titleY + 42);
    ctx.lineTo(W / 2 + 70, titleY + 42);
    ctx.stroke();
    var box = (W - qrSize) / 2;
    var boxY = 178;
    ctx.fillStyle = '#ffffff';
    fillRound(ctx, box - 18, boxY - 18, qrSize + 36, qrSize + 36, 16);
    ctx.strokeStyle = '#c9842a';
    ctx.lineWidth = 3;
    strokeRound(ctx, box - 18, boxY - 18, qrSize + 36, qrSize + 36, 16);
    ctx.fillStyle = '#000000';
    var r;
    var c;
    var ox = box + quiet * cell;
    var oy = boxY + quiet * cell;
    for (r = 0; r < n; r += 1) {
      for (c = 0; c < n; c += 1) {
        if (code.isDark(r, c)) {
          ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
        }
      }
    }
    var seat = String(tableName || '').trim();
    var nameY = boxY + qrSize + 72;
    ctx.fillStyle = '#1b140c';
    if (seat) {
      fitCardText(ctx, seat, maxW, 36);
      ctx.fillText(seat, W / 2, nameY);
    }
    ctx.strokeStyle = '#c9842a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 48, nameY + 36);
    ctx.lineTo(W / 2 + 48, nameY + 36);
    ctx.stroke();
    return rgbPngDataUrl(ctx.getImageData(0, 0, W, H));
  }

  function qrTableName() {
    var table = layout.tables.find(function (item) { return item.id === pickedTableId; });
    return String((table && table.name) || (table && table.number) || '').trim();
  }

  function fillQrPreview() {
    var box = document.getElementById('qr-preview');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    var url = guestLink();
    var href = makeQrPng(url, qrTableName());
    if (!href) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var pic = document.createElement('img');
    pic.alt = 'QR';
    pic.src = href;
    box.appendChild(pic);
  }

  function copyGuestLink() {
    if (!pickedTableId) {
      say('Əvvəl masa seçin.', 'err');
      return;
    }
    var url = guestLink();
    if (!url) {
      say(guestHttpUp ? 'LAN IP yoxdur. Ayarlarda LAN açıq olsun. QR-ə 127.0.0.1 yazılmır.' : 'Qonaq HTTP 3005 açıq deyil — serveri yenidən aç', 'err');
      return;
    }
    function ok() {
      say('Link kopyalandı.', 'ok');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(function () {
        window.prompt('Link', url);
      });
      return;
    }
    window.prompt('Link', url);
  }

  function downloadQr() {
    if (!pickedTableId) {
      say('Əvvəl masa seçin.', 'err');
      return;
    }
    if (typeof QRCode === 'undefined') {
      say('QR kitabxanası yoxdur.', 'err');
      return;
    }
    var url = guestLink();
    if (!url) {
      say(guestHttpUp ? 'LAN IP yoxdur. Ayarlarda LAN açıq olsun. QR-ə 127.0.0.1 yazılmır.' : 'Qonaq HTTP 3005 açıq deyil — serveri yenidən aç', 'err');
      return;
    }
    var table = layout.tables.find(function (item) { return item.id === pickedTableId; });
    var raw = String((table && table.name) || (table && table.number) || '').trim();
    var href = makeQrPng(url, raw);
    if (!href) {
      say('QR şəkil alınmadı.', 'err');
      return;
    }
    var safe = raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safe) {
      safe = 'qr';
    }
    var a = document.createElement('a');
    a.href = href;
    a.download = safe + '-qr.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    say('QR yükləndi.', 'ok');
  }

  var qrCopy = document.getElementById('qr-copy');
  if (qrCopy) {
    qrCopy.addEventListener('click', copyGuestLink);
  }
  var qrDl = document.getElementById('qr-download');
  if (qrDl) {
    qrDl.addEventListener('click', downloadQr);
  }

  var qrTablePick = document.getElementById('qr-table-pick');
  if (qrTablePick) {
    qrTablePick.addEventListener('change', function () {
      pickTable(qrTablePick.value);
    });
  }

  function qrBrandText() {
    var saved = String(settingsBrand || '').trim();
    if (saved) {
      return saved;
    }
    var floor = (layout.floors || []).find(function (row) {
      return row.id === floorId;
    }) || ((layout.floors || [])[0]);
    var fromFloor = String((floor && floor.name) || '').trim();
    return fromFloor || 'Arpos Restoran';
  }

  function takeBranch(s) {
    if (!s) {
      return;
    }
    var br = String(s.branchName || '').trim();
    var rec = s.receipt ? String(s.receipt.title || '').trim() : '';
    var header = '';
    if (s.receipt && s.receipt.headerLines && s.receipt.headerLines[0]) {
      header = String(s.receipt.headerLines[0] || '').trim();
    }
    var code = String(s.branchCode || '').trim();
    var next = br || rec || header || code;
    if (next) {
      settingsBrand = next;
    }
  }

  var lanReady = api('/api/guest/link-base').then(function (data) {
    guestHttpUp = !!(data && data.listening);
    guestLanOn = !!(data && data.lanOn);
    var origin = guestHttpUp ? ((data && data.origin) || '') : '';
    guestOrigin = isLoopbackOrigin(origin) ? '' : origin;
    return data;
  }).catch(function () {
    guestHttpUp = false;
    guestLanOn = true;
    guestOrigin = '';
    return null;
  });
  var ordersReady = api('/api/orders').then(function (data) {
    return data && data.settings;
  }).catch(function () {
    return null;
  });
  var setReady = api('/api/settings').then(function (data) {
    return data && data.settings;
  }).catch(function () {
    return null;
  });
  Promise.all([lanReady, ordersReady, setReady]).then(function (rows) {
    takeBranch(rows[2]);
    takeBranch(rows[1]);
    if (!settingsBrand && rows[0]) {
      takeBranch({ branchName: String(rows[0].branchName || '').trim() });
    }
    syncQrPanel();
  });

  load();
})();
