// Planificador: convierte la petición del usuario (lenguaje natural) en un plan estructurado.
const { chat, extractJson } = require('./llm');
const { CATALOG, available } = require('./tools');
const { describe } = require('./schedule');

const TRIGGERS = ['manual', 'schedule', 'gmail_new_message', 'curo_new_user'];

function systemPrompt({ connections, isAdmin }) {
  const tools = Object.entries(CATALOG).map(([n, t]) =>
    `- ${n}: ${t.label}${t.needs && !connections[t.needs] ? ' (requiere conectar Google; aún NO conectado, pero puedes incluirla)' : ''}`).join('\n');
  return `Eres el planificador de CURO Automate, un servicio que automatiza tareas a personas sin conocimientos técnicos.
Tu trabajo: leer lo que el usuario quiere delegar y devolver un plan en JSON. No ejecutas nada.

DISPARADORES posibles (cómo empieza la automatización):
- manual: el usuario la ejecuta cuando quiere desde la app.
- schedule: se repite sola (cada hora, cada día, cada semana o cada mes) a una hora de Madrid.
- gmail_new_message: cada vez que llega un correo nuevo a su Gmail que cumpla un filtro de búsqueda de Gmail.
${isAdmin ? '- curo_new_user: cada vez que alguien se registra en la plataforma CURO (el evento trae nombre y email).' : '- (curo_new_user existe pero este usuario NO es administrador: no lo uses; si lo pide, explícalo en limitations.)'}

HERRAMIENTAS que podrá usar al ejecutarse:
${tools}

REGLAS
- Si la tarea envía correos a otras personas, approval debe ser "always" salvo que el usuario diga explícitamente que se envíe sin revisar.
- inputs: solo para disparador manual y solo datos que cambian en cada ejecución y no se pueden obtener con las herramientas. Máximo 4. Para otros disparadores, inputs = [].
- Si algo no se puede hacer con estas herramientas (WhatsApp, Instagram, pagos, Excel, calendario...), dilo en limitations y propone la parte que sí se puede. feasible=false solo si no se puede hacer nada útil.
- questions: máximo 2 preguntas imprescindibles; si se puede suponer algo razonable, supónlo y no preguntes.
- Escribe todo en español claro, sin jerga técnica. steps: 3 a 7 pasos cortos que entienda cualquiera.
- gmail_query usa la sintaxis de Gmail. Por defecto: "in:inbox -category:promotions -category:social -from:me".

Responde SOLO con este JSON:
{"name":"nombre corto","summary":"una frase de lo que hará","trigger":{"type":"manual|schedule|gmail_new_message|curo_new_user","frequency":"hourly|daily|weekly|monthly","time":"HH:MM","weekday":1,"monthday":1,"gmail_query":"..."},"steps":["..."],"tools":["..."],"inputs":[{"key":"tema","label":"Tema","type":"text"}],"approval":"always|never","output":"qué recibirá el usuario","feasible":true,"limitations":["..."],"questions":["..."]}`;
}

function normalize(raw, { connections, isAdmin, instruction }) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const t = p.trigger && typeof p.trigger === 'object' ? p.trigger : {};
  let type = TRIGGERS.includes(t.type) ? t.type : 'manual';
  const limitations = Array.isArray(p.limitations) ? p.limitations.filter(Boolean).map(String).slice(0, 5) : [];
  if (type === 'curo_new_user' && !isAdmin) {
    type = 'manual';
    limitations.push('La bienvenida automática a nuevos usuarios de CURO solo la pueden activar los administradores de CURO.');
  }
  const trigger = { type };
  if (type === 'schedule') {
    trigger.frequency = ['hourly', 'daily', 'weekly', 'monthly'].includes(t.frequency) ? t.frequency : 'daily';
    trigger.time = /^\d{1,2}:\d{2}$/.test(t.time || '') ? t.time.padStart(5, '0') : '09:00';
    if (trigger.frequency === 'weekly') trigger.weekday = Math.min(Math.max(parseInt(t.weekday, 10) || 1, 1), 7);
    if (trigger.frequency === 'monthly') trigger.monthday = Math.min(Math.max(parseInt(t.monthday, 10) || 1, 1), 28);
    trigger.label = describe(trigger);
  } else if (type === 'gmail_new_message') {
    trigger.gmail_query = String(t.gmail_query || 'in:inbox -category:promotions -category:social -from:me').slice(0, 300);
    if (!/-from:me/.test(trigger.gmail_query)) trigger.gmail_query += ' -from:me';
    trigger.label = 'Cuando llegue un correo nuevo';
  } else if (type === 'curo_new_user') {
    trigger.label = 'Cuando alguien se registre en CURO';
  } else trigger.label = 'Cuando la ejecutes desde la app';

  const tools = [...new Set((Array.isArray(p.tools) ? p.tools : []).filter(n => CATALOG[n]))];
  if (type === 'gmail_new_message') { if (!tools.includes('gmail_read')) tools.unshift('gmail_read'); }
  if (type === 'curo_new_user' && !tools.includes('gmail_send')) tools.push('gmail_send');
  const needsGoogle = tools.some(n => CATALOG[n].needs === 'google') || type === 'gmail_new_message';
  const sendsEmail = tools.includes('gmail_send');
  let approval = p.approval === 'never' ? 'never' : 'always';
  if (!sendsEmail) approval = 'never';

  const inputs = type === 'manual' && Array.isArray(p.inputs)
    ? p.inputs.slice(0, 4).map((x, i) => ({
        key: String(x.key || `dato${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30) || `dato${i + 1}`,
        label: String(x.label || x.key || `Dato ${i + 1}`).slice(0, 60),
        type: ['text', 'textarea', 'number', 'date', 'email'].includes(x.type) ? x.type : 'text'
      }))
    : [];

  return {
    name: String(p.name || 'Mi automatización').slice(0, 80),
    summary: String(p.summary || instruction).slice(0, 300),
    trigger,
    steps: (Array.isArray(p.steps) ? p.steps : []).map(String).filter(Boolean).slice(0, 8),
    tools,
    inputs,
    approval,
    output: String(p.output || 'Resultado de la tarea').slice(0, 200),
    feasible: p.feasible !== false,
    limitations,
    questions: (Array.isArray(p.questions) ? p.questions : []).map(String).filter(Boolean).slice(0, 2),
    requirements: { google: needsGoogle, google_connected: !!connections.google }
  };
}

async function plan(instruction, { connections, isAdmin }) {
  const ctx = { connections, isAdmin, instruction };
  const sys = systemPrompt(ctx);
  let res = await chat({ system: sys, messages: [{ role: 'user', content: `Petición del usuario:\n"""${instruction}"""` }], maxTokens: 1500 });
  let raw = extractJson(res.text);
  if (!raw) {
    res = await chat({ system: sys, messages: [
      { role: 'user', content: `Petición del usuario:\n"""${instruction}"""` },
      { role: 'assistant', content: res.text || '' },
      { role: 'user', content: 'Devuelve únicamente el JSON válido, sin texto adicional.' }
    ], maxTokens: 1500 });
    raw = extractJson(res.text);
  }
  if (!raw) throw Object.assign(new Error('La IA no pudo preparar un plan. Prueba a describir la tarea con otras palabras.'), { status: 502 });
  return normalize(raw, ctx);
}

module.exports = { plan, normalize, available };
