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

La detección por palabra clave se guarda para cuando se conecte Instagram
(canal más general, sin esa señal de intención previa) — hoy no está
implementada en este proyecto, solo documentada como idea.

## Guion (implementado en `ai.js` → `DEMO_SYSTEM_PROMPT` / `generateDemoReply`)

1. **Presentación corta:** "vendedor digital 24/7", sin jerga técnica (nunca "IA", "bot", "automatización", "entrenamiento").
2. **Calificación:** 2-3 preguntas cortas, una por mensaje — ¿tiene negocio propio?, ¿vende por WhatsApp/Instagram?, ¿siente que pierde clientes fuera de horario o por demoras en responder?
3. **Agendar (si califica):** pide nombre, nombre del negocio, y un horario. Si no califica, cierra amable sin insistir.
4. **Aviso al equipo:** en cuanto el modelo tiene los 3 datos (nombre + negocio + horario), marca `"stage": "scheduled"` y `app.js` llama a `notifyTeam()`.

## Cómo está implementado

`generateDemoReply(history)` le pasa a Gemini todo el historial de la
conversación y le pide responder en JSON estricto:

```json
{"reply": "...", "stage": "intro" | "qualifying" | "not_qualified" | "scheduled", "lead": {"name": ..., "business": ..., "preferredTime": ...}}
```

`app.js` envía `reply` por WhatsApp, y si `stage === "scheduled"` (y no se había
notificado antes, `conversation.notified`), llama a `notifyTeam(lead, fromPhone)`.

`notifyTeam()` hoy solo hace `console.log` y, si `TEAM_NOTIFY_PHONE` está
configurado, manda un WhatsApp a ese número con los datos del lead. **No crea
todavía un evento real en un calendario** — ver `pendientes-e-ideas.md`.

## Probado localmente (2026-09-10)

```
"DEMO"                                        → presentación
"tengo negocio, vendo por instagram"          → siguiente pregunta de calificación
"pierdo clientes de noche"                    → sigue calificando
"Me llamo Euro, negocio Kreo Test, mañana 3pm" → lead completo, stage=scheduled
```

Resultado en logs: `Lead calificado y agendado: { fromPhone, name: 'Euro', business: 'Kreo Test', preferredTime: 'mañana a las 3pm' }`.

## Limitación conocida

El estado (historial, si ya se notificó) vive en un `Map` en memoria
(`conversations.js`). En Vercel esto se pierde en cada cold start — si el
proceso se reinicia a media conversación, el prospecto podría recibir la
presentación de nuevo en vez de continuar donde iba. Aceptable para el volumen
actual (fase de prueba); si el tráfico crece, pasar el estado a una base de
datos (ej. una tabla `conversations` con `phone`, `mode`, `history_json`,
`notified`).
