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

  function addText(parent, className, text) {
    if (!text) {
      return;
    }
    var p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    parent.appendChild(p);
  }

  function receiptTitle(order) {
    var r = (order && order.receipt) || {};
    var title = String(r.title || '').trim();
    if (title) {
      return title;
    }
    var branch = String((order && (order.branchName || (order.payment && order.payment.branchName))) || '').trim();
    return branch || 'Arpos Restoran';
  }

  function receiptLogoUrl(order) {
    var r = (order && order.receipt) || {};
    var url = String(r.logoUrl || r.logo || '').trim();
    if (!url || url.indexOf('/uploads/receipt-logo.') !== 0) {
      return '';
    }
    if (r.hasLogo === false) {
      return '';
    }
    return url;
  }

  function fill(root, order) {
    if (!root || !order) {
      return;
    }
    var pay = order.payment || {};
    var receipt = order.receipt || {};
    var items = 0;
    (order.items || []).forEach(function (item) {
      if (item.voided) {
        return;
      }
      items += Number(item.salePrice) * Number(item.qty);
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
    root.textContent = '';
    var logo = receiptLogoUrl(order);
    if (logo) {
      var img = document.createElement('img');
      img.className = 'rc-logo';
      img.alt = '';
      img.src = logo;
      root.appendChild(img);
    }
    addText(root, 'rc-brand', receiptTitle(order));
    addText(root, 'rc-sub', receipt.address);
    addText(root, 'rc-sub', receipt.phone);
    if (receipt.showBranchCode && order.branchCode) {
      addText(root, 'rc-sub', 'Filial: ' + order.branchCode);
    }
    (Array.isArray(receipt.headerLines) ? receipt.headerLines : []).forEach(function (row) {
      addText(root, 'rc-sub', row);
    });
    addText(root, 'rc-id', '#' + order.id);
    if (refunded) {
      addText(root, 'rc-refund', 'QAYTARILIB');
    }
    addText(root, 'rc-meta', 'Masa: ' + (order.tableName || order.tableId));
    addText(root, 'rc-meta', 'Ofisiant: ' + (pay.waiterName || order.waiterName || ''));
    var when = whenText(pay.at || order.updatedAt);
    var voen = order.buyerVoen || pay.buyerVoen;
    var meta3 = when + (voen ? ' • VÖEN ' + voen : '') +
      (order.buyerName || pay.buyerName ? ' • ' + (order.buyerName || pay.buyerName) : '');
    if (pay.discountReason) {
      meta3 = whenText(pay.at || order.updatedAt) + ' • ' + pay.discountReason;
    }
    if (order.refund && order.refund.reason) {
      meta3 = (meta3 ? meta3 + ' • ' : '') + 'Qaytarma: ' + order.refund.reason;
    }
    addText(root, 'rc-meta', meta3);

    var box = document.createElement('div');
    box.className = 'rc-lines';
    root.appendChild(box);
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
      var marks = (item.modifiers || []).map(function (mod) { return mod.name; });
      if (item.note) {
        marks.push(item.note);
      }
      if (marks.length) {
        var extra = document.createElement('div');
        extra.className = 'rc-row';
        var markLeft = document.createElement('span');
        markLeft.textContent = marks.join(', ');
        extra.appendChild(markLeft);
        extra.appendChild(document.createElement('span'));
        box.appendChild(extra);
      }
    });

    function addSum(label, value, totalClass) {
      var row = document.createElement('div');
      row.className = 'rc-sum' + (totalClass ? ' total' : '');
      var span = document.createElement('span');
      span.textContent = label;
      var strong = document.createElement('strong');
      strong.textContent = value;
      row.appendChild(span);
      row.appendChild(strong);
      root.appendChild(row);
    }

    addSum('Məhsul', money(itemsTotal));
    addSum('Endirim', (discount ? '-' : '') + money(discount));
    addSum('Xidmət' + (pay.servicePercent ? ' (' + pay.servicePercent + '%)' : ''), money(service));
    if (tip > 0) {
      addSum('Bəxşiş', money(tip));
    }
    addSum('Cəm', money(total) + ' AZN', true);
    addSum('Bu ödəniş', money(Number(pay.share) ||
      (Number(pay.cashAmount || 0) + Number(pay.cardAmount || 0) + Number(gift || 0))));
    addSum('Nağd', money(pay.cashAmount));
    addSum('Kart', money(pay.cardAmount));
    if (gift > 0) {
      addSum('Hədiyyə', money(gift));
    }

    var footers = Array.isArray(receipt.footerLines) ? receipt.footerLines.filter(Boolean) : [];
    if (footers.length) {
      footers.forEach(function (row) {
        addText(root, 'rc-foot', row);
      });
    } else {
      addText(root, 'rc-foot', 'Təşəkkür edirik');
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
      '.rc-logo{display:block;max-width:48mm;max-height:28mm;width:auto;height:auto;margin:0 auto 6px;object-fit:contain}' +
      '.rc-brand,.rc-id,.rc-refund,.rc-sub,.rc-foot{text-align:center;margin:0 0 4px}' +
      '.rc-brand{font-size:20px;font-weight:800}' +
      '.rc-id{font-size:18px;font-weight:800}' +
      '.rc-sub,.rc-foot{font-size:12px}' +
      '.rc-refund{letter-spacing:0.04em;font-weight:800}' +
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
})(typeof window !== 'undefined' ? window : globalThis);
