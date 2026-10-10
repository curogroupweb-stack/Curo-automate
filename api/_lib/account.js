const { db, enc } = require('./db');

async function isAdmin(userId) {
  const p = await db.one('profiles', `id=eq.${enc(userId)}&select=role`).catch(() => null);
  return p?.role === 'admin';
}

module.exports = { isAdmin };
