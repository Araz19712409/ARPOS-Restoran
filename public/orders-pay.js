(function (global) {
  function bind(ctx) {
    if (!ctx) {
      return;
    }
    var el = ctx.el;
    var setText = ctx.setText;
    var setVal = ctx.setVal;
    var api = ctx.api;
    var say = ctx.say;
    var payFail = ctx.payFail;
    var M = ctx.M;
    var can = ctx.can;
    var showLock = ctx.showLock;
    var ensureTerminal = ctx.ensureTerminal;

    function node(id) {
      return (el && el(id)) || document.getElementById(id);
    }

    function valOf(id) {
      var n = node(id);
      return n && n.value != null ? n.value : '';
    }

    function on(id, ev, fn) {
      var n = node(id);
      if (n) {
        n.addEventListener(ev, fn);
      }
    }

    function setDisabled(id, off) {
      var n = node(id);
      if (n) {
        n.disabled = !!off;
      }
    }

    function setCls(id, cls, onOff) {
      var n = node(id);
      if (n) {
        n.classList.toggle(cls, !!onOff);
      }
    }

    function pickingPay() {
      return ctx.payPickIds.length > 0 || ctx.paySeatId > 0;
    }

    function selectedPayLines(order) {
      return ctx.openLines(order).filter(function (item) {
        var home = Number(item.seatTableId || order.tableId);
        if (ctx.paySeatId && home !== ctx.paySeatId) {
          return false;
        }
        if (ctx.payPickIds.length && ctx.payPickIds.indexOf(item.id) === -1) {
          return false;
        }
        return true;
      });
    }

    function pickDueAmount(order, remaining) {
      if (!pickingPay()) {
        return remaining;
      }
      var lines = selectedPayLines(order);
      if (!lines.length) {
        return 0;
      }
      if (lines.length === ctx.openLines(order).length) {
        return remaining;
      }
      var remM = M.toMinor(remaining);
      var pickM = 0;
      lines.forEach(function (item) {
        pickM = M.addMinor(pickM, ctx.lineMinor(item));
      });
      var openM = 0;
      ctx.openLines(order).forEach(function (item) {
        openM = M.addMinor(openM, ctx.lineMinor(item));
      });
      var shareM = openM > 0 ? Math.round(remM * pickM / openM) : 0;
      if (M.subMinor(remM, shareM) <= 1) {
        shareM = remM;
      }
      return M.fromMinor(shareM);
    }

    function fillPayPicks(order) {
      var wrap = node('pay-pick-wrap');
      var seatBox = node('pay-seats');
      var pickBox = node('pay-pick');
      var splitBusy = !!(order.payments && order.payments.length && order.splitCount);
      if (!wrap || ctx.payMode !== 'order' || splitBusy) {
        if (wrap) {
          wrap.classList.add('hidden');
        }
        ctx.payPickIds = [];
        ctx.paySeatId = 0;
        return;
      }
      wrap.classList.remove('hidden');
      var lines = ctx.openLines(order);
      var seats = [];
      lines.forEach(function (item) {
        var id = Number(item.seatTableId || order.tableId);
        if (id > 0 && seats.indexOf(id) === -1) {
          seats.push(id);
        }
      });
      if (seatBox) {
        seatBox.innerHTML = '';
      }
      if (seats.length > 1 && seatBox) {
        seats.forEach(function (id) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pay-seat' + (ctx.paySeatId === id ? ' active' : '');
          btn.textContent = ctx.tableTitle(id);
          btn.addEventListener('click', function () {
            ctx.paySeatId = ctx.paySeatId === id ? 0 : id;
            ctx.payPickIds = ctx.paySeatId
              ? ctx.openLines(order).filter(function (item) {
                return Number(item.seatTableId || order.tableId) === ctx.paySeatId;
              }).map(function (item) { return item.id; })
              : [];
            openPay();
          });
          seatBox.appendChild(btn);
        });
      }
      if (!pickBox) {
        return;
      }
      pickBox.innerHTML = '';
      lines.forEach(function (item) {
        var lab = document.createElement('label');
        lab.className = 'pay-pick-row';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = ctx.payPickIds.indexOf(item.id) !== -1;
        box.addEventListener('change', function () {
          var ids = ctx.payPickIds.slice();
          if (box.checked) {
            if (ids.indexOf(item.id) === -1) {
              ids.push(item.id);
            }
          } else {
            ids = ids.filter(function (id) { return id !== item.id; });
            ctx.paySeatId = 0;
          }
          ctx.payPickIds = ids;
          openPay();
        });
        lab.appendChild(box);
        var text = document.createElement('span');
        text.textContent = item.qty + '× ' + item.name + ' · ' +
          M.fromMinor(ctx.lineMinor(item)).toFixed(2);
        lab.appendChild(text);
        pickBox.appendChild(lab);
      });
    }

    function splitFrozen(order) {
      return !!(order && order.payments && order.payments.length && order.splitCount);
    }

    function currentShare(remaining, order) {
      var remM = M.toMinor(remaining);
      if (splitFrozen(order)) {
        var frozenN = Number(order.splitCount);
        var frozenM = M.toMinor(order.splitShare);
        if (frozenM <= 0) {
          frozenM = Math.round(remM / frozenN);
        }
        if (M.subMinor(remM, frozenM) <= 1) {
          frozenM = remM;
        }
        return { n: frozenN, share: M.fromMinor(frozenM) };
      }
      var n = Number(valOf('pay-split'));
      if (!Number.isInteger(n) || n < 1) {
        n = 1;
      }
      if (n > 10) {
        n = 10;
      }
      var shareM = n === 1 ? remM : Math.round(remM / n);
      if (M.subMinor(remM, shareM) <= 1) {
        shareM = remM;
      }
      return { n: n, share: M.fromMinor(shareM) };
    }

    function setSplitLocked(order) {
      var settled = !!(order && (order.items || []).some(function (item) { return item.settled; }));
      var locked = ctx.payMode === 'order' && (splitFrozen(order) || pickingPay() || settled);
      var splitEl = node('pay-split');
      setDisabled('pay-split', locked);
      setDisabled('pay-split-minus', locked);
      setDisabled('pay-split-plus', locked);
      if (locked && splitEl) {
        splitEl.value = String(order.splitCount || 1);
      }
    }

    function setPayDueView() {
      setText('pay-due-amt', ctx.payDue.toFixed(2));
      var splitN = Number(valOf('pay-split')) || 1;
      setText('pay-due-label', ctx.payMode === 'reserve'
        ? 'İlkin məbləğ'
        : (splitN > 1 ? 'Bu pay' : 'Ödəniləcək'));
    }

    function setPayRow(wrapId, valueId, amount) {
      var wrap = document.getElementById(wrapId);
      var value = document.getElementById(valueId);
      if (!wrap || !value) {
        return;
      }
      var show = M.toMinor(amount) > 0;
      wrap.classList.toggle('hidden', !show);
      if (show) {
        value.textContent = amount.toFixed(2);
      }
    }

    function fillPayBreakdown(parts, prepaid, already, remaining) {
      setText('pay-row-items', parts.items.toFixed(2));
      setPayRow('pay-row-off-wrap', 'pay-row-off', parts.off);
      setPayRow('pay-row-svc-wrap', 'pay-row-svc', parts.service);
      setPayRow('pay-row-tip-wrap', 'pay-row-tip', parts.tip || 0);
      setPayRow('pay-row-pre-wrap', 'pay-row-pre', prepaid);
      setPayRow('pay-row-paid-wrap', 'pay-row-paid', already);
      setText('pay-row-remain', remaining.toFixed(2));
    }

    function fillPayQuick(cash) {
      var box = node('pay-quick');
      if (!box) {
        return;
      }
      var steps = [1, 5, 10, 20, 50, 100, 200];
      var cashM = M.toMinor(cash);
      var vals = [M.fromMinor(cashM)];
      steps.forEach(function (step) {
        var stepM = M.toMinor(step);
        var nextM = Math.ceil(cashM / stepM) * stepM;
        var next = M.fromMinor(nextM);
        if (nextM > cashM && vals.indexOf(next) < 0) {
          vals.push(next);
        }
      });
      vals = vals.slice(0, 6);
      box.innerHTML = vals.map(function (amount) {
        var label = M.toMinor(amount) === cashM ? 'Tam' : String(amount);
        return '<button type="button" data-tender="' + amount.toFixed(2) + '">' + label + '</button>';
      }).join('');
    }

    function clampDueMinor(n, dueM) {
      n = Math.round(Number(n) || 0);
      if (n < 0) {
        return 0;
      }
      if (n > dueM) {
        return dueM;
      }
      return n;
    }

    function loyaltyOn() {
      return !!(ctx.settings.loyalty && ctx.settings.loyalty.enabled);
    }

    function loyaltyMinor() {
      if (!loyaltyOn()) {
        return 0;
      }
      var box = document.getElementById('pay-loyalty-amt');
      return box ? M.toMinor(box.value) : 0;
    }

    function refreshLoyaltyUi() {
      var on = loyaltyOn();
      ['pay-loy-phone-wrap', 'pay-loy-amt-wrap', 'pay-loy-bal'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) {
          node.classList.toggle('hidden', !on);
        }
      });
    }

    function lookupLoyalty() {
      if (!loyaltyOn()) {
        return;
      }
      var phoneEl = document.getElementById('pay-loy-phone');
      var bal = document.getElementById('pay-loy-bal');
      var phone = ((phoneEl && phoneEl.value) || '').replace(/\D/g, '');
      if (!bal) {
        return;
      }
      if (phone.length < 7) {
        bal.textContent = '';
        return;
      }
      api('/api/customers?phone=' + encodeURIComponent(phone)).then(function (body) {
        var row = body.data && body.data.customer;
        var value = Number(ctx.settings.loyalty && ctx.settings.loyalty.pointValueMinor) || 1;
        if (!row) {
          bal.textContent = 'Yeni müştəri. İlk ödənişdə yaradılacaq.';
          return;
        }
        var azn = M.fromMinor(row.points * value);
        bal.textContent = row.name
          ? (row.name + ' • ' + row.points + ' ball (' + azn.toFixed(2) + ' AZN)')
          : (row.points + ' ball (' + azn.toFixed(2) + ' AZN)');
      }).catch(function () {
        bal.textContent = '';
      });
    }

    function splitDueMinor(source, cashM, cardM, dueM) {
      dueM = Math.max(0, Math.round(Number(dueM) || 0));
      cashM = Math.round(Number(cashM) || 0);
      cardM = Math.round(Number(cardM) || 0);
      if (source === 'cash') {
        cashM = clampDueMinor(cashM, dueM);
        cardM = M.subMinor(dueM, cashM);
      } else if (source === 'card') {
        cardM = clampDueMinor(cardM, dueM);
        cashM = M.subMinor(dueM, cardM);
      } else {
        cashM = Math.max(0, cashM);
        cardM = Math.max(0, cardM);
        var gap = M.subMinor(dueM, M.addMinor(cashM, cardM));
        if (gap !== 0) {
          if (cardM > 0) {
            cardM = M.addMinor(cardM, gap);
          } else {
            cashM = M.addMinor(cashM, gap);
          }
          if (cashM < 0) {
            cardM = M.addMinor(cardM, cashM);
            cashM = 0;
          }
          if (cardM < 0) {
            cashM = M.addMinor(cashM, cardM);
            cardM = 0;
          }
        }
      }
      return { cash: cashM, card: cardM };
    }

    function setPayMethod(method) {
      ctx.payMethod = method;
      setCls('pay-method-cash', 'active', method === 'cash');
      setCls('pay-method-card', 'active', method === 'card');
      setCls('pay-method-mix', 'active', method === 'mix');
      var mix = node('pay-mix-fields');
      if (mix) {
        mix.classList.remove('hidden');
      }
      if (method === 'cash') {
        var cashDue = M.fromMinor(Math.max(0, M.subMinor(M.toMinor(ctx.payDue), loyaltyMinor())));
        setVal('pay-cash-amt', cashDue.toFixed(2));
        setVal('pay-card-amt', '0.00');
        setVal('pay-tendered', cashDue.toFixed(2));
        syncPayFields('cash');
      } else if (method === 'card') {
        var cardDue = M.fromMinor(Math.max(0, M.subMinor(M.toMinor(ctx.payDue), loyaltyMinor())));
        setVal('pay-cash-amt', '0.00');
        setVal('pay-card-amt', cardDue.toFixed(2));
        syncPayFields('card');
      } else {
        syncPayFields('cash');
      }
    }

    function bumpSplit(delta) {
      if (ctx.payMode === 'order' && splitFrozen(ctx.openOrder())) {
        return;
      }
      var splitEl = node('pay-split');
      if (!splitEl) {
        return;
      }
      var n = Number(splitEl.value) || 1;
      n = Math.min(10, Math.max(1, n + delta));
      splitEl.value = String(n);
      if (ctx.payMode === 'order') {
        openPay();
      }
    }

    function syncPayFields(source) {
      if (ctx.payLock) {
        return;
      }
      if (ctx.payMode === 'order' && !ctx.openOrder()) {
        return;
      }
      var cashInput = node('pay-cash-amt');
      var cardInput = node('pay-card-amt');
      var changeEl = node('pay-change');
      if (!cashInput || !cardInput || !changeEl) {
        return;
      }
      ctx.payLock = true;
      var dueM = Math.max(0, M.subMinor(M.toMinor(ctx.payDue), loyaltyMinor()));
      var split = splitDueMinor(source, M.toMinor(cashInput.value), M.toMinor(cardInput.value), dueM);
      var cash = M.fromMinor(split.cash);
      var card = M.fromMinor(split.card);
      cashInput.value = cash.toFixed(2);
      cardInput.value = card.toFixed(2);
      var tenderWrap = node('tender-wrap');
      if (tenderWrap) {
        tenderWrap.style.display = split.cash > 0 ? '' : 'none';
      }
      if (split.cash > 0) {
        var givenM = M.toMinor(valOf('pay-tendered'));
        if (givenM < split.cash) {
          setVal('pay-tendered', cash.toFixed(2));
          givenM = split.cash;
        }
        var leftoverM = M.subMinor(givenM, split.cash);
        changeEl.textContent = leftoverM > 0 ? ('Qalıq: ' + M.fromMinor(leftoverM).toFixed(2) + ' AZN') : 'Tam ödənir';
        changeEl.classList.toggle('is-zero', leftoverM <= 0);
        fillPayQuick(cash);
      } else {
        changeEl.textContent = (ctx.payMode === 'order' && dueM === 0)
          ? 'Tam ilkin ödəniş'
          : 'Tam kart';
        changeEl.classList.add('is-zero');
      }
      setPayDueView();
      ctx.payLock = false;
    }

    function applyPaySimpleMode() {
      var simple = ctx.payMode === 'order' && !(ctx.settings.pay && ctx.settings.pay.simpleMode === false);
      var modal = el('pay-modal');
      if (modal) {
        modal.classList.toggle('pay-simple', simple);
      }
      var hidePro = simple;
      ['pay-pick-wrap', 'pay-tip-wrap', 'pay-breakdown', 'split-wrap'].forEach(function (id) {
        var n = el(id);
        if (n) {
          n.classList.toggle('hidden', hidePro);
        }
      });
      ['pay-voen', 'pay-buyer', 'pay-gift'].forEach(function (id) {
        var n = el(id);
        var lab = n && n.closest ? n.closest('label') : null;
        if (lab) {
          lab.classList.toggle('hidden', hidePro);
        }
      });
      var more = el('pay-more');
      var loyOn = !!(ctx.settings.loyalty && ctx.settings.loyalty.enabled);
      if (more) {
        if (simple) {
          more.classList.toggle('hidden', !loyOn);
          more.open = !!loyOn;
        } else {
          more.classList.remove('hidden');
        }
      }
    }

    function openPay() {
      try {
        if (!M || !M.toMinor) {
          payFail('money.js yuklenmedi. Sehifeni yenileyin.');
          return;
        }
        var order = ctx.openOrder();
        if (!order) {
          payFail('Açıq hesab yoxdur.');
          return;
        }
        if (ctx.pending.length) {
          payFail('Əvvəlcə yeni sətirləri qəbul edin.');
          return;
        }
        var payModal = el('pay-modal');
        if (payModal && payModal.classList.contains('hidden')) {
          ctx.payPickIds = [];
          ctx.paySeatId = 0;
        }
        var tipBox = el('pay-tip');
        var hasShares = !!(order.payments && order.payments.length);
        if (tipBox) {
          tipBox.disabled = hasShares;
          if (hasShares) {
            setVal('pay-tip', Number(order.tipAmount || 0).toFixed(2));
          } else if (payModal && payModal.classList.contains('hidden')) {
            setVal('pay-tip', Number(order.tipAmount || 0).toFixed(2));
          }
          order.tipAmount = M.fromMinor(M.toMinor(tipBox.value));
        }
        setVal('pay-voen', order.buyerVoen || '');
        setVal('pay-buyer', order.buyerName || '');
        var parts = ctx.billAfter(order);
        var booked = ctx.bookingFor(ctx.tableId);
        var prepaidM = M.toMinor(booked && booked.prepay ? booked.prepay.total : 0);
        var remainingM = Math.max(0, M.subMinor(M.subMinor(M.toMinor(parts.total), prepaidM), ctx.paidSharesMinor(order)));
        var remaining = M.fromMinor(remainingM);
        if ((order.items || []).some(function (item) { return !item.voided && !item.sent; })) {
          payFail(ctx.settings.autoSendAllOnAccept !== false
            ? 'Əvvəlcə sətirləri qəbul edin.'
            : 'Əvvəlcə isti kursu göndərin.');
          return;
        }
        var keepMethod = (payModal && payModal.classList.contains('hidden')) ? 'cash' : ctx.payMethod;
        ctx.payMode = 'order';
        setText('pay-title', 'Ödəniş');
        setText('pay-table-label', (el('check-table') && el('check-table').textContent) || '');
        var prepayWrap = el('prepay-amt-wrap');
        if (prepayWrap) {
          prepayWrap.classList.add('hidden');
        }
        var splitBox = el('pay-split');
        if (splitBox && !splitBox.value) {
          setVal('pay-split', '1');
        }
        fillPayPicks(order);
        setSplitLocked(order);
        var cut = currentShare(remaining, order);
        ctx.payDue = pickingPay() ? pickDueAmount(order, remaining) : cut.share;
        setText('pay-submit',
          M.subMinor(remainingM, M.toMinor(ctx.payDue)) > 1 ? 'Payı ödə' : 'Satışı bitir');
        fillPayBreakdown(parts, M.fromMinor(prepaidM), M.fromMinor(ctx.paidSharesMinor(order)), remaining);
        refreshLoyaltyUi();
        lookupLoyalty();
        setText('pay-share', pickingPay()
          ? 'Seçilmiş sətirlər'
          : (cut.n > 1 ? (cut.n + ' nəfər • hər pay ' + ctx.payDue.toFixed(2) + ' AZN') : ''));
        setPayDueView();
        setPayMethod(keepMethod);
        applyPaySimpleMode();
        if (payModal) {
          payModal.classList.remove('hidden');
        }
      } catch (err) {
        payFail((err && err.message) ? err.message : 'Odenis acilmadi.');
      }
    }

    function openPrepay() {
      var booked = ctx.bookingFor(ctx.tableId);
      if (!booked || !can('payments.take')) {
        say('Aktiv rezerv yoxdur.', 'err');
        return;
      }
      var already = booked.prepay ? Number(booked.prepay.total) : 0;
      ctx.payMode = 'reserve';
      ctx.payDue = 10;
      setText('pay-title', 'İlkin ödəniş');
      setText('pay-table-label', booked.name || '');
      var splitWrap = el('split-wrap');
      if (splitWrap) {
        splitWrap.classList.add('hidden');
      }
      setText('pay-share', '');
      var breakdown = el('pay-breakdown');
      if (breakdown) {
        breakdown.classList.add('hidden');
      }
      var tipWrap = el('pay-tip-wrap');
      if (tipWrap) {
        tipWrap.classList.add('hidden');
      }
      var prepayWrap = el('prepay-amt-wrap');
      if (prepayWrap) {
        prepayWrap.classList.remove('hidden');
      }
      setVal('pay-prepay-amt', '10.00');
      setText('pay-submit', 'Qəbul et');
      if (already > 0) {
        setText('pay-share', 'Artıq alındı: ' + already.toFixed(2) + ' AZN');
      }
      setPayDueView();
      setPayMethod('cash');
      var payModal = el('pay-modal');
      if (payModal) {
        payModal.classList.remove('pay-simple');
        payModal.classList.remove('hidden');
      }
    }

    function nextTableAfterCloseOn() {
      return !(ctx.settings.pay && ctx.settings.pay.nextTableAfterClose === false);
    }

    function setReceiptNextMode(on) {
      var std = el('receipt-std-actions');
      var next = el('receipt-next-actions');
      if (std) {
        std.classList.toggle('hidden', !!on);
      }
      if (next) {
        next.classList.toggle('hidden', !on);
      }
    }

    function hidePostPayStrip() {
      var strip = el('post-pay-strip');
      if (strip) {
        strip.classList.add('hidden');
      }
    }

    function showPostPayStrip(msg) {
      setText('post-pay-msg', msg || 'Satış bitdi. Masa boşdur.');
      var strip = el('post-pay-strip');
      if (strip) {
        strip.classList.remove('hidden');
      }
    }

    function stayAfterPay() {
      var rm = el('receipt-modal');
      if (rm) {
        rm.classList.add('hidden');
      }
      hidePostPayStrip();
      setReceiptNextMode(false);
      if (ctx.isServiceId(ctx.tableId)) {
        ctx.tableId = 0;
      }
      ctx.load();
    }

    function goNextTable() {
      var pm = el('pay-modal');
      if (pm) {
        pm.classList.add('hidden');
      }
      var rm = el('receipt-modal');
      if (rm) {
        rm.classList.add('hidden');
      }
      hidePostPayStrip();
      setReceiptNextMode(false);
      ctx.pending = [];
      ctx.tableId = 0;
      ctx.setOrderZone('floor');
      ctx.load();
    }

    function printReceiptPaper() {
      if (window.ReceiptView && window.ReceiptView.printNow) {
        window.ReceiptView.printNow(el('receipt-paper') || document.getElementById('receipt-paper'));
      }
    }

    function requestReceiptPrint() {
      if (!ctx.lastReceipt || !ctx.waiter) {
        printReceiptPaper();
        return;
      }
      api('/api/orders/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: ctx.lastReceipt.id,
          waiterId: ctx.waiter.user.id,
          terminalId: ctx.terminal ? ctx.terminal.id : 0
        })
      }).then(function (body) {
        var warns = (body.data && body.data.warnings) || [];
        setText('receipt-msg', warns.length ? warns.join(' ') : 'Çek göndərildi.');
        if (warns.length) {
          printReceiptPaper();
        }
      }).catch(function (error) {
        setText('receipt-msg', error.message);
        printReceiptPaper();
      });
    }

    ctx.pickingPay = pickingPay;
    ctx.fillPayPicks = fillPayPicks;
    ctx.setSplitLocked = setSplitLocked;
    ctx.currentShare = currentShare;
    ctx.pickDueAmount = pickDueAmount;
    ctx.fillPayBreakdown = fillPayBreakdown;
    ctx.setPayDueView = setPayDueView;
    ctx.splitFrozen = splitFrozen;
    ctx.openPay = openPay;
    ctx.openPrepay = openPrepay;
    ctx.applyPaySimpleMode = applyPaySimpleMode;
    ctx.goNextTable = goNextTable;

    on('pay-cash-amt', 'input', function () { syncPayFields('cash'); });
    on('pay-card-amt', 'input', function () { syncPayFields('card'); });
    on('pay-tendered', 'input', function () { syncPayFields('tender'); });
    on('pay-loy-phone', 'blur', lookupLoyalty);
    on('pay-loyalty-amt', 'input', function () { setPayMethod(ctx.payMethod); });
    on('pay-prepay-amt', 'input', function () {
      if (ctx.payMode !== 'reserve') {
        return;
      }
      var amt = M.toMinor(valOf('pay-prepay-amt'));
      ctx.payDue = amt > 0 ? M.fromMinor(amt) : 0;
      setPayDueView();
      setPayMethod(ctx.payMethod);
    });
    on('pay-split', 'input', function () {
      if (ctx.payMode === 'order' && !splitFrozen(ctx.openOrder())) {
        openPay();
      }
    });
    on('pay-split-minus', 'click', function () { bumpSplit(-1); });
    on('pay-split-plus', 'click', function () { bumpSplit(1); });
    on('pay-method-cash', 'click', function () { setPayMethod('cash'); });
    on('pay-method-card', 'click', function () { setPayMethod('card'); });
    on('pay-method-mix', 'click', function () { setPayMethod('mix'); });
    on('pay-quick', 'click', function (event) {
      var btn = event.target.closest('[data-tender]');
      if (!btn) {
        return;
      }
      setVal('pay-tendered', btn.getAttribute('data-tender'));
      syncPayFields('tender');
    });
    on('pay-open', 'click', function () {
      if (ctx.busy) {
        return;
      }
      if (!can('payments.take')) {
        payFail('Ödənişə icazəniz yoxdur.');
        return;
      }
      if (!ctx.waiter) {
        showLock();
        return;
      }
      if (ctx.pending.length) {
        if (!can('orders.create')) {
          payFail('Sifariş yazmağa icazəniz yoxdur.');
          return;
        }
        if (!ctx.tableId) {
          payFail('Əvvəlcə masa seçin.');
          return;
        }
        if (!ctx.terminal) {
          payFail('Terminal seçin.');
          ensureTerminal(true);
          return;
        }
        window.askYes('Qəbul + ödəniş', 'Sətirlər qəbul edilib ödəniş açılsın?').then(function (ok) {
          if (!ok) {
            return;
          }
          return ctx.postAccept().then(function () {
            openPay();
          });
        }).catch(function (error) {
          payFail(error.message);
        });
        return;
      }
      openPay();
    });
    on('prepay-open', 'click', openPrepay);

    on('pay-tip', 'input', function () {
      var modal = node('pay-modal');
      if (ctx.payMode === 'order' && modal && !modal.classList.contains('hidden')) {
        openPay();
      }
    });

    on('cancel-pay', 'click', function () {
      var modal = node('pay-modal');
      if (modal) {
        modal.classList.add('hidden');
      }
    });
    var receiptCloseBtn = el('receipt-close');
    if (receiptCloseBtn) {
      receiptCloseBtn.addEventListener('click', function () {
        var rm = el('receipt-modal');
        if (rm) {
          rm.classList.add('hidden');
        }
        setReceiptNextMode(false);
      });
    }
    var receiptPrintBtn = el('receipt-print');
    if (receiptPrintBtn) {
      receiptPrintBtn.addEventListener('click', requestReceiptPrint);
    }
    var receiptPrintNextBtn = el('receipt-print-next');
    if (receiptPrintNextBtn) {
      receiptPrintNextBtn.addEventListener('click', requestReceiptPrint);
    }
    var receiptStayBtn = el('receipt-stay');
    if (receiptStayBtn) {
      receiptStayBtn.addEventListener('click', stayAfterPay);
    }
    var receiptNextBtn = el('receipt-next');
    if (receiptNextBtn) {
      receiptNextBtn.addEventListener('click', goNextTable);
    }
    var postPayStayBtn = el('post-pay-stay');
    if (postPayStayBtn) {
      postPayStayBtn.addEventListener('click', stayAfterPay);
    }
    var postPayNextBtn = el('post-pay-next');
    if (postPayNextBtn) {
      postPayNextBtn.addEventListener('click', goNextTable);
    }

    on('pay-form', 'submit', function (event) {
      event.preventDefault();
      if (!ctx.waiter) {
        payFail('PIN ilə daxil olun.');
        ctx.busy = false;
        return;
      }
      var cashAmount = M.fromMinor(M.toMinor(valOf('pay-cash-amt')));
      var cardAmount = M.fromMinor(M.toMinor(valOf('pay-card-amt')));
      var tendered = M.fromMinor(M.toMinor(valOf('pay-tendered')));
      if (ctx.payMode === 'reserve') {
        var booked = ctx.bookingFor(ctx.tableId);
        if (!booked) {
          payFail('Aktiv rezerv yoxdur.');
          return;
        }
        window.askYes('İlkin ödəniş', 'İlkin ödəniş qəbul edilsin?').then(function (ok) {
          if (!ok) {
            ctx.busy = false;
            return;
          }
          ctx.busy = true;
          return api('/api/reservations/' + booked.id + '/prepay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            waiterId: ctx.waiter.user.id,
            terminalId: ctx.terminal ? ctx.terminal.id : 0,
            cashAmount: cashAmount,
            cardAmount: cardAmount,
            tendered: tendered
          })
        }).then(function () {
          var prepayModal = node('pay-modal');
          if (prepayModal) {
            prepayModal.classList.add('hidden');
          }
          say('İlkin ödəniş qəbul edildi.');
          return ctx.load();
        }).catch(function (error) {
          payFail(error.message);
        }).then(function () {
            ctx.busy = false;
          });
        }).catch(function (error) {
          payFail(error.message);
          ctx.busy = false;
        });
        return;
      }
      var order = ctx.openOrder();
      if (!order) {
        payFail('Açıq hesab yoxdur.');
        ctx.busy = false;
        return;
      }
      var splitN = Number(valOf('pay-split')) || 1;
      var hasShares = (order.payments || []).length > 0;
      var payText = M.toMinor(ctx.payDue) < 1 && !hasShares
        ? 'Hesab 0 AZN-dir. Masa bağlansın?'
        : (splitN === 1 && !hasShares
          ? 'Satış bitiriləcək və masa boşalacaq. Davam?'
          : 'Bu pay ödənsin?');
      window.askYes('Ödəniş', payText).then(function (ok) {
        if (!ok) {
          ctx.busy = false;
          return;
        }
        ctx.busy = true;
        var dueM = M.toMinor(ctx.payDue);
        var giftCode = String(valOf('pay-gift')).trim();
        var giftAmount = 0;
        var loyM = loyaltyMinor();
        var restM = Math.max(0, M.subMinor(dueM, loyM));
        var cashM = M.toMinor(valOf('pay-cash-amt'));
        var cardM = M.toMinor(valOf('pay-card-amt'));
        var tendM = M.toMinor(valOf('pay-tendered'));
        if (giftCode) {
          giftAmount = M.fromMinor(restM);
          cashAmount = 0;
          cardAmount = 0;
          tendered = 0;
        } else {
          var splitPay = splitDueMinor('', cashM, cardM, restM);
          cashAmount = M.fromMinor(splitPay.cash);
          cardAmount = M.fromMinor(splitPay.card);
          giftAmount = 0;
          if (splitPay.cash > 0 && tendM < splitPay.cash) {
            tendM = splitPay.cash;
          }
          tendered = splitPay.cash > 0 ? M.fromMinor(tendM) : 0;
        }
        return api('/api/orders/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          waiterId: ctx.waiter.user.id,
          terminalId: ctx.terminal ? ctx.terminal.id : 0,
          splitCount: Number(valOf('pay-split')) || 1,
          tipAmount: M.fromMinor(M.toMinor(valOf('pay-tip'))),
          buyerVoen: valOf('pay-voen'),
          buyerName: valOf('pay-buyer'),
          giftCode: giftCode,
          giftAmount: giftAmount,
          loyaltyPhone: loyaltyOn() ? valOf('pay-loy-phone') : '',
          loyaltyAmount: loyaltyOn() ? M.fromMinor(loyM) : 0,
          itemIds: ctx.payPickIds,
          seatTableId: ctx.paySeatId,
          cashAmount: cashAmount,
          cardAmount: cardAmount,
          tendered: tendered
        })
      }).then(function (body) {
        var payModal = el('pay-modal');
        if (payModal) {
          payModal.classList.add('hidden');
        }
        ctx.pending = [];
        var result = body.data || {};
        var view = result.order || null;
        if (view && result.payment) {
          view = Object.assign({}, view, { payment: result.payment });
        }
        ctx.lastReceipt = view;
        if (ctx.lastReceipt && ctx.settings) {
          if (ctx.settings.branchName) {
            ctx.lastReceipt.branchName = ctx.settings.branchName;
          }
          if (ctx.settings.branchCode) {
            ctx.lastReceipt.branchCode = ctx.settings.branchCode;
          }
          if (ctx.settings.receipt) {
            ctx.lastReceipt.receipt = ctx.settings.receipt;
          }
        }
        var wantNext = !!(result.closed && nextTableAfterCloseOn());
        var showedReceipt = false;
        if (result.closed && ctx.lastReceipt && window.ReceiptView) {
          window.ReceiptView.fill(el('receipt-paper') || document.getElementById('receipt-paper'), ctx.lastReceipt);
          setText('receipt-msg', wantNext
            ? 'Satış bitdi. Növbəti masa və ya bu masada qalın.'
            : 'Çapdan qabaq görünüş. Çap et və ya bağla.');
          setReceiptNextMode(wantNext);
          var receiptModal = el('receipt-modal');
          if (receiptModal) {
            receiptModal.classList.remove('hidden');
          }
          showedReceipt = true;
        } else {
          setReceiptNextMode(false);
        }
        if (wantNext && !showedReceipt) {
          showPostPayStrip('Satış bitdi. Masa boşdur.');
        } else {
          hidePostPayStrip();
        }
        if (result.closed && !wantNext && ctx.isServiceId(ctx.tableId)) {
          ctx.tableId = 0;
        }
        say(result.closed ? 'Satış bitdi. Masa boşdur.' : ('Pay alındı. Qalıq: ' + Number(result.remaining || 0).toFixed(2) + ' AZN'));
        return ctx.load();
      }).catch(function (error) {
        payFail(error.message);
      }).then(function () {
        ctx.busy = false;
      });
      });
    });
  }

  global.OrdersPay = { bind: bind };
})(typeof window !== 'undefined' ? window : globalThis);
