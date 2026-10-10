// GET ?status=pending · POST { id, decision: 'approve'|'reject', payload? }
const { handler, json, readBody, query, requireUser, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');
const google = require('./_lib/google');
const { isAdmin } = require('./_lib/account');
const { renderBranded } = require('./_lib/email_template');

async function refreshRunStatus(runId) {
  if (!runId) return;
  const pending = await db.select('automate_approvals', `run_id=eq.${enc(runId)}&status=eq.pending&select=id`);
  if (!pending.length) {
    await db.update('automate_runs', `id=eq.${enc(runId)}&status=eq.awaiting_approval`, { status: 'completed', finished_at: new Date().toISOString() });
  }
}

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);

  if (req.method === 'GET') {
    const status = query(req).status || 'pending';
    const rows = await db.select('automate_approvals',
      `user_id=eq.${enc(user.id)}${status === 'all' ? '' : `&status=eq.${enc(status)}`}&select=*,automate_automations(name)&order=created_at.desc&limit=100`);
    return json(res, 200, { approvals: rows });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const { id, decision, payload } = await readBody(req);
  const ap = await db.one('automate_approvals', `id=eq.${enc(id)}&user_id=eq.${enc(user.id)}&select=*`);
  if (!ap) throw new HttpError(404, 'No se encontró la aprobación.');
  if (ap.status !== 'pending') throw new HttpError(409, 'Esta aprobación ya se procesó. No se enviará dos veces.');

  if (decision === 'reject') {
    await db.update('automate_approvals', `id=eq.${enc(id)}`, { status: 'rejected', decided_at: new Date().toISOString() });
    await refreshRunStatus(ap.run_id);
    return json(res, 200, { status: 'rejected' });
  }
  if (decision !== 'approve') throw new HttpError(400, 'Decisión no válida.');

  // Bloqueo optimista: solo una petición puede pasar de pending a approved.
  const locked = await db.update('automate_approvals', `id=eq.${enc(id)}&status=eq.pending`, { status: 'approved', decided_at: new Date().toISOString() });
  if (!locked.length) throw new HttpError(409, 'Esta aprobación ya se está procesando.');

  const action = { ...ap.action_payload, ...(payload && typeof payload === 'object' ? {
    to: payload.to ?? ap.action_payload.to, subject: payload.subject ?? ap.action_payload.subject, body: payload.body ?? ap.action_payload.body
  } : {}) };
  try {
    if (ap.action_type !== 'gmail_send') throw new Error('Tipo de acción no soportado.');
    const brand = await isAdmin(user.id);
    const sent = await google.sendMessage(user.id, { ...action, html: brand ? renderBranded({ subject: action.subject, body: action.body }) : undefined });
    await db.update('automate_approvals', `id=eq.${enc(id)}`, { action_payload: action, result: { sent: true, ...sent } });
    await refreshRunStatus(ap.run_id);
    return json(res, 200, { status: 'approved', sent });
  } catch (e) {
    await db.update('automate_approvals', `id=eq.${enc(id)}`, { status: 'pending', decided_at: null, result: { error: e.message } });
    throw new HttpError(e.status || 400, e.message);
  }
});
