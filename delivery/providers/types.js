function result(ok, orderDraft, message) {
  return {
    ok: !!ok,
    orderDraft: orderDraft || null,
    message: message ? String(message) : ''
  };
}

function sampleDraft(providerId) {
  return {
    guestName: 'Nümunə Qonaq',
    guestPhone: '0500000000',
    guestAddress: 'Stub ünvan',
    externalId: 'emu-' + String(providerId || 'wolt') + '-1',
    items: [
      { name: 'Çay', barcode: '12345', qty: 1 },
      { name: 'Naməlum pizza', barcode: 'NO-SUCH', qty: 1, price: 12 }
    ]
  };
}

module.exports = {
  result: result,
  sampleDraft: sampleDraft
};
