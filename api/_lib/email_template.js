// Plantilla HTML de marca CURO Group para los correos que envía la cuenta de CURO.
// Basada en "Plantilla_Email_Curo_Group" (cabecera con logo y "Descubre lo que importa.").
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://curo-automate.vercel.app';

const C = { navy: '#0D1426', ink: '#1f2937', muted: '#64748b', line: '#e5e7eb', bg: '#f3f5fa', teal: '#3fbfad', blue: '#2563eb' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function linkify(htmlEscaped) {
  return htmlEscaped.replace(/(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, `<a href="$1" style="color:${C.blue};text-decoration:underline">$1</a>`);
}

// Convierte el texto plano que redacta la IA en bloques HTML: párrafos, viñetas y listas numeradas.
function textToHtml(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const bullet = /^([•\-–*·]|\d+[.)])\s+/;
    if (lines.every(l => bullet.test(l))) {
      const ordered = /^\d/.test(lines[0]);
      const items = lines.map(l => `<li style="margin:0 0 8px">${linkify(esc(l.replace(bullet, '')))}</li>`).join('');
      out.push(ordered
        ? `<ol style="margin:0 0 18px;padding-left:22px">${items}</ol>`
        : `<ul style="margin:0 0 18px;padding-left:22px">${items}</ul>`);
    } else {
      out.push(`<p style="margin:0 0 16px">${lines.map(l => linkify(esc(l))).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

function renderBranded({ subject, body }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.line}">
    <tr><td style="padding:0;line-height:0">
      <img src="${PUBLIC_URL}/brand/email-header.jpg" width="600" alt="Curo Group · Descubre lo que importa." style="display:block;width:100%;max-width:600px;height:auto;border:0">
    </td></tr>
    <tr><td style="padding:32px 36px 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:${C.ink}">
      ${textToHtml(body)}
    </td></tr>
    <tr><td style="padding:0 36px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${C.line};padding-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${C.muted}">
        <b style="color:${C.navy}">Curo Group</b> · <span style="color:${C.teal};font-weight:bold">Descubre</span> lo que importa.<br>
        Madrid, España · <a href="mailto:curogroup.web@gmail.com" style="color:${C.muted}">curogroup.web@gmail.com</a>
      </td></tr></table>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

module.exports = { renderBranded, textToHtml };
