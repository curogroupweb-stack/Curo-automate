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
    description: 'Envía un correo desde el Gmail del usuario. Los correos al propio usuario se envían al momento. Si van a otra persona y la automatización requiere aprobación, el correo queda como borrador pendiente y el usuario lo aprueba antes de enviarlo. Para responder, pasa reply_to_message_id.',
    parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, reply_to_message_id: { type: 'string' } }, required: ['to', 'subject', 'body'] }
  },
  web_search: {
    needs: null,
    label: 'Buscar en internet',
    description: 'Busca en internet. Con news=true busca NOTICIAS recientes (Google Noticias: título, medio, fecha y enlace; normalmente basta con eso para resumir). Con news=false busca páginas web en general. Usa consultas cortas (3-6 palabras), en el idioma del tema.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, news: { type: 'boolean' } }, required: ['query'] }
  },
  fetch_url: {
    needs: null,
    label: 'Leer una página web',
    description: 'Lee el texto de una página web pública (máximo unos 4.000 caracteres). Usa SOLO enlaces que hayan aparecido en resultados de búsqueda o que haya dado el usuario; nunca inventes direcciones.',
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

function decodeEntities(t) {
  return String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
function rssItems(xml, max = 6) {
  const out = [];
  const items = String(xml).match(/<item[\s\S]*?<\/item>/g) || [];
  for (const it of items.slice(0, max)) {
    const tag = n => decodeEntities((it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)) || [])[1] || '').trim();
    out.push({ title: htmlToText(tag('title')), url: tag('link'), source: htmlToText(tag('source')) || undefined, date: tag('pubDate') || undefined, snippet: htmlToText(tag('description')).slice(0, 220) || undefined });
  }
  return out.filter(x => x.title && x.url);
}
async function getText(url, ms = 9000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; CuroAutomate/1.0)', 'accept-language': 'es-ES,es;q=0.9,en;q=0.6' } });
    return r.ok ? await r.text() : '';
  } catch { return ''; } finally { clearTimeout(t); }
}
async function googleNews(query) {
  const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`);
  return rssItems(xml, 8).map(x => ({ ...x, snippet: undefined }));
}
async function bingWeb(query) {
  const xml = await getText(`https://www.bing.com/search?format=rss&setlang=es&cc=ES&q=${encodeURIComponent(query)}`);
  return rssItems(xml, 6);
}
async function ddgLite(query) {
  const html = await getText('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query));
  const out = []; const re = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g; let m;
  while ((m = re.exec(html)) && out.length < 6) {
    let url = m[1]; const u = url.match(/uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    out.push({ title: htmlToText(m[2]), url });
  }
  return out;
}

async function webSearch(query, news) {
  query = String(query || '').slice(0, 200);
  if (process.env.TAVILY_API_KEY) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 6, topic: news ? 'news' : 'general' })
      });
      const j = await r.json();
      if (j.results?.length) return j.results.map(x => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 220) }));
    } catch {}
  }
  const order = news ? [googleNews, bingWeb] : [bingWeb, ddgLite, googleNews];
  for (const fn of order) {
    const res = await fn(query);
    if (res.length) return res;
  }
  return { error: 'La búsqueda no devolvió resultados. Prueba con una consulta más corta o más general. No inventes enlaces.' };
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
    if (r.status >= 400) return { error: `La página respondió con error ${r.status}. Prueba con otro enlace de los resultados.` };
    return { url: r.url, text: (/html/.test(type) ? htmlToText(text) : text).slice(0, 4000) };
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
      // Los correos para el propio usuario no necesitan aprobación: la aprobación protege los envíos a terceros.
      const toSelf = (ctx.selfEmails || []).includes(String(args.to || '').trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1'));
      if (ctx.approvalMode === 'always' && !toSelf) {
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
      return { status: toSelf ? 'enviado_al_usuario' : 'enviado', ...sent };
    }
    case 'web_search': return webSearch(args.query, !!args.news);
    case 'fetch_url': return fetchUrl(args.url);
    default: return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { CATALOG, available, definitions, execute, isPublicUrl, htmlToText };
