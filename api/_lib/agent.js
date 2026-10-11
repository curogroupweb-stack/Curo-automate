// Agente IA personal de CURO: conversa con el usuario y mantiene su memoria (temas, pendientes,
// proyectos y agenda) para no empezar de cero cada vez. Cada mañana puede enviar un resumen por correo.
const { chat, extractJson } = require('./llm');
const { db, enc } = require('./db');
const { HttpError, SUPABASE_URL } = require('./http');
const { nextRun, madridToUtc } = require('./schedule');
const brevo = require('./brevo');
const { renderBranded } = require('./email_template');

const PROFILES = {
  docente: { label: 'Docente', focus: 'clases, planificación, evaluaciones, comunicación con familias y alumnos, materiales didácticos' },
  community: { label: 'Community manager', focus: 'calendario de publicaciones, campañas, clientes, métricas y tendencias en redes' },
  creador: { label: 'Creador de contenido', focus: 'ideas de contenido, guiones, calendario de publicación, colaboraciones con marcas y crecimiento de la audiencia' },
  emprendedor: { label: 'Emprendedor', focus: 'clientes, ventas, propuestas, seguimiento comercial, finanzas básicas y lanzamiento de productos' },
  autonomo: { label: 'Autónomo', focus: 'proyectos de clientes, entregas, presupuestos, facturas, impuestos y captación de clientes' },
  estudiante: { label: 'Estudiante', focus: 'plan de estudio, entregas, exámenes, apuntes y organización del tiempo' },
  pyme: { label: 'Pequeños equipos (pymes)', focus: 'tareas del equipo, reuniones, clientes, procesos internos e informes' },
  descubridor: { label: 'Descubridor', focus: 'intereses personales, cosas que quiere aprender, compras que está pensando, viajes, ideas y descubrimientos' }
};
const KINDS = ['memoria', 'pendiente', 'proyecto', 'agenda'];
const DAILY_LIMIT = Number(process.env.AGENT_DAILY_MESSAGES || 40);

const madridNow = () => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
const fmtDue = v => v ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '';

// "2026-10-14 17:30" o "2026-10-14" (hora de Madrid) -> ISO UTC
function parseDue(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = madridToUtc(+m[1], +m[2], +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
  return isNaN(d) ? null : d.toISOString();
}

async function loadState(userId) {
  const [settings, items, messages] = await Promise.all([
    db.one('agent_settings', `user_id=eq.${enc(userId)}&select=*`),
    db.select('agent_items', `user_id=eq.${enc(userId)}&select=*&order=status.asc,due_at.asc.nullslast,updated_at.desc&limit=200`),
    db.select('agent_messages', `user_id=eq.${enc(userId)}&select=role,content,created_at&order=created_at.desc&limit=30`)
  ]);
  return { settings, items, messages: messages.reverse() };
}

function itemsForPrompt(items) {
  const active = items.filter(i => i.status === 'activo');
  const out = [];
  for (const k of KINDS) {
    const list = active.filter(i => i.kind === k).slice(0, 40);
    if (!list.length) continue;
    out.push(`${k.toUpperCase()}:\n` + list.map(i => `- [${i.id.slice(0, 8)}] ${i.title}${i.detail ? ` — ${i.detail}` : ''}${i.due_at ? ` (fecha: ${fmtDue(i.due_at)})` : ''}`).join('\n'));
  }
  return out.join('\n\n') || '(todavía no hay nada guardado)';
}

function systemPrompt(st, name) {
  const p = PROFILES[st.settings.profile] || PROFILES.descubridor;
  return `Eres el agente IA personal de ${name || 'esta persona'} en CURO Group. Su perfil es: ${p.label} (te centras en ${p.focus}).
${st.settings.about ? `Lo que te contó de sí: ${st.settings.about}\n` : ''}${st.settings.goals ? `Sus objetivos: ${st.settings.goals}\n` : ''}${st.settings.tone ? `Tono que prefiere: ${st.settings.tone}\n` : ''}Fecha y hora actual (Madrid): ${madridNow()}.

TU MEMORIA DE ESTA PERSONA (úsala; no le hagas repetir lo que ya sabes):
${itemsForPrompt(st.items)}

CÓMO TRABAJAS
- Hablas en español, cercano y práctico, frases cortas. Sin Markdown (nada de asteriscos ni almohadillas); para listas usa "•".
- Recuerdas lo importante: guarda en memoria datos útiles y estables (sus proyectos, preferencias, temas recurrentes), apunta pendientes cuando diga que tiene que hacer algo, y citas con fecha en la agenda.
- Organiza proyectos por etapas y dile cuál es el siguiente paso.
- Si algo ya está hecho, márcalo como hecho. No dupliques lo que ya existe en la memoria: actualízalo.
- No inventes datos. Si falta información importante (por ejemplo la fecha de una entrega), pregúntala.
- Nunca guardes contraseñas, datos bancarios, de salud ni información sensible.
- Cuando tenga sentido, sugiere una automatización de CURO Automate (por ejemplo, un resumen semanal por correo).

RESPONDE SOLO CON ESTE JSON (sin texto fuera):
{"reply":"tu respuesta para la persona",
 "add":[{"kind":"memoria|pendiente|proyecto|agenda","title":"corto","detail":"opcional","due":"AAAA-MM-DD HH:MM opcional (hora de Madrid)"}],
 "done":["id de 8 caracteres de lo que ya está hecho"],
 "update":[{"id":"id de 8 caracteres","title":"opcional","detail":"opcional","due":"opcional"}]}`;
}

function resolveId(items, short) {
  const s = String(short || '').trim().toLowerCase();
  if (s.length < 6) return null;
  return items.find(i => i.id.toLowerCase().startsWith(s))?.id || null;
}

async function applyChanges(userId, st, out) {
  const changes = { added: 0, done: 0, updated: 0 };
  for (const a of (Array.isArray(out.add) ? out.add : []).slice(0, 10)) {
    const kind = KINDS.includes(a?.kind) ? a.kind : null;
    const title = String(a?.title || '').trim().slice(0, 300);
    if (!kind || !title) continue;
    if (st.items.some(i => i.status === 'activo' && i.kind === kind && i.title.toLowerCase() === title.toLowerCase())) continue;
    await db.insert('agent_items', { user_id: userId, kind, title, detail: a.detail ? String(a.detail).slice(0, 2000) : null, due_at: parseDue(a.due), source: 'agente' });
    changes.added++;
  }
  for (const short of (Array.isArray(out.done) ? out.done : []).slice(0, 10)) {
    const id = resolveId(st.items, short);
    if (!id) continue;
    await db.update('agent_items', `id=eq.${enc(id)}&user_id=eq.${enc(userId)}`, { status: 'hecho', updated_at: new Date().toISOString() });
    changes.done++;
  }
  for (const u of (Array.isArray(out.update) ? out.update : []).slice(0, 10)) {
    const id = resolveId(st.items, u?.id);
    if (!id) continue;
    const patch = { updated_at: new Date().toISOString() };
    if (u.title) patch.title = String(u.title).slice(0, 300);
    if (u.detail) patch.detail = String(u.detail).slice(0, 2000);
    if (u.due) patch.due_at = parseDue(u.due);
    await db.update('agent_items', `id=eq.${enc(id)}&user_id=eq.${enc(userId)}`, patch);
    changes.updated++;
  }
  return changes;
}

async function chatTurn(user, message, { isAdmin } = {}) {
  const text = String(message || '').trim().slice(0, 2000);
  if (!text) throw new HttpError(400, 'Escribe un mensaje.');
  const st = await loadState(user.id);
  if (!st.settings) throw new HttpError(400, 'Primero elige el perfil de tu agente.');
  if (!isAdmin) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const sent = await db.select('agent_messages', `user_id=eq.${enc(user.id)}&role=eq.user&created_at=gte.${enc(today.toISOString())}&select=id&limit=${DAILY_LIMIT + 1}`);
    if (sent.length >= DAILY_LIMIT) throw new HttpError(429, `Hoy ya has enviado ${DAILY_LIMIT} mensajes a tu agente. Mañana podrás seguir.`);
  }
  await db.insert('agent_messages', { user_id: user.id, role: 'user', content: text });
  const history = st.messages.slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
  const res = await chat({ system: systemPrompt(st, user.name), messages: [...history, { role: 'user', content: text }], maxTokens: 1500, temperature: 0.4 });
  const out = extractJson(res.text) || {};
  let reply = String(out.reply || '').trim();
  if (!reply) reply = String(res.text || '').replace(/^\s*\{[\s\S]*\}\s*$/, '').trim() || 'Perdona, no he podido responder ahora. ¿Me lo repites?';
  reply = reply.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').slice(0, 4000);
  const changes = await applyChanges(user.id, st, out);
  await db.insert('agent_messages', { user_id: user.id, role: 'assistant', content: reply });
  return { reply, changes };
}

async function saveSettings(userId, b) {
  const profile = PROFILES[b.profile] ? b.profile : null;
  if (!profile) throw new HttpError(400, 'Elige un perfil para tu agente.');
  const time = /^\d{2}:\d{2}$/.test(b.brief_time || '') ? b.brief_time : '08:00';
  const brief = b.brief_enabled !== false;
  const row = {
    user_id: userId, profile,
    about: b.about ? String(b.about).slice(0, 2000) : null,
    goals: b.goals ? String(b.goals).slice(0, 2000) : null,
    tone: b.tone ? String(b.tone).slice(0, 200) : null,
    brief_enabled: brief, brief_time: time,
    brief_next_at: brief ? nextRun({ frequency: 'daily', time }).toISOString() : null,
    updated_at: new Date().toISOString()
  };
  await db.upsert('agent_settings', row, 'user_id');
  return row;
}

async function itemOp(userId, b) {
  const now = new Date().toISOString();
  if (b.op === 'add') {
    const kind = KINDS.includes(b.kind) ? b.kind : null;
    const title = String(b.title || '').trim().slice(0, 300);
    if (!kind || !title) throw new HttpError(400, 'Escribe un título.');
    return db.insert('agent_items', { user_id: userId, kind, title, detail: b.detail ? String(b.detail).slice(0, 2000) : null, due_at: parseDue(b.due), source: 'usuario' });
  }
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Elemento no válido.');
  const where = `id=eq.${enc(id)}&user_id=eq.${enc(userId)}`;
  if (b.op === 'done') return db.update('agent_items', where, { status: 'hecho', updated_at: now });
  if (b.op === 'undo') return db.update('agent_items', where, { status: 'activo', updated_at: now });
  if (b.op === 'delete') return db.remove('agent_items', where);
  throw new HttpError(400, 'Acción no válida.');
}

async function userEmail(userId) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${enc(userId)}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return { email: u.email, name: u.user_metadata?.display_name || u.user_metadata?.name || (u.email || '').split('@')[0] };
}

// Resumen de la mañana: agenda de hoy y próximos días, pendientes y siguiente paso de cada proyecto.
async function buildBrief(userId, name) {
  const st = await loadState(userId);
  if (!st.settings) throw new HttpError(400, 'Primero elige el perfil de tu agente.');
  const p = PROFILES[st.settings.profile] || PROFILES.descubridor;
  const active = st.items.filter(i => i.status === 'activo');
  const soon = Date.now() + 7 * 864e5;
  const agenda = active.filter(i => i.due_at && new Date(i.due_at).getTime() <= soon).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const pend = active.filter(i => i.kind === 'pendiente');
  const proj = active.filter(i => i.kind === 'proyecto');
  const facts = [
    agenda.length ? 'PRÓXIMOS 7 DÍAS:\n' + agenda.map(i => `• ${fmtDue(i.due_at)}: ${i.title}`).join('\n') : '',
    pend.length ? 'PENDIENTES:\n' + pend.slice(0, 15).map(i => `• ${i.title}${i.due_at ? ` (para ${fmtDue(i.due_at)})` : ''}`).join('\n') : '',
    proj.length ? 'PROYECTOS:\n' + proj.slice(0, 10).map(i => `• ${i.title}${i.detail ? `: ${i.detail}` : ''}`).join('\n') : ''
  ].filter(Boolean).join('\n\n');
  let body = '';
  if (facts) {
    try {
      const res = await chat({
        system: `Eres el agente IA personal de ${name || 'esta persona'} (perfil ${p.label}). Escribe su resumen de la mañana en español, cercano y breve (máximo 180 palabras), sin Markdown: un saludo, lo más importante de hoy primero, luego lo que viene esta semana, los pendientes clave y el siguiente paso sugerido de cada proyecto. Usa solo estos datos, no inventes nada. Fecha actual: ${madridNow()}.`,
        messages: [{ role: 'user', content: facts }], maxTokens: 700, temperature: 0.4
      });
      body = String(res.text || '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
    } catch { body = ''; }
    if (!body) body = `Buenos días${name ? `, ${name}` : ''}.\n\nEsto es lo que tienes por delante:\n\n${facts}`;
  } else {
    body = `Buenos días${name ? `, ${name}` : ''}.\n\nTodavía no tengo pendientes ni citas tuyas. Cuéntame en qué estás trabajando y lo iré organizando por ti.`;
  }
  return body + '\n\nAbre tu agente: https://automate.curogroup.net/?ir=agente';
}

async function sendBrief(userId) {
  const u = await userEmail(userId);
  if (!u?.email) throw new HttpError(400, 'No encuentro el correo de esta cuenta.');
  const body = await buildBrief(userId, u.name);
  const subject = `Tu resumen de hoy · ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}`;
  if (!brevo.enabled()) throw new HttpError(500, 'El envío de correos de CURO no está configurado.');
  await brevo.send({ to: u.email, subject, body, html: renderBranded({ subject, body }) });
  return { to: u.email, subject, body };
}

module.exports = { PROFILES, loadState, chatTurn, saveSettings, itemOp, buildBrief, sendBrief, parseDue };
