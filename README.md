# CURO Automate · V2 conectada

Describe con tus palabras el trabajo que quieres delegar. CURO prepara un plan con IA, lo ejecuta con herramientas reales (Gmail, búsqueda web, lectura de páginas) y te pide aprobación antes de enviar correos.

## Arquitectura
| Capa | Pieza |
|---|---|
| Web | `index.html`, `app.js`, `style.css` (Vercel) |
| Usuarios y datos | Supabase "Curo group Plataforma" — mismo login que CURO; tablas `automate_*` con RLS |
| IA | `api/_lib/llm.js` — `LLM_PROVIDER=groq` (gratis, pruebas) o `anthropic` (Claude, producción) |
| Planificador | `api/_lib/planner.js` — petición → plan JSON (disparador, pasos, herramientas, aprobación) |
| Ejecutor | `api/_lib/executor.js` — bucle de herramientas: `gmail_search`, `gmail_read`, `gmail_send`, `web_search`, `fetch_url` |
| Motor 24/7 | `api/runner/tick.js`, llamado por `pg_cron` de Supabase cada 5 min (clave en Vault) |
| Conexiones | Gmail OAuth por usuario, permisos cifrados (AES-GCM) en `automate_connections` |

## Disparadores
- `manual` · `schedule` (hora de Madrid) · `gmail_new_message` (filtro Gmail, anti-duplicados) · `curo_new_user` (solo administradores; evento creado por trigger en `profiles`).

## Variables de entorno (Vercel, Production)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (= `https://curo-automate.vercel.app/api/auth/google/callback`)
- `SUPABASE_SERVICE_ROLE_KEY` (proyecto Curo group Plataforma)
- `GROQ_API_KEY` y/o `ANTHROPIC_API_KEY`; `LLM_PROVIDER`, `LLM_MODEL` (opcional)
- `RUNNER_SECRET` (igual que el secreto `automate_runner_secret` de Vault), `TOKEN_ENC_KEY` (no cambiar)
- Opcional: `TAVILY_API_KEY` (búsqueda web más fiable), `MAX_AUTOMATIONS_PER_USER`

## Pasar a Claude
Añadir `ANTHROPIC_API_KEY` y cambiar `LLM_PROVIDER=anthropic`. Sin cambios de código.
