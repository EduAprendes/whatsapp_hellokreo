const { generateReply, generateDemoReply } = require("./ai");
const { getConversation } = require("./conversations");

// Logica compartida por las dos vias de entrada de mensajes:
//  - /webhook       (Meta -> nosotros directo, camino original)
//  - /chatwoot-bot  (Meta -> Chatwoot -> nosotros como Agent Bot)
// `key` identifica la conversacion (numero de telefono o id de conversacion
// de Chatwoot, segun la via). Devuelve el texto a responder y, si el lead
// quedo agendado en este turno, los datos para avisar al equipo.
async function handleIncomingText(key, text) {
  const conversation = getConversation(key);

  // docs/plan-agentes-ia-ventas.md, Fase 2: escribir "DEMO" activa el guion
  // de venta/calificacion de la propia agencia.
  if (conversation.mode === "generic" && /\bdemo\b/i.test(text)) {
    conversation.mode = "demo";
  }

  conversation.history.push({ role: "user", text });

  if (conversation.mode === "demo") {
    const { reply, stage, lead } = await generateDemoReply(conversation.history);
    if (reply) conversation.history.push({ role: "assistant", text: reply });

    let scheduledLead = null;
    if (stage === "scheduled" && !conversation.notified) {
      conversation.notified = true;
      scheduledLead = lead;
    }
    return { reply, scheduledLead };
  }

  const reply = await generateReply(text);
  if (reply) conversation.history.push({ role: "assistant", text: reply });
  return { reply, scheduledLead: null };
}

module.exports = { handleIncomingText };
