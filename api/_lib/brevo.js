// Envío de correos de marca CURO a través de Brevo (remitente hola@curogroup.net).
// Se activa al añadir BREVO_API_KEY en Vercel. Si no está, se usa el Gmail conectado.
const { HttpError } = require('./http');

const SENDER_EMAIL = () => process.env.BREVO_SENDER_EMAIL || 'hola@curogroup.net';
const SENDER_NAME = () => process.env.BREVO_SENDER_NAME || 'Curo Group';
const REPLY_TO = () => process.env.CURO_REPLY_TO || 'hola@curogroup.net';

function enabled() { return !!process.env.BREVO_API_KEY; }

async function send({ to, subject, body, html }) {
  to = String(to || '').trim().replace(/^.*<([^>]+)>.*$/, '$1');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new HttpError(400, `El destinatario "${to}" no es un email válido.`);
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: SENDER_NAME(), email: SENDER_EMAIL() },
      to: [{ email: to }],
      replyTo: { email: REPLY_TO(), name: SENDER_NAME() },
      subject, textContent: body, ...(html ? { htmlContent: html } : {})
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(400, 'Brevo: ' + (j.message || r.status));
  return { id: j.messageId, to, via: 'brevo', from: SENDER_EMAIL() };
}

module.exports = { enabled, send, REPLY_TO };
