// POST { automation_id, inputs } -> ejecuta ahora una automatización (prueba o uso manual).
const { handler, json, readBody, requireUser, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');
const executor = require('./_lib/executor');
const google = require('./_lib/google');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const user = await requireUser(req);
  const { automation_id, inputs } = await readBody(req);
  const a = await db.one('automate_automations', `id=eq.${enc(automation_id)}&user_id=eq.${enc(user.id)}&select=*`);
  if (!a) throw new HttpError(404, 'No se encontró la automatización.');

  const cleanInputs = {};
  for (const f of a.plan?.inputs || []) {
    const v = String(inputs?.[f.key] ?? '').trim();
    if (!v) throw new HttpError(400, `Falta completar: ${f.label}.`);
    cleanInputs[f.label] = v.slice(0, 2000);
  }

  // En pruebas manuales de disparadores por evento, usamos un evento de ejemplo realista.
  let event = {};
  if (a.trigger_type === 'gmail_new_message') {
    const msgs = await google.searchMessages(user.id, a.trigger_config?.gmail_query || 'in:inbox', 1);
    if (!msgs.length) throw new HttpError(400, 'No hay ningún correo que cumpla el filtro para probar. Envíate uno y vuelve a intentarlo.');
    event = { type: 'gmail_new_message', message: msgs[0], note: 'Prueba manual con el correo más reciente que cumple el filtro.' };
  } else if (a.trigger_type === 'curo_new_user') {
    event = { type: 'curo_new_user', test: true, name: user.name, email: user.email, note: 'Prueba manual: se usa tu propia cuenta como si fuera un usuario nuevo.' };
  }

  const result = await executor.run({ automation: a, userId: user.id, source: 'manual', event, inputs: cleanInputs, deadline: Date.now() + 52000 });
  json(res, 200, { run: result });
});
