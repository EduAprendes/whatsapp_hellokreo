# Integración con Instagram (flujo "DEMO")

**Estado: funcionando en producción (2026-09-11).** Mismo patrón que WhatsApp
(`chatwoot-integracion.md`) — Chatwoot es dueño del canal, `whatsapp_hellokreo`
es su Agent Bot — pero con dos diferencias importantes: requiere la palabra
clave **"DEMO"** para arrancar (a diferencia de WhatsApp, que responde
siempre), y el redireccionamiento del webhook de Meta **sí requiere un paso
manual** en el panel de Meta (Instagram no tiene el mecanismo de override por
objeto que sí tiene WhatsApp Business Platform).

## De dónde sale la cuenta de Instagram

**Primer intento (descartado):** se reutilizó la cuenta ya conectada en el
proyecto `D:\Programacion\conect_spa_test` — un proyecto de
**prueba/plantilla** (sin clientes reales, confirmado con el usuario),
documentado en `conect_spa_test/docs/01-INSTAGRAM-META.md`. Usaba el flujo
"API de Instagram con inicio de sesión de Instagram" (sin Página de
Facebook), con la App de Meta propia de `conect_spa_test` (distinta de la de
WhatsApp de Hellokreo).

**Migración a la App de Hellokreo (2026-09-11, la que quedó activa):** el
usuario prefirió usar la misma App de Meta que ya tiene el WhatsApp de
Hellokreo en vez de depender de la de `conect_spa_test`. Se agregó el
producto **"Administrar mensajes y contenido en Instagram"** a esa App
existente (no se creó una App nueva) y se conectó la cuenta **`raquela.v`**
como evaluador de Instagram. El token queda atado a la App donde se generó
— **no es transferible entre Apps**, por eso hizo falta repetir la conexión
desde cero ahí (agregar el producto, aceptar el rol de "Evaluador de
Instagram" desde `instagram.com/accounts/manage_access/`, generar un token
nuevo) en vez de reutilizar el de `conect_spa_test`.

Datos de esta conexión (la activa):

- Cuenta: `raquela.v`
- "Identificador de la app de Instagram" que muestra el panel: `1715365416204177` — **tampoco es el id que usa Chatwoot** (ver "El id de la cuenta que importa de verdad" más abajo; el id real resultó ser `17841401083817784`, obtenido directo del dato que dio el usuario, no del panel).
- Secreto de esta conexión (**distinto** del `WHATSAPP_APP_SECRET` de la misma App — el producto "Instagram Login" tiene su propio secreto, separado del secreto general de la App): `93d282653d6a8dd43876899a24f286d1`.
- Token de acceso: generado el 2026-09-11, refrescado contra `graph.instagram.com/refresh_access_token`, vence el **2026-11-10**.
- Requirió agregar una **URL de política de privacidad** en la Configuración básica de la App — se creó `https://whatsapp-hellokreo.vercel.app/privacy` para esto (`app.js`).

Al reapuntar el webhook de `conect_spa_test` a Chatwoot (antes de la
migración) y luego no volver a usar esa App, `conect_spa_test` dejó de
recibir mensajes automáticamente — no hizo falta tocar su código para
"apagar" su IA, solo dejar de mandarle tráfico.

## Recursos creados en Chatwoot (cuenta "Hellokreo", id 1)

| Recurso | Id | Nombre |
|---|---|---|
| Channel::Instagram | 1 | `instagram_id` 17841401083817784 (cuenta `raquela.v`, App de Hellokreo) |
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
de pisar algo de otro canal. Configurado el 2026-09-11 con el secreto de
`conect_spa_test`. Handshake verificado:

```bash
curl "https://chat.hellokreo.com/webhooks/instagram?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test123"
# devuelve: test123
```

**Actualizado al migrar a la App de Hellokreo:** `INSTAGRAM_APP_SECRET` se
sobrescribió con el secreto de esa nueva conexión (`93d282653d6a8dd43876899a24f286d1`,
distinto del `WHATSAPP_APP_SECRET` de la misma App — ver arriba). El
`INSTAGRAM_VERIFY_TOKEN` no cambió, se reutilizó el mismo valor.

**Si en el futuro se agrega otro canal de Instagram a esta misma cuenta de
Chatwoot con una App de Meta distinta**, va a compartir este mismo secreto —
tendría que usar la misma App, o revisar esta limitación.

## El id de la cuenta que importa de verdad (no es "Identificador de la app de Instagram")

Pasó **dos veces** (una con la cuenta de `conect_spa_test`, otra al migrar a
la App de Hellokreo con `raquela.v`): al escribir "Demo", el webhook llegaba
bien a Chatwoot (firma válida, evento encolado en Sidekiq, sin ningún error),
pero **no se creaba ninguna conversación**. La causa: el canal se creó con el
"Identificador de la app de Instagram" que muestra el panel de Meta
(`1626903829167646` la primera vez, `1715365416204177` la segunda), pero el
`recipient.id` que realmente llega en cada evento de mensaje es **otro
número distinto** — confirmado leyendo directo `docker logs chatwoot-rails-1`
durante la prueba real la primera vez (`17841401180206289`); la segunda vez
el usuario ya tenía a mano el id correcto de la cuenta (`17841401083817784`)
sin necesidad de repetir ese paso. Chatwoot busca el canal por ese id
(`Channel::Instagram.find_by(instagram_id: recipient_id)`) y, al no
encontrar coincidencia, el job simplemente no hace nada — sin error, sin log
de advertencia.

**Fix:** `Channel::Instagram.find(1).update!(instagram_id: "<id correcto>")`.
Después de esto, la conversación sí se creó y la IA respondió.

**Lección:** el "Identificador de la app de Instagram" que muestra el panel
de configuración de Meta (usado para las llamadas salientes a
`graph.instagram.com`) **no es el mismo id que aparece como
`recipient`/`sender` en los eventos entrantes del webhook** — pasó las dos
veces que se conectó una cuenta nueva. Si se conecta otra cuenta de
Instagram en el futuro, mejor confirmar el id real mirando un evento real en
los logs (`docker logs chatwoot-rails-1 | grep instagram`) antes de crear el
canal, en vez de asumir que es el mismo que aparece en el panel de Meta.

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

Conversación #99 (cuenta de `conect_spa_test`, antes de migrar): "Demo" →
presentación del vendedor digital 24/7 (respuesta de la IA). Confirmó que
toda la cadena funciona: Meta → Chatwoot (`/webhooks/instagram`) → Agent Bot
(`/chatwoot-bot/instagram`) → Gemini → Chatwoot → Instagram.

En esa misma prueba se encontraron y arreglaron, en orden, tres bugs
distintos (los tres documentados en detalle en sus propios docs):

1. El segundo mensaje de la conversación se quedó sin respuesta — bug de
   `waitUntil` (`incidente-timeout-webhook.md`), no específico de Instagram.
2. Una respuesta llegó como JSON crudo en vez de texto normal — el modelo
   devolvió `None` de Python en vez de `null` (`flujo-demo.md`).
3. Un mensaje de seguimiento se quedó sin respuesta *de nuevo*, esta vez sin
   ningún error — el estado en memoria no sobrevivía entre instancias
   paralelas de Vercel bajo ráfagas de mensajes (`persistencia-redis.md`).

Con los tres arreglados, se confirmó en producción (ya con la cuenta
`raquela.v` migrada a la App de Hellokreo) que una conversación completa con
varios mensajes seguidos ("Demo" → pregunta de calificación → respuesta) no
pierde ninguna respuesta.

## Pendiente

- Probar que un mensaje SIN "demo" efectivamente no genera ninguna respuesta
  con Instagram real (se probó en local con un payload simulado, y de forma
  indirecta en producción — conversaciones donde el primer mensaje sin
  "demo" quedó sin respuesta — pero no una prueba dedicada).
- La cuenta `conect_spa_test` original (canal viejo, ya no usado) sigue
  existiendo como recurso huérfano — no rompe nada, pero se podría limpiar.
