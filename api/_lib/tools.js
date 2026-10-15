// Catálogo de herramientas que la IA puede usar al ejecutar una automatización.
// Cada herramienta declara qué conexión necesita; el planificador solo ofrece las disponibles.
const google = require('./google');
const { db } = require('./db');
const { sendEmail } = require('./mailer');

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
  calendar_list_events: {
    needs: 'google_calendar',
    label: 'Ver próximos eventos del Calendar',
    description: 'Lista los próximos eventos del Google Calendar del usuario (por defecto, los próximos 14 días). Devuelve título, inicio, fin, lugar y asistentes.',
    parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 }, max_results: { type: 'integer', minimum: 1, maximum: 20 } } }
  },
  calendar_create_event: {
    needs: 'google_calendar',
    label: 'Crear un evento en el Calendar',
    description: 'Crea un evento en el Google Calendar del usuario (por ejemplo una reunión con un padre/madre, una entrega de boletines). start y end en formato ISO (ej. "2026-10-20T17:00:00"). Si incluye attendees (emails de otras personas), el evento queda pendiente de aprobación antes de enviarles la invitación.',
    parameters: { type: 'object', properties: {
      summary: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' },
      start: { type: 'string' }, end: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string' } }
    }, required: ['summary', 'start', 'end'] }
  },
  web_search: {
    needs: null,
    label: 'Buscar en internet',
    description: 'Busca en internet. Con news=true busca NOTICIAS recientes (Google Noticias: título, medio, fecha y enlace; normalmente basta con eso para resumir). Con news=false busca páginas web en general. Usa consultas cortas (3-6 palabras), en el idioma del tema.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, news: { type: 'boolean' } }, required: ['query'] }
  },
  curo_stats: {
    needs: 'admin',
    label: 'Consultar datos de la plataforma CURO',
    description: 'Solo administradores. Devuelve cifras reales de la plataforma CURO Group de los últimos N días (por defecto 7) comparadas con el periodo anterior: usuarios nuevos y total, compras e importe, suscriptores de newsletter, solicitudes de creadores pendientes, comentarios denunciados, búsquedas realizadas, contenidos guardados y uso de CURO Automate. No incluye datos personales.',
    parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } }
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
  // 6 resultados con fecha corta: suficiente para resumir y gasta menos del cupo por minuto de la IA gratuita.
  return rssItems(xml, 6).map(x => { const d = new Date(x.date); return { ...x, snippet: undefined, date: isNaN(d) ? x.date : d.toISOString().slice(0, 10) }; });
}
// Bing Noticias: los enlaces llevan el destino real en el parámetro url= (enlaces cortos y directos al medio).
async function bingNews(query) {
  const xml = await getText(`https://www.bing.com/news/search?format=rss&setlang=es&cc=ES&q=${encodeURIComponent(query)}`);
  return rssItems(xml, 6).map(x => {
    let url = x.url; const u = url.match(/[?&]url=([^&]+)/i);
    if (u) { try { url = decodeURIComponent(u[1]); } catch {} }
    const d = new Date(x.date);
    return { title: x.title, url, source: x.source, date: isNaN(d) ? x.date : d.toISOString().slice(0, 10) };
  }).filter(x => /^https?:\/\//.test(x.url));
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
  const order = news ? [bingNews, googleNews, bingWeb] : [bingWeb, ddgLite, googleNews];
  for (const fn of order) {
    const res = await fn(query);
    if (res.length) return res;
  }
  return { error: 'La búsqueda no devolvió resultados. Prueba con una consulta más corta o más general. No inventes enlaces.' };
}

async function fetchUrl(url) {
  if (!isPublicUrl(url)) return { error: 'Solo se pueden leer páginas web públicas (http/https).' };
  if (/^https?:\/\/news\.google\.com\//i.test(url)) {
    return { error: 'Los enlaces de Google Noticias no se pueden abrir. Resume la noticia con su título, medio y fecha, y usa ese mismo enlace en el texto.' };
  }
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

// ---------- Datos de la plataforma CURO (solo administradores, solo cifras) ----------
async function countRows(table, filter) {
  const rows = await db.select(table, `${filter ? filter + '&' : ''}select=*&limit=5000`).catch(() => null);
  return rows;
}
async function curoStats(days) {
  const n = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
  const now = Date.now(), from = new Date(now - n * 864e5).toISOString(), prev = new Date(now - 2 * n * 864e5).toISOString();
  const between = (col, a, b) => `${col}=gte.${encodeURIComponent(a)}${b ? `&${col}=lt.${encodeURIComponent(b)}` : ''}`;
  const len = r => (Array.isArray(r) ? r.length : null);
  const [profAll, profNew, profPrev, purNew, purPrev, nlAll, nlNew, creatorsPending, reportsNew, searchNew, searchPrev, savedNew, autoNew, runsNew] = await Promise.all([
    countRows('profiles', ''), countRows('profiles', between('created_at', from)), countRows('profiles', between('created_at', prev, from)),
    countRows('purchases', between('created_at', from)), countRows('purchases', between('created_at', prev, from)),
    countRows('newsletter_subscribers', 'unsubscribed_at=is.null'), countRows('newsletter_subscribers', between('consent_at', from)),
    countRows('creator_requests', 'status=eq.pending'), countRows('comment_reports', between('created_at', from)),
    countRows('searches', between('created_at', from)), countRows('searches', between('created_at', prev, from)),
    countRows('saved_items', between('created_at', from)),
    countRows('automate_automations', between('created_at', from)), countRows('automate_runs', between('started_at', from))
  ]);
  const paid = (purNew || []).filter(p => p.status === 'paid');
  const byCur = {};
  for (const p of paid) byCur[p.currency || 'EUR'] = (byCur[p.currency || 'EUR'] || 0) + Number(p.amount || 0);
  const runs = runsNew || [];
  return {
    periodo: `últimos ${n} días (hasta ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' }).format(new Date(now))})`,
    usuarios: { nuevos: len(profNew), periodo_anterior: len(profPrev), total: len(profAll) },
    compras: { pagadas: paid.length, periodo_anterior: (purPrev || []).filter(p => p.status === 'paid').length, importe: Object.entries(byCur).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(' + ') || '0' },
    newsletter_plataforma: { suscriptores_activos: len(nlAll), nuevos: len(nlNew), nota: 'Las altas desde la web se guardan en Brevo; aquí solo cuentan las de la plataforma.' },
    solicitudes_creadores_pendientes: len(creatorsPending),
    comentarios_denunciados: len(reportsNew),
    busquedas: { realizadas: len(searchNew), periodo_anterior: len(searchPrev), nota: 'Por privacidad no se guarda el texto de las búsquedas.' },
    contenidos_guardados: len(savedNew),
    curo_automate: { automatizaciones_creadas: len(autoNew), ejecuciones: runs.length, con_error: runs.filter(r => r.status === 'failed').length }
  };
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
        await require('./notify').approvalPending(ctx, args);
        return { status: 'pendiente_de_aprobacion', note: 'El correo se ha guardado como borrador. El usuario lo revisará y lo enviará desde Aprobaciones. No lo vuelvas a crear.' };
      }
      const sent = await sendEmail(ctx.userId, args, { brand: ctx.brand });
      return { status: toSelf ? 'enviado_al_usuario' : 'enviado', ...sent };
    }
    case 'calendar_list_events': return google.listUpcomingEvents(ctx.userId, { days: args.days, max: args.max_results });
    case 'calendar_create_event': {
      const attendees = (args.attendees || []).filter(Boolean);
      if (attendees.length && ctx.approvalMode === 'always') {
        const ap = await db.insert('automate_approvals', {
          run_id: ctx.runId, automation_id: ctx.automation?.id || null, user_id: ctx.userId,
          action_type: 'calendar_create_event',
          action_payload: { summary: args.summary, description: args.description || null, location: args.location || null, start: args.start, end: args.end, attendees },
          summary: `Evento "${args.summary}" con ${attendees.join(', ')}`
        });
        ctx.approvals.push(ap.id);
        await require('./notify').calendarApprovalPending(ctx, args);
        return { status: 'pendiente_de_aprobacion', note: 'El evento se ha guardado pendiente de aprobación porque invita a otras personas. El usuario lo revisará en Aprobaciones antes de que salgan las invitaciones. No lo vuelvas a crear.' };
      }
      return google.createEvent(ctx.userId, args);
    }
    case 'curo_stats': {
      if (!ctx.brand) return { error: 'Solo la cuenta administradora de CURO puede consultar los datos de la plataforma.' };
      return curoStats(args.days);
    }
    case 'web_search': return webSearch(args.query, !!args.news);
    case 'fetch_url': return fetchUrl(args.url);
    default: return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { CATALOG, available, definitions, execute, isPublicUrl, htmlToText };
