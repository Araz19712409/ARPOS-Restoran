const db = require('./db');
const num = require('./num');

function readStore() {
  const raw = db.readOffice('customers.json');
  return {
    nextId: Number(raw.nextId) || 1,
    customers: Array.isArray(raw.customers) ? raw.customers : []
  };
}

function writeStore(data) {
  db.writeOffice('customers.json', data);
}

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 15);
}

function intPts(value) {
  const n = Math.round(Number(value) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function publicCustomer(row) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name || '',
    points: Math.max(0, Math.round(Number(row.points) || 0)),
    visits: Math.max(0, Math.round(Number(row.visits) || 0)),
    spentMinor: Math.max(0, Math.round(Number(row.spentMinor) || 0)),
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function pointsForPaid(cashMinor, cardMinor, cfg) {
  const per = Math.max(0, Math.round(Number(cfg && cfg.earnPer100) || 0));
  const paid = Math.max(0, Math.round(Number(cashMinor) || 0) + Math.round(Number(cardMinor) || 0));
  return Math.floor(paid / 10000) * per;
}

function pointValue(cfg) {
  const n = Math.round(Number(cfg && cfg.pointValueMinor) || 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function minRedeem(cfg) {
  const n = Math.round(Number(cfg && cfg.minRedeem) || 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function findRow(box, phone) {
  const key = cleanPhone(phone);
  return (box.customers || []).find(function (row) {
    return row.phone === key;
  }) || null;
}

function findByPhone(phone) {
  const key = cleanPhone(phone);
  if (key.length < 7) {
    return { error: 'Telefon ən azı 7 rəqəm.' };
  }
  const row = findRow(readStore(), key);
  if (!row) {
    return { error: 'Müştəri tapılmadı.', phone: key };
  }
  return { customer: publicCustomer(row) };
}

function search(query) {
  const raw = String(query || '').trim().toLowerCase();
  const qPhone = cleanPhone(query);
  const box = readStore();
  const list = (box.customers || []).filter(function (row) {
    if (!raw) {
      return true;
    }
    const name = String(row.name || '').toLowerCase();
    if (qPhone) {
      return String(row.phone).indexOf(qPhone) === 0 || name.indexOf(raw) >= 0;
    }
    return name.indexOf(raw) >= 0;
  });
  return list.slice(0, 40).map(publicCustomer);
}

function findOrCreate(phone, name) {
  const key = cleanPhone(phone);
  if (key.length < 7) {
    return { error: 'Telefon ən azı 7 rəqəm.' };
  }
  const box = readStore();
  const now = new Date().toISOString();
  let row = findRow(box, key);
  let created = false;
  if (!row) {
    row = {
      id: box.nextId,
      phone: key,
      name: String(name || '').trim().slice(0, 40),
      points: 0,
      visits: 0,
      spentMinor: 0,
      createdAt: now,
      updatedAt: now
    };
    box.nextId += 1;
    box.customers.push(row);
    created = true;
  } else if (name && String(name).trim()) {
    row.name = String(name).trim().slice(0, 40);
    row.updatedAt = now;
  }
  writeStore(box);
  return { customer: publicCustomer(row), created: created };
}

function amountFromPoints(points, cfg) {
  return num.fromMinor(intPts(points) * pointValue(cfg));
}

function pointsFromAmount(azn, cfg) {
  const value = pointValue(cfg);
  const need = num.toMinor(azn);
  if (need <= 0) {
    return 0;
  }
  return Math.floor(need / value);
}

function canRedeem(phone, points, cfg) {
  const pts = intPts(points);
  const minR = minRedeem(cfg);
  if (pts < minR) {
    return { error: 'Minimum ' + minR + ' ball.' };
  }
  const key = cleanPhone(phone);
  const row = findRow(readStore(), key);
  if (!row) {
    return { error: 'Müştəri tapılmadı.' };
  }
  if (Math.round(Number(row.points) || 0) < pts) {
    return { error: 'Balansda ' + Math.round(Number(row.points) || 0) + ' ball var.' };
  }
  return { ok: true, points: pts, amount: amountFromPoints(pts, cfg) };
}

function redeemPoints(phone, points, cfg) {
  const chk = canRedeem(phone, points, cfg);
  if (chk.error) {
    return chk;
  }
  const box = readStore();
  const row = findRow(box, cleanPhone(phone));
  row.points = Math.round(Number(row.points) || 0) - chk.points;
  row.updatedAt = new Date().toISOString();
  writeStore(box);
  return {
    customer: publicCustomer(row),
    points: chk.points,
    amount: chk.amount
  };
}

function restoreRedeemed(phone, points) {
  const pts = intPts(points);
  const key = cleanPhone(phone);
  if (!pts || key.length < 7) {
    return { skipped: true, points: 0 };
  }
  const made = findOrCreate(key, '');
  if (made.error) {
    return { error: made.error };
  }
  const box = readStore();
  const row = findRow(box, key);
  if (!row) {
    return { error: 'Müştəri tapılmadı.' };
  }
  row.points = Math.round(Number(row.points) || 0) + pts;
  row.updatedAt = new Date().toISOString();
  writeStore(box);
  return { customer: publicCustomer(row), points: pts };
}

function revokeEarned(phone, points) {
  const pts = intPts(points);
  const key = cleanPhone(phone);
  if (!pts || key.length < 7) {
    return { skipped: true, points: 0 };
  }
  const box = readStore();
  const row = findRow(box, key);
  if (!row) {
    return { skipped: true, points: 0, message: 'Müştəri yoxdur.' };
  }
  const have = Math.round(Number(row.points) || 0);
  const take = Math.min(have, pts);
  row.points = Math.max(0, have - take);
  row.updatedAt = new Date().toISOString();
  writeStore(box);
  return {
    customer: publicCustomer(row),
    points: take,
    requested: pts,
    clamped: take < pts
  };
}

function earnClosed(phone, cashMinor, cardMinor, cfg) {
  const key = cleanPhone(phone);
  if (key.length < 7) {
    return { skipped: true };
  }
  const pts = pointsForPaid(cashMinor, cardMinor, cfg);
  const paid = Math.max(0, Math.round(Number(cashMinor) || 0) + Math.round(Number(cardMinor) || 0));
  const box = readStore();
  const row = findRow(box, key);
  if (!row) {
    return { error: 'Müştəri tapılmadı.' };
  }
  row.points = Math.round(Number(row.points) || 0) + pts;
  row.visits = Math.round(Number(row.visits) || 0) + 1;
  row.spentMinor = Math.round(Number(row.spentMinor) || 0) + paid;
  row.updatedAt = new Date().toISOString();
  writeStore(box);
  return { customer: publicCustomer(row), earned: pts };
}

function adjustPoints(id, delta, reason, who) {
  const d = Math.round(Number(delta) || 0);
  if (!d) {
    return { error: 'Ball dəyişməsini yazın.' };
  }
  const note = String(reason || '').trim().slice(0, 80);
  if (!note) {
    return { error: 'Səbəbi yazın.' };
  }
  const box = readStore();
  const row = (box.customers || []).find(function (item) {
    return item.id === Number(id);
  });
  if (!row) {
    return { error: 'Müştəri tapılmadı.' };
  }
  const next = Math.round(Number(row.points) || 0) + d;
  if (next < 0) {
    return { error: 'Balans 0-dan aşağı düşməz.' };
  }
  row.points = next;
  row.updatedAt = new Date().toISOString();
  row.lastAdjust = { delta: d, reason: note, by: who || '', at: row.updatedAt };
  writeStore(box);
  return { customer: publicCustomer(row) };
}

module.exports = {
  cleanPhone: cleanPhone,
  pointsForPaid: pointsForPaid,
  amountFromPoints: amountFromPoints,
  pointsFromAmount: pointsFromAmount,
  findByPhone: findByPhone,
  search: search,
  findOrCreate: findOrCreate,
  canRedeem: canRedeem,
  redeemPoints: redeemPoints,
  restoreRedeemed: restoreRedeemed,
  revokeEarned: revokeEarned,
  earnClosed: earnClosed,
  adjustPoints: adjustPoints,
  publicCustomer: publicCustomer
};
