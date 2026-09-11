# Incidente: el bot se apagaba solo (timeout del webhook, 2026-09-11)

## Síntoma

En la conversación #95 (WhatsApp Hellokreo) apareció este mensaje de
actividad, generado por el propio Chatwoot, sin que nadie tocara nada a
mano:

> Conversation was marked open by system due to an error with the agent bot.

Después de eso, la IA dejó de responder — el cliente escribió varios
mensajes más ("estas?", "te llegan los whatsap", "?") y ninguno recibió
respuesta, ni de la IA (desactivada) ni de un humano (nadie había vuelto a
mirar el chat).

## Causa raíz (confirmada leyendo el código fuente de Chatwoot en el contenedor)

Chatwoot le da a `outgoing_url` del Agent Bot (nuestro `/chatwoot-bot`) un
**timeout de 5 segundos por defecto** (`Webhooks::Trigger#webhook_timeout`,
`open_timeout`/`read_timeout` en la llamada HTTP). Si no responde a tiempo,
o responde con un error no reintentable:

```ruby
# app/lib/webhooks/trigger.rb (chatwoot/chatwoot)
def update_conversation_status(message)
  conversation = message.conversation
  return unless conversation&.pending?
  return if conversation&.account&.keep_pending_on_bot_failure

  conversation.open!
  create_agent_bot_error_activity(conversation)
end
```

Es decir: **si la conversación está en "pending" y el webhook del bot falla
(timeout u otro error), Chatwoot la pasa a "open" y apaga el bot ahí**, sin
más rastro que ese mensaje de actividad — no llega ningún error a
`vercel logs` porque, desde el punto de vista de nuestro servidor, la
petición ni siquiera llegó a completarse a tiempo.

Solo reintenta automáticamente (3 veces, esperando 3s) para HTTP 429/500
(`RETRYABLE_AGENT_BOT_STATUSES`). Un timeout de conexión no cae en esa
categoría — va directo a `handle_failure` la primera vez.

### Por qué nuestro endpoint podía tardar más de 5s

`app.js` → `POST /chatwoot-bot` hacía **todo el trabajo antes de responder**:

```
Chatwoot → nuestro webhook → [Gemini (generar respuesta)] → [Chatwoot API (enviar el mensaje)] → recién ahí 200 OK
```

Dos llamadas HTTP externas en serie, más el cold start de la función en
Vercel — perfectamente capaz de superar 5 segundos en un mal momento (no
hacía falta que fallara siempre; bastaba una vez para que esa conversación
específica quedara con el bot apagado para siempre, ver
`uso-chatwoot.md` → "no hay reversión automática").

## Fix aplicado

### 1. Responder rápido, procesar en segundo plano (`app.js`, `whatsapp_hellokreo`)

```js
app.post("/chatwoot-bot", (req, res) => {
  if (CHATWOOT_BOT_SHARED_SECRET && req.query.secret !== CHATWOOT_BOT_SHARED_SECRET) {
    return res.sendStatus(401);
  }

  const { event, message_type: messageType, content, conversation } = req.body || {};
  res.sendStatus(200); // ya, sin esperar nada mas

  if (event === "message_created" && messageType === "incoming" && content && conversation?.status === "pending") {
    waitUntil(handleChatwootMessage(conversation, content)); // Gemini + enviar, en segundo plano
  }
});
```

`waitUntil` viene de `@vercel/functions` — es el mecanismo oficial de Vercel
(Fluid Compute) para seguir ejecutando trabajo después de responder, sin que
la función se congele apenas se envía la respuesta. Medido en local: **63ms**
para responder, muy por debajo del límite de 5s de Chatwoot. Mismo patrón
aplicado también a `/webhook` (el camino directo con Meta, hoy en desuso) por
consistencia.

### 2. Red de seguridad en Chatwoot: `keep_pending_on_bot_failure`

Por si algún día sí vuelve a fallar (Gemini caído, Chatwoot lento, lo que
sea), se activó este ajuste de cuenta para que un fallo del webhook **no**
apague el bot automáticamente — simplemente ese turno no se responde, pero
la conversación sigue en "pending" para el siguiente mensaje:

```ruby
account = Account.find(1)
account.update!(settings: account.settings.merge("keep_pending_on_bot_failure" => true))
```

Aplicado en producción el 2026-09-11 (`chat.hellokreo.com`, cuenta 1).

### 3. Recuperación de la conversación afectada

La conversación #95 se regresó a mano a "pending" con el bot reasignado:

```ruby
convo = Conversation.find(95)
convo.update!(status: :pending, assignee_agent_bot: AgentBot.find_by(name: "Kreo AI"))
```

Los mensajes que quedaron sin responder mientras estuvo "open" **no se
contestaron retroactivamente** — la IA solo reacciona a mensajes nuevos.

## Verificado

- Tiempo de respuesta de `/chatwoot-bot` en local: `63ms` (antes: bloqueante,
  dependía de Gemini + Chatwoot API, sin cota superior clara).
- Deploy en Vercel confirmado (`vercel deploy --prod`), `/health` responde
  `{"ok":true}`.
- Pendiente: confirmar con un mensaje real que la cadena completa
  (Meta → Chatwoot → `/chatwoot-bot` → Gemini → Chatwoot → WhatsApp) sigue
  funcionando después del cambio — no hay motivo para que no, pero no se
  volvió a probar end-to-end tras este fix específico.

## Lección para futuros webhooks de Agent Bot / integraciones similares

Cualquier endpoint que reciba un webhook con un timeout ajeno (Meta, Chatwoot,
o cualquier proveedor) debe **responder primero, procesar después** si el
trabajo real involucra llamadas a APIs externas (LLM, envío de mensajes,
etc.). No asumir que "total, es rápido" — un cold start más una API externa
lenta un solo día alcanza para gatillar el problema, y en el caso de
Chatwoot el efecto es silencioso y permanente hasta que alguien lo note.
