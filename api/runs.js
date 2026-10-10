// GET ?automation_id=&id=&limit= -> historial de ejecuciones del usuario.
const { handler, json, query, requireUser } = require('./_lib/http');
const { db, enc } = require('./_lib/db');

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  const q = query(req);
  let qs = `user_id=eq.${enc(user.id)}&order=started_at.desc&limit=${Math.min(Number(q.limit) || 50, 200)}`;
  if (q.automation_id) qs += `&automation_id=eq.${enc(q.automation_id)}`;
  if (q.id) qs += `&id=eq.${enc(q.id)}`;
  qs += '&select=*,automate_automations(name)';
  json(res, 200, { runs: await db.select('automate_runs', qs) });
});
