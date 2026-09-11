require("dotenv").config();
const crypto = require("crypto");
const express = require("express");

const { generateReply, generateDemoReply } = require("./ai");
const { sendWhatsAppText } = require("./whatsapp");
const { getConversation } = require("./conversations");

const { WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET, TEAM_NOTIFY_PHONE } = process.env;

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

// Mensajes entrantes de WhatsApp. Se responde 200 al final (no antes): en
// Vercel, la funcion puede congelarse apenas se envia la respuesta, asi que
// el trabajo de la IA y el envio tienen que terminar primero.
app.post("/webhook", verifyMetaSignature, async (req, res) => {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (message?.type === "text") {
    const text = message.text.body;
    console.log("Mensaje entrante:", { from: message.from, text });

    try {
      const conversation = getConversation(message.from);

      // docs/plan-agentes-ia-ventas.md, Fase 2: escribir "DEMO" activa el
      // guion de venta/calificación de la propia agencia.
      if (conversation.mode === "generic" && /\bdemo\b/i.test(text)) {
        conversation.mode = "demo";
      }

      conversation.history.push({ role: "user", text });

      if (conversation.mode === "demo") {
        const { reply, stage, lead } = await generateDemoReply(conversation.history);
        if (reply) {
          conversation.history.push({ role: "assistant", text: reply });
          await sendWhatsAppText(message.from, reply);
        }
        if (stage === "scheduled" && !conversation.notified) {
          conversation.notified = true;
          await notifyTeam(lead, message.from);
        }
      } else {
        const reply = await generateReply(text);
        if (reply) {
          conversation.history.push({ role: "assistant", text: reply });
          await sendWhatsAppText(message.from, reply);
        }
      }
    } catch (err) {
      console.error("Error generando/enviando respuesta:", err.message);
    }
  }

  res.sendStatus(200);
});

module.exports = app;
