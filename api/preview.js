// POST { instruction, device } -> vista previa SIN cuenta: plan + ejemplo ilustrativo del resultado.
// No envía correos, no guarda la automatización y no toca cuentas externas: la IA trabaja sin herramientas.
// Control de gasto: 1 vista previa por dispositivo (30 días), máximo diario por IP y tope global diario.
const crypto = require('crypto');
const { handler, json, readBody, HttpError } = require('./_lib/http');
const { db, enc } = require('./_lib/db');
const { plan } = require('./_lib/planner');
const { chat } = require('./_lib/llm');

const MAX_LEN = 600;
const PER_DEVICE = Number(process.env.PREVIEW_PER_DEVICE || 1);      // en 30 días
const PER_IP_DAY = Number(process.env.PREVIEW_PER_IP_DAY || 3);
const GLOBAL_DAY = Number(process.env.PREVIEW_GLOBAL_DAY || 200);
const LIMIT_MSG = 'Para seguir probando, crea tu cuenta gratis.';

const hash = v => crypto.createHmac('sha256', process.env.TOKEN_ENC_KEY || 'curo-preview').update(String(v)).digest('hex').slice(0, 32);
const since = ms => new Date(Date.now() - ms).toISOString();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'desconocida').split(',')[0].trim();
}

async function count(filter) {
  const rows = await db.select('automate_previews', `${filter}&select=id&limit=1000`);
  return rows.length;
}

async function exampleResult(instruction, p) {
  const sys = `Eres CURO Automate. Muestras a un visitante un EJEMPLO ILUSTRATIVO de lo que recibiría si activa su automatización.
Reglas:
- Escribe en español, en texto limpio (sin Markdown, sin asteriscos ni almohadillas). Para listas usa "•".
- Es un ejemplo verosímil y breve (máximo 180 palabras). No uses datos reales de personas ni enlaces reales: si hace falta un enlace, escribe "(enlace a la noticia)".
- No inventes precios ni datos concretos de un negocio real; usa marcadores como [tu servicio] si hace falta.
- Si el resultado es un correo, empieza con "Asunto: ..." y después el cuerpo.`;
  const res = await chat({
    system: sys,
    messages: [{ role: 'user', content: `Petición: """${instruction}"""\nPlan: ${p.summary}\nResultado esperado: ${p.output}\n\nEscribe ahora el ejemplo.` }],
    maxTokens: 500, temperature: 0.5
  });
  return String(res.text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').trim().slice(0, 2000);
}

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const { instruction, device } = await readBody(req);
  const text = String(instruction || '').trim();
  if (text.length < 8) throw new HttpError(400, 'Describe con un poco más de detalle qué quieres automatizar.');
  if (text.length > MAX_LEN) throw new HttpError(400, `Para la prueba sin cuenta, describe la tarea en menos de ${MAX_LEN} caracteres.`);
  const deviceId = String(device || '').slice(0, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(deviceId)) throw new HttpError(400, 'No se pudo identificar el navegador. Recarga la página e inténtalo de nuevo.');

  const deviceHash = hash('d:' + deviceId), ipHash = hash('i:' + clientIp(req));
  const [byDevice, byIp, total] = await Promise.all([
    count(`device_hash=eq.${enc(deviceHash)}&created_at=gte.${enc(since(30 * 864e5))}`),
    count(`ip_hash=eq.${enc(ipHash)}&created_at=gte.${enc(since(864e5))}`),
    count(`created_at=gte.${enc(since(864e5))}`)
  ]);
  if (byDevice >= PER_DEVICE || byIp >= PER_IP_DAY || total >= GLOBAL_DAY) {
    return json(res, 429, { error: LIMIT_MSG, limit: true });
  }
  // Se cuenta antes de llamar a la IA para que reintentos simultáneos no se salten el límite.
  await db.insert('automate_previews', { device_hash: deviceHash, ip_hash: ipHash });

  const p = await plan(text, { connections: { google: false, email: '' }, isAdmin: false });
  let example = '';
  if (p.feasible) {
    try { example = await exampleResult(text, p); } catch { example = ''; }
  }
  json(res, 200, { plan: p, example });
});
