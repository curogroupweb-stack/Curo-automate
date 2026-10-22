// POST { id, tester:{name,email}, device, answers, general, progress, finished }
// Guarda (o actualiza) las respuestas de la guía de prueba piloto de CURO (/piloto). No requiere cuenta.
// También expone el conocimiento del negocio del usuario (antes api/knowledge.js) bajo ?op=knowledge,
// para no sumar una función serverless más al límite del plan de Vercel.
const { handler, json, readBody, query, requireUser, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');

const clip = (v, n) => String(v ?? '').slice(0, n);

// ---------- Conocimiento del negocio (antes api/knowledge.js): GET · POST {title, body} · DELETE ?id= ----------
async function knowledgeOp(req, res) {
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
}

module.exports = handler(async (req, res) => {
  if (query(req).op === 'knowledge') return knowledgeOp(req, res);
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const b = await readBody(req);
  const id = clip(b.id, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(id)) throw new HttpError(400, 'Identificador de prueba no válido. Recarga la página.');
  const raw = JSON.stringify({ answers: b.answers || {}, general: b.general || {} });
  if (raw.length > 150000) throw new HttpError(413, 'Las respuestas son demasiado largas. Acorta algún comentario.');

  // Solo se guardan respuestas con el formato esperado.
  const answers = {};
  for (const [k, v] of Object.entries(b.answers || {}).slice(0, 300)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(k) || !v || typeof v !== 'object') continue;
    answers[k] = { status: clip(v.status, 20), note: clip(v.note, 1500) };
  }
  const general = {};
  for (const [k, v] of Object.entries(b.general || {}).slice(0, 20)) {
    if (/^[a-z0-9_-]{1,40}$/i.test(k)) general[k] = clip(v, 2000);
  }
  await db.upsert('curo_pilot_feedback', {
    id,
    tester_name: clip(b.tester?.name, 120),
    tester_email: clip(b.tester?.email, 160),
    device: clip(b.device, 200),
    answers, general,
    progress: Math.max(0, Math.min(100, parseInt(b.progress, 10) || 0)),
    finished: !!b.finished,
    updated_at: new Date().toISOString()
  }, 'id');
  json(res, 200, { ok: true });
});
