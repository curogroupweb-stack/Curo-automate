// Agente IA personal de CURO: conversa con el usuario y mantiene su memoria (temas, pendientes,
// proyectos y agenda) para no empezar de cero cada vez. Cada mañana puede enviar un resumen por correo.
const { chat, extractJson } = require('./llm');
const { db, enc } = require('./db');
const { HttpError, SUPABASE_URL } = require('./http');
const { nextRun, madridToUtc } = require('./schedule');
const brevo = require('./brevo');
const { renderBranded } = require('./email_template');
const google = require('./google');
const tools = require('./tools');

const PROFILES = {
  docente: { name: 'Bruno', label: 'Docente', focus: 'clases, planificación, evaluaciones, comunicación con familias y alumnos, materiales didácticos', expertise: [
    'Pedagogía: conoces principios generales (diseño de clases, evaluación formativa, atención a la diversidad) y los adaptas a la etapa que te cuente (infantil, primaria, secundaria, etc.).',
    'Currículo y normativa de su país: para el diseño curricular, los contenidos oficiales o cualquier normativa educativa, BUSCA la fuente oficial (ministerio o consejería de educación del país/región que te indique) antes de responder — nunca la inventes. Si no sabe su país o nivel todavía, pregúntaselo primero.',
    'Contenidos por materia: ayudas a preparar clases, actividades y evaluaciones de la materia que dé, adaptadas al nivel de sus alumnos.',
    'Parte administrativa: redactas boletines o informes de evaluación, comunicados para familias, y actas o guiones de reuniones (con otros docentes, con dirección, con familias) — listos para enviar o imprimir, no solo ideas sueltas.',
    'Si tiene Gmail conectado, puedes enviar esos boletines o comunicados directamente a quien corresponda (a otra persona siempre queda para que lo apruebe antes).',
    'Si tiene el Calendar conectado, puedes ver sus próximas reuniones y crear eventos (reuniones con familias, entrega de boletines, claustros); si invita a alguien más, la invitación queda pendiente de su aprobación.',
  ] },
  community: { name: 'Kai', label: 'Community manager', focus: 'calendario de publicaciones, campañas, clientes, métricas y tendencias en redes', expertise: [
    'Conoces buenas prácticas por red (Instagram, TikTok, LinkedIn, etc.): formatos, tono y mejores horarios de cada una.',
    'Ayudas a armar calendarios de publicación, ideas de contenido y respuestas tipo para comentarios o mensajes.',
    'Si te pide tendencias, referentes o datos actuales de una red, BÚSCALOS en internet en vez de inventarlos.',
  ] },
  creador: { name: 'Luna', label: 'Creador de contenido', focus: 'ideas de contenido, guiones, calendario de publicación, colaboraciones con marcas y crecimiento de la audiencia', expertise: [
    'Conoces formatos y tendencias de contenido (reels, shorts, newsletters) y cómo adaptar una misma idea a cada plataforma.',
    'Ayudas a guionizar, armar calendarios de publicación y preparar propuestas de colaboración con marcas.',
    'Si te pide tendencias o referentes actuales, BÚSCALOS en internet en vez de inventarlos.',
  ] },
  emprendedor: { name: 'Nico', label: 'Emprendedor', focus: 'clientes, ventas, propuestas, seguimiento comercial, finanzas básicas y lanzamiento de productos', expertise: [
    'Ayudas con propuestas comerciales, seguimiento de clientes y planes de lanzamiento, adaptados al tipo de negocio que te cuente.',
    'Para normativa, mercado o competencia de su país o sector, BUSCA información actual en vez de inventarla.',
    'Si tiene Gmail conectado, puedes redactar y enviar correos de seguimiento comercial (a otra persona queda para aprobar).',
  ] },
  autonomo: { name: 'Teo', label: 'Autónomo', focus: 'proyectos de clientes, entregas, presupuestos, facturas, impuestos y captación de clientes', expertise: [
    'Ayudas con presupuestos, propuestas y seguimiento de entregas a clientes.',
    'Para temas fiscales (impuestos, facturación, trámites), adapta la respuesta al país que te indique; si no lo sabe, pregúntalo antes de dar cifras o normas concretas, BUSCA la fuente oficial, y siempre aclara que no reemplaza a un gestor o asesor.',
    'Si tiene Gmail conectado, puedes redactar y enviar presupuestos o recordatorios de pago (a otra persona quedan para aprobar).',
  ] },
  estudiante: { name: 'Koa', label: 'Estudiante', focus: 'plan de estudio, entregas, exámenes, apuntes y organización del tiempo', expertise: [
    'Ayudas a armar planes de estudio, resumir materiales y prepararte para exámenes.',
    'Adaptas la técnica de estudio al tipo de materia (memorística, práctica, de redacción).',
    'Si necesita información actualizada para un trabajo, BÚSCALA en internet en vez de inventarla.',
  ] },
  pyme: { name: 'Félix', label: 'Dirección y pymes', focus: 'dirección de la empresa o del equipo: tareas del equipo, reuniones, clientes, decisiones, procesos internos e informes', expertise: [
    'Ayudas a organizar al equipo: tareas, reuniones, seguimiento de clientes y procesos internos.',
    'Preparas informes, actas de reunión y comunicados para el equipo o los clientes, listos para enviar.',
    'Si tiene Gmail conectado, puedes enviarlos (a otra persona quedan para aprobar).',
    'Si tiene el Calendar conectado, puedes ver y crear reuniones del equipo o con clientes (las invitaciones a terceros quedan pendientes de su aprobación).',
  ] },
  profesional: { name: 'Hachi', label: 'Profesionales', focus: 'citas y agenda, consultas de clientes o pacientes, seguimiento de casos, documentos, trámites y organización del día (médicos, abogados, psicólogos, secretarios, administrativos y otros profesionales)', rule: 'Ayudas con la agenda, los recordatorios y la organización, pero NUNCA guardes datos de salud, historias clínicas ni datos personales de pacientes o clientes: si te los cuenta, recuérdale amablemente que no los guardas y anota solo lo organizativo (por ejemplo "Consulta a las 10" sin nombre ni diagnóstico).', expertise: [
    'Ayudas con la agenda, los recordatorios de citas y la organización de trámites y documentos del día a día.',
    'Puedes redactar comunicados o recordatorios genéricos para enviar por correo (sin datos de salud ni personales de pacientes o clientes).',
    'Si tiene el Calendar conectado, puedes ver y crear citas (por ejemplo "Consulta 10:00", sin nombre ni motivo de la consulta); si invita a alguien, queda pendiente de su aprobación.',
    'Si tiene Drive conectado y compartió algún documento con su agente (desde Conexiones), puedes leerlo, y puedes guardar ahí los documentos que redactes (sin datos de salud ni personales de pacientes o clientes).',
  ] },
  descubridor: { name: 'Sandy', label: 'Descubridor', focus: 'intereses personales, cosas que quiere aprender, compras que está pensando, viajes, ideas y descubrimientos', expertise: [
    'Ayudas a investigar antes de decidir: comparar opciones, resumir opiniones y armar listas de recursos para aprender algo nuevo.',
    'Si pregunta por productos, precios o recomendaciones actuales, BÚSCALOS en internet en vez de inventarlos.',
  ] }
};
const KINDS = ['memoria', 'pendiente', 'proyecto', 'agenda'];
const DAILY_LIMIT = Number(process.env.AGENT_DAILY_MESSAGES || 18); // tope del plan gratis; ajustable sin tocar código

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
    db.select('agent_messages', `user_id=eq.${enc(userId)}&cleared=is.false&select=id,role,content,created_at&order=created_at.desc&limit=30`)
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

function systemPrompt(st, name, allowedTools = []) {
  const p = PROFILES[st.settings.profile] || PROFILES.descubridor;
  const toolsNote = allowedTools.length
    ? `\nHERRAMIENTAS DISPONIBLES: ${allowedTools.join(', ')}. Úsalas cuando de verdad ayuden a resolver lo que te pide (buscar algo real en internet, leer o enviar un correo suyo); si puedes responder bien con lo que ya sabes o con el texto que te dio, no las uses. Un correo a otra persona (no a él mismo) queda guardado para que lo apruebe antes de enviarse: díselo.`
    : `\nTODAVÍA NO TIENES HERRAMIENTAS CONECTADAS (por ejemplo, no tiene Gmail conectado). Si te pide algo que las necesite, explícale amablemente qué falta conectar; mientras tanto ayúdale igual con lo que puedas resolver solo pensando (traducir, resumir, redactar, explicar, dar ideas) usando el texto que te dé.`;
  const expertiseNote = (p.expertise || []).length ? `\nLO QUE SABES HACER EN TU RUBRO (${p.label}):\n${p.expertise.map(x => `- ${x}`).join('\n')}\n` : '';
  return `Te llamas ${p.name}, un agente AIA de CURO Group, y eres el agente IA personal de ${name || 'esta persona'}. Su perfil es: ${p.label} (te centras en ${p.focus}).
${p.rule ? `REGLA DE TU PERFIL: ${p.rule}\n` : ''}${st.settings.about ? `Lo que te contó de sí: ${st.settings.about}\n` : ''}${st.settings.goals ? `Sus objetivos: ${st.settings.goals}\n` : ''}${st.settings.tone ? `Tono que prefiere: ${st.settings.tone}\n` : ''}Fecha y hora actual (Madrid): ${madridNow()}.
${expertiseNote}
TU MEMORIA DE ESTA PERSONA (úsala; no le hagas repetir lo que ya sabes):
${itemsForPrompt(st.items)}

CÓMO TRABAJAS
- Hablas en español, cercano y práctico, frases cortas. Sin Markdown (nada de asteriscos ni almohadillas); para listas usa "•".
- No eres solo un cuaderno de notas: resuelve de verdad lo que te pida con la IA (traducir un texto, resumir, explicar, redactar, dar ideas, analizar algo que te pega) y no solo lo apuntes.
- No eres solo charla: cuando lo que pide es un documento (un boletín, un comunicado, un acta, un presupuesto, una propuesta), entrégaselo redactado y listo para usar — no un resumen de cómo hacerlo. Si además tiene Gmail conectado y te pide enviarlo, envíalo de verdad.
- Para currículo, normativa, impuestos, precios, tendencias o cualquier dato oficial o actual de un país o sector: si no lo sabes con certeza, BUSCA la fuente antes de responder — nunca lo inventes. Si no sabes en qué país o región está, pregúntaselo primero (no asumas).
- Recuerdas lo importante: guarda en memoria datos útiles y estables (sus proyectos, preferencias, temas recurrentes, su país o rubro si lo menciona), apunta pendientes cuando diga que tiene que hacer algo, y citas con fecha en la agenda.
- Organiza proyectos por etapas y dile cuál es el siguiente paso.
- Si algo ya está hecho, márcalo como hecho. No dupliques lo que ya existe en la memoria: actualízalo.
- No inventes datos. Si falta información importante (por ejemplo la fecha de una entrega o el país desde donde trabaja), pregúntala.
- Nunca guardes contraseñas, datos bancarios, de salud ni información sensible.
- Cuando tenga sentido, sugiere una automatización de CURO Automate (por ejemplo, un resumen semanal por correo).
${toolsNote}

CUANDO RESPONDAS DE FORMA NORMAL (no mientras llamas a una herramienta), RESPONDE SOLO CON ESTE JSON (sin texto fuera):
{"reply":"tu respuesta para la persona (puede ser larga si la tarea lo pide, por ejemplo una traducción o un resumen completos)",
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

// Herramientas que "Mi agente" puede usar en el chat (subconjunto de las de Automatizaciones:
// de momento sin curo_stats, que es solo para datos internos de la plataforma).
const AGENT_TOOLS = ['web_search', 'fetch_url', 'gmail_search', 'gmail_read', 'gmail_send', 'calendar_list_events', 'calendar_create_event', 'drive_list_files', 'drive_read_file', 'drive_save_file'];
const MAX_AGENT_TOOL_TURNS = 4;

async function agentConnections(userId) {
  const g = await google.status(userId).catch(() => ({ connected: false }));
  return { google: !!g.connected, email: g.email || '', google_calendar: !!g.canCalendar, google_drive: !!g.canDrive };
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
  const userMsg = await db.insert('agent_messages', { user_id: user.id, role: 'user', content: text });
  const history = st.messages.slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));

  const conn = await agentConnections(user.id);
  const allowed = AGENT_TOOLS.filter(n => tools.available({ google: conn.google, google_calendar: conn.google_calendar, google_drive: conn.google_drive }).includes(n));
  const defs = allowed.map(n => ({ name: n, description: tools.CATALOG[n].description, parameters: tools.CATALOG[n].parameters }));
  const p = PROFILES[st.settings.profile] || PROFILES.descubridor;
  const ctx = {
    userId: user.id, approvalMode: 'always', approvals: [],
    selfEmails: conn.email ? [conn.email.toLowerCase()] : [],
    automation: { name: `Chat con ${p.name}` }
  };

  const messages = [...history, { role: 'user', content: text }];
  const used = { web_search: 0, fetch_url: 0 };
  let res;
  for (let turn = 0; turn < MAX_AGENT_TOOL_TURNS; turn++) {
    res = await chat({ system: systemPrompt(st, user.name, allowed), messages, tools: defs, maxTokens: 1500, temperature: 0.4 });
    if (!res.tool_calls?.length) break;
    messages.push({ role: 'assistant', content: res.text || '', tool_calls: res.tool_calls });
    for (const call of res.tool_calls) {
      let result;
      if ((call.name === 'web_search' && used.web_search >= 2) || (call.name === 'fetch_url' && used.fetch_url >= 2)) {
        result = { error: 'Ya hiciste suficientes búsquedas o lecturas. Responde ya con lo que tienes.' };
      } else {
        if (call.name === 'web_search') used.web_search++;
        if (call.name === 'fetch_url') used.fetch_url++;
        try { result = await tools.execute(call.name, call.args || {}, ctx); }
        catch (e) { result = { error: e.message }; }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result ?? null).slice(0, 3500) });
    }
  }

  const out = extractJson(res.text) || {};
  let reply = String(out.reply || '').trim();
  if (!reply) reply = String(res.text || '').replace(/^\s*\{[\s\S]*\}\s*$/, '').trim() || 'Perdona, no he podido responder ahora. ¿Me lo repites?';
  reply = reply.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').slice(0, 4000);
  const changes = await applyChanges(user.id, st, out);
  const botMsg = await db.insert('agent_messages', { user_id: user.id, role: 'assistant', content: reply });
  return { reply, changes, userMsgId: userMsg?.id, botMsgId: botMsg?.id, pendingApprovals: ctx.approvals.length || undefined };
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
  // Apariencia: animal (personaje animado), persona-N (retrato IA) o sencillo (logo AIA).
  if (b.look !== undefined) row.look = /^(animal|sencillo|persona-[1-9])$/.test(String(b.look)) ? String(b.look) : 'animal';
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
        system: `Eres ${p.name}, el agente IA personal de ${name || 'esta persona'} (perfil ${p.label}). Escribe su resumen de la mañana en español, cercano y breve (máximo 180 palabras), sin Markdown: un saludo, lo más importante de hoy primero, luego lo que viene esta semana, los pendientes clave y el siguiente paso sugerido de cada proyecto. Usa solo estos datos, no inventes nada. Fecha actual: ${madridNow()}.`,
        messages: [{ role: 'user', content: facts }], maxTokens: 700, temperature: 0.4
      });
      body = String(res.text || '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
    } catch { body = ''; }
    if (!body) body = `Buenos días${name ? `, ${name}` : ''}.\n\nEsto es lo que tienes por delante:\n\n${facts}`;
  } else {
    body = `Buenos días${name ? `, ${name}` : ''}.\n\nTodavía no tengo pendientes ni citas tuyas. Cuéntame en qué estás trabajando y lo iré organizando por ti.`;
  }
  return body + `\n\n${p.name}, tu agente AIA de CURO` + '\n\nAbre tu agente: https://automate.curogroup.net/?ir=agente';
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

// Borra la conversación de la pantalla y de lo que el agente lee del chat.
// Se marca (no se elimina) para que el límite diario de mensajes siga contando bien.
async function clearChat(userId) {
  await db.update('agent_messages', `user_id=eq.${enc(userId)}&cleared=is.false`, { cleared: true });
}

// Borra un único mensaje (el usuario solo puede borrar los suyos, no las respuestas del agente
// directamente). Si el agente ya le había contestado a ese mensaje, esa respuesta también se
// borra, para que no quede descontextualizada en la pantalla.
async function deleteMessage(userId, id) {
  if (!/^\d+$/.test(String(id ?? ''))) throw new HttpError(400, 'Mensaje no válido.');
  const msg = await db.one('agent_messages', `id=eq.${enc(id)}&user_id=eq.${enc(userId)}&role=eq.user&select=id,created_at`);
  if (!msg) return { replyId: null };
  await db.update('agent_messages', `id=eq.${enc(id)}&user_id=eq.${enc(userId)}&role=eq.user`, { cleared: true });
  const reply = await db.one(
    'agent_messages',
    `user_id=eq.${enc(userId)}&role=eq.assistant&cleared=is.false&created_at=gt.${enc(msg.created_at)}&select=id&order=created_at.asc`
  );
  if (reply) await db.update('agent_messages', `id=eq.${enc(reply.id)}&user_id=eq.${enc(userId)}`, { cleared: true });
  return { replyId: reply?.id ?? null };
}

// Avisos de reunión: manda un correo cuando falta poco para un evento de la agenda (kind='agenda').
// Lo llama el motor (tick) cada 5 min; cada evento se avisa una sola vez (reminder_sent_at).
const REMINDER_MINUTES_BEFORE = 15;
async function sendDueReminders() {
  if (!brevo.enabled()) return 0;
  const now = Date.now();
  // Ventana de ~5 min centrada en "dentro de 15 minutos", para que no se escape ningún evento
  // entre una pasada del motor y la siguiente.
  const from = new Date(now + (REMINDER_MINUTES_BEFORE - 2) * 60000).toISOString();
  const to = new Date(now + (REMINDER_MINUTES_BEFORE + 3) * 60000).toISOString();
  const due = await db.select(
    'agent_items',
    `kind=eq.agenda&status=eq.activo&reminder_sent_at=is.null&due_at=gte.${enc(from)}&due_at=lte.${enc(to)}&select=id,user_id,title,detail,due_at&limit=50`
  );
  let sent = 0;
  for (const item of due) {
    // Reserva atómica: solo un tick manda el aviso de cada evento.
    const claimed = await db.update('agent_items', `id=eq.${enc(item.id)}&reminder_sent_at=is.null`, { reminder_sent_at: new Date().toISOString() });
    if (!claimed.length) continue;
    try {
      const u = await userEmail(item.user_id);
      if (!u?.email) continue;
      const subject = `En ${REMINDER_MINUTES_BEFORE} min: ${item.title}`;
      const body = `Hola${u.name ? `, ${u.name}` : ''}.\n\nTe recuerdo que tienes "${item.title}" a las ${fmtDue(item.due_at)}.${item.detail ? `\n\n${item.detail}` : ''}\n\nAbre tu agente: https://automate.curogroup.net/?ir=agente`;
      await brevo.send({ to: u.email, subject, body, html: renderBranded({ subject, body }) });
      sent++;
    } catch { /* seguimos con los demás aunque uno falle */ }
  }
  return sent;
}

module.exports = { PROFILES, loadState, clearChat, deleteMessage, chatTurn, saveSettings, itemOp, buildBrief, sendBrief, sendDueReminders, parseDue };
