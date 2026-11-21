// Motor 24/7. Lo llama Supabase (pg_cron) cada 5 minutos con una clave secreta.
// 1) Automatizaciones programadas que toca ejecutar.
// 2) Correos nuevos en Gmail para automatizaciones "cuando llegue un correo".
// 3) Altas nuevas en CURO para automatizaciones de bienvenida (solo administradores).
// 4) Resumen de la mañana del agente IA personal (brief diario).
// 5) Avisos por correo 15 minutos antes de cada evento de la agenda del agente IA personal.
const { json, query } = require('../_lib/http');
const { safeEqual } = require('../_lib/crypto');
const { db, enc } = require('../_lib/db');
const { nextRun } = require('../_lib/schedule');
const executor = require('../_lib/executor');
const google = require('../_lib/google');
const { isAdmin } = require('../_lib/account');
const agent = require('../_lib/agent');

const BUDGET_MS = 200000; // el motor se activa cada 5 min; dejamos margen para no solaparse

function authorized(req) {
  const secret = process.env.RUNNER_SECRET;
  if (!secret) return false;
  const h = req.headers.authorization || '';
  const given = req.headers['x-runner-secret'] || (h.startsWith('Bearer ') ? h.slice(7) : '') || query(req).key;
  return safeEqual(given, secret);
}

// Ventanas opcionales de consulta de Gmail. Sin configuración se conserva el comportamiento anterior.
// gmail_poll_minutes: intervalo mínimo, 5 a 1440 minutos.
// gmail_window_start / gmail_window_end: HH:MM en Europe/Madrid.
// gmail_weekdays_only: true para consultar únicamente de lunes a viernes.
function shouldPollGmail(automation, now = new Date()) {
  const config = automation.trigger_config || {};
  const interval = Number(config.gmail_poll_minutes);
  if (Number.isFinite(interval) && interval >= 5 && interval <= 1440 && automation.last_checked_at) {
    const elapsed = now.getTime() - new Date(automation.last_checked_at).getTime();
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < interval * 60000) return false;
  }
  const windowStart = config.gmail_window_start;
  const windowEnd = config.gmail_window_end;
  if (!config.gmail_weekdays_only && !windowStart && !windowEnd) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  if (config.gmail_weekdays_only && ['Sat', 'Sun'].includes(parts.weekday)) return false;
  const toMinutes = value => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return null;
    const [h, m] = String(value).split(':').map(Number);
    return h * 60 + m;
  };
  const start = toMinutes(windowStart);
  const end = toMinutes(windowEnd);
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  if (start !== null && end !== null) {
    if (start === end) return true; // 24 horas
    return start < end ? current >= start && current < end : current >= start || current < end;
  }
  if (start !== null && current < start) return false;
  if (end !== null && current >= end) return false;
  return true;
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
    const watchers = await db.select('automate_automations', `status=eq.active&trigger_type=eq.gmail_new_message&select=*&order=last_checked_at.asc.nullsfirst&limit=50`);
    let gmailChecks = 0;
    for (const a of watchers) {
      if (left() < 15000 || gmailChecks >= 5) break;
      if (!shouldPollGmail(a)) continue;
      gmailChecks++;
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

    // 4) Resumen de la mañana del agente IA personal
    report.agent_briefs = 0;
    const briefs = await db.select('agent_settings', `brief_enabled=eq.true&brief_next_at=lte.${enc(new Date().toISOString())}&select=user_id,brief_time,brief_next_at&order=brief_next_at.asc&limit=10`);
    for (const s of briefs) {
      if (left() < 15000) break;
      const next = nextRun({ frequency: 'daily', time: s.brief_time || '08:00' }, new Date()).toISOString();
      const claimed = await db.update('agent_settings', `user_id=eq.${enc(s.user_id)}&brief_next_at=eq.${enc(s.brief_next_at)}`, { brief_next_at: next });
      if (!claimed.length) continue;
      try { await agent.sendBrief(s.user_id); report.agent_briefs++; }
      catch (e) { report.errors.push(`agente ${s.user_id}: ${e.message}`); }
    }

    // 5) Avisos de reunión: correo 15 minutos antes de cada evento de la agenda
    try { report.agent_reminders = await agent.sendDueReminders(); }
    catch (e) { report.errors.push(`avisos agenda: ${e.message}`); }
  } catch (e) {
    report.errors.push(e.message);
  }
  json(res, 200, { ok: true, ms: Date.now() - started, ...report });
};
