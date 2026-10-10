// Ejecutor: la IA realiza la automatización paso a paso usando herramientas reales.
const { chat } = require('./llm');
const tools = require('./tools');
const google = require('./google');
const { db, enc } = require('./db');
const { isAdmin } = require('./account');

const MAX_TURNS = 8;
const KEEP_FULL_TOOL_RESULTS = 2; // los resultados antiguos se resumen para ahorrar tokens

async function connectionsFor(userId) {
  const g = await google.status(userId).catch(() => ({ connected: false }));
  return { google: !!g.connected, email: g.email || '' };
}

async function knowledgeFor(userId) {
  const rows = await db.select('automate_knowledge', `user_id=eq.${enc(userId)}&select=title,body&order=created_at.desc&limit=20`).catch(() => []);
  return rows.map(k => `• ${k.title}: ${k.body}`).join('\n').slice(0, 4000);
}

function systemPrompt({ automation, knowledge, now, userEmail, brand }) {
  const plan = automation.plan || {};
  return `Eres el ejecutor de CURO Automate. Realizas automatizaciones reales en nombre del usuario usando las herramientas disponibles.

OBJETIVO DEL USUARIO (con sus palabras):
"""${automation.instruction}"""

PLAN APROBADO:
${(plan.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || '(sin pasos detallados)'}
Resultado esperado: ${plan.output || 'el resultado de la tarea'}

CONOCIMIENTO DEL NEGOCIO DEL USUARIO (úsalo; no inventes nada que no esté aquí o en las herramientas):
${knowledge || '(sin notas)'}

FECHA Y HORA ACTUAL (Madrid): ${now}
${brand ? 'ESTÁS ESCRIBIENDO EN NOMBRE DE CURO GROUP (Madrid, España). Email de contacto público: hola@curogroup.net (ponlo en las firmas e invita a escribir ahí; nunca des otro email de contacto). Eslogan: "Descubre lo que importa."\n' : ''}EMAIL DEL USUARIO: ${userEmail || '(desconocido)'} — cuando pida "envíame", "mándame" o "avísame", envía a este email.

REGLAS
- Usa las herramientas para obtener datos reales. Nunca inventes precios, datos personales, enlaces ni hechos.
- Si falta información imprescindible, no la inventes: explícalo en el resultado final.
- Para enviar correos usa gmail_send con un texto completo, cordial y listo para enviar, en el idioma del destinatario.
- No envíes correos a direcciones que no aparezcan en el evento, en los correos leídos o en la petición del usuario.
- Si el evento es un correo recibido: responde solo si lo escribió una persona con una consulta o petición real. Si es automático (notificaciones, avisos de sistemas, boletines, códigos de verificación, remitentes no-reply), no respondas: termina explicando que no requería respuesta.
- Al responder un correo recibido, usa gmail_send con reply_to_message_id igual al id del mensaje, para que la respuesta vaya en el mismo hilo.
- Sé eficiente: como máximo 3 búsquedas y 2 lecturas de páginas. No repitas llamadas iguales.
- Para noticias usa web_search con news=true: el título, el medio, la fecha y el enlace suelen bastar para resumir sin abrir las páginas.
- Nunca inventes enlaces: usa solo los que aparezcan en los resultados.
- Completa TODOS los pasos del plan, incluido el envío de correos si el plan lo indica, antes de terminar.
- Escribe en texto limpio, sin Markdown: nada de asteriscos, almohadillas ni tablas con barras. Para listas usa "•" o números, y separa bloques con líneas en blanco.
- Las fechas, siempre en hora de Madrid.
- Termina SIEMPRE llamando a "finish" con un título corto y el resultado completo para el usuario, en español.`;
}

function trimResult(value) {
  const s = JSON.stringify(value ?? null);
  return s.length > 3500 ? s.slice(0, 3500) + '…(recortado)' : s;
}

// Mantiene completos solo los últimos resultados de herramientas; los anteriores se acortan.
function compact(messages) {
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
  const old = new Set(toolIdx.slice(0, Math.max(0, toolIdx.length - KEEP_FULL_TOOL_RESULTS)));
  return messages.map((m, i) => (old.has(i) && m.content.length > 500 ? { ...m, content: m.content.slice(0, 500) + '…(resumido)' } : m));
}

// opts: { automation, userId, source, event, inputs, deadline }
async function run({ automation, userId, source = 'manual', event = {}, inputs = {}, deadline = Date.now() + 50000 }) {
  const runRow = await db.insert('automate_runs', {
    automation_id: automation.id, user_id: userId, trigger_source: source, trigger_event: event, inputs, status: 'running'
  });
  const steps = [];
  const usage = { input: 0, output: 0, turns: 0 };
  const ctx = { userId, automation, runId: runRow.id, approvalMode: automation.approval_mode || 'always', approvals: [] };
  const finishRun = async patch => {
    const row = { steps, usage, finished_at: new Date().toISOString(), ...patch };
    await db.update('automate_runs', `id=eq.${runRow.id}`, row);
    await db.update('automate_automations', `id=eq.${automation.id}`, {
      last_run_at: new Date().toISOString(), last_error: patch.status === 'failed' ? patch.error : null, updated_at: new Date().toISOString()
    });
    return { ...runRow, ...row };
  };

  try {
    const connections = await connectionsFor(userId);
    if (connections.email) ctx.selfEmails = [connections.email.toLowerCase()];
    ctx.brand = await isAdmin(userId); // la cuenta de CURO Group envía con la plantilla de marca
    const allowed = (automation.plan?.tools || []).filter(n => tools.available(connections).includes(n));
    const missing = (automation.plan?.tools || []).filter(n => !allowed.includes(n));
    if (missing.some(n => tools.CATALOG[n]?.needs === 'google')) {
      return finishRun({ status: 'failed', error: 'Gmail no está conectado. Conéctalo en Conexiones y vuelve a ejecutar.' });
    }
    const defs = tools.definitions(allowed);
    const now = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
    const system = systemPrompt({ automation, knowledge: await knowledgeFor(userId), now, userEmail: connections.email, brand: ctx.brand });
    const first = [
      Object.keys(inputs || {}).length ? `Datos de esta ejecución:\n${Object.entries(inputs).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '',
      event && Object.keys(event).length ? `Evento que ha iniciado la automatización:\n${JSON.stringify(event).slice(0, 6000)}` : '',
      'Realiza la automatización ahora.'
    ].filter(Boolean).join('\n\n');
    const messages = [{ role: 'user', content: first }];

    const planSends = allowed.includes('gmail_send') && automation.trigger_type !== 'gmail_new_message';
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (Date.now() > deadline) throw new Error('La ejecución tardó demasiado y se detuvo por seguridad.');
      // En los últimos pasos, si el plan manda un correo y aún no se ha hecho, obligamos a escribirlo ya.
      let turnDefs = defs;
      const sentAlready = steps.some(s => s.tool === 'gmail_send');
      if (planSends && !sentAlready && turn >= MAX_TURNS - 3) {
        turnDefs = defs.filter(d => ['gmail_send', 'finish'].includes(d.function?.name || d.name));
        if (!ctx.forced) {
          ctx.forced = true;
          messages.push({ role: 'user', content: 'Ya tienes información suficiente. No busques más: redacta ahora el correo completo con lo que has encontrado y envíalo con gmail_send. Después llama a finish.' });
        }
      }
      const res = await chat({ system, messages: compact(messages), tools: turnDefs, maxTokens: 1600, deadline });
      usage.input += res.usage.input; usage.output += res.usage.output; usage.turns++;

      if (!res.tool_calls.length) {
        // El modelo respondió sin herramientas: lo tratamos como resultado final.
        const status = ctx.approvals.length ? 'awaiting_approval' : 'completed';
        return finishRun({ status, result_title: automation.name, result_body: res.text || 'Ejecución completada.' });
      }
      messages.push({ role: 'assistant', content: res.text || '', tool_calls: res.tool_calls });

      for (const call of res.tool_calls) {
        if (call.name === 'finish') {
          const sentSomething = steps.some(s => s.tool === 'gmail_send');
          if (planSends && !sentSomething && !ctx.nudged && turn < MAX_TURNS - 1) {
            ctx.nudged = true;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Todavía no has hecho el envío por correo que indica el plan. Llama ahora a gmail_send con el resultado completo (al email del usuario si es para él) y después a finish.' }) });
            continue;
          }
          const status = ctx.approvals.length ? 'awaiting_approval' : 'completed';
          steps.push({ tool: 'finish', at: new Date().toISOString() });
          return finishRun({ status, result_title: String(call.args.title || automation.name).slice(0, 200), result_body: String(call.args.body || '') });
        }
        const started = Date.now();
        let result, ok = true;
        const used = steps.filter(st => st.tool === call.name).length;
        if (!allowed.includes(call.name)) { result = { error: `La herramienta ${call.name} no está disponible en esta automatización.` }; ok = false; }
        else if ((call.name === 'web_search' && used >= 3) || (call.name === 'fetch_url' && used >= 2)) {
          result = { error: 'Ya has hecho las búsquedas y lecturas permitidas. Usa la información que ya tienes y continúa con el siguiente paso del plan.' }; ok = false;
        }
        else {
          try { result = await tools.execute(call.name, call.args || {}, ctx); }
          catch (e) { result = { error: e.message }; ok = false; }
        }
        steps.push({ tool: call.name, args: redact(call.args), ok, ms: Date.now() - started, preview: preview(result), at: new Date().toISOString() });
        messages.push({ role: 'tool', tool_call_id: call.id, content: trimResult(result) });
      }
    }
    const status = ctx.approvals.length ? 'awaiting_approval' : 'completed';
    return finishRun({ status, result_title: automation.name, result_body: 'La automatización alcanzó el número máximo de pasos. Revisa el detalle de los pasos realizados.' });
  } catch (e) {
    // Si las acciones importantes ya se hicieron (p. ej. el correo se envió), no lo marcamos como fallo.
    const done = steps.filter(st => st.ok && st.tool === 'gmail_send');
    if (done.length) {
      const status = ctx.approvals.length ? 'awaiting_approval' : 'completed';
      return finishRun({ status, result_title: automation.name, result_body: `Tarea realizada: ${done.map(st => `correo para ${st.args?.to} («${st.args?.subject}»)`).join(', ')}.\n\nNota: la IA no pudo redactar el resumen final (${e.message}).` });
    }
    return finishRun({ status: 'failed', error: e.message || String(e) });
  }
}

function redact(args = {}) {
  const a = { ...args };
  if (a.body && a.body.length > 400) a.body = a.body.slice(0, 400) + '…';
  return a;
}
function preview(r) {
  if (r?.error) return 'Error: ' + r.error;
  if (Array.isArray(r)) return `${r.length} resultado(s)`;
  if (r?.status) return String(r.status);
  if (r?.subject) return `Correo: ${r.subject}`;
  if (r?.text) return `${r.text.length} caracteres leídos`;
  return 'Hecho';
}

module.exports = { run, connectionsFor };
