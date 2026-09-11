# Pendientes e ideas

## Pendiente — corto plazo

- **`TEAM_NOTIFY_PHONE` sin configurar**: hoy el aviso de lead calificado solo se loguea en Vercel (`vercel logs`). Falta decidir a qué número de WhatsApp avisar.
- **Agendamiento real en Google Calendar**: el flujo DEMO captura `preferredTime` como texto libre, pero no crea un evento. Ya existe un proyecto con credenciales de la API de Google Calendar en `D:\Programacion\conect_spa_test` — revisar ese proyecto para reutilizar la conexión (OAuth/service account, scopes ya autorizados) en vez de configurar una desde cero.
- **Plantilla propia aprobada**: sin ella, Hellokreo solo puede responder dentro de la ventana de 24h que abre el cliente — no puede iniciar una conversación (ej. para recontactar a un lead que no completó el flujo). Crear en WhatsApp Manager → Plantillas de mensajes y esperar aprobación de Meta.
- **Persistencia del estado de conversación**: ver limitación en `flujo-demo.md` — hoy vive en memoria, se pierde en cada cold start de Vercel.

## Idea — responder manualmente desde Chatwoot

Objetivo del usuario: poder ver las conversaciones de Hellokreo en un inbox
tipo bandeja de entrada y, cuando quiera, escribir la respuesta él mismo en
vez de dejar que conteste la IA — un "tomar el control humano" puntual.

[Chatwoot](https://www.chatwoot.com/) (open source, autohospedable o cloud) es
la herramienta natural para esto: tiene soporte nativo para canales de
WhatsApp Cloud API y un concepto de **Agent Bot** pensado exactamente para
"la IA responde automático, pero un agente humano puede intervenir en
cualquier momento desde el inbox".

### Opción A — Chatwoot como dueño del canal de WhatsApp (recomendada)

1. Se crea un canal "WhatsApp Cloud API" dentro de Chatwoot, usando las mismas
   credenciales (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_APP_SECRET`) que ya están en `.env` de este proyecto.
2. El **webhook de Meta se reapunta a Chatwoot** (Chatwoot pasa a ser quien
   recibe los mensajes entrantes directamente de Meta, no `whatsapp_hellokreo`).
3. La IA de este proyecto se registra en Chatwoot como **Agent Bot**: Chatwoot
   le reenvía cada mensaje entrante a una URL nuestra (webhook del bot), y
   nuestro código responde llamando a la API de mensajes de Chatwoot (no ya
   directamente a la Graph API de WhatsApp — Chatwoot es quien habla con Meta).
4. Cualquier agente humano puede entrar al inbox de Chatwoot y responder ese
   mismo chat manualmente en cualquier momento; Chatwoot tiene el concepto de
   "handoff" (pausar el bot en una conversación) para que no se pisen las
   respuestas.

**Implica:** este proyecto deja de llamar a `graph.facebook.com` directamente
para enviar mensajes (lo sigue haciendo Chatwoot) — `whatsapp.js` cambiaría
para llamar a la API de Chatwoot en su lugar. El webhook propio
(`app.js` → `/webhook`) dejaría de recibir tráfico de Meta directamente.

### Opción B — Mantener este webhook como dueño, espejar en Chatwoot

1. Este proyecto sigue siendo el único que habla con la Graph API de Meta
   (como hoy).
2. Cada mensaje entrante/saliente se replica hacia Chatwoot vía su API,
   usando un canal tipo "API" (no nativo de WhatsApp) para que aparezca en un
   inbox.
3. Cuando un agente responde manualmente desde Chatwoot, Chatwoot dispara un
   webhook hacia nosotros (`message_created` con `sender.type == "user"`
   proveniente de un agente) y `whatsapp_hellokreo` reenvía ese texto a
   WhatsApp vía `sendWhatsAppText`.

**Trade-off:** más código propio para mantener la sincronización en ambos
sentidos y evitar que la IA responda un mensaje que un humano ya contestó
(similar a lo que ya resuelve `Dashboard_angu` con `humanAlreadyReplied()` en
su integración con GHL — mismo patrón, otro backend).

### Recomendación

Opción A es más simple de mantener a mediano plazo (Chatwoot ya resuelve el
"tomar control humano" de forma nativa, sin tener que reinventarlo). El costo
es mover el punto de integración con Meta de este repo hacia Chatwoot. No se
ha implementado nada de esto todavía — queda como decisión pendiente de
validar cuando se quiera dar ese paso.
