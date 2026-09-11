# whatsapp_hellokreo

Proyecto para conectar la IA (vendedor 24/7) al número real de WhatsApp
"Hellokreo" vía WhatsApp Cloud API (Meta), siguiendo
[[200-🌍AREAS/Kreo/WhatsApp 1/Guía desde cero — Configurar WhatsApp Cloud API]].

Documentación completa (setup de Meta, arquitectura, flujo DEMO, pendientes e
ideas como responder manual desde Chatwoot): ver [`docs/`](./docs/README.md).

## Setup

```bash
npm install
cp .env.example .env
# completar .env con las credenciales de producción
npm run dev
```

## Estado

- [x] Número de producción registrado y verificado (envío/recepción probados por curl)
- [x] Token permanente del Usuario del sistema cargado en `.env`
- [x] App Secret cargado en `.env`
- [x] Validación de `X-Hub-Signature-256` implementada en el webhook
- [x] Webhook desplegado en Vercel y suscrito en Meta (campo `messages`)
- [x] Lógica de IA (Gemini 2.5 Flash) conectada a los mensajes entrantes
- [x] Flujo "escribe DEMO" (docs/plan-agentes-ia-ventas.md, Fase 2): presentación, calificación (2-3 preguntas), captura de lead (nombre/negocio/horario) y aviso al equipo — probado localmente end-to-end
- [ ] Plantilla propia aprobada (necesaria para iniciar conversación sin que el cliente escriba primero)
- [x] Agendamiento real en Google Calendar: la IA consulta disponibilidad real y crea el evento vía tool-calling de Gemini — ver [`docs/google-calendar-integracion.md`](./docs/google-calendar-integracion.md)
- [ ] Notificación al equipo por WhatsApp: falta configurar `TEAM_NOTIFY_PHONE` en el `.env` de Vercel (hoy solo se loguea)
- [ ] El estado de la conversación vive en memoria (`conversations.js`) — se pierde en cada cold start de Vercel; pasar a una base de datos si el volumen lo justifica
- [x] Integración con Chatwoot (`/chatwoot-bot`) para responder manual desde el inbox: Chatwoot ya es dueño del canal (inbox "WhatsApp Hellokreo" en `chat.hellokreo.com`), Agent Bot creado y probado end-to-end en producción — ver [`docs/chatwoot-integracion.md`](./docs/chatwoot-integracion.md)
- [x] Fix de timeout del webhook de Chatwoot: `keep_pending_on_bot_failure` activado + procesamiento síncrono (se probó `waitUntil` para responder rápido, pero perdía respuestas en silencio — revertido) — ver [`docs/incidente-timeout-webhook.md`](./docs/incidente-timeout-webhook.md)
- [x] Instagram con trigger "DEMO" vía Chatwoot (cuenta reutilizada de `conect_spa_test`): probado en producción — ver [`docs/instagram-integracion.md`](./docs/instagram-integracion.md)
