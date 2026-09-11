# Integración con Instagram (flujo "DEMO")

**Estado: funcionando en producción (2026-09-11).** Mismo patrón que WhatsApp
(`chatwoot-integracion.md`) — Chatwoot es dueño del canal, `whatsapp_hellokreo`
es su Agent Bot — pero con dos diferencias importantes: requiere la palabra
clave **"DEMO"** para arrancar (a diferencia de WhatsApp, que responde
siempre), y el redireccionamiento del webhook de Meta **sí requiere un paso
manual** en el panel de Meta (Instagram no tiene el mecanismo de override por
objeto que sí tiene WhatsApp Business Platform).

## De dónde sale la cuenta de Instagram

Se reutiliza la cuenta ya conectada en el proyecto `D:\Programacion\conect_spa_test`
— un proyecto de **prueba/plantilla** (sin clientes reales, confirmado con el
usuario), documentado en `conect_spa_test/docs/01-INSTAGRAM-META.md`. Usa el
flujo "API de Instagram con inicio de sesión de Instagram" (sin Página de
Facebook), con su **propia App de Meta**, distinta de la App de WhatsApp de
Hellokreo:

- `META_IG_USER_ID` = `1626903829167646` — **ojo, este NO es el id que usa Chatwoot** (ver más abajo, "El id de la cuenta que importa de verdad").
- `META_APP_SECRET` de esa App (no confundir con `WHATSAPP_APP_SECRET` de Hellokreo)
- Token de acceso: se refrescó el 2026-09-11 contra `graph.instagram.com/refresh_access_token` (venía válido, quedó con vencimiento el **2026-11-10**)

Al reapuntar el webhook a Chatwoot, `conect_spa_test` deja de recibir
mensajes automáticamente — no hizo falta tocar su código para "apagar" su IA,
solo dejar de mandarle tráfico.

**Pendiente (idea del usuario, no urgente):** migrar esta conexión a la
propia App de Meta de Hellokreo (la misma que ya usa WhatsApp), en vez de
depender de la App de `conect_spa_test`. Implica repetir la conexión desde
cero ahí (agregar el producto "API de Instagram con inicio de sesión de
Instagram", aceptar de nuevo el rol de "Evaluador de Instagram" desde
Instagram, generar un token nuevo — el token actual queda atado a la App de
`conect_spa_test` y no es transferible). Se pospuso para más adelante.

## Recursos creados en Chatwoot (cuenta "Hellokreo", id 1)

| Recurso | Id | Nombre |
|---|---|---|
| Channel::Instagram | 1 | `instagram_id` 17841401180206289 (corregido, ver abajo) |
| Inbox | 5 | Instagram Hellokreo |
| AgentBot | 2 | Kreo AI - Instagram |

Creado igual que WhatsApp: `rails runner` por SSH, no por la UI (ver
`chatwoot-integracion.md` para el porqué). Script usado:

```ruby
account = Account.find(1)
channel = Channel::Instagram.create!(
  account: account,
  instagram_id: "1626903829167646",
  access_token: "<token refrescado>",
  expires_at: Time.parse("2026-11-10T14:48:02Z")
)
inbox = Inbox.create!(name: "Instagram Hellokreo", account: account, channel: channel)
InboxMember.find_or_create_by!(inbox: inbox, user: User.find(1))

bot = AgentBot.create!(
  account: account,
  name: "Kreo AI - Instagram",
  outgoing_url: "https://whatsapp-hellokreo.vercel.app/chatwoot-bot/instagram?secret=<CHATWOOT_BOT_SHARED_SECRET>"
)
AgentBotInbox.create!(inbox: inbox, agent_bot: bot)
```

Se creó un **Agent Bot separado** (no se reutilizó "Kreo AI" de WhatsApp)
porque cada bot solo tiene una `outgoing_url`, y necesitamos que Instagram
pegue a una ruta distinta (`/chatwoot-bot/instagram`, con `requireTrigger:
true`) que WhatsApp (`/chatwoot-bot`, siempre activo). El envío de mensajes sí
reutiliza el mismo `CHATWOOT_BOT_ACCESS_TOKEN` que ya está en `.env` — un
Agent Bot tiene permisos a nivel de cuenta, no por inbox, así que no hizo
falta agregar una variable de entorno nueva.

## Por qué Instagram SÍ necesitó un paso manual en el panel de Meta

A diferencia de `Channel::Whatsapp` (que hace un override del callback a
nivel de número, sin tocar nada a mano — ver `chatwoot-integracion.md`),
`Channel::Instagram#subscribe` (`app/models/channel/instagram.rb`) solo
llama a `POST /{instagram_id}/subscribed_apps` — eso le dice a Meta "entrega
los eventos de esta cuenta a la App dueña de este token", pero **la URL de
entrega la sigue definiendo la Callback URL configurada a mano en el panel de
esa App** (Instagram no tiene el equivalente al `override_callback_uri` de
WhatsApp Business Platform).

Por eso hizo falta ir al panel de Meta de la App de `conect_spa_test` y
cambiar la Callback URL a mano, de `.../api/instagram/webhook` (código propio
de `conect_spa_test`) a `https://chat.hellokreo.com/webhooks/instagram`
(Chatwoot). El Verify Token no cambió — ver siguiente sección.

## Firma del webhook: secreto GLOBAL de la instalación, no por canal

Otro hallazgo importante leyendo el código (`app/controllers/webhooks/instagram_controller.rb`
+ `MetaTokenVerifyConcern`): `Channel::Instagram` no guarda un `app_secret`
propio (a diferencia de `Channel::Whatsapp`, que sí tiene `provider_config`
con su propio `api_key`). La validación de la firma `X-Hub-Signature-256` de
**todo** el tráfico de Instagram en este Chatwoot cae en dos valores de
configuración **globales de la instalación** (`InstallationConfig`, afectan a
cualquier canal de Instagram futuro en esta cuenta, no solo el nuestro):

```ruby
InstallationConfig.find_or_initialize_by(name: "INSTAGRAM_APP_SECRET").tap { |c| c.value = "<META_APP_SECRET de conect_spa_test>"; c.save! }
InstallationConfig.find_or_initialize_by(name: "INSTAGRAM_VERIFY_TOKEN").tap { |c| c.value = "<META_VERIFY_TOKEN de conect_spa_test>"; c.save! }
```

Ninguno de los dos estaba configurado antes (verificado antes de tocar nada,
`GlobalConfig.get_value(...).present?` → `false` en ambos) — no había riesgo
de pisar algo de otro canal. Configurado el 2026-09-11. Handshake verificado:

```bash
curl "https://chat.hellokreo.com/webhooks/instagram?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test123"
# devuelve: test123
```

**Si en el futuro se agrega otro canal de Instagram a esta misma cuenta de
Chatwoot con una App de Meta distinta**, va a compartir este mismo secreto —
tendría que usar la misma App, o revisar esta limitación.

## El id de la cuenta que importa de verdad (no es `META_IG_USER_ID`)

Primer intento de prueba (escribir "Demo" a la cuenta): el webhook llegaba
bien a Chatwoot (firma válida, evento encolado en Sidekiq, sin ningún error),
pero **no se creaba ninguna conversación**. La causa: el canal se creó con
`instagram_id: "1626903829167646"` (el `META_IG_USER_ID` que aparece en el
panel de Meta, "Identificador de la app de Instagram"), pero el
`recipient.id` que realmente llega en cada evento de mensaje es **otro
número distinto**: `17841401180206289` — confirmado leyendo directo
`docker logs chatwoot-rails-1` durante la prueba real. Chatwoot busca el
canal por ese id (`Channel::Instagram.find_by(instagram_id: recipient_id)`)
y, al no encontrar coincidencia, el job simplemente no hace nada — sin error,
sin log de advertencia.

**Fix:** `Channel::Instagram.find(1).update!(instagram_id: "17841401180206289")`.
Después de esto, la conversación sí se creó y la IA respondió.

**Lección:** el "Identificador de la app de Instagram" que muestra el panel
de configuración de Meta (usado para las llamadas salientes a
`graph.instagram.com`) **no es necesariamente el mismo id que aparece como
`recipient`/`sender` en los eventos entrantes del webhook**. Si se conecta
otra cuenta de Instagram en el futuro, mejor confirmar el id real mirando un
evento real en los logs (`docker logs chatwoot-rails-1 | grep instagram`)
antes de crear el canal, en vez de asumir que es el mismo que aparece en el
panel de Meta.

## Código (`whatsapp_hellokreo`)

- `app.js` → `POST /chatwoot-bot/instagram`: mismo handler que WhatsApp
  (`chatwootBotHandler`), pero con `requireTrigger: true`.
- `conversationEngine.js` → `handleIncomingText(key, text, { requireTrigger })`:
  si `requireTrigger` es true y la conversación todavía no fue activada, solo
  sigue si el texto contiene la palabra "demo" (`\bdemo\b`, case-insensitive);
  si no, no responde nada (silencio total, no solo un mensaje corto — así lo
  pidió el usuario).
- `conversations.js`: cada conversación ahora trackea `triggered` además de
  `history` y `notified`.
- `ai.js` → `DEMO_SYSTEM_PROMPT` se generalizó para no mencionar "WhatsApp"
  específicamente (ahora sirve para ambos canales).

## Probado en producción (2026-09-11)

Conversación #99: "Demo" → presentación del vendedor digital 24/7 (respuesta
de la IA). Confirma que toda la cadena funciona: Meta → Chatwoot
(`/webhooks/instagram`) → Agent Bot (`/chatwoot-bot/instagram`) → Gemini →
Chatwoot → Instagram.

**Encontrado en la misma prueba:** el segundo mensaje de esa conversación
("Quisiera más información por favor") se quedó sin respuesta — resultó ser
el bug de `waitUntil` documentado en `incidente-timeout-webhook.md` (no
específico de Instagram). Ya revertido a procesamiento síncrono.

## Pendiente

- Volver a probar una conversación completa (varios mensajes seguidos) ahora
  que se revirtió `waitUntil`, para confirmar que ya no se pierde ninguna
  respuesta.
- Migrar la conexión a la propia App de Meta de Hellokreo (ver arriba) —
  pospuesto, no urgente.
- Probar que un mensaje SIN "demo" efectivamente no genera ninguna respuesta
  con Instagram real (se probó en local con un payload simulado).
