// Motor 24/7. Lo llama Supabase (pg_cron) cada 5 minutos con una clave secreta.
// 1) Automatizaciones programadas que toca ejecutar.
// 2) Correos nuevos en Gmail para automatizaciones "cuando llegue un correo".
// 3) Altas nuevas en CURO para automatizaciones de bienvenida (solo administradores).
const { json, query } = require('../_lib/http');
const { safeEqual } = require('../_lib/crypto');
const { db, enc } = require('../_lib/db');
const { nextRun } = require('../_lib/schedule');
const executor = require('../_lib/executor');
const google = require('../_lib/google');
const { isAdmin } = require('../_lib/account');

const BUDGET_MS = 50000;

function authorized(req) {
  const secret = process.env.RUNNER_SECRET;
  if (!secret) return false;
  const h = req.headers.authorization || '';
  const given = req.headers['x-runner-secret'] || (h.startsWith('Bearer ') ? h.slice(7) : '') || query(req).key;
  return safeEqual(given, secret);
}

async function claimDelivery(automationId, externalId) {
  return db.insertIgnore('automate_deliveries', { automation_id: automationId, external_id: String(externalId) });
}

module.exports = async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: 'No autorizado' });
  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);
  const report = { schedule: 0, gmail: 0, curo_new_user: 0, errors: [] };
  const runOne = async (a, source, event) => {
    const r = await executor.run({ automation: a, userId: a.user_id, source, event, deadline: started + BUDGET_MS });
    report[source]++;
    return r;
  };

  try {
    // 1) Programadas
    const nowIso = new Date().toISOString();
    const due = await db.select('automate_automations', `status=eq.active&trigger_type=eq.schedule&next_run_at=lte.${enc(nowIso)}&select=*&order=next_run_at.asc&limit=5`);
    for (const a of due) {
      if (left() < 15000) break;
      const next = nextRun(a.trigger_config, new Date()).toISOString();
      // Reserva atómica: solo un tick puede mover next_run_at desde su valor actual.
      const claimed = await db.update('automate_automations', `id=eq.${a.id}&next_run_at=eq.${enc(a.next_run_at)}`, { next_run_at: next });
      if (!claimed.length) continue;
      try { await runOne(a, 'schedule', { type: 'schedule', scheduled_for: a.next_run_at }); }
      catch (e) { report.errors.push(`${a.id}: ${e.message}`); }
    }

    // 2) Gmail: correos nuevos
    const watchers = await db.select('automate_automations', `status=eq.active&trigger_type=eq.gmail_new_message&select=*&order=last_checked_at.asc.nullsfirst&limit=5`);
    for (const a of watchers) {
      if (left() < 15000) break;
      try {
        const since = new Date(a.last_checked_at || a.created_at).getTime() - 15 * 60 * 1000;
        const q = `${a.trigger_config?.gmail_query || 'in:inbox -from:me'} after:${Math.floor(since / 1000)}`;
        const msgs = (await google.searchMessages(a.user_id, q, 5)).reverse();
        let processed = 0, pendingLeft = false;
        for (const m of msgs) {
          if (processed >= 2 || left() < 15000) { pendingLeft = true; break; }
          if (!(await claimDelivery(a.id, `gmail:${m.id}`))) continue;
          await runOne(a, 'gmail', { type: 'gmail_new_message', message: m });
          processed++;
        }
        if (!pendingLeft) await db.update('automate_automations', `id=eq.${a.id}`, { last_checked_at: new Date().toISOString(), last_error: null });
      } catch (e) {
        report.errors.push(`${a.id}: ${e.message}`);
        await db.update('automate_automations', `id=eq.${a.id}`, { last_error: e.message, last_checked_at: new Date().toISOString() }).catch(() => {});
      }
    }

    // 3) Altas nuevas en CURO
    const welcomers = await db.select('automate_automations', `status=eq.active&trigger_type=eq.curo_new_user&select=*&limit=5`);
    for (const a of welcomers) {
      if (left() < 15000) break;
      if (!(await isAdmin(a.user_id))) continue;
      const events = await db.select('automate_events', `event_type=eq.curo_new_user&created_at=gte.${enc(a.created_at)}&select=*&order=created_at.asc&limit=10`);
      let processed = 0;
      for (const ev of events) {
        if (processed >= 3 || left() < 15000) break;
        if (!ev.payload?.email) continue;
        if (!(await claimDelivery(a.id, `curo_user:${ev.id}`))) continue;
        try { await runOne(a, 'curo_new_user', { type: 'curo_new_user', name: ev.payload.name, email: ev.payload.email, registered_at: ev.created_at }); processed++; }
        catch (e) { report.errors.push(`${a.id}: ${e.message}`); }
      }
    }
  } catch (e) {
    report.errors.push(e.message);
  }
  json(res, 200, { ok: true, ms: Date.now() - started, ...report });
};
