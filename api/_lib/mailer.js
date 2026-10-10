// Decide cómo se envía un correo:
// - Cuenta de CURO (administrador): plantilla de marca; por Brevo desde hola@curogroup.net si está configurado,
//   o por su Gmail con "Responder a" hola@curogroup.net. Las respuestas a un correo recibido siempre van por Gmail (mismo hilo).
// - Resto de usuarios: su propio Gmail, sin marca CURO.
const google = require('./google');
const brevo = require('./brevo');
const { renderBranded } = require('./email_template');

async function sendEmail(userId, args, { brand }) {
  if (!brand) return { ...(await google.sendMessage(userId, args)), via: 'gmail' };
  const html = renderBranded({ subject: args.subject, body: args.body });
  if (brevo.enabled() && !args.reply_to_message_id) {
    try { return await brevo.send({ ...args, html }); }
    catch (e) { console.error('[curo-automate] Brevo falló, se usa Gmail:', e.message); }
  }
  return { ...(await google.sendMessage(userId, { ...args, html, replyTo: brevo.REPLY_TO() })), via: 'gmail' };
}

module.exports = { sendEmail };
