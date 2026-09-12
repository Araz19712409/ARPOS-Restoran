const db = require('./db');
const store = require('./store');
const settings = require('./settings');
const num = require('./num');
const providers = require('./fiscal/providers');

function file() {
  return db.dataFile('fiscal-queue.json');
}

function readQueue() {
  try {
    const raw = store.readJson(file());
    return {
      nextId: Number(raw.nextId) || 1,
      jobs: Array.isArray(raw.jobs) ? raw.jobs : []
    };
  } catch (error) {
    return { nextId: 1, jobs: [] };
  }
}

function writeQueue(data) {
  data.jobs = (data.jobs || []).slice(-80);
  store.writeJson(file(), data);
}

function salePayload(job, cfg) {
  return {
    job: { id: job.id },
    cashier: cfg.operator || (cfg.wizarpos && cfg.wizarpos.cashier) || '',
    vatPercent: job.vatPercent,
    cashAmount: job.cashAmount,
    cardAmount: job.cardAmount,
    giftAmount: job.giftAmount,
    prepaid: job.prepaid,
    tipAmount: job.tipAmount,
    total: job.total,
    items: job.items || []
  };
}

function snapshotItems(order) {
  const list = [];
  (order && order.items || []).forEach(function (item) {
    if (item.voided) {
      return;
    }
    list.push({
      name: String(item.name || '').slice(0, 80),
      qty: item.qty,
      salePrice: num.fromMinor(num.toMinor(item.salePrice))
    });
  });
  return list;
}

function applyResult(job, res, cfg) {
  const emulator = providers.types.isEmulator(cfg);
  job.fiscalId = res.fiscalId || '';
  if (res.ok) {
    job.status = 'sent';
    job.message = emulator || cfg.provider === 'none'
      ? res.message
      : (res.message || ('Fiskal: ' + job.fiscalId));
    if (!emulator && cfg.provider !== 'none' && /vergiyə getmədi/i.test(job.message)) {
      job.message = 'Fiskal: ' + (job.fiscalId || 'qəbul');
    }
  } else {
    job.status = 'error';
    job.message = res.message || 'Fiskal göndərilmədi.';
  }
  return job;
}

function enqueue(order, payment, opts) {
  const storeCfg = settings.readSettings();
  const cfg = storeCfg.ekassa || {};
  const box = readQueue();
  const providerId = providers.idOf(cfg);
  const ready = String(cfg.voen || '').length === 10 && String(cfg.objectName || '').trim();
  const job = {
    id: box.nextId,
    at: (payment && payment.at) || new Date().toISOString(),
    orderId: order && order.id,
    tableName: (order && order.tableName) || '',
    total: Number((payment && payment.total) || 0),
    cashAmount: Number((payment && payment.cashAmount) || 0),
    cardAmount: Number((payment && payment.cardAmount) || 0),
    giftAmount: Number((payment && payment.giftAmount) || 0),
    prepaid: Number((payment && payment.prepaid) || 0),
    tipAmount: Number((payment && payment.tipAmount) || 0),
    vatPercent: Number(storeCfg.vatPercent) || 0,
    items: snapshotItems(order),
    voen: cfg.voen || '',
    objectName: cfg.objectName || '',
    objectCode: cfg.objectCode || '',
    operator: cfg.operator || '',
    provider: providerId,
    emulator: providers.types.isEmulator(cfg),
    fiscalId: '',
    status: 'pending',
    message: ''
  };
  box.nextId += 1;
  box.jobs.push(job);
  writeQueue(box);
  if (providerId === 'none') {
    job.status = ready ? 'ready' : 'hold';
    job.message = ready
      ? providers.types.noneMsg()
      : ('VÖEN və obyekt yazın. ' + providers.types.noneMsg());
    writeQueue(box);
    return opts && opts.wait ? Promise.resolve(job) : job;
  }
  if (providers.types.isEmulator(cfg)) {
    applyResult(job, providers.types.emuSale(job), cfg);
    writeQueue(box);
    return opts && opts.wait ? Promise.resolve(job) : job;
  }
  const run = dispatch(job.id);
  if (opts && opts.wait) {
    return run;
  }
  run.catch(function () {});
  return job;
}

function dispatch(id) {
  const cfg = settings.readSettings().ekassa || {};
  const box = readQueue();
  const job = box.jobs.find(function (row) { return row.id === Number(id); });
  if (!job) {
    return Promise.reject(new Error('Növbə tapılmadı.'));
  }
  if (job.status === 'sent') {
    return Promise.resolve(job);
  }
  if (providers.idOf(cfg) === 'none') {
    job.status = 'ready';
    job.message = providers.types.noneMsg();
    writeQueue(box);
    return Promise.resolve(job);
  }
  if (providers.types.isEmulator(cfg)) {
    applyResult(job, providers.types.emuSale(job), cfg);
    writeQueue(box);
    return Promise.resolve(job);
  }
  const provider = providers.get(cfg);
  return provider.registerSale(salePayload(job, cfg)).then(function (res) {
    applyResult(job, res, cfg);
    writeQueue(box);
    return job;
  }).catch(function () {
    job.status = 'error';
    job.message = 'Fiskal göndərilmədi.';
    writeQueue(box);
    return job;
  });
}

function retry(id) {
  const box = readQueue();
  const job = box.jobs.find(function (row) { return row.id === Number(id); });
  if (!job) {
    return Promise.reject(new Error('Növbə tapılmadı.'));
  }
  if (job.status === 'sent') {
    return Promise.resolve(job);
  }
  job.status = 'pending';
  job.message = '';
  writeQueue(box);
  return dispatch(id);
}

function listJobs() {
  return readQueue().jobs.slice().reverse();
}

function probe(kind, cashier) {
  const cfg = settings.readSettings().ekassa || {};
  const provider = providers.get(cfg);
  if (kind === 'shift') {
    return provider.getShiftStatus();
  }
  if (kind === 'open') {
    return provider.openShift(cashier);
  }
  if (kind === 'close') {
    return provider.closeShiftZ();
  }
  return provider.testConnection();
}

module.exports = {
  enqueue: enqueue,
  dispatch: dispatch,
  retry: retry,
  listJobs: listJobs,
  probe: probe,
  providers: providers
};
