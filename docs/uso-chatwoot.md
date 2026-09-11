# Cómo usar Chatwoot en el día a día (WhatsApp Hellokreo)

Guía práctica para el inbox `chat.hellokreo.com` → cuenta "Hellokreo" → inbox
**"WhatsApp Hellokreo"**, después de conectar la IA como Agent Bot (ver
`chatwoot-integracion.md`).

## Cómo encontrar una conversación

El filtro por defecto de Chatwoot es **Estado = "Abiertas"**, y las pestañas
"Mías / Sin asignar / Todos" filtran además por a quién está asignada. El
problema: **una conversación que está siendo atendida por la IA tiene estado
"Pendiente"**, no "Abierta" — así que con los filtros por defecto, no se ve.

Pasos para verla:

1. Click en **"Todas las conversaciones"** (menú izquierdo, no el inbox
   específico — la vista del inbox individual tuvo un comportamiento raro
   con este mismo filtro al probarlo el 2026-09-11).
2. Click en el ícono de filtro (las líneas, junto al chip "Abiertas").
3. Cambiar **Estado** de "Abiertas" a **"Pendientes"**.
4. **Aplicar filtros**.

Con eso aparecen todas las conversaciones que la IA está manejando en este
momento, de más reciente a más antigua, sin importar el inbox.

Alternativa más directa si ya sabes el número de conversación (`#95`, por
ejemplo, visible en la URL o en los logs de Vercel como `conversationId`):
navegar directo a `https://chat.hellokreo.com/app/accounts/1/conversations/{id}`.

## ¿Mirar una conversación apaga la IA?

**No.** Dos cosas muy distintas:

- **Abrir/leer la conversación en pantalla:** no hace nada. Puedes revisar
  cualquier hilo sin miedo a interrumpir al bot.
- **Presionar el botón "Abrir"** (aparece arriba a la derecha cuando el
  estado es "Pendiente") o el link **"Tomar el control"** del aviso
  ("Esta conversación está siendo gestionada por Kreo AI") — **eso sí**
  cambia el estado a "Open" y ahí la IA se detiene para ese chat.

## Tomar el control manualmente

1. Abre la conversación.
2. Click en **"Abrir"** (arriba a la derecha) o en **"Tomar el control"**
   (dentro del aviso de la IA).
3. Escribe tu respuesta normal, como cualquier agente.

**Importante — no hay reversión automática.** Una vez que el estado pasa a
"Open", la IA queda desactivada para ese chat **indefinidamente**: no hay
ningún timeout ni reactivación automática. Se confirmó en producción
(2026-09-11): después de tomar el control manualmente en la conversación
#95, el cliente escribió 3 mensajes más y ninguno tuvo respuesta — ni de la
IA (apagada) ni del agente (no había vuelto a escribir).

**Para devolverle la conversación a la IA:** cambiar el estado de vuelta a
**"Pendiente"** (mismo botón de estado, ahora dice "Pendiente" en el menú).
Ojo: la IA solo reacciona a mensajes *nuevos* — no va a responder retroactivamente
los mensajes que quedaron sin contestar mientras estaba en "Open"; el cliente
tiene que escribir de nuevo (o alguien le responde esos manualmente).

## Ver por qué el bot no respondió algo

Dos lugares:

1. **Logs de Vercel:** `vercel logs https://whatsapp-hellokreo.vercel.app`
   (desde la carpeta del proyecto) — muestra cada `POST /chatwoot-bot` y,
   si el mensaje pasó el filtro, una línea `Mensaje entrante (Chatwoot): {...}`.
2. **El propio hilo en Chatwoot:** un mensaje de actividad tipo *"Conversation
   was marked open by system due to an error with the agent bot"* indica que
   Chatwoot desactivó el bot solo por un fallo del webhook — ver
   `incidente-timeout-webhook.md` para la causa raíz de esto y el fix ya
   aplicado.
