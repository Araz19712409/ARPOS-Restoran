function parseDec(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  const raw = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
  if (!raw || raw === '.' || raw === '-' || raw === '-.') {
    return NaN;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = {
  parseDec: parseDec
};
