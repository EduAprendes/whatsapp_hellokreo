// Estado por conversación (número de WhatsApp o id de conversación de
// Chatwoot), en memoria. Se pierde en un cold start de Vercel — suficiente
// para el MVP del flujo "DEMO"; si hace falta que sobreviva a reinicios,
// pasar esto a una base de datos.
const conversations = new Map();

function getConversation(key) {
  if (!conversations.has(key)) {
    conversations.set(key, { history: [], notified: false, triggered: false });
  }
  return conversations.get(key);
}

module.exports = { getConversation };
