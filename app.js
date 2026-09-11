require("dotenv").config();
const crypto = require("crypto");
const express = require("express");

const { WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET } = process.env;

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

// Mensajes entrantes de WhatsApp.
app.post("/webhook", verifyMetaSignature, (req, res) => {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (message) {
    console.log("Mensaje entrante:", {
      from: message.from,
      type: message.type,
      text: message.text?.body,
    });
  }

  res.sendStatus(200);
});

module.exports = app;
