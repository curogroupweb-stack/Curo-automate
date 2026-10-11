/* CURO Automate · app web (V2 conectada).
   Portada pública + espacio privado conectado a Supabase (login, datos) y a la API (IA, motor, Gmail). */
const SB_URL = 'https://llugctysxrkqpydyhnvw.supabase.co';
const SB_KEY = 'sb_publishable_RPo3-Vb7rZ9A7R1dXsH11Q_h5iKXT64';
const A = document.getElementById('app');
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
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

let activeRecognition = null;
function toggleDictation(targetId, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return info('Dictado por voz', 'Tu navegador no permite dictar en esta página. Puedes escribir la tarea normalmente.');
  if (activeRecognition) { try { activeRecognition.stop(); } catch {} activeRecognition = null; return; }
  const target = document.getElementById(targetId); if (!target) return;
  const rec = new SR(); activeRecognition = rec; rec.lang = 'es-ES'; rec.continuous = true; rec.interimResults = true;
  let base = target.value.trim();
  const label = btn.querySelector('span');
  rec.onstart = () => { btn.classList.add('listening'); if (label) label.textContent = 'Escuchando…'; };
  rec.onresult = ev => { let fin = '', tmp = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; ev.results[i].isFinal ? fin += t : tmp += t; } if (fin) base = (base ? base + ' ' : '') + fin.trim(); target.value = (base + (tmp ? ' ' + tmp : '')).trim(); };
  rec.onend = () => { activeRecognition = null; btn.classList.remove('listening'); if (label) label.textContent = 'Dictar'; };
  try { rec.start(); } catch { activeRecognition = null; }
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
const NAV = ['Inicio', 'Mi agente', 'Automatizaciones', 'Aprobaciones', 'Historial', 'Conexiones', 'Conocimiento', 'Cuenta'];
function shell(page, body) {
  currentPage = page;
  const pending = me?.counts?.pending_approvals || 0;
  A.innerHTML = `<div class="shell"><aside class="side"><div class="brand"><span class="grad">CURO</span> Automate</div><nav>${NAV.map(n =>
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
  if (!session) return login('login');
  try { await refreshMe(); } catch (e) { return shell(page, `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="go('${page}')">Reintentar</button></div>`); }
  const pages = { Inicio: inicio, 'Mi agente': agentPage, Automatizaciones: automationsPage, Aprobaciones: approvalsPage, Historial: historyPage, Conexiones: connectionsPage, Conocimiento: knowledgePage, Cuenta: accountPage };
  (pages[page] || inicio)();
}
function loading(page, text = 'Cargando…') { shell(page, `<div class="card"><p class="muted"><span class="spin"></span> ${esc(text)}</p></div>`); }

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
  return `<div class="card apCard" id="ap-${ap.id}">
    <div class="row"><div><small class="muted">${esc(ap.automate_automations?.name || 'Automatización')} · ${fmtDate(ap.created_at)}</small><h3>Correo para ${esc(p.to)}</h3></div><span class="badge warn">Pendiente</span></div>
    ${ap.result?.error ? `<div class="notice danger"><b>Último intento falló:</b> ${esc(ap.result.error)}</div>` : ''}
    <label class="field">Para<input data-f="to" value="${esc(p.to)}"></label>
    <label class="field">Asunto<input data-f="subject" value="${esc(p.subject)}"></label>
    <label class="field">Mensaje<textarea data-f="body" rows="9">${esc(p.body)}</textarea></label>
    <div class="actions"><button class="btn ghost" onclick="decide('${ap.id}','reject',this)">Descartar</button><button class="btn primary" onclick="decide('${ap.id}','approve',this)">Aprobar y enviar</button></div>
  </div>`;
}
async function decide(id, decision, btn) {
  const card = document.getElementById('ap-' + id);
  const payload = {}; card.querySelectorAll('[data-f]').forEach(el => payload[el.dataset.f] = el.value);
  const done = busy(btn, decision === 'approve' ? 'Enviando…' : 'Descartando…');
  try {
    await api('approvals', { method: 'POST', body: { id, decision, payload } });
    toast(decision === 'approve' ? `Correo enviado a ${payload.to}.` : 'Correo descartado.');
    await refreshMe(); approvalsPage();
  } catch (e) { done(); info('No se pudo completar', e.message); }
}
async function approvalsHistory() {
  const { approvals } = await api('approvals?status=all');
  const done = approvals.filter(a => a.status !== 'pending');
  modal('Aprobaciones anteriores', done.length ? `<table class="table"><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Estado</th></tr></thead><tbody>${done.map(a => `<tr><td>${fmtDate(a.decided_at || a.created_at)}</td><td>${esc(a.action_payload?.to)}</td><td>${esc(a.action_payload?.subject)}</td><td>${a.status === 'approved' ? '<span class="badge ok">Enviado</span>' : a.status === 'rejected' ? '<span class="badge">Descartado</span>' : '<span class="badge danger">Error</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aún no hay aprobaciones anteriores.</p>', { wide: true });
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
function connectionsPage() {
  const g = me.connections.google;
  shell('Conexiones', `<p class="muted">Las aplicaciones que CURO puede usar en tu nombre. Solo actúa con las que conectes y puedes desconectarlas cuando quieras.</p>
    <div class="connGrid">
      <div class="card conn"><div class="row"><h3>Gmail</h3><span class="badge ${g.connected ? 'ok' : 'warn'}">${g.connected ? 'Conectado' : 'Sin conectar'}</span></div>
        <p class="muted">${g.connected ? `Cuenta: <b>${esc(g.email)}</b>. CURO puede leer tu bandeja y enviar correos (siempre con tu aprobación si así lo eliges).` : 'Permite a CURO leer correos y enviar respuestas desde tu cuenta.'}</p>
        <div class="actions">${g.connected ? `<button class="btn ghost" onclick="connectGoogle()">Cambiar de cuenta</button><button class="btn ghost danger" onclick="disconnectGoogle(this)">Desconectar</button>` : `<button class="btn primary" onclick="connectGoogle()">Conectar Gmail</button>`}</div></div>
      <div class="card conn"><div class="row"><h3>Internet</h3><span class="badge ok">Disponible</span></div><p class="muted">Buscar información y leer páginas web públicas. No necesita conexión.</p></div>
      ${['Outlook', 'Google Drive y Sheets', 'Google Calendar', 'WhatsApp Business'].map(n => `<div class="card conn soon"><div class="row"><h3>${n}</h3><span class="badge">Próximamente</span></div><p class="muted">Estamos preparando esta conexión.</p></div>`).join('')}
    </div>`);
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
  { key: 'descubridor', name: 'Mochi', animal: '', label: 'Descubridor/a', vibe: 'Tierno y curioso', help: 'Para quien busca de todo un poco: guarda lo que te interesa, lo que quieres aprender, comprar o visitar.', ex: ['Lista de cosas que quieres aprender', 'Guarda ideas, viajes y compras pensadas'] }
];
const agentImg = k => `img/agentes/${k}.jpg`;
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
  A.innerHTML = `<header class="top"><a class="brand brandLink" href="https://curogroup.net/" title="Volver a CURO Group"><span class="grad">CURO</span> Automate</a><div class="topnav"><a class="backCuro" href="https://curogroup.net/">← CURO Group</a><button class="btn ghost" onclick="home()">Otras formas</button></div></header>
  <main class="agLanding">
    <section class="agHero">
      <span class="pill">TU AGENTE IA PERSONAL · AGENTES AIA</span>
      <h1>Un compañero que te conoce y <span class="grad">no empieza de cero</span> cada vez</h1>
      <p>Elige el agente que más se parece a ti. Recordará lo que le cuentes, llevará tus pendientes, proyectos y agenda, y cada mañana te dirá qué tienes por delante.</p>
      <div class="agHeroRow">${AGENTS.map(a => `<button type="button" class="agHeroPick" onclick="showAgentCard('${a.key}')" aria-label="Ver a ${esc(a.name)}"><img src="${agentImg(a.key)}" alt=""><span>${esc(a.name)}</span></button>`).join('')}</div>
      <a class="btn primary" href="#elige">Conocer a los agentes</a>
    </section>
    <section class="section" id="elige">
      <div class="sectionIntro"><span class="eyebrow">LOS 9 AGENTES AIA</span><h2>¿Quién quieres que te acompañe?</h2><p class="muted">Todos hacen lo mismo por dentro. Cambia lo que saben de tu trabajo, cómo te hablan y qué te proponen.</p></div>
      <div class="agCards">${AGENTS.map(a => `
        <article class="agCard" id="agente-${a.key}">
          <div class="agCardPic"><img src="${agentImg(a.key)}" alt="${esc(a.name)}, ${esc(a.animal || 'agente AIA')}" loading="lazy"></div>
          <div class="agCardBody">
            <span class="agCardFor">${esc(a.label)}</span>
            <h3>${esc(a.name)} <small>${esc(a.vibe)}</small></h3>
            <p>${esc(a.help)}</p>
            <ul>${a.ex.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            <button class="btn primary" onclick="pickAgent('${a.key}')">Elegir a ${esc(a.name)}</button>
          </div>
        </article>`).join('')}</div>
    </section>
    <section class="section softSection">
      <div class="sectionIntro"><span class="eyebrow">CÓMO FUNCIONA</span><h2>Así de sencillo</h2></div>
      <div class="steps agSteps">${[['1', 'Elige tu agente', 'Según lo que haces: docente, autónomo, estudiante…'], ['2', 'Cuéntale de ti', 'Qué haces y en qué quieres que te ayude. Puedes cambiarlo cuando quieras.'], ['3', 'Habla con él cada día', 'Le cuentas tus cosas y él las ordena en listas.'], ['4', 'Recibe tu resumen', 'Cada mañana, un correo con tu agenda, tus pendientes y el siguiente paso.']].map(x => `<div class="card step"><span class="stepNum">${x[0]}</span><h3>${x[1]}</h3><p class="muted">${x[2]}</p></div>`).join('')}</div>
    </section>
    <section class="section">
      <div class="sectionIntro"><span class="eyebrow">LO QUE LLEVA POR TI</span><h2>Todo en su sitio</h2></div>
      <div class="grid agKeeps">${[['Pendientes', 'Lo que tienes que hacer, y lo marca como hecho cuando le dices que ya está.'], ['Proyectos', 'Tus proyectos por etapas, con el siguiente paso siempre claro.'], ['Agenda', 'Citas, entregas y fechas importantes, para que no se te pasen.'], ['Lo que recuerdo', 'Lo que le contaste de ti y de tu trabajo, para no tener que repetirlo.']].map(x => `<div class="card"><h3>${x[0]}</h3><p class="muted">${x[1]}</p></div>`).join('')}</div>
      <p class="muted small agPrivacy">No le cuentes contraseñas, datos bancarios ni de salud. Puedes borrar cualquier cosa que recuerde cuando quieras.</p>
    </section>
    <section class="section"><div class="planCard"><div><span class="pill">GRATIS DURANTE LA FASE DE PRUEBA</span><h2>Crea tu agente hoy</h2><p>Solo necesitas tu cuenta de CURO Group. Si no la tienes, la creas gratis en un minuto.</p></div><a class="btn primary" href="#elige">Elegir mi agente</a></div></section>
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
  modal(`¡Genial! Elegiste a ${esc(a.name)}`, `<div class="agPickModal"><img src="${agentImg(a.key)}" alt="${esc(a.name)}"><div class="agBubble"><b>¡Hola! Soy ${esc(a.name)}.</b><p>Para poder recordar lo que me cuentes, necesito que entres con tu cuenta de CURO. Si todavía no tienes, la creas gratis en un minuto y vuelves aquí conmigo.</p></div></div>`, {
    actions: `<button class="btn ghost" onclick="closeModals()">Seguir mirando</button><button class="btn primary" onclick="lstore('curo_ir','agente');closeModals();login('signup')">Entrar o crear mi cuenta</button>`
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
async function agentPage() {
  loading('Mi agente', 'Abriendo tu agente…');
  try { agentState = await api('agent'); }
  catch (e) { return shell('Mi agente', `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="go('Mi agente')">Reintentar</button></div>`); }
  // Si eligió un agente en la presentación, se abre la elección con ese agente marcado (también si ya tenía uno).
  const pick = lrecall('curo_agent_pick');
  agentState.settings && !pick ? renderAgent() : agentSetup(!!agentState.settings);
}
function agentSetup(edit = false) {
  const s = { ...(agentState.settings || {}) };
  const pick = takeAgentPick(); if (pick) s.profile = pick;
  const chosen = s.profile ? agentByKey(s.profile) : null;
  const time = String(s.brief_time || '08:00').slice(0, 5);
  const first = (me?.user?.name || '').split(' ')[0];
  const grid = `<div class="profileGrid">${AGENTS.map(a => `<button type="button" class="profileCard ${s.profile === a.key ? 'sel' : ''}" data-p="${a.key}" aria-pressed="${s.profile === a.key}" onclick="selectSetupAgent('${a.key}')"><img class="profilePic" src="${agentImg(a.key)}" alt=""><b>${esc(a.name)}</b><small class="profileFor">${esc(a.label)}</small><small>${esc(a.help)}</small></button>`).join('')}</div>`;
  shell('Mi agente', `<div class="card agentSetup">
    <div class="agWelcome" id="agWelcome">${setupWelcome(chosen, first, edit)}</div>
    ${chosen ? `<details class="agOther" ${edit ? '' : ''}><summary>¿Prefieres otro agente? Elige aquí</summary>${grid}</details>` : `<small class="muted">1. ELIGE A TU AGENTE</small>${grid}`}
    <label class="field"><span class="agQ">¿A qué te dedicas?</span> <span class="muted">(opcional)</span><textarea id="agAbout" rows="3" maxlength="2000" placeholder="Por ejemplo: soy profesora de primaria en Madrid y doy clases de inglés por las tardes.">${esc(s.about || '')}</textarea></label>
    <label class="field"><span class="agQ">¿En qué quieres que te ayude?</span> <span class="muted">(opcional)</span><textarea id="agGoals" rows="3" maxlength="2000" placeholder="Por ejemplo: organizar mis clases de la semana, no olvidarme de las entregas y preparar materiales.">${esc(s.goals || '')}</textarea></label>
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
    if (!profile) return toast('Elige primero a tu agente.', 'warn');
    const done = busy(e.currentTarget, 'Guardando…');
    try {
      const { settings } = await api('agent', { method: 'POST', body: { action: 'setup', profile, about: agAbout.value.trim(), goals: agGoals.value.trim(), brief_enabled: agBrief.checked, brief_time: agTime.value || '08:00' } });
      agentState.settings = settings;
      toast(edit ? 'Cambios guardados.' : `¡${agentByKey(profile).name} ya está listo!`);
      renderAgent();
    } catch (err) { done(); info('No se pudo guardar', err.message); }
  });
}
function setupWelcome(a, first, edit) {
  if (!a) return `<span class="pill">CREA TU AGENTE IA PERSONAL</span><h2>Un asistente que te conoce y recuerda lo importante</h2><p class="muted">Elige el agente que más se parece a ti. Recordará lo que le cuentes, llevará tus pendientes, proyectos y agenda, y cada mañana te dirá qué tienes por delante.</p>`;
  return `<img class="agWelcomePic" src="${agentImg(a.key)}" alt="${esc(a.name)}"><div class="agBubble"><b>${edit ? `Aquí puedes cambiar cómo te ayudo${first ? `, ${esc(first)}` : ''}.` : `¡Hola${first ? `, ${esc(first)}` : ''}! Soy ${esc(a.name)}.`}</b><p>${edit ? 'Cuéntame si algo cambió en tu trabajo o en lo que necesitas.' : `Voy a ser tu agente personal${a.label ? ` (${esc(a.label.toLowerCase())})` : ''}. Cuéntame un poco de ti para ayudarte mejor: con tres respuestas ya podemos empezar.`}</p></div>`;
}
function selectSetupAgent(key) {
  document.querySelectorAll('.profileCard').forEach(b => { const on = b.dataset.p === key; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
  const w = document.getElementById('agWelcome'); const first = (me?.user?.name || '').split(' ')[0];
  if (w && w.querySelector('.agBubble')) w.innerHTML = setupWelcome(agentByKey(key), first, false);
  const btn = document.getElementById('agSave'); if (btn && !/Guardar/.test(btn.textContent)) btn.textContent = `Empezar con ${agentByKey(key).name}`;
}
function agentMsgHtml(m) {
  const txt = `<div class="agMsg ${m.role === 'user' ? 'me' : 'bot'}">${esc(m.content).replace(/\n/g, '<br>')}</div>`;
  return m.role === 'user' ? txt : `<div class="agBotRow"><img class="agAvatar" src="${agentImg(agentState?.settings?.profile || 'descubridor')}" alt="">${txt}</div>`;
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
function renderAgent() {
  const s = agentState.settings, prof = agentState.profiles.find(p => p.key === s.profile) || {};
  const msgs = agentState.messages || [];
  const first = (me?.user?.name || '').split(' ')[0];
  shell('Mi agente', `
    <div class="agHead card"><div class="agWho"><img class="agAvatar big" src="${agentImg(s.profile)}" alt=""><div><b>${esc(agentByKey(s.profile).name)} · tu agente AIA</b><small class="muted">${esc(prof.label || '')}</small><small class="muted">${s.brief_enabled ? `Resumen cada día a las ${esc(String(s.brief_time || '08:00').slice(0, 5))}` : 'Resumen diario desactivado'}</small></div></div>
      <div class="actions"><button class="btn ghost smallBtn" id="agBriefNow">Enviarme el resumen ahora</button><button class="btn ghost smallBtn" onclick="agentSetup(true)">Ajustes</button></div></div>
    <div class="agGrid">
      <div class="card agChat">
        <div class="agMsgs" id="agMsgs">${msgs.length ? msgs.map(agentMsgHtml).join('') : agentMsgHtml({ role: 'assistant', content: `Hola${first ? `, ${first}` : ''}. Soy ${agentByKey(s.profile).name}, tu agente personal. Cuéntame en qué estás trabajando, qué tienes que hacer esta semana o qué te gustaría organizar, y lo iré recordando por ti.` }) + `<div class="agStarters"><small class="muted">PUEDES EMPEZAR POR AQUÍ</small>${(AGENT_STARTERS[s.profile] || AGENT_STARTERS.descubridor).map((t, i) => `<button type="button" class="exampleChip" onclick="agentStarter(${i})">${esc(t)}</button>`).join('')}</div>`}</div>
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
  const box = document.getElementById('agMsgs');
  box.insertAdjacentHTML('beforeend', agentMsgHtml({ role: 'user', content: text }) + '<div class="agMsg bot typing" id="agTyping"><span class="spin"></span> Pensando…</div>');
  box.scrollTop = box.scrollHeight; input.value = '';
  const done = busy(document.getElementById('agSend'), '…');
  try {
    const r = await api('agent', { method: 'POST', body: { action: 'chat', message: text } });
    agentState.messages = [...(agentState.messages || []), { role: 'user', content: text }, { role: 'assistant', content: r.reply }];
    agentState.items = r.items;
    const c = r.changes || {};
    renderAgent();
    const n = (c.added || 0) + (c.done || 0) + (c.updated || 0);
    if (n) toast(`Tu agente actualizó ${n} ${n === 1 ? 'cosa' : 'cosas'} en tus listas.`);
  } catch (e) {
    document.getElementById('agTyping')?.remove(); done();
    const i = document.getElementById('agInput'); if (i && !i.value) i.value = text;
    info('Tu agente no pudo responder', e.message);
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
