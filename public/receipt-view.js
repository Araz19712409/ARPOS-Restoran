(function (global) {
  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function twoDigits(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function whenText(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return twoDigits(d.getDate()) + '.' + twoDigits(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + twoDigits(d.getHours()) + ':' + twoDigits(d.getMinutes());
  }

  function fill(root, order) {
    if (!root || !order) {
      return;
    }
    var pay = order.payment || {};
    var items = 0;
    var rows = '';
    (order.items || []).forEach(function (item) {
      if (item.voided) {
        return;
      }
      var line = Number(item.salePrice) * Number(item.qty);
      items += line;
      rows += '<div class="rc-row"><span></span><span></span></div>';
    });
    var service = Number(pay.serviceCharge) || 0;
    var itemsTotal = Number.isFinite(Number(pay.itemsTotal)) ? Number(pay.itemsTotal) : items;
    var discount = Number(pay.discountAmount) || 0;
    var tip = Number(pay.tipAmount) || Number(order.tipAmount) || 0;
    var gift = Number(pay.giftAmount) || (order.payments || []).reduce(function (sum, row) {
      return sum + Number(row.giftAmount || 0);
    }, 0);
    var total = Number(pay.total);
    if (!Number.isFinite(total) || total < 0.01) {
      total = itemsTotal - discount + service + tip;
    }
    var refunded = order.status === 'refunded' || !!order.refund;
    var branch = (order.branchName || pay.branchName || '').trim();
    root.innerHTML =
      '<p class="rc-brand">' + (branch || 'ÇEK') + '</p>' +
      '<p class="rc-id">#' + order.id + '</p>' +
      (refunded ? '<p class="rc-refund">QAYTARILIB</p>' : '') +
      '<p class="rc-meta"></p>' +
      '<p class="rc-meta"></p>' +
      '<p class="rc-meta"></p>' +
      '<div class="rc-lines"></div>' +
      '<div class="rc-sum"><span>Məhsul</span><strong></strong></div>' +
      '<div class="rc-sum"><span>Endirim</span><strong></strong></div>' +
      '<div class="rc-sum"><span>Xidmət' + (pay.servicePercent ? ' (' + pay.servicePercent + '%)' : '') +
      '</span><strong></strong></div>' +
      (tip > 0 ? '<div class="rc-sum"><span>Bəxşiş</span><strong></strong></div>' : '') +
      '<div class="rc-sum total"><span>Cəm</span><strong></strong></div>' +
      '<div class="rc-sum"><span>Bu ödəniş</span><strong></strong></div>' +
      '<div class="rc-sum"><span>Nağd</span><strong></strong></div>' +
      '<div class="rc-sum"><span>Kart</span><strong></strong></div>' +
      (gift > 0 ? '<div class="rc-sum"><span>Hədiyyə</span><strong></strong></div>' : '');

    var metas = root.querySelectorAll('.rc-meta');
    metas[0].textContent = 'Masa: ' + (order.tableName || order.tableId);
    metas[1].textContent = 'Ofisiant: ' + (pay.waiterName || order.waiterName || '');
    var when = whenText(pay.at || order.updatedAt);
    var voen = order.buyerVoen || pay.buyerVoen;
    metas[2].textContent = when + (voen ? ' • VÖEN ' + voen : '') +
      (order.buyerName || pay.buyerName ? ' • ' + (order.buyerName || pay.buyerName) : '');

    var box = root.querySelector('.rc-lines');
    box.innerHTML = '';
    (order.items || []).forEach(function (item) {
      if (item.voided) {
        return;
      }
      var row = document.createElement('div');
      row.className = 'rc-row';
      var left = document.createElement('span');
      left.textContent = item.qty + '× ' + item.name;
      var right = document.createElement('span');
      right.textContent = money(Number(item.salePrice) * Number(item.qty));
      row.appendChild(left);
      row.appendChild(right);
      box.appendChild(row);
      var marks = (item.modifiers || []).map(function (row) { return row.name; });
      if (item.note) {
        marks.push(item.note);
      }
      if (marks.length) {
        var extra = document.createElement('div');
        extra.className = 'rc-row';
        extra.innerHTML = '<span></span><span></span>';
        extra.querySelector('span').textContent = marks.join(', ');
        box.appendChild(extra);
      }
    });

    var sums = root.querySelectorAll('.rc-sum strong');
    sums[0].textContent = money(itemsTotal);
    sums[1].textContent = (discount ? '-' : '') + money(discount);
    sums[2].textContent = money(service);
    var at = 3;
    if (tip > 0) {
      sums[at].textContent = money(tip);
      at += 1;
    }
    sums[at].textContent = money(total) + ' AZN';
    sums[at + 1].textContent = money(Number(pay.share) ||
      (Number(pay.cashAmount || 0) + Number(pay.cardAmount || 0) + Number(gift || 0)));
    sums[at + 2].textContent = money(pay.cashAmount);
    sums[at + 3].textContent = money(pay.cardAmount);
    if (gift > 0) {
      sums[at + 4].textContent = money(gift);
    }
    if (pay.discountReason) {
      metas[2].textContent = whenText(pay.at || order.updatedAt) + ' • ' + pay.discountReason;
    }
    if (order.refund && order.refund.reason) {
      metas[2].textContent = (metas[2].textContent ? metas[2].textContent + ' • ' : '') +
        'Qaytarma: ' + order.refund.reason;
    }
    root.setAttribute('data-order', String(order.id));
  }

  function printNow(root) {
    if (!root) {
      window.print();
      return;
    }
    var iframe = document.getElementById('receipt-print-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'receipt-print-frame';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;top:0;opacity:0';
      document.body.appendChild(iframe);
    }
    var doc = iframe.contentDocument;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>ÇEK</title><style>' +
      '@page{size:80mm auto;margin:3mm}' +
      'html,body{margin:0;padding:0;width:74mm;background:#fff;color:#000}' +
      'body{font-family:"Courier New",Consolas,monospace;font-size:14px;line-height:1.35}' +
      '.rc-brand,.rc-id,.rc-refund{text-align:center;font-weight:800;margin:0 0 4px}' +
      '.rc-brand{font-size:20px}' +
      '.rc-id{font-size:18px}' +
      '.rc-refund{letter-spacing:0.04em}' +
      '.rc-meta{margin:0 0 3px;font-size:13px}' +
      '.rc-lines{border-top:1px dashed #000;border-bottom:1px dashed #000;margin:8px 0;padding:6px 0}' +
      '.rc-row,.rc-sum{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 4px}' +
      '.rc-row span:last-child,.rc-sum strong{white-space:nowrap;flex:0 0 auto}' +
      '.rc-row span:first-child,.rc-sum span{min-width:0}' +
      '.rc-sum.total{font-size:16px;font-weight:800;margin-top:6px}' +
      '</style></head><body>' + root.innerHTML + '</body></html>'
    );
    doc.close();
    setTimeout(function () {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 50);
  }

  global.ReceiptView = { fill: fill, printNow: printNow };
})(window);
