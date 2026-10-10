// Estado de la cuenta: usuario, conexiones, proveedor de IA y contadores.
const { handler, json, requireUser } = require('./_lib/http');
const { db, enc } = require('./_lib/db');
const google = require('./_lib/google');
const llm = require('./_lib/llm');
const { isAdmin } = require('./_lib/account');

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  const [g, admin, autos, pending] = await Promise.all([
    google.status(user.id).catch(() => ({ connected: false })),
    isAdmin(user.id),
    db.select('automate_automations', `user_id=eq.${enc(user.id)}&select=id,status`),
    db.select('automate_approvals', `user_id=eq.${enc(user.id)}&status=eq.pending&select=id`)
  ]);
  json(res, 200, {
    user: { ...user, is_admin: admin },
    connections: { google: g },
    ai: llm.info(),
    counts: { automations: autos.length, active: autos.filter(a => a.status === 'active').length, pending_approvals: pending.length }
  });
});
