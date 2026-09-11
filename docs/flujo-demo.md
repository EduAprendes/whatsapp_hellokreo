# Flujo "DEMO"

Especificado en `docs/plan-agentes-ia-ventas.md` (proyecto `organizacion_asana`),
Fase 2, tarea "Preparar demo funcional propia (flujo 'escribe DEMO')". Resumen:
en vez de depender de llegar al dueño del negocio puerta fría, el propio
WhatsApp de Kreo (Hellokreo) sirve de demo en vivo — el prospecto experimenta
el producto en carne propia.

## Disparador: siempre activo en WhatsApp (2026-09-11)

La idea original era activarlo solo si el texto contenía la palabra clave
"DEMO" (pensado para un canal más general, como un anuncio que invita a
"escribir DEMO"). Pero en WhatsApp Hellokreo, **cualquiera que escribe ya está
interesado en el servicio** — no hace falta el trigger. Por eso el flujo corre
siempre acá, sin condición (`conversationEngine.js` llama a
`generateDemoReply` directo, no hay más un modo `"generic"`).

La detección por palabra clave sí se implementó para Instagram (canal más
general, sin esa señal de intención previa) — ver
[`instagram-integracion.md`](./instagram-integracion.md).

## Guion (implementado en `ai.js` → `buildSystemPrompt()` / `generateDemoReply`)

1. **Presentación corta:** "vendedor digital 24/7", sin jerga técnica (nunca "IA", "bot", "automatización", "entrenamiento").
2. **Calificación:** 2-3 preguntas cortas, una por mensaje — ¿tiene negocio propio?, ¿vende por WhatsApp/Instagram?, ¿siente que pierde clientes fuera de horario o por demoras en responder?
3. **Agendar (si califica):** pide nombre y negocio, consulta disponibilidad **real** en Google Calendar (herramienta `consultar_disponibilidad`) y ofrece horarios reales — nunca inventados. Cuando el cliente confirma uno, crea el evento de verdad (`crear_llamada`). Si no califica, cierra amable sin insistir. Detalle completo en [`google-calendar-integracion.md`](./google-calendar-integracion.md).
4. **Aviso al equipo:** `"stage": "scheduled"` se marca únicamente en el mensaje que sigue justo después de que `crear_llamada` confirmó éxito (no antes, no si el horario estaba ocupado) — ahí `app.js` llama a `notifyTeam()`.

## Cómo está implementado

`generateDemoReply(history)` arma la conversación como `contents` (turnos
`user`/`model`) y se la pasa a Gemini con dos herramientas (`tools`,
function calling nativo) y un `systemInstruction` que incluye la fecha/hora
actual del negocio. Si el modelo pide usar una herramienta, se ejecuta y se
le devuelve el resultado, hasta 6 pasos; el texto final se parsea como JSON
estricto:

```json
{"reply": "...", "stage": "intro" | "qualifying" | "not_qualified" | "scheduled", "lead": {"name": ..., "business": ..., "preferredTime": ...}}
```

**Bug encontrado y arreglado (2026-09-11):** a veces el modelo devuelve
casi-JSON con literales de Python (`None`/`True`/`False` en vez de
`null`/`true`/`false`) — pasó en producción y el fallback de entonces mandó
el JSON roto, tal cual, directo al cliente por Instagram. `parseDemoResponse()`
en `ai.js` ahora intenta en orden: JSON normal → reparar esos literales y
reintentar → extraer solo el campo `"reply"` a mano con regex → mensaje
genérico de disculpa como último recurso. Nunca más debería verse JSON crudo
en el chat de un cliente.

`app.js` envía `reply` por WhatsApp, y si `stage === "scheduled"` (y no se había
notificado antes, `conversation.notified`), llama a `notifyTeam(lead, fromPhone)`.

`notifyTeam()` hace `console.log` y, si `TEAM_NOTIFY_PHONE` está configurado,
manda un WhatsApp a ese número con los datos del lead — el evento del
calendario ya se creó antes, en el paso 3.

## Probado localmente (2026-09-10)

```
"DEMO"                                        → presentación
"tengo negocio, vendo por instagram"          → siguiente pregunta de calificación
"pierdo clientes de noche"                    → sigue calificando
"Me llamo Euro, negocio Kreo Test, mañana 3pm" → lead completo, stage=scheduled
```

Resultado en logs: `Lead calificado y agendado: { fromPhone, name: 'Euro', business: 'Kreo Test', preferredTime: 'mañana a las 3pm' }`.

**Actualizado (2026-09-11):** con la integración de Google Calendar, ese
mismo flujo ahora además consulta disponibilidad real y crea el evento de
verdad — ver la prueba completa en
[`google-calendar-integracion.md`](./google-calendar-integracion.md).

## Limitación conocida

El estado (historial, si ya se notificó) vive en un `Map` en memoria
(`conversations.js`). En Vercel esto se pierde en cada cold start — si el
proceso se reinicia a media conversación, el prospecto podría recibir la
presentación de nuevo en vez de continuar donde iba. Aceptable para el volumen
actual (fase de prueba); si el tráfico crece, pasar el estado a una base de
datos (ej. una tabla `conversations` con `phone`, `mode`, `history_json`,
`notified`).
