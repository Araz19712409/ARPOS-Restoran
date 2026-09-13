(function () {
  var waiter = null;
  var pinBuffer = '';
  var staffList = [];
  var roles = [];
  var current = { serviceChargePercent: 0, waiterBonuses: {}, backupFolder: '', listenLan: true };
  var terminalList = [];
  var lanInfo = { live: '127.0.0.1', urls: [] };
  var Dom = window.PosDom || {};

  function el(id) {
    return Dom.el ? Dom.el(id) : document.getElementById(id);
  }

  function setText(id, text) {
    if (Dom.setText) {
      Dom.setText(id, text);
      return;
    }
    var n = document.getElementById(id);
    if (n) {
      n.textContent = text == null ? '' : String(text);
    }
  }

  function setVal(id, val) {
    if (Dom.setVal) {
      Dom.setVal(id, val);
      return;
    }
    var n = document.getElementById(id);
    if (n) {
      n.value = val == null ? '' : String(val);
    }
  }

  function setChecked(id, on) {
    var n = el(id);
    if (n) {
      n.checked = !!on;
    }
  }

  function dec(value) {
    return window.PosNav && window.PosNav.parseDec
      ? window.PosNav.parseDec(value)
      : Number(String(value == null ? '' : value).replace(',', '.'));
  }

  function backupFolderValue() {
    var box = document.getElementById('backup-folder');
    return box ? box.value.trim() : '';
  }
  var editingId = 0;
  var updateBusy = false;

  function api(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().then(function (body) {
        if (!body.success) {
          throw new Error(body.message || 'Xəta baş verdi.');
        }
        return body;
      });
    }).catch(function (error) {
      var msg = error && error.message ? error.message : '';
      if (msg === 'Failed to fetch' || msg === 'NetworkError when attempting to fetch resource.') {
        throw new Error('Server cavab vermir. Yeniləmə pəncərəsini gözləyin və ya data\\updates içində Setup-u açın.');
      }
      throw error;
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

  function canOpenSettings() {
    return can('settings.view') || can('settings.edit') || can('users.edit');
  }

  function canEditSettings() {
    return !!(waiter && (can('settings.edit') || can('users.edit') || can('settings.view') || can('users.view')));
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
    document.getElementById('pin-dots').textContent = pinBuffer ? new Array(pinBuffer.length + 1).join('•') : '○ ○ ○ ○ ○ ○';
  }

  function setWaiter(data) {
    waiter = data;
    if (data) {
      window.sessionStorage.setItem('posWaiter', JSON.stringify(data));
    } else {
      if (window.PosNav) {
        window.PosNav.forget();
      }
      window.sessionStorage.removeItem('posWaiter');
    }
    if (window.PosNav && !window.PosNav.afterLogin(data)) {
      return;
    }
    if (data && canOpenSettings()) {
      document.getElementById('waiter-line').textContent = data.user.name;
      hideLock();
      loadSettings();
    } else if (data) {
      document.getElementById('pin-error').textContent = 'Ayarlara icazəniz yoxdur.';
      document.getElementById('waiter-line').textContent = data.user.name;
      showLock();
    } else {
      document.getElementById('waiter-line').textContent = 'PIN ilə daxil olun.';
      showLock();
    }
  }

  function roleName(id) {
    var role = roles.find(function (item) { return item.id === id; });
    return role ? role.name : '';
  }

  function fillRoleSelect(selectId, selectedId) {
    var pick = selectedId || 3;
    var box = document.getElementById(selectId);
    if (!box) {
      return;
    }
    box.innerHTML = '';
    roles.forEach(function (role) {
      var opt = document.createElement('option');
      opt.value = String(role.id);
      opt.textContent = role.name;
      if (role.id === pick) {
        opt.selected = true;
      }
      box.appendChild(opt);
    });
    if (!box.value && roles[0]) {
      box.value = String(roles[0].id);
    }
  }

  function fillRoles(selectedId) {
    fillRoleSelect('new-role', selectedId);
  }

  function deliveryPayload() {
    return {
      provider: document.getElementById('delivery-provider')
        ? document.getElementById('delivery-provider').value
        : 'manual',
      autoPrintKitchen: !!(document.getElementById('delivery-autoprint') &&
        document.getElementById('delivery-autoprint').checked),
      webhookSecret: document.getElementById('delivery-secret')
        ? document.getElementById('delivery-secret').value
        : ''
    };
  }

  function ekassaPayload() {
    return {
      provider: document.getElementById('ekassa-provider').value,
      emulator: document.getElementById('ekassa-emulator').checked,
      voen: document.getElementById('ekassa-voen').value,
      objectName: document.getElementById('ekassa-object').value,
      objectCode: document.getElementById('ekassa-code').value,
      operator: document.getElementById('ekassa-operator').value,
      note: document.getElementById('ekassa-note').value,
      wizarpos: {
        host: document.getElementById('ekassa-wz-host').value,
        port: Number(document.getElementById('ekassa-wz-port').value) || 9876,
        apiKey: document.getElementById('ekassa-wz-key').value,
        cashier: document.getElementById('ekassa-wz-cashier').value
      },
      omnitech: {
        host: document.getElementById('ekassa-om-host').value,
        port: Number(document.getElementById('ekassa-om-port').value) || 8989,
        user: document.getElementById('ekassa-om-user').value,
        password: document.getElementById('ekassa-om-pass').value
      },
      azsmart: {
        host: document.getElementById('ekassa-az-host').value,
        port: Number(document.getElementById('ekassa-az-port').value) || 8008,
        merchantId: document.getElementById('ekassa-az-mid').value
      }
    };
  }

  function showEkassaFields() {
    var id = document.getElementById('ekassa-provider').value;
    document.querySelectorAll('.ekassa-prov').forEach(function (box) {
      box.classList.toggle('hidden', box.getAttribute('data-prov') !== id);
    });
  }

  function fiscalStatus(job) {
    if (job.status === 'sent') {
      return 'göndərildi';
    }
    if (job.status === 'error') {
      return 'xəta';
    }
    if (job.status === 'pending') {
      return 'növbə';
    }
    if (job.status === 'ready') {
      return 'hazır';
    }
    return 'gözləyir';
  }

  function loadFiscal() {
    var box = document.getElementById('fiscal-body');
    if (!box) {
      return;
    }
    api('/api/fiscal').then(function (body) {
      var jobs = body.data || [];
      box.textContent = '';
      if (!jobs.length) {
        var empty = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = 6;
        td.textContent = 'Növbə boşdur.';
        empty.appendChild(td);
        box.appendChild(empty);
        return;
      }
      jobs.slice(0, 20).forEach(function (job) {
        var tr = document.createElement('tr');
        function cell(text) {
          var td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        }
        cell(formatBackup(job.at, ''));
        cell(job.tableName || ('#' + job.orderId));
        cell(Number(job.total || 0).toFixed(2));
        cell(fiscalStatus(job));
        cell(job.fiscalId || job.message || '');
        var act = document.createElement('td');
        if (job.status === 'error' || job.status === 'pending') {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'Təkrar';
          btn.addEventListener('click', function () {
            api('/api/fiscal/' + job.id + '/retry', { method: 'POST' }).then(function () {
              say('Yenidən göndərildi.');
              loadFiscal();
            }).catch(function (error) {
              say(error.message, 'err');
            });
          });
          act.appendChild(btn);
        }
        tr.appendChild(act);
        box.appendChild(tr);
      });
    }).catch(function () {
      box.textContent = '';
      var err = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'Növbə oxunmadı.';
      err.appendChild(td);
      box.appendChild(err);
    });
  }

  function opsModeValue() {
    return document.getElementById('ops-sales').checked ? 'sales' : 'full';
  }

  function listenLanValue() {
    return !document.getElementById('lan-off').checked;
  }

  function fillLanHint() {
    var box = document.getElementById('lan-urls');
    if (!box) {
      return;
    }
    var wantLan = listenLanValue();
    var liveLan = lanInfo.live === '0.0.0.0';
    var urls = lanInfo.urls || [];
    if (!wantLan) {
      box.textContent = 'Yalnız http://127.0.0.1:3004';
    } else if (urls.length) {
      box.textContent = 'Planşet (HTTPS): ' + urls.join('  ') +
        ' Brauzer öz-imzalı sertifikatı bir dəfə qəbul etsin. HTTP şəbəkəyə açıq deyil.';
    } else {
      box.textContent = 'IP tapılmadı. Wi‑Fi yoxla. Şəbəkə HTTPS-dir (HTTP LAN-a verilmir).';
    }
    if (wantLan !== liveLan) {
      box.textContent += ' Saxlandıqdan sonra serveri yeniləyin.';
    }
  }

  function branchNameValue() {
    var el = document.getElementById('branch-name');
    return el ? el.value.trim() : '';
  }

  function smsPayload() {
    return {
      enabled: document.getElementById('sms-on').checked,
      url: document.getElementById('sms-url').value.trim(),
      login: document.getElementById('sms-login').value.trim(),
      password: document.getElementById('sms-password').value,
      sender: document.getElementById('sms-sender').value.trim(),
      reserveText: document.getElementById('sms-reserve').value.trim(),
      waitText: document.getElementById('sms-wait').value.trim()
    };
  }

  function updatePayload() {
    return {
      repo: document.getElementById('update-repo').value.trim(),
      token: document.getElementById('update-token').value
    };
  }

  function backupGithubPayload() {
    return {
      repo: (document.getElementById('backup-gh-repo') || {}).value || '',
      token: (document.getElementById('backup-gh-token') || {}).value || ''
    };
  }

  function fillBranch() {
    setVal('branch-name', current.branchName || '');
    setVal('branch-code', current.branchCode || '');
  }

  function fillSms() {
    var sms = current.sms || {};
    setChecked('sms-on', !!sms.enabled);
    setVal('sms-url', sms.url || '');
    setVal('sms-login', sms.login || '');
    setVal('sms-password', sms.password || '');
    setVal('sms-sender', sms.sender || '');
    setVal('sms-reserve', sms.reserveText || 'Rezerv: {name}, {table}, {time}');
    setVal('sms-wait', sms.waitText || 'Növbə: {name}, {guests} nəfər');
  }

  function fillUpdate(ver) {
    var upd = current.update || {};
    setVal('update-repo', upd.repo || '');
    setVal('update-token', upd.token || '');
    setText('update-ver', 'İndi: ' + (ver || '1.1.13'));
  }

  function fillBackupGithub() {
    var gh = current.backupGithub || {};
    setVal('backup-gh-repo', gh.repo || '');
    setVal('backup-gh-token', gh.token || '');
  }

  function receiptPayload() {
    return {
      title: (el('receipt-title') && el('receipt-title').value) || '',
      address: (el('receipt-address') && el('receipt-address').value) || '',
      phone: (el('receipt-phone') && el('receipt-phone').value) || '',
      headerLines: [
        (el('receipt-header-1') && el('receipt-header-1').value) || '',
        (el('receipt-header-2') && el('receipt-header-2').value) || ''
      ],
      footerLines: [
        (el('receipt-footer-1') && el('receipt-footer-1').value) || '',
        (el('receipt-footer-2') && el('receipt-footer-2').value) || '',
        (el('receipt-footer-3') && el('receipt-footer-3').value) || ''
      ],
      showBranchCode: !!(el('receipt-show-branch') && el('receipt-show-branch').checked)
    };
  }

  function fillReceipt() {
    var r = current.receipt || {};
    setVal('receipt-title', r.title || '');
    setVal('receipt-address', r.address || '');
    setVal('receipt-phone', r.phone || '');
    setChecked('receipt-show-branch', r.showBranchCode === true);
    var headers = Array.isArray(r.headerLines) ? r.headerLines : [];
    setVal('receipt-header-1', headers[0] || '');
    setVal('receipt-header-2', headers[1] || '');
    var footers = Array.isArray(r.footerLines) ? r.footerLines : [];
    setVal('receipt-footer-1', footers[0] || '');
    setVal('receipt-footer-2', footers[1] || '');
    setVal('receipt-footer-3', footers[2] || '');
  }

  function fillPay() {
    var pay = current.pay || {};
    setChecked('pay-simple-mode', pay.simpleMode !== false);
  }

  function sendSmsTest() {
    if (!waiter) {
      say('PIN ilə daxil olun.', 'err');
      return;
    }
    api('/api/sms/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waiterId: waiter.user.id,
        phone: document.getElementById('sms-test-phone').value,
        text: 'POS sınaq'
      })
    }).then(function () {
      say('Sınaq SMS göndərildi.');
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function checkUpdate() {
    api('/api/update/check').then(function (body) {
      var info = body.data || {};
      var box = document.getElementById('update-ver');
      if (info.message && !info.remote) {
        box.textContent = info.message;
        say(info.message, 'warn');
        return;
      }
      box.textContent = 'İndi ' + info.local + (info.remote ? ' • GitHub ' + info.remote : '');
      say(info.newer ? ('Yeni versiya: ' + info.remote) : 'Ən son versiyasınız.');
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function applyUpdate() {
    if (!waiter) {
      say('PIN ilə daxil olun.', 'err');
      return;
    }
    if (updateBusy) {
      say('Yeniləmə artıq gedir. Pəncərəyə baxın.', 'warn');
      return;
    }
    window.askYes('Yeniləmə', 'GitHub-dan yeni fayllar yazılacaq. data qalır. Davam?').then(function (ok) {
      if (!ok) {
        return;
      }
      updateBusy = true;
      var btn = document.getElementById('update-apply');
      if (btn) {
        btn.disabled = true;
      }
      return api('/api/update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiterId: waiter.user.id, confirm: true })
      }).then(function (body) {
        say((body.data && body.data.message) || 'Yeniləmə pəncərəsi açıldı. «Yenilə» düyməsinə basın.', 'ok');
      }).catch(function (error) {
        updateBusy = false;
        if (btn) {
          btn.disabled = false;
        }
        throw error;
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function saveBonuses(map, doneText) {
    return api('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waiterId: waiter.user.id,
        serviceChargePercent: dec(document.getElementById('service-percent').value),
        vatPercent: dec(document.getElementById('vat-percent').value),
        waiterBonuses: map,
        backupFolder: backupFolderValue(),
        ekassa: ekassaPayload(),
        delivery: deliveryPayload(),
        stock: {
          salesWarehouseId: document.getElementById('sales-warehouse')
            ? Number(document.getElementById('sales-warehouse').value) || 1
            : 1,
          blockSaleIfShort: !(document.getElementById('stock-block-short') &&
            !document.getElementById('stock-block-short').checked)
        },
        opsMode: opsModeValue(),
        listenLan: listenLanValue(),
        branchName: branchNameValue(),
        branchCode: document.getElementById('branch-code')
          ? document.getElementById('branch-code').value.trim()
          : '',
        sms: smsPayload(),
        update: updatePayload(),
        backupGithub: backupGithubPayload(),
        tillLocked: !!(document.getElementById('till-locked') && document.getElementById('till-locked').checked),
        shift: {
          autoOpenOnSale: !(document.getElementById('shift-auto-open') &&
            !document.getElementById('shift-auto-open').checked),
          autoPrintZ: !(document.getElementById('shift-auto-print-z') &&
            !document.getElementById('shift-auto-print-z').checked),
          defaultStartingCash: 0
        },
        autoSendAllOnAccept: !(document.getElementById('auto-send-all') &&
          !document.getElementById('auto-send-all').checked),
        loyalty: {
          enabled: !!(document.getElementById('loyalty-enabled') &&
            document.getElementById('loyalty-enabled').checked),
          earnPer100: Number(document.getElementById('loyalty-earn') &&
            document.getElementById('loyalty-earn').value) || 1,
          pointValueMinor: Number(document.getElementById('loyalty-value') &&
            document.getElementById('loyalty-value').value) || 1,
          minRedeem: Number(document.getElementById('loyalty-min') &&
            document.getElementById('loyalty-min').value) || 1
        },
        receipt: receiptPayload(),
        pay: {
          simpleMode: !(el('pay-simple-mode') && !el('pay-simple-mode').checked)
        }
      })
    }).then(function (body) {
      current = body.data || current;
      var wantLan = listenLanValue();
      var extra = wantLan !== (lanInfo.live === '0.0.0.0')
        ? ' Serveri yeniləyin ki, şəbəkə dəyişsin.'
        : '';
      say((doneText || 'Ayarlar yadda saxlandı.') + extra);
      return loadSettings();
    });
  }

  function openEdit(user) {
    editingId = user.id;
    document.getElementById('edit-name').value = user.name;
    document.getElementById('edit-pin').value = '';
    document.getElementById('edit-bonus').value = String(current.waiterBonuses[String(user.id)] || 0);
    fillRoleSelect('edit-role', user.roleId);
    document.getElementById('edit-modal').classList.remove('hidden');
    document.getElementById('edit-name').focus();
  }

  function closeEdit() {
    editingId = 0;
    document.getElementById('edit-modal').classList.add('hidden');
  }

  function removeWaiter(user) {
    if (user.system) {
      say('Sistem adminini silmək olmaz.', 'err');
      return;
    }
    window.askDelete(user.name).then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/users/' + user.id, { method: 'DELETE' }).then(function () {
        var bonuses = collectBonuses();
        delete bonuses[String(user.id)];
        return saveBonuses(bonuses, user.name + ' silindi.');
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function renderBonuses() {
    var box = document.getElementById('bonus-body');
    box.innerHTML = '';
    if (!staffList.length) {
      box.innerHTML = '<tr><td colspan="3">Hələ ofisiant yoxdur. İstifadəçilər səhifəsindən əlavə edin.</td></tr>';
      return;
    }
    staffList.forEach(function (user) {
      var tr = document.createElement('tr');
      var nameTd = document.createElement('td');
      nameTd.textContent = user.name + (roleName(user.roleId) ? ' • ' + roleName(user.roleId) : '');
      var inputTd = document.createElement('td');
      var input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('inputmode', 'decimal');
      input.autocomplete = 'off';
      input.setAttribute('data-user', String(user.id));
      input.value = String(current.waiterBonuses[String(user.id)] || 0);
      input.disabled = !canEditSettings();
      inputTd.appendChild(input);
      var actTd = document.createElement('td');
      actTd.className = 'row-actions';
      if (canEditSettings()) {
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Dəyiş';
        editBtn.addEventListener('click', function () { openEdit(user); });
        actTd.appendChild(editBtn);
        if (!user.system) {
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.textContent = 'Sil';
          delBtn.addEventListener('click', function () { removeWaiter(user); });
          actTd.appendChild(delBtn);
        }
      }
      tr.appendChild(nameTd);
      tr.appendChild(inputTd);
      tr.appendChild(actTd);
      box.appendChild(tr);
    });
  }

  function applyPayload(body) {
    current = body.data.settings || { serviceChargePercent: 0, waiterBonuses: {}, listenLan: true };
    lanInfo = body.data.lan || { live: '127.0.0.1', urls: [] };
    staffList = body.data.users || [];
    roles = body.data.roles || roles;
    setVal('service-percent', String(current.serviceChargePercent || 0));
    var svc = el('service-percent');
    if (svc) {
      svc.disabled = false;
    }
    setVal('vat-percent', String(current.vatPercent || 0));
    var vatBox = el('vat-percent');
    if (vatBox) {
      vatBox.disabled = false;
    }
    setChecked('till-locked', current.tillLocked === true);
    setChecked('shift-auto-open', !(current.shift && current.shift.autoOpenOnSale === false));
    setChecked('shift-auto-print-z', !(current.shift && current.shift.autoPrintZ === false));
    setVal('backup-folder', current.backupFolder || '');
    var ek = current.ekassa || {};
    var del = current.delivery || {};
    setVal('delivery-provider', del.provider || 'manual');
    setChecked('delivery-autoprint', del.autoPrintKitchen !== false);
    setVal('delivery-secret', del.webhookSecret || '');
    setVal('ekassa-provider', ek.provider || 'none');
    setChecked('ekassa-emulator', ek.emulator !== false);
    setVal('ekassa-voen', ek.voen || '');
    setVal('ekassa-object', ek.objectName || '');
    setVal('ekassa-code', ek.objectCode || '');
    setVal('ekassa-note', ek.note || '');
    setVal('ekassa-operator', ek.operator || '');
    var wz = ek.wizarpos || {};
    setVal('ekassa-wz-host', wz.host || '');
    setVal('ekassa-wz-port', String(wz.port || 9876));
    setVal('ekassa-wz-key', wz.apiKey || '');
    setVal('ekassa-wz-cashier', wz.cashier || '');
    var om = ek.omnitech || {};
    setVal('ekassa-om-host', om.host || '');
    setVal('ekassa-om-port', String(om.port || 8989));
    setVal('ekassa-om-user', om.user || '');
    setVal('ekassa-om-pass', om.password || '');
    var az = ek.azsmart || {};
    setVal('ekassa-az-host', az.host || '');
    setVal('ekassa-az-port', String(az.port || 8008));
    setVal('ekassa-az-mid', az.merchantId || '');
    showEkassaFields();
    var mode = current.opsMode === 'sales' ? 'sales' : 'full';
    setChecked('ops-sales', mode === 'sales');
    setChecked('ops-full', mode === 'full');
    setChecked('auto-send-all', current.autoSendAllOnAccept !== false);
    var saleWh = el('sales-warehouse');
    if (saleWh) {
      var list = body.data.warehouses || [];
      saleWh.innerHTML = '';
      if (!list.length) {
        var opt = document.createElement('option');
        opt.value = '1';
        opt.textContent = 'Əsas';
        saleWh.appendChild(opt);
      }
      list.forEach(function (row) {
        if (row.active === false) {
          return;
        }
        var option = document.createElement('option');
        option.value = String(row.id);
        option.textContent = row.name;
        saleWh.appendChild(option);
      });
      var want = current.stock && current.stock.salesWarehouseId
        ? String(current.stock.salesWarehouseId)
        : '1';
      if (Array.prototype.some.call(saleWh.options, function (row) { return row.value === want; })) {
        saleWh.value = want;
      }
    }
    setChecked('stock-block-short', !(current.stock && current.stock.blockSaleIfShort === false));
    var loy = current.loyalty || {};
    setChecked('loyalty-enabled', loy.enabled === true);
    setVal('loyalty-earn', String(loy.earnPer100 != null ? loy.earnPer100 : 1));
    setVal('loyalty-value', String(loy.pointValueMinor != null ? loy.pointValueMinor : 1));
    setVal('loyalty-min', String(loy.minRedeem != null ? loy.minRedeem : 1));
    var lanOn = current.listenLan !== false;
    setChecked('lan-on', lanOn);
    setChecked('lan-off', !lanOn);
    fillLanHint();
    fillSms();
    fillBranch();
    fillUpdate(body.data.version);
    fillBackupGithub();
    fillReceipt();
    fillPay();
    if (window.PosNav) {
      window.PosNav.rememberOps(mode, waiter);
    }
    loadFiscal();
    fillRoles(3);
    renderBonuses();
    terminalList = body.data.terminals || [];
    renderTerminals();
    loadBackups();
  }

  function renderTerminals() {
    var box = document.getElementById('terminal-body');
    box.innerHTML = '';
    if (!terminalList.length) {
      box.innerHTML = '<tr><td colspan="2">Terminal yoxdur.</td></tr>';
      return;
    }
    terminalList.forEach(function (row) {
      var tr = document.createElement('tr');
      var nameTd = document.createElement('td');
      nameTd.textContent = row.name;
      var actTd = document.createElement('td');
      actTd.className = 'row-actions';
      if (canEditSettings() && terminalList.length > 1) {
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'Sil';
        delBtn.addEventListener('click', function () {
          window.askDelete(row.name, 'Terminal silinəcək.').then(function (ok) {
            if (!ok) {
              return;
            }
            return api('/api/terminals/' + row.id + '?waiterId=' + waiter.user.id, { method: 'DELETE' })
              .then(function () {
                say(row.name + ' silindi.');
                return loadSettings();
              });
          }).catch(function (error) {
            say(error.message, 'err');
          });
        });
        actTd.appendChild(delBtn);
      }
      tr.appendChild(nameTd);
      tr.appendChild(actTd);
      box.appendChild(tr);
    });
  }

  function reasonLabel(reason) {
    if (reason === 'daily') {
      return 'Günlük';
    }
    if (reason === 'before-restore') {
      return 'Bərpadan əvvəl';
    }
    if (reason === 'manual') {
      return 'Əl ilə';
    }
    return reason || '';
  }

  function formatBackup(iso, id) {
    if (!iso) {
      return id || '';
    }
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return id || '';
    }
    function two(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function loadBackups() {
    if (!waiter) {
      return;
    }
    api('/api/backups?waiterId=' + waiter.user.id).then(function (body) {
      var box = document.getElementById('backup-body');
      box.innerHTML = '';
      var list = body.data || [];
      if (!list.length) {
        box.innerHTML = '<tr><td colspan="3">Nüsxə yoxdur.</td></tr>';
        return;
      }
      list.forEach(function (row) {
        var tr = document.createElement('tr');
        var t1 = document.createElement('td');
        t1.textContent = formatBackup(row.at, row.id);
        var t2 = document.createElement('td');
        t2.textContent = reasonLabel(row.reason);
        var t3 = document.createElement('td');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Bərpa et';
        btn.addEventListener('click', function () {
          window.askYes('Bərpa', '"' + formatBackup(row.at, row.id) + '" nüsxəsi bərpa olunsun? Cari məlumat əvvəl nüsxələnəcək.').then(function (ok) {
            if (!ok) {
              return;
            }
            return api('/api/backups/' + encodeURIComponent(row.id) + '/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ waiterId: waiter.user.id })
            }).then(function () {
              say('Nüsxə bərpa olundu. Səhifəni yeniləyin.');
              return loadSettings();
            });
          }).catch(function (error) {
            say(error.message, 'err');
          });
        });
        t3.appendChild(btn);
        tr.appendChild(t1);
        tr.appendChild(t2);
        tr.appendChild(t3);
        box.appendChild(tr);
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function loadSettings() {
    api('/api/settings').then(applyPayload).catch(function () {
      return api('/api/acl').then(function (body) {
        roles = body.data.roles || [];
        staffList = body.data.users || [];
        fillRoles(3);
        renderBonuses();
        say('Ayarlar API-si açılmadı. Serveri yeniləyin.', 'err');
      });
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function collectBonuses() {
    var map = {};
    document.querySelectorAll('#bonus-body input[data-user]').forEach(function (input) {
      map[input.getAttribute('data-user')] = dec(input.value) || 0;
    });
    return map;
  }

  document.getElementById('cancel-edit').addEventListener('click', closeEdit);
  document.getElementById('edit-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!waiter || !canEditSettings() || !editingId) {
      return;
    }
    var user = staffList.find(function (item) { return item.id === editingId; });
    var name = document.getElementById('edit-name').value.trim();
    if (!name) {
      say('Adı yazın.', 'err');
      return;
    }
    function saveUser() {
      var payload = {
        name: name,
        roleId: Number(document.getElementById('edit-role').value)
      };
      var pin = document.getElementById('edit-pin').value;
      if (pin) {
        payload.pin = pin;
      }
      return api('/api/users/' + editingId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function () {
        var bonuses = collectBonuses();
        bonuses[String(editingId)] = dec(document.getElementById('edit-bonus').value) || 0;
        closeEdit();
        return saveBonuses(bonuses, name + ' yeniləndi.');
      });
    }
    var ready = user ? window.askChange(name) : Promise.resolve(true);
    ready.then(function (ok) {
      if (!ok) {
        return;
      }
      return saveUser();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  function showTab(id) {
    var page = document.querySelector('.settings-page');
    if (page) {
      page.setAttribute('data-tab', id);
    }
    document.querySelectorAll('.settings-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === id);
    });
    document.querySelectorAll('.settings-panel').forEach(function (panel) {
      panel.classList.toggle('hidden', panel.getAttribute('data-tab') !== id);
    });
  }

  function saveAll() {
    if (!waiter) {
      say('PIN ilə daxil olun.', 'err');
      return;
    }
    saveBonuses(collectBonuses(), 'Yadda saxlandı.').catch(function (error) {
      say(error.message, 'err');
    });
  }

  document.getElementById('settings-tabs').addEventListener('click', function (event) {
    var btn = event.target.closest('.settings-tab');
    if (!btn) {
      return;
    }
    showTab(btn.getAttribute('data-tab'));
  });
  showTab('general');

  document.getElementById('save-settings').addEventListener('click', saveAll);
  document.getElementById('save-service').addEventListener('click', saveAll);
  document.getElementById('save-vat').addEventListener('click', saveAll);
  var saveTill = document.getElementById('save-till');
  if (saveTill) {
    saveTill.addEventListener('click', saveAll);
  }
  document.getElementById('save-bonuses').addEventListener('click', saveAll);
  document.getElementById('save-ekassa').addEventListener('click', saveAll);
  var sampleBtn = document.getElementById('delivery-sample');
  if (sampleBtn) {
    sampleBtn.addEventListener('click', function () {
      if (!waiter || !canEditSettings()) {
        say('Ayarları dəyişməyə icazəniz yoxdur.', 'err');
        return;
      }
      saveBonuses(collectBonuses(), 'Yadda saxlandı.').then(function () {
        return api('/api/delivery/sample', { method: 'POST' });
      }).then(function (body) {
        var row = (body && body.data) || {};
        say((row.tableName || 'Nümunə') + ' yaradıldı.', 'ok');
      }).catch(function (error) {
        say(error.message, 'err');
      });
    });
  }
  document.getElementById('ekassa-provider').addEventListener('change', showEkassaFields);
  function probeEkassa(url, failText) {
    if (!waiter) {
      say('PIN ilə daxil olun.', 'err');
      return;
    }
    var out = document.getElementById('ekassa-probe');
    api(url, { method: 'POST' }).then(function (body) {
      var data = body.data || {};
      var text = data.message || failText;
      if (out) {
        out.textContent = text;
      }
      say(text, data.ok ? 'ok' : 'err');
    }).catch(function (error) {
      if (out) {
        out.textContent = error.message;
      }
      say(error.message, 'err');
    });
  }
  document.getElementById('ekassa-test').addEventListener('click', function () {
    probeEkassa('/api/fiscal/test', 'Test alınmadı.');
  });
  document.getElementById('ekassa-shift').addEventListener('click', function () {
    probeEkassa('/api/fiscal/shift', 'Status alınmadı.');
  });
  document.getElementById('save-ops').addEventListener('click', saveAll);
  document.getElementById('save-lan').addEventListener('click', saveAll);
  document.getElementById('save-branch').addEventListener('click', saveAll);
  document.getElementById('prices-export').addEventListener('click', function () {
    if (!waiter) {
      return;
    }
    api('/api/catalog/prices').then(function (body) {
      var blob = new Blob([JSON.stringify(body.data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'arpos-qiymet.json';
      a.click();
      window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      say('Qiymət faylı hazırdır.');
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });
  document.getElementById('prices-import').addEventListener('click', function () {
    document.getElementById('prices-file').click();
  });
  document.getElementById('prices-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file || !waiter) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var pack;
      try {
        pack = JSON.parse(String(reader.result || ''));
      } catch (error) {
        say('Fayl JSON deyil.', 'err');
        return;
      }
      var list = pack.products || (Array.isArray(pack) ? pack : []);
      api('/api/catalog/prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: list })
      }).then(function (body) {
        say((body.data && body.data.count || 0) + ' məhsulun qiyməti gəldi.');
      }).catch(function (error) {
        say(error.message, 'err');
      });
    };
    reader.readAsText(file);
  });
  document.getElementById('save-sms').addEventListener('click', saveAll);
  document.getElementById('save-update').addEventListener('click', saveAll);
  document.getElementById('save-backup-gh').addEventListener('click', saveAll);
  document.getElementById('lan-on').addEventListener('change', fillLanHint);
  document.getElementById('lan-off').addEventListener('change', fillLanHint);
  document.getElementById('sms-test').addEventListener('click', sendSmsTest);
  document.getElementById('update-check').addEventListener('click', checkUpdate);
  document.getElementById('update-apply').addEventListener('click', applyUpdate);

  function tryLogin(clearOnFail) {
    if (pinBuffer.length < 4) {
      return;
    }
    api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinBuffer })
    }).then(function (body) {
      document.getElementById('pin-error').textContent = '';
      pinBuffer = '';
      drawPin();
      body.data.fromLogin = true;
      setWaiter(body.data);
    }).catch(function (error) {
      document.getElementById('pin-error').textContent = error.message;
      if (clearOnFail || pinBuffer.length >= 8) {
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
      if (key === 'C') {
        pinBuffer = '';
      } else if (key === 'OK') {
        tryLogin(true);
        return;
      } else if (pinBuffer.length < 8) {
        pinBuffer += key;
      }
      drawPin();
      if (pinBuffer.length >= 6 && key !== 'C') {
        tryLogin(false);
      }
    });
    pinPad.appendChild(btn);
  });

  document.getElementById('terminal-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!waiter || !canEditSettings()) {
      say('Terminal əlavə etməyə icazəniz yoxdur.', 'err');
      return;
    }
    var name = document.getElementById('new-terminal').value.trim();
    if (!name) {
      say('Terminal adını yazın.', 'err');
      return;
    }
    api('/api/terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waiterId: waiter.user.id, name: name })
    }).then(function () {
      document.getElementById('new-terminal').value = '';
      say(name + ' əlavə olundu.');
      return loadSettings();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('backup-pick').addEventListener('click', function () {
    if (!waiter) {
      say('PIN ilə daxil olun.', 'err');
      return;
    }
    say('Qovluq pəncərəsini gözləyin...');
    api('/api/backups/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waiterId: waiter.user.id })
    }).then(function (body) {
      if (body.data && body.data.cancelled) {
        say('Seçilmədi.', 'warn');
        return;
      }
      if (body.data && body.data.folder) {
        document.getElementById('backup-folder').value = body.data.folder;
        say('Yer seçildi. Yadda saxla və ya İndi nüsxə al.');
      }
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('backup-now').addEventListener('click', function () {
    if (!waiter) {
      say('PIN ilə daxil olun.', 'err');
      return;
    }
    api('/api/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waiterId: waiter.user.id,
        backupFolder: backupFolderValue()
      })
    }).then(function () {
      say('Nüsxə alındı. Qovluq açıldı.');
      loadBackups();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('logout').addEventListener('click', function () {
    setWaiter(null);
  });

  try {
    var saved = window.sessionStorage.getItem('posWaiter');
    if (saved) {
      setWaiter(JSON.parse(saved));
    } else {
      setWaiter(null);
    }
  } catch (error) {
    setWaiter(null);
  }
  window.addEventListener('pos-pin-changed', function () {
    if (waiter && canOpenSettings()) {
      loadSettings();
    }
  });
})();
