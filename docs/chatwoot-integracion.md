# Integración con Chatwoot (responder manual desde el inbox)

**Estado: implementado y verificado en producción (2026-09-11).**

Decisión tomada: **Opción A** de `pendientes-e-ideas.md` — Chatwoot es el
dueño real del canal de WhatsApp (habla directo con Meta), y
`whatsapp_hellokreo` es su **Agent Bot**. Cualquier agente puede entrar al
inbox de Chatwoot y responder manualmente en cualquier momento, no solo mirar
una copia de la conversación.

Chatwoot corre self-hosted en el VPS del usuario: `https://chat.hellokreo.com`
(`169.58.242.99`, contenedores Docker en `/opt/chatwoot`: `chatwoot-rails-1`,
`chatwoot-sidekiq-1`, `chatwoot-postgres-1`, `chatwoot-redis-1`). Esta
instancia es **compartida** con otros negocios — la cuenta `Account.find(1)`
se llama "Hellokreo" y ya tenía inboxes tipo `Channel::Api` (solo espejo, de
solo lectura) para WhatsApp de parkingplus e Instagram de Angú y Conect Spa.
Este proyecto agregó el primer inbox **nativo** (habla directo con Meta) a
esa misma cuenta.

## Recursos creados en Chatwoot

| Recurso | Id | Nombre |
|---|---|---|
| Account | 1 | Hellokreo |
| Channel::Whatsapp | 1 | provider `whatsapp_cloud` |
| Inbox | 4 | WhatsApp Hellokreo |
| AgentBot | 1 | Kreo AI |

Creados con un script `rails runner` corrido por SSH en el VPS (ver
`## Cómo se creó` abajo) — no por la UI, para poder controlar exactamente los
IDs y confirmar cada paso contra el código fuente de Chatwoot antes de
tocar la cuenta compartida.

## Código (`whatsapp_hellokreo`)

- `chatwoot.js` — `sendChatwootMessage(conversationId, content)`, llama a
  `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages`
  con el header `api_access_token` del bot.
- `conversationEngine.js` — la lógica de IA (genérico + flujo DEMO) se separó
  de `app.js` para que la usen tanto `/webhook` (Meta directo, respaldo) como
  `/chatwoot-bot` (vía Chatwoot), sin duplicar código.
- `app.js` → `POST /chatwoot-bot`: recibe los eventos que Chatwoot reenvía al
  Agent Bot. Solo responde si:
  - `event === "message_created"`
  - `message_type === "incoming"` (mensaje del cliente, no de un agente ni el
    eco del propio bot)
  - `conversation.status === "pending"` — si un agente humano ya tomó la
    conversación (la pasó a "open"), el bot se queda callado.
  - Protegido con un secreto compartido (`CHATWOOT_BOT_SHARED_SECRET`) como
    query param `?secret=...` en la `outgoing_url` del bot — Chatwoot no firma
    estos webhooks por defecto.
- La ruta vieja `/webhook` (Meta → nosotros directo) se deja intacta como
  respaldo, pero ya no recibe tráfico real: Meta ahora manda los eventos de
  este número a Chatwoot (ver siguiente sección — es automático, no fue un
  paso manual en el panel de Meta).

## Cómo se creó (vía SSH, `rails runner`, no por la UI)

Se inspeccionó primero el código fuente de Chatwoot dentro del contenedor
(`docker exec chatwoot-rails-1 cat app/models/channel/whatsapp.rb`, etc.) para
confirmar el shape exacto de `provider_config` y qué dispara automáticamente
la creación del canal, **antes** de tocar la cuenta compartida:

```ruby
account = Account.find(1)

channel = Channel::Whatsapp.create!(
  account: account,
  phone_number: "+584226773234",
  provider: "whatsapp_cloud",
  provider_config: {
    "api_key" => "<WHATSAPP_ACCESS_TOKEN>",
    "phone_number_id" => "1279012775299913",
    "business_account_id" => "2946719125671648"
  }
)

inbox = Inbox.create!(name: "WhatsApp Hellokreo", account: account, channel: channel)
InboxMember.find_or_create_by!(inbox: inbox, user: User.find(1))

bot = AgentBot.create!(
  account: account,
  name: "Kreo AI",
  outgoing_url: "https://whatsapp-hellokreo.vercel.app/chatwoot-bot?secret=<CHATWOOT_BOT_SHARED_SECRET>"
)
AgentBotInbox.create!(inbox: inbox, agent_bot: bot)
```

Corrido así (el archivo se pasa por stdin, `rails runner` no ve archivos del
host dentro del contenedor):

```bash
cd /opt/chatwoot
docker compose exec -T rails bundle exec rails runner - < setup_hellokreo_channel.rb
```

### Por qué esto NO requirió tocar el panel de Meta manualmente

`Channel::Whatsapp` tiene un hook `after_commit :setup_webhooks, on: :create`
(`app/models/channel/whatsapp.rb`) que llama a
`Whatsapp::WebhookSetupService`, el cual:

1. `POST /{waba_id}/subscribed_apps` — suscribe la app (dueña del token) a la
   WABA.
2. `POST /{phone_number_id}/...` — hace un **override del callback a nivel de
   número de teléfono** (`override_phone_number_callback` en
   `app/services/whatsapp/facebook_api_client.rb`), apuntándolo a
   `{FRONTEND_URL}/webhooks/whatsapp/{phone_number}` de Chatwoot.

El override es por número, no cambia la Callback URL global de la App en
developers.facebook.com — por eso no hubo que ir al panel de Meta a mano.
También registró (`register_phone_number`) solo si hacía falta; en este caso
el log mostró `Phone number ... code verification status: true`, así que no
tuvo que re-registrar nada.

**Reversible:** `Channel::Whatsapp` tiene `before_destroy :teardown_webhooks`
— borrar el canal debería revertir el override y devolver el número al
comportamiento por defecto (Callback URL de la App, es decir, volvería a
`whatsapp_hellokreo`/`app.js` → `/webhook`).

## Verificado en producción

Mensaje real de WhatsApp → Chatwoot → `POST /chatwoot-bot` → Gemini →
`sendChatwootMessage` → Chatwoot → WhatsApp → llegó al celular del usuario.
Log de Vercel: `Mensaje entrante (Chatwoot): { conversationId: 95, content: 'Hola esto es una prueba' }`.

## Cómo se hace el handoff humano en el día a día

Guía completa de uso en [`uso-chatwoot.md`](./uso-chatwoot.md), incluyendo
cómo encontrar las conversaciones (el filtro por defecto de Chatwoot no las
muestra). Resumen:

- Mientras la conversación esté en estado **"pending"**, el bot responde.
- **Solo mirar/leer una conversación no la desactiva** — hace falta la
  acción explícita de presionar "Abrir" o "Tomar el control".
- Un agente que quiera tomarla manualmente: entra a `chat.hellokreo.com` →
  esa conversación → botón **"Abrir"** o **"Tomar el control"** — el bot deja
  de responder ahí.
- **No hay reversión automática.** Para devolvérsela al bot hay que volver el
  estado a "pending" a mano — verificado en producción (2026-09-11): tres
  mensajes del cliente después del handoff se quedaron sin respuesta hasta
  que se reseteó el estado manualmente.

## Incidente conocido: el bot se apagaba solo por timeout

El 2026-09-11 se encontró (y arregló) un bug donde Chatwoot desactivaba el
bot automáticamente por un timeout del webhook, sin que nadie lo pidiera —
ver [`incidente-timeout-webhook.md`](./incidente-timeout-webhook.md) para la
causa raíz completa y el fix (`waitUntil` + respuesta inmediata).

## Qué queda sin resolver

- El payload real de Chatwoot trae más campos de los que usamos
  (`sender`, `inbox`, etc.) — el código solo lee `event`, `message_type`,
  `content`, `conversation.id`, `conversation.status`, `conversation.contact`.
  Suficiente para lo que hace hoy; si se necesita el nombre del contacto real
  de WhatsApp (no solo el número) para el aviso a `TEAM_NOTIFY_PHONE`, revisar
  qué trae `conversation.contact` o `conversation.meta.sender` en un payload
  real (se logueó `conversationId` y `content` únicamente, no el payload
  completo).
- `TEAM_NOTIFY_PHONE` (aviso de lead agendado) sigue yendo por WhatsApp directo
  vía Graph API (`whatsapp.js`), no por Chatwoot — es una notificación interna,
  no parte de la conversación con el cliente.
- El flujo "DEMO" no se volvió a probar end-to-end sobre este nuevo camino
  (sí se probó el genérico) — las claves de conversación ahora son
  `cw-{conversation.id}` en vez del número de teléfono, pero la lógica de
  `conversationEngine.js` es la misma que ya se probó por `/webhook`.
