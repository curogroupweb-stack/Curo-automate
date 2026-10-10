// Capa de IA intercambiable. Proveedor por variable de entorno:
//   LLM_PROVIDER=groq (por defecto, gratis para pruebas) | anthropic (Claude, recomendado en producción)
//   LLM_MODEL opcional para elegir el modelo.
const { HttpError } = require('./http');

const DEFAULTS = { groq: 'openai/gpt-oss-120b', anthropic: 'claude-sonnet-5-5' };

function provider() {
  const p = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.ANTHROPIC_API_KEY && !process.env.GROQ_API_KEY) return 'anthropic';
  return 'groq';
}

function info() {
  const p = provider();
  const configured = p === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.GROQ_API_KEY;
  return { provider: p, model: process.env.LLM_MODEL || DEFAULTS[p] || '', configured };
}

// messages: [{role:'user'|'assistant'|'tool', content, tool_calls?, tool_call_id?}]
// tools: [{name, description, parameters(JSON Schema)}]
// Devuelve { text, tool_calls:[{id,name,args}], usage:{input,output} }
async function chat({ system, messages, tools = [], maxTokens = 1800, temperature = 0.2 }) {
  const p = provider();
  if (p === 'anthropic') return anthropicChat({ system, messages, tools, maxTokens, temperature });
  return openaiCompatChat({ system, messages, tools, maxTokens, temperature });
}

async function openaiCompatChat({ system, messages, tools, maxTokens, temperature }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new HttpError(500, 'Falta configurar GROQ_API_KEY en Vercel.');
  const body = {
    model: process.env.LLM_MODEL || DEFAULTS.groq,
    temperature, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages.map(m => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
      if (m.role === 'assistant' && m.tool_calls?.length) {
        return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args || {}) } })) };
      }
      return { role: m.role, content: m.content };
    })]
  };
  if (tools.length) {
    body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  const r = await fetchRetry('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new HttpError(502, 'IA (Groq): ' + (j.error?.message || r.status));
  const msg = j.choices?.[0]?.message || {};
  return {
    text: msg.content || '',
    tool_calls: (msg.tool_calls || []).map(t => ({ id: t.id, name: t.function?.name, args: safeParse(t.function?.arguments) })),
    usage: { input: j.usage?.prompt_tokens || 0, output: j.usage?.completion_tokens || 0 }
  };
}

async function anthropicChat({ system, messages, tools, maxTokens, temperature }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(500, 'Falta configurar ANTHROPIC_API_KEY en Vercel.');
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(b => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.tool_calls.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.args || {} }))] });
    } else out.push({ role: m.role, content: m.content });
  }
  const body = { model: process.env.LLM_MODEL || DEFAULTS.anthropic, system, max_tokens: maxTokens, temperature, messages: out };
  if (tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const r = await fetchRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new HttpError(502, 'IA (Claude): ' + (j.error?.message || r.status));
  return {
    text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'),
    tool_calls: (j.content || []).filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} })),
    usage: { input: j.usage?.input_tokens || 0, output: j.usage?.output_tokens || 0 }
  };
}

async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if ((r.status === 429 || r.status >= 500) && i < tries - 1) {
      const wait = Math.min(Number(r.headers.get('retry-after')) * 1000 || 1500 * (i + 1), 8000);
      await new Promise(s => setTimeout(s, wait));
      continue;
    }
    return r;
  }
}

function safeParse(s) { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch { return {}; } }

// Extrae el primer objeto JSON de un texto (los modelos a veces añaden texto alrededor).
function extractJson(text) {
  const s = String(text || '').replace(/```json|```/g, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

module.exports = { chat, info, extractJson };
