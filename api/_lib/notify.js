// Aviso por correo al propio usuario cuando CURO deja algo pendiente de aprobar.
// Se envía desde su Gmail conectado a su mismo email (es un aviso interno; no lleva la marca CURO).
// Si falla, no interrumpe la automatización.
const google = require('./google');

const APP_URL = () => process.env.PUBLIC_URL || 'https://curo-automate.vercel.app';

async function approvalPending(ctx, { to, subject, body }) {
  const me = (ctx.selfEmails || [])[0];
  if (!me) return;
  const link = `${APP_URL()}/?ir=aprobaciones`;
  const preview = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const text = [
    `Tienes un correo preparado por CURO Automate esperando tu aprobación.`,
    ``,
    `Automatización: ${ctx.automation?.name || '—'}`,
    `Para: ${to}`,
    `Asunto: ${subject}`,
    ``,
    `Vista previa:`,
    `${preview}${String(body || '').length > 300 ? '…' : ''}`,
    ``,
    `Revísalo, edítalo si quieres y apruébalo aquí:`,
    link,
    ``,
    `No se enviará nada al cliente hasta que lo apruebes.`
  ].join('\n');
  try {
    await google.sendMessage(ctx.userId, { to: me, subject: `CURO Automate: 1 correo para aprobar (${to})`, body: text });
  } catch (e) {
    console.error('[curo-automate] No se pudo enviar el aviso de aprobación:', e.message);
  }
}

module.exports = { approvalPending };
