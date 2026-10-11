// POST { id, tester:{name,email}, device, answers, general, progress, finished }
// Guarda (o actualiza) las respuestas de la guía de prueba piloto de CURO (/piloto). No requiere cuenta.
const { handler, json, readBody, HttpError } = require('./_lib/http');
const { db } = require('./_lib/db');

const clip = (v, n) => String(v ?? '').slice(0, n);

module.exports = handler(async (req, res) => {
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
