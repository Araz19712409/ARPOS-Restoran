const db = require('./db');
const store = require('./store');

function file() {
  return db.dataFile('gifts.json');
}

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function readStore() {
  try {
    const raw = store.readJson(file());
    return {
      nextId: Number(raw.nextId) || 1,
      cards: Array.isArray(raw.cards) ? raw.cards : []
    };
  } catch (error) {
    return { nextId: 1, cards: [] };
  }
}

function writeStore(data) {
  store.writeJson(file(), data);
}

function cleanCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase().slice(0, 16);
}

function add(code, amount, who) {
  const key = cleanCode(code);
  const sum = money(amount);
  if (key.length < 4) {
    return { error: 'Kart kodu ən azı 4 simvol.' };
  }
  if (!Number.isFinite(sum) || sum <= 0) {
    return { error: 'Məbləğ düzgün deyil.' };
  }
  const box = readStore();
  let card = box.cards.find(function (row) { return row.code === key; });
  if (!card) {
    card = {
      id: box.nextId,
      code: key,
      balance: 0,
      createdAt: new Date().toISOString()
    };
    box.nextId += 1;
    box.cards.push(card);
  }
  card.balance = money(card.balance + sum);
  card.updatedAt = new Date().toISOString();
  card.by = who || '';
  writeStore(box);
  return { card: { code: card.code, balance: card.balance } };
}

function redeem(code, amount) {
  const key = cleanCode(code);
  const need = money(amount);
  if (key.length < 4) {
    return { error: 'Hədiyyə kartı kodunu yazın.' };
  }
  if (!Number.isFinite(need) || need <= 0) {
    return { error: 'Hədiyyə məbləği düzgün deyil.' };
  }
  const box = readStore();
  const card = box.cards.find(function (row) { return row.code === key; });
  if (!card) {
    return { error: 'Hədiyyə kartı tapılmadı.' };
  }
  if (money(card.balance) + 0.001 < need) {
    return { error: 'Kartda ' + money(card.balance).toFixed(2) + ' AZN qalıb.' };
  }
  card.balance = money(card.balance - need);
  card.updatedAt = new Date().toISOString();
  writeStore(box);
  return { card: { code: card.code, balance: card.balance }, amount: need };
}

function lookup(code) {
  const key = cleanCode(code);
  const box = readStore();
  const card = box.cards.find(function (row) { return row.code === key; });
  if (!card) {
    return { error: 'Kart tapılmadı.' };
  }
  return { card: { code: card.code, balance: money(card.balance) } };
}

function restore(code, amount) {
  const key = cleanCode(code);
  const sum = money(amount);
  if (key.length < 4) {
    return { error: 'Hədiyyə kartı kodunu yazın.' };
  }
  if (!Number.isFinite(sum) || sum <= 0) {
    return { error: 'Bərpa məbləği düzgün deyil.' };
  }
  const box = readStore();
  let card = box.cards.find(function (row) { return row.code === key; });
  if (!card) {
    card = {
      id: box.nextId,
      code: key,
      balance: 0,
      createdAt: new Date().toISOString()
    };
    box.nextId += 1;
    box.cards.push(card);
  }
  card.balance = money(card.balance + sum);
  card.updatedAt = new Date().toISOString();
  writeStore(box);
  return { card: { code: card.code, balance: card.balance }, amount: sum };
}

module.exports = {
  add: add,
  redeem: redeem,
  restore: restore,
  lookup: lookup
};
