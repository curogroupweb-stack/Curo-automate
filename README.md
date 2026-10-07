# CURO Automate · MASTER V2 · Navegación y persistencia RC

Base: MASTER V2 Resultado Completo.

Correcciones aisladas:
- Backup físico completo antes de editar.
- Ver ideas funciona independientemente del límite del plan.
- El usuario puede describir, preparar y probar una automatización aunque esté en 2/2.
- El límite se aplica únicamente al intentar guardar/activar una nueva automatización.
- Automatizaciones permanece accesible en 2/2 y muestra las automatizaciones existentes.
- La comprobación de draft_id ocurre antes del límite para no duplicar un borrador recuperado.
- Se conserva la misma clave localStorage (curoAutomateV02), por lo que no se resetean los datos existentes del navegador.
- Gmail/API y motor de Execution/Resultado/Historial se conservan sin cambios.


## FIX 05 — Historial y ejecuciones
- Historial general robustecido para datos guardados de versiones anteriores.
- Botón Ver resultado por ejecución.
- Botón Volver a ejecutar sin duplicar la automatización.
- Acceso al historial específico de cada automatización.
- Cache bust actualizado a history05.

## V12 · Resolver + Conexiones
- Añade catálogo de capacidades/conectores y pantalla Conexiones.
- El Resolver infiere Drive/Contactos/Gmail para una petición sencilla de bienvenida a familias, aunque el usuario no mencione tecnología.
- OAuth Google solicita Gmail + Drive readonly; Drive expone estado y exploración de carpetas mediante API.
- Calendar, Sheets, WhatsApp Business y Mailchimp aparecen como hoja de ruta, no se simulan como conectados.
- Para Drive real, Google Drive API debe estar habilitada en el proyecto Google Cloud y el usuario debe volver a autorizar Google.


## V14 UX
- Se elimina “Probar gratis” del encabezado público.
- Dictado por voz en los campos principales de automatización (SpeechRecognition del navegador).
- Planner/modal adaptable con scroll interno y acciones siempre visibles.
- Aviso local de conexión integrado en el Planner para evitar doble modal.


## V15 · Semantic Welcome + Web Ready
- El Planner reconoce altas/registros de nuevos usuarios como trigger específico.
- Construye el flujo: alta → datos del usuario → anti-duplicado → plantilla → Gmail → registro.
- La fuente de usuarios CURO se muestra como fuente interna, no como aplicación externa a configurar.
- Gmail sigue requiriendo ejecución web real para OAuth; no se simula conexión desde file://.

- V16: OAuth web conserva y recupera el borrador del Planner al volver de Google; valida configuración OAuth del servidor antes de redirigir.
