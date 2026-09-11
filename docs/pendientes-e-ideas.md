# Pendientes e ideas

## Pendiente — corto plazo

- **`TEAM_NOTIFY_PHONE` sin configurar**: hoy el aviso de lead calificado solo se loguea en Vercel (`vercel logs`). Falta decidir a qué número de WhatsApp avisar.
- ~~**Agendamiento real en Google Calendar**~~ — **hecho (2026-09-11)**, ver [`google-calendar-integracion.md`](./google-calendar-integracion.md). Queda pendiente probar el caso de horario ocupado con un mensaje real.
- **Plantilla propia aprobada**: sin ella, Hellokreo solo puede responder dentro de la ventana de 24h que abre el cliente — no puede iniciar una conversación (ej. para recontactar a un lead que no completó el flujo). Crear en WhatsApp Manager → Plantillas de mensajes y esperar aprobación de Meta.
- **Persistencia del estado de conversación**: ver limitación en `flujo-demo.md` — hoy vive en memoria, se pierde en cada cold start de Vercel.
- **Dominio propio**: el proyecto corre en `whatsapp-hellokreo.vercel.app` (incluida la página `/privacy`). Asignarle un dominio propio de Kreo más adelante.
- **Notificaciones push de conversaciones nuevas sin asignar**: Chatwoot no notifica (ni push, ni ningún tipo) sobre conversaciones que nacen en estado "pending" — que es el caso normal en un inbox con Agent Bot activo (`app/listeners/notification_listener.rb`, `return if conversation.pending?`). Es diseño intencional de Chatwoot, no un bug. Solución identificada, sin implementar: crear una regla de automatización en Chatwoot (Settings → Automation) — "Cuando se crea una conversación" en el inbox de WhatsApp/Instagram Hellokreo → asignarla a un agente. Eso no cambia el estado "pending" (el bot sigue respondiendo normal) pero sí activa las notificaciones de "assigned_conversation_new_message" en cada mensaje nuevo.

## Responder manualmente desde Chatwoot

**Hecho (2026-09-11).** Chatwoot es el dueño del canal, `whatsapp_hellokreo`
es su Agent Bot, probado end-to-end en producción. Detalle completo,
incluyendo qué falta pulir (probar el handoff en vivo, el flujo DEMO sobre
este camino), en [`chatwoot-integracion.md`](./chatwoot-integracion.md).
