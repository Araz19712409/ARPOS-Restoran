(function () {
  const floorList = document.getElementById('floor-list');
  const blueprint = document.getElementById('blueprint');
  const tableRoom = document.getElementById('table-room');
  let layout = { floors: [], rooms: [], tables: [] };
  let floorId = null;
  let roomId = null;

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
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  // Otağın çertyoj ölçüsünü masalara görə hesablayırıq
  function roomBox(tables) {
    const pad = 24;
    let w = 168;
    let h = 150;
    tables.forEach(function (table) {
      w = Math.max(w, Number(table.x || 12) + tableW(table) + pad);
      h = Math.max(h, Number(table.y || 12) + tableH(table) + pad);
    });
    if (tables.length >= 2) {
      w = Math.max(w, 480);
      h = Math.max(h, 340);
    }
    return { w: w, h: h };
  }

  // Otaqda boş yer tapırıq ki, masalar üst-üstə düşməsin
  function nextSlot(tables) {
    const size = 88;
    const gap = 16;
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const x = 12 + col * (size + gap);
        const y = 12 + row * (size + gap);
        const busy = tables.some(function (table) {
          const need = Math.max(size, tableW(table), tableH(table));
          return Math.abs(Number(table.x || 0) - x) < need && Math.abs(Number(table.y || 0) - y) < need;
        });
        if (!busy) {
          return { x: x, y: y };
        }
      }
    }
    return { x: 12, y: 12 };
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

    blueprint.innerHTML = rooms.map(function (room) {
      const list = tablesInRoom(room.id);
      const box = roomBox(list);
      const tables = list.map(function (table) {
        const title = table.name || ('Masa ' + table.number);
        const w = tableW(table);
        const h = tableH(table);
        return (
          '<div class="table ' + table.shape + '" data-table="' + table.id + '" style="left:' + Number(table.x || 12) + 'px;top:' + Number(table.y || 12) + 'px;width:' + w + 'px;height:' + h + 'px">' +
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
        '<article class="room' + (list.length ? '' : ' empty') + '" data-room="' + room.id + '" style="width:' + box.w + 'px;height:' + box.h + 'px">' +
          '<div class="room-title">' +
            '<span>' + esc(room.name) + '</span>' +
            '<button class="tiny" type="button" data-del-room="' + room.id + '">Sil</button>' +
          '</div>' +
          '<div class="floor">' + (tables || '<p class="hint">Boş</p>') + '</div>' +
        '</article>'
      );
    }).join('') || '<p class="hint">Bu mərtəbədə otaq yoxdur. Soldan otaq əlavə edin.</p>';

    bindDrags();
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

  // Masanın yerini və ölçüsünü saxlayırıq
  function saveTableBox(el) {
    const id = Number(el.dataset.table);
    const payload = {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight
    };
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
      body: JSON.stringify(payload)
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  // Masaları sürükləyirik və ölçüsünü dəyişirik
  function bindDrags() {
    blueprint.querySelectorAll('.table').forEach(function (el) {
      el.addEventListener('mousedown', function (event) {
        if (event.target.closest('button')) {
          return;
        }
        event.preventDefault();
        const floor = el.parentElement;
        const startX = event.clientX;
        const startY = event.clientY;
        const left = el.offsetLeft;
        const top = el.offsetTop;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        const mode = event.target.dataset.rz || 'move';

        function move(ev) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (mode === 'move') {
            const maxX = Math.max(0, floor.clientWidth - el.offsetWidth);
            const maxY = Math.max(0, floor.clientHeight - el.offsetHeight);
            el.style.left = Math.min(maxX, Math.max(0, left + dx)) + 'px';
            el.style.top = Math.min(maxY, Math.max(0, top + dy)) + 'px';
            return;
          }
          let w = startW;
          let h = startH;
          if (mode === 'e' || mode === 'se') {
            w = Math.min(360, Math.max(48, startW + dx));
          }
          if (mode === 's' || mode === 'se') {
            h = Math.min(360, Math.max(48, startH + dy));
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
      });
    });
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
      const created = await api('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floorId: floorId,
          name: document.getElementById('room-name').value
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
          w: 80,
          h: 80
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
      const delRoom = Number(event.target.dataset.delRoom);
      const delTable = Number(event.target.dataset.delTable);
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
        await api('/api/rooms/' + delRoom, { method: 'DELETE' });
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

  load();
})();
