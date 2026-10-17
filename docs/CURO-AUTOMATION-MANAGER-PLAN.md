# CURO Automation Manager — plan paralelo

## Seguridad y alcance
Desarrollo aislado en `feature/automation-manager-paralelo`. No modificar `main`, producción ni credenciales. No se activa ninguna acción externa sin permisos y aprobación.

## Recursos existentes a evaluar y reutilizar
- Capa de IA documentada en `api/_lib/llm.js` (Groq/Anthropic según configuración).
- Supabase y autenticación documentados en el proyecto; validar esquema, RLS y aislamiento antes de ampliar.
- Planificador y ejecutor existentes (`api/_lib/planner.js`, `api/_lib/executor.js`) como base para diseñar y ejecutar pasos permitidos.
- Conectores documentados como Gmail, búsqueda web, lectura de páginas, OAuth y tareas programadas; comprobar credenciales y disponibilidad real antes de presentarlos como conectados.

## Módulos nuevos
1. Centro de recursos y conectores.
2. Bandeja de solicitudes/CRM con canal, consentimiento e historial.
3. Clasificación IA con sector, proceso, problema, objetivo, herramientas, restricciones, confianza y datos faltantes.
4. Cuestionarios adaptativos y versiones.
5. Dossier y diagnóstico con distinción entre datos declarados, inferencias y confirmaciones humanas.
6. Diseñador de automatizaciones con disparadores, pasos, conectores, permisos, aprobación y pruebas.
7. Ejecución auditable con estado, errores, reintentos seguros y métricas.
8. Propuestas, aprobación del cliente y seguimiento.

## Esquema de datos propuesto (no crear hasta revisar el esquema actual)
`manager_organizations`, `manager_contacts`, `manager_intakes`, `manager_classifications`, `manager_questionnaire_templates`, `manager_questionnaire_sessions`, `manager_dossiers`, `manager_automation_specs`, `manager_resource_requirements`, `manager_approvals`, `manager_execution_events`, `manager_outcomes`. Aplicar RLS, tenant/org ownership, auditoría y retención.

## Flujo
Solicitud → identificar contacto/organización → clasificar → pedir aclaraciones si hay baja confianza → cuestionario adaptativo → dossier → diagnóstico → revisión CURO → propuesta → aprobación → prueba controlada → ejecución autorizada → medición/mantenimiento.

## Fases
0. Inventario seguro de rutas, tablas, RLS, variables y conexiones.
1. Interfaz paralela con datos de demo.
2. Intake/CRM.
3. Clasificación IA y cuestionarios adaptativos.
4. Dossier, diagnóstico y requisitos de recursos.
5. Ejecución en sandbox con registros y aprobaciones.
6. Piloto interno de CURO GROUP.
7. Clientes externos tras validar aislamiento, permisos y soporte.

## Requisitos de aceptación
Build y pruebas correctas; ningún cambio a main/producción; secretos solo en entorno servidor; aislamiento validado; acciones externas aprobadas; cada ejecución deja trazabilidad; las funciones no conectadas se identifican claramente como demo.
