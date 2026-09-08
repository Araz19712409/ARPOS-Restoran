(function () {
  var MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
    'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
  var MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn',
    'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek'];
  var WEEK = ['B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş', 'B'];

  var modal = null;
  var view = null;
  var pick = null;
  var hour = 19;
  var minute = 0;
  var onDone = null;
  var kind = 'date';

  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function parseYmd(value) {
    var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      return null;
    }
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function parseMonth(value) {
    var m = String(value || '').match(/^(\d{4})-(\d{2})/);
    if (!m) {
      return null;
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  }

  function parseDateTime(value) {
    var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) {
      return null;
    }
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function ymd(d) {
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function ym(d) {
    return d.getFullYear() + '-' + two(d.getMonth() + 1);
  }

  function ymdhm(d) {
    return ymd(d) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function prettyDay(value) {
    var d = parseYmd(value);
    if (!d) {
      return 'Tarix seçin';
    }
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function prettyMonth(value) {
    var d = parseMonth(value);
    if (!d) {
      return 'Ay seçin';
    }
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function prettyDateTime(value) {
    var d = parseDateTime(value) || parseYmd(value);
    if (!d) {
      return 'Vaxt seçin';
    }
    return prettyDay(ymd(d)) + '  ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function labelFor(input) {
    var type = input.getAttribute('type');
    if (type === 'month') {
      return prettyMonth(input.value);
    }
    if (type === 'datetime-local') {
      return prettyDateTime(input.value);
    }
    return prettyDay(input.value);
  }

  function refresh(input) {
    if (input && input._posDateBtn) {
      input._posDateBtn.textContent = labelFor(input);
    }
  }

  function setInput(input, value) {
    input.value = value;
    refresh(input);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function ensureModal() {
    if (modal) {
      return;
    }
    modal = document.createElement('div');
    modal.id = 'pos-date-modal';
    modal.className = 'modal hidden';
    modal.innerHTML =
      '<div class="modal-card">' +
      '<div class="pos-cal-head">' +
      '<button type="button" id="pos-cal-prev">‹</button>' +
      '<strong id="pos-cal-title"></strong>' +
      '<button type="button" id="pos-cal-next">›</button>' +
      '</div>' +
      '<div id="pos-cal-quick" class="pos-cal-quick"></div>' +
      '<div id="pos-cal-week" class="pos-cal-week"></div>' +
      '<div id="pos-cal-days" class="pos-cal-days"></div>' +
      '<div id="pos-cal-months" class="pos-cal-months hidden"></div>' +
      '<p id="pos-cal-hint" class="pos-cal-hint"></p>' +
      '<div id="pos-cal-hours" class="pos-cal-hours hidden"></div>' +
      '<div id="pos-cal-mins" class="pos-cal-mins hidden"></div>' +
      '<div class="modal-actions">' +
      '<button id="pos-cal-today" type="button">Bu gün</button>' +
      '<button id="pos-cal-cancel" type="button">Bağla</button>' +
      '<button id="pos-cal-ok" class="gold" type="button">Seç</button>' +
      '</div></div>';
    document.body.appendChild(modal);
    WEEK.forEach(function (name) {
      var el = document.createElement('span');
      el.textContent = name;
      modal.querySelector('#pos-cal-week').appendChild(el);
    });
    modal.addEventListener('click', function (event) {
      if (event.target === modal) {
        close();
      }
    });
    document.getElementById('pos-cal-prev').addEventListener('click', function () {
      if (kind === 'month') {
        view.setFullYear(view.getFullYear() - 1);
      } else {
        view.setMonth(view.getMonth() - 1);
      }
      draw();
    });
    document.getElementById('pos-cal-next').addEventListener('click', function () {
      if (kind === 'month') {
        view.setFullYear(view.getFullYear() + 1);
      } else {
        view.setMonth(view.getMonth() + 1);
      }
      draw();
    });
    document.getElementById('pos-cal-today').addEventListener('click', function () {
      var now = new Date();
      pick = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      view = new Date(pick);
      if (kind === 'datetime') {
        hour = now.getHours();
        minute = Math.ceil(now.getMinutes() / 15) * 15;
        if (minute >= 60) {
          minute = 0;
          hour += 1;
        }
      }
      if (kind === 'date') {
        finish();
        return;
      }
      draw();
    });
    document.getElementById('pos-cal-cancel').addEventListener('click', close);
    document.getElementById('pos-cal-ok').addEventListener('click', finish);
  }

  function finish() {
    if (!pick || !onDone) {
      return;
    }
    if (kind === 'month') {
      onDone(ym(pick));
    } else if (kind === 'datetime') {
      pick.setHours(hour, minute, 0, 0);
      onDone(ymdhm(pick));
    } else {
      onDone(ymd(pick));
    }
    close();
  }

  function close() {
    if (modal) {
      modal.classList.add('hidden');
    }
    onDone = null;
  }

  function draw() {
    if (!modal) {
      return;
    }
    var title = document.getElementById('pos-cal-title');
    var daysBox = document.getElementById('pos-cal-days');
    var weekBox = document.getElementById('pos-cal-week');
    var monthsBox = document.getElementById('pos-cal-months');
    var hoursBox = document.getElementById('pos-cal-hours');
    var minsBox = document.getElementById('pos-cal-mins');
    var quickBox = document.getElementById('pos-cal-quick');
    var hint = document.getElementById('pos-cal-hint');
    var todayBtn = document.getElementById('pos-cal-today');
    todayBtn.style.display = kind === 'month' ? 'none' : '';
    monthsBox.classList.toggle('hidden', kind !== 'month');
    weekBox.classList.toggle('hidden', kind === 'month');
    daysBox.classList.toggle('hidden', kind === 'month');
    hoursBox.classList.toggle('hidden', kind !== 'datetime');
    minsBox.classList.toggle('hidden', kind !== 'datetime');
    quickBox.classList.toggle('hidden', kind !== 'datetime');

    if (kind === 'month') {
      title.textContent = String(view.getFullYear());
      hint.textContent = 'Ayı seçin.';
      monthsBox.innerHTML = '';
      MONTHS_SHORT.forEach(function (name, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = name;
        if (pick && pick.getFullYear() === view.getFullYear() && pick.getMonth() === i) {
          btn.className = 'active';
        }
        btn.addEventListener('click', function () {
          pick = new Date(view.getFullYear(), i, 1);
          finish();
        });
        monthsBox.appendChild(btn);
      });
      return;
    }

    title.textContent = MONTHS[view.getMonth()] + ' ' + view.getFullYear();
    hint.textContent = kind === 'datetime' ? 'Günü, sonra saatı seçin.' : 'Günü seçin.';
    daysBox.innerHTML = '';
    var start = new Date(view.getFullYear(), view.getMonth(), 1);
    var pad = (start.getDay() + 6) % 7;
    var cursor = new Date(start);
    cursor.setDate(1 - pad);
    var today = new Date();
    for (var i = 0; i < 42; i += 1) {
      var day = new Date(cursor);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(day.getDate());
      if (day.getMonth() !== view.getMonth()) {
        btn.className = 'mute';
      }
      if (pick && ymd(day) === ymd(pick)) {
        btn.className = (btn.className + ' active').trim();
      }
      if (ymd(day) === ymd(today) && (!pick || ymd(pick) !== ymd(today))) {
        btn.style.borderColor = '#e2b65a';
      }
      btn.addEventListener('click', function (hold) {
        return function () {
          pick = hold;
          view = new Date(hold.getFullYear(), hold.getMonth(), 1);
          if (kind === 'date') {
            finish();
            return;
          }
          draw();
        };
      }(day));
      daysBox.appendChild(btn);
      cursor.setDate(cursor.getDate() + 1);
    }

    if (kind === 'datetime') {
      quickBox.innerHTML = '';
      [
        { t: 'İndi', fn: function () { var n = new Date(); return n; } },
        { t: '+30 dəq', fn: function () { return new Date(Date.now() + 30 * 60000); } },
        { t: '+1 saat', fn: function () { return new Date(Date.now() + 60 * 60000); } },
        { t: '19:00', fn: function () { var n = new Date(); n.setHours(19, 0, 0, 0); return n; } }
      ].forEach(function (row) {
        var q = document.createElement('button');
        q.type = 'button';
        q.textContent = row.t;
        q.addEventListener('click', function () {
          var n = row.fn();
          pick = new Date(n.getFullYear(), n.getMonth(), n.getDate());
          view = new Date(pick);
          hour = n.getHours();
          minute = n.getMinutes();
          if (row.t.indexOf('+') === 0 || row.t === 'İndi') {
            minute = Math.ceil(minute / 15) * 15;
            if (minute >= 60) {
              minute = 0;
              hour += 1;
            }
          }
          draw();
        });
        quickBox.appendChild(q);
      });
      hoursBox.innerHTML = '';
      for (var h = 8; h <= 23; h += 1) {
        var hb = document.createElement('button');
        hb.type = 'button';
        hb.textContent = two(h);
        if (h === hour) {
          hb.className = 'active';
        }
        hb.addEventListener('click', function (val) {
          return function () {
            hour = val;
            draw();
          };
        }(h));
        hoursBox.appendChild(hb);
      }
      minsBox.innerHTML = '';
      [0, 15, 30, 45].forEach(function (m) {
        var mb = document.createElement('button');
        mb.type = 'button';
        mb.textContent = ':' + two(m);
        if (m === minute) {
          mb.className = 'active';
        }
        mb.addEventListener('click', function () {
          minute = m;
          finish();
        });
        minsBox.appendChild(mb);
      });
    }
  }

  function openPicker(type, current, done) {
    ensureModal();
    kind = type;
    onDone = done;
    var now = new Date();
    if (type === 'month') {
      pick = parseMonth(current) || new Date(now.getFullYear(), now.getMonth(), 1);
      view = new Date(pick);
    } else if (type === 'datetime') {
      var dt = parseDateTime(current);
      pick = dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      view = new Date(pick.getFullYear(), pick.getMonth(), 1);
      hour = dt ? dt.getHours() : 19;
      minute = dt ? dt.getMinutes() : 0;
    } else {
      pick = parseYmd(current) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
      view = new Date(pick.getFullYear(), pick.getMonth(), 1);
    }
    draw();
    modal.classList.remove('hidden');
  }

  function wrap(input, type) {
    if (!input || input.dataset.posDate === '1') {
      return;
    }
    input.dataset.posDate = '1';
    input.classList.add('pos-date-native');
    var wrapEl = document.createElement('span');
    wrapEl.className = 'pos-date-wrap';
    input.parentNode.insertBefore(wrapEl, input);
    wrapEl.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pos-date-btn';
    btn.textContent = labelFor(input);
    wrapEl.appendChild(btn);
    input._posDateBtn = btn;
    btn.addEventListener('click', function () {
      openPicker(type, input.value, function (value) {
        setInput(input, value);
      });
    });
  }

  function enhanceAll() {
    document.querySelectorAll('input[type="date"]').forEach(function (el) {
      wrap(el, 'date');
    });
    document.querySelectorAll('input[type="datetime-local"]').forEach(function (el) {
      wrap(el, 'datetime');
    });
    document.querySelectorAll('input[type="month"]').forEach(function (el) {
      wrap(el, 'month');
    });
  }

  function applyPreset(fromEl, toEl, key) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var from = new Date(today);
    var to = new Date(today);
    if (key === 'yesterday') {
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
    } else if (key === 'days7') {
      from.setDate(from.getDate() - 6);
    } else if (key === 'week') {
      var day = from.getDay();
      from.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
    } else if (key === 'month') {
      from.setDate(1);
    } else if (key === 'lastmonth') {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
    }
    fromEl.value = ymd(from);
    toEl.value = ymd(to);
    refresh(fromEl);
    refresh(toEl);
  }

  function fillSoon(input, addMin) {
    var n = new Date(Date.now() + (Number(addMin) || 60) * 60000);
    var m = Math.ceil(n.getMinutes() / 15) * 15;
    if (m >= 60) {
      m = 0;
      n.setHours(n.getHours() + 1);
    }
    n.setMinutes(m, 0, 0);
    setInput(input, ymdhm(n));
  }

  window.PosDates = {
    refresh: refresh,
    enhanceAll: enhanceAll,
    applyPreset: applyPreset,
    fillSoon: fillSoon,
    prettyDay: prettyDay
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceAll);
  } else {
    enhanceAll();
  }
})();
