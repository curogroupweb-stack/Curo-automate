// Catálogo de herramientas que la IA puede usar al ejecutar una automatización.
// Cada herramienta declara qué conexión necesita; el planificador solo ofrece las disponibles.
const google = require('./google');
const { db } = require('./db');

const CATALOG = {
  gmail_search: {
    needs: 'google',
    label: 'Buscar correos en Gmail',
    description: 'Busca correos en el Gmail del usuario con la sintaxis de búsqueda de Gmail (por ejemplo "is:unread from:cliente@x.com newer_than:2d"). Devuelve remitente, asunto, fecha y un extracto.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] }
  },
  gmail_read: {
    needs: 'google',
    label: 'Leer un correo',
    description: 'Lee el contenido completo de un correo por su id (obtenido de gmail_search o del evento).',
    parameters: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] }
  },
  gmail_send: {
    needs: 'google',
    label: 'Enviar correo por Gmail',
    description: 'Envía un correo desde el Gmail del usuario. Si la automatización requiere aprobación, el correo queda como borrador pendiente y el usuario lo aprueba antes de enviarlo. Para responder, pasa reply_to_message_id.',
    parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, reply_to_message_id: { type: 'string' } }, required: ['to', 'subject', 'body'] }
  },
  web_search: {
    needs: null,
    label: 'Buscar en internet',
    description: 'Busca información actual en internet. Devuelve títulos, enlaces y extractos. Usa fetch_url para leer una página concreta.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  fetch_url: {
    needs: null,
    label: 'Leer una página web',
    description: 'Descarga una página web pública y devuelve su texto (máximo unos 8.000 caracteres).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  }
};

const FINISH = {
  name: 'finish',
  description: 'Termina la ejecución. Llama a esta herramienta SIEMPRE al final, con un título corto y el resultado completo para el usuario, en español.',
  parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] }
};

function available(connections) {
  return Object.entries(CATALOG).filter(([, t]) => !t.needs || connections[t.needs]).map(([name]) => name);
}

function definitions(names) {
  return [...names.filter(n => CATALOG[n]).map(n => ({ name: n, description: CATALOG[n].description, parameters: CATALOG[n].parameters })), FINISH];
}

// ---------- Implementaciones ----------
function isPublicUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.includes(':') && !h.includes('.')) return false;
    return true;
  } catch { return false; }
}

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

async function webSearch(query) {
  if (process.env.TAVILY_API_KEY) {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 6 })
    });
    const j = await r.json();
    return (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 300) }));
  }
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; CuroAutomate/1.0)', 'accept-language': 'es-ES,es;q=0.9' }
  });
  const html = await r.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    out.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3]).slice(0, 300) });
  }
  if (!out.length) return { error: 'La búsqueda no devolvió resultados ahora mismo. Prueba con otra consulta o lee una web concreta con fetch_url.' };
  return out;
}

async function fetchUrl(url) {
  if (!isPublicUrl(url)) return { error: 'Solo se pueden leer páginas web públicas (http/https).' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; CuroAutomate/1.0)' } });
    const type = r.headers.get('content-type') || '';
    if (!/text|html|json|xml/.test(type)) return { error: `La página no es texto (${type || 'tipo desconocido'}).` };
    const text = await r.text();
    return { url: r.url, status: r.status, text: (/html/.test(type) ? htmlToText(text) : text).slice(0, 8000) };
  } catch (e) {
    return { error: 'No se pudo leer la página: ' + (e.name === 'AbortError' ? 'tardó demasiado' : e.message) };
  } finally { clearTimeout(timer); }
}

// ctx: { userId, automation, runId, approvalMode, approvals:[] }
async function execute(name, args, ctx) {
  switch (name) {
    case 'gmail_search': return google.searchMessages(ctx.userId, args.query, args.max_results || 5);
    case 'gmail_read': return google.readMessage(ctx.userId, args.message_id);
    case 'gmail_send': {
      if (ctx.approvalMode === 'always') {
        const ap = await db.insert('automate_approvals', {
          run_id: ctx.runId, automation_id: ctx.automation?.id || null, user_id: ctx.userId,
          action_type: 'gmail_send',
          action_payload: { to: args.to, subject: args.subject, body: args.body, reply_to_message_id: args.reply_to_message_id || null },
          summary: `Correo para ${args.to}: ${args.subject}`
        });
        ctx.approvals.push(ap.id);
        return { status: 'pendiente_de_aprobacion', note: 'El correo se ha guardado como borrador. El usuario lo revisará y lo enviará desde Aprobaciones. No lo vuelvas a crear.' };
      }
      const sent = await google.sendMessage(ctx.userId, args);
      return { status: 'enviado', ...sent };
    }
    case 'web_search': return webSearch(args.query);
    case 'fetch_url': return fetchUrl(args.url);
    default: return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { CATALOG, available, definitions, execute, isPublicUrl, htmlToText };
