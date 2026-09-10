(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PosOffline = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function snapPath(url) {
    return String(url || '').split('?')[0];
  }

  function isCacheGet(method, url) {
    if (String(method || 'GET').toUpperCase() !== 'GET') {
      return false;
    }
    var p = snapPath(url);
    return p === '/api/layout' || p === '/api/catalog' || p === '/api/orders' ||
      p === '/api/waitlist' || p === '/api/terminals';
  }

  function shouldQueue(method, url) {
    var m = String(method || 'GET').toUpperCase();
    if (m !== 'POST' && m !== 'PUT') {
      return false;
    }
    var p = snapPath(url);
    if (p === '/api/clock') {
      return true;
    }
    return /\/api\/orders\/(accept|pay|fire|move|guests|run-status|void|comp|handoff|merge|unmerge|refund)$/.test(p) ||
      p === '/api/orders/discount' ||
      p === '/api/orders/discount/clear' ||
      /\/api\/kitchen\/(done|serve)$/.test(p);
  }

  function queueKeyOf(url, body) {
    try {
      var o = JSON.parse(body || '{}');
      var p = snapPath(url);
      if (p.indexOf('/pay') >= 0) {
        return 'pay:' + o.orderId + ':' + (o.itemIds || []).join(',');
      }
      if (p.indexOf('/accept') >= 0) {
        return 'accept:' + (o.tableId || o.orderId || '') + ':' + Date.now();
      }
      if (p.indexOf('/fire') >= 0) {
        return 'fire:' + o.orderId;
      }
      if (p.indexOf('/move') >= 0) {
        return 'move:' + o.orderId;
      }
      if (p.indexOf('/guests') >= 0) {
        return 'guests:' + (o.tableId || o.orderId || '');
      }
      if (p.indexOf('/run-status') >= 0) {
        return 'run:' + o.orderId;
      }
      if (p.indexOf('/void') >= 0) {
        return 'void:' + o.orderId + ':' + (o.itemId || '');
      }
      if (p.indexOf('/discount') >= 0) {
        return 'disc:' + o.orderId;
      }
      if (p.indexOf('/kitchen/') >= 0) {
        return 'kit:' + (o.orderId || '') + ':' + (o.itemId || '');
      }
      if (p === '/api/clock') {
        return 'clock';
      }
    } catch (error) {
      return String(url) + ':' + Date.now();
    }
    return String(url) + ':' + Date.now();
  }

  function remapQueue(list, fromId, toId) {
    var from = Number(fromId);
    var to = Number(toId);
    return (list || []).map(function (row) {
      var copy = {
        key: row.key,
        url: row.url,
        method: row.method,
        headers: row.headers,
        body: row.body,
        at: row.at,
        tempOrderId: row.tempOrderId
      };
      try {
        var o = JSON.parse(copy.body || '{}');
        if (Number(o.orderId) === from) {
          o.orderId = to;
          copy.body = JSON.stringify(o);
        }
      } catch (error) {
        /* keç */
      }
      if (Number(copy.tempOrderId) === from) {
        copy.tempOrderId = to;
      }
      return copy;
    });
  }

  function applyAccept(data, payload, tempId) {
    var box = data && typeof data === 'object' ? data : { orders: [] };
    var orders = Array.isArray(box.orders) ? box.orders.slice() : [];
    var tableId = Number(payload && payload.tableId) || 0;
    var add = ((payload && payload.items) || []).map(function (item, i) {
      return {
        id: -(Math.abs(Number(tempId) || 1) * 10 + i),
        productId: item.productId,
        qty: item.qty,
        salePrice: item.salePrice,
        note: item.note || '',
        status: 'queued'
      };
    });
    var existing = orders.find(function (order) {
      return order.status === 'open' && Number(order.tableId) === tableId;
    });
    if (existing) {
      existing.items = (existing.items || []).concat(add);
    } else {
      orders.push({
        id: tempId,
        status: 'open',
        tableId: tableId,
        items: add,
        guests: Number(payload && payload.guests) || 0,
        temp: true
      });
    }
    box.orders = orders;
    return box;
  }

  function applyPay(data, payload) {
    var box = data && typeof data === 'object' ? data : { orders: [] };
    var orders = Array.isArray(box.orders) ? box.orders.slice() : [];
    var id = Number(payload && payload.orderId);
    orders.forEach(function (order) {
      if (Number(order.id) === id) {
        order.status = 'paid';
        order.payment = {
          at: new Date().toISOString(),
          method: 'cash',
          total: 0
        };
      }
    });
    box.orders = orders;
    return box;
  }

  function fakeResult(url, payload, queued) {
    var p = snapPath(url);
    if (p.indexOf('/accept') >= 0) {
      return {
        success: true,
        offline: true,
        data: {
          order: { id: queued && queued.tempOrderId, tableId: payload && payload.tableId },
          warnings: ['Oflayn: şəbəkə qayıdanda göndəriləcək.']
        }
      };
    }
    if (p.indexOf('/pay') >= 0) {
      return {
        success: true,
        offline: true,
        data: {
          closed: true,
          remaining: 0,
          order: { id: payload && payload.orderId, status: 'paid' },
          payment: { at: new Date().toISOString() }
        }
      };
    }
    return { success: true, offline: true, data: {} };
  }

  return {
    snapPath: snapPath,
    isCacheGet: isCacheGet,
    shouldQueue: shouldQueue,
    queueKeyOf: queueKeyOf,
    remapQueue: remapQueue,
    applyAccept: applyAccept,
    applyPay: applyPay,
    fakeResult: fakeResult
  };
});
