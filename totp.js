const crypto = require('crypto');

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encode32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i += 1) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPH[(value << (5 - bits)) & 31];
  }
  return out;
}

function decode32(text) {
  const raw = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const idx = ALPH.indexOf(raw[i]);
    if (idx < 0) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const key = decode32(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 15;
  const bin = ((hmac[off] & 127) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  const code = String(bin % 1000000);
  return ('000000' + code).slice(-6);
}

function totpAt(secret, ms) {
  return hotp(secret, Math.floor(ms / 30000));
}

function makeSecret() {
  return encode32(crypto.randomBytes(20));
}

function otpauth(name, secret) {
  const label = encodeURIComponent('Arpos:' + String(name || 'kassa').slice(0, 40));
  return 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=Arpos&digits=6&period=30';
}

function verify(secret, code, at) {
  const want = String(code || '').replace(/\D/g, '');
  if (!secret || want.length !== 6) {
    return false;
  }
  const now = at || Date.now();
  for (let i = -1; i <= 1; i += 1) {
    if (totpAt(secret, now + i * 30000) === want) {
      return true;
    }
  }
  return false;
}

module.exports = {
  makeSecret: makeSecret,
  otpauth: otpauth,
  totpAt: totpAt,
  verify: verify
};
