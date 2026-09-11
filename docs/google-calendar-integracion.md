# Agendamiento real en Google Calendar (flujo DEMO)

**Estado: funcionando en producción (2026-09-11).**

Antes, cuando el flujo DEMO calificaba un lead, solo capturaba el horario
como texto libre (`lead.preferredTime`) y avisaba al equipo — nadie
verificaba disponibilidad real, ni se creaba ningún evento. Ahora la IA
puede **consultar disponibilidad real** y **crear el evento de verdad**,
dentro de la misma conversación.

## Por qué tool-calling y no un paso aparte

Se evaluó agregar un paso determinístico separado (parsear `preferredTime`
con otra llamada a Gemini, chequear disponibilidad, crear el evento) en vez
de dejar que el modelo maneje herramientas directamente. Se optó por
**function calling nativo de Gemini** (soportado por `@google/generative-ai`
sin librerías extra) porque:

- Reutiliza el patrón ya resuelto y depurado en `conect_spa_test`
  (`docs/03-GOOGLE-CALENDAR-IA.md`) — incluyendo el bug de "el modelo no
  sabe qué día es hoy" (ver abajo), ya evitado desde el diseño.
- Permite que la IA reaccione naturalmente a un horario ocupado (vuelve a
  consultar disponibilidad y ofrece otro) sin código adicional de manejo de
  casos — es conversación normal con herramientas, no un flujo rígido.

## Credenciales: cuenta de servicio reutilizada de `conect_spa_test`

Se reutilizó la **misma cuenta de servicio de Google** que ya usa
`conect_spa_test` (`id-conect-spa-calendar@river-nectar-473017-b6.iam.gserviceaccount.com`)
en vez de crear un proyecto de Google Cloud nuevo — más simple, y no importa
que sea la misma cuenta de servicio para varios calendarios: una cuenta de
servicio puede tener acceso a cualquier cantidad de calendarios, cada uno
compartido por separado.

**El calendario es el propio del usuario** (no uno de prueba/plantilla),
compartido con esa cuenta de servicio el 2026-09-11 con permiso
**"Realizar cambios en los eventos"** (el nivel más bajo, "Ver todos los
detalles del evento", no alcanza para crear eventos — se probó y dio 403
`requiredAccessLevel` hasta subir el permiso).

Variables en `.env`: `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (con los `\n` literales, el código hace
`.replace(/\\n/g, "\n")`), `GOOGLE_CALENDAR_ID`, `BUSINESS_UTC_OFFSET`
(`-04:00`). Cargadas también en Vercel (`vercel env add`, usando `printf
'%s'` en vez de `echo`/heredoc para no perder los `\n` literales de la
clave).

## Código

- **`googleCalendar.js`** — auth con `google-auth-library` (JWT de cuenta de
  servicio, sin OAuth), llamadas directas a la REST API de Calendar v3 (sin
  el paquete `googleapis` completo, para no agregar una dependencia pesada).
  - `getBusyPeriods(timeMin, timeMax)` — `POST /freeBusy`.
  - `listAvailableSlots(fecha)` — calcula bloques libres de 30 min dentro
    del horario de atención (9:00-18:00, lunes a viernes, hardcodeado —
    ajustar si cambia) contra el free/busy real. **La IA nunca debe inventar
    horarios**, siempre pasa por acá.
  - `createEventIfFree({...})` — vuelve a chequear conflicto justo antes de
    crear el evento (no confía en lo que la IA calculó antes en la
    conversación — puede haber pasado tiempo, o la IA pudo equivocarse).
- **`businessTime.js`** — fecha/hora actual del negocio (offset fijo, sin
  multi-timezone) y conversión `AAAA-MM-DD` + `HH:mm` → ISO real.
- **`ai.js`** — cuatro herramientas nativas de Gemini (`tools:
  [{functionDeclarations: [...]}]` al crear el modelo):
  - `consultar_disponibilidad(fecha)` → `listAvailableSlots`.
  - `crear_llamada(fecha, hora, nombre, negocio)` → `createEventIfFree`.
  - `reagendar_llamada(fecha, hora)` → `updateEventIfFree` (mueve el mismo
    evento, no crea uno nuevo — ver "Reagendar y cancelar" más abajo).
  - `cancelar_llamada()` → `cancelEvent`.

  `generateDemoReply(history, conversation)` recibe la conversación completa
  (no solo el historial) porque reagendar/cancelar necesitan leer y
  modificar `conversation.bookedEvent`. Arma la conversación como `contents`
  (roles `user`/`model`) y loopea hasta 6 pasos: si la respuesta trae
  `functionCalls()`, ejecuta las herramientas, agrega `functionResponse` a
  `contents`, y vuelve a llamar a `generateContent`. Cuando ya no hay más
  llamadas a herramientas, el texto final se parsea como el JSON de siempre
  (`reply`/`stage`/`lead`).

  El `systemInstruction` ahora se genera dinámicamente en cada llamada
  (`buildSystemPrompt()`, no una constante) para poder inyectar la fecha/hora
  actual del negocio.

## El bug que ya se evitó: "hoy" no existe para el modelo

Documentado en `conect_spa_test/docs/03-GOOGLE-CALENDAR-IA.md`: el modelo no
tiene forma de saber qué fecha es "hoy" a menos que se lo digamos
explícitamente. El `systemInstruction` incluye siempre una línea como:

```
Hoy es viernes 2026-09-11 (formato AAAA-MM-DD) y son las 13:15 hs en el
huso horario del negocio (UTC-04:00).
```

Así el modelo puede resolver "mañana", "el lunes que viene", etc. a una
fecha concreta antes de llamar a `consultar_disponibilidad`.

## Probado end-to-end (2026-09-11)

Conversación local completa: presentación → calificación → "el lunes 14 de
septiembre a las 10am me viene bien" → la IA llamó a `crear_llamada` →
**evento real creado** en el calendario (`Llamada demo Kreo — Prueba Local
(Test SRL)`, con la descripción correcta) → confirmado consultando
`listAvailableSlots` (el 10:00 pasó de libre a ocupado) → evento borrado
después de confirmar (era una prueba). También verificado en producción
(Vercel) que la autenticación con Google funciona ahí — sin errores de
credenciales en `vercel logs`.

## Bug encontrado y arreglado: el modelo decía "te mandé el link" sin mandarlo

Probado con un cliente real por Instagram (2026-09-11): el evento se creaba
correctamente en el calendario, pero el mensaje final decía *"Te envié el
link al evento en el chat para que lo guardes"* — sin que ningún link
apareciera en ningún lado. El modelo confirmaba la acción sin haber incluido
el dato real.

**Fix:** `crear_llamada` (y ahora también `reagendar_llamada`) avisan a
`generateDemoReply` cuando la herramienta tuvo éxito de verdad, vía un
callback (`setCalendarAction`). Primera versión del fix: el código agregaba
el link real al final del mensaje del cliente cuando ese callback se
disparaba — ya no dependía de `stage` (que resultó no ser confiable, ver
siguiente sección).

**Corregido de nuevo el mismo día:** el usuario preguntó si ese link de
Google Calendar era público y si estaba bien mandárselo al cliente. No lo
es (requiere login de Google con acceso al calendario), y como el cliente
nunca se agrega como invitado del evento (no le pedimos su email en este
flujo), el link **no le funcionaría** aunque se lo mandáramos — y además no
tiene sentido exponerle a alguien externo el link interno del calendario
del equipo. Se sacó el link de la respuesta al cliente por completo; ahora
solo viaja en `calendarAction.link` hacia `notifyTeam()` (aviso interno),
donde sí tiene sentido porque el equipo sí tiene acceso a su propio
calendario. El prompt también se ajustó: ya no dice "el sistema agrega el
link", dice simplemente que no se manda ninguno.

## Reagendar y cancelar (2026-09-11)

Al principio solo existía `crear_llamada` — si el cliente pedía cambiar el
horario en la misma conversación, la IA no tenía forma de modificar el
evento ya creado. En el mejor caso volvía a llamar a `crear_llamada`,
**duplicando el evento** en vez de moverlo.

Se agregó `conversation.bookedEvent` (persistido en Redis junto al resto del
estado — ver `persistencia-redis.md`) que guarda `{eventId, startISO,
endISO, nombre, negocio}` apenas `crear_llamada` agenda de verdad. Las
herramientas nuevas operan sobre ESE evento:

- `reagendar_llamada(fecha, hora)` → `updateEventIfFree({eventId, ...})` —
  hace un `PATCH` sobre el mismo evento (mismo `id`, confirmado comparando
  el link antes/después de reagendar en la prueba). Antes de mover el
  evento, chequea disponibilidad real del horario nuevo — pero el propio
  horario ACTUAL del evento no cuenta como "ocupado" contra sí mismo (si no,
  nunca se podría reagendar nada).
- `cancelar_llamada()` → `cancelEvent(eventId)` — `DELETE` real del evento,
  y `conversation.bookedEvent` vuelve a `null`.

**El aviso al equipo dejó de depender del `stage`** que reporta el modelo
(demostró no ser confiable — ver los bugs de arriba) y pasó a depender de
`calendarAction`, un objeto que `ai.js` solo genera cuando una herramienta
de calendario tuvo éxito de verdad este turno (`{type: "created" |
"rescheduled" | "cancelled", lead, startISO, link}`). `notifyTeam()` en
`app.js` arma un mensaje distinto para cada tipo.

Probado end-to-end en local: agendar (9:00) → reagendar (12:00, mismo event
id) → cancelar → confirmado que ambos horarios quedan libres de nuevo en el
calendario real.

## Límite conocido: reservas hechas antes de `bookedEvent` no se pueden reagendar solas

Probado con un cliente real: intentó reagendar una llamada que se había
creado **antes** de que existiera `conversation.bookedEvent` (o sea, con una
versión anterior del código) — la IA respondía "no pude encontrar tu llamada
agendada" porque esa conversación vieja en Redis no tiene ese campo. Se
solucionó ese caso puntual a mano (`getConversation` + `saveConversation`
para setear `bookedEvent` con el `eventId` real, ubicado buscando el evento
en el calendario por fecha/hora). No hace falta una migración general — es
un caso único que no se va a repetir para reservas nuevas (todas las que se
creen de acá en adelante ya guardan `bookedEvent` automáticamente).

## Pendiente

- Probar un caso real de **horario ocupado** (pedir un horario, que
  `crear_llamada` devuelva `horario_ocupado`, y confirmar que la IA ofrece
  una alternativa en vez de trabarse).
- Horario de atención (9:00-18:00, L-V) hardcodeado en `googleCalendar.js`
  — si cambia, hay que editar el código.
