const fs = require('fs');
const path = require('path');
const store = require('./store');
const stock = require('./stock');

const CATALOG_FILE = path.join(__dirname, 'data', 'catalog.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'products');

// Hazır stansiyalar: sifariş bura gedəcək
function defaultStations() {
  return [
    { id: 1, name: 'Mətbəx' },
    { id: 2, name: 'Manqal' },
    { id: 3, name: 'Bar' }
  ];
}

// Kataloq faylını oxuyuruq
function readCatalog() {
  const raw = store.readJson(CATALOG_FILE);
  const stations = Array.isArray(raw.stations) && raw.stations.length
    ? raw.stations
    : defaultStations();
  const data = {
    nextGroupId: Number(raw.nextGroupId) || 1,
    nextProductId: Number(raw.nextProductId) || 1,
    nextStationId: Number(raw.nextStationId) || 4,
    soldOutDay: raw.soldOutDay || '',
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    stations: stations,
    products: Array.isArray(raw.products) ? raw.products : []
  };
  applySoldOutDay(data);
  return data;
}

function todayKey() {
  const now = new Date();
  return now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
}

function applySoldOutDay(data) {
  const today = todayKey();
  if (data.soldOutDay !== today) {
    (data.products || []).forEach(function (item) {
      item.soldOut = false;
    });
    data.soldOutDay = today;
  }
  return data;
}

// Kataloq faylını yazırıq
function writeCatalog(data) {
  applySoldOutDay(data);
  store.writeJson(CATALOG_FILE, data);
}

// Yüklənən şəkil qovluğunu hazırlayırıq
function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Base64 şəkli fayla yazırıq
function saveProductImage(productId, imageData) {
  const match = String(imageData || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    return { error: 'Şəkil PNG, JPG və ya WEBP olmalıdır.' };
  }
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    return { error: 'Şəkil 2 MB-dan böyük ola bilməz.' };
  }
  ensureUploadDir();
  const fileName = 'p-' + productId + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return { path: '/uploads/products/' + fileName };
}

// Boş tərkib sahəsini gələcək üçün saxlayırıq
function emptyCostFields() {
  return {
    buyPrice: null,
    costPrice: null,
    ingredients: []
  };
}

function parseChoiceList(list, max) {
  if (!Array.isArray(list)) {
    return [];
  }
  const out = [];
  list.slice(0, max || 12).forEach(function (row) {
    const name = String((row && row.name) || '')
      .replace(/<[^>]*>/g, '')
      .replace(/[<>&"'`\\]/g, '')
      .trim()
      .slice(0, 40);
    if (!name) {
      return;
    }
    const price = stock.parseDec(row.price);
    out.push({
      id: out.length + 1,
      name: name,
      price: Number.isFinite(price) ? Number(price.toFixed(2)) : 0,
      ingredients: stock.parseRecipe(row.ingredients)
    });
  });
  return out;
}

function parseModifiers(body) {
  return {
    portions: parseChoiceList(body && body.portions, 8),
    extras: parseChoiceList(body && body.extras, 16)
  };
}

function applyLineChoices(product, chosen) {
  const portions = Array.isArray(product.portions) ? product.portions : [];
  const extras = Array.isArray(product.extras) ? product.extras : [];
  const picks = [];
  let add = 0;
  if (portions.length) {
    const pid = Number(chosen && chosen.portionId);
    const portion = portions.find(function (row) { return row.id === pid; });
    if (!portion) {
      return { error: product.name + ': porsiya seçin.' };
    }
    picks.push({
      kind: 'portion',
      id: portion.id,
      name: portion.name,
      price: Number(portion.price) || 0,
      ingredients: stock.parseRecipe(portion.ingredients)
    });
    add += Number(portion.price) || 0;
  }
  const ids = Array.isArray(chosen && chosen.extraIds)
    ? chosen.extraIds.map(function (id) { return Number(id); })
    : [];
  extras.forEach(function (ex) {
    if (ids.indexOf(ex.id) === -1) {
      return;
    }
    picks.push({
      kind: 'extra',
      id: ex.id,
      name: ex.name,
      price: Number(ex.price) || 0,
      ingredients: stock.parseRecipe(ex.ingredients)
    });
    add += Number(ex.price) || 0;
  });
  return {
    modifiers: picks,
    salePrice: Number((Number(product.salePrice) + add).toFixed(2))
  };
}

function courseOf(product) {
  if (product && (product.course === 0 || product.course === '0')) {
    return 0;
  }
  const n = Number(product && product.course);
  if (n === 1 || n === 2) {
    return n;
  }
  if (Number(product && product.stationId) === 3) {
    return 0;
  }
  return 2;
}

function resolveQuotedPrice(product, picks, quote) {
  const now = salePriceNow(product);
  const first = applyLineChoices(Object.assign({}, product, { salePrice: now }), picks);
  if (first.error) {
    return first;
  }
  const want = Number(Number(quote).toFixed(2));
  if (!Number.isFinite(want)) {
    return first;
  }
  if (first.salePrice === want) {
    return first;
  }
  const bases = [Number(product.salePrice) || 0];
  const happy = Number(product.happyPrice);
  if (Number.isFinite(happy) && happy >= 0 && happy <= 10000) {
    bases.push(happy);
  }
  for (let i = 0; i < bases.length; i += 1) {
    const alt = applyLineChoices(
      Object.assign({}, product, { salePrice: Number(bases[i].toFixed(2)) }),
      picks
    );
    if (!alt.error && alt.salePrice === want) {
      return alt;
    }
  }
  return first;
}

function salePriceNow(product) {
  const base = Number(product && product.salePrice) || 0;
  const happy = Number(product && product.happyPrice);
  if (!Number.isFinite(happy) || happy < 0 || happy > 10000) {
    return Number(base.toFixed(2));
  }
  const from = Number(product && product.happyFrom);
  const to = Number(product && product.happyTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    return Number(base.toFixed(2));
  }
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const inRange = from <= to ? (h >= from && h < to) : (h >= from || h < to);
  return Number((inRange ? happy : base).toFixed(2));
}

function parseComboIds(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map(function (id) { return Number(id); })
    .filter(function (id) { return Number.isInteger(id) && id > 0; })
    .slice(0, 12);
}

function cleanBarcode(value) {
  return String(value || '').replace(/[^0-9A-Za-z\-]/g, '').slice(0, 32);
}

function parseAllergens(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .trim()
    .slice(0, 80);
}

function markText(item) {
  const names = (item && item.modifiers || []).map(function (row) { return row.name; });
  if (item && item.note) {
    names.push(item.note);
  }
  if (item && item.allergens) {
    names.push('Allergen: ' + item.allergens);
  }
  return names.join(', ');
}

module.exports = {
  readCatalog,
  writeCatalog,
  saveProductImage,
  emptyCostFields,
  parseModifiers,
  applyLineChoices,
  courseOf,
  salePriceNow,
  resolveQuotedPrice,
  parseComboIds,
  cleanBarcode,
  parseAllergens,
  markText
};
