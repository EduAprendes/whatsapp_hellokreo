# Por qué se perdían respuestas y cómo Redis lo arregló

**Estado: solucionado y en producción (2026-09-11).**

## La explicación simple

Imagina que en vez de un solo empleado atendiendo el chat, hay varios
empleados en escritorios distintos — y cada mensaje que llega se lo dan al
primero que esté libre. El problema: **ninguno se pasa notas entre sí**.

Si el empleado A atendió tu "Demo" y anotó en **su propia libreta**
"este cliente ya activó la demo", y dos segundos después tu siguiente
mensaje le toca al empleado B (con su libreta vacía), B no tiene ni idea de
que ya hablaste antes. Como la regla dice "no respondas si no dijeron demo
todavía", B se queda callado.

Eso pasaba literalmente así: cuando llegan varios mensajes casi al mismo
tiempo (Instagram reenvía duplicados/ecos de cada mensaje real), Vercel
levanta **varias copias del servidor en paralelo** para atender más rápido.
Cada copia tenía su propia "libreta" — un simple objeto en la memoria (RAM)
de esa copia, sin nada compartido con las demás. Por eso a veces la segunda
respuesta se perdía en silencio: le tocó a una copia que nunca se enteró de
la primera parte de la conversación. Lo mismo pasaba, con otra causa, cada
vez que se hacía un `deploy` nuevo: el proceso se reinicia y esa "libreta"
en memoria se borra por completo.

**Redis** es una base de datos pensada para ser rápida y simple — un lugar
externo y compartido donde guardar datos cortos (en este caso: el historial
de cada conversación, si ya se activó el "DEMO", si ya se avisó al equipo).
Es como reemplazar las libretas personales por **un pizarrón único** que
cualquier empleado puede leer y actualizar. Ahora, sin importar qué copia
del servidor atienda un mensaje, todas leen y escriben en el mismo pizarrón
antes de responder — la copia que procesa "Dame más info" ve ahí que ya
dijiste "Demo" antes, así que sabe que debe responder.

## Cómo se descubrió

No fue una sola falla — fueron dos síntomas del mismo problema de fondo,
encontrados en producción probando el flujo de Instagram:

1. **Después de varios `deploy` seguidos** (por la integración de Google
   Calendar), una conversación que ya había activado "Demo" dejó de
   responder a un mensaje de seguimiento sin ningún error. El redeploy
   reinició el proceso y la "libreta en memoria" para esa conversación se
   perdió.
2. **Sin ningún redeploy de por medio**, el mismo síntoma volvió a pasar:
   Instagram mandó ~6 eventos casi simultáneos para un solo "Demo" (webhooks
   duplicados/ecos, comportamiento normal de Meta), y el mensaje de
   seguimiento que llegó 17 segundos después se quedó sin respuesta — sin
   ningún error tampoco. Esto confirmó que el problema no era solo el
   redeploy: **Vercel puede correr varias instancias en paralelo bajo una
   ráfaga de tráfico**, cada una con su propia memoria.

## La solución técnica

**Redis (Upstash)**, provisionado vía Vercel Marketplace:

```bash
vercel integration add upstash/upstash-kv
```

Esto auto-provisiona la base de datos, la conecta al proyecto, y carga las
variables de entorno (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc.) tanto en
Vercel (Production/Preview/Development) como en `.env.local` localmente —
se migraron a mano al `.env` principal del proyecto, que es la convención
que usa este repo.

**Ojo con un detalle de nombres:** el paquete `@upstash/redis` trae un
helper `Redis.fromEnv()` que busca `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` — pero la integración de Vercel Marketplace usa
la convención vieja de `@vercel/kv`: `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
Con `fromEnv()` a secas, el cliente no encuentra las credenciales. Hay que
construirlo a mano:

```js
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});
```

**`conversations.js`** — antes tenía un `Map` en memoria; ahora
`getConversation`/`saveConversation` son funciones `async` que leen/escriben
en Redis (`redis.get`/`redis.set`), con un TTL de 48h por conversación
(alcanza de sobra para una conversación de prueba/demo — no hace falta que
persista para siempre).

**`conversationEngine.js`** — `await getConversation(key)` al principio, y
`await saveConversation(key, conversation)` al final de cada turno, antes de
devolver la respuesta.

## Probado

- Local: dos llamadas **separadas** al proceso (simulando instancias
  distintas) comparten el mismo estado a través de Redis — confirmado
  guardando y releyendo una conversación de prueba.
- Local: flujo completo (mensaje sin trigger → ignorado → "Demo" → activa →
  siguiente mensaje → responde) probado de punta a punta con Redis real.
- Producción: mismo flujo probado contra `https://whatsapp-hellokreo.vercel.app`,
  sin errores de autenticación con Redis, ambos mensajes procesados
  correctamente.

## Qué NO cambió

- El contrato entre `app.js` y `conversationEngine.js` sigue igual
  (`handleIncomingText(key, text, options)`) — el cambio quedó encapsulado
  en `conversations.js`, no hubo que tocar `ai.js` ni las rutas.
- El TTL de 48h es una elección simple, no una tabla con historial completo
  de negocio — si más adelante hace falta guardar leads/conversaciones de
  forma permanente (para reportes, por ejemplo), eso es un caso de uso
  distinto (probablemente Postgres/Neon, no este Redis) y no está resuelto
  todavía.
