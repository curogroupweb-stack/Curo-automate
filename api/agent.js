// Agente IA personal.
// GET  -> { profiles, settings, items, messages }
// POST { action:'setup', profile, about, goals, tone, brief_enabled, brief_time }
// POST { action:'chat', message }
// POST { action:'item', op:'add'|'done'|'undo'|'delete', ... }
// POST { action:'brief' }  -> envía ahora el resumen al correo de la cuenta
const { handler, json, readBody, requireUser, HttpError } = require('./_lib/http');
const { isAdmin } = require('./_lib/account');
const agent = require('./_lib/agent');

const publicProfiles = () => Object.entries(agent.PROFILES).map(([key, p]) => ({ key, name: p.name, label: p.label, focus: p.focus }));

module.exports = handler(async (req, res) => {
  const user = await requireUser(req);
  if (req.method === 'GET') {
    const st = await agent.loadState(user.id);
    return json(res, 200, { profiles: publicProfiles(), settings: st.settings, items: st.items, messages: st.messages });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const b = await readBody(req);
  switch (b.action) {
    case 'setup': return json(res, 200, { settings: await agent.saveSettings(user.id, b) });
    case 'chat': {
      const out = await agent.chatTurn(user, b.message, { isAdmin: await isAdmin(user.id) });
      const st = await agent.loadState(user.id);
      return json(res, 200, { ...out, items: st.items });
    }
    case 'item': {
      await agent.itemOp(user.id, b);
      const st = await agent.loadState(user.id);
      return json(res, 200, { items: st.items });
    }
    case 'brief': {
      const r = await agent.sendBrief(user.id);
      return json(res, 200, { ok: true, to: r.to });
    }
    default: throw new HttpError(400, 'Acción no válida.');
  }
});
