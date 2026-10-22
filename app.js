/* CURO Automate · app web (V2 conectada).
   Portada pública + espacio privado conectado a Supabase (login, datos) y a la API (IA, motor, Gmail). */
const SB_URL = 'https://llugctysxrkqpydyhnvw.supabase.co';
const SB_KEY = 'sb_publishable_RPo3-Vb7rZ9A7R1dXsH11Q_h5iKXT64';
const A = document.getElementById('app');
// Sesión compartida con curogroup.net: cookies del dominio .curogroup.net (en trozos), con la misma clave
// que usa la plataforma. Así las dos páginas usan la MISMA sesión y no se anulan entre sí al renovarla.
function curoSharedStorage() {
  const DOM = /(^|\.)curogroup\.net$/.test(location.hostname) ? '; domain=.curogroup.net' : '';
  if (!DOM) return undefined; // en local se usa el almacenamiento normal
  const MAX = 3000;
  const read = k => { const all = document.cookie ? document.cookie.split('; ') : []; const parts = []; for (let i = 0; i < 20; i++) { const pre = k + '.' + i + '='; const c = all.find(x => x.startsWith(pre)); if (c === undefined) break; parts.push(c.slice(pre.length)); } if (!parts.length) return null; try { return decodeURIComponent(parts.join('')); } catch { return null; } };
  const del = k => { for (let i = 0; i < 20; i++) document.cookie = k + '.' + i + '=; max-age=0; path=/' + DOM; };
  return {
    getItem: k => read(k),
    setItem: (k, v) => { const enc = encodeURIComponent(v); del(k); for (let i = 0; i * MAX < enc.length; i++) document.cookie = k + '.' + i + '=' + enc.slice(i * MAX, (i + 1) * MAX) + '; max-age=31536000; path=/; secure; samesite=lax' + DOM; },
    removeItem: k => del(k)
  };
}
// La copia vieja de la sesión que Automate guardaba por su cuenta ya no se usa.
try { localStorage.removeItem('sb-llugctysxrkqpydyhnvw-auth-token'); } catch {}
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, ...(curoSharedStorage() ? { storage: curoSharedStorage() } : {}) } });
let session = null, me = null, currentPage = 'Inicio';
const CONTACT_EMAIL = 'hola@curogroup.net';
const contactLink = (label = CONTACT_EMAIL) => `<a href="mailto:${CONTACT_EMAIL}">${label}</a>`;

const TOOL_LABELS = {
  curo_stats: 'Datos de la plataforma CURO',
  gmail_search: 'Buscar en tu Gmail', gmail_read: 'Leer correos', gmail_send: 'Enviar correos desde tu Gmail',
  web_search: 'Buscar en internet', fetch_url: 'Leer páginas web'
};
const RUN_STATUS = {
  running: ['En curso', 'warn'], awaiting_approval: ['Esperando tu aprobación', 'warn'], completed: ['Completada', 'ok'], failed: ['Con error', 'danger']
};
const SOURCE_LABEL = { manual: 'Manual', schedule: 'Programada', gmail: 'Correo nuevo', curo_new_user: 'Alta en CURO' };

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }
function fmtDate(v) { return v ? new Date(v).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function store(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch {} }
function recall(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } }
// Persisten entre pestañas (el visitante puede volver de CURO Group en otra pestaña).
function lstore(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function lrecall(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
const CURO_LOGIN_URL = 'https://curogroup.net/?automate=entrar'; // la plataforma pide entrar y devuelve aquí con la sesión

async function api(path, { method = 'GET', body } = {}) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch('/api/' + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && session) { await sb.auth.signOut(); }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ---------- Ventanas y avisos ----------
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.remove()); }
function modal(title, html, { wide = false, actions = '' } = {}) {
  const d = document.createElement('div');
  d.className = 'modal';
  d.innerHTML = `<div class="modalbox ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="row"><h2 style="margin:0">${title}</h2><button class="iconBtn" aria-label="Cerrar" onclick="this.closest('.modal').remove()">×</button></div><div class="modalText">${html}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  return d;
}
function info(title, text) {
  const isProblem = /^No se pudo|error|falló|Servicio no disponible/i.test(title);
  return modal(esc(title), `<p>${esc(text)}</p>${isProblem ? `<p class="muted helpLine">Si el problema continúa, escríbenos a ${contactLink()}.</p>` : ''}`, { actions: `<button class="btn primary" onclick="this.closest('.modal').remove()">Entendido</button>` }); }
function toast(text, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function busy(btn, text) { if (!btn) return () => {}; const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(text)}`; return () => { btn.disabled = false; btn.innerHTML = old; }; }

// ---------- Portada pública: acciones ----------
function pickPublicIdea(i) { const e = document.getElementById('publicInstruction'); if (e) { e.value = ideas[i][1]; e.focus(); e.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
function showIdeas() { document.getElementById('ideas-inicio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function startFromPublic(btn) {
  const t = document.getElementById('publicInstruction')?.value.trim();
  if (!t) return toast('Escribe primero qué quieres automatizar.', 'warn');
  if (session) { store('curo_pending_instruction', t); return go('Inicio'); }
  runPreview(t, btn);
}

// ---------- Vista previa sin cuenta ----------
// El visitante prueba antes de registrarse: no se envía nada, no se guarda nada y no se tocan cuentas externas.
function deviceId() {
  let id = lrecall('curo_device');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); lstore('curo_device', id); }
  return id;
}
function askToSignUp(text) {
  closeModals();
  modal('Crea tu cuenta gratis', `<p>${esc(text || 'Para seguir probando, crea tu cuenta gratis.')}</p><p class="muted">Con tu cuenta puedes crear 2 automatizaciones gratis.</p>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Ahora no</button><button class="btn primary" onclick="goActivate()">Crear cuenta o iniciar sesión</button>`
  });
}
async function runPreview(instruction, btn) {
  if (instruction.length > 600) return info('Descripción demasiado larga', 'Para la prueba sin cuenta, describe la tarea en menos de 600 caracteres.');
  const done = busy(btn, 'CURO está preparando la vista previa…');
  try {
    const r = await fetch('/api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction, device: deviceId() }) });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 429 || j.limit) { lstore('curo_pending_preview', { instruction, ts: Date.now() }); return askToSignUp(j.error); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    showPreview(instruction, j.plan, j.example);
  } catch (e) { info('No se pudo preparar la vista previa', e.message); }
  finally { done(); }
}
function showPreview(instruction, plan, example) {
  closeModals();
  const ok = plan.feasible;
  lstore('curo_pending_preview', { instruction, plan: ok ? plan : null, ts: Date.now() });
  modal('Así funcionaría tu automatización', `
    <p class="planSummary">${esc(plan.summary)}</p>
    ${!ok ? `<div class="notice danger"><b>Esto no se puede automatizar todavía con CURO.</b> ${esc((plan.limitations || []).join(' '))}</div>` : ''}
    <div class="plannerPlan">
      <div class="plannerStep"><small>CUÁNDO SE EJECUTA</small><b>${esc(plan.trigger.label)}</b></div>
      <div class="plannerStep"><small>QUÉ HARÁ CURO</small><ol>${plan.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
      ${example ? `<div class="plannerStep"><small>EJEMPLO DEL RESULTADO</small><div class="previewExample">${esc(example).replace(/\n/g, '<br>')}</div><span class="muted">Ejemplo ilustrativo. Cuando la actives, CURO usará datos reales.</span></div>` : ''}
    </div>
    ${plan.requirements?.google ? `<div class="notice"><b>Necesitará tu Gmail.</b> Lo conectarás después de crear tu cuenta, con tu permiso y pudiendo retirarlo cuando quieras.</div>` : ''}
    <p class="muted">Esto es solo una vista previa: no se ha enviado nada ni se ha guardado nada.</p>`, {
    wide: true,
    actions: `<button class="btn ghost" onclick="closeModals();document.getElementById('publicInstruction')?.focus()">Cambiar la descripción</button>${ok ? `<button class="btn primary" onclick="goActivate()">Activar mi automatización</button>` : ''}`
  });
}
function goActivate() {
  closeModals();
  login('signup', 'Crea tu cuenta gratis o inicia sesión en CURO Group. Al volver, tu automatización estará lista para activar.');
}
// Al volver con sesión: recupera lo que escribió el visitante (máximo 1 día).
function takePendingPreview() {
  const p = lrecall('curo_pending_preview');
  if (!p) return null;
  lstore('curo_pending_preview', null);
  return p.ts && Date.now() - p.ts < 864e5 ? p : null;
}
function newsletterDemo() {
  const e = document.getElementById('newsletterEmail'), m = document.getElementById('newsletterMsg');
  const email = e?.value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (m) m.textContent = 'Escribe un correo electrónico válido.'; return; }
  sb.from('newsletter_subscribers').insert({ email }).then(({ error }) => {
    if (m) m.textContent = error ? 'No se pudo registrar ahora. Escríbenos a hola@curogroup.net.' : '¡Gracias! Te escribiremos con las novedades de CURO.';
  });
}
function legalDemo(name) { info(name, 'Los textos legales oficiales de CURO Group se publicarán antes del lanzamiento comercial. Para cualquier consulta: hola@curogroup.net.'); }
function showPublicPlans() { login('signup'); }

// Dictado por voz: se graba el audio en el navegador y se pasa a texto en nuestro servidor (Groq Whisper).
// No depende del reconocimiento de voz del navegador, que en algunos equipos no devuelve texto.
let activeRecognition = null; // { rec, stream, discard }
const DICTATION_MAX_MS = 60000;
function blobToBase64(blob) { return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = ko; r.readAsDataURL(blob); }); }
function stopDictation(discard) { if (!activeRecognition) return; activeRecognition.discard = !!discard; try { activeRecognition.rec.stop(); } catch {} }
async function toggleDictation(targetId, btn) {
  if (activeRecognition) return stopDictation(false);
  try { if (typeof stopSpeaking === 'function') stopSpeaking(); } catch {}
  const target = document.getElementById(targetId); if (!target) return;
  const label = btn.querySelector('span');
  const setLabel = t => { if (label) label.textContent = t; };
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return info('Dictado por voz', 'Tu navegador no permite grabar audio en esta página. Prueba con Chrome, Edge o Safari actualizados, o escribe la tarea normalmente.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) {
    return info('No se pudo usar el micrófono', e?.name === 'NotFoundError' ? 'No encuentro ningún micrófono. Revisa que esté conectado.' : 'El navegador no tiene permiso para usar el micrófono. Toca el candado de la barra de direcciones y permite el micrófono. En Mac, revisa también Ajustes del Sistema → Privacidad y seguridad → Micrófono, y activa tu navegador.');
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder.isTypeSupported?.(m)) || '';
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {}); } catch { stream.getTracks().forEach(t => t.stop()); return info('Dictado por voz', 'No se pudo empezar a grabar. Recarga la página e inténtalo de nuevo.'); }
  const chunks = [], started = Date.now();
  const st = activeRecognition = { rec, stream, discard: false };
  rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
  const auto = setTimeout(() => stopDictation(false), DICTATION_MAX_MS);
  rec.onstop = async () => {
    clearTimeout(auto); stream.getTracks().forEach(t => t.stop());
    activeRecognition = null; btn.classList.remove('listening');
    if (st.discard) return setLabel('Dictar');
    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
    if (blob.size < 800) { setLabel('Dictar'); return toast('No te escuché. Toca Dictar y habla de nuevo.', 'warn'); }
    setLabel('Escribiendo…'); btn.disabled = true;
    try {
      const r = await fetch('/api/preview?op=transcribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: await blobToBase64(blob), mime: blob.type, lang: 'es', seconds: (Date.now() - started) / 1000 }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo pasar la voz a texto.');
      const t = String(j.text || '').trim();
      const el = document.getElementById(targetId);
      if (!t) toast('No te escuché bien. Inténtalo de nuevo.', 'warn');
      else if (el) { el.value = (el.value.trim() ? el.value.trim() + ' ' : '') + t; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
    } catch (e) { info('Dictado por voz', e.message); }
    finally { btn.disabled = false; setLabel('Dictar'); }
  };
  rec.start(250);
  btn.classList.add('listening'); setLabel('Parar');
}

// ---------- Acceso ----------
// El acceso normal es desde la plataforma CURO Group. El formulario propio queda solo como acceso de emergencia (?directo=1).
function login(mode = 'login', note = '') {
  if (/[?&]directo=1/.test(location.search)) return loginForm(mode, note);
  // Directo a la ventana de usuario y contraseña de CURO Group (sin pantalla intermedia); al entrar vuelve aquí.
  A.innerHTML = `<div class="login"><div class="loginbox"><div class="brand"><span class="grad">CURO</span> Automate</div><p class="muted"><span class="spin"></span> Abriendo el inicio de sesión de CURO Group…</p></div></div>`;
  location.href = CURO_LOGIN_URL;
  return;
  A.innerHTML = `<div class="login"><div class="loginbox">
    <div class="brand"><span class="grad">CURO</span> Automate</div>
    <h2>Entra desde CURO Group</h2>
    <p class="muted">${esc(note || 'CURO Automate forma parte de la plataforma CURO Group. Inicia sesión allí y entrarás aquí directamente con tu misma cuenta.')}</p>
    <a class="btn primary wideBtn" href="${CURO_LOGIN_URL}">Entrar o crear cuenta en CURO Group</a>
    <button class="btn ghost wideBtn" type="button" onclick="home()">Volver</button>
    <p class="muted helpLine">¿Problemas para entrar? Escríbenos a ${contactLink()}</p>
  </div></div>`;
}
function loginForm(mode = 'login', note = '') {
  const signup = mode === 'signup';
  A.innerHTML = `<div class="login"><form class="loginbox" onsubmit="event.preventDefault();${signup ? 'doSignup' : 'doLogin'}(this)">
    <div class="brand"><span class="grad">CURO</span> Automate</div>
    <h2>${signup ? 'Crea tu cuenta' : 'Entra a tu espacio'}</h2>
    <p class="muted">${esc(note || (signup ? 'Tu cuenta sirve para toda la plataforma CURO Group.' : 'Usa la misma cuenta que en CURO Group.'))}</p>
    ${signup ? '<label class="field">Nombre<input id="authName" autocomplete="name" required></label>' : ''}
    <label class="field">Email<input id="authEmail" type="email" autocomplete="email" required></label>
    <label class="field">Contraseña<input id="authPass" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required></label>
    <p class="formError" id="authError" role="alert"></p>
    <button class="btn primary wideBtn" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button>
    ${signup ? '' : '<button class="btn linkbtn" type="button" onclick="resetPassword()">He olvidado mi contraseña</button>'}
    <p class="muted switchAuth">${signup ? '¿Ya tienes cuenta? <a href="#" onclick="login(\'login\');return false">Inicia sesión</a>' : '¿Aún no tienes cuenta? <a href="#" onclick="login(\'signup\');return false">Créala gratis</a>'}</p>
    <button class="btn ghost wideBtn" type="button" onclick="home()">Volver</button>
    <p class="muted helpLine">¿Problemas para entrar? Escríbenos a ${contactLink()}</p>
  </form></div>`;
  document.getElementById(signup ? 'authName' : 'authEmail')?.focus();
}
function authError(msg) { const e = document.getElementById('authError'); if (e) e.textContent = msg; }
function translateAuth(m = '') {
  if (/Invalid login/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Aún no has confirmado tu email. Revisa tu bandeja de entrada.';
  if (/already registered/i.test(m)) return 'Ya existe una cuenta con ese email. Inicia sesión.';
  if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
  return m || 'No se pudo completar. Inténtalo de nuevo.';
}
async function doLogin(form) {
  const done = busy(form.querySelector('[type=submit]'), 'Entrando…');
  const { error } = await sb.auth.signInWithPassword({ email: authEmail.value.trim(), password: authPass.value });
  done();
  if (error) authError(translateAuth(error.message));
}
async function doSignup(form) {
  const done = busy(form.querySelector('[type=submit]'), 'Creando cuenta…');
  const name = authName.value.trim();
  const { data, error } = await sb.auth.signUp({ email: authEmail.value.trim(), password: authPass.value, options: { data: { name, display_name: name }, emailRedirectTo: location.origin } });
  done();
  if (error) return authError(translateAuth(error.message));
  if (!data.session) {
    A.innerHTML = `<div class="login"><div class="loginbox"><div class="brand"><span class="grad">CURO</span> Automate</div><h2>Revisa tu correo</h2><p>Te hemos enviado un enlace a <b>${esc(authEmail.value)}</b> para confirmar tu cuenta. Después vuelve aquí e inicia sesión.</p><p class="muted">Lo que estabas preparando se recuperará al entrar.</p><p class="muted helpLine">¿No te llega el correo? Revisa la carpeta de spam o escríbenos a ${contactLink()}.</p><button class="btn primary wideBtn" onclick="login('login')">Ir a iniciar sesión</button></div></div>`;
  }
}
async function resetPassword() {
  const email = document.getElementById('authEmail')?.value.trim();
  if (!email) return authError('Escribe tu email y vuelve a pulsar.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  authError(error ? translateAuth(error.message) : 'Te hemos enviado un enlace para cambiar la contraseña.');
}
async function logout() { await sb.auth.signOut(); me = null; home(); }

function showHelp() {
  modal('Ayuda y contacto', `
    <p>¿Tienes una duda, una idea de automatización o algo no funciona? Escríbenos y te respondemos lo antes posible.</p>
    <p class="contactBig">${contactLink()}</p>
    <div class="plannerPlan">
      <div class="plannerStep"><small>PARA CREAR UNA AUTOMATIZACIÓN</small>En <b>Inicio</b>, describe con tus palabras qué quieres delegar, cuándo y qué esperas recibir. CURO te enseñará el plan antes de activarlo.</div>
      <div class="plannerStep"><small>SI ALGO FALLA</small>En <b>Historial</b> verás qué hizo CURO paso a paso y qué falló. Si nos escribes, cuéntanos el nombre de la automatización y la hora.</div>
      <div class="plannerStep"><small>TU CORREO Y TUS DATOS</small>CURO solo usa Gmail cuando una automatización lo necesita. Puedes desconectarlo cuando quieras en <b>Conexiones</b>.</div>
    </div>`, { actions: `<button class="btn ghost" id="copyMail">Copiar email</button><a class="btn primary" href="mailto:${CONTACT_EMAIL}">Escribir a ${CONTACT_EMAIL}</a>` });
  document.getElementById('copyMail')?.addEventListener('click', () => navigator.clipboard?.writeText(CONTACT_EMAIL).then(() => toast('Email copiado.'), () => toast(CONTACT_EMAIL, 'warn')));
}

// ---------- Estructura del espacio privado ----------
const NAV = ['Inicio', 'Mi agente', 'Mis cursos', 'Automatizaciones', 'Prospectos', 'Aprobaciones', 'Historial', 'Conexiones', 'Conocimiento', 'Cuenta'];
function shell(page, body) {
  currentPage = page;
  const pending = me?.counts?.pending_approvals || 0;
  A.innerHTML = `<div class="shell"><aside class="side"><div class="brand"><span class="grad">CURO</span> Automate</div><nav>${(me?.user?.is_admin ? NAV : NAV.filter(n => n !== 'Prospectos')).map(n =>
    `<button class="navbtn ${n === page ? 'active' : ''}" onclick="go('${n}')">${n}${n === 'Aprobaciones' && pending ? ` <span class="navCount">${pending}</span>` : ''}</button>`).join('')}</nav>
    <div class="sideFoot"><small>${esc(me?.user?.email || '')}</small><a class="navbtn backCuroSide" href="https://curogroup.net/">← Volver a CURO Group</a><button class="navbtn" onclick="showHelp()">Ayuda y contacto</button><button class="navbtn" onclick="logout()">Salir</button></div></aside>
    <button class="helpFab" onclick="showHelp()" aria-label="Ayuda y contacto">?</button><main class="main"><div class="dashhead"><div><small class="muted">CURO AUTOMATE</small><h1>${esc(page)}</h1></div>${aiBadge()}</div><div id="page">${body}</div></main></div>`;
}
function aiBadge() {
  // Solo el administrador ve el estado técnico de la IA.
  if (!me || !me.user?.is_admin) return '';
  if (!me.ai?.configured) return `<span class="badge danger" title="Falta configurar la clave de IA en el servidor">IA sin configurar</span>`;
  return `<span class="badge ok" title="Proveedor de IA activo">IA activa · ${esc(me.ai.provider === 'anthropic' ? 'Claude' : 'Groq')}</span>`;
}
async function refreshMe() { me = await api('me'); return me; }
async function go(page) {
  try { if (typeof stopSpeaking === 'function') stopSpeaking(); } catch {}
  if (!session) return login('login');
  try { await refreshMe(); } catch (e) { return shell(page, `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="go('${page}')">Reintentar</button></div>`); }
  const pages = { Inicio: inicio, 'Mi agente': agentPage, 'Mis cursos': coursesPage, Automatizaciones: automationsPage, Prospectos: leadsPage, Aprobaciones: approvalsPage, Historial: historyPage, Conexiones: connectionsPage, Conocimiento: knowledgePage, Cuenta: accountPage };
  (pages[page] || inicio)();
}
function loading(page, text = 'Cargando…') { shell(page, `<div class="card"><p class="muted"><span class="spin"></span> ${esc(text)}</p></div>`); }

// ---------- MVP: bandeja multicanal de prospectos ----------
const LEAD_STATUS_LABELS = { nuevo: 'Nuevo', pendiente: 'Pendiente', contactado: 'Contactado', diagnostico: 'Diagnóstico', propuesta: 'Propuesta', cliente: 'Cliente', descartado: 'Descartado' };
const LEAD_CHANNEL_LABELS = { web: 'Web/formulario', email: 'Email', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', telefono: 'Teléfono', referido: 'Referido', campana: 'Campaña', otro: 'Otro' };
async function leadsPage() {
  loading('Prospectos', 'Cargando bandeja de prospectos…');
  try {
    const { leads } = await api('leads');
    renderLeads(leads || []);
  } catch (e) {
    shell('Prospectos', `<div class="card"><h3>No se pudo abrir la bandeja</h3><p>${esc(e.message)}</p><p class="muted">Esta sección es interna para administradores de CURO. Si es la primera instalación, hay que ejecutar la migración SQL incluida en el proyecto.</p><button class="btn primary" onclick="go('Prospectos')">Reintentar</button></div>`);
  }
}
function renderLeads(leads) {
  shell('Prospectos', `
    <div class="row"><div><h2 style="margin:0">Entrada multicanal</h2><p class="muted">Registra consultas de web, email, redes, campañas, teléfono y referidos en una sola bandeja.</p></div><span class="badge">${leads.length} prospectos</span></div>
    <div class="card">
      <h3>Registrar consulta</h3>
      <form id="leadForm" onsubmit="event.preventDefault();submitLead();">
        <div class="formGrid">
          <label>Persona de contacto<input id="leadName" maxlength="120" placeholder="Nombre y apellido"></label>
          <label>Empresa / organización<input id="leadOrg" maxlength="180" placeholder="Nombre de la empresa"></label>
          <label>Email<input id="leadEmail" type="email" maxlength="254" placeholder="persona@empresa.com"></label>
          <label>Teléfono<input id="leadPhone" maxlength="40" placeholder="+34…"></label>
          <label>Canal de entrada<select id="leadChannel">${Object.entries(LEAD_CHANNEL_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>Rubro / sector<input id="leadSector" maxlength="120" placeholder="Inmobiliaria, educación, clínica…"></label>
          <label>Proceso afectado<input id="leadProcess" maxlength="160" placeholder="Ventas, atención, documentos…"></label>
          <label>Campaña / referencia<input id="leadCampaign" maxlength="160" placeholder="Nombre de campaña (opcional)"></label>
        </div>
        <label>Consulta o problema<div class="dictationWrap"><textarea id="leadProblem" rows="3" maxlength="3000" placeholder="¿Qué necesita resolver?"></textarea><button class="dictateBtn" type="button" onclick="toggleDictation('leadProblem',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div></label>
        <label>Resultado deseado<div class="dictationWrap"><textarea id="leadGoal" rows="2" maxlength="1500" placeholder="¿Qué le gustaría conseguir?"></textarea><button class="dictateBtn" type="button" onclick="toggleDictation('leadGoal',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div></label>
        <label>Notas internas<div class="dictationWrap"><textarea id="leadNotes" rows="2" maxlength="3000" placeholder="Contexto y próximo paso"></textarea><button class="dictateBtn" type="button" onclick="toggleDictation('leadNotes',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div></label>
        <label class="checkLine"><input id="leadConsent" type="checkbox"> La persona ha autorizado el contacto por este medio cuando corresponde.</label>
        <div class="actions"><button class="btn primary" type="submit">Guardar prospecto</button></div>
      </form>
    </div>
    <div class="row"><h3>Seguimiento</h3><button class="btn" onclick="go('Prospectos')">Actualizar</button></div>
    <div class="list">${leads.length ? leads.map(lead => `
      <article class="card">
        <div class="row"><div><h3>${esc(lead.organization_name || lead.contact_name || lead.email || 'Consulta sin identificar')}</h3><p class="muted">${esc(lead.contact_name || '')}${lead.email ? ' · ' + esc(lead.email) : ''}${lead.phone ? ' · ' + esc(lead.phone) : ''}</p></div><select aria-label="Estado del prospecto" onchange="updateLeadStatus('${esc(lead.id)}',this.value)">${Object.entries(LEAD_STATUS_LABELS).map(([k,v]) => `<option value="${k}" ${lead.status===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="chips"><span class="chip">${esc(LEAD_CHANNEL_LABELS[lead.channel] || 'Otro canal')}</span>${lead.sector ? `<span class="chip">${esc(lead.sector)}</span>` : ''}${lead.process_affected ? `<span class="chip">${esc(lead.process_affected)}</span>` : ''}</div>
        ${lead.problem ? `<p>${esc(lead.problem)}</p>` : ''}${lead.desired_outcome ? `<p class="muted">Objetivo: ${esc(lead.desired_outcome)}</p>` : ''}
        ${lead.notes ? `<p class="muted">Notas: ${esc(lead.notes)}</p>` : ''}
        ${lead.ai_classification ? renderLeadClassification(lead) : ''}
        <div class="actions"><button class="btn" onclick="classifyLead('${esc(lead.id)}')">${lead.ai_classification ? 'Volver a analizar' : 'Analizar consulta con IA'}</button>${lead.ai_classification && lead.ai_classification_status !== 'revisada' ? `<button class="btn" onclick="reviewLeadClassification('${esc(lead.id)}')">Marcar revisada</button>` : ''}</div>
        <p class="meta">Creado: ${fmtDate(lead.created_at)} · Última actualización: ${fmtDate(lead.updated_at)}</p>
      </article>`).join('') : '<div class="card empty"><h3>Aún no hay prospectos</h3><p class="muted">Registra la primera consulta arriba. En la siguiente fase conectaremos formularios y canales compatibles.</p></div>'}</div>`);
}
function renderLeadClassification(lead) {
  const c = lead.ai_classification || {};
  const confidence = Math.round(Math.max(0, Math.min(1, Number(c.confidence) || 0)) * 100);
  const list = values => Array.isArray(values) && values.length ? '<ul>' + values.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="muted">Sin datos.</p>';
  return '<section class="leadAiPanel">' +
    '<div class="row"><h4 style="margin:0">Sugerencia de IA</h4><span class="badge ' + (confidence < 60 || c.needs_clarification ? 'warn' : 'ok') + '">Confianza: ' + confidence + '%</span></div>' +
    '<p><b>Rubro sugerido:</b> ' + esc(c.sector_suggestion || 'Desconocido') + ' · <b>Proceso:</b> ' + esc(c.process_suggestion || 'Desconocido') + '</p>' +
    (c.problem_summary ? '<p>' + esc(c.problem_summary) + '</p>' : '') +
    (c.needs_clarification && c.follow_up_question ? '<p><b>Pregunta de aclaración:</b> ' + esc(c.follow_up_question) + '</p>' : '') +
    (c.missing_information?.length ? '<details><summary>Información que falta</summary>' + list(c.missing_information) + '</details>' : '') +
    (c.inferred_facts?.length ? '<details><summary>Hipótesis de IA (no confirmadas)</summary>' + list(c.inferred_facts) + '</details>' : '') +
    (c.risk_flags?.length ? '<p class="leadRisk"><b>Revisión necesaria:</b> ' + esc(c.risk_flags.join(' · ')) + '</p>' : '') +
    '<p class="meta">Estado: ' + (lead.ai_classification_status === 'revisada' ? 'Revisada por CURO' : 'Pendiente de revisión humana') + '</p></section>';
}
async function classifyLead(id) {
  const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('onclick') === "classifyLead('" + id + "')");
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  try {
    await api('leads?op=classify&id=' + encodeURIComponent(id), { method: 'POST', body: {} });
    toast('Clasificación preparada; revisa la sugerencia antes de confirmarla.');
    await leadsPage();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Analizar consulta con IA'; }
    info('No se pudo analizar', e.message);
  }
}
async function reviewLeadClassification(id) {
  try {
    await api('leads?id=' + encodeURIComponent(id), { method: 'PATCH', body: { review_ai: true } });
    toast('Clasificación marcada como revisada.');
    await leadsPage();
  } catch (e) { info('No se pudo guardar la revisión', e.message); }
}

async function submitLead() {
  const button = document.querySelector('#leadForm button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
  const value = id => document.getElementById(id)?.value || '';
  try {
    await api('leads', { method: 'POST', body: {
      contact_name: value('leadName'), organization_name: value('leadOrg'), email: value('leadEmail'),
      phone: value('leadPhone'), channel: value('leadChannel'), sector: value('leadSector'),
      process_affected: value('leadProcess'), campaign: value('leadCampaign'), problem: value('leadProblem'),
      desired_outcome: value('leadGoal'), notes: value('leadNotes'), consent_contact: !!document.getElementById('leadConsent')?.checked
    }});
    toast('Prospecto guardado');
    await leadsPage();
  } catch (e) {
    if (button) { button.disabled = false; button.textContent = 'Guardar prospecto'; }
    info('No se pudo guardar', e.message);
  }
}
async function updateLeadStatus(id, status) {
  try { await api('leads?id=' + encodeURIComponent(id), { method: 'PATCH', body: { status } }); toast('Estado actualizado'); await leadsPage(); }
  catch (e) { info('No se pudo actualizar', e.message); await leadsPage(); }
}

// ---------- Mis cursos: visor visual (texto, video, PDF/flyers, enlaces) ----------
function curoEmbedUrl(u) {
  if (!u) return null;
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return 'https://www.youtube.com/embed/' + yt[1];
  const vm = u.match(/vimeo\.com\/(\d+)/);
  if (vm) return 'https://player.vimeo.com/video/' + vm[1];
  return null;
}
function curoIsImage(u) { return /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(u || ''); }
function curoLessonMedia(l) {
  const url = (l.resource_url || '').trim();
  if (!url) return '';
  if (curoIsImage(url)) return `<img class="lessonImg" src="${esc(url)}" alt="${esc(l.title)}">`;
  const embed = curoEmbedUrl(url);
  if (l.lesson_type === 'video' || embed) {
    return embed ? `<div class="lessonMedia"><iframe src="${esc(embed)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen loading="lazy"></iframe></div>`
      : `<div class="lessonMedia"><video controls src="${esc(url)}"></video></div>`;
  }
  if (l.lesson_type === 'audio') return `<audio controls src="${esc(url)}" style="width:100%"></audio>`;
  if (l.lesson_type === 'pdf') return `<div class="lessonMedia"><iframe src="${esc(url)}"></iframe></div><p><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">Abrir PDF en otra pestaña</a></p>`;
  if (l.lesson_type === 'embed') return `<div class="lessonMedia"><iframe src="${esc(url)}"></iframe></div>`;
  return `<p><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${l.lesson_type === 'download' ? '⬇️ Descargar' : '🔗 Abrir enlace'}</a></p>`;
}
const CURO_LESSON_ICON = { text: '📝', video: '🎬', audio: '🎧', pdf: '📄', download: '⬇️', embed: '🖥️', quiz: '❓', assignment: '✍️', link: '🔗' };
async function markLessonV(courseId, lessonId, status) {
  const uid = me?.user?.id; if (!uid) return;
  const { error } = await sb.from('course_progress').upsert({ user_id: uid, lesson_id: lessonId, status, updated_at: new Date().toISOString() }, { onConflict: 'user_id,lesson_id' });
  if (error) return toast('No se pudo guardar tu avance: ' + error.message, 'warn');
  toast(status === 'completado' ? '¡Lección completada!' : 'Avance guardado.', 'ok');
  coursesPage();
}
async function coursesPage() {
  const view = window.__curoCourseView;
  if (!view || !view.courseId) return coursesListPage();
  return coursesDetailPage(view.courseId, view.lessonId);
}
async function coursesListPage() {
  loading('Mis cursos', 'Cargando tus cursos…');
  const uid = me?.user?.id;
  const { data: ent, error: e1 } = await sb.from('user_entitlements').select('content_id').eq('user_id', uid).eq('active', true);
  if (e1) return shell('Mis cursos', `<div class="card"><p>${esc(e1.message)}</p></div>`);
  const ids = [...new Set((ent || []).map(x => x.content_id))];
  let courses = [];
  if (ids.length) {
    const { data, error } = await sb.from('content').select('id,title,description,short_description,status,visibility').eq('content_type', 'course').in('id', ids);
    if (error) return shell('Mis cursos', `<div class="card"><p>${esc(error.message)}</p></div>`);
    courses = data || [];
  }
  if (!courses.length) {
    return shell('Mis cursos', `<div class="card"><h3>Todavía no tienes cursos</h3><p class="muted">Cuando compres o te den acceso a un curso de Curo Group, va a aparecer aquí.</p></div>`);
  }
  const courseIds = courses.map(c => c.id);
  const { data: modules } = await sb.from('course_modules').select('id,course_id').in('course_id', courseIds);
  const moduleToCourse = {}; (modules || []).forEach(m => moduleToCourse[m.id] = m.course_id);
  const moduleIds = (modules || []).map(m => m.id);
  let lessons = [];
  if (moduleIds.length) { const { data } = await sb.from('course_lessons').select('id,module_id').in('module_id', moduleIds); lessons = data || []; }
  const totalByCourse = {}, lessonToCourse = {};
  lessons.forEach(l => { const cId = moduleToCourse[l.module_id]; lessonToCourse[l.id] = cId; totalByCourse[cId] = (totalByCourse[cId] || 0) + 1; });
  const lessonIds = lessons.map(l => l.id);
  let done = [];
  if (lessonIds.length) { const { data } = await sb.from('course_progress').select('lesson_id').eq('user_id', uid).eq('status', 'completado').in('lesson_id', lessonIds); done = data || []; }
  const doneByCourse = {};
  done.forEach(p => { const cId = lessonToCourse[p.lesson_id]; if (cId) doneByCourse[cId] = (doneByCourse[cId] || 0) + 1; });
  shell('Mis cursos', `<div class="grid">${courses.map(c => {
    const total = totalByCourse[c.id] || 0, got = doneByCourse[c.id] || 0, pct = total ? Math.round(got / total * 100) : 0;
    return `<div class="card"><h3>🎓 ${esc(c.title)}</h3><p class="muted">${esc(c.short_description || c.description || 'Sin descripción.')}</p>
    <div class="row"><span class="badge ${pct === 100 ? 'ok' : 'warn'}">${pct}% completado</span></div>
    <div class="actions"><button class="btn primary" onclick='window.__curoCourseView={courseId:${JSON.stringify(c.id)}};coursesPage()'>Entrar al curso</button></div></div>`;
  }).join('')}</div>`);
}
async function coursesDetailPage(courseId, lessonId) {
  loading('Mis cursos', 'Cargando el curso…');
  const uid = me?.user?.id;
  const { data: course, error: ce } = await sb.from('content').select('id,title,description,short_description').eq('id', courseId).maybeSingle();
  if (ce || !course) return shell('Mis cursos', `<div class="card"><p>No se pudo abrir este curso.</p><button class="btn ghost" onclick="window.__curoCourseView=null;coursesPage()">← Mis cursos</button></div>`);
  const { data: modules } = await sb.from('course_modules').select('id,title,sort_order').eq('course_id', courseId).order('sort_order', { ascending: true });
  const moduleIds = (modules || []).map(m => m.id);
  let lessons = [];
  if (moduleIds.length) { const { data } = await sb.from('course_lessons').select('*').in('module_id', moduleIds).order('sort_order', { ascending: true }); lessons = data || []; }
  const lessonIds = lessons.map(l => l.id);
  let progress = {};
  if (lessonIds.length) { const { data } = await sb.from('course_progress').select('lesson_id,status').eq('user_id', uid).in('lesson_id', lessonIds); (data || []).forEach(p => progress[p.lesson_id] = p.status); }
  const lessonsByModule = {}; lessons.forEach(l => (lessonsByModule[l.module_id] ||= []).push(l));
  const current = lessonId ? lessons.find(l => l.id === lessonId) : lessons[0];
  const sidebar = (modules || []).map(m => `<div class="courseModGroup"><div class="courseModTitle">${esc(m.title)}</div>${(lessonsByModule[m.id] || []).map(l => {
    const st = progress[l.id] || 'pendiente';
    const icon = st === 'completado' ? '✅' : st === 'en_curso' ? '🟡' : '⬜';
    const active = current && current.id === l.id ? ' active' : '';
    return `<button class="courseLessonBtn${active}" onclick='window.__curoCourseView={courseId:${JSON.stringify(courseId)},lessonId:${JSON.stringify(l.id)}};coursesPage()'>${icon} ${CURO_LESSON_ICON[l.lesson_type] || '📝'} ${esc(l.title)}</button>`;
  }).join('') || `<div class="muted" style="padding:6px 10px">🔒 Se desbloquea con el curso completo</div>`}</div>`).join('') || '<p class="muted">Este curso todavía no tiene módulos cargados.</p>';
  const content = !current ? '<p class="muted">Elige una lección del menú para empezar.</p>' : `
    <h2 style="margin-top:0">${esc(current.title)}</h2>
    ${curoLessonMedia(current)}
    <div class="lessonBody">${esc(current.body || '').replace(/\n/g, '<br>')}</div>
    <div class="actions">
      ${progress[current.id] !== 'completado' ? `<button class="btn primary" onclick="markLessonV(${JSON.stringify(courseId)},${JSON.stringify(current.id)},'completado')">✅ Marcar como completada</button>` : `<span class="badge ok">✅ Completada</span>`}
      ${progress[current.id] === 'pendiente' || !progress[current.id] ? `<button class="btn ghost" onclick="markLessonV(${JSON.stringify(courseId)},${JSON.stringify(current.id)},'en_curso')">Marcar en curso</button>` : ''}
    </div>`;
  shell('Mis cursos', `<button class="btn ghost" style="margin-bottom:14px" onclick="window.__curoCourseView=null;coursesPage()">← Mis cursos</button>
    <h1 style="margin:0 0 4px">${esc(course.title)}</h1><p class="muted" style="margin-top:0">${esc(course.short_description || course.description || '')}</p>
    <div class="courseLayout"><aside class="courseSide">${sidebar}</aside><main class="courseContent card">${content}</main></div>`);
}

// ---------- Portada pública (diseño original) ----------
// ---------- Modos de automatizar y lista de espera ----------
const AGENT_PROFILES = ['Docente', 'Community manager', 'Creador de contenido', 'Emprendedor', 'Autónomo', 'Estudiante', 'Pequeños equipos (pymes)', 'Descubridor'];
const MODES = [
  { k: 'auto', tag: 'Disponible', t: 'Hazlo tú con IA', d: 'Escribe lo que necesitas con tus palabras, mira cómo funcionaría y actívalo.', li: ['Para tareas sencillas que se repiten', 'Ves una vista previa antes de crear tu cuenta', 'Tú apruebas antes de que se envíe nada'], price: 'Gratis hasta 2 automatizaciones', cta: 'Probar ahora' },
  { k: 'agente', tag: 'Nuevo · en prueba', t: 'Tu agente IA personal', d: 'Un asistente que te conoce y no empieza de cero cada vez que entras.', li: ['Recuerda tus temas y lo que quedó pendiente', 'Lleva tu agenda y organiza tus proyectos', 'Cada mañana te dice qué tienes y qué sigue', 'Elige su perfil: docente, emprendedor, estudiante…'], price: 'Gratis durante la fase de prueba', cta: 'Crear mi agente' },
  { k: 'consultoria', tag: 'Próximamente', t: 'Soluciones IA', d: 'Para empresas y centros educativos. Nuestro equipo hace un diagnóstico, te dice qué se puede automatizar y qué no, y lo convertimos en un plan de trabajo.', li: ['Diagnóstico de tus tareas y procesos', 'Qué se puede automatizar y qué no', 'Plan de trabajo y automatizaciones a tu medida'], price: 'Precio según el proyecto', cta: 'Apuntarme a la lista de espera' }
];
function openWaitlist(mode) {
  const agent = mode === 'agente';
  closeModals();
  const m = modal(agent ? 'Tu agente IA personal' : 'Soluciones IA', `
    <p>${agent ? 'Estamos preparando los agentes personales de CURO. Déjanos tu correo y el perfil que más se parece a ti, y te avisaremos en cuanto esté listo.' : 'Estamos preparando el servicio de diagnóstico y automatización a medida. Déjanos tu correo y cuéntanos qué te gustaría automatizar; te escribiremos en cuanto esté disponible.'}</p>
    <label class="field">Tu correo<input id="wlEmail" type="email" autocomplete="email" placeholder="tu@correo.com"></label>
    <label class="field">${agent ? '¿Qué perfil se parece más a ti?' : 'A qué te dedicas'}<select id="wlProfile"><option value="">Elige una opción</option>${AGENT_PROFILES.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>
    ${agent ? '' : '<label class="field">¿Qué te gustaría automatizar? <span class="muted">(opcional)</span><textarea id="wlNote" rows="3" maxlength="1000" placeholder="Por ejemplo: responder consultas de alumnos y organizar las inscripciones"></textarea></label>'}
    <p class="muted small">Solo usaremos tu correo para avisarte de esto. Puedes escribirnos a hola@curogroup.net para borrarlo cuando quieras.</p>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Ahora no</button><button class="btn primary" id="wlSend">Apuntarme</button>`
  });
  if (session && me?.user?.email) m.querySelector('#wlEmail').value = me.user.email;
  m.querySelector('#wlSend').addEventListener('click', async e => {
    const email = m.querySelector('#wlEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Escribe un correo válido.', 'warn');
    const done = busy(e.currentTarget, 'Guardando…');
    const { error } = await sb.from('automate_waitlist').insert({ email, mode, profile: m.querySelector('#wlProfile').value || null, note: m.querySelector('#wlNote')?.value.trim() || null });
    done();
    if (error) return info('No se pudo guardar', 'Inténtalo de nuevo en un momento.');
    closeModals();
    info('¡Apuntado!', agent ? 'Te avisaremos en cuanto tu agente IA personal esté disponible.' : 'Te escribiremos en cuanto Soluciones IA esté disponible.');
  });
}
const featureIcons=[
`<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="10" y="19" width="52" height="38" rx="9" fill="#dbeafe"/><path d="M13 24l23 18 23-18" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="55" cy="51" r="12" fill="#2563eb"/><path d="M55 45v12M49 51h12" stroke="white" stroke-width="3.5" stroke-linecap="round"/></svg>`,
`<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="15" y="10" width="42" height="52" rx="9" fill="#ede9fe"/><path d="M24 25h24M24 35h17M24 45h13" stroke="#7c3aed" stroke-width="4" stroke-linecap="round"/><circle cx="52" cy="50" r="12" fill="#7c3aed"/><path d="M46 50l4 4 8-9" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
`<svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="31" cy="27" r="12" fill="#ccfbf1"/><circle cx="31" cy="27" r="7" fill="#00a98f"/><path d="M12 59c2-13 10-20 19-20s17 7 19 20" fill="#ccfbf1"/><circle cx="54" cy="48" r="12" fill="#00bfa5"/><path d="M49 48l3 3 7-8" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
`<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="15" y="9" width="42" height="54" rx="8" fill="#ffedd5"/><path d="M24 24h24M24 34h24M24 44h16" stroke="#f97316" stroke-width="4" stroke-linecap="round"/><path d="M45 52l5 5 10-12" fill="none" stroke="#f97316" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
`<svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="31" cy="31" r="19" fill="#dbeafe" stroke="#2563eb" stroke-width="5"/><path d="M45 45l14 14" stroke="#2563eb" stroke-width="6" stroke-linecap="round"/><path d="M23 30h16M23 38h11" stroke="#7c3aed" stroke-width="3.5" stroke-linecap="round"/></svg>`,
`<svg viewBox="0 0 72 72" aria-hidden="true"><path d="M36 10l7 7 10-1 3 10 8 6-5 9 2 10-10 3-6 8-9-5-9 5-6-8-10-3 2-10-5-9 8-6 3-10 10 1z" fill="#dbeafe" stroke="#2563eb" stroke-width="3" stroke-linejoin="round"/><circle cx="36" cy="36" r="11" fill="white"/><path d="M31 36l4 4 7-9" fill="none" stroke="#00a98f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
];
const ideas=[['Docentes','Cuando reciba consultas de familias, clasifícalas, prepara una respuesta clara y déjamela lista para aprobar.'],['Emprendedores','Cuando llegue un nuevo cliente potencial, guarda sus datos, identifica qué necesita, prepara una respuesta y programa seguimiento.'],['Community managers','Organiza las solicitudes de contenido, prepara borradores por red social y envíamelos a aprobación antes de publicar.'],['Creadores de contenido','Cuando reciba una propuesta de colaboración, registra la marca, resume la propuesta y prepara una respuesta.'],['Freelance y consultores','Cuando llegue una consulta profesional, crea el contacto, resume la necesidad, prepara respuesta y seguimiento.'],['Pequeños equipos','Recoge solicitudes entrantes, asígnales prioridad, prepara las acciones siguientes y avisa de las que necesiten aprobación.']];
function home(){A.innerHTML=`<header class="top"><a class="brand brandLink" href="https://curogroup.net/" title="Volver a CURO Group"><span class="grad">CURO</span> Automate</a><div class="topnav"><a class="backCuro" href="https://curogroup.net/">← CURO Group</a><a href="#que-hace">Qué hace</a><a href="#como-funciona">Cómo funciona</a><a href="#contacto">Contacto</a><button class="btn ghost" onclick="login('login')">Iniciar sesión</button></div></header><main><section class="hero"><span class="pill">AUTOMATIZACIÓN CON IA · MODO SUPERVISADO</span><h1>Dile qué trabajo quieres delegar. <span class="grad">CURO se ocupa del resto.</span></h1><p>Describe una tarea con tus palabras. CURO organiza el proceso, prepara el trabajo y te pide aprobación cuando hace falta.</p><div class="publicPrompt"><label for="publicInstruction">¿Qué quieres que CURO haga por ti?</label><div class="dictationWrap"><textarea id="publicInstruction" placeholder="Describe una tarea que haces repetidamente…">Cuando llegue una consulta sobre mis servicios, identifica al cliente, guarda sus datos, prepara una respuesta y avísame antes de enviarla.</textarea><button class="dictateBtn" type="button" onclick="toggleDictation('publicInstruction',this)" title="Dictar automatización" aria-label="Dictar automatización">🎙 <span>Dictar</span></button></div><div class="heroActions"><button class="btn primary" onclick="startFromPublic(this)">Crear mi automatización</button><button class="btn ghost linkbtn" onclick="showIdeas()">Ver ideas</button></div></div><div class="starterWrap" id="ideas-inicio"><small>O EMPIEZA CON UNA IDEA</small><div class="starterGrid">${ideas.slice(0,4).map((x,i)=>`<button type="button" class="starterCard starterExample" onclick="pickPublicIdea(${i})"><span>${x[0]}</span><b>${['Responder consultas','Captar y seguir clientes','Organizar solicitudes','Gestionar colaboraciones'][i]}</b><small>Usar este ejemplo</small></button>`).join('')}</div></div></section><section class="section modesSec" id="modos"><div class="sectionIntro"><span class="eyebrow">TRES FORMAS DE AUTOMATIZAR</span><h2>Elige cómo quieres que CURO te ayude</h2><p class="muted">Empieza tú solo con la IA, ten un agente que te conoce o pide que nuestro equipo lo haga por ti.</p></div><div class="modesGrid">${MODES.map(m=>`<div class="card modeCard ${m.k}"><span class="modeTag">${m.tag}</span><h3>${m.t}</h3><p class="muted">${m.d}</p><ul>${m.li.map(x=>`<li>${x}</li>`).join('')}</ul><p class="modePrice">${m.price}</p><button class="btn ${m.k==='auto'?'primary':'ghost'}" onclick="${m.k==='auto'?"document.getElementById('publicInstruction')?.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('publicInstruction')?.focus()":m.k==='agente'?'openAgent()':`openWaitlist('${m.k}')`}">${m.cta}</button></div>`).join('')}</div></section><section class="section" id="que-hace"><div class="sectionIntro"><span class="eyebrow">CURO AUTOMATE</span><h2>¿Qué puede hacer CURO por ti?</h2><p class="muted">Un espacio para delegar trabajo repetitivo sin construir flujos técnicos.</p></div><div class="grid">${['Correo inteligente','Respuestas y aprobaciones','Contactos y seguimiento','Documentos','Conocimiento de tu negocio','Organización de tareas'].map((x,i)=>`<div class="card feature"><b class="featureIcon">${featureIcons[i]}</b><h3>${x}</h3><p class="muted">${['Clasifica consultas y detecta qué necesita cada mensaje.','Prepara borradores y deja las acciones sensibles bajo tu control.','Registra personas, organizaciones, intereses y próximos pasos.','Prepara propuestas, informes, presupuestos y otros documentos.','Utiliza tus servicios, reglas y datos sin inventar información.','Convierte instrucciones en procesos repetibles y trazables.'][i]}</p></div>`).join('')}</div></section><section class="section softSection"><div class="sectionIntro"><span class="eyebrow">PARA TU PROFESIÓN</span><h2>Automatizaciones pensadas para tu trabajo</h2><p class="muted">Empieza con una necesidad concreta y adapta cada automatización a tu forma de trabajar.</p></div><div class="grid">${ideas.map(x=>`<div class="card"><span class="badge">${x[0]}</span><p>${x[1]}</p></div>`).join('')}</div></section><section class="section" id="como-funciona"><div class="sectionIntro"><span class="eyebrow">SIN FLUJOS TÉCNICOS</span><h2>Cómo funciona</h2></div><div class="steps">${[['1','Describe qué quieres delegar','Escríbelo con tus propias palabras.'],['2','CURO prepara el proceso','Organiza las acciones y utiliza tu conocimiento.'],['3','Revisas cuando sea necesario','Las acciones sensibles quedan bajo aprobación.'],['4','CURO ejecuta y registra','Mantiene trazabilidad de lo realizado.']].map(x=>`<div class="card step"><span class="stepNum">${x[0]}</span><h3>${x[1]}</h3><p class="muted">${x[2]}</p></div>`).join('')}</div></section><section class="section agentPublic"><div><span class="pill">CURO AGENT</span><h2>Automatización con control humano</h2><p class="muted">CURO puede preparar, organizar y ejecutar tareas. En modo supervisado, las decisiones importantes esperan tu aprobación.</p></div><div class="agentVisual"><div class="agentIcon big">✦</div><div><b>CURO Agent</b><small>Modo supervisado</small></div></div></section><section class="section"><div class="planCard"><div><span class="pill">EMPIEZA GRATIS</span><h2>Crea tu primera automatización hoy</h2><p>Describe la tarea, revisa el plan que prepara CURO y actívala. Tú apruebas cada envío importante.</p></div><button class="btn primary" onclick="login('signup')">Crear cuenta gratis</button></div></section><section class="contactBand" id="contacto"><div class="contactInner"><div><span class="eyebrow light">CONTACTO</span><h2>¿Tienes una pregunta?</h2><p>Estamos construyendo una forma más sencilla de delegar trabajo con inteligencia artificial.</p><a class="contactLink" href="mailto:hola@curogroup.net">hola@curogroup.net</a></div><div class="newsletter"><span class="eyebrow light">NEWSLETTER</span><h3>Novedades de CURO Group</h3><p>Recibe recursos, ideas y novedades sobre IA, automatización y productos CURO.</p><div class="newsletterForm"><input id="newsletterEmail" type="email" placeholder="Tu correo electrónico"><button class="btn primary" onclick="newsletterDemo()">Suscribirme</button></div><small id="newsletterMsg"></small></div></div></section></main><footer class="footer"><div class="footerGrid"><div><a class="brand brandLink" href="https://curogroup.net/"><span class="grad">CURO</span> Group</a><p>Herramientas, recursos y soluciones para trabajar y aprender con inteligencia artificial.</p><p><b>Madrid, España</b></p></div><div><h4>Navegación</h4><a href="https://curogroup.net/">← Volver a CURO Group</a><a href="#que-hace">Qué hace</a><a href="#como-funciona">Cómo funciona</a><a href="#contacto">Contacto</a><a href="#" onclick="login('login');return false">CURO Automate</a></div><div><h4>Legal</h4><a href="#" onclick="legalDemo('Aviso legal');return false">Aviso legal</a><a href="#" onclick="legalDemo('Política de privacidad');return false">Política de privacidad</a><a href="#" onclick="legalDemo('Términos y condiciones');return false">Términos y condiciones</a><a href="#" onclick="legalDemo('Cookies');return false">Cookies</a></div><div><h4>Síguenos</h4><a target="_blank" rel="noopener" href="https://www.instagram.com/curo.group/">Instagram</a><a target="_blank" rel="noopener" href="https://www.tiktok.com/@curo.group">TikTok</a><a target="_blank" rel="noopener" href="https://www.youtube.com/@Curo.Group1">YouTube</a><a target="_blank" rel="noopener" href="https://www.linkedin.com/company/curo-group-94258942a/">LinkedIn</a></div></div><div class="footerBottom"><span>© 2026 CURO Group · Madrid, España</span><span>Privacidad · Cookies · Términos · Aviso legal</span></div></footer>`}

// ---------- Inicio: describir y crear con IA ----------
const EXAMPLES = [
  'Cada lunes a las 9, busca en internet las 5 noticias más importantes sobre inteligencia artificial en educación y envíame un resumen por correo.',
  'Cuando llegue un correo de un cliente preguntando por mis servicios, prepara una respuesta amable con la información de mi negocio y déjamela para aprobar.',
  'Cada día a las 8, revisa mis correos sin leer y mándame un resumen con lo urgente primero.',
  'Cuando la ejecute, redacta una propuesta comercial para el cliente que le indique, usando mis servicios y precios.'
];
function inicio() {
  const preview = takePendingPreview();
  if (preview && !preview.plan) store('curo_pending_instruction', preview.instruction);
  const pending = preview?.plan ? preview.instruction : recall('curo_pending_instruction');
  const c = me.counts;
  shell('Inicio', `
    ${!me.connections.google.connected ? `<div class="notice"><b>Conecta tu Gmail</b> para que CURO pueda leer y enviar correos por ti. <button class="btn smallBtn" onclick="connectGoogle()">Conectar Gmail</button></div>` : ''}
    <div class="stats">
      <button class="card stat statLink" onclick="go('Automatizaciones')"><small>AUTOMATIZACIONES</small><b>${c.automations}</b><span class="muted">${c.active} activas</span><span class="statAction">Ver →</span></button>
      <button class="card stat statLink ${c.pending_approvals ? 'statAttention' : ''}" onclick="go('Aprobaciones')"><small>APROBACIONES</small><b>${c.pending_approvals}</b><span class="muted">pendientes</span><span class="statAction">Revisar →</span></button>
      <button class="card stat statLink" onclick="go('Conexiones')"><small>GMAIL</small><b class="statText">${me.connections.google.connected ? 'Conectado' : 'Sin conectar'}</b><span class="muted">${esc(me.connections.google.email || 'Necesario para correos')}</span><span class="statAction">Gestionar →</span></button>
      <button class="card stat statLink" onclick="go('Historial')"><small>HISTORIAL</small><b class="statText">Ver</b><span class="muted">todo lo que hizo CURO</span><span class="statAction">Abrir →</span></button>
    </div>
    <div class="prompt">
      <span class="pill">NUEVA AUTOMATIZACIÓN</span>
      <h2>¿Qué trabajo quieres delegar?</h2>
      <p class="muted">Escríbelo con tus palabras: qué debe hacer, cuándo y qué esperas recibir. CURO preparará el plan y te lo enseñará antes de activarlo.</p>
      <div class="dictationWrap"><textarea id="instruction" rows="4" placeholder="Por ejemplo: cada viernes a las 18:00, resume los correos de clientes de la semana y envíamelo.">${esc(pending || '')}</textarea>
      <button class="dictateBtn" type="button" onclick="toggleDictation('instruction',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div>
      <div class="actions"><button class="btn primary" id="planBtn" onclick="createPlan(this)">Preparar plan con IA</button></div>
      <div class="examples"><small class="muted">IDEAS PARA EMPEZAR</small>${EXAMPLES.map((e, i) => `<button type="button" class="exampleChip" onclick="document.getElementById('instruction').value=EXAMPLES[${i}]">${esc(e)}</button>`).join('')}</div>
    </div>`);
  if (preview?.plan) {
    // Ya tenemos el plan de la vista previa: se muestra listo para activar, sin volver a gastar IA.
    const g = !!me.connections.google.connected;
    setTimeout(() => showPlan(preview.instruction, { ...preview.plan, requirements: { ...(preview.plan.requirements || {}), google_connected: g } }), 50);
  } else if (pending) { store('curo_pending_instruction', null); setTimeout(() => createPlan(document.getElementById('planBtn')), 50); }
}

async function createPlan(btn) {
  const instruction = document.getElementById('instruction')?.value.trim();
  if (!instruction) return toast('Describe primero la tarea.', 'warn');
  if (!me.ai?.configured) return me.user?.is_admin
    ? info('IA sin configurar', 'Falta la clave de la IA en el servidor (GROQ_API_KEY en Vercel). Cuando esté, podrás crear automatizaciones.')
    : info('Servicio no disponible', 'La creación de automatizaciones no está disponible en este momento. Inténtalo de nuevo más tarde.');
  const done = busy(btn, 'CURO está preparando el plan…');
  try {
    const { plan } = await api('plan', { method: 'POST', body: { instruction } });
    showPlan(instruction, plan);
  } catch (e) { info('No se pudo preparar el plan', e.message); }
  finally { done(); }
}

function planBody(plan) {
  const g = plan.requirements?.google;
  return `
    <p class="planSummary">${esc(plan.summary)}</p>
    ${!plan.feasible ? `<div class="notice danger"><b>Esto no se puede automatizar todavía con CURO.</b> ${esc(plan.limitations.join(' '))}</div>` : ''}
    <div class="plannerPlan">
      <div class="plannerStep"><small>NOMBRE</small><input id="planName" value="${esc(plan.name)}" maxlength="80"></div>
      <div class="plannerStep"><small>CUÁNDO SE EJECUTA</small><b>${esc(plan.trigger.label)}</b>${plan.trigger.type === 'gmail_new_message' ? `<span class="muted mono">Filtro: ${esc(plan.trigger.gmail_query)}</span>` : ''}</div>
      <div class="plannerStep"><small>QUÉ HARÁ CURO</small><ol>${plan.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
      <div class="plannerStep"><small>HERRAMIENTAS</small><div class="chips">${plan.tools.map(t => `<span class="chip">${esc(TOOL_LABELS[t] || t)}</span>`).join('') || '<span class="muted">Solo la IA</span>'}</div></div>
      ${plan.inputs.length ? `<div class="plannerStep"><small>TE PEDIRÁ EN CADA EJECUCIÓN</small><div class="chips">${plan.inputs.map(i => `<span class="chip">${esc(i.label)}</span>`).join('')}</div></div>` : ''}
      <div class="plannerStep"><small>RESULTADO</small><b>${esc(plan.output)}</b></div>
      ${plan.tools.includes('gmail_send') ? `<div class="plannerStep"><small>CONTROL</small><label class="toggle"><input type="checkbox" id="planApproval" ${plan.approval === 'always' ? 'checked' : ''}> Revisar y aprobar cada correo a otras personas antes de enviarlo <span class="muted">(recomendado; los correos para ti llegan directamente)</span></label></div>` : ''}
    </div>
    ${plan.limitations.length && plan.feasible ? `<div class="notice"><b>A tener en cuenta:</b><ul>${plan.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
    ${plan.questions.length ? `<div class="notice"><b>Para afinarlo más</b>, puedes añadir esto a tu descripción y volver a preparar el plan:<ul>${plan.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${g && !plan.requirements.google_connected ? `<div class="notice warn"><b>Necesita Gmail.</b> Conéctalo para poder activarla. No perderás este plan.</div>` : ''}`;
}

function showPlan(instruction, plan) {
  closeModals();
  const needsGoogle = plan.requirements?.google && !plan.requirements.google_connected;
  const m = modal('CURO ha preparado este plan', planBody(plan), {
    wide: true,
    actions: `<button class="btn ghost" onclick="closeModals();document.getElementById('instruction')?.focus()">Cambiar la descripción</button>
      ${needsGoogle ? `<button class="btn primary" onclick="connectGoogle()">Conectar Gmail</button>` : plan.feasible ? `<button class="btn primary" id="savePlanBtn">Guardar y activar</button>` : ''}`
  });
  store('curo_pending_plan', { instruction, plan });
  m.querySelector('#savePlanBtn')?.addEventListener('click', e => savePlan(e.currentTarget, instruction, plan));
}

async function savePlan(btn, instruction, plan) {
  const p = { ...plan, name: document.getElementById('planName')?.value.trim() || plan.name };
  const ap = document.getElementById('planApproval');
  if (ap) p.approval = ap.checked ? 'always' : 'never';
  const done = busy(btn, 'Guardando…');
  try {
    const { automation } = await api('automations', { method: 'POST', body: { instruction, plan: p } });
    store('curo_pending_plan', null);
    closeModals();
    await refreshMe();
    afterSave(automation);
  } catch (e) { done(); info('No se pudo guardar', e.message); }
}

function afterSave(a) {
  const t = a.trigger_type;
  const when = t === 'schedule' ? `Se ejecutará sola: ${esc(a.plan.trigger.label.toLowerCase())}. Próxima vez: <b>${fmtDate(a.next_run_at)}</b>.`
    : t === 'gmail_new_message' ? 'CURO revisará tu Gmail cada pocos minutos y actuará con cada correo nuevo que cumpla el filtro.'
    : t === 'curo_new_user' ? 'Se ejecutará cada vez que alguien se registre en CURO.'
    : 'Ejecútala cuando quieras desde Automatizaciones.';
  const m = modal('Automatización activada', `<p><b>${esc(a.name)}</b> ya está guardada.</p><p>${when}</p><p class="muted">Te recomendamos hacer una prueba ahora para ver el resultado.</p>`, {
    actions: `<button class="btn ghost" onclick="closeModals();go('Automatizaciones')">Ver mis automatizaciones</button><button class="btn primary" id="tryNow">Probar ahora</button>`
  });
  m.querySelector('#tryNow').addEventListener('click', () => { closeModals(); startRun(a.id); });
}

// ---------- Automatizaciones ----------
let automationsCache = [];
async function automationsPage() {
  loading('Automatizaciones');
  try {
    const { automations } = await api('automations');
    automationsCache = automations;
    shell('Automatizaciones', `
      <div class="row"><p class="muted">${automations.length} automatizaciones · ${automations.filter(a => a.status === 'active').length} activas</p><button class="btn primary" onclick="go('Inicio')">Nueva automatización</button></div>
      <div class="list">${automations.length ? automations.map(autoCard).join('') : `<div class="card empty"><h3>Aún no tienes automatizaciones</h3><p class="muted">Describe una tarea en Inicio y CURO preparará el plan.</p><button class="btn primary" onclick="go('Inicio')">Crear la primera</button></div>`}</div>`);
  } catch (e) { shell('Automatizaciones', `<div class="card"><p>${esc(e.message)}</p></div>`); }
}
function autoCard(a) {
  const label = a.plan?.trigger?.label || 'Manual';
  const paused = a.status === 'paused';
  return `<div class="card autoCard">
    <div class="row"><div><h3>${esc(a.name)}</h3><div class="chips"><span class="badge ${paused ? 'warn' : 'ok'}">${paused ? 'Pausada' : 'Activa'}</span><span class="chip">${esc(label)}</span>${a.approval_mode === 'always' && a.plan?.tools?.includes('gmail_send') ? '<span class="chip">Con aprobación</span>' : ''}</div></div></div>
    <p class="muted">${esc(a.plan?.summary || a.instruction)}</p>
    <p class="meta">${a.trigger_type === 'schedule' && !paused ? `Próxima ejecución: <b>${fmtDate(a.next_run_at)}</b> · ` : ''}Última: ${fmtDate(a.last_run_at)}</p>
    ${a.last_error ? `<div class="notice danger"><b>Último error:</b> ${esc(a.last_error)}</div>` : ''}
    <div class="actions">
      <button class="btn primary" onclick="startRun('${a.id}')">${a.trigger_type === 'manual' ? 'Ejecutar' : 'Probar ahora'}</button>
      <button class="btn ghost" onclick="historyPage('${a.id}')">Historial</button>
      <button class="btn ghost" onclick="toggleAuto('${a.id}','${paused ? 'active' : 'paused'}',this)">${paused ? 'Activar' : 'Pausar'}</button>
      <button class="btn ghost" onclick="showAutoDetail('${a.id}')">Ver plan</button>
      <button class="btn ghost danger" onclick="confirmDelete('${a.id}')">Eliminar</button>
    </div></div>`;
}
function showAutoDetail(id) {
  const a = automationsCache.find(x => x.id === id); if (!a) return;
  modal(esc(a.name), `<p class="muted">Lo que pediste:</p><blockquote>${esc(a.instruction)}</blockquote>
    <div class="plannerPlan"><div class="plannerStep"><small>CUÁNDO</small><b>${esc(a.plan?.trigger?.label || '')}</b></div>
    <div class="plannerStep"><small>PASOS</small><ol>${(a.plan?.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
    <div class="plannerStep"><small>HERRAMIENTAS</small><div class="chips">${(a.plan?.tools || []).map(t => `<span class="chip">${esc(TOOL_LABELS[t] || t)}</span>`).join('')}</div></div>
    ${a.plan?.tools?.includes('gmail_send') ? `<div class="plannerStep"><small>CONTROL</small><label class="toggle"><input type="checkbox" ${a.approval_mode === 'always' ? 'checked' : ''} onchange="setApproval('${a.id}',this.checked)"> Revisar cada correo antes de enviarlo</label></div>` : ''}</div>`, { wide: true });
}
async function setApproval(id, on) {
  try { await api('automations?id=' + id, { method: 'PATCH', body: { approval_mode: on ? 'always' : 'never' } }); toast(on ? 'Cada correo esperará tu aprobación.' : 'Los correos se enviarán sin revisión.'); }
  catch (e) { info('No se pudo cambiar', e.message); }
}
async function toggleAuto(id, status, btn) {
  const done = busy(btn, '…');
  try { await api('automations?id=' + id, { method: 'PATCH', body: { status } }); toast(status === 'paused' ? 'Automatización pausada.' : 'Automatización activada.'); automationsPage(); }
  catch (e) { done(); info('No se pudo cambiar', e.message); }
}
function confirmDelete(id) {
  const a = automationsCache.find(x => x.id === id);
  modal('¿Eliminar automatización?', `<p>Se eliminará <b>${esc(a?.name)}</b> y todo su historial. No se puede deshacer.</p>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Cancelar</button><button class="btn primary dangerBtn" onclick="deleteAuto('${id}',this)">Eliminar</button>`
  });
}
async function deleteAuto(id, btn) {
  const done = busy(btn, 'Eliminando…');
  try { await api('automations?id=' + id, { method: 'DELETE' }); closeModals(); toast('Automatización eliminada.'); automationsPage(); }
  catch (e) { done(); info('No se pudo eliminar', e.message); }
}

// ---------- Ejecutar ----------
async function startRun(id) {
  let a = automationsCache.find(x => x.id === id);
  if (!a) { const { automations } = await api('automations'); automationsCache = automations; a = automations.find(x => x.id === id); }
  if (!a) return;
  const inputs = a.plan?.inputs || [];
  const note = a.trigger_type === 'gmail_new_message' ? '<p class="muted">Se probará con el correo más reciente que cumpla el filtro.</p>'
    : a.trigger_type === 'curo_new_user' ? '<p class="muted">Se probará usando tu propia cuenta como si fueras un usuario nuevo.</p>' : '';
  const sends = a.plan?.tools?.includes('gmail_send');
  const m = modal(esc(a.name), `${note}${inputs.map(f => `<label class="field">${esc(f.label)}${f.type === 'textarea' ? `<textarea data-k="${esc(f.key)}" rows="4"></textarea>` : `<input data-k="${esc(f.key)}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}">`}</label>`).join('')}
    ${sends ? `<p class="notice">${a.approval_mode === 'always' ? 'Los correos para otras personas quedarán en <b>Aprobaciones</b> para que los revises. Los que sean para ti te llegarán directamente.' : '<b>Atención:</b> esta automatización envía correos sin revisión.'}</p>` : ''}
    <p class="muted">CURO trabajará con herramientas reales. Puede tardar hasta un minuto.</p>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Cancelar</button><button class="btn primary" id="runBtn">Ejecutar ahora</button>`
  });
  m.querySelector('#runBtn').addEventListener('click', async e => {
    const vals = {}; m.querySelectorAll('[data-k]').forEach(el => vals[el.dataset.k] = el.value.trim());
    const missing = inputs.filter(f => !vals[f.key]);
    if (missing.length) return toast('Completa: ' + missing.map(f => f.label).join(', '), 'warn');
    const done = busy(e.currentTarget, 'CURO está trabajando…');
    try { const { run } = await api('run', { method: 'POST', body: { automation_id: id, inputs: vals } }); closeModals(); await refreshMe(); showRun(run, a.name); }
    catch (err) { done(); info('No se pudo ejecutar', err.message); }
  });
}

function showRun(run, name) {
  const [label, kind] = RUN_STATUS[run.status] || [run.status, ''];
  const steps = run.steps || [];
  const m = modal(esc(run.result_title || name || 'Resultado'), `
    <div class="chips"><span class="badge ${kind}">${label}</span><span class="chip">${esc(SOURCE_LABEL[run.trigger_source] || run.trigger_source || '')}</span><span class="chip">${fmtDate(run.started_at)}</span></div>
    ${run.error ? `<div class="notice danger"><b>Qué falló:</b> ${esc(run.error)}</div>` : ''}
    ${run.status === 'awaiting_approval' ? `<div class="notice warn">Hay correos esperando tu aprobación. Revísalos antes de que se envíen.</div>` : ''}
    ${run.result_body ? `<div class="resultText">${esc(run.result_body)}</div>` : ''}
    ${steps.length ? `<details class="stepsLog"><summary>Ver los ${steps.length} pasos que hizo CURO</summary><ol>${steps.map(s => `<li><b>${esc(TOOL_LABELS[s.tool] || (s.tool === 'finish' ? 'Terminar' : s.tool))}</b> ${s.args?.query ? `“${esc(s.args.query)}”` : s.args?.url ? esc(s.args.url) : s.args?.to ? `para ${esc(s.args.to)}` : ''} <span class="muted">— ${esc(s.preview || (s.ok === false ? 'Error' : 'Hecho'))}</span></li>`).join('')}</ol></details>` : ''}`, {
    wide: true,
    actions: `${run.result_body ? '<button class="btn ghost" id="copyRes">Copiar resultado</button>' : ''}${run.status === 'awaiting_approval' ? `<button class="btn primary" onclick="closeModals();go('Aprobaciones')">Revisar aprobaciones</button>` : `<button class="btn primary" onclick="closeModals()">Cerrar</button>`}`
  });
  m.querySelector('#copyRes')?.addEventListener('click', () => navigator.clipboard?.writeText(run.result_body).then(() => toast('Resultado copiado.'), () => toast('No se pudo copiar.', 'warn')));
}

// ---------- Aprobaciones ----------
async function approvalsPage() {
  loading('Aprobaciones');
  try {
    const { approvals } = await api('approvals?status=pending');
    shell('Aprobaciones', `<p class="muted">Correos que CURO ha preparado y esperan tu visto bueno. Puedes editarlos antes de enviarlos.</p>
      <div class="list">${approvals.length ? approvals.map(apCard).join('') : `<div class="card empty"><h3>Todo al día</h3><p class="muted">No hay nada pendiente de aprobar.</p></div>`}</div>
      <button class="btn linkbtn" onclick="approvalsHistory()">Ver aprobaciones anteriores</button>`);
  } catch (e) { shell('Aprobaciones', `<div class="card"><p>${esc(e.message)}</p></div>`); }
}
function apCard(ap) {
  const p = ap.action_payload || {};
  const isEvent = ap.action_type === 'calendar_create_event';
  const fields = isEvent
    ? `<label class="field">Título<input data-f="summary" value="${esc(p.summary)}"></label>
       <label class="field">Con (emails, separados por coma)<input data-f="attendees" value="${esc((p.attendees || []).join(', '))}"></label>
       <label class="field">Inicio<input data-f="start" type="datetime-local" value="${esc(String(p.start || '').slice(0, 16))}"></label>
       <label class="field">Fin<input data-f="end" type="datetime-local" value="${esc(String(p.end || '').slice(0, 16))}"></label>
       <label class="field">Lugar<input data-f="location" value="${esc(p.location || '')}"></label>
       <label class="field">Descripción<textarea data-f="description" rows="4">${esc(p.description || '')}</textarea></label>`
    : `<label class="field">Para<input data-f="to" value="${esc(p.to)}"></label>
       <label class="field">Asunto<input data-f="subject" value="${esc(p.subject)}"></label>
       <label class="field">Mensaje<textarea data-f="body" rows="9">${esc(p.body)}</textarea></label>`;
  return `<div class="card apCard" id="ap-${ap.id}">
    <div class="row"><div><small class="muted">${esc(ap.automate_automations?.name || 'Automatización')} · ${fmtDate(ap.created_at)}</small><h3>${isEvent ? 'Evento para ' + esc((p.attendees || []).join(', ')) : 'Correo para ' + esc(p.to)}</h3></div><span class="badge warn">Pendiente</span></div>
    ${ap.result?.error ? `<div class="notice danger"><b>Último intento falló:</b> ${esc(ap.result.error)}</div>` : ''}
    ${fields}
    <div class="actions"><button class="btn ghost" onclick="decide('${ap.id}','reject',this)">Descartar</button><button class="btn primary" onclick="decide('${ap.id}','approve',this)">${isEvent ? 'Aprobar y enviar invitación' : 'Aprobar y enviar'}</button></div>
  </div>`;
}
async function decide(id, decision, btn) {
  const card = document.getElementById('ap-' + id);
  const payload = {};
  card.querySelectorAll('[data-f]').forEach(el => payload[el.dataset.f] = el.dataset.f === 'attendees' ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value);
  const done = busy(btn, decision === 'approve' ? 'Enviando…' : 'Descartando…');
  try {
    await api('approvals', { method: 'POST', body: { id, decision, payload } });
    toast(decision === 'approve' ? 'Aprobado y enviado.' : 'Descartado.');
    await refreshMe(); approvalsPage();
  } catch (e) { done(); info('No se pudo completar', e.message); }
}
async function approvalsHistory() {
  const { approvals } = await api('approvals?status=all');
  const done = approvals.filter(a => a.status !== 'pending');
  modal('Aprobaciones anteriores', done.length ? `<table class="table"><thead><tr><th>Fecha</th><th>Resumen</th><th>Estado</th></tr></thead><tbody>${done.map(a => `<tr><td>${fmtDate(a.decided_at || a.created_at)}</td><td>${esc(a.summary || '')}</td><td>${a.status === 'approved' ? '<span class="badge ok">Enviado</span>' : a.status === 'rejected' ? '<span class="badge">Descartado</span>' : '<span class="badge danger">Error</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aún no hay aprobaciones anteriores.</p>', { wide: true });
}

// ---------- Historial ----------
let runsCache = [];
async function historyPage(automationId) {
  loading('Historial');
  try {
    const { runs } = await api('automations?runs=1' + (typeof automationId === 'string' ? '&automation_id=' + automationId : ''));
    runsCache = runs;
    const filtered = typeof automationId === 'string';
    shell('Historial', `<div class="row"><p class="muted">${filtered ? `Ejecuciones de <b>${esc(runs[0]?.automate_automations?.name || 'esta automatización')}</b>` : 'Todo lo que ha hecho CURO, lo más reciente primero.'}</p>${filtered ? `<button class="btn ghost" onclick="historyPage()">Ver todo</button>` : ''}</div>
      ${runs.length ? `<div class="tableWrap"><table class="table"><thead><tr><th>Fecha</th><th>Automatización</th><th>Origen</th><th>Estado</th><th>Resultado</th></tr></thead><tbody>${runs.map(r => {
        const [label, kind] = RUN_STATUS[r.status] || [r.status, ''];
        return `<tr class="clickRow" onclick="openRun('${r.id}')"><td>${fmtDate(r.started_at)}</td><td>${esc(r.automate_automations?.name || '—')}</td><td>${esc(SOURCE_LABEL[r.trigger_source] || r.trigger_source)}</td><td><span class="badge ${kind}">${label}</span></td><td class="muted">${esc((r.error || r.result_title || '').slice(0, 80))}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="card empty"><h3>Sin ejecuciones todavía</h3><p class="muted">Cuando una automatización se ejecute, verás aquí qué hizo y su resultado.</p></div>`}`);
  } catch (e) { shell('Historial', `<div class="card"><p>${esc(e.message)}</p></div>`); }
}
function openRun(id) { const r = runsCache.find(x => x.id === id); if (r) showRun(r, r.automate_automations?.name); }

// ---------- Conexiones ----------
async function connectionsPage() {
  loading('Conexiones');
  const g = me.connections.google;
  const driveFiles = g.connected && g.canDrive ? (await api('google?action=drive_files').catch(() => ({ files: [] }))).files : [];
  const needsUpgrade = g.connected && (!g.canCalendar || !g.canDrive);
  shell('Conexiones', `<p class="muted">Las aplicaciones que CURO puede usar en tu nombre. Solo actúa con las que conectes y puedes desconectarlas cuando quieras.</p>
    <div class="connGrid">
      <div class="card conn"><div class="row"><h3>Google</h3><span class="badge ${g.connected ? 'ok' : 'warn'}">${g.connected ? 'Conectado' : 'Sin conectar'}</span></div>
        <p class="muted">${g.connected ? `Cuenta: <b>${esc(g.email)}</b>.` : 'Permite a CURO usar tu Gmail, tu Calendar y tu Drive.'}</p>
        <p class="muted">Gmail: ${g.connected ? 'leer tu bandeja y enviar correos (con tu aprobación si así lo eliges).' : 'leer correos y enviar respuestas.'}</p>
        <p class="muted">Calendar: ${g.canCalendar ? 'ver y crear eventos (las invitaciones a otras personas quedan para tu aprobación).' : g.connected ? 'pendiente — reconecta para activarlo.' : 'ver y crear eventos.'}</p>
        <p class="muted">Drive: ${g.canDrive ? 'crear y guardar archivos, y leer los que elijas compartir.' : g.connected ? 'pendiente — reconecta para activarlo.' : 'crear, guardar y leer archivos que elijas compartir.'}</p>
        ${needsUpgrade ? `<div class="notice">Conectaste Google antes de que sumáramos estos permisos. Reconecta para activarlos.</div>` : ''}
        <div class="actions">${g.connected ? `<button class="btn ghost" onclick="connectGoogle()">${needsUpgrade ? 'Reconectar y activar todo' : 'Cambiar de cuenta'}</button><button class="btn ghost danger" onclick="disconnectGoogle(this)">Desconectar</button>` : `<button class="btn primary" onclick="connectGoogle()">Conectar Google</button>`}</div>
        ${g.canDrive ? `<div class="connSub"><h4>Archivos de Drive compartidos con tu agente</h4>
          ${driveFiles.length ? `<ul class="fileList">${driveFiles.map(f => `<li>${esc(f.name)}<button class="btn ghost danger smallBtn" onclick="removeDriveFile('${f.id}',this)">Quitar</button></li>`).join('')}</ul>` : '<p class="muted">Todavía no compartiste ningún archivo.</p>'}
          <button class="btn ghost smallBtn" onclick="openDrivePicker()">+ Elegir un archivo de Drive</button></div>` : ''}
      </div>
      <div class="card conn"><div class="row"><h3>Internet</h3><span class="badge ok">Disponible</span></div><p class="muted">Buscar información y leer páginas web públicas. No necesita conexión.</p></div>
      ${['Outlook', 'WhatsApp Business'].map(n => `<div class="card conn soon"><div class="row"><h3>${n}</h3><span class="badge">Próximamente</span></div><p class="muted">Estamos preparando esta conexión.</p></div>`).join('')}
    </div>`);
}
let pickerLoading = null;
function loadDrivePicker() {
  if (window.google?.picker) return Promise.resolve();
  if (!pickerLoading) pickerLoading = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => gapi.load('picker', resolve);
    document.head.appendChild(s);
  });
  return pickerLoading;
}
async function openDrivePicker() {
  try {
    const [{ api_key }, { access_token }] = await Promise.all([
      api('google?action=picker_config'),
      api('google?action=picker_token', { method: 'POST' })
    ]);
    if (!api_key) return info('Falta un paso', 'El selector de Drive todavía no está activado del lado del servidor.');
    await loadDrivePicker();
    const view = new google.picker.DocsView().setIncludeFolders(true);
    const picker = new google.picker.PickerBuilder().addView(view).setOAuthToken(access_token).setDeveloperKey(api_key)
      .setCallback(async data => {
        if (data.action !== google.picker.Action.PICKED) return;
        const doc = data.docs[0];
        try {
          await api('google?action=drive_add', { method: 'POST', body: { file_id: doc.id, name: doc.name, mime_type: doc.mimeType } });
          toast(`"${doc.name}" compartido con tu agente.`);
          await refreshMe(); connectionsPage();
        } catch (e) { info('No se pudo guardar', e.message); }
      }).build();
    picker.setVisible(true);
  } catch (e) { info('No se pudo abrir el selector', e.message); }
}
async function removeDriveFile(id, btn) {
  const done = busy(btn, 'Quitando…');
  try { await api('google?action=drive_remove', { method: 'POST', body: { id } }); toast('Archivo quitado.'); connectionsPage(); }
  catch (e) { done(); info('No se pudo quitar', e.message); }
}
async function connectGoogle() {
  try {
    const instruction = document.getElementById('instruction')?.value.trim();
    if (instruction && !recall('curo_pending_plan')) store('curo_pending_instruction', instruction);
    const { url } = await api('google?action=connect', { method: 'POST' });
    location.href = url;
  } catch (e) { info('No se pudo conectar', e.message); }
}
async function disconnectGoogle(btn) {
  const done = busy(btn, 'Desconectando…');
  try { await api('google?action=disconnect', { method: 'POST' }); toast('Gmail desconectado.'); go('Conexiones'); }
  catch (e) { done(); info('No se pudo desconectar', e.message); }
}

// ---------- Conocimiento ----------
async function knowledgePage() {
  loading('Conocimiento');
  const { items } = await api('knowledge');
  shell('Conocimiento', `<p class="muted">Lo que CURO debe saber de tu negocio: servicios, precios, horarios, tono, normas. Lo usará al redactar y nunca inventará lo que no esté aquí.</p>
    <div class="card"><h3>Añadir información</h3><label class="field">Título<input id="kTitle" placeholder="Ej.: Servicios y precios"></label><label class="field">Contenido<textarea id="kBody" rows="5" placeholder="Ej.: Consultoría IA para colegios: diagnóstico 300 €, formación 90 €/hora…"></textarea></label><div class="actions"><button class="btn primary" onclick="addKnowledge(this)">Guardar</button></div></div>
    <div class="list">${items.map(k => `<div class="card"><div class="row"><h3>${esc(k.title)}</h3><button class="btn ghost danger smallBtn" onclick="delKnowledge('${k.id}',this)">Eliminar</button></div><p class="preLine">${esc(k.body)}</p></div>`).join('') || '<p class="muted">Aún no has añadido información.</p>'}</div>`);
}
async function addKnowledge(btn) {
  const title = kTitle.value.trim(), body = kBody.value.trim();
  if (!title || !body) return toast('Escribe un título y un contenido.', 'warn');
  const done = busy(btn, 'Guardando…');
  try { await api('knowledge', { method: 'POST', body: { title, body } }); toast('Guardado.'); knowledgePage(); }
  catch (e) { done(); info('No se pudo guardar', e.message); }
}
async function delKnowledge(id, btn) {
  const done = busy(btn, '…');
  try { await api('knowledge?id=' + id, { method: 'DELETE' }); knowledgePage(); } catch (e) { done(); info('No se pudo eliminar', e.message); }
}

// ---------- Los 9 agentes AIA (presentación pública) ----------
const AGENTS = [
  { key: 'docente', name: 'Bruno', animal: 'el osito', label: 'Docente o formador/a', vibe: 'Paciente y ordenado', help: 'Te acompaña con las clases, la planificación, las evaluaciones y la comunicación con familias.', ex: ['Te recuerda entregas, reuniones y evaluaciones', 'Organiza tus clases de la semana'] },
  { key: 'autonomo', name: 'Teo', animal: 'el castor', label: 'Autónomo/a', vibe: 'Trabajador y organizado', help: 'Lleva tus proyectos de clientes, entregas, presupuestos y facturas para que nada se te escape.', ex: ['Te avisa de facturas y entregas pendientes', 'Ordena los proyectos de cada cliente'] },
  { key: 'estudiante', name: 'Koa', animal: 'el koala', label: 'Estudiante', vibe: 'Curioso y constante', help: 'Te ayuda a organizar tu estudio: exámenes, trabajos, apuntes y tiempo.', ex: ['Apunta tus exámenes y entregas', 'Te arma un plan de estudio por semanas'] },
  { key: 'emprendedor', name: 'Nico', animal: 'el conejito', label: 'Emprendedor/a', vibe: 'Con energía y decidido', help: 'Sigue a tus clientes, tus ventas y tus lanzamientos, y te dice cuál es el siguiente paso.', ex: ['Te recuerda a qué cliente escribir hoy', 'Divide tu lanzamiento en etapas'] },
  { key: 'community', name: 'Kai', animal: 'el panda', label: 'Community manager', vibe: 'Creativo y al día', help: 'Organiza tu calendario de publicaciones, tus campañas y tus clientes en redes.', ex: ['Lleva el calendario de publicaciones', 'Te recuerda las entregas a cada cliente'] },
  { key: 'creador', name: 'Luna', animal: 'la gatita', label: 'Creador/a de contenido', vibe: 'Inquieta y llena de ideas', help: 'Guarda tus ideas, tus guiones y tus colaboraciones con marcas, y te ayuda a publicar con constancia.', ex: ['Banco de ideas que no se pierden', 'Te avisa de las fechas con marcas'] },
  { key: 'pyme', name: 'Félix', animal: 'el zorro', label: 'Dirección y pymes', vibe: 'Formal y decidido', help: 'Para quien dirige una empresa o un equipo: tareas, reuniones, clientes, decisiones e informes.', ex: ['Resume qué quedó pendiente de cada reunión', 'Te prepara la semana del equipo'] },
  { key: 'profesional', name: 'Hachi', animal: 'el perrito', label: 'Profesionales', vibe: 'Amable y organizado', help: 'Para médicos, abogados, psicólogos, secretarios y administrativos: citas, consultas, casos y documentos en orden.', ex: ['Te recuerda citas, consultas y trámites', 'Ordena el seguimiento de cada caso'] },
  { key: 'descubridor', name: 'Sandy', animal: 'la ratita', label: 'Descubridor/a', vibe: 'Tierna y curiosa', help: 'Para quien busca de todo un poco: guarda lo que te interesa, lo que quieres aprender, comprar o visitar.', ex: ['Lista de cosas que quieres aprender', 'Guarda ideas, viajes y compras pensadas'] }
];
const agentImg = k => `img/agentes/${k}.png?v=4`;
const agentByKey = k => AGENTS.find(a => a.key === k) || AGENTS[AGENTS.length - 1];
// Frases para empezar a hablar con el agente (chat vacío), según el perfil.
const AGENT_STARTERS = {
  docente: ['Tengo que preparar las evaluaciones del trimestre', 'El jueves a las 17 tengo reunión con familias', 'Ayúdame a organizar mis clases de esta semana'],
  autonomo: ['Tengo que enviar dos presupuestos esta semana', 'Recuérdame cobrar la factura de un cliente el día 30', 'Ayúdame a ordenar mis proyectos de clientes'],
  estudiante: ['El 20 tengo examen de Historia', 'Tengo que entregar un trabajo el viernes', 'Ayúdame a armar un plan de estudio'],
  emprendedor: ['Quiero lanzar un producto nuevo el mes que viene', 'Tengo que escribir a tres clientes esta semana', 'Ayúdame a ordenar mis ventas'],
  community: ['Tengo 3 clientes y publico para cada uno', 'El lunes empieza una campaña nueva', 'Ayúdame a armar el calendario de la semana'],
  creador: ['Tengo una colaboración con una marca el día 15', 'Quiero publicar dos vídeos por semana', 'Guárdame estas ideas de contenido'],
  pyme: ['El martes tengo reunión con el equipo', 'Quiero revisar los objetivos del trimestre', 'Ayúdame a repartir tareas esta semana'],
  profesional: ['Mañana tengo 5 consultas, ayúdame a organizar el día', 'Tengo que presentar unos papeles el viernes', 'Recuérdame llamar a un cliente el lunes'],
  descubridor: ['Quiero aprender a usar la IA en mi día a día', 'Estoy pensando en un viaje para el verano', 'Guárdame cosas que me gustaría comprar']
};

function agentsLanding() {
  window.scrollTo(0, 0);
  A.innerHTML = `<header class="top"><a class="brand brandLink" href="https://curogroup.net/" title="Volver a CURO Group"><span class="grad">CURO</span> Automate</a><div class="topnav"><a class="backCuro" href="https://curogroup.net/">← CURO Group</a>${session ? `<button class="btn ghost" onclick="go('Inicio')">Volver a Automate</button>` : `<button class="btn ghost" onclick="home()">Otras formas</button>`}</div></header>
  <main class="agLanding">
    <section class="agHero">
      <span class="pill">TU AGENTE IA PERSONAL · AGENTES AIA</span>
      <h1>Un compañero que te conoce y <span class="grad">no empieza de cero</span> cada vez</h1>
      <p>Busca tu perfil: cada uno tiene su agente. Recordará lo que le cuentes, llevará tus pendientes, proyectos y agenda, y cada mañana te dirá qué tienes por delante.</p>
      <div class="agHeroRow">${AGENTS.map(a => `<button type="button" class="agHeroPick" onclick="showAgentCard('${a.key}')" aria-label="Ver a ${esc(a.name)}">${agentPic(a.key, 'saluda', '', '')}<span>${esc(a.name)}</span></button>`).join('')}</div>
      <a class="btn primary" href="#elige">Buscar mi perfil</a>
    </section>
    <section class="section" id="elige">
      <div class="sectionIntro"><span class="eyebrow">LOS 9 AGENTES AIA</span><h2>¿A qué te dedicas?</h2><p class="muted">Busca tu perfil y conoce al agente que te va a acompañar. Cada uno conoce el trabajo de su perfil y te habla y te propone cosas pensadas para ti.</p></div>
      <div class="agCards">${AGENTS.map(a => `
        <article class="agCard" id="agente-${a.key}">
          <div class="agCardPic">${agentPic(a.key, 'saluda', '', `${esc(a.name)}, ${esc(a.animal || 'agente AIA')}`, 'loading="lazy"')}</div>
          <div class="agCardBody">
            <span class="agCardFor">${esc(a.label)}</span>
            <h3>${esc(a.name)} <small>${esc(a.vibe)}</small></h3>
            <p>${esc(a.help)}</p>
            <ul>${a.ex.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            <button class="btn primary" onclick="pickAgent('${a.key}')" aria-label="${esc(a.label)}: este es mi perfil, empezar con ${esc(a.name)}">Este es mi perfil</button>
          </div>
        </article>`).join('')}</div>
    </section>
    <section class="section softSection">
      <div class="sectionIntro"><span class="eyebrow">CÓMO FUNCIONA</span><h2>Así de sencillo</h2></div>
      <div class="steps agSteps">${[['1', 'Busca tu perfil', 'Docente, autónomo, estudiante… y conoce a tu agente.'], ['2', 'Cuéntale de ti', 'Qué haces y en qué quieres que te ayude. Puedes cambiarlo cuando quieras.'], ['3', 'Habla con él cada día', 'Le cuentas tus cosas y él las ordena en listas.'], ['4', 'Recibe tu resumen', 'Cada mañana, un correo con tu agenda, tus pendientes y el siguiente paso.']].map(x => `<div class="card step"><span class="stepNum">${x[0]}</span><h3>${x[1]}</h3><p class="muted">${x[2]}</p></div>`).join('')}</div>
    </section>
    <section class="section">
      <div class="sectionIntro"><span class="eyebrow">LO QUE LLEVA POR TI</span><h2>Todo en su sitio</h2></div>
      <div class="grid agKeeps">${[['Pendientes', 'Lo que tienes que hacer, y lo marca como hecho cuando le dices que ya está.'], ['Proyectos', 'Tus proyectos por etapas, con el siguiente paso siempre claro.'], ['Agenda', 'Citas, entregas y fechas importantes, para que no se te pasen.'], ['Lo que recuerdo', 'Lo que le contaste de ti y de tu trabajo, para no tener que repetirlo.']].map(x => `<div class="card"><h3>${x[0]}</h3><p class="muted">${x[1]}</p></div>`).join('')}</div>
      <p class="muted small agPrivacy">No le cuentes contraseñas, datos bancarios ni de salud. Puedes borrar cualquier cosa que recuerde cuando quieras.</p>
    </section>
    <section class="section"><div class="planCard"><div><span class="pill">GRATIS DURANTE LA FASE DE PRUEBA</span><h2>Crea tu agente hoy</h2><p>Solo necesitas tu cuenta de CURO Group. Si no la tienes, la creas gratis en un minuto.</p></div><a class="btn primary" href="#elige">Buscar mi perfil</a></div></section>
  </main>
  <footer class="footer"><div class="footerBottom"><span>© 2026 CURO Group · Madrid, España</span><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></div></footer>`;
}
// Al elegir: con sesión va directo a crear el agente con ese perfil; sin sesión, pide entrar y vuelve aquí.
// Al tocar un personaje de arriba, baja hasta su perfil y lo resalta un momento.
function showAgentCard(key) {
  const c = document.getElementById('agente-' + key); if (!c) return;
  c.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelectorAll('.agCard.flash').forEach(x => x.classList.remove('flash'));
  c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 2200);
}
function pickAgent(key) {
  lstore('curo_agent_pick', { key, ts: Date.now() });
  if (session) return go('Mi agente');
  const a = agentByKey(key);
  closeModals();
  modal(`${esc(a.label)}: tu agente es ${esc(a.name)}`, `<div class="agPickModal">${agentPic(a.key, 'saluda', '', esc(a.name))}<div class="agBubble"><b>¡Hola! Soy ${esc(a.name)}.</b><p>Para poder recordar lo que me cuentes, necesito que entres con tu cuenta de CURO. Si todavía no tienes, la creas gratis en un minuto y vuelves aquí conmigo.</p></div></div>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Seguir mirando</button><button class="btn primary" onclick="lstore('curo_ir','agente');lstore('curo_pick_login',1);closeModals();login('signup')">Entrar o crear mi cuenta</button>`
  });
}
function takeAgentPick() {
  const p = lrecall('curo_agent_pick');
  lstore('curo_agent_pick', null);
  return p && Date.now() - p.ts < 864e5 ? p.key : null;
}

// ---------- Mi agente: agente IA personal ----------
let agentState = null, agentTab = 'pendiente';
const AGENT_TABS = [['pendiente', 'Pendientes'], ['proyecto', 'Proyectos'], ['agenda', 'Agenda'], ['memoria', 'Lo que recuerdo']];
const AGENT_ICONS = { docente: '🍎', community: '📣', creador: '🎬', emprendedor: '🚀', autonomo: '💼', estudiante: '📚', pyme: '👥', descubridor: '🧭' };
function openAgent() {
  if (session) return go('Mi agente');
  agentsLanding();
}
// ---------- Bienvenida del agente (primera vez): en el centro, con las preguntas de a una ----------
// Poses disponibles por agente; si falta alguna se usa la imagen fija.
const AGENT_POSES = { autonomo: ['saluda', 'celebra', 'ups', 'duerme'], docente: ['saluda', 'celebra', 'ups', 'duerme'], profesional: ['saluda', 'celebra', 'ups', 'duerme'], descubridor: ['saluda', 'celebra', 'ups', 'duerme'], estudiante: ['saluda', 'celebra', 'ups', 'duerme'], community: ['saluda', 'celebra', 'ups', 'duerme'], creador: ['saluda', 'celebra', 'ups', 'duerme'], pyme: ['saluda', 'celebra', 'ups', 'duerme'], emprendedor: ['saluda', 'celebra', 'ups', 'duerme'] };
const agentPose = (k, pose) => (AGENT_POSES[k] || []).includes(pose) ? `img/agentes/${k}-${pose}.png?v=4` : agentImg(k);
// Vídeos con movimiento (comprimidos, sin sonido, en bucle). Si una pose no tiene vídeo se usa el dibujo fijo.
const AGENT_VIDEOS = { docente: ['saluda', 'ups', 'celebra', 'duerme'], profesional: ['saluda', 'ups', 'celebra', 'duerme'], pyme: ['saluda', 'ups', 'celebra', 'duerme'], estudiante: ['saluda', 'ups', 'celebra', 'duerme'], emprendedor: ['saluda', 'ups', 'celebra', 'duerme'], descubridor: ['saluda', 'ups', 'celebra', 'duerme'], community: ['saluda', 'ups', 'celebra', 'duerme'], creador: ['saluda', 'ups', 'celebra', 'duerme'], autonomo: ['saluda', 'ups', 'celebra', 'duerme'] };
const agentVideo = (k, pose) => (AGENT_VIDEOS[k] || []).includes(pose) ? `img/agentes/${k}-${pose}` : null;
// <video> si existe, si no <img>. cls/alt se aplican a ambos.
function agentPic(k, pose, cls, alt, extra) {
  const v = agentVideo(k, pose), poster = (AGENT_POSES[k] || []).includes(pose) ? `img/agentes/${k}-${pose}.png?v=4` : agentImg(k);
  if (v) return `<video class="${cls || ''} agVid" autoplay muted loop playsinline preload="auto" poster="${poster}" aria-label="${alt || ''}" ${extra || ''}><source src="${v}.mp4?v=2" type="video/mp4"></video>`;
  return `<img class="${cls || ''}" src="${poster}" alt="${alt || ''}" ${extra || ''}>`;
}
// ---------- Apariencia del agente: animalito, persona (retrato hecho con IA) o sencillo (logo AIA) ----------
// Retratos disponibles: al añadir una cara nueva basta con sumarla aquí.
const PERSONAS = []; // { id: 'persona-1', src: 'img/agentes/personas/persona-1.jpg' }
function myLook() {
  const l = agentState?.settings?.look || 'animal';
  if (l === 'sencillo') return l;
  return PERSONAS.some(p => p.id === l) ? l : 'animal';
}
// Cara del agente cuando no es el animalito. La pose (saluda, ups, celebra, duerme) se muestra con efectos suaves.
function lookFace(pose, big) {
  const l = myLook(), p = PERSONAS.find(x => x.id === l);
  const inner = p ? `<img src="${p.src}" alt="">` : '<span class="aiaLogo">AIA</span>';
  return `<span class="agFace ${big ? 'big' : ''} ${p ? 'persona' : 'simple'}" data-pose="${pose || 'ups'}">${inner}${big ? '<small class="aiaTag">AIA</small>' : ''}</span>`;
}
function pickLook(b) { document.querySelectorAll('#agLookGrid .lookCard').forEach(x => x.classList.toggle('sel', x === b)); b.blur(); }
let welcome = null;
// Cómo le gusta que le hablen: opciones para tocar, nada para escribir.
const TONE_OPTIONS = [
  { v: 'Directo y breve: frases cortas, solo lo esencial.', l: 'Directo y breve', d: 'Frases cortas, solo lo esencial' },
  { v: 'Con una explicación breve de cada cosa, sin dar por hecho que ya lo sabe.', l: 'Con un poco más de explicación', d: 'Que le aclare el porqué de cada cosa' },
  { v: 'Cercano y cálido, con alguna sonrisa de vez en cuando.', l: 'Cercano y cálido', d: 'Como charlando con alguien de confianza' }
];
function agentWelcome(pickKey) {
  if (pickKey && lrecall('curo_pick_login')) { lstore('curo_pick_login', null); setTimeout(() => toast('¡Ya estás dentro! Vamos a armar tu agente.'), 400); }
  welcome = { step: pickKey ? 'hola' : 'perfil', profile: pickKey || null, about: '', goals: '', tone: '', brief: true, time: '08:00' };
  // Intereses marcados al registrarse en CURO: punto de partida para "¿En qué quieres que te ayude?".
  try { if (sb.auth.getUser) Promise.resolve().then(() => sb.auth.getUser()).then(({ data }) => {
    const ints = data?.user?.user_metadata?.interests;
    const list = Array.isArray(ints) ? ints : typeof ints === 'string' ? ints.split(',') : [];
    if (welcome && !welcome.goals && list.length) welcome.goals = 'Me interesa: ' + list.map(x => String(x).trim()).filter(Boolean).join(', ') + '.';
  }).catch(() => {}); } catch {}
  renderWelcome();
}
function renderWelcome() {
  try { stopSpeaking(); } catch {}
  const w = welcome, a = w.profile ? agentByKey(w.profile) : null;
  const first = (me?.user?.name || '').split(' ')[0];
  const hi = first ? `, ${esc(first)}` : '';
  const steps = ['about', 'goals', 'tono', 'brief'];
  const dots = steps.includes(w.step) ? `<div class="wDots" aria-hidden="true">${steps.map(s => `<span class="${s === w.step ? 'on' : steps.indexOf(s) < steps.indexOf(w.step) ? 'done' : ''}"></span>`).join('')}</div>` : '';
  let body = '';
  if (w.step === 'perfil') {
    body = `<div class="wCenter"><h2>¿A qué te dedicas?</h2><p class="muted">Elige tu perfil y conoce al agente que te va a acompañar.</p>
      <div class="profileGrid">${AGENTS.map(x => `<button type="button" class="profileCard" onclick="welcome.profile='${x.key}';welcome.step='hola';renderWelcome()">${agentPic(x.key, 'saluda', 'profilePic', '')}<b>${esc(x.name)}</b><small class="profileFor">${esc(x.label)}</small></button>`).join('')}</div></div>`;
  } else if (w.step === 'hola') {
    body = `<div class="wCenter wHello">${agentPic(a.key, 'saluda', 'wBig', `${esc(a.name)} saluda`)}
      <div class="agBubble wBubble"><b>¡Hola${hi}! Soy ${esc(a.name)}.</b><p>Voy a ser tu agente personal. Te ayudo a recordar lo importante, ordenar tus pendientes y proyectos, y cada mañana te digo qué tienes por delante.</p>${voiceOk() ? `<button type="button" class="btn linkbtn wListen" onclick="speakMsg(this)" aria-label="Escuchar a ${esc(a.name)}">🔊 Escuchar a ${esc(a.name)}</button>` : ''}</div>
      <button class="btn primary wGo" onclick="welcome.step='about';renderWelcome()">¡Empecemos!</button>
      <button class="btn linkbtn" onclick="welcome.step='perfil';renderWelcome()">No es mi perfil</button></div>`;
  } else if (w.step === 'about' || w.step === 'goals') {
    const isAbout = w.step === 'about';
    const q = isAbout ? '¿A qué te dedicas?' : '¿En qué quieres que te ayude?';
    const ph = isAbout ? 'Por ejemplo: soy profesora de primaria en Madrid y doy clases de inglés por las tardes.' : 'Por ejemplo: organizar mis clases de la semana, no olvidarme de las entregas y preparar materiales.';
    body = `<div class="wChat">${dots}<div class="agBotRow">${agentPic(a.key, 'ups', 'agAvatar big', '')}<div class="agMsg bot">${q}</div></div>
      <div class="dictationWrap"><textarea id="wInput" rows="3" maxlength="2000" placeholder="${ph}">${esc(isAbout ? w.about : w.goals)}</textarea>
      <button class="dictateBtn" type="button" onclick="toggleDictation('wInput',this)" aria-label="Dictar la respuesta">🎙 <span>Dictar</span></button></div>
      <div class="actions"><button class="btn ghost" onclick="welcomeNext(true)">Saltar</button><button class="btn primary" onclick="welcomeNext(false)">Siguiente</button></div></div>`;
  } else if (w.step === 'tono') {
    body = `<div class="wChat">${dots}<div class="agBotRow">${agentPic(a.key, 'ups', 'agAvatar big', '')}<div class="agMsg bot">¿Cómo te gusta que te hable?</div></div>
      <div class="toneGrid">${TONE_OPTIONS.map(t => `<button type="button" class="toneCard ${w.tone === t.v ? 'sel' : ''}" onclick="welcome.tone='${t.v.replace(/'/g, "\\'")}';welcome.step='brief';renderWelcome()"><b>${esc(t.l)}</b><small>${esc(t.d)}</small></button>`).join('')}</div>
      <div class="actions"><button class="btn ghost" onclick="welcome.step='goals';renderWelcome()">Atrás</button><button class="btn linkbtn" onclick="welcome.step='brief';renderWelcome()">Da igual, elige tú</button></div></div>`;
  } else if (w.step === 'brief') {
    body = `<div class="wChat">${dots}<div class="agBotRow">${agentPic(a.key, 'ups', 'agAvatar big', '')}<div class="agMsg bot">¿Te mando cada mañana un correo con tu agenda, tus pendientes y el siguiente paso?</div></div>
      <div class="wChoices"><label class="toggle"><input type="radio" name="wBrief" value="1" ${w.brief ? 'checked' : ''}> Sí, por favor</label><label class="toggle"><input type="radio" name="wBrief" value="0" ${w.brief ? '' : 'checked'}> Ahora no</label>
      <label class="field inlineField">Hora (Madrid)<input id="wTime" type="time" value="${esc(w.time)}"></label></div>
      <div class="actions"><button class="btn ghost" onclick="welcome.step='tono';renderWelcome()">Atrás</button><button class="btn primary" id="wSave" onclick="welcomeSave(this)">Listo</button></div></div>`;
  } else if (w.step === 'listo') {
    body = `<div class="wCenter wHello">${agentPic(a.key, 'celebra', 'wBig wJump', `${esc(a.name)} celebra`)}
      <div class="agBubble wBubble"><b>¡Perfecto${hi}!</b><p>Ya te conozco un poco. Cuéntame qué tienes que hacer esta semana y lo voy ordenando por ti.</p>${voiceOk() ? `<button type="button" class="btn linkbtn wListen" onclick="speakMsg(this)" aria-label="Escuchar">🔊 Escuchar</button>` : ''}</div>
      <button class="btn primary wGo" onclick="welcome=null;renderAgent()">Hablar con ${esc(a.name)}</button></div>`;
  }
  shell('Mi agente', `<div class="card wCard">${body}<p class="muted small wPriv">No le cuentes contraseñas, datos bancarios ni de salud. Puedes borrar cualquier cosa que recuerde cuando quieras.</p></div>`);
  document.getElementById('wInput')?.focus();
}
function welcomeNext(skip) {
  stopDictation(true);
  const v = skip ? '' : (document.getElementById('wInput')?.value.trim() || '');
  if (welcome.step === 'about') { welcome.about = v; welcome.step = 'goals'; }
  else { welcome.goals = v; welcome.step = 'tono'; }
  renderWelcome();
}
async function welcomeSave(btn) {
  welcome.brief = document.querySelector('input[name=wBrief]:checked')?.value !== '0';
  welcome.time = document.getElementById('wTime')?.value || '08:00';
  const done = busy(btn, 'Guardando…');
  try {
    const { settings } = await api('agent', { method: 'POST', body: { action: 'setup', profile: welcome.profile, about: welcome.about, goals: welcome.goals, tone: welcome.tone, brief_enabled: welcome.brief, brief_time: welcome.time } });
    agentState.settings = settings;
    welcome.step = 'listo'; renderWelcome();
  } catch (e) { done(); info('No se pudo guardar', e.message); }
}

// ---------- Voz del agente (lectura en voz alta con las voces del navegador) ----------
// Por defecto en silencio: solo habla si el usuario lo activa o toca 🔊 en un mensaje.
const VOICE_KEY = 'curo_agent_voice';
const AGENT_PITCH = { docente: 0.95, autonomo: 1, estudiante: 1.15, emprendedor: 1.08, community: 1.05, creador: 1.15, pyme: 0.9, profesional: 1, descubridor: 1.25 };
const voiceOk = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
function voicePrefs() { return { on: false, volume: 1, rate: 1, ...(lrecall(VOICE_KEY) || {}) }; }
function saveVoicePrefs(p) { lstore(VOICE_KEY, p); }
let voiceBtn = null;
function pickVoice() {
  const vs = (speechSynthesis.getVoices() || []).filter(v => /^es(-|_|$)/i.test(v.lang));
  if (!vs.length) return null;
  const score = v => (/es[-_]ES/i.test(v.lang) ? 3 : /es[-_](MX|US|AR|419)/i.test(v.lang) ? 2 : 1) + (/Google|Mónica|Monica|Paulina|Marisol|Helena|Elvira|Natural|Premium|Enhanced/i.test(v.name) ? 3 : 0) + (v.localService ? 0 : 1);
  return vs.sort((a, b) => score(b) - score(a))[0];
}
function cleanForSpeech(t) {
  return String(t || '').replace(/https?:\/\/\S+/g, 'el enlace').replace(/[•·▪►*#_`>|]/g, ' ').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}
// Mientras habla: el personaje se mueve al ritmo de las palabras y aparecen ondas de sonido.
function talkTargets(btn) {
  const t = [...document.querySelectorAll('.agHead .agAvatar, .wBig')];
  const row = btn?.closest('.agBotRow'); if (row) t.push(row.querySelector('.agAvatar'));
  return t.filter(Boolean);
}
let talkingEls = [];
function setTalking(on, btn) {
  talkingEls.forEach(el => el.classList.remove('talking', 'pop'));
  talkingEls = on ? talkTargets(btn) : [];
  talkingEls.forEach(el => el.classList.add('talking'));
}
function talkPop() { talkingEls.forEach(el => { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }); }
function stopSpeaking() {
  setTalking(false);
  if (!voiceOk()) return;
  try { speechSynthesis.cancel(); } catch {}
  if (voiceBtn) { voiceBtn.classList.remove('speaking'); voiceBtn.textContent = voiceBtn.dataset.label || '🔊'; voiceBtn.setAttribute('aria-label', voiceBtn.dataset.aria || 'Escuchar este mensaje'); voiceBtn = null; }
}
// Lee por frases (Chrome corta los textos largos a los ~15 segundos).
function speak(text, btn, force, over) {
  if (!voiceOk()) return false;
  const p = { ...voicePrefs(), ...(over || {}) };
  if (!force && !p.on) return false;
  stopSpeaking();
  if (activeRecognition) return false; // no habla mientras el usuario dicta
  const clean = cleanForSpeech(text); if (!clean) return false;
  const parts = clean.match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || [clean];
  const voice = pickVoice();
  const pitch = AGENT_PITCH[agentState?.settings?.profile || welcome?.profile] || 1;
  setTalking(true, btn);
  if (btn) { voiceBtn = btn; if (!btn.dataset.label) btn.dataset.label = btn.textContent; btn.dataset.aria = btn.getAttribute('aria-label') || ''; btn.classList.add('speaking'); btn.textContent = '⏹' + (btn.classList.contains('wListen') ? ' Parar' : ''); btn.setAttribute('aria-label', 'Dejar de escuchar'); }
  parts.map(s => s.trim()).filter(Boolean).forEach((s, i, arr) => {
    const u = new SpeechSynthesisUtterance(s);
    u.lang = voice?.lang || 'es-ES'; if (voice) u.voice = voice;
    u.volume = Math.max(0, Math.min(1, Number(p.volume) || 1)); u.rate = Number(p.rate) || 1; u.pitch = pitch;
    u.onboundary = e => { if (e.name === 'word' || e.name === undefined) talkPop(); };
    u.onstart = () => talkPop();
    if (i === arr.length - 1) u.onend = u.onerror = () => { setTalking(false); if (voiceBtn === btn) stopSpeaking(); };
    speechSynthesis.speak(u);
  });
  return true;
}
function speakMsg(btn) {
  if (btn.classList.contains('speaking')) return stopSpeaking();
  let t = btn.closest('.agBotRow')?.querySelector('.agMsg')?.innerText || '';
  if (!t) { const b = btn.closest('.agBubble')?.cloneNode(true); b?.querySelectorAll('button').forEach(x => x.remove()); t = b?.innerText || ''; }
  speak(t, btn, true);
}
function voiceToggleHtml() {
  if (!voiceOk()) return '';
  const p = voicePrefs();
  return `<button class="btn ghost smallBtn agVoiceBtn" id="agVoiceBtn" onclick="openVoicePanel()" aria-label="Voz del agente: ${p.on ? 'activada' : 'en silencio'}">${p.on ? '🔊 Con voz' : '🔇 Silencio'}</button>`;
}
function openVoicePanel() {
  const p = voicePrefs(), name = agentByKey(agentState?.settings?.profile).name;
  const hasEs = !!pickVoice();
  const m = modal('Voz de tu agente', `
    <label class="toggle"><input type="checkbox" id="vOn" ${p.on ? 'checked' : ''}> Que ${esc(name)} lea en voz alta cada respuesta nueva</label>
    <p class="muted small">Apagado, ${esc(name)} solo escribe. Igual puedes tocar 🔊 en cualquier mensaje para escucharlo.</p>
    <label class="field">Volumen de la voz <input id="vVol" type="range" min="0.1" max="1" step="0.1" value="${p.volume}"></label>
    <label class="field">Velocidad <select id="vRate"><option value="0.85" ${p.rate == 0.85 ? 'selected' : ''}>Lenta</option><option value="1" ${p.rate == 1 ? 'selected' : ''}>Normal</option><option value="1.15" ${p.rate == 1.15 ? 'selected' : ''}>Rápida</option></select></label>
    <p class="muted small">Este volumen es el de la voz del agente. Si tu computadora o tu celular están en silencio o con el volumen bajo, súbelo también ahí.</p>
    ${hasEs ? '' : '<div class="notice warn">Tu navegador no tiene voces en español instaladas, así que la voz puede sonar con acento. Prueba con Chrome, Safari o Edge.</div>'}`, {
    actions: `<button class="btn ghost" id="vTest">Probar voz</button><button class="btn primary" id="vSave">Guardar</button>`
  });
  const read = () => ({ on: m.querySelector('#vOn').checked, volume: Number(m.querySelector('#vVol').value), rate: Number(m.querySelector('#vRate').value) });
  m.querySelector('#vTest').addEventListener('click', () => speak(`Hola, soy ${name}. Así sueno cuando te hablo.`, null, true, read()));
  m.querySelector('#vSave').addEventListener('click', () => {
    const np = read(); saveVoicePrefs(np); closeModals(); stopSpeaking();
    const b = document.getElementById('agVoiceBtn'); if (b) b.outerHTML = voiceToggleHtml();
    toast(np.on ? `${name} te leerá sus respuestas.` : `${name} queda en silencio: solo escribe.`);
  });
}
if (voiceOk()) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch {} window.addEventListener('pagehide', stopSpeaking); }

async function agentPage() {
  loading('Mi agente', 'Abriendo tu agente…');
  try { agentState = await api('agent'); }
  catch (e) { return shell('Mi agente', `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="go('Mi agente')">Reintentar</button></div>`); }
  // Si eligió un agente en la presentación, se abre la elección con ese agente marcado (también si ya tenía uno).
  // Primera vez: bienvenida en el centro con el agente elegido (o la elección de perfil).
  if (!agentState.settings) {
    // Si la bienvenida ya está en marcha (la página se carga dos veces al entrar), se sigue donde estaba.
    if (welcome?.profile) return renderWelcome();
    const pk = takeAgentPick();
    // Sin perfil elegido todavía: se muestra la presentación de los 9 agentes; al elegir, el agente saluda.
    return pk ? agentWelcome(pk) : agentsLanding();
  }
  const pick = lrecall('curo_agent_pick');
  agentJustEntered = true; // al entrar, el agente siempre saluda
  pick ? agentSetup(true) : renderAgent();
}
function agentSetup(edit = false) {
  const s = { ...(agentState.settings || {}) };
  const pick = takeAgentPick(); if (pick) s.profile = pick;
  // Al volver de "Entrar o crear mi cuenta" se le confirma que ya está dentro (sin afirmar si tuvo o no que escribir su contraseña).
  if (pick && lrecall('curo_pick_login')) { lstore('curo_pick_login', null); setTimeout(() => toast('¡Ya estás dentro! Vamos a armar tu agente.'), 400); }
  const chosen = s.profile ? agentByKey(s.profile) : null;
  const time = String(s.brief_time || '08:00').slice(0, 5);
  const first = (me?.user?.name || '').split(' ')[0];
  const lookNow = s.look || 'animal';
  const lookCards = `<button type="button" class="lookCard ${lookNow === 'animal' ? 'sel' : ''}" data-look="animal" onclick="pickLook(this)"><span class="lookPic">${agentPic(chosen?.key || 'descubridor', 'saluda', '', '')}</span><b>Animalito</b><small>Tu personaje con movimiento</small></button>`
    + (PERSONAS.length ? PERSONAS.map((p, i) => `<button type="button" class="lookCard ${lookNow === p.id ? 'sel' : ''}" data-look="${p.id}" onclick="pickLook(this)"><span class="lookPic"><img class="lookFaceImg" src="${p.src}" alt=""></span><b>Persona ${i + 1}</b><small>Retrato hecho con IA</small></button>`).join('')
      : `<button type="button" class="lookCard soon" disabled><span class="lookPic"><span class="agFace simple"><span class="aiaLogo">👤</span></span></span><b>Persona</b><small>Muy pronto</small></button>`)
    + `<button type="button" class="lookCard ${lookNow === 'sencillo' ? 'sel' : ''}" data-look="sencillo" onclick="pickLook(this)"><span class="lookPic"><span class="agFace simple"><span class="aiaLogo">AIA</span></span></span><b>Sencillo</b><small>Solo el logo AIA</small></button>`;
  const grid = `<div class="profileGrid">${AGENTS.map(a => `<button type="button" class="profileCard ${s.profile === a.key ? 'sel' : ''}" data-p="${a.key}" aria-pressed="${s.profile === a.key}" onclick="selectSetupAgent('${a.key}')">${agentPic(a.key, 'saluda', 'profilePic', '')}<b>${esc(a.name)}</b><small class="profileFor">${esc(a.label)}</small><small>${esc(a.help)}</small></button>`).join('')}</div>`;
  shell('Mi agente', `<div class="card agentSetup">
    <div class="agWelcome" id="agWelcome">${setupWelcome(chosen, first, edit)}</div>
    ${chosen ? `<details class="agOther" ${edit ? '' : ''}><summary>¿No es tu perfil? Cámbialo aquí</summary>${grid}</details>` : `<small class="muted">1. ¿CUÁL ES TU PERFIL?</small>${grid}`}
    <label class="field"><span class="agQ">¿A qué te dedicas?</span> <span class="muted">(opcional)</span><div class="dictationWrap"><textarea id="agAbout" rows="3" maxlength="2000" placeholder="Por ejemplo: soy profesora de primaria en Madrid y doy clases de inglés por las tardes.">${esc(s.about || '')}</textarea><button class="dictateBtn" type="button" onclick="toggleDictation('agAbout',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div></label>
    <label class="field"><span class="agQ">¿En qué quieres que te ayude?</span> <span class="muted">(opcional)</span><div class="dictationWrap"><textarea id="agGoals" rows="3" maxlength="2000" placeholder="Por ejemplo: organizar mis clases de la semana, no olvidarme de las entregas y preparar materiales.">${esc(s.goals || '')}</textarea><button class="dictateBtn" type="button" onclick="toggleDictation('agGoals',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div></label>
    <div class="plannerStep"><small class="agQ">¿CÓMO QUIERES VER A TU AGENTE?</small>
      <div class="lookGrid" id="agLookGrid">${lookCards}</div></div>
    <div class="plannerStep"><small class="agQ">¿CÓMO TE GUSTA QUE TE HABLE?</small>
      <div class="toneGrid" id="agToneGrid">${TONE_OPTIONS.map(t => `<button type="button" class="toneCard ${s.tone === t.v ? 'sel' : ''}" data-tone="${esc(t.v)}" onclick="document.querySelectorAll('#agToneGrid .toneCard').forEach(b=>b.classList.toggle('sel',b===this));this.blur()"><b>${esc(t.l)}</b><small>${esc(t.d)}</small></button>`).join('')}</div></div>
    <div class="plannerStep"><small class="agQ">¿TE MANDO CADA MAÑANA UN RESUMEN?</small>
      <label class="toggle"><input type="checkbox" id="agBrief" ${s.brief_enabled === false ? '' : 'checked'}> Sí, un correo con mi agenda, mis pendientes y el siguiente paso</label>
      <label class="field inlineField">Hora (Madrid)<input id="agTime" type="time" value="${esc(time)}"></label></div>
    <p class="muted small">No le cuentes contraseñas, datos bancarios ni de salud. Puedes borrar cualquier cosa que recuerde cuando quieras.</p>
    <div class="actions">${edit ? `<button class="btn ghost" onclick="renderAgent()">Cancelar</button>` : ''}<button class="btn primary" id="agSave">${edit ? 'Guardar cambios' : chosen ? `Empezar con ${esc(chosen.name)}` : 'Crear mi agente'}</button></div>
  </div>`);
  // Si al registrarse en CURO marcó intereses, se proponen como punto de partida.
  if (!edit && !s.goals && sb.auth.getUser) Promise.resolve().then(() => sb.auth.getUser()).then(({ data }) => {
    const ints = data?.user?.user_metadata?.interests;
    const list = Array.isArray(ints) ? ints : typeof ints === 'string' ? ints.split(',') : [];
    const g = document.getElementById('agGoals');
    if (g && !g.value && list.length) g.value = 'Me interesa: ' + list.map(x => String(x).trim()).filter(Boolean).join(', ') + '.';
  }).catch(() => {});
  document.getElementById('agSave').addEventListener('click', async e => {
    const profile = document.querySelector('.profileCard.sel')?.dataset.p;
    if (!profile) return toast('Elige primero tu perfil.', 'warn');
    const done = busy(e.currentTarget, 'Guardando…');
    try {
      const tone = document.querySelector('#agToneGrid .toneCard.sel')?.dataset.tone || '';
      const { settings } = await api('agent', { method: 'POST', body: { action: 'setup', profile, about: agAbout.value.trim(), goals: agGoals.value.trim(), tone, look: document.querySelector('#agLookGrid .lookCard.sel')?.dataset.look || 'animal', brief_enabled: agBrief.checked, brief_time: agTime.value || '08:00' } });
      agentState.settings = settings;
      toast(edit ? 'Cambios guardados.' : `¡${agentByKey(profile).name} ya está listo!`);
      renderAgent();
    } catch (err) { done(); info('No se pudo guardar', err.message); }
  });
}
function setupWelcome(a, first, edit) {
  if (!a) return `<span class="pill">CREA TU AGENTE IA PERSONAL</span><h2>Un asistente que te conoce y recuerda lo importante</h2><p class="muted">Elige el agente que más se parece a ti. Recordará lo que le cuentes, llevará tus pendientes, proyectos y agenda, y cada mañana te dirá qué tienes por delante.</p>`;
  return `${agentPic(a.key, 'saluda', 'agWelcomePic', esc(a.name))}<div class="agBubble"><b>${edit ? `Aquí puedes cambiar cómo te ayudo${first ? `, ${esc(first)}` : ''}.` : `¡Hola${first ? `, ${esc(first)}` : ''}! Soy ${esc(a.name)}.`}</b><p>${edit ? 'Cuéntame si algo cambió en tu trabajo o en lo que necesitas.' : `Voy a ser tu agente personal${a.label ? ` (${esc(a.label.toLowerCase())})` : ''}. Cuéntame un poco de ti para ayudarte mejor: con tres respuestas ya podemos empezar.`}</p></div>`;
}
function selectSetupAgent(key) {
  document.querySelectorAll('.profileCard').forEach(b => { const on = b.dataset.p === key; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
  const w = document.getElementById('agWelcome'); const first = (me?.user?.name || '').split(' ')[0];
  if (w && w.querySelector('.agBubble')) w.innerHTML = setupWelcome(agentByKey(key), first, false);
  const btn = document.getElementById('agSave'); if (btn && !/Guardar/.test(btn.textContent)) btn.textContent = `Empezar con ${agentByKey(key).name}`;
}
function agentMsgHtml(m) {
  if (m.role === 'user') {
    const del = m.id ? `<button type="button" class="agMsgDel" onclick="agentDeleteMsg('${m.id}',this)" aria-label="Borrar este mensaje" title="Borrar este mensaje">×</button>` : '';
    return `<div class="agMsgRow me"><div class="agMsg me">${esc(m.content).replace(/\n/g, '<br>')}</div>${del}</div>`;
  }
  const txt = `<div class="agMsg bot">${esc(m.content).replace(/\n/g, '<br>')}</div>`;
  const say = voiceOk() ? `<button type="button" class="agSay" onclick="speakMsg(this)" aria-label="Escuchar este mensaje" title="Escuchar">🔊</button>` : '';
  return `<div class="agBotRow" data-id="${m.id || ''}">${myLook() === 'animal' ? agentPic(agentState?.settings?.profile || 'descubridor', 'ups', 'agAvatar', '') : lookFace('ups')}${txt}${say}</div>`;
}
// Borra un único mensaje propio (no hace falta borrar toda la conversación). Si el agente ya
// había contestado a ese mensaje, esa respuesta también se borra para no dejarla descontextualizada.
async function agentDeleteMsg(id, btn) {
  const row = btn.closest('.agMsgRow');
  btn.disabled = true;
  try {
    const r = await api('agent', { method: 'POST', body: { action: 'deleteMessage', id } });
    const delIds = new Set([String(id), r.replyId != null ? String(r.replyId) : null].filter(Boolean));
    agentState.messages = (agentState.messages || []).filter(m => !delIds.has(String(m.id)));
    row?.remove();
    if (r.replyId != null) document.querySelector(`.agBotRow[data-id="${r.replyId}"]`)?.remove();
  } catch (err) { btn.disabled = false; info('No se pudo borrar', err.message); }
}
function agentItemsHtml() {
  const items = (agentState.items || []).filter(i => agentTab === 'agenda' ? (i.kind === 'agenda' || (i.due_at && i.kind !== 'memoria')) : i.kind === agentTab);
  const active = items.filter(i => i.status === 'activo'), done = items.filter(i => i.status !== 'activo').slice(0, 10);
  if (agentTab === 'agenda') active.sort((a, b) => new Date(a.due_at || 8.64e15) - new Date(b.due_at || 8.64e15));
  const row = i => `<li class="agItem ${i.status !== 'activo' ? 'done' : ''}">
    ${agentTab !== 'memoria' ? `<button class="agCheck" title="${i.status === 'activo' ? 'Marcar como hecho' : 'Volver a pendiente'}" onclick="agentItem('${i.status === 'activo' ? 'done' : 'undo'}','${i.id}')">${i.status === 'activo' ? '' : '✓'}</button>` : ''}
    <div><b>${esc(i.title)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ''}${i.due_at ? `<small class="agDue">📅 ${fmtDate(i.due_at)}</small>` : ''}</div>
    <button class="iconBtn" title="Borrar" aria-label="Borrar" onclick="agentItem('delete','${i.id}')">×</button></li>`;
  const empty = { pendiente: 'Sin pendientes. Cuéntale a tu agente lo que tienes que hacer.', proyecto: 'Aún no hay proyectos. Háblale de lo que estás preparando.', agenda: 'Nada en la agenda. Dile tus citas y entregas con fecha.', memoria: 'Todavía no recuerda nada. Cuéntale sobre ti y tu trabajo.' }[agentTab];
  return `<ul class="agList">${active.map(row).join('') || `<li class="muted agEmpty">${empty}</li>`}</ul>${done.length ? `<details class="agDone"><summary>Hechos (${done.length})</summary><ul class="agList">${done.map(row).join('')}</ul></details>` : ''}`;
}
// Cuándo cambia de pose el personaje de la cabecera (mientras no tenga animación):
// saluda al volver tras un rato sin usarlo o la primera vez; duda (ups) mientras piensa lo que le pidió el usuario;
// celebra cuando logra algo (guarda en las listas); duerme si hay un rato sin actividad en la pantalla.
let agentHeroTimer = null, agentIdleTimer = null, agentJustEntered = false;
// Pose de reposo: pensando y trabajando (duda). Si el agente no tiene esa pose, su dibujo fijo.
const agentRest = k => agentPose(k, 'ups');
function agentHeroPose(pose, holdMs) {
  const face = document.querySelector('#agFaceWrap .agFace');
  if (face) {
    clearTimeout(agentHeroTimer); face.dataset.pose = pose;
    if (holdMs) agentHeroTimer = setTimeout(() => { if (face.isConnected) face.dataset.pose = 'ups'; }, holdMs);
    return;
  }
  const img = document.getElementById('agHeroPic'); if (!img) return;
  const key = agentState?.settings?.profile; if (!key) return;
  clearTimeout(agentHeroTimer);
  if (holdMs && agentVideo(key, pose)) holdMs = Math.max(holdMs, 5200);
  img.src = agentPose(key, pose);
  agentHeroVideo(key, pose);
  if (holdMs) agentHeroTimer = setTimeout(() => { if (img.isConnected) { img.src = agentRest(key); agentHeroVideo(key, null); } }, holdMs);
}
function agentHeroVideo(key, pose) {
  const img = document.getElementById('agHeroPic'), vid = document.getElementById('agHeroVid'); if (!img || !vid) return;
  const v = agentVideo(key, pose || 'ups'); // sin dibujos fijos: en reposo, pensando con movimiento
  if (!v) { vid.pause(); vid.hidden = true; img.hidden = false; return; }
  vid.innerHTML = `<source src="${v}.mp4?v=2" type="video/mp4">`;
  vid.loop = pose !== 'duerme'; // al dormirse lo hace una vez y se queda dormido
  vid.poster = img.src; vid.load(); vid.hidden = false; img.hidden = true;
  const p = vid.play(); if (p && p.catch) p.catch(() => { vid.hidden = true; img.hidden = false; });
}
function agentResetIdle(wake) {
  clearTimeout(agentIdleTimer);
  const face = document.querySelector('#agFaceWrap .agFace');
  if (face && wake !== false && ['duerme', 'saluda'].includes(face.dataset.pose)) face.dataset.pose = 'ups';
  const img = document.getElementById('agHeroPic');
  if (wake !== false && img && (img.src.includes('-duerme') || img.src.includes('-saluda'))) { clearTimeout(agentHeroTimer); img.src = agentRest(agentState?.settings?.profile); agentHeroVideo(agentState?.settings?.profile, null); }
  agentIdleTimer = setTimeout(() => agentHeroPose('duerme'), 90000);
}
function renderAgent() {
  const s = agentState.settings, prof = agentState.profiles.find(p => p.key === s.profile) || {};
  const msgs = agentState.messages || [];
  const first = (me?.user?.name || '').split(' ')[0];
  const greeting = agentReturnGreeting(msgs);
  const hello = agentJustEntered || greeting || !msgs.length; agentJustEntered = false;
  const heroPose = hello ? agentPose(s.profile, 'saluda') : agentRest(s.profile);
  clearTimeout(agentHeroTimer); clearTimeout(agentIdleTimer);
  shell('Mi agente', `
    <div class="agHead card"><div class="agWho"><span class="agHeroWrap" id="agFaceWrap">${myLook() === 'animal' ? `<img class="agAvatar big" id="agHeroPic" src="${heroPose}" alt=""><video class="agAvatar big agVid" id="agHeroVid" muted loop playsinline hidden></video>` : lookFace(hello ? 'saluda' : 'ups', true)}</span><div><b>${esc(agentByKey(s.profile).name)} · tu agente AIA</b><small class="muted">${esc(prof.label || '')}</small><small class="muted">${s.brief_enabled ? `Resumen cada día a las ${esc(String(s.brief_time || '08:00').slice(0, 5))}` : 'Resumen diario desactivado'}</small></div></div>
      <div class="actions"><button class="btn ghost smallBtn" onclick="go('Inicio')">← Volver al inicio</button>${voiceToggleHtml()}<button class="btn ghost smallBtn" id="agBriefNow">Enviarme el resumen ahora</button><button class="btn ghost smallBtn" onclick="agentSetup(true)">Ajustes</button></div></div>
    <div class="agGrid">
      <div class="card agChat">
        <div class="agChatBar"><small class="muted">CONVERSACIÓN</small>${msgs.length ? `<button type="button" class="btn ghost smallBtn" onclick="agentClearAsk()">🗑 Borrar conversación</button>` : ''}</div>
        <div class="agMsgs" id="agMsgs">${msgs.length ? msgs.map(agentMsgHtml).join('') + greeting : agentMsgHtml({ role: 'assistant', content: `Hola${first ? `, ${first}` : ''}. Soy ${agentByKey(s.profile).name}, tu agente personal. Cuéntame en qué estás trabajando, qué tienes que hacer esta semana o qué te gustaría organizar, y lo iré recordando por ti.` }) + `<div class="agStarters"><small class="muted">PUEDES EMPEZAR POR AQUÍ</small>${(AGENT_STARTERS[s.profile] || AGENT_STARTERS.descubridor).map((t, i) => `<button type="button" class="exampleChip" onclick="agentStarter(${i})">${esc(t)}</button>`).join('')}</div>`}</div>
        <form class="agForm" onsubmit="event.preventDefault();agentSend()">
          <div class="dictationWrap"><textarea id="agInput" rows="2" maxlength="2000" placeholder="Escribe a ${esc(agentByKey(s.profile).name)}…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();agentSend()}"></textarea>
          <button class="dictateBtn" type="button" onclick="toggleDictation('agInput',this)" aria-label="Dictar">🎙 <span>Dictar</span></button></div>
          <button class="btn primary" id="agSend" type="submit">Enviar</button>
        </form>
      </div>
      <div class="card agPanel">
        <div class="agTabs">${AGENT_TABS.map(([k, l]) => `<button class="agTab ${k === agentTab ? 'active' : ''}" onclick="agentTab='${k}';renderAgentPanel()">${l}<span class="agCount">${(agentState.items || []).filter(i => i.status === 'activo' && (k === 'agenda' ? (i.kind === 'agenda' || (i.due_at && i.kind !== 'memoria')) : i.kind === k)).length || ''}</span></button>`).join('')}</div>
        <div id="agItems">${agentItemsHtml()}</div>
        <form class="agAdd" onsubmit="event.preventDefault();agentAdd(this)"><input id="agNew" maxlength="300" placeholder="Añadir a mano…">${agentTab === 'agenda' ? '<input id="agNewDue" type="datetime-local">' : ''}<button class="btn ghost smallBtn" type="submit">Añadir</button></form>
      </div>
    </div>`);
  const box = document.getElementById('agMsgs'); if (box) box.scrollTop = box.scrollHeight;
  document.getElementById('agBriefNow').addEventListener('click', async e => {
    const done = busy(e.currentTarget, 'Enviando…');
    try { const r = await api('agent', { method: 'POST', body: { action: 'brief' } }); toast('Resumen enviado a ' + r.to); }
    catch (err) { info('No se pudo enviar el resumen', err.message); }
    finally { done(); }
  });
  // Al entrar saluda; sigue saludando hasta que el usuario escriba o toque la conversación.
  agentHeroVideo(s.profile, hello ? 'saluda' : null);
  agentResetIdle(false);
  document.getElementById('agInput')?.addEventListener('input', agentResetIdle);
  document.getElementById('agMsgs')?.addEventListener('click', agentResetIdle);
}
// Borrar la conversación: se pide confirmación; pendientes, proyectos, agenda y memoria no se tocan.
function agentClearAsk() {
  const name = agentByKey(agentState?.settings?.profile).name;
  const m = modal('¿Borrar la conversación?', `<p>Se borran los mensajes del chat con ${esc(name)} y empiezas una conversación nueva.</p><p class="muted">Tus pendientes, proyectos, agenda y lo que ${esc(name)} recuerda de ti (pestaña Memoria) no se borran.</p>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Cancelar</button><button class="btn primary" id="agClearOk">Sí, borrar</button>`
  });
  m.querySelector('#agClearOk').addEventListener('click', async e => {
    const done = busy(e.currentTarget, 'Borrando…');
    try {
      await api('agent', { method: 'POST', body: { action: 'clear' } });
      try { stopSpeaking(); } catch {}
      agentState.messages = [];
      closeModals(); renderAgent(); toast('Conversación borrada.');
    } catch (err) { done(); info('No se pudo borrar', err.message); }
  });
}
// Al volver después de unas horas: saludo según la hora y lo que tiene para hoy (no se guarda en el historial).
function agentReturnGreeting(msgs) {
  const last = msgs[msgs.length - 1];
  if (!last?.created_at || Date.now() - new Date(last.created_at).getTime() < 6 * 3600e3) return '';
  const first = (me?.user?.name || '').split(' ')[0];
  const h = Number(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', hour12: false }).format(new Date()));
  const hola = h < 13 ? '¡Buenos días' : h < 20 ? '¡Buenas tardes' : '¡Buenas noches';
  const day = d => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const today = day(Date.now());
  const act = (agentState.items || []).filter(i => i.status === 'activo');
  const hoy = act.filter(i => i.due_at && day(i.due_at) === today);
  const pend = act.filter(i => i.kind === 'pendiente').length;
  let txt = `${hola}${first ? `, ${first}` : ''}!`;
  if (hoy.length) txt += ` Hoy tienes: ${hoy.slice(0, 3).map(i => i.title).join(', ')}${hoy.length > 3 ? ' y más' : ''}.`;
  else if (pend) txt += ` Tienes ${pend} ${pend === 1 ? 'pendiente' : 'pendientes'}. ¿Empezamos por alguno?`;
  else txt += ' ¿Qué tienes para hoy?';
  return agentMsgHtml({ role: 'assistant', content: txt });
}
function renderAgentPanel() { const keep = document.getElementById('agInput')?.value || ''; renderAgent(); const i = document.getElementById('agInput'); if (i) i.value = keep; }
function agentStarter(i) {
  const t = (AGENT_STARTERS[agentState?.settings?.profile] || AGENT_STARTERS.descubridor)[i];
  const input = document.getElementById('agInput'); if (!t || !input) return;
  document.querySelector('.agStarters')?.remove();
  input.value = t; agentSend();
}
async function agentSend() {
  const input = document.getElementById('agInput'), text = input?.value.trim();
  if (!text) return;
  stopSpeaking();
  const box = document.getElementById('agMsgs');
  box.insertAdjacentHTML('beforeend', agentMsgHtml({ role: 'user', content: text }) + '<div class="agMsg bot typing" id="agTyping"><span class="spin"></span> Pensando…</div>');
  box.scrollTop = box.scrollHeight; input.value = '';
  agentHeroPose('ups'); // mientras piensa la respuesta, el agente pone cara de duda
  const done = busy(document.getElementById('agSend'), '…');
  try {
    const r = await api('agent', { method: 'POST', body: { action: 'chat', message: text } });
    agentState.messages = [...(agentState.messages || []), { id: r.userMsgId, role: 'user', content: text }, { id: r.botMsgId, role: 'assistant', content: r.reply }];
    agentState.items = r.items;
    const c = r.changes || {};
    if (r.pendingApprovals) { try { await refreshMe(); } catch {} }
    renderAgent();
    if (voicePrefs().on) { const rows = document.querySelectorAll('#agMsgs .agBotRow'); const last = rows[rows.length - 1]; speak(r.reply, last?.querySelector('.agSay'), false); }
    const n = (c.added || 0) + (c.done || 0) + (c.updated || 0);
    if (n) { toast(`Tu agente actualizó ${n} ${n === 1 ? 'cosa' : 'cosas'} en tus listas.`); agentHeroPose('celebra', 2500); }
    if (r.pendingApprovals) toast('Dejó un correo listo en Aprobaciones para que lo revises.');
  } catch (e) {
    document.getElementById('agTyping')?.remove(); done();
    const i = document.getElementById('agInput'); if (i && !i.value) i.value = text;
    info('Tu agente no pudo responder', e.message);
    agentHeroPose('ups', 2500);
  }
}
async function agentItem(op, id) {
  try { const r = await api('agent', { method: 'POST', body: { action: 'item', op, id } }); agentState.items = r.items; renderAgentPanel(); }
  catch (e) { info('No se pudo cambiar', e.message); }
}
async function agentAdd(form) {
  const title = form.querySelector('#agNew').value.trim();
  if (!title) return;
  const dueRaw = form.querySelector('#agNewDue')?.value || '';
  const kind = agentTab;
  try {
    const r = await api('agent', { method: 'POST', body: { action: 'item', op: 'add', kind, title, due: dueRaw ? dueRaw.replace('T', ' ') : '' } });
    agentState.items = r.items; renderAgentPanel();
  } catch (e) { info('No se pudo añadir', e.message); }
}

// ---------- Cuenta ----------
function accountPage() {
  shell('Cuenta', `<div class="card"><h3>${esc(me.user.name)}</h3><p class="muted">${esc(me.user.email)}${me.user.is_admin ? ' · Administrador de CURO' : ''}</p>
    <p>Tu cuenta de CURO Automate es la misma que la de la plataforma CURO Group.</p>
    ${me.user.is_admin ? `<p class="muted">Motor de IA: ${esc(me.ai.provider === 'anthropic' ? 'Claude (Anthropic)' : 'Groq')} · ${esc(me.ai.model)} ${me.ai.configured ? '' : '· sin configurar'}</p>` : ''}
    <div class="actions"><button class="btn ghost" onclick="logout()">Cerrar sesión</button></div></div>
    <div class="card"><h3>Ayuda y contacto</h3><p class="muted">Para dudas, sugerencias o problemas con tu cuenta, escríbenos a ${contactLink()}.</p></div>`);
}

// ---------- Arranque ----------
// ?ir=aprobaciones (enlace de los avisos por correo) abre directamente Aprobaciones.
// Se recuerda unos segundos porque al entrar con sesión se llama dos veces (arranque y aviso de sesión).
let startCache = null;
function startPage() {
  if (startCache && Date.now() - startCache.t < 5000) return startCache.p;
  const q = new URLSearchParams(location.search).get('ir');
  const ir = q || lrecall('curo_ir');
  if (q) history.replaceState({}, '', location.pathname);
  lstore('curo_ir', null);
  const p = ir === 'aprobaciones' ? 'Aprobaciones' : ir === 'agente' ? 'Mi agente' : 'Inicio';
  startCache = { p, t: Date.now() };
  return p;
}
async function boot() {
  // Sesión que manda curogroup.net en el enlace (#access_token=…&refresh_token=…): se toma explícitamente,
  // porque si al enlace le falta algún dato la librería la descarta sin avisar.
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('access_token') && hp.get('refresh_token')) {
    const had = (await sb.auth.getSession()).data.session;
    if (!had) { try { await sb.auth.setSession({ access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token') }); } catch {} }
    history.replaceState({}, '', location.pathname + location.search);
  }
  const q = new URLSearchParams(location.search);
  const googleResult = q.get('google'), reason = q.get('reason');
  if (googleResult) history.replaceState({}, '', location.pathname);
  // Llega desde curogroup.net sin sesión (?invitado=1): si aquí quedó una sesión vieja, se cierra
  // para que Automate vaya siempre a la par con la plataforma.
  if (q.get('invitado') === '1') {
    history.replaceState({}, '', location.pathname);
    try { await sb.auth.signOut({ scope: 'local' }); } catch {}
  }
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) {
    // Si venía a una sección concreta (por ejemplo ?ir=agente), se recuerda para después de entrar.
    const ir = q.get('ir');
    if (ir) history.replaceState({}, '', location.pathname);
    // El agente personal: sin sesión se presenta a los 9 agentes; al elegir uno se pide entrar.
    if (ir === 'agente' || ir === 'agentes') return agentsLanding();
    if (ir) lstore('curo_ir', ir);
    home();
    const pp = lrecall('curo_pending_preview');
    const box = document.getElementById('publicInstruction');
    if (box && pp?.instruction) box.value = pp.instruction;
    return;
  }
  await go(startPage());
  if (googleResult === 'connected') {
    toast('Gmail conectado correctamente.');
    const pend = recall('curo_pending_plan');
    if (pend) { try { const { plan } = await api('plan', { method: 'POST', body: { instruction: pend.instruction } }); showPlan(pend.instruction, plan); } catch { showPlan(pend.instruction, { ...pend.plan, requirements: { ...pend.plan.requirements, google_connected: true } }); } }
  } else if (googleResult === 'error') info('No se pudo conectar Gmail', reason || 'Google no completó la autorización.');
}
sb.auth.onAuthStateChange((event, s) => {
  const had = !!session; session = s;
  if (event === 'SIGNED_IN' && !had) go(startPage());
  if (event === 'SIGNED_OUT') { me = null; home(); }
  if (event === 'PASSWORD_RECOVERY') newPassword();
});
function newPassword() {
  modal('Nueva contraseña', `<label class="field">Nueva contraseña<input id="np" type="password" minlength="8"></label>`, {
    actions: `<button class="btn primary" onclick="sb.auth.updateUser({password:np.value}).then(({error})=>{closeModals();toast(error?translateAuth(error.message):'Contraseña actualizada.',error?'warn':'ok')})">Guardar</button>`
  });
}
boot();
