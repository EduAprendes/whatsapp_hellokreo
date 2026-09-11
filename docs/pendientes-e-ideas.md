# Pendientes e ideas

## Pendiente — corto plazo

- **`TEAM_NOTIFY_PHONE` sin configurar**: hoy el aviso de lead calificado solo se loguea en Vercel (`vercel logs`). Falta decidir a qué número de WhatsApp avisar.
- **Agendamiento real en Google Calendar**: el flujo DEMO captura `preferredTime` como texto libre, pero no crea un evento. Ya existe un proyecto con credenciales de la API de Google Calendar en `D:\Programacion\conect_spa_test` — revisar ese proyecto para reutilizar la conexión (OAuth/service account, scopes ya autorizados) en vez de configurar una desde cero.
- **Plantilla propia aprobada**: sin ella, Hellokreo solo puede responder dentro de la ventana de 24h que abre el cliente — no puede iniciar una conversación (ej. para recontactar a un lead que no completó el flujo). Crear en WhatsApp Manager → Plantillas de mensajes y esperar aprobación de Meta.
- **Persistencia del estado de conversación**: ver limitación en `flujo-demo.md` — hoy vive en memoria, se pierde en cada cold start de Vercel.

## Responder manualmente desde Chatwoot

Decisión ya tomada (2026-09-11): Opción A (Chatwoot como dueño del canal,
`whatsapp_hellokreo` como su Agent Bot) — código implementado, pasos de
configuración en el panel de Chatwoot documentados en
[`chatwoot-integracion.md`](./chatwoot-integracion.md). Falta que el usuario
complete esos pasos en `chat.hellokreo.com` y pase de vuelta
`CHATWOOT_ACCOUNT_ID` y el `access_token` del bot.
