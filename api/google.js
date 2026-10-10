// POST ?action=connect -> { url } para autorizar Gmail · POST ?action=disconnect
const { handler, json, query, requireUser, HttpError } = require('./_lib/http');
const { signState } = require('./_lib/crypto');
const google = require('./_lib/google');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const user = await requireUser(req);
  const action = query(req).action;
  if (action === 'connect') return json(res, 200, { url: google.authUrl(signState({ uid: user.id })) });
  if (action === 'disconnect') { await google.disconnect(user.id); return json(res, 200, { disconnected: true }); }
  throw new HttpError(400, 'Acción no válida.');
});
