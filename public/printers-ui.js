(function () {
  var printers = [];
  var stations = [];
  var queue = [];
  var editingId = 0;
  var busy = false;

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

  // Stansiya adını tapırıq
  function stationName(id) {
    var station = stations.find(function (item) { return item.id === id; });
    return station ? station.name : 'Stansiya yoxdur';
  }

  // Son yoxlamanın vaxtını göstəririk
  function whenText(iso) {
    if (!iso) {
      return '';
    }
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return d.toLocaleString('az-AZ');
  }

  // Printerləri və stansiyaları yükləyirik
  function load() {
    return Promise.all([
      api('/api/printers'),
      api('/api/catalog'),
      api('/api/print-queue')
    ]).then(function (parts) {
      printers = parts[0].data.printers || [];
      stations = parts[1].data.stations || [];
      queue = parts[2].data || [];
      render();
      renderQueue();
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  function statusLabel(row) {
    if (row.status === 'fail') {
      return 'Uğursuz';
    }
    return 'Gözləyir';
  }

  function renderQueue() {
    var box = document.getElementById('queue-body');
    box.innerHTML = '';
    if (!queue.length) {
      box.innerHTML = '<tr><td colspan="5">Növbə boşdur.</td></tr>';
      return;
    }
    queue.forEach(function (row) {
      var tr = document.createElement('tr');
      var t1 = document.createElement('td');
      t1.textContent = row.title;
      var t2 = document.createElement('td');
      t2.textContent = row.tableName || '—';
      var t3 = document.createElement('td');
      t3.textContent = row.tries + ' / ' + row.maxTries;
      var t4 = document.createElement('td');
      t4.textContent = statusLabel(row) + (row.lastError ? ' — ' + row.lastError : '');
      var t5 = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'İndi göndər';
      btn.addEventListener('click', function () {
        api('/api/print-queue/' + row.id + '/retry', { method: 'POST' }).then(function (body) {
          queue = body.data || [];
          renderQueue();
          say('Növbə göndərildi.');
        }).catch(function (error) {
          say(error.message, 'err');
        });
      });
      t5.appendChild(btn);
      tr.appendChild(t1);
      tr.appendChild(t2);
      tr.appendChild(t3);
      tr.appendChild(t4);
      tr.appendChild(t5);
      box.appendChild(tr);
    });
  }

  // Stansiya siyahısını forma üçün doldururuq
  function fillStations(selectedId) {
    var select = document.getElementById('printer-station');
    window.PosDom.fillOptions(select, stations, function (station) {
      return {
        value: station.id,
        label: station.name,
        selected: station.id === selectedId
      };
    });
  }

  // Rol dəyişəndə stansiya sahəsini göstəririk
  function syncRole() {
    var receipt = document.getElementById('printer-role').value === 'receipt';
    document.getElementById('station-wrap').style.display = receipt ? 'none' : '';
  }

  // Printer kartlarını çəkirik
  function render() {
    var grid = document.getElementById('printer-grid');
    grid.innerHTML = '';
    if (!printers.length) {
      grid.innerHTML = '<div class="empty-card">Hələ printer yoxdur. IP ünvanı ilə əlavə edin.</div>';
      return;
    }

    printers.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'printer-card';

      var status = 'unknown';
      var statusText = 'Yoxlanmayıb';
      if (!item.enabled) {
        status = 'off';
        statusText = 'Sönülü';
      } else if (item.lastCheck) {
        status = item.lastCheck.ok ? 'ok' : 'bad';
        statusText = item.lastCheck.ok ? 'Qoşulub' : 'Xəta';
      }

      var roleText = item.role === 'receipt' ? 'Kassa çeki' : stationName(item.stationId);
      if (item.isBackup && item.role === 'station') {
        roleText += ' • ehtiyat';
      }

      var check = item.lastCheck
        ? (item.lastCheck.message + (item.lastCheck.ms != null ? ' (' + item.lastCheck.ms + ' ms)' : '') + '\n' + whenText(item.lastCheck.at))
        : 'Hələ yoxlanmayıb.';

      card.innerHTML =
        '<div class="printer-head"><div><h3></h3><p class="meta"></p></div><span class="status"></span></div>' +
        '<p class="meta ip"></p><p class="check-note"></p><div class="card-actions"></div>';
      card.querySelector('h3').textContent = item.name;
      card.querySelector('.meta').textContent = roleText;
      card.querySelector('.status').className = 'status ' + status;
      card.querySelector('.status').textContent = statusText;
      var ipLine = card.querySelector('.ip');
      ipLine.textContent = '';
      var host = document.createElement('b');
      host.textContent = item.host + ':' + item.port;
      ipLine.appendChild(host);
      ipLine.appendChild(document.createTextNode(
        ' • ' + item.paperWidth + ' mm • ' +
        (item.charsPerLine || (item.paperWidth === 58 ? 32 : 48)) + ' simvol • ' +
        item.copies + ' nüsxə'
      ));
      card.querySelector('.check-note').textContent = check;

      var actions = card.querySelector('.card-actions');
      [
        ['Yoxla', function () { runTest(item, 'test-connection'); }],
        ['Test çap', function () { runTest(item, 'test-print'); }],
        ['Dəyiş', function () { openModal(item); }],
        ['Sil', function () { removePrinter(item); }]
      ].forEach(function (pair) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = pair[0];
        btn.addEventListener('click', pair[1]);
        actions.appendChild(btn);
      });

      grid.appendChild(card);
    });
  }

  function sendTest(item, kind) {
    if (busy) {
      return;
    }
    busy = true;
    say(kind === 'test-print' ? 'Test çapı göndərilir...' : 'Qoşulma yoxlanır...');
    api('/api/printers/' + item.id + '/' + kind, { method: 'POST' })
      .then(function (body) {
        var result = body.data && body.data.result;
        say(result ? result.message : 'Hazırdır');
        return load();
      })
      .catch(function (error) {
        say(error.message, 'err');
        return load();
      })
      .then(function () {
        busy = false;
      });
  }

  function runTest(item, kind) {
    if (kind === 'test-print') {
      window.askYes('Test çapı', '"' + item.name + '" printerinə test çeki göndərilsin?').then(function (ok) {
        if (ok) {
          sendTest(item, kind);
        }
      });
      return;
    }
    sendTest(item, kind);
  }

  // Printeri silirik
  function removePrinter(item) {
    window.askDelete(item.name, 'Bu printer stansiyadan ayrılacaq.').then(function (ok) {
      if (!ok) {
        return;
      }
      return api('/api/printers/' + item.id, { method: 'DELETE' })
        .then(load);
    }).catch(function (error) {
      say(error.message, 'err');
    });
  }

  // Forma pəncərəsini açırıq
  function openModal(item) {
    editingId = item ? item.id : 0;
    document.getElementById('modal-title').textContent = item ? 'Printeri dəyiş' : 'Yeni printer';
    document.getElementById('printer-name').value = item ? item.name : '';
    document.getElementById('printer-host').value = item ? item.host : '';
    document.getElementById('printer-port').value = item ? item.port : 9100;
    document.getElementById('printer-role').value = item ? item.role : 'station';
    document.getElementById('printer-paper').value = item ? String(item.paperWidth) : '80';
    document.getElementById('printer-copies').value = item ? String(item.copies) : '1';
    document.getElementById('printer-chars').value = item
      ? String(item.charsPerLine || (item.paperWidth === 58 ? 32 : 48))
      : '48';
    document.getElementById('printer-margin').value = item ? String(item.leftMargin || 0) : '0';
    document.getElementById('printer-font').value = item && item.font === 'B' ? 'B' : 'A';
    document.getElementById('printer-big-title').checked = item ? Boolean(item.bigTitle) : false;
    document.getElementById('printer-backup').checked = item ? Boolean(item.isBackup) : false;
    document.getElementById('printer-enabled').checked = item ? item.enabled !== false : true;
    fillStations(item ? item.stationId : (stations[0] && stations[0].id));
    syncRole();
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('printer-name').focus();
  }

  function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    editingId = 0;
  }

  document.getElementById('printer-role').addEventListener('change', syncRole);
  document.getElementById('add-printer').addEventListener('click', function () {
    openModal(null);
  });
  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  document.getElementById('printer-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    var payload = {
      name: document.getElementById('printer-name').value,
      host: document.getElementById('printer-host').value,
      port: Number(document.getElementById('printer-port').value),
      role: document.getElementById('printer-role').value,
      stationId: Number(document.getElementById('printer-station').value),
      paperWidth: Number(document.getElementById('printer-paper').value),
      copies: Number(document.getElementById('printer-copies').value),
      charsPerLine: Number(document.getElementById('printer-chars').value),
      leftMargin: Number(document.getElementById('printer-margin').value),
      font: document.getElementById('printer-font').value,
      bigTitle: document.getElementById('printer-big-title').checked,
      isBackup: document.getElementById('printer-backup').checked,
      enabled: document.getElementById('printer-enabled').checked
    };
    function sendPrinter() {
      busy = true;
      api(editingId ? '/api/printers/' + editingId : '/api/printers', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function () {
        closeModal();
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
          sendPrinter();
        }
      });
      return;
    }
    sendPrinter();
  });

  document.getElementById('flush-queue').addEventListener('click', function () {
    api('/api/print-queue/flush', { method: 'POST' }).then(function (body) {
      queue = body.data || [];
      renderQueue();
      say(queue.length ? 'Növbə yenidən göndərilir.' : 'Növbə boşdur.');
    }).catch(function (error) {
      say(error.message, 'err');
    });
  });

  document.getElementById('check-all').addEventListener('click', function () {
    if (busy || !printers.length) {
      return;
    }
    busy = true;
    say('Bütün printerlər yoxlanır...');
    var chain = Promise.resolve();
    printers.forEach(function (item) {
      chain = chain.then(function () {
        return api('/api/printers/' + item.id + '/test-connection', { method: 'POST' }).catch(function () {
          return null;
        });
      });
    });
    chain.then(function () {
      return load();
    }).then(function () {
      say('Yoxlama bitdi.');
      busy = false;
    });
  });

  load();
  setInterval(function () {
    api('/api/print-queue').then(function (body) {
      queue = body.data || [];
      renderQueue();
    }).catch(function () {
      return null;
    });
  }, 15000);

  document.getElementById('logout').addEventListener('click', function () {
    if (window.PosNav) {
      window.PosNav.forget();
    }
    window.sessionStorage.removeItem('posWaiter');
    window.location.replace('/orders.html');
  });
})();
