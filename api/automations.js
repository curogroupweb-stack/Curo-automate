// GET lista · POST crear · PATCH ?id= actualizar · DELETE ?id= eliminar
const { handler, json, readBody, query, requireUser, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');
const { normalize } = require('./_lib/planner');
const { nextRun } = require('./_lib/schedule');
const { connectionsFor } = require('./_lib/executor');
const { isAdmin } = require('./_lib/account');

const MAX_PER_USER = Number(process.env.MAX_AUTOMATIONS_PER_USER || 20);
// Cupo por plan (Gratis 3, Plus 15, Pro 50 en total, aunque se borren): lo controla la base de datos (curo_automations_limit).

function rowFromPlan(plan) {
  const t = plan.trigger || { type: 'manual' };
  const config = { ...t }; delete config.type;
  return {
    name: plan.name,
    plan,
    trigger_type: t.type,
    trigger_config: config,
    approval_mode: plan.approval,
    next_run_at: t.type === 'schedule' ? nextRun(config).toISOString() : null,
    last_checked_at: t.type === 'gmail_new_message' || t.type === 'curo_new_user' ? new Date().toISOString() : null
  };
}

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  const q = query(req);

  if (req.method === 'GET') {
    const q = query(req);
    if (q.runs) {
      // Historial de ejecuciones (antes /api/runs; unido aquí por el límite de funciones del plan de Vercel).
      let qs = `user_id=eq.${enc(user.id)}&order=started_at.desc&limit=${Math.min(Number(q.limit) || 50, 200)}`;
      if (q.automation_id) qs += `&automation_id=eq.${enc(q.automation_id)}`;
      if (q.id) qs += `&id=eq.${enc(q.id)}`;
      qs += '&select=*,automate_automations(name)';
      return json(res, 200, { runs: await db.select('automate_runs', qs) });
    }
    const rows = await db.select('automate_automations', `user_id=eq.${enc(user.id)}&select=*&order=created_at.desc`);
    return json(res, 200, { automations: rows });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const instruction = String(body.instruction || '').trim();
    if (!instruction || !body.plan) throw new HttpError(400, 'Falta la descripción o el plan.');
    const count = (await db.select('automate_automations', `user_id=eq.${enc(user.id)}&select=id`)).length;
    const [connections, admin] = await Promise.all([connectionsFor(user.id), isAdmin(user.id)]);
    if (count >= MAX_PER_USER) throw new HttpError(403, `Has llegado al máximo de ${MAX_PER_USER} automatizaciones. Elimina alguna para crear otra.`);
    // Re-normalizamos en el servidor: el navegador no puede saltarse las reglas (p. ej. curo_new_user solo admin).
    const plan = normalize(body.plan, { connections, isAdmin: admin, instruction });
    if (body.plan.approval === 'never' && plan.tools.includes('gmail_send')) plan.approval = 'never';
    let row;
    try { row = await db.insert('automate_automations', { user_id: user.id, instruction, status: 'active', ...rowFromPlan(plan) }); }
    catch (e) {
      const m = String(e && e.message || e);
      const lim = m.match(/LIMITE_AUTOMATIZACIONES[^0-9]*(\d+)/);
      if (lim) throw new HttpError(403, `Tu plan incluye ${lim[1]} automatizaciones en total (borrar una no devuelve la plaza). Para crear más, mira los planes Plus y Pro en curogroup.net → Mi cuenta → Ver planes.`);
      throw e;
    }
    return json(res, 201, { automation: row });
  }

  const id = q.id;
  if (!id) throw new HttpError(400, 'Falta el id.');
  const current = await db.one('automate_automations', `id=eq.${enc(id)}&user_id=eq.${enc(user.id)}&select=*`);
  if (!current) throw new HttpError(404, 'No se encontró la automatización.');

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const patch = { updated_at: new Date().toISOString() };
    if (body.status === 'active' || body.status === 'paused') {
      patch.status = body.status;
      if (body.status === 'active' && current.trigger_type === 'schedule') patch.next_run_at = nextRun(current.trigger_config).toISOString();
      if (body.status === 'active' && current.trigger_type === 'gmail_new_message') patch.last_checked_at = new Date().toISOString();
    }
    if (body.approval_mode === 'always' || body.approval_mode === 'never') {
      patch.approval_mode = body.approval_mode;
      patch.plan = { ...current.plan, approval: body.approval_mode };
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      patch.name = body.name.trim().slice(0, 80);
      patch.plan = { ...(patch.plan || current.plan), name: patch.name };
    }
    const [row] = await db.update('automate_automations', `id=eq.${enc(id)}&user_id=eq.${enc(user.id)}`, patch);
    return json(res, 200, { automation: row });
  }

  if (req.method === 'DELETE') {
    await db.remove('automate_automations', `id=eq.${enc(id)}&user_id=eq.${enc(user.id)}`);
    return json(res, 200, { deleted: true });
  }

  throw new HttpError(405, 'Método no permitido');
});
