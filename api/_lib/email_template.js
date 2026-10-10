// Plantilla HTML de marca CURO Group para los correos que envía la cuenta de CURO.
// Basada en "Plantilla_Email_Curo_Group" (cabecera con logo y "Descubre lo que importa.").
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://curo-automate.vercel.app';

const C = { navy: '#0D1426', ink: '#1f2937', muted: '#64748b', line: '#e5e7eb', bg: '#f3f5fa', teal: '#3fbfad', blue: '#2563eb' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

function linkify(htmlEscaped) {
  return htmlEscaped.replace(/(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, u) => {
    const url = u.replace(/&amp;/g, '&');
    return `<a href="${u}" style="color:${C.blue};font-weight:bold;text-decoration:underline">Leer en ${esc(host(url))} →</a>`;
  });
}

const URL_RE = /https?:\/\/[^\s<)]+[^\s<).,;:!?]/g;
const decodeAmp = u => u.replace(/&amp;/g, '&');

// Busca la imagen de portada (og:image) de cada enlace de noticias para ilustrar el correo.
async function fetchMeta(url) {
  try {
    const h = host(url);
    if (/(^|\.)news\.google\.com$/.test(h)) return null; // los enlaces de Google Noticias no exponen la portada
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4500);
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; CuroBot/1.0; +https://curogroup.net)', accept: 'text/html' } });
    const html = (await r.text()).slice(0, 250000); clearTimeout(t);
    const pick = re => (html.match(re) || [])[1];
    let img = pick(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
      || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)
      || pick(/<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (!img) return null;
    img = img.replace(/&amp;/g, '&');
    img = new URL(img, r.url || url).href;
    return /^https:\/\//.test(img) ? { image: img } : null;
  } catch { return null; }
}

async function collectMeta(body, max = 8) {
  const urls = [...new Set((String(body || '').match(URL_RE) || []).map(decodeAmp))].slice(0, max);
  const entries = await Promise.all(urls.map(async u => [u, await fetchMeta(u)]));
  return Object.fromEntries(entries.filter(([, m]) => m));
}

// Convierte el texto plano que redacta la IA en bloques HTML: párrafos, viñetas y listas numeradas.
function textToHtml(text, meta = {}) {
  const bullet = /^([•\-–*·]|\d+[.)])\s+/;
  const out = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const firstUrl = ((block.match(URL_RE) || []).map(decodeAmp)).find(u => meta[u]);
    if (firstUrl) out.push(`<p style="margin:0 0 10px"><a href="${esc(firstUrl)}"><img src="${esc(meta[firstUrl].image)}" width="528" alt="" style="display:block;width:100%;max-width:528px;height:auto;border:0;border-radius:10px"></a></p>`);
    // Agrupa líneas consecutivas: texto normal -> párrafo; viñetas/números -> lista.
    let run = [], runIsList = null;
    const flush = () => {
      if (!run.length) return;
      if (runIsList) {
        const ordered = /^\d/.test(run[0]);
        const items = run.map(l => `<li style="margin:0 0 8px">${linkify(esc(l.replace(bullet, '')))}</li>`).join('');
        out.push(ordered ? `<ol style="margin:0 0 18px;padding-left:22px">${items}</ol>` : `<ul style="margin:0 0 18px;padding-left:22px">${items}</ul>`);
      } else out.push(`<p style="margin:0 0 16px">${run.map(l => linkify(esc(l))).join('<br>')}</p>`);
      run = [];
    };
    for (const l of lines) {
      const isList = bullet.test(l);
      if (runIsList !== null && isList !== runIsList) flush();
      runIsList = isList; run.push(l);
    }
    flush();
  }
  return out.join('\n');
}

function renderBranded({ subject, body, meta = {} }) {
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
      ${textToHtml(body, meta)}
    </td></tr>
    <tr><td style="padding:0 36px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${C.line};padding-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${C.muted}">
        <b style="color:${C.navy}">Curo Group</b> · <span style="color:${C.teal};font-weight:bold">Descubre</span> lo que importa.<br>
        Madrid, España · <a href="mailto:hola@curogroup.net" style="color:${C.muted}">hola@curogroup.net</a>
      </td></tr></table>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

module.exports = { renderBranded, textToHtml, collectMeta };
