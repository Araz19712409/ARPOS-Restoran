(function () {
  var store = { roles: [], users: [], permissions: [] };
  var selectedRoleId = 0;
  var editingId = 0;
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

  function roleById(id) {
    return store.roles.find(function (item) { return item.id === id; });
  }

  function load() {
    return api('/api/acl').then(function (body) {
      store = body.data;
      if (!selectedRoleId && store.roles[0]) {
        selectedRoleId = store.roles[0].id;
      }
      if (selectedRoleId && !roleById(selectedRoleId)) {
        selectedRoleId = store.roles[0] ? store.roles[0].id : 0;
      }
      render();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function renderRoles() {
    var box = document.getElementById('role-list');
    box.innerHTML = '';
    store.roles.forEach(function (role) {
      var row = document.createElement('div');
      row.className = 'group-item' + (role.id === selectedRoleId ? ' active' : '');

      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = role.name;
      openBtn.addEventListener('click', function () {
        selectedRoleId = role.id;
        render();
      });

      var renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.textContent = 'Ad';
      renameBtn.addEventListener('click', function () {
        var name = window.prompt('Rolun yeni adı', role.name);
        if (!name || name.trim() === role.name) {
          return;
        }
        window.askChange(role.name).then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/roles/' + role.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          }).then(load);
        }).catch(function (error) { say(error.message, 'err'); });
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Sil';
      delBtn.addEventListener('click', function () {
        var count = store.users.filter(function (item) { return item.roleId === role.id; }).length;
        var extra = count ? 'Bu rolda ' + count + ' istifadəçi var.' : '';
        window.askDelete(role.name, extra).then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/roles/' + role.id, { method: 'DELETE' }).then(load);
        }).catch(function (error) { say(error.message, 'err'); });
      });

      row.appendChild(openBtn);
      row.appendChild(renameBtn);
      row.appendChild(delBtn);
      box.appendChild(row);
    });
  }

  function renderPerms() {
    var grid = document.getElementById('perm-grid');
    var title = document.getElementById('role-title');
    var role = roleById(selectedRoleId);
    title.textContent = role ? role.name : 'Rol seçin';
    grid.innerHTML = '';
    if (!role) {
      return;
    }

    var groups = {};
    store.permissions.forEach(function (item) {
      if (!groups[item.group]) {
        groups[item.group] = [];
      }
      groups[item.group].push(item);
    });

    Object.keys(groups).forEach(function (groupName) {
      var box = document.createElement('div');
      box.className = 'perm-group';
      var heading = document.createElement('h4');
      heading.textContent = groupName;
      box.appendChild(heading);
      groups[groupName].forEach(function (item) {
        var label = document.createElement('label');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.value = item.key;
        input.checked = role.permissions.indexOf(item.key) !== -1;
        label.appendChild(input);
        label.appendChild(document.createTextNode(item.label));
        box.appendChild(label);
      });
      grid.appendChild(box);
    });
  }

  function renderUsers() {
    var grid = document.getElementById('user-grid');
    grid.innerHTML = '';
    var list = store.users.filter(function (item) { return item.roleId === selectedRoleId; });
    if (!list.length) {
      grid.innerHTML = '<div class="empty-card">Bu rolda istifadəçi yoxdur.</div>';
      return;
    }
    list.forEach(function (item) {
      var role = roleById(item.roleId);
      var card = document.createElement('article');
      card.className = 'user-card';
      card.innerHTML = '<h3></h3><p class="meta"></p><div class="card-actions"></div>';
      card.querySelector('h3').textContent = item.name;
      card.querySelector('.meta').textContent =
        (role ? role.name : 'Rolsuz') + ' • ' + (item.active ? 'Aktiv' : 'Sönülü') +
        (item.hasPin ? ' • PIN var' : ' • PIN yoxdur');

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Dəyiş';
      editBtn.addEventListener('click', function () { openModal(item); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Sil';
      delBtn.addEventListener('click', function () {
        window.askDelete(item.name).then(function (ok) {
          if (!ok) {
            return;
          }
          return api('/api/users/' + item.id, { method: 'DELETE' }).then(load);
        }).catch(function (error) { say(error.message, 'err'); });
      });

      card.querySelector('.card-actions').appendChild(editBtn);
      card.querySelector('.card-actions').appendChild(delBtn);
      grid.appendChild(card);
    });
  }

  function render() {
    renderRoles();
    renderPerms();
    renderUsers();
  }

  function fillRoleSelect(selectedId) {
    document.getElementById('user-role').innerHTML = store.roles.map(function (role) {
      var chosen = role.id === selectedId ? ' selected' : '';
      return '<option value="' + role.id + '"' + chosen + '>' + role.name + '</option>';
    }).join('');
  }

  function fillDays(selected) {
    var names = ['Bz', 'Be', 'Ça', 'Çə', 'Ca', 'Cü', 'Şə'];
    var box = document.getElementById('user-days');
    var pick = selected || [];
    box.innerHTML = names.map(function (name, i) {
      var on = pick.indexOf(i) !== -1 ? ' checked' : '';
      return '<label><input type="checkbox" value="' + i + '"' + on + '> ' + name + '</label>';
    }).join('');
  }

  function openModal(user) {
    editingId = user ? user.id : 0;
    document.getElementById('modal-title').textContent = user ? 'İstifadəçini dəyiş' : 'Yeni istifadəçi';
    document.getElementById('user-name').value = user ? user.name : '';
    document.getElementById('user-pin').value = '';
    document.getElementById('user-active').checked = user ? user.active !== false : true;
    fillRoleSelect(user ? user.roleId : selectedRoleId);
    var sch = user && user.schedule ? user.schedule : { days: [], from: '', to: '' };
    fillDays(sch.days);
    document.getElementById('user-from').value = sch.from || '';
    document.getElementById('user-to').value = sch.to || '';
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('user-name').focus();
  }

  function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    editingId = 0;
  }

  document.getElementById('add-role').addEventListener('click', function () {
    var name = document.getElementById('role-name').value.trim();
    if (!name) {
      say('Rol adını yazın.', 'err');
      return;
    }
    api('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function (body) {
      document.getElementById('role-name').value = '';
      selectedRoleId = body.data.id;
      return load();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('save-perms').addEventListener('click', function () {
    var role = roleById(selectedRoleId);
    if (!role) {
      return;
    }
    window.askChange(role.name + ' icazələri').then(function (ok) {
      if (!ok) {
        return;
      }
      var permissions = [];
      document.querySelectorAll('#perm-grid input[type="checkbox"]').forEach(function (input) {
        if (input.checked) {
          permissions.push(input.value);
        }
      });
      return api('/api/roles/' + role.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permissions })
      }).then(function () {
        say('İcazələr saxlandı.');
        return load();
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('add-user').addEventListener('click', function () {
    openModal(null);
  });
  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  document.getElementById('user-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    var payload = {
      name: document.getElementById('user-name').value,
      roleId: Number(document.getElementById('user-role').value),
      active: document.getElementById('user-active').checked,
      pin: document.getElementById('user-pin').value,
      scheduleDays: [],
      scheduleFrom: document.getElementById('user-from').value,
      scheduleTo: document.getElementById('user-to').value
    };
    document.querySelectorAll('#user-days input:checked').forEach(function (box) {
      payload.scheduleDays.push(Number(box.value));
    });
    if (!payload.pin) {
      delete payload.pin;
    }
    if (!editingId && !payload.pin) {
      say('Yeni istifadəçi üçün PIN yazın.', 'err');
      return;
    }
    if (payload.pin && !/^\d{6,8}$/.test(payload.pin)) {
      say('PIN 6-8 rəqəm olmalıdır.', 'err');
      return;
    }
    if (payload.pin && /^0+$/.test(payload.pin)) {
      say('0000 olmaz. Başqa PIN yazın.', 'err');
      return;
    }
    function sendUser() {
      busy = true;
      api(editingId ? '/api/users/' + editingId : '/api/users', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function () {
        closeModal();
        selectedRoleId = payload.roleId;
        return load();
      }).catch(function (error) {
        say(error.message, 'err');
      }).then(function () {
        busy = false;
      });
    }
    if (editingId) {
      window.askChange(payload.name).then(function (ok) {
        if (ok) {
          sendUser();
        }
      });
      return;
    }
    sendUser();
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
