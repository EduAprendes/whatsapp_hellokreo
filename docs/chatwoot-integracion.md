# Integración con Chatwoot (responder manual desde el inbox)

Decisión tomada: **Opción A** de `pendientes-e-ideas.md` — Chatwoot pasa a ser
el dueño real del canal de WhatsApp (habla directo con Meta), y
`whatsapp_hellokreo` se convierte en su **Agent Bot**. Así cualquier agente
puede entrar al inbox de Chatwoot y responder manualmente en cualquier
momento, no solo mirar una copia de la conversación.

Chatwoot corre self-hosted en el VPS del usuario: `https://chat.hellokreo.com`.

## Estado del código (ya hecho, 2026-09-11)

- `chatwoot.js` — `sendChatwootMessage(conversationId, content)`, llama a
  `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages`
  con el header `api_access_token` del bot.
- `conversationEngine.js` — la lógica de IA (genérico + flujo DEMO) se separó
  de `app.js` para que la usen tanto `/webhook` (Meta directo) como
  `/chatwoot-bot` (vía Chatwoot), sin duplicar código.
- `app.js` → `POST /chatwoot-bot`: recibe los eventos que Chatwoot reenvía al
  Agent Bot. Solo responde si:
  - `event === "message_created"`
  - `message_type === "incoming"` (mensaje del cliente, no de un agente)
  - `conversation.status === "pending"` — si un agente humano ya tomó la
    conversación (la pasó a "open"), el bot se queda callado.
  - Protegido con un secreto compartido (`CHATWOOT_BOT_SHARED_SECRET`, ya
    generado y guardado en `.env`) como query param `?secret=...` en la
    `outgoing_url` del bot — Chatwoot no firma estos webhooks por defecto, así
    que esto evita que cualquiera le pegue a este endpoint y gaste cuota de
    Gemini.
- La ruta vieja `/webhook` (Meta → nosotros directo) se deja intacta como
  respaldo/prueba, pero deja de recibir tráfico real en cuanto el webhook de
  Meta se reapunte a Chatwoot (paso 2 abajo).

## Pasos pendientes en Chatwoot (los hace el usuario, tiene Super Admin)

### 1. Crear el inbox de WhatsApp Cloud API en Chatwoot

Settings → Inboxes → Add Inbox → WhatsApp → API Provider "Cloud API". Completar
con las mismas credenciales que ya están en `.env` de este proyecto:
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
`WHATSAPP_ACCESS_TOKEN`. Chatwoot muestra la URL de webhook que le corresponde
a este inbox.

### 2. Reapuntar el webhook de Meta hacia Chatwoot

En developers.facebook.com → App → WhatsApp → Configuración → Webhooks:
cambiar la Callback URL de `https://whatsapp-hellokreo.vercel.app/webhook`
a la URL que dio Chatwoot en el paso 1. Volver a verificar y a suscribirse al
campo `messages` (son dos pasos separados — ver `whatsapp-setup.md`).

**Ojo:** desde este momento, `whatsapp_hellokreo` deja de recibir mensajes de
Meta directamente — todo pasa por Chatwoot.

### 3. Crear el Agent Bot

`https://chat.hellokreo.com/super_admin/agent_bots` → nuevo bot:

- Nombre: `Kreo AI` (o el que prefieras)
- `outgoing_url`: `https://whatsapp-hellokreo.vercel.app/chatwoot-bot?secret=<valor de CHATWOOT_BOT_SHARED_SECRET en .env>`

### 4. Copiar el access_token del bot

`https://chat.hellokreo.com/super_admin/access_tokens` → buscar el bot recién
creado → copiar su token.

### 5. Asignar el bot al inbox de WhatsApp

Abrir el inbox creado en el paso 1 → Configuración → sección de bot (dropdown
para elegir Agent Bot) → seleccionar `Kreo AI` → Guardar. Si esa opción no
aparece en la UI de este self-hosted, se puede hacer por consola Rails del VPS:

```ruby
bot = AgentBot.find_by(name: "Kreo AI")
AgentBotInbox.create!(inbox: Inbox.find_by(name: "<nombre del inbox de WhatsApp>"), agent_bot: bot)
```

### 6. Pasarme dos datos

- `CHATWOOT_ACCOUNT_ID` — el número que aparece en la URL al estar dentro de
  la cuenta, ej. `https://chat.hellokreo.com/app/accounts/123/...` → es `123`.
- El `access_token` del bot (paso 4).

Con eso completo `CHATWOOT_ACCOUNT_ID` y `CHATWOOT_BOT_ACCESS_TOKEN` en el
`.env` local y en las variables de entorno de Vercel, redeploy, y probamos
escribiendo "DEMO" al número real para confirmar que llega por Chatwoot.

## Cómo se hace el handoff humano en el día a día

- Mientras la conversación esté en estado **"pending"**, el bot responde.
- Un agente que quiera tomarla manualmente: le basta con **cambiar el estado a
  "open"** (o Chatwoot puede hacerlo automático al asignarla a un agente,
  según la configuración del inbox) — el bot deja de responder ahí.
- Para devolvérsela al bot: volver el estado a "pending".

## Qué queda sin resolver todavía

- No se implementó lógica para otros campos del payload de Chatwoot
  (`sender`, `inbox`) — el código asume el shape documentado públicamente
  (`event`, `message_type`, `content`, `conversation.id`,
  `conversation.status`, `conversation.contact`). Si el payload real trae
  algo distinto, el primer mensaje de prueba lo va a mostrar en
  `vercel logs` (se loguea `conversationId` y `content` de cada mensaje
  entrante).
- `TEAM_NOTIFY_PHONE` (aviso de lead agendado) sigue yendo por WhatsApp directo
  vía Graph API (`whatsapp.js`), no por Chatwoot — es una notificación interna,
  no parte de la conversación con el cliente, así que no hace falta que pase
  por Chatwoot.
