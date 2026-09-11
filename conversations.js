// Estado por número de WhatsApp, en memoria. Se pierde en un cold start de
// Vercel — suficiente para el MVP del flujo "DEMO"; si hace falta que
// sobreviva a reinicios, pasar esto a una base de datos.
const conversations = new Map();

function getConversation(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, { mode: "generic", history: [], notified: false });
  }
  return conversations.get(phone);
}

module.exports = { getConversation };
