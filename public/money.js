(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PosMoney = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parseDec(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    var raw = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    if (!raw || raw === '.' || raw === '-' || raw === '-.') {
      return NaN;
    }
    var n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  function toMinor(azn) {
    var n = parseDec(azn);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.round(n * 100);
  }

  function fromMinor(minor) {
    return Math.round(Number(minor) || 0) / 100;
  }

  function addMinor(a, b) {
    return Math.round(Number(a) || 0) + Math.round(Number(b) || 0);
  }

  function subMinor(a, b) {
    return Math.round(Number(a) || 0) - Math.round(Number(b) || 0);
  }

  function mulQty(minorPrice, qty) {
    var p = Math.round(Number(minorPrice) || 0);
    var q = parseDec(qty);
    if (!Number.isFinite(q)) {
      return 0;
    }
    return Math.round(p * q);
  }

  return {
    parseDec: parseDec,
    toMinor: toMinor,
    fromMinor: fromMinor,
    addMinor: addMinor,
    subMinor: subMinor,
    mulQty: mulQty
  };
});
