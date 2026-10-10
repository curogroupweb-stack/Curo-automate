// Decide cómo se envía un correo:
// - Cuenta de CURO (administrador): plantilla de marca y remitente hola@curogroup.net vía Brevo, también las
//   respuestas a clientes (en el mismo hilo). Nunca sale desde el Gmail administrativo si Brevo está configurado:
//   si Brevo falla, el correo no se envía y se muestra el error (la aprobación queda pendiente para reintentar).
//   Mientras no exista BREVO_API_KEY, se usa el Gmail conectado con "Responder a" hola@curogroup.net.
// - Resto de usuarios: su propio Gmail, sin marca CURO.
const google = require('./google');
const brevo = require('./brevo');
const { renderBranded, collectMeta } = require('./email_template');

async function sendEmail(userId, args, { brand }) {
  if (!brand) return { ...(await google.sendMessage(userId, args)), via: 'gmail' };
  const meta = await collectMeta(args.body).catch(() => ({}));
  const html = renderBranded({ subject: args.subject, body: args.body, meta });
  if (brevo.enabled()) {
    let threadRef, subject = args.subject;
    if (args.reply_to_message_id) {
      const orig = await google.readMessage(userId, args.reply_to_message_id).catch(() => null);
      threadRef = orig?.message_id_header || undefined;
      if (orig?.subject && !/^re:/i.test(subject || '')) subject = `Re: ${orig.subject}`;
    }
    return brevo.send({ ...args, subject, html, threadRef });
  }
  return { ...(await google.sendMessage(userId, { ...args, html, replyTo: brevo.REPLY_TO() })), via: 'gmail' };
}

module.exports = { sendEmail };
