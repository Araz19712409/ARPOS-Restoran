function result(ok, fiscalId, message, raw) {
  return {
    ok: !!ok,
    fiscalId: fiscalId ? String(fiscalId) : '',
    message: message ? String(message) : '',
    raw: raw || null
  };
}

function noneMsg() {
  return 'Fiskal aparat seçilməyib. Vergiyə getmədi.';
}

function emuMsg() {
  return 'Emulyator. Vergiyə getmədi.';
}

function emuId(jobId) {
  return 'emu-' + String(jobId || 0) + '-' + Date.now();
}

function emuSale(job) {
  return result(true, emuId(job && job.id), emuMsg(), { emulator: true });
}

function emuOk(extra) {
  return result(true, '', emuMsg(), Object.assign({ emulator: true }, extra || {}));
}

function isEmulator(cfg) {
  return !cfg || cfg.emulator !== false;
}

module.exports = {
  result: result,
  noneMsg: noneMsg,
  emuMsg: emuMsg,
  emuId: emuId,
  emuSale: emuSale,
  emuOk: emuOk,
  isEmulator: isEmulator
};
