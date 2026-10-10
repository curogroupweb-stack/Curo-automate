// Conexión de Google (Gmail) por usuario, con permisos guardados cifrados en Supabase.
const { db, enc } = require('./db');
const { seal, open } = require('./crypto');
const { HttpError } = require('./http');

const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];
const cfg = () => ({
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  redirect: process.env.GOOGLE_REDIRECT_URI
});

function authUrl(state) {
  const c = cfg();
  if (!c.id || !c.redirect) throw new HttpError(500, 'Falta configurar Google OAuth en el servidor.');
  const q = new URLSearchParams({
    client_id: c.id, redirect_uri: c.redirect, response_type: 'code', access_type: 'offline',
    prompt: 'consent select_account', include_granted_scopes: 'true', state, scope: SCOPES.join(' ')
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

async function exchangeCode(code) {
  const c = cfg();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, grant_type: 'authorization_code' })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'Google rechazó la autorización');
  j.expires_at = Date.now() + (j.expires_in || 3600) * 1000;
  return j;
}

async function saveConnection(userId, tokens) {
  let email = '';
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (r.ok) email = (await r.json()).emailAddress || '';
  } catch {}
  const prev = await getStored(userId);
  if (!tokens.refresh_token && prev?.tokens?.refresh_token) tokens.refresh_token = prev.tokens.refresh_token;
  const keep = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: tokens.expires_at, scope: tokens.scope };
  await db.upsert('automate_connections', {
    user_id: userId, provider: 'google', account_email: email, scopes: tokens.scope || '',
    tokens_encrypted: seal(keep), updated_at: new Date().toISOString()
  }, 'user_id,provider');
  return email;
}

async function getStored(userId) {
  const row = await db.one('automate_connections', `user_id=eq.${enc(userId)}&provider=eq.google&select=*`);
  if (!row) return null;
  return { row, tokens: open(row.tokens_encrypted) };
}

async function status(userId) {
  const s = await getStored(userId);
  if (!s?.tokens) return { connected: false };
  const scopes = String(s.row.scopes || '');
  return { connected: true, email: s.row.account_email, canRead: scopes.includes('gmail.readonly'), canSend: scopes.includes('gmail.send') };
}

async function disconnect(userId) {
  const s = await getStored(userId);
  if (s?.tokens?.refresh_token) {
    try { await fetch('https://oauth2.googleapis.com/revoke?token=' + enc(s.tokens.refresh_token), { method: 'POST' }); } catch {}
  }
  await db.remove('automate_connections', `user_id=eq.${enc(userId)}&provider=eq.google`);
}

async function accessToken(userId) {
  const s = await getStored(userId);
  if (!s?.tokens) throw new HttpError(400, 'Gmail no está conectado. Conéctalo en Conexiones.');
  let t = s.tokens;
  if (t.expires_at > Date.now() + 60000) return t.access_token;
  if (!t.refresh_token) throw new HttpError(400, 'El permiso de Gmail caducó. Vuelve a conectarlo en Conexiones.');
  const c = cfg();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' })
  });
  const j = await r.json();
  if (!r.ok) throw new HttpError(400, 'Google retiró el permiso de Gmail (en modo prueba caduca cada 7 días). Vuelve a conectarlo en Conexiones.');
  t = { ...t, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  await db.update('automate_connections', `user_id=eq.${enc(userId)}&provider=eq.google`, { tokens_encrypted: seal(t), updated_at: new Date().toISOString() });
  return t.access_token;
}

async function gmail(userId, path, opts = {}) {
  const token = await accessToken(userId);
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(400, 'Gmail: ' + (j.error?.message || r.status));
  return j;
}

function madridDate(v) {
  const d = new Date(v);
  if (isNaN(d)) return v || '';
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }).format(d) + ' (hora de Madrid)';
}

const hdr = (m, n) => (m.payload?.headers || []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';

function bodyText(p) {
  if (!p) return '';
  if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
  for (const part of p.parts || []) { const t = bodyText(part); if (t) return t; }
  if (p.mimeType === 'text/html' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return '';
}

async function searchMessages(userId, q, max = 10) {
  const list = await gmail(userId, `/messages?maxResults=${Math.min(Number(max) || 10, 20)}&q=${enc(q || 'in:inbox')}`);
  const out = [];
  for (const m of list.messages || []) {
    const full = await gmail(userId, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push({ id: full.id, thread_id: full.threadId, from: hdr(full, 'From'), subject: hdr(full, 'Subject') || '(Sin asunto)', date: madridDate(hdr(full, 'Date')), snippet: full.snippet || '' });
  }
  return out;
}

async function readMessage(userId, id) {
  const m = await gmail(userId, `/messages/${enc(id)}?format=full`);
  return {
    id: m.id, thread_id: m.threadId, from: hdr(m, 'From'), to: hdr(m, 'To'), subject: hdr(m, 'Subject') || '(Sin asunto)',
    date: madridDate(hdr(m, 'Date')), message_id_header: hdr(m, 'Message-ID'), body: bodyText(m.payload).slice(0, 8000)
  };
}

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
}

async function sendMessage(userId, { to, subject, body, reply_to_message_id, html, replyTo }) {
  to = String(to || '').trim().replace(/^.*<([^>]+)>.*$/, '$1');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new HttpError(400, `El destinatario "${to}" no es un email válido.`);
  if (!subject || !body) throw new HttpError(400, 'Faltan el asunto o el texto del correo.');
  let threadId, refs;
  if (reply_to_message_id) {
    try { const orig = await readMessage(userId, reply_to_message_id); threadId = orig.thread_id; refs = orig.message_id_header; } catch {}
  }
  const headers = [`To: ${to}`, `Subject: ${encodeHeader(subject)}`, 'MIME-Version: 1.0'];
  if (refs) headers.push(`In-Reply-To: ${refs}`, `References: ${refs}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  let mime;
  if (html) {
    const boundary = 'curo_' + Math.random().toString(36).slice(2);
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mime = headers.join('\r\n') + '\r\n\r\n' +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html)}\r\n` +
      `--${boundary}--`;
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    mime = headers.join('\r\n') + '\r\n\r\n' + b64(body);
  }
  const raw = Buffer.from(mime).toString('base64url');
  const sent = await gmail(userId, '/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
  return { id: sent.id, thread_id: sent.threadId, to };
}

module.exports = { authUrl, exchangeCode, saveConnection, status, disconnect, searchMessages, readMessage, sendMessage };
