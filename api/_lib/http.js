// Utilidades HTTP compartidas por las funciones de Vercel.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://llugctysxrkqpydyhnvw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_RPo3-Vb7rZ9A7R1dXsH11Q_h5iKXT64';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { return {}; } }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, 'https://x').searchParams);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Verifica el token de sesión de Supabase que envía el navegador.
async function requireUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'Inicia sesión para continuar.');
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new HttpError(401, 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
  const u = await r.json();
  return { id: u.id, email: u.email, name: u.user_metadata?.name || u.user_metadata?.display_name || (u.email || '').split('@')[0] };
}

// Envuelve un handler con manejo de errores uniforme.
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[curo-automate]', e);
      json(res, status, { error: e.message || 'Error inesperado' });
    }
  };
}

module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY, json, readBody, query, HttpError, requireUser, handler };
