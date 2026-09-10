const db = require('./db');
const store = require('./store');
const settings = require('./settings');

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

// Operator yoxdur — vergiyə göndərilmir, yalnız növbə saxlanır
function enqueue(order, payment) {
  const cfg = settings.readSettings().ekassa || {};
  const box = readQueue();
  const ready = String(cfg.voen || '').length === 10 && String(cfg.objectName || '').trim();
  const job = {
    id: box.nextId,
    at: (payment && payment.at) || new Date().toISOString(),
    orderId: order.id,
    tableName: order.tableName || '',
    total: Number((payment && payment.total) || 0),
    cashAmount: Number((payment && payment.cashAmount) || 0),
    cardAmount: Number((payment && payment.cardAmount) || 0),
    prepaid: Number((payment && payment.prepaid) || 0),
    tipAmount: Number((payment && payment.tipAmount) || 0),
    voen: cfg.voen || '',
    objectName: cfg.objectName || '',
    objectCode: cfg.objectCode || '',
    operator: cfg.operator || '',
    status: ready ? 'ready' : 'hold',
    message: ready
      ? 'Növbədədir. Rəsmi NMQ operatoru bağlı deyil — vergiyə göndərilmədi.'
      : 'VÖEN və obyekt yazın. Rəsmi operator yoxdur, vergiyə getmədi.'
  };
  box.nextId += 1;
  box.jobs.push(job);
  writeQueue(box);
  return job;
}

function listJobs() {
  return readQueue().jobs.slice().reverse();
}

module.exports = {
  enqueue: enqueue,
  listJobs: listJobs
};
