// Acceso a Supabase (PostgREST) con la llave de servidor. Solo se usa en el servidor.
const { SUPABASE_URL, HttpError } = require('./http');

function serviceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new HttpError(500, 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel.');
  return k;
}

async function rest(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const key = serviceKey();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new HttpError(500, `Base de datos: ${data?.message || r.status}`);
  return data;
}

const enc = encodeURIComponent;

const db = {
  select: (table, qs = '') => rest(`${table}?${qs}`),
  one: async (table, qs) => (await rest(`${table}?${qs}&limit=1`))[0] || null,
  insert: async (table, row) => (await rest(table, { method: 'POST', body: row, prefer: 'return=representation' }))[0],
  insertIgnore: async (table, row) => {
    const out = await rest(table, { method: 'POST', body: row, prefer: 'return=representation,resolution=ignore-duplicates' });
    return out[0] || null;
  },
  upsert: async (table, row, onConflict) =>
    (await rest(`${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, { method: 'POST', body: row, prefer: 'return=representation,resolution=merge-duplicates' }))[0],
  update: (table, qs, patch) => rest(`${table}?${qs}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
  remove: (table, qs) => rest(`${table}?${qs}`, { method: 'DELETE' })
};

module.exports = { db, enc };
