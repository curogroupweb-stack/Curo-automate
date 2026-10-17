// Bandeja inicial de prospectos del MVP. Solo administradores de CURO pueden acceder.
const { handler, json, readBody, query, requireUser, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');
const { isAdmin } = require('./_lib/account');

const CHANNELS = ['web', 'email', 'instagram', 'tiktok', 'linkedin', 'youtube', 'telefono', 'referido', 'campana', 'otro'];
const STATUSES = ['nuevo', 'pendiente', 'contactado', 'diagnostico', 'propuesta', 'cliente', 'descartado'];

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function normalize(body, partial = false) {
  const out = {};
  const fields = {
    contact_name: 120, email: 254, phone: 40, organization_name: 180,
    sector: 120, process_affected: 160, problem: 3000, desired_outcome: 1500,
    source_detail: 300, notes: 3000, campaign: 160
  };
  for (const [key, max] of Object.entries(fields)) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, key)) out[key] = clean(body[key], max) || null;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'channel')) {
    out.channel = CHANNELS.includes(body.channel) ? body.channel : 'otro';
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'status')) {
    out.status = STATUSES.includes(body.status) ? body.status : 'nuevo';
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'consent_contact')) {
    out.consent_contact = body.consent_contact === true;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'next_follow_up_at')) {
    const d = body.next_follow_up_at ? new Date(body.next_follow_up_at) : null;
    if (body.next_follow_up_at && (!d || Number.isNaN(d.getTime()))) throw new HttpError(400, 'La fecha de seguimiento no es válida.');
    out.next_follow_up_at = d ? d.toISOString() : null;
  }
  return out;
}

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  if (!(await isAdmin(user.id))) throw new HttpError(403, 'La bandeja de prospectos es solo para el equipo administrador de CURO.');
  const q = query(req);

  if (req.method === 'GET') {
    const status = clean(q.status, 30);
    const channel = clean(q.channel, 30);
    const search = clean(q.search, 120);
    let qs = 'select=*&order=updated_at.desc&limit=300';
    if (STATUSES.includes(status)) qs += '&status=eq.' + enc(status);
    if (CHANNELS.includes(channel)) qs += '&channel=eq.' + enc(channel);
    if (search) {
      const s = enc(search);
      qs += `&or=(contact_name.ilike.*${s}*,email.ilike.*${s}*,organization_name.ilike.*${s}*,sector.ilike.*${s}*)`;
    }
    return json(res, 200, { leads: await db.select('automate_leads', qs), statuses: STATUSES, channels: CHANNELS });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const data = normalize(body);
    if (!data.contact_name && !data.email && !data.organization_name) {
      throw new HttpError(400, 'Indica al menos un nombre, correo o empresa.');
    }
    const row = await db.insert('automate_leads', { ...data, created_by: user.id, updated_by: user.id });
    return json(res, 201, { lead: row });
  }

  const id = clean(q.id, 80);
  if (!id) throw new HttpError(400, 'Falta el identificador del prospecto.');

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const patch = { ...normalize(body, true), updated_by: user.id, updated_at: new Date().toISOString() };
    const [row] = await db.update('automate_leads', `id=eq.${enc(id)}`, patch);
    if (!row) throw new HttpError(404, 'No se encontró el prospecto.');
    return json(res, 200, { lead: row });
  }
  if (req.method === 'DELETE') {
    await db.remove('automate_leads', `id=eq.${enc(id)}`);
    return json(res, 200, { deleted: true });
  }
  throw new HttpError(405, 'Método no permitido');
});
