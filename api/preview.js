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

// ---- Dictado por voz: audio grabado en el navegador -> texto (Groq Whisper). Sin cuenta, con límites.
// Lo usan CURO Automate y curogroup.net (por eso permite ese origen).
const ALLOWED_ORIGINS = ['https://curogroup.net', 'https://www.curogroup.net', 'https://automate.curogroup.net'];
const TR_PER_IP_DAY = Number(process.env.TRANSCRIBE_PER_IP_DAY || 120);
const TR_GLOBAL_DAY = Number(process.env.TRANSCRIBE_GLOBAL_DAY || 1500);
async function transcribe(req, res) {
  const b = await readBody(req);
  const audio = String(b.audio || '');
  if (!audio) throw new HttpError(400, 'No llegó el audio. Inténtalo de nuevo.');
  const buf = Buffer.from(audio, 'base64');
  if (buf.length < 800) throw new HttpError(400, 'No te escuché. Toca el micrófono y habla de nuevo.');
  if (buf.length > 3.5 * 1024 * 1024) throw new HttpError(413, 'El audio es demasiado largo. Dicta en partes más cortas.');
  const ipHash = hash('t:' + clientIp(req));
  const [byIp, total] = await Promise.all([
    count2(`ip_hash=eq.${enc(ipHash)}&created_at=gte.${enc(since(864e5))}`),
    count2(`created_at=gte.${enc(since(864e5))}`)
  ]);
  if (byIp >= TR_PER_IP_DAY || total >= TR_GLOBAL_DAY) throw new HttpError(429, 'Hoy ya usaste mucho el dictado. Puedes seguir escribiendo.');
  await db.insert('automate_transcriptions', { ip_hash: ipHash, seconds: Math.round(Number(b.seconds) || 0) });
  const mime = /^audio\/[a-z0-9.+-]+/i.test(b.mime || '') ? String(b.mime).split(';')[0] : 'audio/webm';
  const ext = mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const lang = /^[a-z]{2}$/i.test(String(b.lang || '').slice(0, 2)) ? String(b.lang).slice(0, 2).toLowerCase() : 'es';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'dictado.' + ext);
  form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  form.append('language', lang);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('[transcribe]', r.status, j?.error?.message); throw new HttpError(502, 'No se pudo pasar la voz a texto ahora. Inténtalo de nuevo en un momento.'); }
  json(res, 200, { text: String(j.text || '').trim() });
}
async function count2(filter) { return (await db.select('automate_transcriptions', `${filter}&select=id&limit=2000`)).length; }

module.exports = handler(async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  if ((req.query?.op || new URL(req.url, 'https://x').searchParams.get('op')) === 'transcribe') return transcribe(req, res);
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
