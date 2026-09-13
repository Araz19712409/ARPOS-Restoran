(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PosDom = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var n = el(id);
    if (n) {
      n.textContent = text == null ? '' : String(text);
    }
  }

  function setVal(id, val) {
    var n = el(id);
    if (n) {
      n.value = val == null ? '' : String(val);
    }
  }

  function text(node, value) {
    if (!node) {
      return;
    }
    node.textContent = value == null ? '' : String(value);
  }

  function fillOptions(select, list, toRow, first) {
    if (!select) {
      return;
    }
    select.textContent = '';
    if (first) {
      var blank = document.createElement('option');
      blank.value = first.value == null ? '' : String(first.value);
      blank.textContent = first.label == null ? '' : String(first.label);
      select.appendChild(blank);
    }
    (list || []).forEach(function (item) {
      var row = toRow ? toRow(item) : item;
      var opt = document.createElement('option');
      opt.value = row.value == null ? '' : String(row.value);
      opt.textContent = row.label == null ? '' : String(row.label);
      if (row.selected) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function kpis(el, rows, labelTag) {
    if (!el) {
      return;
    }
    el.textContent = '';
    var tag = labelTag === 'p' ? 'p' : 'span';
    (rows || []).forEach(function (row) {
      if (!row) {
        return;
      }
      var box = document.createElement('div');
      box.className = 'report-kpi';
      var lab = document.createElement(tag);
      lab.textContent = row.label == null ? '' : String(row.label);
      var strong = document.createElement('strong');
      strong.textContent = row.value == null ? '' : String(row.value);
      box.appendChild(lab);
      box.appendChild(strong);
      el.appendChild(box);
    });
  }

  return {
    escapeHtml: escapeHtml,
    el: el,
    setText: setText,
    setVal: setVal,
    text: text,
    fillOptions: fillOptions,
    kpis: kpis
  };
});
