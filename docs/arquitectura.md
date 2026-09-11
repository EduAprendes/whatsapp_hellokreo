# Arquitectura

Backend Node.js + Express plano (sin framework tipo Next.js — no hace falta frontend).

```
app.js            → crea la app de Express, rutas /health y /webhook, valida firma de Meta
index.js          → entrypoint local: require("./app") + app.listen(PORT)  (npm run dev / npm start)
whatsapp.js       → sendWhatsAppText(to, body) — llama a la Graph API para enviar mensajes
ai.js             → generateReply() (genérico) y generateDemoReply() (flujo DEMO), ambos con Gemini
conversations.js  → Map en memoria: estado de conversación por número de WhatsApp
```

## Por qué `app.js` exporta la app directamente (no `{ app, ... }`)

Vercel soporta frameworks backend (Express incluido) de forma nativa, sin necesitar
carpeta `/api` ni `vercel.json`. Para eso escanea el proyecto buscando un archivo de
entrada con un nombre convencional (`app.js` es uno de ellos) y espera que su
**export por defecto sea la función/servidor en sí** — un objeto como
`{ app, sendWhatsAppText }` rompe esa convención y el deploy crashea con
`FUNCTION_INVOCATION_FAILED` / `Invalid export found in module "app.js"`.

Por eso `sendWhatsAppText` se movió a `whatsapp.js` aparte, y `app.js` termina con
`module.exports = app;` a secas. `index.js` sigue existiendo solo para levantar el
servidor en local con `app.listen()` — en Vercel ese archivo ni se usa, Vercel
invoca `app.js` (que es una función Express, es decir, un handler `(req, res)`)
directamente por request.

Se intentó primero el patrón clásico `/api/index.js` + `vercel.json` con rewrites
(el que usan la mayoría de tutoriales viejos de "Express en Vercel") y **no
funcionó** — el rewrite entraba en conflicto con la detección nativa de "backend
framework" de Vercel. Quitar `/api` y `vercel.json` resolvió el crash.

## Webhook (`POST /webhook`) — por qué responde 200 al final

```js
app.post("/webhook", verifyMetaSignature, async (req, res) => {
  // ...procesa el mensaje, llama a Gemini, envía la respuesta por WhatsApp...
  res.sendStatus(200);   // <- al final, no antes
});
```

En un entorno serverless la función puede congelarse en cuanto se envía la
respuesta — si se respondiera 200 antes de terminar de llamar a Gemini y enviar
el WhatsApp, ese trabajo podría no completarse. Por eso todo el trabajo async va
antes del `res.sendStatus(200)`. Contrapartida: si Gemini + el envío tardan
mucho, Meta podría reintentar el webhook antes de recibir el 200 (no ha pasado
en las pruebas, pero es lo primero a revisar si algún día se ven mensajes
duplicados).

## Variables de entorno

Ver `.env.example`. Configuradas en Vercel vía `vercel env add` (Production y
Preview) — el repo en GitHub no las lleva (`.gitignore`).

## Despliegue

- Repo: https://github.com/EduAprendes/whatsapp_hellokreo
- Vercel: proyecto `eduaprendes-projects/whatsapp-hellokreo`, deploy automático en cada push a `main`.
- Debug de deploys: `vercel logs <url>` para logs de runtime, `vercel inspect <url> --logs` para logs de build.
