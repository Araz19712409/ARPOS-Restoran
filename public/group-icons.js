(function (global) {
  var GOLD = '#e2b65a';

  var LABELS = {
    meal: 'Yemək',
    snack: 'Qəlyanaltı',
    drink: 'Şərab',
    coffee: 'Kofe',
    beer: 'Pivə',
    cocktail: 'Kokteyl',
    dessert: 'Desert',
    ice: 'Dondurma',
    grill: 'Manqal',
    pizza: 'Pizza',
    hookah: 'Qəlyan',
    soup: 'Şorba',
    fish: 'Balıq',
    salad: 'Salat',
    bread: 'Çörək'
  };

  var ICONS = {
    meal: '<path d="M18 6c1 0 2 .9 2 2v16h2V8c0-1.1.9-2 2-2s2 .9 2 2v16h2V8c0-1.1.9-2 2-2s2 .9 2 2v18c0 3.2-1.8 5.4-4.5 6.3V58h-5V32.3C15.8 31.4 14 29.2 14 26V8c0-1.1.9-2 2-2s2 .9 2 2v16h2V8c0-1.1.9-2 2-2zm28 4c7 9 9 20 7 32h-6c1.6-10.8.2-20-6-28.8L46 10zM42 44h7v14h-7V44z"/>',
    snack: '<path d="M8 30h48c-2.2 15.4-11 26-24 26S10.2 45.4 8 30zm6-3c3.2-11 9.2-17 18-17s14.8 6 18 17H14z"/><circle cx="24" cy="28" r="3.2"/><circle cx="32" cy="23.5" r="3.2"/><circle cx="41" cy="28" r="3.2"/>',
    drink: '<path d="M20 6h24c0 13.5-7.4 21.6-12 24.6V50h8v6H24v-6h8V30.6C27.4 27.6 20 19.5 20 6z"/>',
    coffee: '<path d="M14 16h28v22c0 8.5-7 15-14 15s-14-6.5-14-15V16z"/><path d="M42 22h7c4.5 2 7 7 7 12s-2.5 10-7 12h-7V22z"/><rect x="12" y="10" width="32" height="7" rx="2"/>',
    beer: '<path d="M14 14h26v32c0 7-5 12-13 12s-13-5-13-12V14z"/><path d="M40 20h8c4 3 5 12 1 20h-9V20z"/><path d="M16 8h22v7H16z"/>',
    cocktail: '<path d="M12 8h40L34 30v18h8v5H22v-5h8V30L12 8z"/><circle cx="42" cy="14" r="3.2"/>',
    dessert: '<path d="M32 5c1.4 6.5 8 8.2 8 15 0 4.4-3.1 7.5-7 7.5S26 24.4 26 20c0-4.8 4.6-9 6-15z"/><path d="M12 30h40l-4.2 18H16.2L12 30zM8 50h48v7H8v-7z"/>',
    ice: '<circle cx="32" cy="18" r="12"/><path d="M22 28h20l-10 28z"/>',
    grill: '<path d="M32 6c1.6 8 12 14.2 12 26.2A12 12 0 1 1 20 32.2C20 22 27 16 28 10c0 6 4 9 4 9 0-7-1.4-10 0-13z"/><rect x="14" y="50" width="36" height="4" rx="1"/><rect x="18" y="55" width="28" height="4" rx="1"/>',
    pizza: '<path d="M32 8c13.2 3.6 22.6 14.8 24.8 28.2L32 56 7.2 36.2C9.4 22.8 18.8 11.6 32 8z"/><circle cx="32" cy="26" r="4.2" fill="#2a241c"/><circle cx="22" cy="36" r="3.4" fill="#2a241c"/><circle cx="40" cy="38" r="3.4" fill="#2a241c"/>',
    hookah: '<path d="M29 6h10v5h-3v7.2c7.4 2.2 11 8 11 15.8 0 6.4-3.6 12-10 14.4V58h-8v-9.6C22.6 46 19 40.4 19 34c0-7.8 3.6-13.6 11-15.8V11h-3V6zm6 18.6c-5.2 1-7.4 4.6-7.4 9.4s2.6 8.6 7.4 9.4 7.4-4 7.4-9.4-2.2-8.4-7.4-9.4z"/><path d="M22 46c-6.4 3.6-10 9.4-8.2 14h7.4c-1.6-3.8.4-7.8 4.2-10.2L22 46z"/>',
    soup: '<path d="M8 34h48c-2.4 15-12 24-24 24S10.4 49 8 34z"/><path d="M22 12c0 8 4 12 4 14M32 8c0 10 4 14 4 16M42 12c0 8-3 12-3 14" fill="none" stroke="' + GOLD + '" stroke-width="3" stroke-linecap="round"/>',
    fish: '<path d="M8 32c12-14 24-14 34-6 4 0 8-6 14-10-4 8-4 16 0 24-6-4-10-8-14-8-10 8-22 8-34-0z"/><circle cx="18" cy="30" r="2.6" fill="#2a241c"/>',
    salad: '<path d="M10 36c2.2 14 11 22 22 22s19.8-8 22-22H10z"/><path d="M18 22c-2 8 4 14 12 12 1-8 8-12 12-8 0-10-8-18-16-16-6 0-10 6-8 12z"/><path d="M38 16c8-4 16 4 12 14-6 2-12-2-14-8 0-4 0-6 2-6z"/>',
    bread: '<path d="M12 28c0-12 8-18 20-18s20 6 20 18v16c0 5-5 10-14 10H26c-9 0-14-5-14-10V28z"/><path d="M22 24c6-3 14-3 20 0" fill="none" stroke="#2a241c" stroke-width="2.4" stroke-linecap="round"/><path d="M22 34c6-3 14-3 20 0" fill="none" stroke="#2a241c" stroke-width="2.4" stroke-linecap="round"/>'
  };

  function fold(value) {
    return String(value || '')
      .replace(/İ/g, 'i')
      .toLocaleLowerCase('az')
      .replace(/\u0307/g, '')
      .replace(/ə/g, 'e')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/ğ/g, 'g')
      .replace(/ş/g, 's')
      .replace(/ç/g, 'c');
  }

  function kind(name) {
    if (name && typeof name === 'object') {
      if (name.icon && ICONS[name.icon]) {
        return name.icon;
      }
      name = name.name;
    }
    var n = fold(name);
    if (/dondurma|ice/.test(n)) {
      return 'ice';
    }
    if (/desert|sirni|tort|pasta|kek|cake|sweet/.test(n)) {
      return 'dessert';
    }
    if (/qelyanalti|snack|appet/.test(n)) {
      return 'snack';
    }
    if (/salat/.test(n)) {
      return 'salad';
    }
    if (/soyuq/.test(n)) {
      return 'snack';
    }
    if (/(^|[^a-z])qelyan([^a-z]|$)/.test(n) || n.indexOf('hookah') !== -1) {
      return 'hookah';
    }
    if (/kofe|coffee|cay/.test(n)) {
      return 'coffee';
    }
    if (/piv|beer/.test(n)) {
      return 'beer';
    }
    if (/kokteyl|cocktail/.test(n)) {
      return 'cocktail';
    }
    if (/serab|wine/.test(n)) {
      return 'drink';
    }
    if (/icki|bar|araq|sok|limonad|drink/.test(n)) {
      return 'drink';
    }
    if (/manqal|kabab|grill|steak|mangal/.test(n)) {
      return 'grill';
    }
    if (/pizza/.test(n)) {
      return 'pizza';
    }
    if (/sorba|soup/.test(n)) {
      return 'soup';
    }
    if (/baliq|fish/.test(n)) {
      return 'fish';
    }
    if (/corek|bread|coreyi/.test(n)) {
      return 'bread';
    }
    return 'meal';
  }

  function wrap(inner) {
    return '<svg class="group-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="' +
      GOLD + '" aria-hidden="true">' + inner + '</svg>';
  }

  function resolve(value) {
    if (value && typeof value === 'object') {
      if (value.icon && ICONS[value.icon]) {
        return value.icon;
      }
      return kind(value.name);
    }
    var key = String(value || '');
    if (ICONS[key]) {
      return key;
    }
    return kind(key);
  }

  function svg(id) {
    var key = ICONS[id] ? id : 'meal';
    return wrap(ICONS[key]);
  }

  function list() {
    return Object.keys(ICONS).map(function (id) {
      return { id: id, label: LABELS[id] || id, svg: wrap(ICONS[id]) };
    });
  }

  function mount(el, value) {
    if (!el) {
      return;
    }
    var id = resolve(value);
    if (!ICONS[id]) {
      id = 'meal';
    }
    el.innerHTML = svg(id);
  }

  global.PosGroupIcons = { mount: mount, list: list, resolve: resolve, svg: svg };
})(window);
