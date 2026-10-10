// Conocimiento del negocio: GET · POST {title, body} · DELETE ?id=
const { handler, json, readBody, query, requireUser, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  if (req.method === 'GET') {
    return json(res, 200, { items: await db.select('automate_knowledge', `user_id=eq.${enc(user.id)}&select=*&order=created_at.desc`) });
  }
  if (req.method === 'POST') {
    const { title, body } = await readBody(req);
    if (!String(title || '').trim() || !String(body || '').trim()) throw new HttpError(400, 'Escribe un título y un contenido.');
    const row = await db.insert('automate_knowledge', { user_id: user.id, title: String(title).trim().slice(0, 120), body: String(body).trim().slice(0, 4000) });
    return json(res, 201, { item: row });
  }
  if (req.method === 'DELETE') {
    await db.remove('automate_knowledge', `id=eq.${enc(query(req).id)}&user_id=eq.${enc(user.id)}`);
    return json(res, 200, { deleted: true });
  }
  throw new HttpError(405, 'Método no permitido');
});
