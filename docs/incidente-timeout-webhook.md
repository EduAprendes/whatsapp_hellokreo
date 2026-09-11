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

### 1. Red de seguridad en Chatwoot: `keep_pending_on_bot_failure`

Por si algún día vuelve a tardar (Gemini caído, Chatwoot lento, lo que sea),
se activó este ajuste de cuenta para que un fallo del webhook **no** apague
el bot automáticamente — simplemente ese turno no se responde, pero la
conversación sigue en "pending" para el siguiente mensaje:

```ruby
account = Account.find(1)
account.update!(settings: account.settings.merge("keep_pending_on_bot_failure" => true))
```

Aplicado en producción el 2026-09-11 (`chat.hellokreo.com`, cuenta 1). Este
fue el cambio que terminó importando de verdad — ver el intento fallido
abajo.

### 2. Recuperación de la conversación afectada

La conversación #95 se regresó a mano a "pending" con el bot reasignado:

```ruby
convo = Conversation.find(95)
convo.update!(status: :pending, assignee_agent_bot: AgentBot.find_by(name: "Kreo AI"))
```

Los mensajes que quedaron sin responder mientras estuvo "open" **no se
contestaron retroactivamente** — la IA solo reacciona a mensajes nuevos.

### 3. Intento fallido: responder rápido + `waitUntil` (revertido el mismo día)

Primer intento: responder 200 de inmediato y mover el trabajo real (Gemini +
enviar la respuesta) a segundo plano con `waitUntil` de `@vercel/functions`
— el mecanismo oficial de Vercel para seguir ejecutando código después de
responder, sin que Fluid Compute congele la función. Medido en local: 63ms
para responder, muy por debajo del límite de 5s.

**No fue confiable en producción.** Probado en Instagram (conversación #99):
el primer mensaje ("Demo") recibió respuesta bien, pero el segundo
("Quisiera más información por favor") **se perdió en silencio** — ni
respuesta en Instagram, ni error en `vercel logs`, ni excepción de ningún
tipo. La función simplemente no terminó su trabajo en segundo plano esa vez.

Sospecha (no confirmada a fondo): esta app usa el soporte nativo de Vercel
para "backend frameworks" (Express corriendo como servidor persistente, ver
`arquitectura.md`), no el modelo de función por request de Next.js App
Router — los ejemplos oficiales de `waitUntil` son todos con ese segundo
modelo. Es posible que el contexto que `waitUntil` necesita (vía
`AsyncLocalStorage`) no quede establecido de forma confiable en este tipo de
despliegue.

**Se revirtió a responder sincrónico** (esperar a que termine todo antes de
responder a Chatwoot) — más lento (puede pasarse de los 5s en un cold start),
pero ahora inofensivo gracias al punto 1: si Chatwoot corta la conexión por
timeout, nuestra función igual termina de correr y de mandar la respuesta por
la API de Chatwoot (el timeout es del lado del que llama, no mata nuestro
proceso) — solo se pierde el "ok" que Chatwoot esperaba, no la respuesta real
al cliente. Peor caso real: una respuesta puntual tarda un poco más o
Chatwoot loguea un webhook fallido sin consecuencia, en vez de perder
respuestas al azar como pasaba con `waitUntil`.

## Verificado

- `waitUntil` (revertido): confirmado que falla de forma silenciosa e
  intermitente en producción — no usar este patrón en este proyecto sin
  investigar más a fondo por qué.
- Patrón síncrono (actual): probado end-to-end en Instagram después del
  revert — pendiente confirmar que no se pierde ninguna respuesta en una
  sesión de varios mensajes seguidos.

## Lección para futuros webhooks de Agent Bot / integraciones similares

- Cualquier endpoint que reciba un webhook con un timeout ajeno (Meta,
  Chatwoot, o cualquier proveedor) idealmente responde rápido y procesa
  después — pero **no asumir que `waitUntil` de `@vercel/functions` funciona
  out-of-the-box en cualquier tipo de despliegue de Vercel**. Se probó acá
  (app Express con el soporte nativo de "backend framework", no Next.js App
  Router) y falló en silencio de forma intermitente — peor que no haberlo
  usado, porque no hay ningún error que avise que algo se perdió.
- Si se vuelve a intentar `waitUntil` en este proyecto, verificar con varias
  pruebas seguidas (no solo una) antes de confiar en que funciona — el fallo
  fue intermitente, no consistente.
- La red de seguridad de la plataforma (acá, `keep_pending_on_bot_failure`)
  vale más que optimizar la latencia — preferir "a veces tarda" sobre
  "a veces desaparece silenciosamente".
