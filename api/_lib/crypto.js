// Cifrado de permisos OAuth y firma del "state" de Google.
const crypto = require('crypto');

function key() {
  const raw = process.env.TOKEN_ENC_KEY || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!raw) throw new Error('Falta TOKEN_ENC_KEY');
  return crypto.createHash('sha256').update(raw).digest();
}

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj))), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

function open(v) {
  try {
    const b = Buffer.from(String(v), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
  } catch { return null; }
}

// state = base64url(json{uid,ts,n}).firma — caduca a los 10 minutos.
function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now(), n: crypto.randomBytes(9).toString('base64url') })).toString('base64url');
  const sig = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(v) {
  const [body, sig, extra] = String(v || '').split('.');
  if (!body || !sig || extra) return null;
  const expected = crypto.createHmac('sha256', key()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    const age = Date.now() - Number(p.ts);
    return age >= 0 && age <= 10 * 60 * 1000 ? p : null;
  } catch { return null; }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

module.exports = { seal, open, signState, verifyState, safeEqual };
