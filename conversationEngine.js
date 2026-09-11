const { generateDemoReply } = require("./ai");
const { getConversation } = require("./conversations");

// Logica compartida por las dos vias de entrada de mensajes:
//  - /webhook       (Meta -> nosotros directo, camino original)
//  - /chatwoot-bot  (Meta -> Chatwoot -> nosotros como Agent Bot)
// `key` identifica la conversacion (numero de telefono o id de conversacion
// de Chatwoot, segun la via). WhatsApp Hellokreo siempre corre el guion
// "DEMO" (docs/plan-agentes-ia-ventas.md, Fase 2) — quien escribe aca ya
// esta interesado en el servicio, no hace falta la palabra clave (esa se
// reserva para Instagram, un canal mas general donde si aplica el trigger).
// Devuelve el texto a responder y, si el lead quedo agendado en este turno,
// los datos para avisar al equipo.
async function handleIncomingText(key, text) {
  const conversation = getConversation(key);

  conversation.history.push({ role: "user", text });

  const { reply, stage, lead } = await generateDemoReply(conversation.history);
  if (reply) conversation.history.push({ role: "assistant", text: reply });

  let scheduledLead = null;
  if (stage === "scheduled" && !conversation.notified) {
    conversation.notified = true;
    scheduledLead = lead;
  }
  return { reply, scheduledLead };
}

module.exports = { handleIncomingText };
