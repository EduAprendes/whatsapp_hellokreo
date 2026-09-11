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
- **`ai.js`** — dos herramientas nativas de Gemini (`tools:
  [{functionDeclarations: [...]}]` al crear el modelo):
  - `consultar_disponibilidad(fecha)` → `listAvailableSlots`.
  - `crear_llamada(fecha, hora, nombre, negocio)` → `createEventIfFree`.
  
  `generateDemoReply` arma la conversación como `contents` (roles
  `user`/`model`, no como transcript de texto plano como antes) y loopea
  hasta 6 pasos: si la respuesta trae `functionCalls()`, ejecuta las
  herramientas, agrega `functionResponse` a `contents`, y vuelve a llamar a
  `generateContent`. Cuando ya no hay más llamadas a herramientas, el texto
  final se parsea como el JSON de siempre (`reply`/`stage`/`lead`).

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

## Pendiente

- Probar un caso real de **horario ocupado** (pedir un horario, que
  `crear_llamada` devuelva `horario_ocupado`, y confirmar que la IA ofrece
  una alternativa en vez de trabarse).
- El resumen que se manda a `notifyTeam()` sigue usando `lead.preferredTime`
  (texto libre generado por el modelo) como fuente — no el horario
  estructurado real del evento creado. Funciona porque el modelo es
  consistente, pero no hay garantía dura de que coincidan exactamente.
- Horario de atención (9:00-18:00, L-V) hardcodeado en `googleCalendar.js`
  — si cambia, hay que editar el código.
