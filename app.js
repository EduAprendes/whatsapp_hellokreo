require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const { waitUntil } = require("@vercel/functions");

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
// esta ruta deja de recibir trafico real. Se responde 200 de una vez y el
// trabajo real sigue en segundo plano (mismo motivo que /chatwoot-bot).
app.post("/webhook", verifyMetaSignature, (req, res) => {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  res.sendStatus(200);

  if (message?.type === "text") {
    waitUntil(handleMetaMessage(message.from, message.text.body));
  }
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
// en el codigo de Chatwoot) sin avisar en ningun otro lado mas que un mensaje
// de actividad en el hilo. Por eso respondemos 200 de una vez y el trabajo de
// verdad (Gemini + enviar la respuesta) sigue en segundo plano con waitUntil.
function chatwootBotHandler({ requireTrigger }) {
  return (req, res) => {
    if (CHATWOOT_BOT_SHARED_SECRET && req.query.secret !== CHATWOOT_BOT_SHARED_SECRET) {
      return res.sendStatus(401);
    }

    const { event, message_type: messageType, content, conversation } = req.body || {};
    res.sendStatus(200);

    // conversation.status !== "pending" -> un humano ya la tomo, no respondemos.
    if (event === "message_created" && messageType === "incoming" && content && conversation?.status === "pending") {
      waitUntil(handleChatwootMessage(conversation, content, { requireTrigger }));
    }
  };
}

// WhatsApp Hellokreo: el guion "DEMO" corre siempre, sin trigger.
app.post("/chatwoot-bot", chatwootBotHandler({ requireTrigger: false }));

// Instagram (cuenta reutilizada de conect_spa_test): requiere la palabra
// clave "DEMO" para arrancar — ver docs/instagram-integracion.md.
app.post("/chatwoot-bot/instagram", chatwootBotHandler({ requireTrigger: true }));

module.exports = app;
