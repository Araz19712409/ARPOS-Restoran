// Silmə və dəyişmə üçün kassa təsdiqi.
(function (global) {
  var askResolve = null;

  function canDelete() {
    return true;
  }

  function ensureAsk() {
    var el = document.getElementById('pos-ask');
    if (el) {
      return el;
    }
    el = document.createElement('div');
    el.id = 'pos-ask';
    el.className = 'pos-ask hidden';
    el.innerHTML =
      '<div class="pos-ask-card">' +
      '<h3 id="pos-ask-title"></h3>' +
      '<p id="pos-ask-text"></p>' +
      '<p id="pos-ask-extra" class="hint"></p>' +
      '<div class="modal-actions">' +
      '<button id="pos-ask-no" type="button">Xeyr</button>' +
      '<button id="pos-ask-yes" class="gold" type="button">Bəli</button>' +
      '</div></div>';
    document.body.appendChild(el);
    document.getElementById('pos-ask-no').addEventListener('click', function () {
      finishAsk(false);
    });
    document.getElementById('pos-ask-yes').addEventListener('click', function () {
      finishAsk(true);
    });
    return el;
  }

  function finishAsk(ok) {
    var el = document.getElementById('pos-ask');
    if (el) {
      el.classList.add('hidden');
    }
    var fn = askResolve;
    askResolve = null;
    if (fn) {
      fn(ok);
    }
  }

  function posAsk(title, text, extra, danger) {
    return new Promise(function (resolve) {
      askResolve = resolve;
      var el = ensureAsk();
      document.getElementById('pos-ask-title').textContent = title;
      document.getElementById('pos-ask-text').textContent = text;
      var more = document.getElementById('pos-ask-extra');
      more.textContent = extra || '';
      more.classList.toggle('hidden', !extra);
      el.classList.toggle('pos-ask-danger', !!danger);
      el.classList.remove('hidden');
    });
  }

  function askDelete(name, extra) {
    var more = extra ? extra + '\nBu əməliyyatı geri qaytarmaq olmaz.' : 'Bu əməliyyatı geri qaytarmaq olmaz.';
    return posAsk('Silmək', '"' + name + '" silinsin?', more, true);
  }

  function askChange(name) {
    return posAsk('Dəyişmək', '"' + name + '" dəyişilsin?', '', false);
  }

  function askYes(title, text) {
    return posAsk(title || 'Təsdiq', text, '', false);
  }

  var pinResolve = null;

  function finishPin(value) {
    var wrap = document.getElementById('pos-ask-pin');
    if (wrap) {
      wrap.classList.add('hidden');
    }
    var fn = pinResolve;
    pinResolve = null;
    if (fn) {
      fn(value);
    }
  }

  function ensurePinAsk() {
    var wrap = document.getElementById('pos-ask-pin');
    if (wrap) {
      return wrap;
    }
    wrap = document.createElement('div');
    wrap.id = 'pos-ask-pin';
    wrap.className = 'pos-ask hidden';
    wrap.innerHTML =
      '<form class="pos-ask-card" id="pos-ask-pin-form">' +
      '<h3 id="pos-ask-pin-title"></h3>' +
      '<p id="pos-ask-pin-text"></p>' +
      '<label>PIN<input id="pos-ask-pin-input" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>' +
      '<div class="modal-actions">' +
      '<button id="pos-ask-pin-no" type="button">Xeyr</button>' +
      '<button class="gold" type="submit">Bəli</button>' +
      '</div></form>';
    document.body.appendChild(wrap);
    document.getElementById('pos-ask-pin-no').addEventListener('click', function () {
      finishPin('');
    });
    document.getElementById('pos-ask-pin-form').addEventListener('submit', function (event) {
      event.preventDefault();
      finishPin(document.getElementById('pos-ask-pin-input').value);
    });
    return wrap;
  }

  function askPin(title, text) {
    return new Promise(function (resolve) {
      pinResolve = resolve;
      var wrap = ensurePinAsk();
      document.getElementById('pos-ask-pin-title').textContent = title || 'PIN';
      document.getElementById('pos-ask-pin-text').textContent = text || '';
      document.getElementById('pos-ask-pin-input').value = '';
      wrap.classList.add('pos-ask-danger');
      wrap.classList.remove('hidden');
      document.getElementById('pos-ask-pin-input').focus();
    });
  }

  global.askDelete = askDelete;
  global.askChange = askChange;
  global.askYes = askYes;
  global.askPin = askPin;
  global.canDelete = canDelete;
})(window);
