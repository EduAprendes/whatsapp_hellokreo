require("dotenv").config();
const crypto = require("crypto");
const express = require("express");

const { sendWhatsAppText } = require("./whatsapp");
const { sendChatwootMessage } = require("./chatwoot");
const { handleIncomingText } = require("./conversationEngine");

const {
  WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET,
  TEAM_NOTIFY_PHONE,
  CHATWOOT_BOT_SHARED_SECRET,
} = process.env;

const app = express();

// Guarda el body crudo (necesario para verificar la firma HMAC antes de que
// express.json() lo parsee) sin perder el parseo normal para las rutas.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Requerida por Meta para conectar productos de WhatsApp/Instagram (paso
// "URL de política de privacidad" en developers.facebook.com).
app.get("/privacy", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Política de privacidad — Kreo</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; line-height: 1.6; color: #222; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Política de privacidad — Kreo (Hellokreo)</h1>
  <p>Última actualización: 11 de septiembre de 2026.</p>

  <p>Este documento describe cómo tratamos la información que recibimos
  cuando nos escribes por WhatsApp o Instagram al número/cuenta de
  Hellokreo, incluida la demo automatizada de nuestro servicio de vendedor
  digital 24/7.</p>

  <h2>Qué datos recopilamos</h2>
  <ul>
    <li>El contenido de los mensajes que nos envías.</li>
    <li>Tu número de WhatsApp o tu identificador de cuenta de Instagram.</li>
    <li>Si nos los compartes durante la conversación: tu nombre, el nombre
    de tu negocio y un horario de contacto preferido.</li>
  </ul>

  <h2>Para qué los usamos</h2>
  <ul>
    <li>Generar respuestas automáticas mediante un asistente de inteligencia
    artificial (Google Gemini), como demostración de nuestro servicio.</li>
    <li>Calificar tu interés y, si corresponde, coordinar una llamada con
    alguien de nuestro equipo.</li>
    <li>No vendemos tus datos ni los compartimos con terceros, salvo los
    proveedores necesarios para operar este servicio (Meta, Google,
    Chatwoot).</li>
  </ul>

  <h2>Cuánto tiempo conservamos tus datos</h2>
  <p>El historial de la conversación se conserva mientras dure el
  intercambio y un tiempo razonable después, para poder dar seguimiento.</p>

  <h2>Tus derechos</h2>
  <p>Puedes pedirnos en cualquier momento que eliminemos tu información
  escribiéndonos a <a href="mailto:eurorondon03@gmail.com">eurorondon03@gmail.com</a>.</p>
</body>
</html>`);
});

// Paso 9 de la guía: handshake de verificación del webhook.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta firma cada POST del webhook con HMAC-SHA256 del App Secret sobre el
// body crudo, en el header X-Hub-Signature-256 (formato "sha256=<hex>").
function verifyMetaSignature(req, res, next) {
  const signature = req.get("x-hub-signature-256");
  if (!signature || !req.rawBody) return res.sendStatus(401);

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WHATSAPP_APP_SECRET).update(req.rawBody).digest("hex");

  const received = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (received.length !== expectedBuf.length || !crypto.timingSafeEqual(received, expectedBuf)) {
    return res.sendStatus(401);
  }

  next();
}

// Aviso al equipo (paso 7 del flujo "DEMO"): por ahora solo un WhatsApp a un
// número interno, si está configurado. El agendamiento real en Google
// Calendar (credenciales ya ubicadas en conect_spa_test) queda pendiente.
async function notifyTeam(lead, fromPhone) {
  console.log("Lead calificado y agendado:", { fromPhone, ...lead });
  if (!TEAM_NOTIFY_PHONE) return;
  const msg = `Nuevo lead del flujo DEMO:\nNombre: ${lead.name}\nNegocio: ${lead.business}\nHorario propuesto: ${lead.preferredTime}\nWhatsApp: ${fromPhone}`;
  await sendWhatsAppText(TEAM_NOTIFY_PHONE, msg);
}

async function handleMetaMessage(from, text) {
  console.log("Mensaje entrante (Meta directo):", { from, text });
  try {
    const { reply, scheduledLead } = await handleIncomingText(from, text);
    if (reply) await sendWhatsAppText(from, reply);
    if (scheduledLead) await notifyTeam(scheduledLead, from);
  } catch (err) {
    console.error("Error generando/enviando respuesta:", err.message);
  }
}

// Mensajes entrantes de WhatsApp directo (camino original, previo a Chatwoot).
// Se deja como respaldo/prueba; una vez el webhook de Meta apunte a Chatwoot,
// esta ruta deja de recibir trafico real. Se responde 200 al final (no antes):
// se probo responder antes y seguir en segundo plano con waitUntil de
// @vercel/functions, pero no fue confiable en este deploy (una de dos
// respuestas se perdio en silencio, sin error) — ver
// docs/incidente-timeout-webhook.md. Mas lento pero seguro, y ya no hace
// falta el atajo: la cuenta tiene keep_pending_on_bot_failure activado, asi
// que un timeout ya no apaga el bot solo.
app.post("/webhook", verifyMetaSignature, async (req, res) => {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (message?.type === "text") {
    await handleMetaMessage(message.from, message.text.body);
  }

  res.sendStatus(200);
});

// Agent Bot de Chatwoot: Chatwoot es quien habla con Meta (inboxes de
// WhatsApp Cloud API e Instagram); a nosotros nos reenvia cada mensaje
// entrante mientras la conversacion siga en estado "pending". Si un agente
// humano la toma (la pasa a "open"), dejamos de responder ahi — ver
// docs/pendientes-e-ideas.md. En Instagram, ademas, no se responde nada
// hasta que aparece la palabra clave "DEMO" (requireTrigger).
async function handleChatwootMessage(conversation, content, { requireTrigger } = {}) {
  console.log("Mensaje entrante (Chatwoot):", { conversationId: conversation.id, content });
  try {
    const key = `cw-${conversation.id}`;
    const { reply, scheduledLead } = await handleIncomingText(key, content, { requireTrigger });
    if (reply) await sendChatwootMessage(conversation.id, reply);
    if (scheduledLead) {
      const contactName = conversation.contact?.name || conversation.meta?.sender?.name;
      await notifyTeam(scheduledLead, contactName || `conversacion ${conversation.id}`);
    }
  } catch (err) {
    console.error("Error generando/enviando respuesta (Chatwoot):", err.message);
  }
}

// Chatwoot solo espera ~5s por este endpoint: si tarda mas o falla, marca la
// conversacion como "open" y apaga el bot ahi (Webhooks::Trigger#handle_failure
// en el codigo de Chatwoot). Se probo responder 200 de una vez y seguir en
// segundo plano con waitUntil (@vercel/functions), pero resulto poco
// confiable en produccion: la primera respuesta de una prueba llego bien y
// la segunda se perdio en silencio, sin ningun error en los logs — ver
// docs/incidente-timeout-webhook.md. Se volvio al patron sincrono (esperar
// antes de responder). Es mas lento, pero ya no hace falta el atajo: la
// cuenta de Chatwoot tiene keep_pending_on_bot_failure activado, asi que un
// timeout ocasional ya no apaga el bot solo — solo se pierde esa respuesta
// puntual (mejor que perderlas todas de a poco, como pasaba con waitUntil).
function chatwootBotHandler({ requireTrigger }) {
  return async (req, res) => {
    if (CHATWOOT_BOT_SHARED_SECRET && req.query.secret !== CHATWOOT_BOT_SHARED_SECRET) {
      return res.sendStatus(401);
    }

    const { event, message_type: messageType, content, conversation } = req.body || {};

    // conversation.status !== "pending" -> un humano ya la tomo, no respondemos.
    if (event === "message_created" && messageType === "incoming" && content && conversation?.status === "pending") {
      await handleChatwootMessage(conversation, content, { requireTrigger });
    }

    res.sendStatus(200);
  };
}

// WhatsApp Hellokreo: el guion "DEMO" corre siempre, sin trigger.
app.post("/chatwoot-bot", chatwootBotHandler({ requireTrigger: false }));

// Instagram (cuenta reutilizada de conect_spa_test): requiere la palabra
// clave "DEMO" para arrancar — ver docs/instagram-integracion.md.
app.post("/chatwoot-bot/instagram", chatwootBotHandler({ requireTrigger: true }));

module.exports = app;
