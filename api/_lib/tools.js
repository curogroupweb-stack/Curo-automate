// Catálogo de herramientas que la IA puede usar al ejecutar una automatización.
// Cada herramienta declara qué conexión necesita; el planificador solo ofrece las disponibles.
const google = require('./google');
const { db, enc } = require('./db');
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
  drive_list_files: {
    needs: 'google_drive',
    label: 'Ver los archivos de Drive que el usuario compartió',
    description: 'Lista los archivos de Google Drive que el usuario eligió compartir con su agente (con el selector de Google en Conexiones). Devuelve id, nombre y tipo de cada uno.',
    parameters: { type: 'object', properties: {} }
  },
  drive_read_file: {
    needs: 'google_drive',
    label: 'Leer un archivo de Drive',
    description: 'Lee el contenido de texto de un archivo de Drive, usando el id devuelto por drive_list_files. Solo funciona con archivos que el usuario haya compartido con su agente.',
    parameters: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] }
  },
  drive_save_file: {
    needs: 'google_drive',
    label: 'Guardar un archivo nuevo en el Drive del usuario',
    description: 'Crea un archivo de texto nuevo en el Google Drive del usuario (por ejemplo, un boletín o un informe redactado) y queda guardado ahí.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] }
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
  },
  library_overview: {
    needs: null,
    label: 'Ver qué tiene guardado el usuario en Curo Group',
    description: 'Resume lo que el usuario guardó en Curo Group: sus colecciones (carpetas) con cuántos elementos tiene cada una, y sus rutas de aprendizaje guardadas (resultados de búsquedas guiadas de descubrimiento) con título y cantidad de recursos. Úsala cuando pregunte qué tiene guardado, por sus colecciones, o por búsquedas/rutas de aprendizaje anteriores.',
    parameters: { type: 'object', properties: {} }
  },
  library_collection_items: {
    needs: null,
    label: 'Ver los elementos guardados en una colección',
    description: 'Lista los elementos guardados dentro de una colección del usuario (el id se obtiene con library_overview), con su título y tipo (contenido, producto o creador).',
    parameters: { type: 'object', properties: { collection_id: { type: 'string' } }, required: ['collection_id'] }
  },
  library_route_detail: {
    needs: null,
    label: 'Ver el detalle de una ruta de aprendizaje guardada',
    description: 'Muestra el detalle completo de una ruta de aprendizaje guardada del usuario (el id se obtiene con library_overview): la búsqueda original y los recursos que incluye (artículos, vídeos, cursos, perfiles, productos, etc.) con su enlace.',
    parameters: { type: 'object', properties: { route_id: { type: 'string' } }, required: ['route_id'] }
  },
  course_list_mine: {
    needs: null,
    label: 'Ver los cursos del usuario',
    description: 'Lista los cursos de Curo Group a los que el usuario tiene acceso, con cuántas lecciones tiene cada uno y cuántas ya completó. Úsala cuando el usuario pregunte por sus cursos o quiera continuar uno.',
    parameters: { type: 'object', properties: {} }
  },
  course_lesson_list: {
    needs: null,
    label: 'Ver los módulos y lecciones de un curso',
    description: 'Lista los módulos y lecciones de un curso del usuario (el id se obtiene con course_list_mine), con el objetivo de cada lección y si todavía no la empezó, la está cursando o ya la completó. Úsala para acompañar al usuario como tutor dentro de un curso.',
    parameters: { type: 'object', properties: { course_id: { type: 'string' } }, required: ['course_id'] }
  },
  course_mark_lesson: {
    needs: null,
    label: 'Marcar el avance de una lección',
    description: 'Marca el avance del usuario en una lección de un curso (el id de la lección se obtiene con course_lesson_list): pendiente, en_curso o completado. Úsala cuando el usuario diga que empezó, está cursando o terminó una lección.',
    parameters: { type: 'object', properties: { lesson_id: { type: 'string' }, status: { type: 'string', enum: ['pendiente', 'en_curso', 'completado'] } }, required: ['lesson_id', 'status'] }
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

// ---------- Biblioteca guardada del usuario en Curo Group (colecciones, guardados, rutas de aprendizaje) ----------
const SAVED_TARGET_TABLE = { content: 'content', product: 'products', creator: 'creators' };
const SAVED_TARGET_TITLE_COL = { content: 'title', product: 'name', creator: 'name' };

async function libraryOverview(userId) {
  const [collections, savedItems, routes] = await Promise.all([
    db.select('collections', `user_id=eq.${enc(userId)}&select=id,name,description,created_at&order=created_at.desc&limit=100`),
    db.select('saved_items', `user_id=eq.${enc(userId)}&select=collection_id&limit=2000`),
    db.select('learning_routes', `user_id=eq.${enc(userId)}&select=id,title,items,created_at&order=created_at.desc&limit=20`)
  ]);
  const countByCollection = {};
  let sinCarpeta = 0;
  for (const it of savedItems) {
    if (it.collection_id) countByCollection[it.collection_id] = (countByCollection[it.collection_id] || 0) + 1;
    else sinCarpeta++;
  }
  const out = {
    colecciones: collections.map(c => ({ id: c.id, nombre: c.name, descripcion: c.description || undefined, elementos_guardados: countByCollection[c.id] || 0 })),
    guardados_sin_carpeta: sinCarpeta,
    rutas_de_aprendizaje: routes.map(r => ({ id: r.id, titulo: r.title, recursos: (r.items || []).length, creada: r.created_at }))
  };
  if (!collections.length && !sinCarpeta && !routes.length) out.nota = 'El usuario todavía no guardó colecciones, elementos ni rutas de aprendizaje en Curo Group.';
  return out;
}

async function libraryCollectionItems(userId, collectionId) {
  if (!collectionId) return { error: 'Falta el id de la colección (se obtiene con library_overview).' };
  const col = (await db.select('collections', `id=eq.${enc(collectionId)}&user_id=eq.${enc(userId)}&select=id,name`))[0];
  if (!col) return { error: 'Esa colección no existe o no pertenece al usuario.' };
  const items = await db.select('saved_items', `user_id=eq.${enc(userId)}&collection_id=eq.${enc(collectionId)}&select=target_type,target_id,created_at&order=created_at.desc&limit=200`);
  if (!items.length) return { coleccion: col.name, elementos: [], nota: 'Esta colección todavía no tiene elementos guardados.' };
  const byType = {};
  for (const it of items) (byType[it.target_type] ||= new Set()).add(it.target_id);
  const titles = {};
  for (const [type, idsSet] of Object.entries(byType)) {
    const table = SAVED_TARGET_TABLE[type], col2 = SAVED_TARGET_TITLE_COL[type];
    if (!table) continue;
    const ids = [...idsSet];
    const rows = await db.select(table, `id=in.(${ids.map(enc).join(',')})&select=id,${col2}`).catch(() => []);
    for (const r of rows) titles[`${type}:${r.id}`] = r[col2];
  }
  return {
    coleccion: col.name,
    elementos: items.map(it => ({ tipo: it.target_type, titulo: titles[`${it.target_type}:${it.target_id}`] || '(elemento eliminado)', guardado: it.created_at }))
  };
}

async function libraryRouteDetail(userId, routeId) {
  if (!routeId) return { error: 'Falta el id de la ruta de aprendizaje (se obtiene con library_overview).' };
  const route = (await db.select('learning_routes', `id=eq.${enc(routeId)}&user_id=eq.${enc(userId)}&select=id,title,query,items,created_at`))[0];
  if (!route) return { error: 'Esa ruta de aprendizaje no existe o no pertenece al usuario.' };
  return {
    titulo: route.title,
    busqueda_original: route.query,
    creada: route.created_at,
    recursos: (route.items || []).map(it => ({ paso: it.step, tipo: it.type, titulo: it.title, de: it.by, enlace: it.url }))
  };
}

// ---------- Cursos (tutor de IA): cursos del usuario, sus lecciones y su avance ----------
async function courseListMine(userId) {
  const entitlements = await db.select('user_entitlements', `user_id=eq.${enc(userId)}&active=eq.true&select=content_id`);
  if (!entitlements.length) return { cursos: [], nota: 'El usuario todavía no tiene acceso a ningún curso.' };
  const ids = [...new Set(entitlements.map(e => e.content_id))];
  const courses = await db.select('content', `id=in.(${ids.map(enc).join(',')})&content_type=eq.course&select=id,title,short_description`);
  if (!courses.length) return { cursos: [], nota: 'El usuario todavía no tiene acceso a ningún curso.' };
  const courseIds = courses.map(c => c.id);
  const modules = await db.select('course_modules', `course_id=in.(${courseIds.map(enc).join(',')})&select=id,course_id`);
  const moduleToCourse = {};
  for (const m of modules) moduleToCourse[m.id] = m.course_id;
  const moduleIds = modules.map(m => m.id);
  const lessons = moduleIds.length
    ? await db.select('course_lessons', `module_id=in.(${moduleIds.map(enc).join(',')})&select=id,module_id`)
    : [];
  const totalByCourse = {};
  const lessonToCourse = {};
  for (const l of lessons) {
    const cId = moduleToCourse[l.module_id];
    lessonToCourse[l.id] = cId;
    totalByCourse[cId] = (totalByCourse[cId] || 0) + 1;
  }
  const lessonIds = lessons.map(l => l.id);
  const progress = lessonIds.length
    ? await db.select('course_progress', `user_id=eq.${enc(userId)}&lesson_id=in.(${lessonIds.map(enc).join(',')})&status=eq.completado&select=lesson_id`)
    : [];
  const completedByCourse = {};
  for (const p of progress) {
    const cId = lessonToCourse[p.lesson_id];
    completedByCourse[cId] = (completedByCourse[cId] || 0) + 1;
  }
  return {
    cursos: courses.map(c => ({
      id: c.id,
      titulo: c.title,
      resumen: c.short_description || undefined,
      lecciones_totales: totalByCourse[c.id] || 0,
      lecciones_completadas: completedByCourse[c.id] || 0
    }))
  };
}

async function courseLessonList(userId, courseId) {
  if (!courseId) return { error: 'Falta el id del curso (se obtiene con course_list_mine).' };
  const course = (await db.select('content', `id=eq.${enc(courseId)}&content_type=eq.course&select=id,title`))[0];
  if (!course) return { error: 'Ese curso no existe.' };
  const tieneAcceso = !!(await db.one('user_entitlements', `user_id=eq.${enc(userId)}&content_id=eq.${enc(courseId)}&active=eq.true&select=id`));
  const modules = await db.select('course_modules', `course_id=eq.${enc(courseId)}&select=id,title,sort_order&order=sort_order.asc`);
  if (!modules.length) return { curso: course.title, modulos: [], nota: 'Este curso todavía no tiene módulos cargados.' };
  const moduleIds = modules.map(m => m.id);
  const lessons = await db.select('course_lessons', `module_id=in.(${moduleIds.map(enc).join(',')})&select=id,module_id,title,lesson_type,is_demo,sort_order,metadata&order=sort_order.asc`);
  const lessonIds = lessons.map(l => l.id);
  const progressByLesson = {};
  if (lessonIds.length) {
    const progress = await db.select('course_progress', `user_id=eq.${enc(userId)}&lesson_id=in.(${lessonIds.map(enc).join(',')})&select=lesson_id,status`);
    for (const p of progress) progressByLesson[p.lesson_id] = p.status;
  }
  const lessonsByModule = {};
  for (const l of lessons) (lessonsByModule[l.module_id] ||= []).push(l);
  return {
    curso: course.title,
    acceso: tieneAcceso ? 'completo' : 'solo_demo',
    modulos: modules.map(m => ({
      titulo: m.title,
      lecciones: (lessonsByModule[m.id] || []).map(l => {
        const puedeVer = tieneAcceso || l.is_demo;
        return {
          id: l.id,
          titulo: l.title,
          tipo: l.lesson_type,
          demo: !!l.is_demo,
          estado: progressByLesson[l.id] || 'pendiente',
          objetivo: puedeVer ? (l.metadata?.objetivo || undefined) : undefined,
          bloqueada: puedeVer ? undefined : true
        };
      })
    }))
  };
}

async function courseMarkLesson(userId, lessonId, status) {
  if (!lessonId) return { error: 'Falta el id de la lección (se obtiene con course_lesson_list).' };
  if (!['pendiente', 'en_curso', 'completado'].includes(status)) return { error: 'Estado inválido. Usa pendiente, en_curso o completado.' };
  const lesson = (await db.select('course_lessons', `id=eq.${enc(lessonId)}&select=id,title`))[0];
  if (!lesson) return { error: 'Esa lección no existe.' };
  await db.upsert('course_progress', { user_id: userId, lesson_id: lessonId, status, updated_at: new Date().toISOString() }, 'user_id,lesson_id');
  return { status: 'guardado', leccion: lesson.title, estado: status };
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
    case 'drive_list_files': {
      const rows = await db.select('automate_drive_files', `user_id=eq.${enc(ctx.userId)}&select=id,file_id,name,mime_type,created_at&order=created_at.desc`);
      return rows.length ? rows : { note: 'El usuario todavía no compartió ningún archivo de Drive con su agente (lo hace desde Conexiones).' };
    }
    case 'drive_read_file': {
      const row = (await db.select('automate_drive_files', `user_id=eq.${enc(ctx.userId)}&file_id=eq.${enc(args.file_id)}&select=file_id`))[0];
      if (!row) return { error: 'Ese archivo no está disponible. El usuario debe elegirlo primero en Conexiones.' };
      return google.readDriveFile(ctx.userId, args.file_id);
    }
    case 'drive_save_file': return google.createDriveFile(ctx.userId, { name: args.name, content: args.content });
    case 'curo_stats': {
      if (!ctx.brand) return { error: 'Solo la cuenta administradora de CURO puede consultar los datos de la plataforma.' };
      return curoStats(args.days);
    }
    case 'web_search': return webSearch(args.query, !!args.news);
    case 'fetch_url': return fetchUrl(args.url);
    case 'library_overview': return libraryOverview(ctx.userId);
    case 'library_collection_items': return libraryCollectionItems(ctx.userId, args.collection_id);
    case 'library_route_detail': return libraryRouteDetail(ctx.userId, args.route_id);
    case 'course_list_mine': return courseListMine(ctx.userId);
    case 'course_lesson_list': return courseLessonList(ctx.userId, args.course_id);
    case 'course_mark_lesson': return courseMarkLesson(ctx.userId, args.lesson_id, args.status);
    default: return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { CATALOG, available, definitions, execute, isPublicUrl, htmlToText };
