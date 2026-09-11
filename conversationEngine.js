const { generateDemoReply } = require("./ai");
const { getConversation, saveConversation } = require("./conversations");

// Logica compartida por todas las vias de entrada de mensajes:
//  - /webhook            (Meta -> nosotros directo, camino original de WhatsApp)
//  - /chatwoot-bot        (WhatsApp via Chatwoot) — DEMO corre siempre, sin trigger.
//  - /chatwoot-bot/instagram (Instagram via Chatwoot) — requiere la palabra
//    clave "DEMO" para arrancar (canal mas general, sin la senal de interes
//    previo que si tiene alguien escribiendole al WhatsApp de la agencia).
// `key` identifica la conversacion (numero de telefono o id de conversacion
// de Chatwoot). Devuelve el texto a responder (null si todavia no corresponde
// responder nada, ej. Instagram sin trigger) y, si el lead quedo agendado en
// este turno, los datos para avisar al equipo.
async function handleIncomingText(key, text, { requireTrigger = false } = {}) {
  const conversation = await getConversation(key);

  if (requireTrigger && !conversation.triggered) {
    if (!/\bdemo\b/i.test(text)) return { reply: null, scheduledLead: null };
    conversation.triggered = true;
  }

  conversation.history.push({ role: "user", text });

  const { reply, stage, lead } = await generateDemoReply(conversation.history);
  if (reply) conversation.history.push({ role: "assistant", text: reply });

  let scheduledLead = null;
  if (stage === "scheduled" && !conversation.notified) {
    conversation.notified = true;
    scheduledLead = lead;
  }

  await saveConversation(key, conversation);
  return { reply, scheduledLead };
}

module.exports = { handleIncomingText };
