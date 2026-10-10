// POST { instruction } -> plan estructurado generado por la IA.
const { handler, json, readBody, requireUser, HttpError } = require('./_lib/http');
const { plan } = require('./_lib/planner');
const { connectionsFor } = require('./_lib/executor');
const { isAdmin } = require('./_lib/account');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const user = await requireUser(req);
  const { instruction } = await readBody(req);
  const text = String(instruction || '').trim();
  if (text.length < 8) throw new HttpError(400, 'Describe con un poco más de detalle qué quieres automatizar.');
  if (text.length > 3000) throw new HttpError(400, 'La descripción es demasiado larga (máximo 3.000 caracteres).');
  const [connections, admin] = await Promise.all([connectionsFor(user.id), isAdmin(user.id)]);
  json(res, 200, { plan: await plan(text, { connections, isAdmin: admin }) });
});
